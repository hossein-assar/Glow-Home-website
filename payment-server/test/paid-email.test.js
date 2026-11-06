// The paid-order email (src/email.js): sent once, at the first transition to
// paid, through the real /api/verify route; never for a failed or cancelled
// payment; a send failure never changes the payment or the redirect. Resend
// is a stubbed fetch — no test touches the network.
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createApp } from '../src/app.js';
import { ZarinpalError, describeCode } from '../src/zarinpal.js';
import {
  createPaidNotifier,
  emailFrom,
  FALLBACK_FROM,
  missingEmailVars,
  paidOrderHtml,
  paidOrderSubject,
  RESEND_URL,
  sendShopEmail,
} from '../src/email.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const config = {
  publicSiteUrl: 'https://glow-home.ir',
  publicApiUrl: 'https://pay.example.ir',
  callbackUrl: 'https://pay.example.ir/api/verify',
  zarinpal: { mode: 'sandbox' },
};
const ENV = { RESEND_API_KEY: 're_secret_key_123', ORDER_NOTIFY_EMAIL: 'sahar@example.com', EMAIL_FROM: 'Glow Home <orders@glow-home.ir>' };
const AUTH = 'S' + '7'.padStart(35, '0');
const CARD = '502229******5995';

// One pending online order, already sent to ZarinPal. The in-memory markPaid
// mirrors mark_order_paid(): 'paid' only for the call that sets paid_at.
let order, orderItems, zp, logs, sends, fetchStub, server, base, notifier;

function fakeDb() {
  return {
    async findOrderByAuthority(a) { return order.payment_authority === a ? { ...order } : null; },
    async markFailed(id, reason) {
      if (order.id === id && order.status === 'pending_payment') Object.assign(order, { status: 'payment_failed', payment_error: reason });
    },
    async markPaid({ authority, refId, cardPan }) {
      if (order.payment_authority !== authority) return 'not_found';
      if (order.paid_at) return 'already_paid';
      if (!['pending_payment', 'payment_failed'].includes(order.status)) return 'invalid_status';
      Object.assign(order, { status: 'paid', payment_ref_id: refId, payment_card_pan: cardPan, paid_at: '2026-11-01T09:32:00Z' });
      return 'paid';
    },
    // like db.js: never selects the card number
    async fetchOrderForEmail(id) {
      assert.equal(id, order.id);
      const { payment_card_pan, payment_authority, payment_amount_rial, status, ...shown } = order; // eslint-disable-line no-unused-vars
      return { order: shown, items: orderItems.map((i) => ({ ...i })) };
    },
  };
}

function fakeZarinpal() {
  const z = {
    verifyCalls: 0,
    result: () => ({ code: z.verifyCalls > 1 ? 101 : 100, refId: '50123456789', cardPan: CARD }),
    async verifyPayment() {
      z.verifyCalls++;
      const r = z.result();
      if (r instanceof ZarinpalError) throw r;
      return r;
    },
  };
  return z;
}

async function start({ env = ENV, notifyPaid } = {}) {
  if (server) server.close();
  const db = fakeDb();
  notifier = createPaidNotifier({ db, logger: (...a) => logs.push(a), env, fetchImpl: (...a) => fetchStub(...a) });
  const app = createApp({ config, db, zarinpal: zp, notifyPaid: notifyPaid || notifier, logger: (...a) => logs.push(a) });
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
}

beforeEach(async () => {
  order = {
    id: 'id-GH-1003', code: 'GH-1003', status: 'pending_payment', paid_at: null,
    customer_name: 'سارا محمدی', phone: '09121234567', city: 'کرج', postcode: '3134567890',
    address: 'عظیمیه، خیابان مهران، کوچه ۴، پلاک ۱۲', note: 'لطفاً قبل از ارسال هماهنگ شود',
    shipping_method: 'tipax', shipping_cost: 0, total: 7850000,
    payment_authority: AUTH, payment_amount_rial: 78500000, payment_ref_id: null, payment_card_pan: null,
  };
  orderItems = [
    { product_id: 'p-gisoo', name_fa: 'گیسو (۱۲۰ سانتی‌متر) — شید گلدوزی', qty: 1, unit_price: 4200000 },
    { product_id: 'p-lale', name_fa: 'لاله', qty: 2, unit_price: 1700000 },
    { product_id: null, name_fa: 'هزینه بسته‌بندی', qty: 1, unit_price: 250000 },
  ];
  zp = fakeZarinpal();
  logs = [];
  sends = [];
  fetchStub = async (url, init) => {
    sends.push({ url, init, body: JSON.parse(init.body) });
    return new Response('{"id":"x"}', { status: 200 });
  };
  await start();
});
after(() => server && server.close());

const verify = (status = 'OK') => fetch(`${base}/api/verify?Authority=${AUTH}&Status=${status}`, { redirect: 'manual' });
const okUrl = 'https://glow-home.ir/#/payment/GH-1003/ok';
const failedUrl = 'https://glow-home.ir/#/payment/GH-1003/failed';
const emailLogs = () => logs.filter(([, event]) => String(event).startsWith('email.'));

// ---- exactly once ----------------------------------------------------------------

test('email: sent once at the first paid transition — never again on a repeated callback or a refresh', async () => {
  const r1 = await verify();
  assert.equal(r1.status, 303);
  assert.equal(r1.headers.get('location'), okUrl);
  await notifier.idle();
  assert.equal(order.status, 'paid');
  assert.equal(sends.length, 1);
  const { url, init, body } = sends[0];
  assert.equal(url, RESEND_URL);
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.Authorization, 'Bearer ' + ENV.RESEND_API_KEY);
  assert.equal(body.from, 'Glow Home <orders@glow-home.ir>');
  assert.deepEqual(body.to, ['sahar@example.com']);
  assert.equal(body.subject, 'سفارش جدید پرداخت‌شده — GH-1003');
  assert.deepEqual(emailLogs(), [['info', 'email.paid_sent', { order: 'GH-1003' }]]);

  for (let i = 0; i < 3; i++) {
    const r = await verify();
    assert.equal(r.headers.get('location'), okUrl);
  }
  await notifier.idle();
  assert.equal(sends.length, 1, 'a repeat, a refresh or a retry never sends a second email');
});

test('email: two callbacks at the same moment still send one email (the DB result decides, not a flag)', async () => {
  const [a, b] = await Promise.all([verify(), verify()]);
  assert.equal(a.headers.get('location'), okUrl);
  assert.equal(b.headers.get('location'), okUrl);
  await notifier.idle();
  assert.equal(sends.length, 1);
});

test('email: the guard is the markPaid result — "already_paid" (row changed elsewhere) sends nothing', async () => {
  // e.g. a second server instance or a concurrent call won the row lock
  order.paid_at = null;
  const db = fakeDb();
  db.markPaid = async () => 'already_paid';
  const app = createApp({ config, db, zarinpal: zp, notifyPaid: notifier, logger: () => {} });
  server.close();
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await verify()).headers.get('location'), okUrl);
  await notifier.idle();
  assert.equal(sends.length, 0);
  // and in the source: only marked === 'paid' notifies, no in-memory flag
  const app_ = read('../src/app.js');
  assert.match(app_, /if \(marked === 'paid'\) \{\s*try \{\s*Promise\.resolve\(notifyPaid\(order\.id, order\.code\)\)\.catch\(\(\) => \{\}\);/);
  assert.equal((app_.match(/notifyPaid\(order\.id/g) || []).length, 1, 'one call site');
});

// ---- never for failed or cancelled payments ---------------------------------------

test('email: none for a cancelled payment (Status=NOK)', async () => {
  assert.equal((await verify('NOK')).headers.get('location'), failedUrl);
  await notifier.idle();
  assert.equal(order.status, 'payment_failed');
  assert.equal(sends.length, 0);
});

test('email: none for a failed verify (-50), an unverifiable amount, or an order cancelled meanwhile', async () => {
  zp.result = () => new ZarinpalError(-50, describeCode(-50));
  assert.equal((await verify()).headers.get('location'), failedUrl);

  await start();
  order = { ...order, status: 'pending_payment', payment_amount_rial: 1 };
  assert.equal((await verify()).headers.get('location'), failedUrl);

  await start();
  order = { ...order, status: 'cancelled', payment_amount_rial: 78500000 };
  assert.equal((await verify()).headers.get('location'), failedUrl);

  await notifier.idle();
  assert.equal(sends.length, 0);
});

test('email: a transient verify error sends nothing; the later successful retry sends exactly one', async () => {
  zp.result = () => new ZarinpalError('network', 'timeout');
  assert.equal((await verify()).headers.get('location'), failedUrl);
  await notifier.idle();
  assert.equal(sends.length, 0);
  assert.equal(order.status, 'pending_payment');
  zp.result = () => ({ code: 100, refId: '50123456789', cardPan: CARD });
  assert.equal((await verify()).headers.get('location'), okUrl);
  await notifier.idle();
  assert.equal(sends.length, 1);
});

// ---- a failure never touches the payment ------------------------------------------

for (const [what, stub] of [
  ['Resend answers 500', async () => new Response('{"message":"boom sahar@example.com"}', { status: 500 })],
  ['Resend refuses (403)', async () => new Response('{"message":"domain not verified"}', { status: 403 })],
  ['fetch throws (network down)', async () => { throw new TypeError('fetch failed'); }],
]) {
  test(`email: ${what} — still paid, still the success redirect, one log line without secrets or body`, async () => {
    fetchStub = stub;
    const r = await verify();
    assert.equal(r.status, 303);
    assert.equal(r.headers.get('location'), okUrl);
    await notifier.idle();
    assert.equal(order.status, 'paid');
    assert.equal(order.payment_ref_id, '50123456789');
    const lines = emailLogs();
    assert.equal(lines.length, 1);
    const [level, event, fields] = lines[0];
    assert.equal(level, 'error');
    assert.equal(event, 'email.paid_failed');
    assert.equal(fields.order, 'GH-1003');
    const text = JSON.stringify(lines[0]);
    for (const secret of [ENV.RESEND_API_KEY, ENV.ORDER_NOTIFY_EMAIL, 'سارا', '0912', 'عظیمیه', 'boom', 'domain not verified']) {
      assert.ok(!text.includes(secret), 'logged: ' + secret);
    }
  });
}

test('email: a notifier that throws, rejects or never answers can\'t change or delay the payment', async () => {
  for (const notifyPaid of [
    () => { throw new Error('sync bug'); },
    () => Promise.reject(new Error('async bug')),
    () => new Promise(() => {}), // hangs forever
  ]) {
    order = { ...order, status: 'pending_payment', paid_at: null };
    zp = fakeZarinpal();
    await start({ notifyPaid });
    const t0 = Date.now();
    const r = await verify();
    assert.equal(r.status, 303);
    assert.equal(r.headers.get('location'), okUrl);
    assert.ok(Date.now() - t0 < 1000, 'not delayed');
    assert.equal(order.status, 'paid');
  }
});

test('email: a Resend call that hangs doesn\'t delay the redirect, and gives up after its timeout', async () => {
  fetchStub = (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
  const db = fakeDb();
  notifier = createPaidNotifier({ db, logger: (...a) => logs.push(a), env: ENV, fetchImpl: (...a) => fetchStub(...a), timeoutMs: 50 });
  server.close();
  const app = createApp({ config, db, zarinpal: zp, notifyPaid: notifier, logger: (...a) => logs.push(a) });
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
  const t0 = Date.now();
  assert.equal((await verify()).headers.get('location'), okUrl);
  assert.ok(Date.now() - t0 < 1000);
  await notifier.idle();
  assert.equal(emailLogs()[0][1], 'email.paid_failed');
  assert.equal(emailLogs()[0][2].error, 'TimeoutError');
});

test('email: the order read failing is logged once and nothing else happens', async () => {
  const db = fakeDb();
  db.fetchOrderForEmail = async () => { throw new Error('fetch order for email: timeout'); };
  const n = createPaidNotifier({ db, logger: (...a) => logs.push(a), env: ENV, fetchImpl: (...a) => fetchStub(...a) });
  await n('id-GH-1003', 'GH-1003');
  assert.equal(sends.length, 0);
  assert.deepEqual(emailLogs(), [['error', 'email.paid_failed', { order: 'GH-1003', error: 'Error', message: 'fetch order for email: timeout' }]]);
});

// ---- not configured: skip silently ---------------------------------------------

test('email: RESEND_API_KEY or ORDER_NOTIFY_EMAIL missing → no send, no log line, payment unaffected', async () => {
  for (const env of [{ ...ENV, RESEND_API_KEY: '' }, { ...ENV, ORDER_NOTIFY_EMAIL: undefined }, {}]) {
    order = { ...order, status: 'pending_payment', paid_at: null };
    zp = fakeZarinpal();
    logs = [];
    await start({ env });
    assert.equal((await verify()).headers.get('location'), okUrl);
    await notifier.idle();
    assert.equal(order.status, 'paid');
    assert.equal(sends.length, 0);
    assert.deepEqual(emailLogs(), []);
  }
  assert.deepEqual(missingEmailVars({}), ['RESEND_API_KEY', 'ORDER_NOTIFY_EMAIL']);
  assert.deepEqual(missingEmailVars(ENV), []);
});

test('email: server.js logs the missing names once at startup (never values) and wires the notifier', () => {
  const src = read('../src/server.js');
  assert.match(src, /if \(!emailConfigured\(\)\) log\('info', 'email\.disabled', \{ missing: missingEmailVars\(\) \}\);/);
  assert.match(src, /notifyPaid: createPaidNotifier\(\{ db, logger: log \}\)/);
});

test('email: sender rules copied from api/_email.js — EMAIL_FROM, else the Resend testing sender', async () => {
  assert.equal(emailFrom({ EMAIL_FROM: '  Glow Home <orders@glow-home.ir> ' }), 'Glow Home <orders@glow-home.ir>');
  assert.equal(emailFrom({ EMAIL_FROM: '   ' }), FALLBACK_FROM);
  assert.equal(emailFrom({}), FALLBACK_FROM);
  assert.ok(read('../../api/_email.js').includes(`const FALLBACK_FROM = '${FALLBACK_FROM}';`), 'same fallback as api/_email.js');
  let sent;
  await sendShopEmail({ subject: 's', html: 'h' }, { env: { ...ENV, EMAIL_FROM: '' }, fetchImpl: async (u, i) => { sent = JSON.parse(i.body); return new Response('', { status: 200 }); } });
  assert.equal(sent.from, FALLBACK_FROM);
  await assert.rejects(sendShopEmail({ subject: 's', html: 'h' }, { env: {}, fetchImpl: () => assert.fail('no fetch') }), /not set/);
  // the error names the status only: never the key or Resend's reply
  const err = await sendShopEmail({ subject: 's', html: 'h' }, { env: ENV, fetchImpl: async () => new Response('secret reply re_secret_key_123', { status: 422 }) }).catch((e) => e);
  assert.equal(err.message, 'Resend API responded 422');
  // built-in fetch only: no new dependency
  assert.deepEqual(Object.keys(JSON.parse(read('../package.json')).dependencies).sort(), ['@supabase/supabase-js', 'cors', 'express', 'express-rate-limit', 'helmet']);
});

// ---- the email content -----------------------------------------------------------

const PAID = {
  code: 'GH-1003', customer_name: 'سارا محمدی', phone: '09121234567', city: 'کرج', postcode: '3134567890',
  address: 'عظیمیه، خیابان مهران', note: 'لطفاً هماهنگ شود', shipping_method: 'tipax', total: 7850000,
  paid_at: '2026-11-01T09:32:00Z', payment_ref_id: '50123456789',
};
const fa = (n) => new Intl.NumberFormat('fa-IR').format(n);

test('email body: Persian RTL with every order field, items with options, packaging fee, total, tracking code, admin print line', async () => {
  await verify();
  await notifier.idle();
  const html = sends[0].body.html;
  assert.match(html, /<html lang="fa" dir="rtl">/);
  assert.match(html, /<div dir="rtl" style="direction:rtl;text-align:right;/);
  for (const part of [
    'GH-1003', 'سارا محمدی', '09121234567', 'عظیمیه، خیابان مهران، کوچه ۴، پلاک ۱۲', 'کرج', '3134567890',
    'لطفاً قبل از ارسال هماهنگ شود', 'روش ارسال:', '<b>تیپاکس</b>',
    'گیسو (۱۲۰ سانتی‌متر) — شید گلدوزی', 'لاله', `${fa(1700000)} تومان`, `${fa(3400000)} تومان`, `>${fa(2)}<`,
    'هزینه بسته‌بندی', `${fa(250000)} تومان`, 'مبلغ پرداخت‌شده', `${fa(7850000)} تومان`, 'کد پیگیری:', '50123456789',
    'glow-home.ir/admin', '(سفارش‌ها ← چاپ سفارش)',
  ]) assert.ok(html.includes(part), 'missing: ' + part);
  // date and time in Persian digits, Tehran time (09:32Z = 13:02)
  assert.ok(html.includes('۱۴۰۵/۰۸/۱۰، ساعت ۱۳:۰۲'), 'date/time');
  assert.equal(paidOrderHtml({ ...PAID, shipping_method: 'peyk' }).includes('<b>پیک تهران</b>'), true);
});

test('email body: no card number, no shop phone, no «تماس بگیرید», no courier fee amount', async () => {
  order.shipping_cost = 90000;
  order.shipping_method = 'peyk';
  await verify();
  await notifier.idle();
  const html = sends[0].body.html;
  assert.equal(order.payment_card_pan, CARD, 'the card number is stored…');
  for (const bad of ['502229', '5995', '******', 'payment_card_pan']) assert.ok(!html.includes(bad), '…but never in the email: ' + bad);
  assert.ok(!html.includes('تماس بگیرید'));
  assert.ok(!html.includes(fa(90000)), 'no courier fee');
  assert.ok(!html.includes('پس‌کرایه'));
  // the only phone number is the customer's
  const shop = JSON.parse(JSON.stringify(read('../../data.js').match(/contactWhatsapp:\s*'([^']+)'/)[1])).replace(/\D/g, '').slice(-10);
  assert.ok(!html.replace(/[۰-۹]/g, (d) => d.charCodeAt(0) - 0x6f0).includes(shop), 'no shop number');
  assert.equal((html.match(/09\d{9}/g) || []).length, 1);
  // and the email read never selects it
  const fn = read('../src/db.js').match(/async fetchOrderForEmail\([\s\S]*?\n    \},\n/)[0];
  assert.doesNotMatch(fn, /card|\*/);
});

test('email body: name, address, note, item names and the code are escaped — <script>, quotes and tags never pass through', () => {
  const evil = {
    ...PAID,
    code: 'GH-1<b>',
    customer_name: '<script>alert(1)</script>',
    address: '"><img src=x onerror=alert(1)> \'q\'',
    note: '<b>bold</b> & "quotes" </div>',
    city: '<u>c</u>',
    phone: '0912"><svg onload=1>',
    postcode: '<i>1</i>',
    payment_ref_id: '<x>',
    shipping_method: '<tipax>',
  };
  const html = paidOrderHtml(evil, [{ product_id: 'p', name_fa: '<img src=y onerror=alert(2)>', qty: 1, unit_price: 1 }, { product_id: null, name_fa: '<fee>', qty: 1, unit_price: 1 }]);
  for (const raw of ['<script', '<img', '<svg', '<u>', '<b>bold', '<i>', '<x>', '<fee>', '<tipax>', 'GH-1<b>', '"><img', '"><svg', "'q'"]) {
    assert.ok(!html.includes(raw), 'raw: ' + raw);
  }
  for (const esc of ['&lt;script&gt;alert(1)&lt;/script&gt;', '&quot;&gt;&lt;img src=x onerror=alert(1)&gt; &#39;q&#39;', '&lt;b&gt;bold&lt;/b&gt; &amp; &quot;quotes&quot; &lt;/div&gt;', '&lt;img src=y onerror=alert(2)&gt;', 'GH-1&lt;b&gt;']) {
    assert.ok(html.includes(esc), 'escaped: ' + esc);
  }
});

test('email body: no note → no note line; no postcode → no postcode line; no fee → no fee line', () => {
  const html = paidOrderHtml({ ...PAID, note: '', postcode: null }, [{ product_id: 'p', name_fa: 'لاله', qty: 1, unit_price: 7850000 }]);
  assert.ok(!html.includes('توضیحات مشتری'));
  assert.ok(!html.includes('کد پستی'));
  assert.ok(!html.includes('هزینه بسته‌بندی'));
});

test('email subject: «سفارش جدید پرداخت‌شده — <code>» with the real code', () => {
  assert.equal(paidOrderSubject({ code: 'GH-1003' }), 'سفارش جدید پرداخت‌شده — GH-1003');
  assert.equal(paidOrderSubject({ code: 'GH-2417' }), 'سفارش جدید پرداخت‌شده — GH-2417');
});

test('test-email script: same builder and sender, clearly marked TEST, never touches the database', () => {
  const src = read('../scripts/send-test-email.js');
  assert.match(src, /from '\.\.\/src\/email\.js'/);
  assert.match(src, /paidOrderHtml\(order, items, \{ banner:/);
  assert.match(src, /sendShopEmail\(/);
  assert.match(src, /subject: `\[آزمایشی\] سفارش جدید پرداخت‌شده — \$\{order\.code\}`/);
  assert.match(src, /code: 'TEST-0000'/);
  const imports = src.match(/^import .*$/gm);
  assert.deepEqual(imports.map((l) => l.match(/from '([^']+)'/)[1]), ['node:fs', 'node:url', '../src/email.js'], 'only email.js — no db.js, no Supabase, no app');
  assert.doesNotMatch(src.replace(/^\/\/.*$/gm, ''), /supabase|createDb|createApp|fetchOrderForEmail|markPaid/i);
  // it prints no secret value
  assert.doesNotMatch(src, /console\.\w+\([^)]*process\.env/);
});
