// All configuration comes from environment variables (see .env.example).
// Nothing secret is ever hardcoded here or logged.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Load payment-server/.env if present (Node 22 built-in, no dotenv needed).
// Variables already set in the real environment win over the file.
const envPath = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(envPath)) process.loadEnvFile(envPath);

const ZARINPAL_BASE = {
  sandbox: 'https://sandbox.zarinpal.com',
  production: 'https://payment.zarinpal.com',
};

// The site stores and shows every price in TOMAN (products.price,
// orders.total, data.js, money() in app.js). ZarinPal gets RIAL:
// verify.json has no `currency` field and its docs don't state which unit
// it assumes, while request.json's default is undocumented too. Sending
// Rial with an explicit currency: 'IRR' on request, and the same Rial
// number on verify, leaves nothing to interpretation on either call.
// This is the one place the conversion lives.
export const ZARINPAL_CURRENCY = 'IRR';
export const RIAL_PER_TOMAN = 10;
export const tomanToGatewayAmount = (toman) => toman * RIAL_PER_TOMAN;

function required(name) {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`Missing required env var ${name}`);
  return v.trim();
}

function httpsUrl(name, { allowLocalHttp }) {
  return checkUrl(name, required(name), { allowLocalHttp });
}

function checkUrl(name, value, { allowLocalHttp }) {
  const raw = value.trim().replace(/\/+$/, '');
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`${name} is not a valid URL`);
  }
  const isLocal = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.protocol !== 'https:' && !(allowLocalHttp && isLocal && u.protocol === 'http:')) {
    throw new Error(`${name} must be an https:// URL`);
  }
  return raw;
}

export function loadConfig() {
  const mode = (process.env.ZARINPAL_MODE || 'sandbox').trim();
  if (!ZARINPAL_BASE[mode]) throw new Error('ZARINPAL_MODE must be "sandbox" or "production"');
  const isSandbox = mode === 'sandbox';

  const merchantId = required('ZARINPAL_MERCHANT_ID');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(merchantId)) {
    throw new Error('ZARINPAL_MERCHANT_ID must be a 36-character UUID');
  }

  const publicApiUrl = httpsUrl('PUBLIC_API_URL', { allowLocalHttp: isSandbox });

  // Optional. The callback_url sent to ZarinPal. Production ZarinPal only
  // accepts a callback on the gateway's registered domain (glow-home.ir),
  // so there it points at the shop's api/pay-callback.js, which forwards to
  // this server's /api/verify. Unset: this server's own /api/verify.
  const callbackRaw = (process.env.CALLBACK_URL || '').trim();
  const callbackUrl = callbackRaw
    ? checkUrl('CALLBACK_URL', callbackRaw, { allowLocalHttp: isSandbox })
    : `${publicApiUrl}/api/verify`;

  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT is not valid');

  return Object.freeze({
    supabaseUrl: httpsUrl('SUPABASE_URL', { allowLocalHttp: false }),
    supabaseServiceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
    zarinpal: Object.freeze({ mode, baseUrl: ZARINPAL_BASE[mode], merchantId }),
    // Plain http://localhost is only accepted in sandbox mode, for local testing.
    publicSiteUrl: httpsUrl('PUBLIC_SITE_URL', { allowLocalHttp: isSandbox }),
    publicApiUrl,
    callbackUrl,
    port,
  });
}

/**
 * The non-secret facts the server.started log line records: which Supabase
 * route is in use (host and path only — e.g. glow-home.ir /sb on the VPS,
 * see README "VPS env checklist"), ZarinPal mode and the callback URL.
 * Never keys, the merchant id, or anything else from the environment.
 */
export function startupLogFields(config) {
  const supabase = new URL(config.supabaseUrl);
  return {
    port: config.port,
    supabase_host: supabase.host,
    supabase_path: supabase.pathname.replace(/\/+$/, '') || '/',
    zarinpal_mode: config.zarinpal.mode,
    callback_url: config.callbackUrl,
  };
}

// Fixed, not configurable — the storefront only ever lives on these.
export const ALLOWED_ORIGINS = ['https://glow-home.ir', 'https://www.glow-home.ir'];
