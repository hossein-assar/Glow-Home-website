// The VPS reaches Supabase through glow-home.ir/sb (direct calls to
// supabase.co stalled). Calls that are safe to repeat get one more try after
// 500 ms, inside the 10 s step limit; createOrder is never repeated. The
// server.started log names the Supabase route (host/path, no secrets), and
// /health/deep times one tiny read while /health stays instant.
// Runs the real createDb (supabase-js) against a fake fetch, and the real app.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createDb, retryOnce, ATTEMPT_MS, RETRY_DELAY_MS, SUPABASE_TIMEOUT_MS } from '../src/db.js';
import { createApp, DEFAULT_TIMEOUTS, DEEP_HEALTH } from '../src/app.js';
import { startupLogFields } from '../src/config.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

// ---- a fake Supabase (PostgREST) behind fetch -------------------------------------

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/**
 * plan: { 'GET products': ['hang', 'ok'], ... } — what each successive call to
 * that route does. 'hang' never answers (until aborted), 'fail' is a network
 * error, 'ok' answers with ok[route].
 */
function fakeSupabase(plan, ok) {
  const calls = [];
  const fetchImpl = async (url, { method = 'GET', signal } = {}) => {
    const path = new URL(url).pathname.replace(/^\/sb\/rest\/v1\//, '');
    const route = `${method} ${path}`;
    const n = calls.filter((c) => c === route).length;
    calls.push(route);
    const step = (plan[route] || [])[n] || 'ok';
    if (step === 'hang') {
      return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
    }
    if (step === 'fail') throw new TypeError('fetch failed');
    if (!(route in ok)) throw new Error('unexpected ' + route);
    return json(ok[route]);
  };
  return { fetchImpl, calls };
}

const OK = {
  'GET products': [{ id: 'p1', slug: 'gisoo' }],
  'GET orders': { id: 'o1', code: 'GH-1016', status: 'pending_payment', total: 1, payment_amount_rial: 10, paid_at: null },
  'PATCH orders': [{ id: 'o1' }],
  'POST rpc/nextval_order_code': 1017,
  'POST orders': { id: 'o1', code: 'GH-1017' },
  'POST order_items': null,
};

const FAST = { attemptMs: 40, retryDelayMs: 10 };
const db = (plan) => {
  const fake = fakeSupabase(plan, OK);
  return { ...fake, db: createDb({ supabaseUrl: 'https://glow-home.ir/sb', serviceRoleKey: 'test-key', fetchImpl: fake.fetchImpl, ...FAST }) };
};

test('the retry fits inside the 10 s step limit: 4.5 s + 0.5 s + 4.5 s', () => {
  assert.equal(ATTEMPT_MS, 4500);
  assert.equal(RETRY_DELAY_MS, 500);
  assert.ok(ATTEMPT_MS * 2 + RETRY_DELAY_MS < DEFAULT_TIMEOUTS.stepMs);
  assert.ok(ATTEMPT_MS < SUPABASE_TIMEOUT_MS);
  assert.deepEqual(DEFAULT_TIMEOUTS, { stepMs: 10000, requestMs: 25000 });
});

test('retryOnce: a second try after the delay, each with its own time limit', async () => {
  const signals = [];
  let n = 0;
  const t0 = Date.now();
  const r = await retryOnce(async (signal) => {
    signals.push(signal);
    if (++n === 1) throw new Error('first');
    return 'second';
  }, { attemptMs: 1000, delayMs: 30 });
  assert.equal(r, 'second');
  assert.equal(signals.length, 2);
  assert.notEqual(signals[0], signals[1]);
  assert.ok(Date.now() - t0 >= 30);
  await assert.rejects(retryOnce(async () => { throw new Error('always'); }, { attemptMs: 1000, delayMs: 1 }), /always/);
});

for (const first of ['hang', 'fail']) {
  test(`fetch_products: a first try that ${first === 'hang' ? 'stalls' : 'fails'} is retried once and succeeds`, async () => {
    const { db: d, calls } = db({ 'GET products': [first, 'ok'] });
    assert.deepEqual(await d.fetchProductsBySlugs(['gisoo']), OK['GET products']);
    assert.deepEqual(calls, ['GET products', 'GET products']);
  });
}

test('fetch_products: two stalled tries fail after attempt + delay + attempt, not later', async () => {
  const { db: d, calls } = db({ 'GET products': ['hang', 'hang'] });
  const t0 = Date.now();
  await assert.rejects(d.fetchProductsBySlugs(['gisoo']), /fetch products/);
  assert.equal(calls.length, 2);
  assert.ok(Date.now() - t0 < 500, `${Date.now() - t0} ms`);
});

test('find_order is retried once', async () => {
  const { db: d, calls } = db({ 'GET orders': ['fail', 'ok'] });
  assert.equal((await d.findOrderByAuthority('A1')).code, 'GH-1016');
  assert.deepEqual(calls, ['GET orders', 'GET orders']);
});

test('save_authority is retried once (same value on the same pending order: harmless twice)', async () => {
  const { db: d, calls } = db({ 'PATCH orders': ['hang', 'ok'] });
  await d.setAuthority('o1', 'A1');
  assert.deepEqual(calls, ['PATCH orders', 'PATCH orders']);
});

test('order_code is retried once (a sequence never repeats a number); after two failures, the fallback code', async () => {
  let { db: d, calls } = db({ 'POST rpc/nextval_order_code': ['hang', 'ok'] });
  assert.equal(await d.nextOrderCode(), 'GH-1017');
  assert.deepEqual(calls, ['POST rpc/nextval_order_code', 'POST rpc/nextval_order_code']);

  ({ db: d, calls } = db({ 'POST rpc/nextval_order_code': ['fail', 'fail'] }));
  assert.match(await d.nextOrderCode(), /^GH-[0-9A-Z]+$/);
  assert.equal(calls.length, 2);
});

test('create_order is NEVER retried: a lost answer must not become a second order', async () => {
  for (const first of ['hang', 'fail']) {
    const { db: d, calls } = db({ 'POST orders': [first, 'ok'] });
    await assert.rejects(d.createOrder({ code: 'GH-1017' }, [{ name_fa: 'x', qty: 1, unit_price: 1 }]), /insert order/);
    assert.deepEqual(calls, ['POST orders'], first);
  }
  // and it still works normally
  const { db: d, calls } = db({});
  assert.deepEqual(await d.createOrder({ code: 'GH-1017' }, [{ name_fa: 'x', qty: 1, unit_price: 1 }]), { id: 'o1', code: 'GH-1017' });
  assert.deepEqual(calls, ['POST orders', 'POST order_items']);
});

test('ping is a single small read with no retry', async () => {
  const { db: d, calls } = db({ 'GET products': ['fail'] });
  await assert.rejects(d.ping(AbortSignal.timeout(1000)), /ping/);
  assert.deepEqual(calls, ['GET products']);
});

// ---- startup log -------------------------------------------------------------------

const SECRET_KEY = 'sb_secret_THIS-MUST-NOT-BE-LOGGED';
const MERCHANT = '12345678-90ab-cdef-1234-567890abcdef';
const cfg = (supabaseUrl) => ({
  supabaseUrl,
  supabaseServiceRoleKey: SECRET_KEY,
  zarinpal: { mode: 'production', baseUrl: 'https://payment.zarinpal.com', merchantId: MERCHANT },
  publicSiteUrl: 'https://glow-home.ir',
  publicApiUrl: 'https://pay.glow-home.ir',
  callbackUrl: 'https://glow-home.ir/api/pay-callback',
  port: 3000,
});

test('server.started names the Supabase route — host and path only, never a key', () => {
  const viaProxy = startupLogFields(cfg('https://glow-home.ir/sb'));
  assert.deepEqual(viaProxy, {
    port: 3000,
    supabase_host: 'glow-home.ir',
    supabase_path: '/sb',
    zarinpal_mode: 'production',
    callback_url: 'https://glow-home.ir/api/pay-callback',
  });
  const direct = startupLogFields(cfg('https://sgfoesnpodvwyzlxfhtq.supabase.co'));
  assert.equal(direct.supabase_host, 'sgfoesnpodvwyzlxfhtq.supabase.co');
  assert.equal(direct.supabase_path, '/');
  for (const fields of [viaProxy, direct]) {
    const line = JSON.stringify(fields);
    assert.ok(!line.includes(SECRET_KEY));
    assert.ok(!line.includes(MERCHANT));
  }
  // server.js logs exactly these fields
  assert.match(read('../src/server.js'), /log\('info', 'server\.started', startupLogFields\(config\)\);/);
});

// ---- /health and /health/deep ---------------------------------------------------------

const servers = [];
after(() => servers.forEach((s) => s.close()));

async function app(ping) {
  const logs = [];
  let pings = 0;
  const a = createApp({
    config: { publicSiteUrl: 'https://glow-home.ir', callbackUrl: 'x', zarinpal: { mode: 'sandbox' } },
    db: { ping: (signal) => { pings++; return ping(signal); } },
    zarinpal: {},
    logger: (...l) => logs.push(l),
    deepHealth: { slowMs: 40, timeoutMs: 120 },
  });
  const server = a.listen(0, '127.0.0.1');
  servers.push(server);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async (path) => {
    const res = await fetch(base + path, { signal: AbortSignal.timeout(3000) });
    return { status: res.status, body: await res.json() };
  };
  return { get, logs, pings: () => pings };
}

test('/health stays instant and never touches Supabase', async () => {
  const a = await app(() => new Promise(() => {}));
  assert.deepEqual(await a.get('/health'), { status: 200, body: { ok: true } });
  assert.equal(a.pings(), 0);
});

test('/health/deep: ok, slow and failed, with the time in ms', async () => {
  const fast = await app(async () => {});
  const r1 = await fast.get('/health/deep');
  assert.equal(r1.status, 200);
  assert.equal(r1.body.ok, true);
  assert.equal(r1.body.supabase, 'ok');
  assert.ok(Number.isInteger(r1.body.ms));

  const slow = await app(() => new Promise((r) => setTimeout(r, 60)));
  const r2 = await slow.get('/health/deep');
  assert.equal(r2.status, 200);
  assert.equal(r2.body.supabase, 'slow');
  assert.ok(r2.body.ms >= 40);

  const failing = await app(async () => { throw new Error('ping: permission denied for table products'); });
  const r3 = await failing.get('/health/deep');
  assert.equal(r3.status, 503);
  assert.deepEqual(Object.keys(r3.body), ['ok', 'supabase', 'ms']);
  assert.equal(r3.body.supabase, 'failed');
  assert.equal(failing.logs[0][1], 'health.supabase_failed');
  assert.match(failing.logs[0][2].message, /permission denied/); // detail in the log only
});

test('/health/deep: a stalled Supabase answers "failed" at the timeout, not never', async () => {
  const hung = await app((signal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason))));
  const t0 = Date.now();
  const r = await hung.get('/health/deep');
  assert.equal(r.status, 503);
  assert.equal(r.body.supabase, 'failed');
  assert.ok(Date.now() - t0 < 1000);
});

test('/health/deep production thresholds and rate limit', async () => {
  assert.deepEqual(DEEP_HEALTH, { slowMs: 1500, timeoutMs: 5000 });
  const a = await app(async () => {});
  let last;
  for (let i = 0; i < 11; i++) last = await a.get('/health/deep');
  assert.equal(last.status, 429);
  assert.equal(a.pings(), 10);
});
