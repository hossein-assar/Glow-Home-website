// «کارت به کارت» places no order: checkout shows a "contact us" box
// (Instagram and the contact page; a WhatsApp link with the cart prefilled
// and the number as a tel: line only while data.js has a number — none for
// now) instead of the order button,
// nothing is sent and the cart stays. api/orders.js, which used to create
// those orders, refuses every order. Online payment («پرداخت آنلاین», the
// payment server) is the only way to order. Runs the real code, pulled out
// of the source text where it is a browser script.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const appJs = read('../../app.js');
const dataJs = read('../../data.js');
const ordersJs = read('../../api/orders.js');
const grab = (src, re) => {
  const m = src.match(re);
  assert.ok(m, 'not found: ' + re);
  return m[0];
};
const fnSrc = (name) => grab(appJs, new RegExp(`function ${name}\\([\\s\\S]*?\\n}\\n`));
const { COPY, PAYMENTS, ONLINE_PAYMENT } = new Function(dataJs + '\nreturn { COPY, PAYMENTS, ONLINE_PAYMENT };')();

// ---- api/orders.js ------------------------------------------------------------

/** api/orders.js with a require that refuses everything and a fetch that
 * fails the test: it must answer without the database or email. */
function loadOrders() {
  const mod = { exports: {} };
  const noRequire = (id) => { throw new Error('api/orders.js must not require ' + id); };
  new Function('require', 'module', 'exports', ordersJs)(noRequire, mod, mod.exports);
  return mod.exports;
}
async function call(handler, req) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('api/orders.js called fetch'); };
  const res = { status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  try {
    await handler(req, res);
  } finally {
    globalThis.fetch = realFetch;
  }
  return res;
}

test('api/orders.js refuses every order with a clear error (410) — no database, no email', async () => {
  const orders = loadOrders();
  const valid = {
    customer: { name: 'سارا', phone: '+989121234567', city: 'تهران', address: 'خیابان ولیعصر، کوچه ۱۲، پلاک ۳', postcode: '' },
    items: [{ cartKey: 'lale', qty: 1 }],
  };
  for (const body of [valid, { ...valid, payment_method: 'card' }, { ...valid, payment_method: 'gateway' }, JSON.stringify(valid), {}, 'x']) {
    const res = await call(orders, { method: 'POST', body });
    assert.equal(res.statusCode, 410);
    assert.equal(res.body.ok, false);
    assert.match(res.body.error, /کارت به کارت از طریق اینستاگرام یا فرم تماس به ما پیام بدهید\./);
    assert.doesNotMatch(res.body.error, /تماس بگیرید/);
  }
  assert.equal((await call(orders, { method: 'GET' })).statusCode, 405);
});

test('api/orders.js keeps its pricing helpers', () => {
  const orders = loadOrders();
  for (const name of ['parseCartKey', 'shadeLine', 'hasShadeTypes', 'withBaseSize', 'sizeLine', 'cityFees', 'shippingMethodForCity']) {
    assert.equal(typeof orders[name], 'function', name);
  }
  assert.deepEqual(orders.cityFees('کرج'), [{ label: 'هزینه بسته‌بندی', amount: 250000 }]);
  assert.equal(orders.shippingMethodForCity('تهران'), 'peyk');
});

// ---- checkout -------------------------------------------------------------------

// Made-up numbers for the tests (the shop's real ones are in data.js).
const CALL = '۰۹۱۲ ۳۴۵ ۶۷۸۹'; // → 989123456789
const MSG_ONLY = '0935-111-2233'; // → 989351112233

/** The real box, bar, link and message code from app.js, with a stub cart:
 * totals() returns `rows` as cartLineData() would, plus the city's total.
 * The numbers default to data.js's. */
function contactEnv({ pay = 'card', online = ONLINE_PAYMENT, phone = COPY.contactPhone, whatsapp = COPY.contactWhatsapp, rows, total = 2600000, form = {} } = {}) {
  const state = {
    pay,
    form: { name: 'سارا', phone: '9121234567', city: '', address: 'خیابان ولیعصر، کوچه ۱۲، پلاک ۳', postcode: '1234567890', note: 'یادداشت خصوصی', ...form },
  };
  const calls = [];
  const env = new Function(
    'state', 'COPY', 'ONLINE_PAYMENT', 'totals', 'fetch', 'render', 'document',
    `const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
     const icon = (n) => '<svg data-icon="' + n + '"></svg>';
     ${grab(appJs, /const FA_DIGITS = [^\n]*\n/)}
     ${grab(appJs, /const AR_DIGITS = [^\n]*\n/)}
     ${grab(appJs, /const FA = [^\n]*\n/)}
     ${grab(appJs, /const money = [^\n]*\n/)}
     ${fnSrc('toLatinDigits')}
     ${fnSrc('parseCartKey')}
     ${grab(appJs, /const CARD_TO_CARD_MSG = [^\n]*\n/)}
     ${grab(appJs, /const ONLINE_OFF_MSG = [^\n]*\n/)}
     ${fnSrc('phoneIntl')}
     ${fnSrc('contactPhoneIntl')}
     ${fnSrc('contactWhatsappIntl')}
     ${fnSrc('contactTelHref')}
     ${fnSrc('contactMessage')}
     ${fnSrc('messageOnlyWhatsAppHref')}
     ${fnSrc('whatsAppHref')}
     ${fnSrc('whatsappIcon')}
     ${fnSrc('payByContactHtml')}
     ${fnSrc('payByContactBarHtml')}
     ${fnSrc('refreshWhatsAppLink')}
     return { phoneIntl, contactPhoneIntl, contactWhatsappIntl, contactTelHref, contactMessage, messageOnlyWhatsAppHref, whatsAppHref, payByContactHtml, payByContactBarHtml, refreshWhatsAppLink };`
  )(
    state,
    { ...COPY, contactPhone: phone, contactWhatsapp: whatsapp },
    online,
    () => ({ rows: rows ?? CART_ROWS, total: total + (state.form.city && state.form.city !== 'تهران' ? 250000 : 0) }),
    () => { calls.push('fetch'); },
    () => { calls.push('render'); },
    { addEventListener() {} }
  );
  return { ...env, state, calls };
}

// As cartLineData() returns them: a shade product with size + shade, a size
// product with its size chosen, a plain product with a colour.
const CART_ROWS = [
  { cartKey: 'gisoo::h120::sembroidered', fa: 'گیسو', heightFa: '۱۲۰ سانتی‌متر', shadeFa: 'شید گلدوزی', qty: 1 },
  { cartKey: 'shade-embroidered-cylinder::h50', fa: 'شید گلدوزی مهتاب', heightFa: '۵۰ سانتی‌متر', qty: 2 },
  { cartKey: 'lale::c1', fa: 'لاله', heightFa: '۴۰ سانتی‌متر', color: 'سبز', qty: 1 },
];
const textOf = (href) => new URL(href).searchParams.get('text') ?? '';

test('no shop number for now: both constants are empty in data.js', () => {
  assert.equal(COPY.contactPhone, '');
  assert.equal(COPY.contactWhatsapp, '');
  assert.match(dataJs, /\n  contactPhone: '',\n  contactWhatsapp: '',\n/);
});

test('with no number the box has the message, Instagram (main button) and the contact page — no WhatsApp, no tel:, no number', () => {
  for (const [pay, online, msg] of [['card', ONLINE_PAYMENT, /<p>برای پرداخت کارت به کارت، لطفاً از طریق اینستاگرام یا فرم تماس به ما پیام بدهید<\/p>/], ['gateway', { enabled: false }, /<p>پرداخت آنلاین فعلاً در دسترس نیست\. برای خرید، لطفاً از طریق اینستاگرام یا فرم تماس به ما پیام بدهید<\/p>/]]) {
    const e = contactEnv({ pay, online });
    const html = e.payByContactHtml();
    assert.match(html, msg, pay);
    assert.ok(html.includes(`<a class="btn btn-accent" href="${COPY.instagramUrl}" target="_blank" rel="noopener"><svg data-icon="instagram"></svg>پیام در اینستاگرام</a>`), 'Instagram is the main button');
    assert.ok(html.includes('<button class="btn btn-ghost" data-nav="#/contact">صفحه‌ی تماس با ما</button>'));
    for (const gone of ['wa.me', 'data-wa', 'واتساپ', 'tel:', 'pay-contact-call', 'تماس بگیرید']) assert.ok(!html.includes(gone), gone);
    assert.doesNotMatch(html.replace(/href="[^"]*"/g, ''), /[0-9۰-۹٠-٩]{4}/, 'no number on show');
    assert.doesNotMatch(html, /data-act="place-order"/);
    assert.equal(e.whatsAppHref(), '');
    assert.equal(e.contactTelHref(), '');
  }
});

test('with no number the mobile action bar says «ارتباط برای پرداخت» and opens Instagram', () => {
  const bar = contactEnv().payByContactBarHtml();
  assert.equal(bar, `<a class="btn btn-accent" href="${COPY.instagramUrl}" target="_blank" rel="noopener"><svg data-icon="instagram"></svg> ارتباط برای پرداخت</a>`);
  assert.match(fnSrc('screenCheckout'), /: payByContactBarHtml\(\)/);
});

test('numbers: any digits and spacing → 98…, empty or blank → ""', () => {
  const { phoneIntl } = contactEnv();
  for (const raw of ['۰۹۱۲۳۴۵۶۷۸۹', '٠٩١٢٣٤٥٦٧٨٩', '09123456789', '0912 345 6789', '0912-345-6789', '+98 912 345 6789', '۰۹۱۲ ۳۴۵ ۶۷۸۹']) {
    assert.equal(phoneIntl(raw), '989123456789', raw);
  }
  for (const raw of ['', '   ', ' - ', undefined, null]) assert.equal(phoneIntl(raw), '', String(raw));
});

test('contactPhone set: the WhatsApp button, «یا تماس بگیرید» and the WhatsApp bar come back by themselves', () => {
  const e = contactEnv({ phone: CALL });
  const html = e.payByContactHtml();
  const wa = html.match(/<a class="btn btn-accent" data-wa href="([^"]*)" target="_blank" rel="noopener noreferrer"><svg[^>]*>[\s\S]*?<\/svg>ارسال پیام در واتساپ<\/a>/);
  assert.ok(wa, 'WhatsApp button');
  assert.equal(wa[1].replace(/&amp;/g, '&'), e.whatsAppHref());
  assert.match(e.whatsAppHref(), /^https:\/\/wa\.me\/989123456789\?text=/);
  assert.ok(html.includes(`<a class="btn btn-ghost" href="${COPY.instagramUrl}"`), 'Instagram back to second');
  assert.ok(html.includes('data-nav="#/contact"'));
  assert.ok(html.includes(`<p class="pay-contact-call">یا تماس بگیرید: <a class="ltr" href="tel:+989123456789">${CALL}</a></p>`));
  assert.match(e.payByContactBarHtml(), /^<a class="btn btn-accent" data-wa href="https:\/\/wa\.me\/989123456789\?text=[^"]*" target="_blank" rel="noopener noreferrer"><svg[\s\S]*<\/svg> پیام در واتساپ<\/a>$/);
  assert.equal(e.messageOnlyWhatsAppHref(), '', 'no extra footer link for the call number');
});

test('contactWhatsapp only (messages): WhatsApp everywhere, but no tel: and no number on show', () => {
  const e = contactEnv({ whatsapp: MSG_ONLY });
  const html = e.payByContactHtml();
  assert.match(e.whatsAppHref(), /^https:\/\/wa\.me\/989351112233\?text=/);
  assert.ok(html.includes('data-wa href="https://wa.me/989351112233?text='));
  assert.ok(!html.includes('tel:') && !html.includes('pay-contact-call'));
  assert.ok(!html.replace(/href="[^"]*"/g, '').includes('2233'), 'the number is only inside the link');
  assert.match(e.payByContactBarHtml(), /پیام در واتساپ/);
  assert.equal(e.messageOnlyWhatsAppHref(), 'https://wa.me/989351112233');
});

test('both set: WhatsApp uses contactWhatsapp, the call line uses contactPhone', () => {
  const e = contactEnv({ phone: CALL, whatsapp: MSG_ONLY });
  assert.match(e.whatsAppHref(), /^https:\/\/wa\.me\/989351112233\?/);
  assert.equal(e.contactTelHref(), 'tel:+989123456789');
  assert.ok(e.payByContactHtml().includes('href="tel:+989123456789"'));
});

test('the message: greeting, each line with size / shade / colour and quantity, the total, the city if typed', () => {
  const e = contactEnv({ form: { city: 'کرج' } });
  assert.equal(
    e.contactMessage(),
    [
      'سلام، می‌خواهم سفارشم را با کارت به کارت پرداخت کنم.',
      '• گیسو (۱۲۰ سانتی‌متر · شید گلدوزی) × ۱',
      '• شید گلدوزی مهتاب (۵۰ سانتی‌متر) × ۲',
      '• لاله (سبز) × ۱',
      'جمع: ۲٬۸۵۰٬۰۰۰ تومان',
      'شهر: کرج',
    ].join('\n')
  );
  assert.doesNotMatch(contactEnv().contactMessage(), /شهر/, 'no city typed: no city line');
});

test('the message never carries the name, phone, address, postcode or note', () => {
  const text = textOf(contactEnv({ phone: CALL, form: { city: 'تهران' } }).whatsAppHref());
  assert.ok(text);
  for (const v of ['سارا', '9121234567', 'ولیعصر', '1234567890', 'یادداشت']) assert.ok(!text.includes(v), v);
});

test('the text is URL-encoded: nothing raw in the link, and it decodes back exactly', () => {
  const rows = [{ cartKey: 'x', fa: 'ست A&B #۲ ?=% "تست"', heightFa: '', qty: 3 }];
  const e = contactEnv({ phone: CALL, rows, form: { city: 'تهران - ونک' } });
  const href = e.whatsAppHref();
  const query = href.split('?text=')[1];
  assert.equal(query, encodeURIComponent(e.contactMessage()));
  assert.match(query, /^[A-Za-z0-9%\-_.!~*'()]+$/, 'only URL-safe characters');
  assert.ok(query.includes('%0A'), 'new lines encoded');
  assert.ok(query.includes('%26') && query.includes('%23'), '& and # encoded');
  assert.equal([...new URL(href).searchParams.keys()].join(), 'text', 'one text parameter only');
  assert.equal(textOf(href), e.contactMessage());
});

test('with online payment switched off, every option shows the box with its own message', () => {
  for (const pay of ['card', 'gateway']) {
    const e = contactEnv({ pay, online: { enabled: false } });
    assert.match(e.payByContactHtml(), /پرداخت آنلاین فعلاً در دسترس نیست/, pay);
    assert.doesNotMatch(e.payByContactHtml(), /data-act="place-order"/, pay);
    assert.match(e.contactMessage(), /^سلام، می‌خواهم این سفارش را ثبت کنم\./, pay);
  }
});

test('pressing or clicking the WhatsApp link only refreshes its text (city typed since) — no request, no render', () => {
  const e = contactEnv({ phone: CALL });
  const link = { href: e.whatsAppHref() };
  const target = { closest: (sel) => (sel === 'a[data-wa]' ? link : null) };
  e.state.form.city = 'اصفهان'; // typed after the render, without a re-render
  e.refreshWhatsAppLink({ target });
  assert.match(textOf(link.href), /شهر: اصفهان/);
  assert.match(textOf(link.href), /جمع: ۲٬۸۵۰٬۰۰۰ تومان/); // the packaging fee is in the total
  e.refreshWhatsAppLink({ target: { closest: () => null } }); // any other click: nothing
  const none = contactEnv(); // no number: a stray data-wa link is left alone
  const stray = { href: 'https://example.com/' };
  none.refreshWhatsAppLink({ target: { closest: () => stray } });
  assert.equal(stray.href, 'https://example.com/');
  assert.deepEqual(e.calls, []);
  assert.deepEqual(none.calls, []);
  assert.match(appJs, /document\.addEventListener\('pointerdown', refreshWhatsAppLink, true\);/);
  assert.match(appJs, /document\.addEventListener\('click', refreshWhatsAppLink, true\);/);
});

test('nothing a customer sees says to call — only the «یا تماس بگیرید» line, shown only with contactPhone', () => {
  const sources = {
    'app.js': appJs, 'data.js': dataJs, 'api/orders.js': ordersJs,
    'api/contact.js': read('../../api/contact.js'), 'api/track-order.js': read('../../api/track-order.js'),
    'api/pay-callback.js': read('../../api/pay-callback.js'), 'index.html': read('../../index.html'),
    'payment-server/src/app.js': read('../src/app.js'),
  };
  const calls = [];
  for (const [file, src] of Object.entries(sources)) {
    src.split('\n').forEach((line, i) => {
      if (/^\s*(\/\/|\/?\*)/.test(line)) return; // comments
      if (/تماس بگیر|زنگ بزن/.test(line)) calls.push(`${file}:${i + 1}`);
    });
  }
  assert.deepEqual(calls.map((c) => c.split(':')[0]), ['app.js'], calls.join(', '));
  assert.match(appJs.split('\n')[+calls[0].split(':')[1] - 1], /tel \? `[^`]*<p class="pay-contact-call">یا تماس بگیرید: <a class="ltr" href="\$\{tel\}">/);
  for (const msg of ['CARD_TO_CARD_MSG', 'ONLINE_OFF_MSG']) {
    assert.match(grab(appJs, new RegExp(`const ${msg} = [^\\n]*`)), /از طریق اینستاگرام یا فرم تماس به ما پیام بدهید';$/, msg);
  }
  assert.equal(PAYMENTS.find((p) => p.id === 'card').note, 'از طریق اینستاگرام یا فرم تماس پیام بدهید؛ سفارش در سایت ثبت نمی‌شود');
});

// ---- footer and contact page ----------------------------------------------------

/** footer() and screenContact() from app.js with the given numbers. */
function pagesEnv({ phone = COPY.contactPhone, whatsapp = COPY.contactWhatsapp } = {}) {
  const state = { contact: { name: '', phone: '', message: '', website: '' }, contactError: '', contactSending: false, contactSent: false };
  return new Function(
    'state', 'COPY', 'COLLECTIONS',
    `const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
     const icon = (n) => '<svg data-icon="' + n + '"></svg>';
     ${grab(appJs, /const CONTACT_NAME_MAX = [^\n]*\n/)}
     ${grab(appJs, /const CONTACT_MSG_MAX = [^\n]*\n/)}
     ${grab(appJs, /const FA_DIGITS = [^\n]*\n/)}
     ${grab(appJs, /const AR_DIGITS = [^\n]*\n/)}
     ${fnSrc('toLatinDigits')}
     ${fnSrc('phoneIntl')}
     ${fnSrc('contactPhoneIntl')}
     ${fnSrc('messageOnlyWhatsAppHref')}
     ${fnSrc('whatsappIcon')}
     ${fnSrc('footer')}
     ${fnSrc('screenContact')}
     return { footer, screenContact };`
  )(state, { ...COPY, contactPhone: phone, contactWhatsapp: whatsapp }, new Proxy({}, { get: () => ({ fa: 'دسته' }) }));
}

test('footer and contact page with no number: Instagram, hours (and the form) only — no empty row, no stray icon', () => {
  const { footer, screenContact } = pagesEnv();
  const foot = footer();
  const contactCol = foot.slice(foot.lastIndexOf('<h4>تماس</h4>'));
  assert.equal((contactCol.match(/<(a|span|button)\b/g) || []).length, 3, 'Instagram link (+ its handle) and the hours');
  assert.ok(contactCol.includes(COPY.instagramUrl) && contactCol.includes(COPY.contactHours));
  const page = screenContact();
  assert.ok(page.includes('data-act="send-contact"'), 'the form');
  assert.ok(page.includes(COPY.instagramUrl));
  for (const html of [foot, page]) {
    for (const gone of ['data-icon="phone"', 'tel:', 'wa.me', 'واتساپ', 'class="ltr" style="direction:ltr']) assert.ok(!html.includes(gone), gone);
  }
});

test('footer and contact page: the number row comes back with contactPhone, a WhatsApp link (no digits) with contactWhatsapp', () => {
  const withPhone = pagesEnv({ phone: CALL });
  assert.ok(withPhone.footer().includes(`<span class="ltr" style="direction:ltr;text-align:right">${CALL}</span>`));
  assert.ok(withPhone.screenContact().includes(`<svg data-icon="phone"></svg><span class="ltr" style="direction:ltr">${CALL}</span>`));
  const withMsg = pagesEnv({ whatsapp: MSG_ONLY });
  for (const html of [withMsg.footer(), withMsg.screenContact()]) {
    assert.ok(html.includes('href="https://wa.me/989351112233"'));
    assert.match(html, /پیام در واتساپ/);
    assert.ok(!html.includes('tel:') && !html.includes('data-icon="phone"'));
    assert.ok(!html.replace(/href="[^"]*"/g, '').includes('2233'), 'no digits on show');
  }
});

function placeOrderEnv(pay, online = true) {
  const calls = [];
  const state = {
    pay,
    placingOrder: false,
    cart: { lale: 2 },
    form: { name: 'سارا', phone: '9121234567', city: 'تهران', address: 'خیابان ولیعصر، کوچه ۱۲، پلاک ۳', postcode: '', note: '' },
    formErrors: {},
    error: '',
    ship: 'peyk',
    appliedCode: null,
  };
  const placeOrder = new Function(
    'state', 'ONLINE_PAYMENT', 'syncForm', 'totals', 'render', 'startOnlinePayment', 'fetch', '$',
    `const FIELD_VALIDATORS = {}; const validateCheckoutField = () => {}; const normalizePostcode = (x) => x;
     ${fnSrc('isOnlinePayment')}
     ${fnSrc('placeOrder')} return placeOrder;`
  )(
    state,
    { enabled: online },
    () => calls.push('syncForm'),
    () => ({ rows: [{ cartKey: 'lale', qty: 2 }], total: 13000000 }),
    () => calls.push('render'),
    () => calls.push('startOnlinePayment'),
    () => { calls.push('fetch'); return new Promise(() => {}); },
    () => null
  );
  return { placeOrder, calls, state };
}

test('placeOrder with «کارت به کارت»: nothing happens — no request, no render, the cart stays', () => {
  for (const [pay, online] of [['card', true], ['card', false], ['gateway', false]]) {
    const { placeOrder, calls, state } = placeOrderEnv(pay, online);
    placeOrder();
    assert.deepEqual(calls, [], pay + ' online=' + online);
    assert.deepEqual(state.cart, { lale: 2 });
    assert.equal(state.placingOrder, false);
  }
});

test('placeOrder with «پرداخت آنلاین» still goes to the payment server', () => {
  const { placeOrder, calls, state } = placeOrderEnv('gateway');
  placeOrder();
  assert.deepEqual(calls, ['syncForm', 'render', 'startOnlinePayment']);
  assert.equal(state.placingOrder, true);
});

test('checkout: the order button only for online payment, the box otherwise; nothing calls /api/orders', () => {
  const checkout = fnSrc('screenCheckout');
  for (const m of checkout.matchAll(/data-act="place-order"/g)) {
    const before = checkout.slice(Math.max(0, m.index - 200), m.index);
    assert.match(before, /isOnlinePayment\(\)\s*\?\s*`<button/, 'a place-order button outside the online-payment branch');
  }
  assert.match(checkout, /: payByContactHtml\(\)/);
  assert.match(checkout, /: payByContactBarHtml\(\)/, 'mobile action bar');
  assert.doesNotMatch(appJs, /\/api\/orders['"`]/);
  assert.doesNotMatch(appJs, /screenDone|go\('done'\)|state\.order\b/);
  assert.deepEqual(PAYMENTS.map((p) => p.id), ['gateway', 'card']);
});
