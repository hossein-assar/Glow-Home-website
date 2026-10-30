// Shared Resend sender for /api/orders.js (new-order email) and
// /api/contact.js (contact form). Not an endpoint: Vercel does not serve
// files under api/ whose name starts with "_".
//
// Environment variables (Vercel, never in code):
//   RESEND_API_KEY      Resend API key
//   ORDER_NOTIFY_EMAIL  the shop address every email goes to
//   EMAIL_FROM          sender, e.g. "Glow Home <orders@glow-home.ir>" — its
//                       domain must be verified in Resend. When unset (or
//                       blank), Resend's testing sender is used, which can
//                       only deliver to the Resend account's own address.

const FALLBACK_FROM = 'Glow Home <onboarding@resend.dev>';

/** The "from" address: EMAIL_FROM, or Resend's testing sender if unset. */
function emailFrom(env = process.env) {
  const from = String(env.EMAIL_FROM ?? '').trim();
  return from || FALLBACK_FROM;
}

/** True when both the API key and the shop recipient are set. */
function emailConfigured(env = process.env) {
  return !!(env.RESEND_API_KEY && env.ORDER_NOTIFY_EMAIL);
}

/** Send one email to ORDER_NOTIFY_EMAIL. Throws if not configured or if
 * Resend refuses it (the message never includes the API key). */
async function sendShopEmail({ subject, html }, env = process.env) {
  if (!emailConfigured(env)) throw new Error('RESEND_API_KEY or ORDER_NOTIFY_EMAIL is not set');
  const res = await fetch('https://api.resend.com/emails', {
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
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Resend API responded ${res.status}: ${text}`);
  }
}

module.exports = { emailFrom, emailConfigured, sendShopEmail, FALLBACK_FROM };
