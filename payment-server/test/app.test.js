// Runs the real Express routes against an in-memory DB (mirroring the
// semantics of supabase/migration-online-payment.sql) and a fake ZarinPal.
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from '../src/app.js';
import { ZarinpalError, describeCode } from '../src/zarinpal.js';

const config = {
  publicSiteUrl: 'https://glow-home.ir',
  publicApiUrl: 'https://pay.example.ir',
  callbackUrl: 'https://pay.example.ir/api/verify',
  zarinpal: { mode: 'sandbox' },
};

let orders, items, seq, zp, logs;

function fakeDb() {
  return {
    async fetchProductsBySlugs(slugs) {
      return [
        { id: 'p1', slug: 'lamp-a', name_fa: 'آباژور الف', price: 1000000, variants: [], colors: [], in_stock: true },
        {
          id: 'g1', slug: 'gisoo', name_fa: 'گیسو', price: 9100000, colors: [], in_stock: true,
          variants: [{ height: 140, price: 12980000, shades: { plain: 12980000, embroidered: 15450000 } }],
        },
      ].filter((p) => slugs.includes(p.slug));
    },
    async nextOrderCode() { return 'GH-' + seq++; },
    async createOrder(o, its) {
      const row = { id: 'id-' + o.code, paid_at: null, payment_authority: null, ...o };
      orders.push(row);
      items.push(...its.map((i) => ({ ...i, order_id: row.id })));
      return { id: row.id, code: row.code };
    },
    async setAuthority(id, a) {
      const o = orders.find((x) => x.id === id && x.status === 'pending_payment');
      if (!o) throw new Error('not pending');
      o.payment_authority = a;
    },
    async findOrderByAuthority(a) { return orders.find((o) => o.payment_authority === a) || null; },
    async markFailed(id, reason) {
      const o = orders.find((x) => x.id === id && x.status === 'pending_payment');
      if (o) Object.assign(o, { status: 'payment_failed', payment_error: reason });
    },
    async markPaid({ authority, refId, cardPan }) {
      const o = orders.find((x) => x.payment_authority === authority);
      if (!o) return 'not_found';
      if (o.paid_at) return 'already_paid';
      if (!['pending_payment', 'payment_failed'].includes(o.status)) return 'invalid_status';
      Object.assign(o, { status: 'paid', payment_ref_id: refId, payment_card_pan: cardPan, paid_at: new Date() });
      return 'paid';
    },
  };
}

function fakeZarinpal() {
  const z = {
    calls: { request: [], verify: [] },
    requestFails: null,
    verifyResult: () => ({ code: z.verified ? 101 : 100, refId: '201', cardPan: '502229******5995' }),
    verified: false,
    startPayUrl: (a) => `https://sandbox.zarinpal.com/pg/StartPay/${a}`,
    async requestPayment(args) {
      z.calls.request.push(args);
      if (z.requestFails != null) throw new ZarinpalError(z.requestFails, describeCode(z.requestFails));
      return 'S' + String(z.calls.request.length).padStart(35, '0');
    },
    async verifyPayment(args) {
      z.calls.verify.push(args);
      const r = z.verifyResult(args);
      if (r instanceof ZarinpalError) throw r;
      z.verified = true;
      return r;
    },
  };
  return z;
}

let server, base;
beforeEach(async () => {
  orders = []; items = []; seq = 1000; logs = [];
  zp = fakeZarinpal();
  if (server) server.close();
  const app = createApp({ config, db: fakeDb(), zarinpal: zp, logger: (...a) => logs.push(a) });
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server && server.close());

const goodBody = {
  customer: { name: 'سارا', phone: '+989121234567', city: 'تهران', address: 'خیابان ولیعصر، کوچه ۱۲، پلاک ۳', postcode: '' },
  items: [{ cartKey: 'lamp-a', qty: 2, price: 1 }], // client price must be ignored
  discount_code: 'GLOW10',
};
const checkout = (body = goodBody, headers = {}) =>
  fetch(base + '/api/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://glow-home.ir', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
const verify = (qs) => fetch(base + '/api/verify?' + qs, { redirect: 'manual' });

test('health', async () => {
  assert.deepEqual(await (await fetch(base + '/health')).json(), { ok: true });
});

test('checkout re-prices, creates pending_payment order, returns StartPay url (Rial)', async () => {
  const res = await checkout();
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://glow-home.ir');
  assert.equal(json.url, 'https://sandbox.zarinpal.com/pg/StartPay/S' + '1'.padStart(35, '0'));
  assert.equal(orders[0].status, 'pending_payment');
  assert.equal(orders[0].total, 1800000); // 2 × 1,000,000 − 10%, shipping not charged
  assert.equal(orders[0].payment_amount_rial, 18000000);
  assert.equal(zp.calls.request[0].amount, 18000000);
  assert.equal(zp.calls.request[0].callbackUrl, 'https://pay.example.ir/api/verify');
  assert.equal(orders[0].payment_authority, 'S' + '1'.padStart(35, '0'));
});

test('checkout sends config.callbackUrl to ZarinPal (CALLBACK_URL set)', async () => {
  server.close();
  const app = createApp({
    config: { ...config, callbackUrl: 'https://glow-home.ir/api/pay-callback' },
    db: fakeDb(),
    zarinpal: zp,
    logger: () => {},
  });
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await checkout()).status, 200);
  assert.equal(zp.calls.request[0].callbackUrl, 'https://glow-home.ir/api/pay-callback');
});

test('gisoo: tampered client price ignored, shade price from DB charged in Rial; old key rejected', async () => {
  const body = { ...goodBody, discount_code: '', items: [{ cartKey: 'gisoo::h140::sembroidered', qty: 1, price: 1000 }] };
  const res = await checkout(body);
  assert.equal(res.status, 200);
  assert.equal(orders[0].total, 15450000);
  assert.equal(orders[0].payment_amount_rial, 154500000);
  assert.equal(zp.calls.request[0].amount, 154500000);
  assert.equal(items[0].unit_price, 15450000);
  assert.equal(items[0].name_fa, 'گیسو (140 سانتی‌متر) — شید گلدوزی');

  const old = await checkout({ ...body, items: [{ cartKey: 'gisoo::h140', qty: 1 }] });
  assert.equal(old.status, 400);
  assert.match((await old.json()).error, /نوع شید «گیسو»/);
  assert.equal(orders.length, 1);
});

test('CORS: www allowed, other origins get no allow-origin header', async () => {
  const www = await checkout(goodBody, { Origin: 'https://www.glow-home.ir' });
  assert.equal(www.headers.get('access-control-allow-origin'), 'https://www.glow-home.ir');
  const evil = await checkout(goodBody, { Origin: 'https://evil.example' });
  assert.equal(evil.headers.get('access-control-allow-origin'), null);
  const pre = await fetch(base + '/api/checkout', { method: 'OPTIONS', headers: { Origin: 'https://glow-home.ir', 'Access-Control-Request-Method': 'POST' } });
  assert.equal(pre.status, 204);
});

test('checkout validation errors and malformed / oversized bodies are 400 without internals', async () => {
  const bad = await checkout({ ...goodBody, items: [{ cartKey: 'missing', qty: 1 }] });
  assert.equal(bad.status, 400);
  const notJson = await checkout('{nope');
  assert.equal(notJson.status, 400);
  assert.deepEqual(await notJson.json(), { ok: false, error: 'درخواست نامعتبر است.' });
  const big = await checkout(JSON.stringify({ ...goodBody, note: 'x'.repeat(20000) }));
  assert.equal(big.status, 413);
  assert.equal(orders.length, 0);
});

test('ZarinPal request failure → 502 generic error, order marked payment_failed', async () => {
  zp.requestFails = -10;
  const res = await checkout();
  assert.equal(res.status, 502);
  const json = await res.json();
  assert.ok(!JSON.stringify(json).includes('-10'));
  assert.equal(orders[0].status, 'payment_failed');
  assert.equal(orders[0].payment_error, 'request -10');
});

test('checkout is rate limited (10 per 10 min)', async () => {
  for (let i = 0; i < 10; i++) await checkout({});
  assert.equal((await checkout({})).status, 429);
});

async function createdAuthority() {
  await checkout();
  return orders[0].payment_authority;
}

test('verify OK → paid, then repeated callback is idempotent', async () => {
  const a = await createdAuthority();
  const r1 = await verify(`Authority=${a}&Status=OK`);
  assert.equal(r1.status, 303);
  assert.equal(r1.headers.get('location'), 'https://glow-home.ir/#/payment/GH-1000/ok');
  assert.equal(orders[0].status, 'paid');
  assert.equal(orders[0].payment_ref_id, '201');
  assert.equal(orders[0].payment_card_pan, '502229******5995');
  assert.equal(zp.calls.verify[0].amount, 18000000); // stored total, in Rial
  const paidAt = orders[0].paid_at;

  const r2 = await verify(`Authority=${a}&Status=OK`);
  assert.equal(r2.headers.get('location'), 'https://glow-home.ir/#/payment/GH-1000/ok');
  assert.equal(orders[0].paid_at, paidAt);
  assert.equal(zp.calls.verify.length, 1); // already paid → ZarinPal not called again
});

test('verify NOK → payment_failed; cannot undo a paid order', async () => {
  const a = await createdAuthority();
  const r = await verify(`Authority=${a}&Status=NOK`);
  assert.equal(r.headers.get('location'), 'https://glow-home.ir/#/payment/GH-1000/failed');
  assert.equal(orders[0].status, 'payment_failed');
  assert.equal(zp.calls.verify.length, 0);

  // Same authority later confirmed OK by ZarinPal still wins.
  await verify(`Authority=${a}&Status=OK`);
  assert.equal(orders[0].status, 'paid');
  await verify(`Authority=${a}&Status=NOK`);
  assert.equal(orders[0].status, 'paid');
});

test('verify -50 (amount mismatch at ZarinPal) → payment_failed', async () => {
  const a = await createdAuthority();
  zp.verifyResult = () => new ZarinpalError(-50, describeCode(-50));
  const r = await verify(`Authority=${a}&Status=OK`);
  assert.equal(r.headers.get('location'), 'https://glow-home.ir/#/payment/GH-1000/failed');
  assert.equal(orders[0].status, 'payment_failed');
  assert.equal(orders[0].payment_error, 'verify -50');
});

test('order total changed after request → not verified, failed', async () => {
  const a = await createdAuthority();
  orders[0].total = 10;
  await verify(`Authority=${a}&Status=OK`);
  assert.equal(zp.calls.verify.length, 0);
  assert.equal(orders[0].status, 'payment_failed');
});

test('transient verify error keeps pending_payment so a retry can succeed', async () => {
  const a = await createdAuthority();
  zp.verifyResult = () => new ZarinpalError('network', 'timeout');
  await verify(`Authority=${a}&Status=OK`);
  assert.equal(orders[0].status, 'pending_payment');
  zp.verifyResult = () => ({ code: 100, refId: '202', cardPan: null });
  await verify(`Authority=${a}&Status=OK`);
  assert.equal(orders[0].status, 'paid');
});

test('unknown / malformed authority and order id in URL are ignored', async () => {
  await createdAuthority();
  const r1 = await verify('Authority=S000000000000000000000000000000009999&Status=OK&order=GH-1000');
  assert.equal(r1.headers.get('location'), 'https://glow-home.ir/#/payment/-/failed');
  const r2 = await verify("Authority=' or 1=1--&Status=OK");
  assert.equal(r2.headers.get('location'), 'https://glow-home.ir/#/payment/-/failed');
  const r3 = await verify('Authority=a&Authority=b&Status=OK');
  assert.equal(r3.headers.get('location'), 'https://glow-home.ir/#/payment/-/failed');
  assert.equal(orders[0].status, 'pending_payment');
  assert.equal(zp.calls.verify.length, 0);
});

test('cancelled order with verified money is not marked paid and is logged', async () => {
  const a = await createdAuthority();
  orders[0].status = 'cancelled';
  await verify(`Authority=${a}&Status=OK`);
  assert.equal(orders[0].status, 'cancelled');
  assert.ok(logs.some((l) => l[1] === 'verify.unexpected_status'));
});

test('logs never contain merchant id, service key, phone or address', async () => {
  const a = await createdAuthority();
  await verify(`Authority=${a}&Status=OK`);
  const all = JSON.stringify(logs);
  assert.ok(!all.includes('09121234567'));
  assert.ok(!all.includes('ولیعصر'));
});
