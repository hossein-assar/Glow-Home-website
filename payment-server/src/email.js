// The "new paid order" email to the shop (Sahar), sent from this server
// because /api/orders on Vercel is retired. Only the VPS deploys
// payment-server/, so the small Resend sender from api/_email.js is copied
// here (same env vars, same EMAIL_FROM fallback) rather than imported.
//
// Environment variables (payment-server/.env, never in code):
//   RESEND_API_KEY      Resend API key
//   ORDER_NOTIFY_EMAIL  the shop address the email goes to
//   EMAIL_FROM          sender, e.g. "Glow Home <orders@glow-home.ir>" — its
//                       domain must be verified in Resend. When unset (or
//                       blank), Resend's testing sender is used, which can
//                       only deliver to the Resend account's own address.
// Missing key or recipient: no email at all (one line at startup, see
// server.js), the payment flow is unaffected.

import { deadline } from './db.js';

export const FALLBACK_FROM = 'Glow Home <onboarding@resend.dev>';
export const RESEND_URL = 'https://api.resend.com/emails';
export const EMAIL_TIMEOUT_MS = 10000;

/** The "from" address: EMAIL_FROM, or Resend's testing sender if unset. */
export function emailFrom(env = process.env) {
  const from = String(env.EMAIL_FROM ?? '').trim();
  return from || FALLBACK_FROM;
}

/** True when both the API key and the shop recipient are set. */
export function emailConfigured(env = process.env) {
  return !!(env.RESEND_API_KEY && env.ORDER_NOTIFY_EMAIL);
}

/** Names (never values) of the variables that are missing, for the startup log. */
export function missingEmailVars(env = process.env) {
  return ['RESEND_API_KEY', 'ORDER_NOTIFY_EMAIL'].filter((k) => !env[k]);
}

export class EmailError extends Error {
  constructor(message) {
    super(message);
    this.name = 'EmailError';
  }
}

/**
 * Sends one email to ORDER_NOTIFY_EMAIL. Throws if not configured, if
 * Resend refuses it, or after EMAIL_TIMEOUT_MS. Error messages never hold
 * the API key, the recipient, the body or Resend's reply text.
 */
export async function sendShopEmail({ subject, html }, { env = process.env, fetchImpl = fetch, timeoutMs = EMAIL_TIMEOUT_MS } = {}) {
  if (!emailConfigured(env)) throw new EmailError('RESEND_API_KEY or ORDER_NOTIFY_EMAIL is not set');
  const d = deadline(timeoutMs);
  try {
    const res = await fetchImpl(RESEND_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: emailFrom(env),
        to: [env.ORDER_NOTIFY_EMAIL],
        subject,
        html,
      }),
      signal: d.signal,
    });
    if (!res.ok) throw new EmailError(`Resend API responded ${res.status}`);
  } finally {
    d.clear();
  }
}

// ---- the email itself ---------------------------------------------------------

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const SHIPPING_LABEL = { peyk: 'پیک تهران', tipax: 'تیپاکس' };
const faNum = (n) => Number(n || 0).toLocaleString('fa-IR');
const money = (n) => new Intl.NumberFormat('fa-IR').format(Math.round(Number(n) || 0)) + ' تومان';
const ltr = (s) => `<span dir="ltr" style="unicode-bidi:isolate">${escapeHtml(s)}</span>`;

/** «۱۴۰۵/۰۸/۱۰، ساعت ۱۳:۰۲», Tehran time, Persian digits. */
export function faDateTime(when) {
  const d = when ? new Date(when) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  const opts = { timeZone: 'Asia/Tehran' };
  return (
    d.toLocaleDateString('fa-IR', { ...opts, year: 'numeric', month: '2-digit', day: '2-digit' }) +
    '، ساعت ' +
    d.toLocaleTimeString('fa-IR', { ...opts, hour: '2-digit', minute: '2-digit', hour12: false })
  );
}

export function paidOrderSubject(order) {
  return `سفارش جدید پرداخت‌شده — ${order.code}`;
}

/**
 * order: { code, customer_name, phone, address, city, postcode, note,
 * shipping_method, total, paid_at, payment_ref_id } — the card number is
 * never read (fetchOrderForEmail doesn't select it) and never used here.
 * items: order_items rows { product_id, name_fa, qty, unit_price }; rows
 * with product_id null are fees (the packaging fee). Every value is escaped.
 */
export function paidOrderHtml(order, items = [], { banner = '' } = {}) {
  const products = items.filter((it) => it.product_id != null);
  const fees = items.filter((it) => it.product_id == null);
  const itemsSum = products.reduce((s, it) => s + it.unit_price * it.qty, 0);
  const feesSum = fees.reduce((s, it) => s + it.unit_price * it.qty, 0);
  const discount = Math.max(0, itemsSum + feesSum - (Number(order.total) || 0));
  const method = SHIPPING_LABEL[order.shipping_method] || order.shipping_method || '—';
  const td = 'style="border:1px solid #ccc;padding:6px 8px;text-align:right;vertical-align:top"';
  const tdNum = 'style="border:1px solid #ccc;padding:6px 8px;text-align:left;white-space:nowrap"';
  const row = (label, value) => `<tr><td style="padding:3px 0 3px 12px;color:#555;white-space:nowrap;vertical-align:top">${label}</td><td style="padding:3px 0">${value}</td></tr>`;
  const sumRow = (label, value, bold = false) =>
    `<tr${bold ? ' style="font-weight:bold"' : ''}><td style="padding:3px 0 3px 24px">${label}</td><td style="padding:3px 0;text-align:left;white-space:nowrap">${value}</td></tr>`;

  return `<!doctype html>
<html lang="fa" dir="rtl">
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#fff">
<div dir="rtl" style="direction:rtl;text-align:right;font-family:Tahoma,Arial,sans-serif;font-size:14px;line-height:1.8;color:#111;max-width:640px;margin:0 auto;padding:16px">
${banner ? `<p style="margin:0 0 12px;padding:8px 12px;border:2px solid #b00;color:#b00;font-weight:bold">${escapeHtml(banner)}</p>\n` : ''}<h2 style="margin:0 0 4px;font-size:18px">سفارش جدید پرداخت‌شده — ${ltr(order.code)}</h2>
<p style="margin:0 0 16px;color:#555">${escapeHtml(faDateTime(order.paid_at))}</p>

<h3 style="margin:16px 0 4px;font-size:15px">گیرنده</h3>
<table style="border-collapse:collapse">
${row('نام:', `<b>${escapeHtml(order.customer_name)}</b>`)}
${row('موبایل:', ltr(order.phone))}
${row('نشانی:', escapeHtml(order.address))}
${row('شهر:', escapeHtml(order.city))}
${order.postcode ? row('کد پستی:', ltr(order.postcode)) : ''}
${row('روش ارسال:', `<b>${escapeHtml(method)}</b>`)}
${order.note ? row('توضیحات مشتری:', `<span style="white-space:pre-wrap">${escapeHtml(order.note)}</span>`) : ''}
</table>

<h3 style="margin:16px 0 4px;font-size:15px">محتویات سفارش</h3>
<table style="border-collapse:collapse;width:100%">
<tr style="background:#f3f3f3"><th ${td}>محصول</th><th ${td}>تعداد</th><th ${td}>قیمت واحد</th><th ${td}>جمع</th></tr>
${products
  .map((it) => `<tr><td ${td}>${escapeHtml(it.name_fa)}</td><td ${td}>${faNum(it.qty)}</td><td ${tdNum}>${money(it.unit_price)}</td><td ${tdNum}>${money(it.unit_price * it.qty)}</td></tr>`)
  .join('\n')}
</table>

<table style="border-collapse:collapse;margin:8px 0 0">
${sumRow('جمع اقلام', money(itemsSum))}
${fees.map((f) => sumRow(escapeHtml(f.name_fa), money(f.unit_price * f.qty))).join('\n')}
${discount > 0 ? sumRow('تخفیف', '−' + money(discount)) : ''}
${sumRow('مبلغ پرداخت‌شده', money(order.total), true)}
</table>

<p style="margin:12px 0 0">پرداخت آنلاین (زرین‌پال)${order.payment_ref_id ? ` — کد پیگیری: ${ltr(order.payment_ref_id)}` : ''}</p>

<p style="margin:20px 0 0;padding-top:10px;border-top:1px solid #ddd;color:#333">برای چاپ این سفارش به ${ltr('glow-home.ir/admin')} بروید (سفارش‌ها ← چاپ سفارش).</p>
</div>
</body>
</html>`;
}

// ---- the notifier used by /api/verify -------------------------------------------

/**
 * notifyPaid(orderId, code): load the order and its items, build the
 * email, send it. Never throws and never rejects — every failure (DB read,
 * Resend down, timeout, a bug) becomes one log line with the order code and
 * the error's name/message, never the body, the recipient or the key.
 * Not configured: returns at once, silently (server.js logs that once at
 * startup). idle() resolves when every send started so far has finished
 * (for tests and the test-email script).
 */
export function createPaidNotifier({ db, logger, env = process.env, fetchImpl = fetch, timeoutMs = EMAIL_TIMEOUT_MS }) {
  const inFlight = new Set();
  async function send(orderId, code) {
    try {
      if (!emailConfigured(env)) return;
      const { order, items } = await db.fetchOrderForEmail(orderId);
      await sendShopEmail({ subject: paidOrderSubject(order), html: paidOrderHtml(order, items) }, { env, fetchImpl, timeoutMs });
      logger('info', 'email.paid_sent', { order: code });
    } catch (err) {
      try {
        logger('error', 'email.paid_failed', {
          order: code,
          error: (err && err.name) || 'Error',
          message: String((err && err.message) || err).slice(0, 120),
        });
      } catch {
        /* a broken logger must not break anything either */
      }
    }
  }
  function notifyPaid(orderId, code) {
    const p = send(orderId, code);
    inFlight.add(p);
    p.finally(() => inFlight.delete(p));
    return p;
  }
  notifyPaid.idle = () => Promise.all([...inFlight]);
  return notifyPaid;
}
