// api/contact.js (the contact form → email via Resend, same mechanism as the
// new-order email). Validation, escaping, honeypot, CORS, rate limit, and
// that internal errors never reach the client. fetch is stubbed — no email
// is sent.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const contact = require('../../api/contact.js');
const { validateContact, normalizeMobile, escapeHtml, buildEmail, LIMITS, RATE_LIMIT } = contact;

const good = { name: 'سارا', phone: '09121234567', message: 'سلام، آباژور گیسو در رنگ سبز موجود است؟', website: '' };

// ---- validation -------------------------------------------------------------

test('a valid message is accepted and the mobile normalized', () => {
  assert.deepEqual(validateContact(good).value, { name: 'سارا', mobile: '09121234567', message: good.message });
});

test('Iranian mobile shapes all normalize to 09XXXXXXXXX', () => {
  for (const raw of ['09121234567', '+989121234567', '00989121234567', '989121234567', '9121234567', '0912 123 4567', '0912-123-4567']) {
    assert.equal(normalizeMobile(raw), '09121234567', raw);
  }
  for (const raw of ['', '0912123456', '091212345678', '02112345678', '08121234567', '+18005551234', 'abc', '09121234567x']) {
    assert.equal(normalizeMobile(raw), null, raw);
  }
});

test('invalid input is rejected with a Persian error', () => {
  const err = (over) => validateContact({ ...good, ...over }).error;
  assert.equal(err({ name: '' }), 'نام را وارد کنید.');
  assert.equal(err({ name: '   ' }), 'نام را وارد کنید.');
  assert.ok(err({ name: 'x'.repeat(LIMITS.name + 1) }));
  assert.equal(err({ phone: '' }), 'شماره موبایل را وارد کنید.');
  assert.equal(err({ phone: '۰۹۱۲۱۲۳۴۵۶۷' }), 'لطفاً شماره موبایل را با اعداد انگلیسی وارد کنید.');
  assert.match(err({ phone: '02112345678' }), /معتبر نیست/); // landline is not a mobile
  assert.equal(err({ message: 'سلام' }), 'متن پیام را بنویسید.'); // under the minimum
  assert.ok(err({ message: 'x'.repeat(LIMITS.message + 1) }));
  assert.equal(validateContact({ ...good, message: 'x'.repeat(LIMITS.message) }).error, undefined);
  // wrong types / shapes
  for (const body of [null, [], 'text', { ...good, name: { $ne: 1 } }, { ...good, phone: 9121234567 }, { ...good, message: ['a'] }]) {
    assert.equal(validateContact(body).error, 'درخواست نامعتبر است.');
  }
});

test('a filled honeypot is flagged as spam', () => {
  assert.deepEqual(validateContact({ ...good, website: 'http://spam.example' }), { spam: true });
});

// ---- escaping ---------------------------------------------------------------

test('escapeHtml escapes every HTML-significant character', () => {
  assert.equal(escapeHtml(`<script>alert("x")</script> & 'y'`), '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;y&#39;');
});

test('the email escapes the name and message, and has the right subject', () => {
  const v = validateContact({
    ...good,
    name: '<img src=x onerror=alert(1)>',
    message: '<a href="http://evil">click</a>\n<b>bold</b> & "quotes"',
  }).value;
  const { subject, html } = buildEmail(v);
  assert.equal(subject, 'پیام جدید از فرم تماس');
  assert.ok(!html.includes('<img'), 'raw <img> in email');
  assert.ok(!html.includes('<a href'), 'raw <a> in email');
  assert.ok(!html.includes('<b>bold'), 'raw <b> in email');
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(html.includes('&lt;a href=&quot;http://evil&quot;&gt;click&lt;/a&gt;'));
  assert.ok(html.includes('09121234567'));
});

// ---- the handler ------------------------------------------------------------

let sent, fetchImpl, realFetch, realEnv, logged, realConsoleError;

beforeEach(() => {
  contact._resetRateLimit();
  sent = [];
  fetchImpl = async (url, opts) => {
    sent.push({ url, body: JSON.parse(opts.body), headers: opts.headers });
    return { ok: true, text: async () => '' };
  };
  realFetch = globalThis.fetch;
  globalThis.fetch = (...a) => fetchImpl(...a);
  realEnv = { ...process.env };
  process.env.RESEND_API_KEY = 're_test_secret_key';
  process.env.ORDER_NOTIFY_EMAIL = 'shop@example.com';
  logged = [];
  realConsoleError = console.error;
  console.error = (...a) => logged.push(a.map(String).join(' '));
});
afterEach(() => {
  globalThis.fetch = realFetch;
  process.env = realEnv;
  console.error = realConsoleError;
});

async function call({ method = 'POST', origin = 'https://glow-home.ir', body = good, ip = '1.2.3.4' } = {}) {
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    end() { return this; },
  };
  const headers = { 'x-forwarded-for': ip + ', 10.0.0.1' };
  if (origin) headers.origin = origin;
  await contact({ method, headers, body }, res);
  return res;
}

test('valid POST sends one email to ORDER_NOTIFY_EMAIL via Resend', async () => {
  const res = await call();
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.equal(res.headers['access-control-allow-origin'], 'https://glow-home.ir');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, 'https://api.resend.com/emails');
  assert.equal(sent[0].headers.Authorization, 'Bearer re_test_secret_key');
  assert.deepEqual(sent[0].body.to, ['shop@example.com']);
  assert.equal(sent[0].body.from, 'Glow Home <onboarding@resend.dev>'); // same sender as order emails
  assert.equal(sent[0].body.subject, 'پیام جدید از فرم تماس');
  assert.ok(sent[0].body.html.includes('سارا'));
  assert.ok(sent[0].body.html.includes('09121234567'));
});

test('sender is the same as in api/orders.js', () => {
  const orders = readFileSync(new URL('../../api/orders.js', import.meta.url), 'utf8');
  assert.ok(orders.includes("from: 'Glow Home <onboarding@resend.dev>'"));
  assert.ok(orders.includes('process.env.ORDER_NOTIFY_EMAIL'));
});

test('strict CORS: other or missing origins are refused, nothing sent', async () => {
  for (const origin of ['https://evil.example', 'https://www.glow-home.ir', 'http://glow-home.ir', 'https://glow-home.ir.evil.example', null]) {
    const res = await call({ origin });
    assert.equal(res.statusCode, 403, String(origin));
    assert.equal(res.headers['access-control-allow-origin'], undefined);
  }
  assert.equal(sent.length, 0);
});

test('POST only (OPTIONS preflight answered for the allowed origin)', async () => {
  for (const method of ['GET', 'PUT', 'DELETE']) {
    const res = await call({ method });
    assert.equal(res.statusCode, 405, method);
    assert.equal(res.headers.allow, 'POST');
  }
  const pre = await call({ method: 'OPTIONS' });
  assert.equal(pre.statusCode, 204);
  assert.equal(sent.length, 0);
});

test('validation errors are 400 and send nothing', async () => {
  const res = await call({ body: { ...good, phone: '123' } });
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /موبایل/);
  const notJson = await call({ body: '{nope' });
  assert.equal(notJson.statusCode, 400);
  assert.equal(sent.length, 0);
});

test('honeypot: looks successful to the bot, but no email is sent', async () => {
  const res = await call({ body: { ...good, website: 'spam' } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.equal(sent.length, 0);
});

test('per-IP rate limit', async () => {
  for (let i = 0; i < RATE_LIMIT.max; i++) assert.equal((await call()).statusCode, 200);
  const limited = await call();
  assert.equal(limited.statusCode, 429);
  assert.match(limited.body.error, /چند دقیقه بعد/);
  assert.equal((await call({ ip: '5.6.7.8' })).statusCode, 200); // another IP is unaffected
  assert.equal(sent.length, RATE_LIMIT.max + 1);
});

test('missing env vars or a Resend failure → generic Persian error, no internals leaked', async () => {
  delete process.env.RESEND_API_KEY;
  const noKey = await call();
  assert.equal(noKey.statusCode, 502);
  assert.equal(sent.length, 0);

  process.env.RESEND_API_KEY = 're_test_secret_key';
  fetchImpl = async () => ({ ok: false, status: 403, text: async () => 'domain not verified re_test_secret_key' });
  const failed = await call({ ip: '9.9.9.9' });
  assert.equal(failed.statusCode, 502);

  fetchImpl = async () => { throw new Error('getaddrinfo ENOTFOUND api.resend.com'); };
  const down = await call({ ip: '8.8.8.8' });
  assert.equal(down.statusCode, 502);

  for (const r of [noKey, failed, down]) {
    assert.deepEqual(Object.keys(r.body).sort(), ['error', 'ok']);
    assert.equal(r.body.ok, false);
    assert.match(r.body.error, /ارسال پیام با خطا مواجه شد/);
    for (const secret of ['RESEND', 're_test', 'Resend', 'ENOTFOUND', '403', 'domain']) {
      assert.ok(!r.body.error.includes(secret), secret);
    }
  }
  assert.equal(logged.length, 3); // details go to the server log only
});

test('the page (app.js) uses the same mobile rule and limits as the server', () => {
  const src = readFileSync(new URL('../../app.js', import.meta.url), 'utf8');
  const fn = src.match(/function contactMobile\([\s\S]*?\n}\n/)[0];
  const contactMobile = new Function(fn + 'return contactMobile;')();
  for (const raw of ['09121234567', '+989121234567', '00989121234567', '9121234567', '0912 123 4567', '02112345678', '0912123456', 'abc', '']) {
    assert.equal(contactMobile(raw), normalizeMobile(raw), raw);
  }
  assert.ok(src.includes(`const CONTACT_NAME_MAX = ${LIMITS.name};`));
  assert.ok(src.includes(`const CONTACT_MSG_MIN = ${LIMITS.messageMin};`));
  assert.ok(src.includes(`const CONTACT_MSG_MAX = ${LIMITS.message};`));
});
