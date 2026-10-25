// Express app: /health, POST /api/checkout, GET /api/verify.
// Dependencies are injected (createApp({ config, db, zarinpal })) so tests
// can run the real routes against fakes.

import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';

import { ALLOWED_ORIGINS, tomanToGatewayAmount } from './config.js';
import { LIMITS, parseCartKey, priceCart, validateCheckoutBody } from './pricing.js';
import { MAX_GATEWAY_AMOUNT, ZarinpalError, describeCode } from './zarinpal.js';

// One JSON line per event. Callers only pass non-secret fields — never the
// merchant id, the service-role key, or customer phone/address.
export function log(level, event, fields = {}) {
  const line = JSON.stringify({ t: new Date().toISOString(), level, event, ...fields });
  (level === 'error' ? console.error : console.log)(line);
}

const GENERIC_ERROR = 'خطایی رخ داد. لطفاً دوباره تلاش کنید.';
const GATEWAY_ERROR = 'اتصال به درگاه پرداخت برقرار نشد. لطفاً چند دقیقه بعد دوباره تلاش کنید.';

// Production authorities are 36 chars ("A" + digits); sandbox ones start
// with "S". Anything outside this is rejected before touching the DB.
const AUTHORITY_RE = /^[A-Za-z0-9]{10,64}$/;

// ZarinPal failures that mean "we don't know yet" — the order stays
// pending_payment so a repeated callback can still verify it.
const TRANSIENT_CODES = new Set(['network', 'bad_response', -12, -52]);

// Every outbound call (Supabase, ZarinPal) gets stepMs; a whole request gets
// requestMs. A call that never answers must end in a logged error and a
// response, never in silence (nginx gives up after 60 s).
export const DEFAULT_TIMEOUTS = { stepMs: 10000, requestMs: 25000 };

export class StepTimeoutError extends Error {
  constructor(step, ms) {
    super(`${step} did not answer within ${ms} ms`);
    this.name = 'StepTimeoutError';
    this.step = step;
  }
}

/** Thrown into a handler that resumes after its request already timed out. */
class RequestAbandonedError extends Error {
  constructor() {
    super('request already answered (timed out)');
    this.name = 'RequestAbandonedError';
  }
}

/** Runs fn() and settles like it, or rejects with StepTimeoutError after ms. */
function withTimeout(fn, ms, step) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new StepTimeoutError(step, ms)), ms);
  });
  return Promise.race([Promise.resolve().then(fn), timeout]).finally(() => clearTimeout(timer));
}

/**
 * Per-request guard: step(name, fn) runs one outbound call with a timeout
 * and remembers which step is running; after requestMs onTimeout(step) is
 * called once and later steps throw instead of running. finish() returns
 * false if the request was already answered.
 */
function requestGuard(timeouts, onTimeout) {
  let current = 'start';
  let finished = false;
  const overall = setTimeout(() => {
    if (finished) return;
    finished = true;
    onTimeout(current);
  }, timeouts.requestMs);
  return {
    get step() {
      return current;
    },
    /** Names a local (no I/O) step, so a failure there is logged under it. */
    at(name) {
      current = name;
    },
    async run(name, fn) {
      if (finished) throw new RequestAbandonedError();
      current = name;
      const result = await withTimeout(fn, timeouts.stepMs, name);
      if (finished) throw new RequestAbandonedError();
      return result;
    },
    finish() {
      if (finished) return false;
      finished = true;
      clearTimeout(overall);
      return true;
    },
  };
}

// Checkout steps that do no I/O: an error there is our bug (500), not an
// unreachable Supabase / ZarinPal (502).
const LOCAL_STEPS = new Set(['start', 'validate', 'price']);

export const DEEP_HEALTH = { slowMs: 1500, timeoutMs: 5000 };

const errorFields = (err) => ({ error: (err && err.name) || 'Error', message: String((err && err.message) || err).slice(0, 300) });

export function createApp({ config, db, zarinpal, logger = log, timeouts = DEFAULT_TIMEOUTS, deepHealth = DEEP_HEALTH }) {
  const app = express();

  app.set('trust proxy', 'loopback'); // behind nginx on the same host (README)
  app.disable('x-powered-by');
  // The storefront reads /api/checkout cross-origin (CORS-restricted below).
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

  // For uptime monitors: instant, never touches Supabase.
  app.get('/health', (req, res) => res.json({ ok: true }));

  // For a person checking the route to Supabase: one tiny read, timed.
  // ok < deepHealth.slowMs ≤ slow; failed on an error or after timeoutMs.
  // Rate limited, since every call reaches Supabase; no host, key or
  // Supabase message in the answer (those go to the log).
  const deepHealthLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { ok: false, error: 'Too many requests' },
  });
  app.get('/health/deep', deepHealthLimiter, async (req, res) => {
    const t0 = Date.now();
    // withTimeout's timer is a normal (cleared) one; on timeout the read is
    // aborted too, so it doesn't linger.
    const ping = new AbortController();
    try {
      await withTimeout(() => db.ping(ping.signal), deepHealth.timeoutMs, 'supabase_ping').catch((err) => {
        ping.abort(err);
        throw err;
      });
      const ms = Date.now() - t0;
      res.json({ ok: true, supabase: ms < deepHealth.slowMs ? 'ok' : 'slow', ms });
    } catch (err) {
      const ms = Date.now() - t0;
      logger('error', 'health.supabase_failed', { ms, ...errorFields(err) });
      res.status(503).json({ ok: false, supabase: 'failed', ms });
    }
  });

  // ---- POST /api/checkout -------------------------------------------------
  const checkoutCors = cors({
    origin: ALLOWED_ORIGINS,
    methods: ['POST'],
    allowedHeaders: ['Content-Type'],
    maxAge: 600,
  });
  const checkoutLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { ok: false, error: 'تعداد درخواست‌ها زیاد است. چند دقیقه بعد دوباره تلاش کنید.' },
  });

  app.options('/api/checkout', checkoutCors);
  app.post(
    '/api/checkout',
    checkoutCors,
    checkoutLimiter,
    express.json({ limit: '16kb', strict: true }),
    async (req, res) => {
      // Cart keys only (product/size/shade) — never name, phone or address.
      const rawItems = req.body && Array.isArray(req.body.items) ? req.body.items.slice(0, LIMITS.maxItems) : [];
      logger('info', 'checkout.received', {
        items: rawItems.map((it) => (it && typeof it.cartKey === 'string' ? it.cartKey.slice(0, LIMITS.cartKey) : '?')),
      });

      let order = null;
      let authoritySaved = false;
      const failed = (status, step, err, message = GENERIC_ERROR, reason = `checkout failed at ${step}`) => {
        logger('error', 'checkout.failed', { step, order: order && order.code, ...errorFields(err) });
        // Leave no order waiting for a payment that will never start.
        if (order && !authoritySaved) {
          withTimeout(() => db.markFailed(order.id, reason), timeouts.stepMs, 'mark_failed').catch(() => {});
        }
        if (!res.headersSent) res.status(status).json({ ok: false, error: message });
      };
      const guard = requestGuard(timeouts, (step) => failed(502, step, new StepTimeoutError('checkout', timeouts.requestMs)));
      const reply = (status, body) => {
        if (guard.finish()) res.status(status).json(body);
      };

      try {
        guard.at('validate');
        const v = validateCheckoutBody(req.body);
        if (v.error) return reply(400, { ok: false, error: v.error });
        const input = v.value;

        const slugs = [...new Set(input.items.map((it) => parseCartKey(it.cartKey).id))];
        const products = await guard.run('fetch_products', () => db.fetchProductsBySlugs(slugs));
        guard.at('price');
        const priced = priceCart({
          items: input.items,
          products,
          discountCode: input.discountCode,
          city: input.city,
        });
        if (priced.error) return reply(400, { ok: false, error: priced.error });

        const amount = tomanToGatewayAmount(priced.total);
        if (!Number.isSafeInteger(amount) || amount <= 0 || amount > MAX_GATEWAY_AMOUNT) {
          return reply(400, { ok: false, error: 'مبلغ این سفارش برای پرداخت آنلاین مجاز نیست. لطفاً با ما تماس بگیرید.' });
        }

        const code = await guard.run('order_code', () => db.nextOrderCode());
        order = await guard.run('create_order', () =>
          db.createOrder(
            {
              code,
              customer_name: input.name,
              phone: input.phone,
              city: input.city,
              address: input.address,
              postcode: input.postcode || null,
              note: input.note,
              shipping_method: priced.shippingMethod,
              shipping_cost: priced.shippingCost,
              discount_code: priced.discountCode,
              subtotal: priced.subtotal,
              total: priced.total,
              status: 'pending_payment',
              payment_method: 'zarinpal',
              payment_amount_rial: amount,
            },
            priced.orderItems
          )
        );

        let authority;
        try {
          authority = await guard.run('zarinpal_request', () =>
            zarinpal.requestPayment({
              amount,
              callbackUrl: config.callbackUrl, // see CALLBACK_URL in config.js
              description: `سفارش ${order.code} — Glow Home`,
              mobile: input.phone,
              orderCode: order.code,
            })
          );
        } catch (err) {
          if (!(err instanceof ZarinpalError)) throw err;
          logger('error', 'zarinpal.request_failed', { order: order.code, code: err.code, reason: describeCode(err.code) });
          if (guard.finish()) failed(502, 'zarinpal_request', err, GATEWAY_ERROR, `request ${err.code}`);
          return;
        }

        await guard.run('save_authority', () => db.setAuthority(order.id, authority));
        authoritySaved = true;
        logger('info', 'checkout.created', { order: order.code, amount_rial: amount, authority });
        reply(200, { ok: true, code: order.code, url: zarinpal.startPayUrl(authority) });
      } catch (err) {
        if (err instanceof RequestAbandonedError) return; // the timeout already answered and logged
        const step = guard.step;
        if (!guard.finish()) return;
        // An outbound call failed or timed out → 502; a bug in our own code → 500.
        failed(LOCAL_STEPS.has(step) ? 500 : 502, step, err);
      }
    }
  );

  // ---- GET /api/verify (ZarinPal callback) --------------------------------
  // The order is found ONLY by the Authority ZarinPal sends back; nothing
  // else in the URL is trusted. The customer always ends up on the site's
  // informational #/payment/<code>/<ok|failed> page; the real status lives
  // in the DB and is shown by /track.
  const verifyLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 30,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
  });

  app.get('/api/verify', verifyLimiter, async (req, res) => {
    let orderCode = null;
    const redirect = (code, result) =>
      res.redirect(303, `${config.publicSiteUrl}/#/payment/${code ? encodeURIComponent(code) : '-'}/${result}`);
    // On timeout the order is left as it is: a repeated callback can still verify it.
    const guard = requestGuard(timeouts, (step) => {
      logger('error', 'verify.failed', { step, order: orderCode, ...errorFields(new StepTimeoutError('verify', timeouts.requestMs)) });
      if (!res.headersSent) redirect(orderCode, 'failed');
    });
    const back = (code, result) => {
      if (guard.finish()) redirect(code, result);
    };

    try {
      await handleVerify();
    } catch (err) {
      if (err instanceof RequestAbandonedError) return;
      const step = guard.step;
      if (!guard.finish()) return;
      logger('error', 'verify.failed', { step, order: orderCode, ...errorFields(err) });
      redirect(orderCode, 'failed');
    }

    async function handleVerify() {
      const authority = typeof req.query.Authority === 'string' ? req.query.Authority : '';
      const status = typeof req.query.Status === 'string' ? req.query.Status : '';
      if (!AUTHORITY_RE.test(authority)) {
        logger('info', 'verify.bad_authority');
        return back(null, 'failed');
      }

      const order = await guard.run('find_order', () => db.findOrderByAuthority(authority));
      orderCode = order && order.code;
      if (!order) {
        logger('info', 'verify.unknown_authority', { authority });
        return back(null, 'failed');
      }

      // Already paid: a repeated callback / page reload. Nothing to do.
      if (order.paid_at) return back(order.code, 'ok');

      if (order.status !== 'pending_payment' && order.status !== 'payment_failed') {
        logger('error', 'verify.unexpected_status', { order: order.code, status: order.status });
        return back(order.code, 'failed');
      }

      if (status !== 'OK') {
        await guard.run('mark_failed', () => db.markFailed(order.id, 'cancelled at gateway (Status=NOK)'));
        logger('info', 'verify.cancelled', { order: order.code });
        return back(order.code, 'failed');
      }

      // Verify with the STORED order total. If it no longer matches what was
      // sent to request.json (e.g. the total was edited in the meantime),
      // don't confirm the payment — ZarinPal returns unverified money to the
      // customer automatically.
      const amount = tomanToGatewayAmount(Number(order.total));
      if (Number(order.payment_amount_rial) !== amount) {
        await guard.run('mark_failed', () => db.markFailed(order.id, 'amount changed since payment request'));
        logger('error', 'verify.amount_changed', {
          order: order.code,
          requested_rial: order.payment_amount_rial,
          current_rial: amount,
        });
        return back(order.code, 'failed');
      }

      let result;
      try {
        result = await guard.run('zarinpal_verify', () => zarinpal.verifyPayment({ amount, authority }));
      } catch (err) {
        if (!(err instanceof ZarinpalError)) throw err;
        const fields = { order: order.code, code: err.code, reason: describeCode(err.code) };
        if (TRANSIENT_CODES.has(err.code)) {
          // Left in pending_payment on purpose — a retry can still verify it.
          logger('error', 'zarinpal.verify_transient', fields);
        } else {
          // -50 = amount ZarinPal received differs from the stored total.
          await guard.run('mark_failed', () => db.markFailed(order.id, `verify ${err.code}`));
          logger('error', 'zarinpal.verify_failed', fields);
        }
        return back(order.code, 'failed');
      }

      let marked;
      try {
        marked = await guard.run('mark_paid', () => db.markPaid({ authority, refId: result.refId, cardPan: result.cardPan }));
      } catch (err) {
        if (err instanceof RequestAbandonedError) throw err;
        // Money IS confirmed at ZarinPal but the DB write failed or timed
        // out. Repeating the callback (verify answers 101) retries safely.
        logger('error', 'verify.mark_paid_failed_after_verify', {
          order: order.code,
          ref_id: result.refId,
          message: err.message,
        });
        return back(order.code, 'failed');
      }

      if (marked === 'paid' || marked === 'already_paid') {
        logger('info', 'verify.paid', { order: order.code, ref_id: result.refId, zp_code: result.code, result: marked });
        return back(order.code, 'ok');
      }

      // Verified money on an order that can't become paid (e.g. cancelled
      // meanwhile) — needs a human: refund or reinstate manually.
      logger('error', 'verify.paid_but_not_markable', { order: order.code, ref_id: result.refId, result: marked });
      return back(order.code, 'failed');
    }
  });

  // ---- Fallbacks ------------------------------------------------------------
  app.use((req, res) => res.status(404).json({ ok: false, error: 'Not found' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') {
      return res.status(err.status || 400).json({ ok: false, error: 'درخواست نامعتبر است.' });
    }
    logger('error', 'unhandled', { path: req.path, ...errorFields(err) });
    if (req.path === '/api/verify') {
      return res.redirect(303, `${config.publicSiteUrl}/#/payment/-/failed`);
    }
    res.status(500).json({ ok: false, error: GENERIC_ERROR });
  });

  return app;
}
