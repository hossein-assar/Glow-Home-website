// Express app: /health, POST /api/checkout, GET /api/verify.
// Dependencies are injected (createApp({ config, db, zarinpal })) so tests
// can run the real routes against fakes.

import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';

import { ALLOWED_ORIGINS, tomanToGatewayAmount } from './config.js';
import { parseCartKey, priceCart, validateCheckoutBody } from './pricing.js';
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

export function createApp({ config, db, zarinpal, logger = log }) {
  const app = express();

  app.set('trust proxy', 'loopback'); // behind nginx on the same host (README)
  app.disable('x-powered-by');
  // The storefront reads /api/checkout cross-origin (CORS-restricted below).
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

  app.get('/health', (req, res) => res.json({ ok: true }));

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
      const v = validateCheckoutBody(req.body);
      if (v.error) return res.status(400).json({ ok: false, error: v.error });
      const input = v.value;

      const slugs = [...new Set(input.items.map((it) => parseCartKey(it.cartKey).id))];
      const products = await db.fetchProductsBySlugs(slugs);
      const priced = priceCart({
        items: input.items,
        products,
        discountCode: input.discountCode,
        city: input.city,
      });
      if (priced.error) return res.status(400).json({ ok: false, error: priced.error });

      const amount = tomanToGatewayAmount(priced.total);
      if (!Number.isSafeInteger(amount) || amount <= 0 || amount > MAX_GATEWAY_AMOUNT) {
        return res.status(400).json({ ok: false, error: 'مبلغ این سفارش برای پرداخت آنلاین مجاز نیست. لطفاً با ما تماس بگیرید.' });
      }

      const code = await db.nextOrderCode();
      const order = await db.createOrder(
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
      );

      let authority;
      try {
        authority = await zarinpal.requestPayment({
          amount,
          callbackUrl: `${config.publicApiUrl}/api/verify`,
          description: `سفارش ${order.code} — Glow Home`,
          mobile: input.phone,
          orderCode: order.code,
        });
      } catch (err) {
        if (!(err instanceof ZarinpalError)) throw err;
        logger('error', 'zarinpal.request_failed', { order: order.code, code: err.code, reason: describeCode(err.code) });
        await db.markFailed(order.id, `request ${err.code}`).catch(() => {});
        return res.status(502).json({ ok: false, error: GATEWAY_ERROR });
      }

      await db.setAuthority(order.id, authority);
      logger('info', 'checkout.created', { order: order.code, amount_rial: amount, authority });
      res.json({ ok: true, code: order.code, url: zarinpal.startPayUrl(authority) });
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
    const back = (code, result) =>
      res.redirect(303, `${config.publicSiteUrl}/#/payment/${code ? encodeURIComponent(code) : '-'}/${result}`);

    const authority = typeof req.query.Authority === 'string' ? req.query.Authority : '';
    const status = typeof req.query.Status === 'string' ? req.query.Status : '';
    if (!AUTHORITY_RE.test(authority)) {
      logger('info', 'verify.bad_authority');
      return back(null, 'failed');
    }

    const order = await db.findOrderByAuthority(authority);
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
      await db.markFailed(order.id, 'cancelled at gateway (Status=NOK)');
      logger('info', 'verify.cancelled', { order: order.code });
      return back(order.code, 'failed');
    }

    // Verify with the STORED order total. If it no longer matches what was
    // sent to request.json (e.g. the total was edited in the meantime),
    // don't confirm the payment — ZarinPal returns unverified money to the
    // customer automatically.
    const amount = tomanToGatewayAmount(Number(order.total));
    if (Number(order.payment_amount_rial) !== amount) {
      await db.markFailed(order.id, 'amount changed since payment request');
      logger('error', 'verify.amount_changed', {
        order: order.code,
        requested_rial: order.payment_amount_rial,
        current_rial: amount,
      });
      return back(order.code, 'failed');
    }

    let result;
    try {
      result = await zarinpal.verifyPayment({ amount, authority });
    } catch (err) {
      if (!(err instanceof ZarinpalError)) throw err;
      const fields = { order: order.code, code: err.code, reason: describeCode(err.code) };
      if (TRANSIENT_CODES.has(err.code)) {
        // Left in pending_payment on purpose — a retry can still verify it.
        logger('error', 'zarinpal.verify_transient', fields);
      } else {
        // -50 = amount ZarinPal received differs from the stored total.
        await db.markFailed(order.id, `verify ${err.code}`);
        logger('error', 'zarinpal.verify_failed', fields);
      }
      return back(order.code, 'failed');
    }

    let marked;
    try {
      marked = await db.markPaid({ authority, refId: result.refId, cardPan: result.cardPan });
    } catch (err) {
      // Money IS confirmed at ZarinPal but the DB write failed. Repeating
      // the callback (verify answers 101) will retry this safely.
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
  });

  // ---- Fallbacks ------------------------------------------------------------
  app.use((req, res) => res.status(404).json({ ok: false, error: 'Not found' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') {
      return res.status(err.status || 400).json({ ok: false, error: 'درخواست نامعتبر است.' });
    }
    logger('error', 'unhandled', { path: req.path, message: err.message });
    if (req.path === '/api/verify') {
      return res.redirect(303, `${config.publicSiteUrl}/#/payment/-/failed`);
    }
    res.status(500).json({ ok: false, error: GENERIC_ERROR });
  });

  return app;
}
