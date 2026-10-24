import { test } from 'node:test';
import assert from 'node:assert/strict';

import { LIMITS, priceCart, validateCheckoutBody } from '../src/pricing.js';

const customer = { name: 'سارا', phone: '+989121234567', city: 'تهران', address: 'خیابان ولیعصر، کوچه ۱۲، پلاک ۳', postcode: '' };
const body = (over = {}) => ({ customer, items: [{ cartKey: 'lamp-a', qty: 1 }], ...over });

const products = [
  { id: 'p1', slug: 'lamp-a', name_fa: 'آباژور الف', price: 1000000, variants: [{ height: 140, price: 1500000 }], colors: ['سبز', 'آبی'], in_stock: true },
  { id: 'p2', slug: 'lamp-b', name_fa: 'آباژور ب', price: 2000000, variants: [], colors: [], in_stock: false },
  { id: 'p3', slug: 'lamp-c', name_fa: 'آباژور ج', price: 0, variants: [], colors: [], in_stock: true },
];

test('valid body is normalized', () => {
  const { value, error } = validateCheckoutBody(body({ customer: { ...customer, postcode: '۱۲۳۴۵۶۷۸۹۰' }, discount_code: 'GLOW10' }));
  assert.equal(error, undefined);
  assert.equal(value.phone, '09121234567');
  assert.equal(value.postcode, '1234567890');
  assert.equal(value.discountCode, 'GLOW10');
});

test('rejects bad input', () => {
  assert.ok(validateCheckoutBody(null).error);
  assert.ok(validateCheckoutBody([]).error);
  assert.ok(validateCheckoutBody(body({ customer: { ...customer, phone: '۰۹۱۲۱۲۳۴۵۶۷' } })).error);
  assert.ok(validateCheckoutBody(body({ customer: { ...customer, phone: '+98812' } })).error);
  assert.ok(validateCheckoutBody(body({ customer: { ...customer, address: 'کوتاه' } })).error);
  assert.ok(validateCheckoutBody(body({ customer: { ...customer, name: { $ne: 1 } } })).error);
  assert.ok(validateCheckoutBody(body({ customer: { ...customer, name: 'x'.repeat(LIMITS.name + 1) } })).error);
  assert.ok(validateCheckoutBody(body({ customer: { ...customer, postcode: '123' } })).error);
  assert.ok(validateCheckoutBody(body({ items: [] })).error);
  assert.ok(validateCheckoutBody(body({ items: [{ cartKey: 'lamp-a', qty: 0 }] })).error);
  assert.ok(validateCheckoutBody(body({ items: [{ cartKey: 'lamp-a', qty: LIMITS.maxQty + 1 }] })).error);
  assert.ok(validateCheckoutBody(body({ items: [{ cartKey: 5, qty: 1 }] })).error);
  assert.ok(validateCheckoutBody(body({ items: Array(LIMITS.maxItems + 1).fill({ cartKey: 'lamp-a', qty: 1 }) })).error);
});

test('prices from DB with variant, color, discount; shipping never charged', () => {
  const r = priceCart({
    items: [{ cartKey: 'lamp-a::h140::c1', qty: 2 }, { cartKey: 'lamp-a', qty: 1 }],
    products,
    discountCode: 'HANDMADE15',
    city: 'تهران',
    codes: { HANDMADE15: 0.15 }, // the feature still works once a code is added
  });
  assert.equal(r.subtotal, 1500000 * 2 + 1000000);
  assert.equal(r.discount, Math.round(4000000 * 0.15));
  assert.equal(r.total, 4000000 - 600000);
  assert.equal(r.shippingMethod, 'peyk');
  assert.equal(r.shippingCost, 90000);
  assert.equal(r.orderItems[0].name_fa, 'آباژور الف (140 سانتی‌متر) — آبی');
});

test('unknown / prototype discount codes are ignored', () => {
  for (const code of ['NOPE', 'constructor', '__proto__', 'GLOW10', 'HANDMADE15']) {
    const r = priceCart({ items: [{ cartKey: 'lamp-a', qty: 1 }], products, discountCode: code, city: 'شیراز' });
    assert.equal(r.total, 1000000);
    assert.equal(r.discountCode, null);
    assert.equal(r.shippingMethod, 'tipax');
  }
});

test('out of stock, unknown and unpriced products are rejected', () => {
  assert.ok(priceCart({ items: [{ cartKey: 'lamp-b', qty: 1 }], products, discountCode: null, city: 'x' }).error);
  assert.ok(priceCart({ items: [{ cartKey: 'nope', qty: 1 }], products, discountCode: null, city: 'x' }).error);
  assert.ok(priceCart({ items: [{ cartKey: 'lamp-c', qty: 1 }], products, discountCode: null, city: 'x' }).error);
});
