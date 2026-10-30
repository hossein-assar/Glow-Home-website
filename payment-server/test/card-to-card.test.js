// «کارت به کارت» places no order: checkout shows a "contact us" box (phone as
// a tel: link, Instagram, the contact page) instead of the order button,
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

function contactBox(state, online = ONLINE_PAYMENT) {
  return new Function(
    'state', 'COPY', 'ONLINE_PAYMENT',
    `const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
     const icon = (n) => '<svg data-icon="' + n + '"></svg>';
     ${grab(appJs, /const FA_DIGITS = [^\n]*\n/)}
     ${grab(appJs, /const AR_DIGITS = [^\n]*\n/)}
     ${fnSrc('toLatinDigits')}
     ${grab(appJs, /const CARD_TO_CARD_MSG = [^\n]*\n/)}
     ${grab(appJs, /const ONLINE_OFF_MSG = [^\n]*\n/)}
     ${fnSrc('contactTelHref')}
     ${fnSrc('payByContactHtml')}
     return { html: payByContactHtml(), tel: contactTelHref() };`
  )(state, COPY, online);
}

test('«کارت به کارت»: the box asks the customer to contact us, with tap-to-call, Instagram and the contact page', () => {
  const { html, tel } = contactBox({ pay: 'card' });
  assert.equal(COPY.contactPhone, '۰۹۱۹۵۸۱۹۲۰۳'); // the number on the contact page and in the footer
  assert.equal(tel, 'tel:+989195819203');
  assert.match(html, /برای پرداخت کارت به کارت، لطفاً با ما تماس بگیرید یا پیام بدهید/);
  assert.ok(html.includes(`href="tel:+989195819203"`));
  assert.ok(html.includes(COPY.contactPhone), 'the number is shown');
  assert.ok(html.includes(`href="${COPY.instagramUrl}"`));
  assert.ok(html.includes('data-nav="#/contact"'));
  assert.doesNotMatch(html, /data-act="place-order"/);
});

test('with online payment switched off, every option shows the box with its own message', () => {
  for (const pay of ['card', 'gateway']) {
    const { html } = contactBox({ pay }, { enabled: false });
    assert.match(html, /پرداخت آنلاین فعلاً در دسترس نیست/, pay);
    assert.doesNotMatch(html, /data-act="place-order"/, pay);
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
  assert.match(checkout, /: `<a class="btn btn-accent" href="\$\{contactTelHref\(\)\}">/, 'mobile action bar: tap-to-call');
  assert.doesNotMatch(appJs, /\/api\/orders['"`]/);
  assert.doesNotMatch(appJs, /screenDone|go\('done'\)|state\.order\b/);
  assert.deepEqual(PAYMENTS.map((p) => p.id), ['gateway', 'card']);
});
