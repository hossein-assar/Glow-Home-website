// Tests the shop's Vercel function api/pay-callback.js (CommonJS, outside
// this package) with a minimal fake req/res — no Vercel runtime needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const handler = createRequire(import.meta.url)('../../api/pay-callback.js');

function call(method, url) {
  const res = {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(b = '') { this.body = b; this.ended = true; },
  };
  handler({ method, url }, res);
  assert.ok(res.ended, 'response must be ended');
  return res;
}

const AUTH = 'A000000000000000000000000000012345678';

test('valid OK → 303 to the exact fixed verify URL', () => {
  const r = call('GET', `/api/pay-callback?Authority=${AUTH}&Status=OK`);
  assert.equal(r.statusCode, 303);
  assert.equal(r.headers.location, `https://pay.glow-home.ir/api/verify?Authority=${AUTH}&Status=OK`);
  assert.equal(r.headers['cache-control'], 'no-store');
});

test('valid NOK and sandbox-style authority pass through', () => {
  const r = call('GET', '/api/pay-callback?Status=NOK&Authority=S00000000000000000000000000000zjegpr');
  assert.equal(r.statusCode, 303);
  assert.equal(r.headers.location, 'https://pay.glow-home.ir/api/verify?Authority=S00000000000000000000000000000zjegpr&Status=NOK');
});

test('extra parameters are dropped, destination never changes', () => {
  const r = call(
    'GET',
    `/api/pay-callback?Authority=${AUTH}&Status=OK&redirect=https://evil.example&next=//evil.example&url=x&order=GH-1`
  );
  assert.equal(r.statusCode, 303);
  assert.equal(r.headers.location, `https://pay.glow-home.ir/api/verify?Authority=${AUTH}&Status=OK`);
  assert.ok(new URL(r.headers.location).host === 'pay.glow-home.ir');
});

test('bad input → 400, no Location header', () => {
  const bad = [
    '/api/pay-callback',
    '/api/pay-callback?Status=OK',
    `/api/pay-callback?Authority=${AUTH}`,
    `/api/pay-callback?Authority=${AUTH}&Status=ok`,
    `/api/pay-callback?Authority=${AUTH}&Status=FAILED`,
    `/api/pay-callback?Authority=${AUTH}&Status=OK%0d%0aSet-Cookie:x=1`,
    '/api/pay-callback?Authority=&Status=OK',
    `/api/pay-callback?Authority=${'A'.repeat(41)}&Status=OK`,
    '/api/pay-callback?Authority=A1%2F%2Fevil.example&Status=OK',
    '/api/pay-callback?Authority=A1%26Status%3DOK&Status=OK',
    '/api/pay-callback?Authority=%D8%A7%D9%84%D9%81&Status=OK',
    `/api/pay-callback?Authority=${AUTH}&Authority=B1&Status=OK`,
    `/api/pay-callback?Authority=${AUTH}&Status=OK&Status=NOK`,
    `/api/pay-callback?authority=${AUTH}&status=OK`,
  ];
  for (const url of bad) {
    const r = call('GET', url);
    assert.equal(r.statusCode, 400, url);
    assert.equal(r.headers.location, undefined, url);
  }
});

test('40 chars is the maximum accepted length', () => {
  assert.equal(call('GET', `/api/pay-callback?Authority=${'A'.repeat(40)}&Status=OK`).statusCode, 303);
});

test('non-GET methods → 405 with Allow: GET', () => {
  for (const m of ['POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']) {
    const r = call(m, `/api/pay-callback?Authority=${AUTH}&Status=OK`);
    assert.equal(r.statusCode, 405, m);
    assert.equal(r.headers.allow, 'GET');
    assert.equal(r.headers.location, undefined);
  }
});
