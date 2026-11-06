// دفرمه: shade type (plain / macrame) priced per height, on the same
// mechanism as گیسو. Covers both server copies of the pricing —
// payment-server/src/pricing.js and api/orders.js (loaded with a stub
// require, it's a CommonJS Vercel function) — and that each product accepts
// only its own shade types.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { SHADE_TYPES, priceCart, validateCheckoutBody } from '../src/pricing.js';
import { tomanToGatewayAmount } from '../src/config.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

function loadOrdersJs() {
  const mod = { exports: {} };
  const stubRequire = (id) => {
    if (id === '@supabase/supabase-js') return { createClient() { throw new Error('no db in tests'); } };
    throw new Error('unexpected require ' + id);
  };
  new Function('require', 'module', 'exports', read('../../api/orders.js'))(stubRequire, mod, mod.exports);
  return mod.exports;
}
const orders = loadOrdersJs();

// Same shapes as supabase/migration-deforme-shades.sql / migration-gisoo-shades.sql write.
const deforme = {
  id: 'd1',
  slug: 'deforme',
  name_fa: 'دفرمه',
  price: 9400000,
  variants: [
    { height: 140, price: 13100000, shades: { plain: 13100000, macrame: 13500000 } },
    { height: 120, price: 10100000, shades: { plain: 10100000, macrame: 10500000 } },
    { height: 100, price: 9400000, shades: { plain: 9400000, macrame: 9800000 } },
  ],
  colors: [],
  in_stock: true,
};
const gisoo = {
  id: 'g1',
  slug: 'gisoo',
  name_fa: 'گیسو',
  price: 9100000,
  variants: [
    { height: 140, price: 12980000, shades: { plain: 12980000, embroidered: 15450000 } },
    { height: 120, price: 9980000, shades: { plain: 9980000, embroidered: 12480000 } },
    { height: 100, price: 9100000, shades: { plain: 9100000, embroidered: 11600000 } },
  ],
  colors: [],
  in_stock: true,
};
const products = [deforme, gisoo];

const PRICES = [
  ['h140', 'plain', 13100000],
  ['h140', 'macrame', 13500000],
  ['h120', 'plain', 10100000],
  ['h120', 'macrame', 10500000],
  ['h100', 'plain', 9400000],
  ['h100', 'macrame', 9800000],
];

// Tehran: product prices only (the packaging fee outside Tehran: city-fees.test.js)
const price = (cartKey, qty = 1) => priceCart({ items: [{ cartKey, qty }], products, discountCode: null, city: 'تهران' });
const ordersLine = (product, cartKey) => {
  const { height, shade } = orders.parseCartKey(cartKey);
  return orders.shadeLine(product, height, shade);
};
const staleError = (name) => `اندازه یا نوع شید «${name}» در سبد شما دیگر معتبر نیست. لطفاً آن را از سبد حذف کنید و دوباره انتخاب کنید.`;

test('macrame is a shade type with its Persian label', () => {
  assert.equal(SHADE_TYPES.macrame, 'شید مکرومه');
});

for (const [h, shade, toman] of PRICES) {
  test(`deforme ${h} ${shade}: ${toman} Toman = ${toman * 10} Rial`, () => {
    const key = `deforme::${h}::s${shade}`;
    const r = price(key);
    assert.equal(r.error, undefined);
    assert.equal(r.orderItems[0].unit_price, toman);
    assert.equal(r.total, toman);
    assert.equal(tomanToGatewayAmount(r.total), toman * 10);
    assert.equal(r.orderItems[0].name_fa, `دفرمه (${h.slice(1)} سانتی‌متر) — ${SHADE_TYPES[shade]}`);
    assert.deepEqual(ordersLine(deforme, key), { price: toman, label: r.orderItems[0].name_fa });
  });
}

test('deforme rejects the embroidered shade (gisoo-only)', () => {
  for (const h of ['h140', 'h120', 'h100']) {
    const key = `deforme::${h}::sembroidered`;
    assert.equal(price(key).error, staleError('دفرمه'), key);
    assert.equal(ordersLine(deforme, key).error, staleError('دفرمه'), key);
  }
});

test('gisoo rejects the macrame shade (deforme-only), and still prices its own', () => {
  for (const h of ['h140', 'h120', 'h100']) {
    const key = `gisoo::${h}::smacrame`;
    assert.equal(price(key).error, staleError('گیسو'), key);
    assert.equal(ordersLine(gisoo, key).error, staleError('گیسو'), key);
  }
  assert.equal(price('gisoo::h140::sembroidered').total, 15450000);
  assert.equal(price('gisoo::h100::splain').total, 9100000);
});

test('old deforme cart keys (no shade type, removed sizes) are rejected with a Persian error', () => {
  for (const key of [
    'deforme',
    'deforme::h60',
    'deforme::h80',
    'deforme::h100',
    'deforme::h130',
    'deforme::h60::splain',
    'deforme::h80::smacrame',
    'deforme::h130::splain',
  ]) {
    const r = price(key);
    assert.equal(r.orderItems, undefined, key);
    assert.equal(r.error, staleError('دفرمه'), key);
    assert.equal(ordersLine(deforme, key).error, r.error, key);
  }
});

test('a tampered client price for deforme is ignored: the price comes from the DB only', () => {
  const v = validateCheckoutBody({
    customer: { name: 'سارا', phone: '+989121234567', city: 'تهران', address: 'خیابان ولیعصر، کوچه ۱۲، پلاک ۳', postcode: '' },
    items: [{ cartKey: 'deforme::h140::smacrame', qty: 1, price: 1000, unit_price: 1000 }],
    total: 1000,
  });
  assert.equal(v.error, undefined);
  assert.deepEqual(v.value.items, [{ cartKey: 'deforme::h140::smacrame', qty: 1 }]);
  const r = priceCart({ items: v.value.items, products, discountCode: null, city: 'تهران' });
  assert.equal(r.total, 13500000);
  assert.equal(tomanToGatewayAmount(r.total), 135000000);
});

test('admin shows one row per shade found in the product data, with its price for every size', () => {
  const SRC = read('../../admin/admin.js');
  const { shadeModelOf, shadeBlockHtml } = new Function(
    [
      ...['toLatinDigits', 'unformatPrice', 'formatPrice', 'escapeHtml', 'escapeAttr', 'shadeTypesOf', 'shadeModelOf', 'shadeBlockHtml'].map((n) => SRC.match(new RegExp(`function ${n}\\([\\s\\S]*?\\n}\\n`))[0]),
      SRC.match(/const SHADE_TYPES = [^\n]*\n/)[0],
      SRC.match(/const SHADE_NAME_MAX = [^\n]*\n/)[0],
      'return { shadeModelOf, shadeBlockHtml };',
    ].join('\n')
  )();
  const g = shadeModelOf(gisoo);
  assert.deepEqual(g.sizes, ['140', '120', '100']);
  assert.deepEqual(g.shades.map((s) => [s.key, s.name_fa, s.prices]), [
    ['plain', 'شید ساده', [12980000, 9980000, 9100000]],
    ['embroidered', 'شید گلدوزی', [15450000, 12480000, 11600000]],
  ]);
  const d = shadeModelOf(deforme);
  assert.deepEqual(d.shades.map((s) => [s.key, s.name_fa, s.prices]), [
    ['plain', 'شید ساده', [13100000, 10100000, 9400000]],
    ['macrame', 'شید مکرومه', [13500000, 10500000, 9800000]],
  ]);
  const html = shadeBlockHtml('d1', d);
  assert.match(html, /<div class="shade-row" data-key="macrame">[\s\S]*?value="شید مکرومه"/);
  assert.match(html, /<span>قیمت — 140 سانتی‌متر<\/span>\s*<input[^>]*data-idx="0"[^>]*value="13,500,000"/);
});
