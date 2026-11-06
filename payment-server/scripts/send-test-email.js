// One-off check of the paid-order email from the VPS:
//   cd ~/glow-home/payment-server && node scripts/send-test-email.js
// Sends ONE clearly marked TEST email through the same builder and sender
// the payment server uses (email.js paidOrderHtml + sendShopEmail), with a
// made-up order. It never connects to Supabase: no order is created, read
// or changed. Reads RESEND_API_KEY / ORDER_NOTIFY_EMAIL / EMAIL_FROM from
// payment-server/.env and prints no value of them.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { emailConfigured, emailFrom, missingEmailVars, paidOrderHtml, sendShopEmail, FALLBACK_FROM } from '../src/email.js';

const envPath = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(envPath)) process.loadEnvFile(envPath);

if (!emailConfigured()) {
  console.error(`Not sent: missing ${missingEmailVars().join(', ')} in payment-server/.env`);
  process.exit(1);
}

const order = {
  code: 'TEST-0000',
  customer_name: 'آزمایشی — سفارش واقعی نیست',
  phone: '09000000000',
  address: 'نشانی آزمایشی',
  city: 'تهران',
  postcode: '',
  note: 'این ایمیل فقط برای آزمایش است.',
  shipping_method: 'tipax',
  total: 1250000,
  paid_at: new Date().toISOString(),
  payment_ref_id: '0000000000',
};
const items = [
  { product_id: 'test', name_fa: 'محصول آزمایشی (۵۰ سانتی‌متر)', qty: 1, unit_price: 1000000 },
  { product_id: null, name_fa: 'هزینه بسته‌بندی', qty: 1, unit_price: 250000 },
];

try {
  await sendShopEmail({
    subject: `[آزمایشی] سفارش جدید پرداخت‌شده — ${order.code}`,
    html: paidOrderHtml(order, items, { banner: 'ایمیل آزمایشی — این یک سفارش واقعی نیست و چیزی ثبت نشده است.' }),
  });
  console.log(`Sent: one TEST email to ORDER_NOTIFY_EMAIL${emailFrom() === FALLBACK_FROM ? ' (from Resend\'s testing sender: EMAIL_FROM is not set)' : ''}.`);
} catch (err) {
  console.error(`Not sent: ${err.name}: ${err.message}`);
  process.exit(1);
}
