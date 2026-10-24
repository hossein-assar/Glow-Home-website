// Checkout is guest-only (app.js, a browser script): the old demo «ورود»
// step accepted any four digits and never sent a text message, so it was
// removed. Nothing may bring back a code check that could block an order.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../../app.js', import.meta.url), 'utf8');
const grab = (re) => {
  const m = src.match(re);
  assert.ok(m, 'not found in app.js: ' + re);
  return m[0];
};

test('no OTP / login code is left in app.js', () => {
  for (const re of [/otp/i, /state\.auth\b/, /\bauth:/, /data-act="auth"/, /send-otp/, /کد تأیید/, /ورود با شماره موبایل/, /نسخه‌ی نمایشی/]) {
    assert.doesNotMatch(src, re);
  }
});

test('placeOrder does not check a code: only field validation can stop it', () => {
  const placeOrder = grab(/function placeOrder\(\) \{[\s\S]*?\n}\n/);
  assert.doesNotMatch(placeOrder, /otp|auth|کد تأیید/i);
  assert.match(placeOrder, /\n  state\.error = '';\n\n  if \(hasFieldError \|\| state\.error\)/);
});

test('checkout starts with «نشانی تحویل»', () => {
  const steps = [...src.matchAll(/<section class="checkout-step">\s*<h3>([^<]+)<\/h3>/g)].map((m) => m[1]);
  assert.deepEqual(steps, ['نشانی تحویل', 'روش ارسال', 'روش پرداخت']);
});
