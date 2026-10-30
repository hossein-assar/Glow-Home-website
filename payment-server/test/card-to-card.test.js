// «کارت به کارت» places no order: checkout shows a "contact us" box (a
// WhatsApp link with the cart prefilled, Instagram, the contact page, and the
// number as a tel: line) instead of the order button,
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
    assert.match(res.body.error, /کارت به کارت با ما تماس بگیرید/);
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

/** The real box, link and message code from app.js, with a stub cart:
 * totals() returns `rows` as cartLineData() would, plus the city's total. */
function contactEnv({ pay = 'card', online = ONLINE_PAYMENT, phone = COPY.contactPhone, rows, total = 2600000, form = {} } = {}) {
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
     ${fnSrc('contactPhoneIntl')}
     ${fnSrc('contactTelHref')}
     ${fnSrc('contactMessage')}
     ${fnSrc('whatsAppHref')}
     ${fnSrc('whatsappIcon')}
     ${fnSrc('payByContactHtml')}
     ${fnSrc('refreshWhatsAppLink')}
     return { contactPhoneIntl, contactTelHref, contactMessage, whatsAppHref, payByContactHtml, refreshWhatsAppLink };`
  )(
    state,
    { ...COPY, contactPhone: phone },
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

test('the WhatsApp number comes from COPY.contactPhone: digits converted, leading 0 → 98', () => {
  assert.equal(COPY.contactPhone, '۰۹۱۹۵۸۱۹۲۰۳'); // the number on the contact page and in the footer
  for (const phone of ['۰۹۱۹۵۸۱۹۲۰۳', '٠٩١٩٥٨١٩٢٠٣', '09195819203', '0919 581 9203', '0919-581-9203', '+98 919 581 9203', '۰۹۱۹ ۵۸۱ ۹۲۰۳']) {
    const e = contactEnv({ phone });
    assert.equal(e.contactPhoneIntl(), '989195819203', phone);
    assert.match(e.whatsAppHref(), /^https:\/\/wa\.me\/989195819203\?text=/, phone);
    assert.equal(e.contactTelHref(), 'tel:+989195819203', phone);
  }
  assert.doesNotMatch(appJs, /9195819203/, 'number hard-coded in app.js');
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
  const text = textOf(contactEnv({ form: { city: 'تهران' } }).whatsAppHref());
  for (const v of ['سارا', '9121234567', 'ولیعصر', '1234567890', 'یادداشت']) assert.ok(!text.includes(v), v);
});

test('the text is URL-encoded: nothing raw in the link, and it decodes back exactly', () => {
  const rows = [{ cartKey: 'x', fa: 'ست A&B #۲ ?=% "تست"', heightFa: '', qty: 3 }];
  const e = contactEnv({ rows, form: { city: 'تهران - ونک' } });
  const href = e.whatsAppHref();
  const query = href.split('?text=')[1];
  assert.equal(query, encodeURIComponent(e.contactMessage()));
  assert.match(query, /^[A-Za-z0-9%\-_.!~*'()]+$/, 'only URL-safe characters');
  assert.ok(query.includes('%0A'), 'new lines encoded');
  assert.ok(query.includes('%26') && query.includes('%23'), '& and # encoded');
  assert.equal([...new URL(href).searchParams.keys()].join(), 'text', 'one text parameter only');
  assert.equal(textOf(href), e.contactMessage());
});

test('the box: «ارسال پیام در واتساپ» opening the WhatsApp link in a new tab, Instagram, the contact page, and a tel: line', () => {
  const e = contactEnv();
  const html = e.payByContactHtml();
  assert.match(html, /برای پرداخت کارت به کارت، لطفاً با ما تماس بگیرید یا پیام بدهید/);
  const wa = html.match(/<a class="btn btn-accent" data-wa href="([^"]*)" target="_blank" rel="noopener noreferrer"><svg[^>]*>[\s\S]*?<\/svg>ارسال پیام در واتساپ<\/a>/);
  assert.ok(wa, 'WhatsApp button');
  assert.equal(wa[1].replace(/&amp;/g, '&'), e.whatsAppHref());
  assert.ok(html.includes(`href="${COPY.instagramUrl}"`));
  assert.ok(html.includes('data-nav="#/contact"'));
  assert.match(html, /<p class="pay-contact-call">یا تماس بگیرید: <a class="ltr" href="tel:\+989195819203">۰۹۱۹۵۸۱۹۲۰۳<\/a><\/p>/);
  assert.doesNotMatch(html, /data-act="place-order"/);
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
  const e = contactEnv();
  const link = { href: e.whatsAppHref() };
  const target = { closest: (sel) => (sel === 'a[data-wa]' ? link : null) };
  e.state.form.city = 'اصفهان'; // typed after the render, without a re-render
  e.refreshWhatsAppLink({ target });
  assert.match(textOf(link.href), /شهر: اصفهان/);
  assert.match(textOf(link.href), /جمع: ۲٬۸۵۰٬۰۰۰ تومان/); // the packaging fee is in the total
  e.refreshWhatsAppLink({ target: { closest: () => null } }); // any other click: nothing
  assert.deepEqual(e.calls, []);
  assert.match(appJs, /document\.addEventListener\('pointerdown', refreshWhatsAppLink, true\);/);
  assert.match(appJs, /document\.addEventListener\('click', refreshWhatsAppLink, true\);/);
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
  assert.match(
    checkout,
    /: `<a class="btn btn-accent" data-wa href="\$\{esc\(whatsAppHref\(\)\)\}" target="_blank" rel="noopener noreferrer">\$\{whatsappIcon\(\)\} پیام در واتساپ<\/a>`/,
    'mobile action bar: the same WhatsApp link'
  );
  assert.doesNotMatch(appJs, /\/api\/orders['"`]/);
  assert.doesNotMatch(appJs, /screenDone|go\('done'\)|state\.order\b/);
  assert.deepEqual(PAYMENTS.map((p) => p.id), ['gateway', 'card']);
});
