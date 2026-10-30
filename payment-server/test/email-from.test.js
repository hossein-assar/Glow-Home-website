// Email sender (api/_email.js, used by api/contact.js and api/orders.js):
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
// api/orders.js needs @supabase/supabase-js, which is not installed at the
// site root here: run its real email function, pulled out of the source text,
// with the real shared sender.
const ordersSrc = readFileSync(new URL('../../api/orders.js', import.meta.url), 'utf8');
const fnSrc = (re) => {
  const m = ordersSrc.match(re);
  assert.ok(m, 'not found in api/orders.js: ' + re);
  return m[0];
};
const orders = new Function(
  'emailConfigured', 'sendShopEmail',
  [
    fnSrc(/function escapeHtml\([\s\S]*?\n}\n/),
    fnSrc(/function toman\([\s\S]*?\n}\n/),
    fnSrc(/async function sendOrderNotificationEmail\([\s\S]*?\n}\n/),
    'return { sendOrderNotificationEmail };',
  ].join('\n')
)(email.emailConfigured, email.sendShopEmail);

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

test('new-order email: from EMAIL_FROM, to ORDER_NOTIFY_EMAIL', async () => {
  const order = { code: 'GH-1001', customer_name: 'سارا', phone: '09121234567', city: 'تهران', address: 'خیابان ۱', total: 100000 };
  await orders.sendOrderNotificationEmail(order, [{ name_fa: 'لاله', qty: 1, unit_price: 100000 }]);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, 'https://api.resend.com/emails');
  assert.equal(sent[0].body.from, OWN);
  assert.ok(!sent[0].body.from.includes(TESTING));
  assert.deepEqual(sent[0].body.to, ['shop@example.com']);
  assert.equal(sent[0].body.subject, 'سفارش جدید — GH-1001');
});

test('new-order email is skipped quietly when the key or recipient is missing', async () => {
  for (const name of ['RESEND_API_KEY', 'ORDER_NOTIFY_EMAIL']) {
    const saved = process.env[name];
    delete process.env[name];
    await orders.sendOrderNotificationEmail({ code: 'GH-1', total: 0 }, []);
    process.env[name] = saved;
  }
  assert.equal(sent.length, 0);
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
