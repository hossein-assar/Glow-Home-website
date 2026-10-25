// نیلا: shade type (plain / embroidered) on its single 40 cm size, on the same
// mechanism as گیسو and دفرمه (supabase/migration-nila-shades.sql). Covers
// both server copies of the pricing — payment-server/src/pricing.js and
// api/orders.js (loaded with a stub require, it's a CommonJS Vercel
// function) — the storefront's cart and product page (one size: shade
// picker, no size picker) and the admin price boxes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { SHADE_TYPES, priceCart, validateCheckoutBody } from '../src/pricing.js';
import { tomanToGatewayAmount } from '../src/config.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const appJs = read('../../app.js');
const adminJs = read('../../admin/admin.js');
const migration = read('../../supabase/migration-nila-shades.sql');

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

// The same shape supabase/migration-nila-shades.sql writes.
const nila = {
  id: 'n1',
  slug: 'nila',
  name_fa: 'نیلا',
  price: 6500000,
  variants: [{ height: 40, price: 6500000, shades: { plain: 6500000, embroidered: 8900000 } }],
  colors: [],
  in_stock: true,
};
const products = [nila];

const price = (cartKey, qty = 1) => priceCart({ items: [{ cartKey, qty }], products, discountCode: null, city: 'شیراز' });
const ordersLine = (cartKey) => {
  const { height, shade } = orders.parseCartKey(cartKey);
  return orders.shadeLine(nila, height, shade);
};
const staleError = 'اندازه یا نوع شید «نیلا» در سبد شما دیگر معتبر نیست. لطفاً آن را از سبد حذف کنید و دوباره انتخاب کنید.';

test('the migration writes exactly the shape these tests price', () => {
  assert.match(migration, /\{"height": 40, "price": 6500000, "shades": \{"plain": 6500000, "embroidered": 8900000\}\}/);
  assert.match(migration, /price = 6500000,/);
  assert.match(migration, /where slug = 'nila';/);
  assert.doesNotMatch(migration, /^\s+height_cm\s*=/m); // checked, not changed
});

for (const [shade, toman, rial] of [['plain', 6500000, 65000000], ['embroidered', 8900000, 89000000]]) {
  test(`nila h40 ${shade}: ${toman} Toman = ${rial} Rial, same in both servers`, () => {
    const key = `nila::h40::s${shade}`;
    const r = price(key);
    assert.equal(r.error, undefined);
    assert.equal(r.orderItems[0].unit_price, toman);
    assert.equal(r.total, toman);
    assert.equal(tomanToGatewayAmount(r.total), rial);
    assert.equal(r.orderItems[0].name_fa, `نیلا (40 سانتی‌متر) — ${SHADE_TYPES[shade]}`);
    assert.deepEqual(ordersLine(key), { price: toman, label: r.orderItems[0].name_fa });
    // quantity multiplies the DB price
    assert.equal(price(key, 3).total, toman * 3);
  });
}

test('both shades together in one cart', () => {
  const r = priceCart({
    items: [{ cartKey: 'nila::h40::splain', qty: 1 }, { cartKey: 'nila::h40::sembroidered', qty: 2 }],
    products,
    discountCode: null,
    city: 'تهران',
  });
  assert.equal(r.total, 6500000 + 2 * 8900000);
  assert.equal(tomanToGatewayAmount(r.total), 243000000);
});

test('old and unknown nila keys are rejected with the Persian error, in both servers', () => {
  for (const key of ['nila', 'nila::h40', 'nila::h40::smacrame', 'nila::h40::sgold', 'nila::h50::splain', 'nila::h100::sembroidered', 'nila::splain']) {
    const r = price(key);
    assert.equal(r.orderItems, undefined, key);
    assert.equal(r.error, staleError, key);
    assert.equal(ordersLine(key).error, staleError, key);
  }
});

test('a tampered client price for nila is ignored: the price comes from the DB only', () => {
  const v = validateCheckoutBody({
    customer: { name: 'سارا', phone: '+989121234567', city: 'تهران', address: 'خیابان ولیعصر، کوچه ۱۲، پلاک ۳', postcode: '' },
    items: [{ cartKey: 'nila::h40::sembroidered', qty: 1, price: 1000, unit_price: 1000 }],
    total: 1000,
  });
  assert.equal(v.error, undefined);
  assert.deepEqual(v.value.items, [{ cartKey: 'nila::h40::sembroidered', qty: 1 }]);
  const r = priceCart({ items: v.value.items, products, discountCode: null, city: 'تهران' });
  assert.equal(r.total, 8900000);
  assert.equal(tomanToGatewayAmount(r.total), 89000000);
});

test('shade labels are the same in app.js, api/orders.js, payment-server and admin', () => {
  const labels = (src) => src.match(/const SHADE_TYPES = (\{[^\n]*\});/)[1];
  const expected = "{ plain: 'شید ساده', embroidered: 'شید گلدوزی', macrame: 'شید مکرومه' }";
  for (const [name, src] of [['app.js', appJs], ['api/orders.js', read('../../api/orders.js')], ['admin.js', adminJs], ['pricing.js', read('../src/pricing.js')]]) {
    assert.equal(labels(src), expected, name);
  }
  assert.deepEqual(orders.SHADE_TYPES, SHADE_TYPES);
});

test('shade products are recognised by their data, not by a slug list', () => {
  for (const src of [appJs, adminJs, read('../../api/orders.js'), read('../src/pricing.js')]) {
    assert.doesNotMatch(src, /['"](gisoo|deforme|nila)['"]/);
  }
});

// ---- storefront -----------------------------------------------------------------

const fnSrc = (src, name) => {
  const m = src.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n}\\n`));
  assert.ok(m, `function ${name} not found`);
  return m[0];
};
const item = {
  id: 'nila', fa: 'نیلا', en: '', col: 'lamps', height: 40, heightFa: '۴۰ سانتی‌متر', materialFa: 'سفال', meta: '۴۰ سانتی‌متر · سفال',
  price: 6500000, priceFa: 'M6500000', colors: [], inStock: true, img: 'images/nila.jpg', photos: null, desc: '',
  variants: nila.variants,
};

function storefront(state = { cart: {}, favs: {}, selectedShade: 'plain', selectedHeight: 40, param: 'nila' }) {
  const code = [
    fnSrc(appJs, 'parseCartKey'),
    appJs.match(/const SHADE_TYPES = [^\n]*\n/)[0],
    ...['hasShadeTypes', 'shadeOption', 'cartLineData', 'cartKeyFor', 'cardCartKey', 'addToCart', 'screenProduct'].map((n) => fnSrc(appJs, n)),
    'return { cardCartKey, cartLineData, addToCart, screenProduct };',
  ].join('\n');
  const fns = new Function(
    'state', 'byId', 'ITEMS', 'FA', 'money', 'saveStore', 'esc', 'icon', 'gallery', 'card', 'sizeFa', 'HEIGHT_UNKNOWN',
    code
  )(state, (id) => (id === 'nila' ? item : null), [item], String, (n) => 'M' + n, () => {}, (s) => String(s ?? ''), () => '', () => '', () => '', String, -1);
  return { ...fns, state };
}

test('nila card adds 40 cm with the plain shade; cart lines price per shade', () => {
  const sf = storefront();
  assert.equal(sf.cardCartKey(item), 'nila::h40::splain');
  assert.equal(sf.addToCart(sf.cardCartKey(item)), true);
  assert.deepEqual(sf.state.cart, { 'nila::h40::splain': 1 });
  assert.equal(sf.cartLineData('nila::h40::splain').price, 6500000);
  assert.equal(sf.cartLineData('nila::h40::sembroidered').price, 8900000);
  assert.equal(sf.cartLineData('nila::h40::sembroidered').shadeFa, 'شید گلدوزی');
});

test('stale nila cart keys cannot be added, and are the ones the catalog load drops', () => {
  const sf = storefront();
  for (const key of ['nila', 'nila::h40', 'nila::h40::smacrame', 'nila::h50::splain']) {
    assert.equal(sf.addToCart(key), false, key);
    assert.equal(sf.cartLineData(key), null, key); // loadProductsFromSupabase drops lines where this is null
  }
  assert.deepEqual(sf.state.cart, {});
  assert.match(appJs, /if \(p && !cartLineData\(key\)\) \{\n\s*delete state\.cart\[key\];/);
});

test('nila product page: «نوع شید» picker with both shades, no size picker, price and cart key follow the shade', () => {
  for (const [shade, priceFa] of [['plain', 'M6500000'], ['embroidered', 'M8900000']]) {
    const html = storefront({ cart: {}, favs: {}, selectedShade: shade, selectedHeight: 40, param: 'nila' }).screenProduct();
    assert.match(html, /<label for="shade-picker">نوع شید<\/label>/);
    assert.match(html, /<option value="plain" [^>]*>شید ساده — M6500000<\/option>/);
    assert.match(html, /<option value="embroidered" [^>]*>شید گلدوزی — M8900000<\/option>/);
    assert.doesNotMatch(html, /<option value="macrame"/);
    assert.match(html, new RegExp(`<option value="${shade}" selected>`));
    assert.doesNotMatch(html, /height-picker/); // one size: no size picker
    assert.match(html, new RegExp(`<div class="price-row">\\s*<b>${priceFa}</b>`));
    assert.match(html, new RegExp(`data-id="nila::h40::s${shade}"`));
  }
});

test('card shows «· چند اندازه» only for more than one size: not nila, yes gisoo', () => {
  const card = new Function(
    'state', 'byId', 'cardCartKey', 'icon', 'esc',
    `${fnSrc(appJs, 'media')}${fnSrc(appJs, 'card')} return card;`
  )({ favs: {}, cart: {} }, () => null, () => null, () => '', (s) => String(s ?? ''));
  const gisoo = {
    ...item, id: 'gisoo', fa: 'گیسو', meta: '۱۰۰ سانتی‌متر · سفال',
    variants: [100, 120, 140].map((height) => ({ height, price: 1, shades: { plain: 1, embroidered: 2 } })),
  };
  assert.doesNotMatch(card(item), /چند اندازه/);
  assert.match(card(gisoo), /<span class="card-meta">۱۰۰ سانتی‌متر · سفال · چند اندازه<\/span>/);
  assert.doesNotMatch(card({ ...item, variants: [] }), /چند اندازه/);
});

// ---- admin ---------------------------------------------------------------------

test('admin shows one row (40 cm) with «شید ساده» and «شید گلدوزی» price boxes for nila', () => {
  const code = [
    ...['toLatinDigits', 'unformatPrice', 'formatPrice'].map((n) => fnSrc(adminJs, n)),
    adminJs.match(/const SHADE_TYPES = [^\n]*\n/)[0],
    adminJs.match(/const hasShadeTypes = [\s\S]*?;\n/)[0],
    adminJs.match(/const shadeKeysOf = [\s\S]*?;\n/)[0],
    fnSrc(adminJs, 'shadeVariantRowHtml'),
    'return { hasShadeTypes, shadeKeysOf, shadeVariantRowHtml };',
  ].join('\n');
  const { hasShadeTypes, shadeKeysOf, shadeVariantRowHtml } = new Function(code)();
  assert.equal(hasShadeTypes(nila), true);
  assert.deepEqual(shadeKeysOf(nila), ['plain', 'embroidered']);
  const row = shadeVariantRowHtml(0, shadeKeysOf(nila), nila.variants[0]);
  const placeholders = [...row.matchAll(/placeholder="([^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(placeholders, ['ارتفاع (سانتی‌متر)', 'قیمت شید ساده (تومان)', 'قیمت شید گلدوزی (تومان)']);
  assert.match(row, /class="v-height" value="40"/);
  assert.match(row, /data-shade="plain" value="6,500,000"/);
  assert.match(row, /data-shade="embroidered" value="8,900,000"/);
});
