// loadConfig() reads process.env, so each test sets exactly the vars it needs.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { loadConfig } from '../src/config.js';

const BASE = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'fake-key',
  ZARINPAL_MERCHANT_ID: '00000000-0000-0000-0000-000000000000',
  PUBLIC_SITE_URL: 'https://glow-home.ir',
  PUBLIC_API_URL: 'https://pay.glow-home.ir',
};
const KEYS = [...Object.keys(BASE), 'ZARINPAL_MODE', 'CALLBACK_URL', 'PORT'];

beforeEach(() => {
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, BASE);
});

test('CALLBACK_URL unset → PUBLIC_API_URL/api/verify (unchanged default)', () => {
  assert.equal(loadConfig().callbackUrl, 'https://pay.glow-home.ir/api/verify');
});

test('CALLBACK_URL blank → default too', () => {
  process.env.CALLBACK_URL = '   ';
  assert.equal(loadConfig().callbackUrl, 'https://pay.glow-home.ir/api/verify');
});

test('CALLBACK_URL set → used as is (trailing slash trimmed)', () => {
  process.env.CALLBACK_URL = 'https://glow-home.ir/api/pay-callback/';
  assert.equal(loadConfig().callbackUrl, 'https://glow-home.ir/api/pay-callback');
});

test('CALLBACK_URL must be https (http://localhost only in sandbox)', () => {
  process.env.CALLBACK_URL = 'http://glow-home.ir/api/pay-callback';
  assert.throws(() => loadConfig(), /CALLBACK_URL must be an https/);
  process.env.CALLBACK_URL = 'not a url';
  assert.throws(() => loadConfig(), /CALLBACK_URL is not a valid URL/);
  process.env.CALLBACK_URL = 'http://localhost:8080/api/pay-callback';
  assert.equal(loadConfig().callbackUrl, 'http://localhost:8080/api/pay-callback');
  process.env.ZARINPAL_MODE = 'production';
  assert.throws(() => loadConfig(), /CALLBACK_URL must be an https/);
});

test('config errors never contain the value', () => {
  process.env.CALLBACK_URL = 'ftp://secret-looking-value';
  assert.throws(() => loadConfig(), (e) => !e.message.includes('secret-looking-value'));
});
