// Email sender (api/_email.js, used by api/contact.js — the only email the
// site sends; api/orders.js no longer takes orders, so it sends none):
// every email goes out "from" EMAIL_FROM when it is set — Resend refuses
// onboarding@resend.dev (403, testing-domain restriction) for real mail —
// and to ORDER_NOTIFY_EMAIL. fetch is stubbed — no email is really sent.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';

const require = createRequire(import.meta.url);
const email = require('../../api/_email.js');
const contact = require('../../api/contact.js');
const OWN = 'Glow Home <orders@glow-home.ir>';
const TESTING = 'onboarding@resend.dev';

let sent, realFetch, realEnv;
beforeEach(() => {
  sent = [];
  realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    sent.push({ url, body: JSON.parse(opts.body) });
    return { ok: true, text: async () => '' };
  };
  realEnv = { ...process.env };
  process.env.RESEND_API_KEY = 're_test_key';
  process.env.ORDER_NOTIFY_EMAIL = 'shop@example.com';
  process.env.EMAIL_FROM = OWN;
  contact._resetRateLimit();
});
afterEach(() => {
  globalThis.fetch = realFetch;
  process.env = realEnv;
});

function res() {
  return {
    statusCode: 200,
    headers: {},
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    end() { return this; },
  };
}

test('emailFrom: EMAIL_FROM when set, Resend\'s testing sender only when unset or blank', () => {
  assert.equal(email.emailFrom({ EMAIL_FROM: OWN }), OWN);
  assert.equal(email.emailFrom({ EMAIL_FROM: '  ' + OWN + '\n' }), OWN);
  assert.equal(email.emailFrom({}), 'Glow Home <onboarding@resend.dev>');
  assert.equal(email.emailFrom({ EMAIL_FROM: '   ' }), 'Glow Home <onboarding@resend.dev>');
});

test('contact form email: from EMAIL_FROM, to ORDER_NOTIFY_EMAIL', async () => {
  const r = res();
  await contact(
    {
      method: 'POST',
      headers: { origin: 'https://glow-home.ir', 'x-forwarded-for': '5.6.7.8' },
      body: { name: 'سارا', phone: '09121234567', message: 'سلام، یک سوال داشتم.', website: '' },
    },
    r
  );
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].body.from, OWN);
  assert.ok(!sent[0].body.from.includes(TESTING));
  assert.deepEqual(sent[0].body.to, ['shop@example.com']);
});

test('api/orders.js sends no email: it no longer takes orders', () => {
  const src = readFileSync(new URL('../../api/orders.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /_email|sendShopEmail|RESEND_API_KEY|ORDER_NOTIFY_EMAIL/);
});

test('no sender hard-codes onboarding@resend.dev: only the fallback in api/_email.js names it', () => {
  const dirs = [new URL('../../api/', import.meta.url), new URL('../src/', import.meta.url)];
  for (const dir of dirs) {
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.js'))) {
      const src = readFileSync(new URL(f, dir), 'utf8');
      const hits = src.split('\n').filter((l) => l.includes(TESTING));
      if (dir === dirs[0] && f === '_email.js') {
        assert.deepEqual(hits, ["const FALLBACK_FROM = 'Glow Home <onboarding@resend.dev>';"]);
      } else {
        assert.deepEqual(hits, [], f);
      }
      if (f !== '_email.js') assert.doesNotMatch(src, /api\.resend\.com/, f + ' calls Resend directly');
    }
  }
});
