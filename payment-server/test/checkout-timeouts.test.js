// Production bug (VPS): POST /api/checkout hung with no response and no log
// line for gisoo::h140::sembroidered + shade-embroidered-cylinder::h50. With
// the live rows the handler itself answers in milliseconds; the hang was an
// outbound call (Supabase) that never answered — supabase-js has no timeout
// and the route had no overall one, so nginx gave up at 60 s in silence.
// These tests run the real Express app: the exact cart prices correctly, and
// a hanging or failing Supabase / ZarinPal always ends in a logged
// «checkout.failed» with the step name and a Persian JSON error.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createApp, DEFAULT_TIMEOUTS } from '../src/app.js';
import { createDb, fetchWithTimeout, SUPABASE_TIMEOUT_MS } from '../src/db.js';
import { ZarinpalError } from '../src/zarinpal.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

// The live rows (read through glow-home.ir/sb on 2026-10-25).
const LIVE = [
  {
    id: '86b6c44d-3acc-4c40-b598-c38f07a395d6', slug: 'gisoo', name_fa: 'گیسو', price: 9100000, height_cm: 100, colors: [], in_stock: true,
    variants: [
      { price: 12980000, height: 140, shades: { plain: 12980000, embroidered: 15450000 } },
      { price: 9980000, height: 120, shades: { plain: 9980000, embroidered: 12480000 } },
      { price: 9100000, height: 100, shades: { plain: 9100000, embroidered: 11600000 } },
    ],
  },
  {
    id: 'c3af5198-8ec4-4e82-917a-8300610c54c3', slug: 'shade-embroidered-cylinder', name_fa: 'شید گلدوزی مهتاب',
    price: 3500000, height_cm: 40, variants: [{ price: 4000000, height: 50 }], colors: [], in_stock: true,
  },
];

const GENERIC = 'خطایی رخ داد. لطفاً دوباره تلاش کنید.';
const customer = { name: 'سارا تستی', phone: '+989121234567', city: 'تهران', address: 'خیابان ولیعصر، کوچه ۱۲، پلاک ۳', postcode: '' };
const CART = [{ cartKey: 'gisoo::h140::sembroidered', qty: 1 }, { cartKey: 'shade-embroidered-cylinder::h50', qty: 1 }];
const never = () => new Promise(() => {});
const FAST = { stepMs: 60, requestMs: 400 };

const servers = [];
after(() => servers.forEach((s) => s.close()));

/** The real app with an in-memory DB and ZarinPal; `over` replaces methods. */
async function start({ db: dbOver = {}, zp: zpOver = {}, timeouts = FAST } = {}) {
  const orders = [];
  const calls = [];
  const logs = [];
  const db = {
    async fetchProductsBySlugs(slugs) { calls.push('fetch_products'); return LIVE.filter((p) => slugs.includes(p.slug)); },
    async nextOrderCode() { calls.push('order_code'); return 'GH-1016'; },
    async createOrder(o, items) { calls.push('create_order'); const row = { id: 'o1', ...o, items }; orders.push(row); return { id: row.id, code: row.code }; },
    async setAuthority(id, a) { calls.push('save_authority'); orders[0].payment_authority = a; },
    async markFailed(id, reason) { calls.push('mark_failed'); Object.assign(orders.find((o) => o.id === id) || {}, { status: 'payment_failed', payment_error: reason }); },
    async findOrderByAuthority(a) { calls.push('find_order'); return orders.find((o) => o.payment_authority === a) || null; },
    async markPaid() { calls.push('mark_paid'); return 'paid'; },
    ...dbOver,
  };
  const zarinpal = {
    startPayUrl: (a) => `https://payment.zarinpal.com/pg/StartPay/${a}`,
    async requestPayment(args) { calls.push('zarinpal_request'); zarinpal.last = args; return 'A' + '0'.repeat(35); },
    async verifyPayment() { calls.push('zarinpal_verify'); return { code: 100, refId: '201', cardPan: null }; },
    ...zpOver,
  };
  const app = createApp({
    config: { publicSiteUrl: 'https://glow-home.ir', callbackUrl: 'https://pay.glow-home.ir/api/verify', zarinpal: { mode: 'production' } },
    db, zarinpal, timeouts, logger: (...l) => logs.push(l),
  });
  const server = app.listen(0, '127.0.0.1');
  servers.push(server);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const checkout = async (items = CART) => {
    const t0 = Date.now();
    const res = await fetch(base + '/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://glow-home.ir' },
      body: JSON.stringify({ customer, items, discount_code: null }),
      signal: AbortSignal.timeout(5000), // the test fails here if the server hangs
    });
    return { status: res.status, json: await res.json(), ms: Date.now() - t0 };
  };
  const verify = async (q) => {
    const res = await fetch(base + '/api/verify?' + q, { redirect: 'manual', signal: AbortSignal.timeout(5000) });
    return { status: res.status, location: res.headers.get('location') };
  };
  const event = (name) => logs.filter((l) => l[1] === name).map((l) => l[2]);
  return { checkout, verify, orders, calls, logs, event, zarinpal };
}

// ---- the exact cart ---------------------------------------------------------------

test('the exact production cart (live rows): 194,500,000 Rial, order created, logged', async () => {
  const s = await start();
  const r = await s.checkout();
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.code, 'GH-1016');
  assert.equal(s.orders[0].total, 15450000 + 4000000);
  assert.equal(s.orders[0].payment_amount_rial, 194500000);
  assert.equal(s.zarinpal.last.amount, 194500000);
  assert.deepEqual(s.orders[0].items.map((i) => [i.name_fa, i.unit_price]), [
    ['گیسو (140 سانتی‌متر) — شید گلدوزی', 15450000],
    ['شید گلدوزی مهتاب (50 سانتی‌متر)', 4000000],
  ]);
  assert.deepEqual(s.event('checkout.received'), [{ items: ['gisoo::h140::sembroidered', 'shade-embroidered-cylinder::h50'] }]);
  assert.equal(s.event('checkout.created').length, 1);
  assert.deepEqual(s.event('checkout.failed'), []);
});

test('each line of that cart alone, and «مهتاب» at its base size', async () => {
  for (const [items, total] of [
    [[CART[0]], 15450000],
    [[CART[1]], 4000000],
    [[{ cartKey: 'shade-embroidered-cylinder::h40', qty: 1 }], 3500000],
    [[{ cartKey: 'shade-embroidered-cylinder', qty: 2 }], 7000000],
  ]) {
    const s = await start();
    const r = await s.checkout(items);
    assert.equal(r.status, 200, JSON.stringify(items));
    assert.equal(s.orders[0].total, total);
  }
});

test('checkout logs never contain the customer name, phone or address', async () => {
  const s = await start({ db: { fetchProductsBySlugs: never } });
  await s.checkout();
  const all = JSON.stringify(s.logs);
  for (const secret of [customer.name, '9121234567', 'ولیعصر']) assert.ok(!all.includes(secret), secret);
});

// ---- hanging / failing outbound calls ---------------------------------------------

for (const step of ['fetch_products', 'order_code', 'create_order', 'save_authority']) {
  const method = { fetch_products: 'fetchProductsBySlugs', order_code: 'nextOrderCode', create_order: 'createOrder', save_authority: 'setAuthority' }[step];
  test(`a hanging Supabase call (${step}) → 502 Persian error within the step limit, logged with the step`, async () => {
    const s = await start({ db: { [method]: never } });
    const r = await s.checkout();
    assert.equal(r.status, 502);
    assert.deepEqual(r.json, { ok: false, error: GENERIC });
    assert.ok(r.ms < FAST.requestMs, `took ${r.ms} ms`);
    const [failed] = s.event('checkout.failed');
    assert.equal(failed.step, step);
    assert.equal(failed.error, 'StepTimeoutError');
    assert.match(failed.message, new RegExp(`${step} did not answer within ${FAST.stepMs} ms`));
    assert.equal(s.event('checkout.created').length, 0);
    if (step === 'save_authority') {
      // the order exists: it is marked failed, not left waiting
      await new Promise((r2) => setTimeout(r2, 20));
      assert.equal(s.orders[0].status, 'payment_failed');
      assert.equal(s.orders[0].payment_error, 'checkout failed at save_authority');
    }
  });
}

test('a hanging ZarinPal request → 502, logged, order marked payment_failed', async () => {
  const s = await start({ zp: { requestPayment: never } });
  const r = await s.checkout();
  assert.equal(r.status, 502);
  assert.deepEqual(r.json, { ok: false, error: GENERIC });
  const [failed] = s.event('checkout.failed');
  assert.equal(failed.step, 'zarinpal_request');
  assert.equal(failed.order, 'GH-1016');
  await new Promise((r2) => setTimeout(r2, 20));
  assert.equal(s.orders[0].status, 'payment_failed');
  assert.ok(!s.calls.includes('save_authority'));
});

test('a ZarinPal error keeps its own message and payment_error, and is logged as checkout.failed too', async () => {
  const s = await start({ zp: { requestPayment: async () => { throw new ZarinpalError(-10, 'terminal not valid'); } } });
  const r = await s.checkout();
  assert.equal(r.status, 502);
  assert.equal(r.json.error, 'اتصال به درگاه پرداخت برقرار نشد. لطفاً چند دقیقه بعد دوباره تلاش کنید.');
  assert.equal(s.event('zarinpal.request_failed').length, 1);
  assert.equal(s.event('checkout.failed')[0].step, 'zarinpal_request');
  await new Promise((r2) => setTimeout(r2, 20));
  assert.equal(s.orders[0].payment_error, 'request -10');
});

test('a failing Supabase call (e.g. "fetch failed") → 502 with checkout.failed, not a silent hang', async () => {
  const s = await start({ db: { fetchProductsBySlugs: async () => { throw new TypeError('fetch products: TypeError: fetch failed'); } } });
  const r = await s.checkout();
  assert.equal(r.status, 502);
  assert.deepEqual(r.json, { ok: false, error: GENERIC });
  assert.deepEqual(s.event('checkout.failed'), [{ step: 'fetch_products', order: null, error: 'TypeError', message: 'fetch products: TypeError: fetch failed' }]);
  assert.equal(s.event('unhandled').length, 0);
});

test('a bug in our own code (bad product row) → 500, logged under the local step', async () => {
  const s = await start({ db: { fetchProductsBySlugs: async () => [null] } });
  const r = await s.checkout();
  assert.equal(r.status, 500);
  assert.deepEqual(r.json, { ok: false, error: GENERIC });
  assert.equal(s.event('checkout.failed')[0].step, 'price');
});

test('the whole checkout stops at requestMs even when every step is just slow; later steps never run', async () => {
  const slow = (ms, value) => () => new Promise((r) => setTimeout(() => r(value), ms));
  const s = await start({
    timeouts: { stepMs: 300, requestMs: 250 },
    db: { fetchProductsBySlugs: slow(150, LIVE), nextOrderCode: slow(150, 'GH-1016') },
  });
  const r = await s.checkout();
  assert.equal(r.status, 502);
  assert.ok(r.ms < 400, `took ${r.ms} ms`);
  const [failed] = s.event('checkout.failed');
  assert.equal(failed.step, 'order_code');
  assert.match(failed.message, /checkout did not answer within 250 ms/);
  await new Promise((r2) => setTimeout(r2, 200)); // let the slow step finish
  assert.ok(!s.calls.includes('create_order'), 'continued after the timeout');
  assert.equal(s.event('checkout.failed').length, 1);
});

test('production limits: 10 s per outbound call, 25 s per request', () => {
  assert.deepEqual(DEFAULT_TIMEOUTS, { stepMs: 10000, requestMs: 25000 });
  assert.equal(SUPABASE_TIMEOUT_MS, 10000);
  assert.match(read('../src/zarinpal.js'), /const TIMEOUT_MS = 10000;/);
  // server.js uses the defaults (no override)
  assert.doesNotMatch(read('../src/server.js'), /timeouts/);
});

// ---- verify --------------------------------------------------------------------------

test('verify: a hanging DB lookup redirects to the failed page and is logged', async () => {
  const s = await start({ db: { findOrderByAuthority: never } });
  const r = await s.verify('Authority=A' + '0'.repeat(35) + '&Status=OK');
  assert.equal(r.status, 303);
  assert.equal(r.location, 'https://glow-home.ir/#/payment/-/failed');
  assert.equal(s.event('verify.failed')[0].step, 'find_order');
});

test('verify: a hanging ZarinPal verify leaves the order pending (a retry can still verify it)', async () => {
  const s = await start({ zp: { verifyPayment: never } });
  await s.checkout();
  const r = await s.verify('Authority=A' + '0'.repeat(35) + '&Status=OK');
  assert.equal(r.location, 'https://glow-home.ir/#/payment/GH-1016/failed');
  assert.equal(s.event('verify.failed')[0].step, 'zarinpal_verify');
  assert.equal(s.orders[0].status, 'pending_payment');
  assert.ok(!s.calls.includes('mark_failed'));
});

// ---- the real Supabase client ------------------------------------------------------

test('fetchWithTimeout aborts a request that never answers, and keeps the caller\'s own signal', async () => {
  const hanging = (url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
  const t0 = Date.now();
  await assert.rejects(fetchWithTimeout(hanging, 50)('https://x'), { name: 'TimeoutError' });
  assert.ok(Date.now() - t0 < 500);
  const caller = new AbortController();
  const p = fetchWithTimeout(hanging, 5000)('https://x', { signal: caller.signal });
  caller.abort();
  await assert.rejects(p, { name: 'AbortError' });
});

test('createDb: a Supabase server that never answers makes fetchProductsBySlugs fail fast instead of hanging', async () => {
  const seen = [];
  const hanging = (url, { signal }) => {
    seen.push(String(url));
    return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
  };
  const db = createDb({ supabaseUrl: 'https://glow-home.ir/sb', serviceRoleKey: 'test-key', fetchImpl: hanging, timeoutMs: 50, retryDelayMs: 10 });
  const t0 = Date.now();
  await assert.rejects(db.fetchProductsBySlugs(['gisoo']), /fetch products/);
  assert.ok(Date.now() - t0 < 1000);
  // supabase-js's own retries are off; ours tries a read exactly twice (db-retry.test.js)
  assert.equal(seen.length, 2);
  assert.match(seen[0], /^https:\/\/glow-home\.ir\/sb\/rest\/v1\/products\?select=id%2Cslug%2Cname_fa%2Cprice%2Cheight_cm%2Cvariants%2Ccolors%2Cin_stock&slug=in\.%28gisoo%29$/);
});

// ---- storefront -----------------------------------------------------------------------

test('storefront: the gateway request gives up after 30 s with a Persian message, and the button comes back', () => {
  const app = read('../../app.js');
  const fn = app.match(/function startOnlinePayment\([\s\S]*?\n}\n/)[0];
  assert.match(app, /const CHECKOUT_TIMEOUT_MS = 30000;/);
  assert.match(app, /'پاسخی از درگاه پرداخت دریافت نشد\. هیچ مبلغی از حساب شما کسر نشده است\. لطفاً دوباره تلاش کنید\.'/);
  assert.match(fn, /setTimeout\(\(\) => ctrl\.abort\(\), CHECKOUT_TIMEOUT_MS\)/);
  assert.match(fn, /signal: ctrl\.signal,/);
  assert.match(fn, /\.catch\(\(\) => fail\(ctrl\.signal\.aborted \? GATEWAY_TIMEOUT : GATEWAY_FAIL\)\)/);
  // fail() re-enables «پرداخت آنلاین» (placingOrder = false) and shows the message
  assert.match(app, /function fail\(msg\) \{\n    state\.error = msg;\n    state\.placingOrder = false;\n    render\(\);/);
});

test('storefront: a timed-out gateway request really ends in fail() with the timeout message', async () => {
  const app = read('../../app.js');
  const src = [
    app.match(/const CHECKOUT_TIMEOUT_MS = [^\n]*\n/)[0].replace('30000', '30'),
    app.match(/const GATEWAY_TIMEOUT =\n[^\n]*\n/)[0],
    app.match(/function startOnlinePayment\([\s\S]*?\n}\n/)[0],
    'return startOnlinePayment;',
  ].join('');
  const fetchHang = (url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
  const start = new Function('fetch', 'ONLINE_PAYMENT', 'GATEWAY_FAIL', 'ZARINPAL_STARTPAY', 'location', src)(
    fetchHang, { apiUrl: 'https://pay.glow-home.ir' }, 'GATEWAY_FAIL', /x/, {}
  );
  const msg = await new Promise((resolve) => start({}, resolve));
  assert.equal(msg, 'پاسخی از درگاه پرداخت دریافت نشد. هیچ مبلغی از حساب شما کسر نشده است. لطفاً دوباره تلاش کنید.');
});
