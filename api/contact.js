// POST /api/contact
//
// Sends the contact form to the shop by email. Same mechanism as the
// new-order email in /api/orders.js: Resend's API over a plain fetch(), with
// RESEND_API_KEY and ORDER_NOTIFY_EMAIL from Vercel's environment variables
// (never in code), to the same address new orders go to.
//
// Unlike the order email (best-effort, never allowed to break checkout),
// here the email IS the whole job — so a missing key or a failed send is
// reported back as a generic error instead of pretending it worked.
//
// Hardening: POST only, Origin must be exactly https://glow-home.ir
// (www.glow-home.ir redirects there), a hidden honeypot field, a per-IP rate
// limit, length limits, and every user value is HTML-escaped in the email.
// Internal details only go to the server log, never to the client.

const ALLOWED_ORIGIN = 'https://glow-home.ir';

const LIMITS = { name: 100, message: 2000, messageMin: 5 };

// Per-IP rate limit. In memory, so it is per warm function instance and
// resets on a cold start — a simple brake on floods, not a hard guarantee.
const RATE_LIMIT = { max: 5, windowMs: 10 * 60 * 1000 };
const hits = new Map();

function rateLimited(ip, now = Date.now()) {
  const recent = (hits.get(ip) || []).filter((t) => now - t < RATE_LIMIT.windowMs);
  if (recent.length >= RATE_LIMIT.max) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  hits.set(ip, recent);
  // Keep the map from growing without bound on a long-lived instance.
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (!v.some((t) => now - t < RATE_LIMIT.windowMs)) hits.delete(k);
  }
  return false;
}

function clientIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || String(req.headers['x-real-ip'] || '') || 'unknown';
}

// Mirrors containsPersianOrArabicDigits in app.js / api/orders.js — phone
// fields reject these with a message rather than converting them.
function containsPersianOrArabicDigits(raw) {
  return /[۰-۹٠-٩]/.test(String(raw ?? ''));
}

// Iranian mobile in any common shape (09…, +989…, 00989…, 989…, 9…, with
// spaces or dashes) → canonical 09XXXXXXXXX, or null. Same rule as
// contactMobile() in app.js.
function normalizeMobile(raw) {
  const v = String(raw ?? '').replace(/[\s-]/g, '');
  const m = v.match(/^(?:\+98|0098|98|0)?(9[0-9]{9})$/);
  return m ? '0' + m[1] : null;
}

const str = (v) => (typeof v === 'string' ? v.trim() : v == null ? '' : null);

/**
 * Returns { error } (Persian, safe to show), { spam: true } for a filled
 * honeypot, or { value: { name, mobile, message } }.
 */
function validateContact(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'درخواست نامعتبر است.' };
  const name = str(body.name);
  const phone = str(body.phone);
  const message = str(body.message);
  const website = str(body.website); // honeypot: hidden on the page, only bots fill it
  if ([name, phone, message, website].some((v) => v === null)) return { error: 'درخواست نامعتبر است.' };
  if (website) return { spam: true };

  if (!name) return { error: 'نام را وارد کنید.' };
  if (name.length > LIMITS.name) return { error: 'نام بیش از حد طولانی است.' };
  if (!phone) return { error: 'شماره موبایل را وارد کنید.' };
  if (containsPersianOrArabicDigits(phone)) return { error: 'لطفاً شماره موبایل را با اعداد انگلیسی وارد کنید.' };
  const mobile = normalizeMobile(phone);
  if (!mobile) return { error: 'شماره موبایل معتبر نیست (مثلاً 09121234567).' };
  if (message.length < LIMITS.messageMin) return { error: 'متن پیام را بنویسید.' };
  if (message.length > LIMITS.message) return { error: `پیام نباید بیشتر از ${LIMITS.message} نویسه باشد.` };

  return { value: { name, mobile, message } };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

const SUBJECT = 'پیام جدید از فرم تماس';

function buildEmail({ name, mobile, message }) {
  const html = `
    <div dir="rtl" style="font-family: sans-serif;">
      <h2>${SUBJECT}</h2>
      <p><strong>نام:</strong> ${escapeHtml(name)}</p>
      <p><strong>موبایل:</strong> ${escapeHtml(mobile)}</p>
      <h3>پیام</h3>
      <p style="white-space: pre-wrap;">${escapeHtml(message)}</p>
    </div>
  `;
  return { subject: SUBJECT, html };
}

async function sendContactEmail(value) {
  const apiKey = process.env.RESEND_API_KEY;
  const notifyTo = process.env.ORDER_NOTIFY_EMAIL;
  if (!apiKey || !notifyTo) throw new Error('RESEND_API_KEY or ORDER_NOTIFY_EMAIL is not set');

  const { subject, html } = buildEmail(value);
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Glow Home <onboarding@resend.dev>',
      to: [notifyTo],
      subject,
      html,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Resend API responded ${res.status}: ${text}`);
  }
}

const SEND_FAILED = 'ارسال پیام با خطا مواجه شد. لطفاً دوباره تلاش کنید یا از راه اینستاگرام یا تلفن با ما در تماس باشید.';

module.exports = async (req, res) => {
  res.setHeader('Vary', 'Origin');
  const origin = req.headers.origin;
  if (origin !== ALLOWED_ORIGIN) {
    res.status(403).json({ ok: false, error: 'درخواست نامعتبر است.' });
    return;
  }
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  if (rateLimited(clientIp(req))) {
    res.status(429).json({ ok: false, error: 'تعداد پیام‌ها زیاد است. چند دقیقه بعد دوباره تلاش کنید.' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      res.status(400).json({ ok: false, error: 'درخواست نامعتبر است.' });
      return;
    }
  }

  const v = validateContact(body);
  if (v.error) {
    res.status(400).json({ ok: false, error: v.error });
    return;
  }
  // Honeypot filled: look successful so the bot learns nothing, send nothing.
  if (v.spam) {
    res.status(200).json({ ok: true });
    return;
  }

  try {
    await sendContactEmail(v.value);
  } catch (err) {
    console.error('Contact email failed:', err);
    res.status(502).json({ ok: false, error: SEND_FAILED });
    return;
  }

  res.status(200).json({ ok: true });
};

// Pure helpers, exposed only for payment-server's tests.
module.exports.validateContact = validateContact;
module.exports.normalizeMobile = normalizeMobile;
module.exports.escapeHtml = escapeHtml;
module.exports.buildEmail = buildEmail;
module.exports.LIMITS = LIMITS;
module.exports.RATE_LIMIT = RATE_LIMIT;
module.exports._resetRateLimit = () => hits.clear();
