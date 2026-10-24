// گیسو: shade type (plain / embroidered) priced per height. Covers both
// server copies of the pricing — payment-server/src/pricing.js and
// api/orders.js (loaded with a stub require, it's a CommonJS Vercel function).
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

// Same shape as supabase/migration-gisoo-shades.sql writes.
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
const lampA = { id: 'p1', slug: 'lamp-a', name_fa: 'آباژور الف', price: 1000000, variants: [{ height: 140, price: 1500000 }], colors: [], in_stock: true };
const products = [gisoo, lampA];

const PRICES = [
  ['h140', 'plain', 12980000],
  ['h140', 'embroidered', 15450000],
  ['h120', 'plain', 9980000],
  ['h120', 'embroidered', 12480000],
  ['h100', 'plain', 9100000],
  ['h100', 'embroidered', 11600000],
];

const price = (cartKey, qty = 1) => priceCart({ items: [{ cartKey, qty }], products, discountCode: null, city: 'شیراز' });
const ordersLine = (cartKey) => {
  const { height, shade } = orders.parseCartKey(cartKey);
  return orders.shadeLine(gisoo, height, shade);
};

for (const [h, shade, toman] of PRICES) {
  test(`gisoo ${h} ${shade}: ${toman} Toman = ${toman * 10} Rial`, () => {
    const key = `gisoo::${h}::s${shade}`;
    const r = price(key);
    assert.equal(r.error, undefined);
    assert.equal(r.orderItems[0].unit_price, toman);
    assert.equal(r.total, toman);
    assert.equal(tomanToGatewayAmount(r.total), toman * 10);
    assert.equal(r.orderItems[0].name_fa, `گیسو (${h.slice(1)} سانتی‌متر) — ${SHADE_TYPES[shade]}`);
    // api/orders.js gives the same price and label.
    assert.deepEqual(ordersLine(key), { price: toman, label: r.orderItems[0].name_fa });
  });
}

test('same lamp with two shade types = two separate lines', () => {
  const r = priceCart({
    items: [{ cartKey: 'gisoo::h140::splain', qty: 1 }, { cartKey: 'gisoo::h140::sembroidered', qty: 2 }],
    products,
    discountCode: null,
    city: 'تهران',
  });
  assert.equal(r.orderItems.length, 2);
  assert.equal(r.subtotal, 12980000 + 2 * 15450000);
});

test('unknown shade type is rejected', () => {
  for (const key of ['gisoo::h140::sgold', 'gisoo::h140::s', 'gisoo::h140::sconstructor', 'gisoo::h140::s__proto__', 'gisoo::h140::sPLAIN']) {
    assert.match(price(key).error, /نوع شید/, key);
    assert.ok(ordersLine(key).error, key);
  }
});

test('unknown height is rejected', () => {
  for (const key of ['gisoo::h150::splain', 'gisoo::h0::splain', 'gisoo::habc::splain', 'gisoo::h::sembroidered', 'gisoo::splain']) {
    assert.match(price(key).error, /اندازه/, key);
    assert.ok(ordersLine(key).error, key);
  }
});

test('old gisoo cart keys (no shade type, removed sizes) are rejected with a Persian error', () => {
  for (const key of ['gisoo', 'gisoo::h100', 'gisoo::h140', 'gisoo::h80', 'gisoo::h130', 'gisoo::h60', 'gisoo::h130::splain', 'gisoo::h80::sembroidered']) {
    const r = price(key);
    assert.equal(r.orderItems, undefined, key);
    assert.equal(r.error, 'اندازه یا نوع شید «گیسو» در سبد شما دیگر معتبر نیست. لطفاً آن را از سبد حذف کنید و دوباره انتخاب کنید.');
    assert.equal(ordersLine(key).error, r.error, key);
  }
});

test('a tampered client price is ignored: the price comes from the DB only', () => {
  const v = validateCheckoutBody({
    customer: { name: 'سارا', phone: '+989121234567', city: 'تهران', address: 'خیابان ولیعصر، کوچه ۱۲، پلاک ۳', postcode: '' },
    items: [{ cartKey: 'gisoo::h140::sembroidered', qty: 1, price: 1000, unit_price: 1000, total: 1000 }],
    total: 1000,
  });
  assert.equal(v.error, undefined);
  assert.deepEqual(v.value.items, [{ cartKey: 'gisoo::h140::sembroidered', qty: 1 }]);
  const r = priceCart({ items: v.value.items, products, discountCode: null, city: 'تهران' });
  assert.equal(r.total, 15450000);
  assert.equal(tomanToGatewayAmount(r.total), 154500000);
  // A shade price smuggled into the cart key is not a stored option either.
  assert.ok(price('gisoo::h140::s1000').error);
});

test('a broken stored shade price is never charged as free', () => {
  const broken = { ...gisoo, variants: [{ height: 140, price: 0, shades: { plain: 0, embroidered: 'x' } }] };
  for (const key of ['gisoo::h140::splain', 'gisoo::h140::sembroidered']) {
    const r = priceCart({ items: [{ cartKey: key, qty: 1 }], products: [broken], discountCode: null, city: 'x' });
    assert.match(r.error, /قیمت/);
  }
});

test('products without shade types behave exactly as before', () => {
  assert.equal(price('lamp-a::h140').total, 1500000);
  assert.equal(price('lamp-a::h140::sembroidered').total, 1500000); // shade part ignored
  assert.equal(price('lamp-a::h999').total, 1000000); // existing fallback to base price, unchanged
  assert.equal(price('lamp-a').orderItems[0].name_fa, 'آباژور الف');
  assert.equal(orders.hasShadeTypes(lampA), false);
});

test('shade type labels match in api/orders.js and app.js', () => {
  assert.deepEqual(orders.SHADE_TYPES, SHADE_TYPES);
  const block = read('../../app.js').match(/const SHADE_TYPES = \{([^}]*)\}/);
  assert.ok(block, 'SHADE_TYPES not found in app.js');
  const appTypes = Object.fromEntries([...block[1].matchAll(/(\w+):\s*'([^']*)'/g)].map((m) => [m[1], m[2]]));
  assert.deepEqual(appTypes, SHADE_TYPES);
});
