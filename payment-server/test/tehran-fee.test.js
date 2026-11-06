// The Tehran packaging fee (150,000 Toman) end to end after checkout: the
// order line the payment server stores is shown like any other fee line in
// the admin order card, the printed order and the paid-order email; the
// sales best-sellers never count it as a product; and orders saved before
// the fee existed (no fee line) are shown exactly as stored.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { priceCart, TEHRAN_PACKAGING_FEE_TOMAN, PACKAGING_FEE_TOMAN } from '../src/pricing.js';
import { paidOrderHtml } from '../src/email.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const adminJs = read('../../admin/admin.js');

const grab = (re) => {
  const m = adminJs.match(re);
  assert.ok(m, 'not found in admin/admin.js: ' + re);
  return m[0];
};
const fnSrc = (name) => grab(new RegExp(`function ${name}\\([\\s\\S]*?\\n}\\n`));
const admin = new Function(
  [
    grab(/const STATUS_LABEL = \{[\s\S]*?\n\};\n/),
    grab(/const UNPAID_ONLINE = [^\n]*\n/),
    grab(/const SHIPPING_LABEL = [^\n]*\n/),
    grab(/const SHOP_INSTAGRAM = [^\n]*\n/),
    grab(/const SHOP_SENDER_NAME = [^\n]*\n/),
    grab(/const SHOP_SENDER_PHONE = [^\n]*\n/),
    ...['money', 'escapeHtml', 'faNum', 'phoneDisplay', 'orderPaymentState', 'orderPrintHtml', 'orderCardHtml', 'paymentInfoHtml'].map(fnSrc),
    'return { orderPrintHtml, orderCardHtml, money };',
  ].join('\n')
)();
const { money } = admin;

const lale = { id: 'p-lale', slug: 'lale', name_fa: 'لاله', price: 6500000, height_cm: 40, variants: [], colors: [], in_stock: true };

// A paid Tehran order exactly as the payment server stores it.
const priced = priceCart({ items: [{ cartKey: 'lale', qty: 2 }], products: [lale], discountCode: null, city: 'تهران' });
const ITEMS = priced.orderItems;
const ORDER = {
  id: 'o-t', code: 'GH-1030', created_at: '2026-11-06T09:30:00Z', paid_at: '2026-11-06T09:32:00Z',
  customer_name: 'سارا محمدی', phone: '09121234567', city: 'تهران', address: 'ونک، خیابان ملاصدرا، پلاک ۱۲', postcode: '',
  note: '', shipping_method: priced.shippingMethod, shipping_cost: priced.shippingCost, subtotal: priced.subtotal, total: priced.total,
  status: 'paid', payment_method: 'zarinpal', payment_ref_id: '50123456789', payment_card_pan: '502229******5995',
};

test('a Tehran order is stored with the fee as its own line, in the total', () => {
  assert.equal(TEHRAN_PACKAGING_FEE_TOMAN, 150000);
  assert.deepEqual(ITEMS, [
    { product_id: 'p-lale', name_fa: 'لاله', qty: 2, unit_price: 6500000 },
    { product_id: null, name_fa: 'هزینه بسته‌بندی', qty: 1, unit_price: 150000 },
  ]);
  assert.equal(ORDER.total, 13150000);
  assert.equal(ORDER.shipping_method, 'peyk');
});

test('admin order card: the «هزینه بسته‌بندی» row like any line, and the total with it', () => {
  const html = admin.orderCardHtml(ORDER, ITEMS);
  assert.ok(html.includes(`<div class="order-item-row"><span>هزینه بسته‌بندی × 1</span><span>${money(150000)}</span></div>`));
  assert.ok(html.includes(money(13150000)));
  // the courier (پیک, paid at the door) is still only a method name, never an amount
  assert.ok(html.includes('روش ارسال: پیک تهران'));
  assert.ok(!html.includes(money(90000)));
});

test('printed order: the Tehran fee row in the totals, like the fee outside Tehran', () => {
  const html = admin.orderPrintHtml(ORDER, ITEMS);
  assert.ok(html.includes(`<div><span>هزینه بسته‌بندی</span><span>${money(150000)}</span></div>`));
  assert.ok(html.includes(`<div class="grand"><span>مبلغ پرداخت‌شده</span><span>${money(13150000)}</span></div>`));
  // the fee is in the totals block, not a numbered product row
  assert.equal((html.match(/<tr><td class="n">/g) || []).length, 1, 'one product row');
  // same shape as a Karaj order's fee row, only the amount differs
  const karaj = priceCart({ items: [{ cartKey: 'lale', qty: 2 }], products: [lale], discountCode: null, city: 'کرج' });
  const karajHtml = admin.orderPrintHtml({ ...ORDER, city: 'کرج', shipping_method: 'tipax', total: karaj.total }, karaj.orderItems);
  assert.ok(karajHtml.includes(`<div><span>هزینه بسته‌بندی</span><span>${money(PACKAGING_FEE_TOMAN)}</span></div>`));
});

test('paid-order email: the Tehran fee row, the total paid with it, and no courier amount', () => {
  const html = paidOrderHtml(ORDER, ITEMS);
  const fa = (n) => new Intl.NumberFormat('fa-IR').format(n);
  assert.match(html, new RegExp(`<td[^>]*>هزینه بسته‌بندی</td><td[^>]*>${fa(150000)} تومان</td>`));
  assert.match(html, new RegExp(`<td[^>]*>جمع اقلام</td><td[^>]*>${fa(13000000)} تومان</td>`));
  assert.match(html, new RegExp(`مبلغ پرداخت‌شده</td><td[^>]*>${fa(13150000)} تومان</td>`));
  assert.ok(html.includes('<b>پیک تهران</b>'));
  assert.ok(!html.includes(fa(90000)), 'no courier fee amount');
  assert.doesNotMatch(html, /تخفیف/, 'the fee is not mistaken for a discount');
});

test('sales statistics: best-sellers skip fee lines; revenue is the order total (fee included)', () => {
  const stats = adminJs.match(/\.from\('order_items'\)[\s\S]*?\.limit\(5000\);/)[0];
  assert.match(stats, /\.not\('product_id', 'is', null\)/);
});

test('orders saved before the Tehran fee are shown exactly as stored — no fee row is invented', () => {
  const oldItems = [{ product_id: 'p-lale', name_fa: 'لاله', qty: 2, unit_price: 6500000 }];
  const old = { ...ORDER, code: 'GH-1001', total: 13000000, subtotal: 13000000 };
  for (const html of [admin.orderCardHtml(old, oldItems), admin.orderPrintHtml(old, oldItems), paidOrderHtml(old, oldItems)]) {
    assert.ok(!html.includes('هزینه بسته‌بندی'));
  }
  assert.ok(admin.orderPrintHtml(old, oldItems).includes(`<div class="grand"><span>مبلغ پرداخت‌شده</span><span>${money(13000000)}</span></div>`));
  // nothing in the admin or the email decides a fee by city: they only show stored lines
  for (const src of [fnSrc('orderCardHtml'), fnSrc('orderPrintHtml'), read('../src/email.js')]) {
    assert.doesNotMatch(src, /cityFees|isTehranCity|PACKAGING_FEE/);
  }
});
