// Minimal ZarinPal v4 client (https://www.zarinpal.com/docs/paymentGateway/).
// The merchant id is only ever put in the request body — it is never logged
// and never included in a thrown error.

import { RIAL_PER_TOMAN, ZARINPAL_CURRENCY } from './config.js';

const TIMEOUT_MS = 10000; // same as the app's per-step limit (DEFAULT_TIMEOUTS.stepMs)

// From https://www.zarinpal.com/docs/paymentGateway/errorList.html — used for
// logs and the admin-visible payment_error column, never shown to customers.
export const ZARINPAL_ERRORS = {
  '-9': 'validation error',
  '-10': 'terminal not valid (merchant_id or server IP)',
  '-11': 'terminal not active',
  '-12': 'too many attempts',
  '-13': 'terminal limit reached',
  '-14': 'callback URL domain does not match registered domain',
  '-15': 'terminal suspended',
  '-16': 'terminal user level not valid',
  '-17': 'terminal user level not valid (blue)',
  '-18': 'referrer does not match registered domain',
  '-19': 'terminal transactions banned',
  '-40': 'invalid extra params',
  '-41': 'maximum amount exceeded (100,000,000 toman)',
  '-50': 'amount mismatch',
  '-51': 'payment not successful',
  '-52': 'unexpected error at zarinpal',
  '-53': 'session belongs to another merchant',
  '-54': 'invalid authority',
  '-55': 'manual payment request not found',
};

// Largest amount ZarinPal accepts (error -41), in the unit we send (Rial).
export const MAX_GATEWAY_AMOUNT = 100_000_000 * RIAL_PER_TOMAN;

export class ZarinpalError extends Error {
  /** code: ZarinPal's numeric code, or a string like 'network' / 'bad_response'. */
  constructor(code, detail) {
    super(`ZarinPal error ${code}: ${detail}`);
    this.name = 'ZarinpalError';
    this.code = code;
  }
}

export function describeCode(code) {
  return ZARINPAL_ERRORS[String(code)] || 'unknown';
}

export function createZarinpalClient({ baseUrl, merchantId, fetchImpl = fetch }) {
  async function post(path, body) {
    let res;
    try {
      res = await fetchImpl(baseUrl + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ merchant_id: merchantId, ...body }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      throw new ZarinpalError('network', err.name === 'TimeoutError' ? 'timeout' : 'request failed');
    }

    let json;
    try {
      json = await res.json();
    } catch {
      throw new ZarinpalError('bad_response', `HTTP ${res.status}, non-JSON body`);
    }

    // Success: { data: { code, ... }, errors: [] }
    // Failure: { data: [], errors: { code, message, validations } } (HTTP 4xx)
    const data = json && !Array.isArray(json.data) ? json.data : null;
    if (data && typeof data.code === 'number') return data;

    const errCode = json && json.errors && json.errors.code;
    if (typeof errCode === 'number') throw new ZarinpalError(errCode, describeCode(errCode));
    throw new ZarinpalError('bad_response', `HTTP ${res.status}, unexpected shape`);
  }

  return {
    startPayUrl: (authority) => `${baseUrl}/pg/StartPay/${encodeURIComponent(authority)}`,

    /** Returns the authority string. amount is in Rial (see config.js). */
    async requestPayment({ amount, callbackUrl, description, mobile, orderCode }) {
      if (!Number.isSafeInteger(amount) || amount <= 0 || amount > MAX_GATEWAY_AMOUNT) {
        throw new ZarinpalError(-41, 'amount out of range (checked locally)');
      }
      const data = await post('/pg/v4/payment/request.json', {
        amount,
        currency: ZARINPAL_CURRENCY,
        callback_url: callbackUrl,
        description,
        metadata: { mobile, order_id: orderCode },
      });
      if (data.code !== 100 || typeof data.authority !== 'string' || !data.authority) {
        throw new ZarinpalError(data.code, describeCode(data.code));
      }
      return data.authority;
    },

    /**
     * Returns { code: 100|101, refId, cardPan }. verify.json has no currency
     * field; amount must be the same Rial number sent to request.json, and
     * ZarinPal answers -50 if it doesn't match what was actually paid.
     */
    async verifyPayment({ amount, authority }) {
      const data = await post('/pg/v4/payment/verify.json', { amount, authority });
      if (data.code !== 100 && data.code !== 101) {
        throw new ZarinpalError(data.code, describeCode(data.code));
      }
      if (data.ref_id == null) throw new ZarinpalError('bad_response', 'verify succeeded without ref_id');
      return {
        code: data.code,
        refId: String(data.ref_id),
        cardPan: typeof data.card_pan === 'string' ? data.card_pan.slice(0, 32) : null,
      };
    },
  };
}
