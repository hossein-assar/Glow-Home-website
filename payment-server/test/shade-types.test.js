// Shades as data (supabase/migration-shade-types.sql): products.shade_types
// names the shades, variants[].shades holds the full price per size. Covers
// the migration mapping, the four copies of shadeTypesOf, server pricing
// from the DB rows only, the storefront page and cart, the admin form's
// validation and markup, and escaping everywhere a shade name is shown.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { SHADE_TYPES, priceCart, shadeTypesOf, validateCheckoutBody } from '../src/pricing.js';
import { paidOrderHtml } from '../src/email.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const appJs = read('../../app.js');
const adminJs = read('../../admin/admin.js');
const adminHtml = read('../../admin/index.html');
const ordersJs = read('../../api/orders.js');
const pricingJs = read('../src/pricing.js');
const sql = read('../../supabase/migration-shade-types.sql');
const schema = read('../../supabase/schema.sql');
const orders = createRequire(import.meta.url)('../../api/orders.js');

const fnSrc = (src, name) => {
  const m = src.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n}\\n`));
  assert.ok(m, `function ${name} not found`);
  return m[0];
};
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Today's three shade products, exactly as their migrations stored them (no shade_types yet).
const GISOO = {
  id: 'g1', slug: 'gisoo', name_fa: 'گیسو', price: 12980000, height_cm: 140, colors: [], in_stock: true,
  variants: [
    { height: 140, price: 12980000, shades: { plain: 12980000, embroidered: 15450000 } },
    { height: 120, price: 9980000, shades: { plain: 9980000, embroidered: 12480000 } },
    { height: 100, price: 9100000, shades: { plain: 9100000, embroidered: 11600000 } },
  ],
};
const DEFORME = {
  id: 'd1', slug: 'deforme', name_fa: 'دفرمه', price: 13100000, height_cm: 140, colors: [], in_stock: true,
  variants: [
    { height: 140, price: 13100000, shades: { plain: 13100000, macrame: 13500000 } },
    { height: 120, price: 10100000, shades: { plain: 10100000, macrame: 10500000 } },
    { height: 100, price: 9400000, shades: { plain: 9400000, macrame: 9800000 } },
  ],
};
const NILA = {
  id: 'n1', slug: 'nila', name_fa: 'نیلا', price: 6500000, height_cm: 40, colors: [], in_stock: true,
  variants: [{ height: 40, price: 6500000, shades: { plain: 6500000, embroidered: 8900000 } }],
};
const LALE = { id: 'l1', slug: 'lale', name_fa: 'لاله', price: 6500000, height_cm: 40, colors: [], in_stock: true, variants: [] };
const MAHTAB = { id: 'm1', slug: 'mahtab', name_fa: 'مهتاب', price: 3500000, height_cm: 40, colors: [], in_stock: true, variants: [{ height: 50, price: 4000000 }] };

// What the migration writes for each of them (mapping in the SQL below).
const T = (key, name_fa, extra = {}) => ({ key, name_fa, name_en: '', in_stock: true, ...extra });
const MIGRATED = {
  gisoo: [T('plain', 'شید ساده'), T('embroidered', 'شید گلدوزی')],
  deforme: [T('plain', 'شید ساده'), T('macrame', 'شید مکرومه')],
  nila: [T('plain', 'شید ساده'), T('embroidered', 'شید گلدوزی')],
};

// A lamp Sahar has given her own shades in the admin: one size, three shades,
// the middle one «ناموجود».
const ROSHA = {
  id: 'r1', slug: 'rosha', name_fa: 'روشا', price: 5200000, height_cm: 45, colors: [], in_stock: true,
  shade_types: [
    { key: 'plain', name_fa: 'شید کتان', name_en: 'Linen', in_stock: true },
    { key: 'k7f3q2a', name_fa: 'شید حصیری', name_en: '', in_stock: false },
    { key: 'kx91mzq', name_fa: 'شید گلدوزی رز', name_en: 'Rose', in_stock: true },
  ],
  variants: [{ height: 45, price: 5200000, shades: { plain: 5200000, k7f3q2a: 5900000, kx91mzq: 7400000 } }],
};

const price = (cartKey, products, qty = 1) => priceCart({ items: [{ cartKey, qty }], products, discountCode: null, city: 'تهران' });

// ---- the migration ---------------------------------------------------------------

test('migration: the original three map to rows with today\'s labels and order (ساده first), nothing else', () => {
  const values = sql.match(/cross join \(values([\s\S]*?)\) as t\(ord, key, name_fa\)/)[1];
  const rows = [...values.matchAll(/\((\d+), '(\w+)',\s*'([^']+)'\)/g)].map((m) => [Number(m[1]), m[2], m[3]]);
  assert.deepEqual(rows, [[1, 'plain', 'شید ساده'], [2, 'embroidered', 'شید گلدوزی'], [3, 'macrame', 'شید مکرومه']]);
  assert.deepEqual(Object.fromEntries(rows.map(([, k, n]) => [k, n])), SHADE_TYPES, 'same as the code\'s fallback labels');
  assert.match(sql, /jsonb_build_object\('key', t\.key, 'name_fa', t\.name_fa, 'name_en', '', 'in_stock', true\)\s*order by t\.ord/);
  // the code's fallback gives exactly what the migration writes, product by product
  for (const p of [GISOO, DEFORME, NILA]) assert.deepEqual(shadeTypesOf(p), MIGRATED[p.slug], p.slug);
  assert.deepEqual(shadeTypesOf(LALE), []);
  assert.deepEqual(shadeTypesOf(MAHTAB), []);
});

test('migration: same prices — only shade_types is written; variants, price, updated_at, orders and RLS untouched', () => {
  const code = sql.split('-- ROLLBACK')[0].replace(/^\s*--.*$/gm, '');
  const sets = [...code.matchAll(/\bset\s+(\w+)\s*=/gi)].map((m) => m[1]);
  assert.deepEqual(sets, ['shade_types'], 'the one column written');
  assert.doesNotMatch(code, /order_items|\borders\b/, 'orders never touched');
  assert.doesNotMatch(code, /\b(create|drop|alter)\s+policy\b|row level security|\bgrant\b|\brevoke\b/i, 'RLS unchanged');
  assert.doesNotMatch(code, /updated_at/);
  // and with the migrated names, every cart key prices exactly as before
  for (const p of [GISOO, DEFORME, NILA]) {
    const migrated = { ...p, shade_types: MIGRATED[p.slug] };
    for (const v of p.variants) {
      for (const key of Object.keys(v.shades)) {
        const cartKey = `${p.slug}::h${v.height}::s${key}`;
        assert.deepEqual(price(cartKey, [migrated]), price(cartKey, [p]), cartKey);
        assert.equal(price(cartKey, [migrated]).orderItems[0].unit_price, v.shades[key]);
      }
    }
  }
});

test('migration: idempotent, one transaction, safety checks, and a rollback section that is commented out', () => {
  assert.match(sql, /^begin;$/m);
  assert.match(sql, /^commit;$/m);
  assert.match(sql, /alter table products add column if not exists shade_types jsonb not null default '\[\]'::jsonb;/);
  assert.match(sql, /if not exists \(select 1 from pg_constraint where conname = 'products_shade_types_is_array'\)/);
  // fills only rows whose list is still empty — an admin edit is never overwritten
  assert.match(sql, /create temp table shade_backfill on commit drop as\s*select id from products where shade_types = '\[\]'::jsonb;/);
  assert.match(sql, /where p\.id = sub\.id\s*and p\.id in \(select id from shade_backfill\);/);
  assert.match(sql, /raise exception 'Unknown shade keys/);
  assert.match(sql, /raise exception 'Shade prices without a named shade/);
  const rollback = sql.split('-- ROLLBACK')[1];
  assert.ok(rollback, 'rollback section');
  for (const line of ['begin;', 'alter table products drop constraint if exists products_shade_types_is_array;', 'alter table products drop column if exists shade_types;', 'commit;']) {
    assert.ok(rollback.includes('-- ' + line), 'commented: ' + line);
  }
  assert.doesNotMatch(rollback, /^(begin|alter|commit)/m, 'nothing in the rollback runs by accident');
  // a fresh install has the column and the same named check
  assert.match(schema, /shade_types jsonb not null default '\[\]' constraint products_shade_types_is_array check \(jsonb_typeof\(shade_types\) = 'array'\)/);
});

// ---- one function, four copies ----------------------------------------------------

test('shadeTypesOf is the same in app.js, admin.js, api/orders.js and pricing.js; shadeLine in both servers', () => {
  const body = fnSrc(pricingJs, 'shadeTypesOf');
  for (const [name, src] of [['app.js', appJs], ['admin.js', adminJs], ['api/orders.js', ordersJs]]) {
    assert.equal(fnSrc(src, 'shadeTypesOf'), body, name);
  }
  assert.equal(fnSrc(ordersJs, 'shadeLine'), fnSrc(pricingJs, 'shadeLine'));
  assert.deepEqual(orders.shadeTypesOf(ROSHA), shadeTypesOf(ROSHA));
});

test('shadeTypesOf: the stored list in its order; bad entries dropped; fallback only when the list is empty', () => {
  assert.deepEqual(shadeTypesOf(ROSHA).map((t) => [t.key, t.name_fa, t.in_stock]), [
    ['plain', 'شید کتان', true], ['k7f3q2a', 'شید حصیری', false], ['kx91mzq', 'شید گلدوزی رز', true],
  ]);
  const messy = {
    variants: [{ height: 40, price: 1, shades: { plain: 1 } }],
    shade_types: [
      { key: 'plain', name_fa: '  شید ساده  ', name_en: null },
      { key: '__proto__', name_fa: 'x' },
      { key: 'Bad Key', name_fa: 'x' },
      { key: 'k1', name_fa: '   ' },
      null,
      'plain',
    ],
  };
  assert.deepEqual(shadeTypesOf(messy), [{ key: 'plain', name_fa: 'شید ساده', name_en: '', in_stock: true }]);
  // a stored list wins over the fallback, even for the original keys
  assert.deepEqual(shadeTypesOf({ ...NILA, shade_types: [T('embroidered', 'گلدوزی')] }).map((t) => t.key), ['embroidered']);
});

// ---- server pricing: from the DB rows only ---------------------------------------

test('pricing: a shade added in the admin is priced from the DB row; the label is its Persian name', () => {
  const r = price('rosha::h45::skx91mzq', [ROSHA], 2);
  assert.equal(r.error, undefined);
  assert.deepEqual(r.orderItems, [{ product_id: 'r1', name_fa: 'روشا (45 سانتی‌متر) — شید گلدوزی رز', qty: 2, unit_price: 7400000 }]);
  assert.equal(r.total, 14800000);
  assert.equal(price('rosha::h45::splain', [ROSHA]).orderItems[0].name_fa, 'روشا (45 سانتی‌متر) — شید کتان', 'renamed: the new name');
});

test('pricing: a tampered client price is ignored — only the cart key is read', () => {
  const v = validateCheckoutBody({
    customer: { name: 'سارا', phone: '+989121234567', city: 'تهران', address: 'خیابان ولیعصر، کوچه ۱۲، پلاک ۳', postcode: '' },
    items: [{ cartKey: 'rosha::h45::skx91mzq', qty: 1, price: 1000, unit_price: 1000, shade: { name_fa: 'x', price: 1 } }],
    total: 1000,
  });
  assert.equal(v.error, undefined);
  assert.deepEqual(v.value.items, [{ cartKey: 'rosha::h45::skx91mzq', qty: 1 }]);
  assert.equal(price(v.value.items[0].cartKey, [ROSHA]).total, 7400000);
});

test('pricing: an unknown, deleted, other-product or prototype shade key is rejected; so is an unavailable shade', () => {
  const invalid = /اندازه یا نوع شید «روشا» در سبد شما دیگر معتبر نیست/;
  for (const key of ['rosha::h45::kdeleted', 'rosha::h45::sembroidered', 'rosha::h45::s__proto__', 'rosha::h45::sconstructor',
    'rosha::h45::s', 'rosha::h45', 'rosha::h50::splain', 'rosha::h45::sشید کتان', 'rosha::h45::sPLAIN']) {
    assert.match(price(key, [ROSHA]).error, invalid, key);
  }
  // a price left in variants for a shade that is no longer listed is not offered
  const removed = { ...ROSHA, shade_types: ROSHA.shade_types.filter((t) => t.key !== 'kx91mzq') };
  assert.match(price('rosha::h45::skx91mzq', [removed]).error, invalid);
  // listed but not stored for that size
  const noPrice = { ...ROSHA, variants: [{ height: 45, price: 5200000, shades: { plain: 5200000 } }] };
  assert.match(price('rosha::h45::skx91mzq', [noPrice]).error, invalid);
  assert.equal(price('rosha::h45::sk7f3q2a', [ROSHA]).error, '«روشا» با «شید حصیری» فعلاً موجود نیست. لطفاً شید دیگری انتخاب کنید.');
  // a zero / missing price is never sent to the gateway
  const zero = { ...ROSHA, variants: [{ height: 45, price: 5200000, shades: { plain: 0, k7f3q2a: 1, kx91mzq: 2 } }] };
  assert.match(price('rosha::h45::splain', [zero]).error, /هنوز مشخص نشده است/);
});

test('pricing: products without shades are priced exactly as before', () => {
  assert.deepEqual(price('lale', [LALE]).orderItems, [{ product_id: 'l1', name_fa: 'لاله', qty: 1, unit_price: 6500000 }]);
  assert.equal(price('mahtab::h50', [MAHTAB]).orderItems[0].unit_price, 4000000);
  assert.equal(price('mahtab::h40', [MAHTAB]).orderItems[0].unit_price, 3500000);
  // an empty shade list on a product without shades changes nothing either
  assert.deepEqual(price('lale', [{ ...LALE, shade_types: [] }]), price('lale', [LALE]));
});

test('old orders keep their own copy: the order line is a snapshot, and no admin save touches orders', () => {
  const line = price('rosha::h45::skx91mzq', [ROSHA]).orderItems[0];
  const renamed = { ...ROSHA, shade_types: ROSHA.shade_types.map((t) => (t.key === 'kx91mzq' ? { ...t, name_fa: 'شید رز' } : t)) };
  price('rosha::h45::skx91mzq', [renamed]);
  assert.equal(line.name_fa, 'روشا (45 سانتی‌متر) — شید گلدوزی رز');
  for (const fn of ['saveProductFull', 'saveProduct', 'shadeFormToSave', 'wireSizesBlock']) {
    assert.doesNotMatch(fnSrc(adminJs, fn), /order_items|from\('orders'\)/, fn);
  }
});

// ---- storefront ------------------------------------------------------------------

const item = (p) => ({
  id: p.slug, fa: p.name_fa, en: '', col: 'lamps', height: p.height_cm, heightFa: `${p.height_cm} سانتی‌متر`, materialFa: 'سفال',
  meta: '', price: p.price, priceFa: 'M' + p.price, colors: [], inStock: p.in_stock, img: 'x.jpg', photos: null, desc: '',
  variants: p.variants, shade_types: p.shade_types || [],
});
function storefront(products, state = {}) {
  const items = products.map(item);
  const code = [
    fnSrc(appJs, 'parseCartKey'),
    appJs.match(/const SHADE_TYPES = [^\n]*\n/)[0],
    ...['hasShadeTypes', 'shadeTypesOf', 'sizeShadesOf', 'defaultShade', 'shadeOption', 'cartLineData', 'cartKeyFor', 'cardCartKey', 'addToCart', 'screenProduct'].map((n) => fnSrc(appJs, n)),
    'return { cardCartKey, cartLineData, addToCart, screenProduct };',
  ].join('\n');
  const st = { cart: {}, favs: {}, selectedShade: null, selectedHeight: null, qty: 1, param: items[0].id, ...state };
  const fns = new Function(
    'state', 'byId', 'ITEMS', 'FA', 'money', 'saveStore', 'esc', 'icon', 'gallery', 'card', 'sizeFa', 'HEIGHT_UNKNOWN',
    code
  )(st, (id) => items.find((x) => x.id === id) || null, items, String, (n) => 'M' + n, () => {}, escapeHtml, () => '', () => '', () => '', String, -1);
  return { ...fns, state: st, items };
}
const options = (html) => [...html.match(/<select id="shade-picker"[^>]*>([\s\S]*?)<\/select>/)[1].matchAll(/<option ([^>]*)>([^<]*)<\/option>/g)].map((m) => ({ attrs: m[1], label: m[2] }));

test('storefront: the picker lists the product\'s own shades in order; «ناموجود» is shown but disabled; first available is the default', () => {
  const sf = storefront([ROSHA]);
  const html = sf.screenProduct();
  assert.deepEqual(options(html), [
    { attrs: 'value="plain" selected', label: 'شید کتان — M5200000' },
    { attrs: 'value="k7f3q2a"  disabled', label: 'شید حصیری — M5900000 (ناموجود)' },
    { attrs: 'value="kx91mzq" ', label: 'شید گلدوزی رز — M7400000' },
  ]);
  assert.match(html, /<dt>نوع شید<\/dt><dd>شید کتان<\/dd>/);
  assert.match(html, /data-act="add-current" data-id="rosha::h45::splain"/);
  // choosing a shade moves the price and the cart key
  const chosen = storefront([ROSHA], { selectedShade: 'kx91mzq' }).screenProduct();
  assert.match(chosen, /<b>M7400000<\/b>/);
  assert.match(chosen, /data-act="add-current" data-id="rosha::h45::skx91mzq"/);
  // an unavailable shade can't be chosen even if the state says so
  assert.match(storefront([ROSHA], { selectedShade: 'k7f3q2a' }).screenProduct(), /data-id="rosha::h45::splain"/);
});

test('storefront: the cart line carries the shade name and its price; a deleted shade drops the line; the card adds the first available', () => {
  const sf = storefront([ROSHA]);
  assert.equal(sf.cardCartKey(sf.items[0]), 'rosha::h45::splain');
  const line = sf.cartLineData('rosha::h45::skx91mzq');
  assert.equal(line.price, 7400000);
  assert.equal(line.shadeFa, 'شید گلدوزی رز');
  assert.match(line.meta, /شید گلدوزی رز/);
  assert.equal(sf.cartLineData('rosha::h45::kdeleted'), null);
  assert.equal(sf.addToCart('rosha::h45::sk_gone'), false);
  // the first shade unavailable → the card adds the next available one
  const first = { ...ROSHA, shade_types: ROSHA.shade_types.map((t, i) => ({ ...t, in_stock: i === 2 })) };
  assert.equal(storefront([first]).cardCartKey(item(first)), 'rosha::h45::skx91mzq');
});

test('storefront: no shade available at that size → nothing can be added, with a clear message', () => {
  const none = { ...ROSHA, shade_types: ROSHA.shade_types.map((t) => ({ ...t, in_stock: false })) };
  const sf = storefront([none]);
  const html = sf.screenProduct();
  assert.doesNotMatch(html, /data-act="add-current"|data-act="buy-now"/);
  assert.match(html, /این اندازه فعلاً با هیچ شیدی موجود نیست/);
  assert.equal(sf.cardCartKey(sf.items[0]), null, 'the card opens the page instead');
});

test('storefront: today\'s shade products and products without shades look and add exactly as before', () => {
  for (const p of [NILA, { ...NILA, shade_types: MIGRATED.nila }]) {
    const sf = storefront([p]);
    assert.equal(sf.cardCartKey(sf.items[0]), 'nila::h40::splain');
    assert.deepEqual(options(sf.screenProduct()).map((o) => o.label), ['شید ساده — M6500000', 'شید گلدوزی — M8900000']);
  }
  const lale = storefront([LALE]);
  assert.equal(lale.cardCartKey(lale.items[0]), 'lale');
  assert.doesNotMatch(lale.screenProduct(), /shade-picker|نوع شید/);
});

test('storefront: shade names and keys are escaped on the page and in the cart line', () => {
  const evil = {
    ...ROSHA,
    shade_types: [{ key: 'plain', name_fa: '<img src=x onerror=alert(1)>"\'', name_en: '<b>', in_stock: true }],
    variants: [{ height: 45, price: 5200000, shades: { plain: 5200000 } }],
  };
  const sf = storefront([evil]);
  const html = sf.screenProduct();
  assert.ok(!html.includes('<img src=x'), 'raw tag on the page');
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;&quot;&#39;'));
  // the cart meta goes through esc() where it is shown (screenCart)
  assert.match(appJs, /<div class="cart-meta">\$\{esc\(r\.meta\)\}/);
  // print and email show order_items.name_fa — escaped there too
  const mail = paidOrderHtml({ code: 'GH-1', total: 1 }, [{ product_id: 'p', name_fa: 'روشا — <img src=x onerror=alert(1)>', qty: 1, unit_price: 1 }]);
  assert.ok(!mail.includes('<img src=x') && mail.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.match(fnSrc(adminJs, 'orderPrintHtml'), /\$\{escapeHtml\(it\.name_fa\)\}/);
});

// ---- admin ------------------------------------------------------------------------

const admin = new Function(
  [
    ...['toLatinDigits', 'unformatPrice', 'formatPrice', 'faNum', 'escapeHtml', 'escapeAttr', 'newShadeKey', 'shadeFormToSave', 'shadesNeedMigration', 'shadeBlockHtml'].map((n) => fnSrc(adminJs, n)),
    adminJs.match(/const SHADE_TYPES = [^\n]*\n/)[0],
    adminJs.match(/const SHADE_NAME_MAX = [^\n]*\n/)[0],
    'return { shadeFormToSave, shadesNeedMigration, shadeBlockHtml, newShadeKey };',
  ].join('\n')
)();
const form = (shades, sizes = ['45'], baseHeight = '45') => ({ sizes, baseHeight, shades });
const S = (key, name_fa, prices, extra = {}) => ({ key, name_fa, name_en: '', in_stock: true, prices, ...extra });

test('admin: saving shades writes the list in order, the full price per size, and price = base size with the first shade', () => {
  const r = admin.shadeFormToSave(form([S('plain', ' شید  کتان ', ['5,200,000'], { name_en: ' Linen ' }), S('k7f3q2a', 'شید حصیری', ['۵۹۰۰۰۰۰'], { in_stock: false })]));
  assert.deepEqual(r, {
    variants: [{ height: 45, price: 5200000, shades: { plain: 5200000, k7f3q2a: 5900000 } }],
    shade_types: [
      { key: 'plain', name_fa: 'شید کتان', name_en: 'Linen', in_stock: true },
      { key: 'k7f3q2a', name_fa: 'شید حصیری', name_en: '', in_stock: false },
    ],
    price: 5200000,
  });
  // گیسو as today: three sizes, base 140 → unchanged variants and price
  const g = admin.shadeFormToSave(form(
    [S('plain', 'شید ساده', ['12,980,000', '9,980,000', '9,100,000']), S('embroidered', 'شید گلدوزی', ['15,450,000', '12,480,000', '11,600,000'])],
    ['140', '120', '100'], '140'
  ));
  assert.deepEqual(g.variants, GISOO.variants);
  assert.equal(g.price, GISOO.price);
  assert.deepEqual(g.shade_types, MIGRATED.gisoo);
});

test('admin: adding, renaming and removing a shade', () => {
  const base = [S('plain', 'شید ساده', ['6,500,000']), S('embroidered', 'شید گلدوزی', ['8,900,000'])];
  const added = admin.shadeFormToSave(form([...base, S('k1a2b3c', 'شید مکرومه‌ی کرم', ['9,400,000'])], ['40'], '40'));
  assert.deepEqual(added.shade_types.map((t) => t.key), ['plain', 'embroidered', 'k1a2b3c']);
  assert.equal(added.variants[0].shades.k1a2b3c, 9400000);
  const renamed = admin.shadeFormToSave(form([S('plain', 'شید کتان', ['6,500,000']), base[1]], ['40'], '40'));
  assert.equal(renamed.shade_types[0].key, 'plain', 'a rename keeps the key — carts still work');
  assert.equal(renamed.shade_types[0].name_fa, 'شید کتان');
  const removed = admin.shadeFormToSave(form([base[1]], ['40'], '40'));
  assert.deepEqual(removed.variants, [{ height: 40, price: 8900000, shades: { embroidered: 8900000 } }], 'no price left behind');
  assert.equal(removed.price, 8900000, 'the first remaining shade is the base price');
  // new keys are unique and valid
  const taken = ['plain'];
  for (let i = 0; i < 50; i++) {
    const k = admin.newShadeKey(taken);
    assert.match(k, /^k[a-z0-9]{6}$/);
    assert.ok(!taken.includes(k));
    taken.push(k);
  }
});

test('admin validation: clear Persian errors for a missing name, a duplicate, a bad price, a bad size', () => {
  const err = (f) => admin.shadeFormToSave(f).error;
  assert.equal(err(form([S('plain', '  ', ['1'])])), 'خطا: نام فارسی شید ردیف ۱ را وارد کنید.');
  assert.equal(err(form([S('plain', 'شید ساده', ['1']), S('k1', 'شيد  ساده', ['2'])])), 'خطا: شید «شيد ساده» دو بار آمده است. نام هر شید باید متفاوت باشد.', 'ي and spaces count as the same name');
  assert.match(err(form([S('plain', 'Linen', ['1']), S('k1', 'linen', ['2'])])), /دو بار آمده است/);
  for (const bad of ['', '0', '۰', 'abc', '-', undefined]) {
    assert.equal(err(form([S('plain', 'شید ساده', [bad])])), 'خطا: قیمت شید «شید ساده» برای اندازه‌ی 45 سانتی‌متر را به تومان (عدد صحیح بزرگ‌تر از صفر) وارد کنید.', String(bad));
  }
  assert.equal(err(form([S('plain', 'شید ساده', ['1', ''])], ['45', '60'])), 'خطا: قیمت شید «شید ساده» برای اندازه‌ی 60 سانتی‌متر را به تومان (عدد صحیح بزرگ‌تر از صفر) وارد کنید.');
  assert.equal(err(form([S('plain', 'ش'.repeat(41), ['1'])])), `خطا: نام شید «${'ش'.repeat(41)}» بیش از ۴۰ حرف است.`);
  assert.equal(err(form([])), 'خطا: دست‌کم یک شید لازم است.');
  assert.equal(err(form([S('plain', 'شید ساده', ['1', '2'])], ['45', '45'])), 'خطا: اندازه‌ی 45 سانتی‌متر دو بار آمده است. یکی را حذف کنید.');
  assert.equal(err(form([S('plain', 'شید ساده', ['1'])], ['45.5'], '45.5')), 'خطا: ارتفاع هر اندازه را به سانتی‌متر (عدد صحیح بزرگ‌تر از صفر) وارد کنید.');
  assert.equal(err(form([S('plain', 'شید ساده', ['1'])], ['45'], '50')), 'خطا: «ارتفاع پایه» باید یکی از اندازه‌ها باشد.');
  assert.equal(err(form([S('plain', 'شید ساده', ['1'])], [], '45')), 'خطا: دست‌کم یک اندازه لازم است.');
  assert.match(err(form([S('Bad', 'شید ساده', ['1'])])), /شناسه/);
  assert.match(err(form([S('plain', 'a', ['1']), S('plain', 'b', ['1'])])), /شناسه/, 'two rows with one key');
  // Persian digits and separators are accepted
  assert.equal(admin.shadeFormToSave(form([S('plain', 'شید ساده', ['۷٬۴۰۰٬۰۰۰'])], ['۴۵'], '۴۵')).price, 7400000);
});

test('admin: before the SQL has run, only the original three, unchanged, can be saved', () => {
  const noColumn = { variants: NILA.variants }; // a row loaded before the migration
  assert.equal(admin.shadesNeedMigration(noColumn, MIGRATED.nila), false);
  assert.equal(admin.shadesNeedMigration(noColumn, [T('plain', 'شید کتان')]), true);
  assert.equal(admin.shadesNeedMigration(noColumn, [T('k1a2b3c', 'شید نو')]), true);
  assert.equal(admin.shadesNeedMigration(noColumn, [T('plain', 'شید ساده', { in_stock: false })]), true);
  assert.equal(admin.shadesNeedMigration({ ...noColumn, shade_types: [] }, [T('k1a2b3c', 'شید نو')]), false);
  const save = fnSrc(adminJs, 'saveProductFull');
  assert.match(save, /if \(cachedRow && 'shade_types' in cachedRow\) fields\.shade_types = shade_types;/);
  assert.match(save, /if \(shadesNeedMigration\(cachedRow, saved\.shade_types\)\)/);
});

test('admin form: «شیدها» rows — name, English name, «موجود», a price per size, «حذف», «+ افزودن شید»; every value escaped', () => {
  const html = admin.shadeBlockHtml('p1', {
    sizes: ['140', '120'],
    shades: [S('plain', '<script>x</script>"', ['12980000', '9980000'], { name_en: '"><b>' }), S('k7f3q2a', 'شید حصیری', ['', ''], { in_stock: false })],
  });
  assert.equal((html.match(/class="shade-row"/g) || []).length, 2);
  assert.equal((html.match(/class="s-name-fa"/g) || []).length, 2);
  assert.equal((html.match(/class="s-name-en" dir="ltr"/g) || []).length, 2);
  assert.equal((html.match(/class="s-in-stock" checked>/g) || []).length, 1, 'the unavailable one is unchecked');
  assert.equal((html.match(/class="btn ghost remove-shade"/g) || []).length, 2);
  assert.equal((html.match(/class="s-price price-input"/g) || []).length, 4, 'two shades × two sizes');
  assert.match(html, /<span>قیمت — 140 سانتی‌متر<\/span>/);
  assert.match(html, /value="12,980,000"/);
  assert.match(html, /id="add-shade-p1"[^>]*>\+ افزودن شید<\/button>/);
  assert.ok(!html.includes('<script>') && !html.includes('"><b>'));
  assert.ok(html.includes('value="&lt;script&gt;x&lt;/script&gt;&quot;"'));
  // one size → one «قیمت» box per shade, no size label
  const one = admin.shadeBlockHtml('p2', { sizes: ['45'], shades: [S('plain', 'شید ساده', ['5200000'])] });
  assert.match(one, /<span>قیمت<\/span>/);
  // products without shades show the heading and «+ افزودن شید» under their sizes
  assert.match(fnSrc(adminJs, 'plainSizesBlockHtml'), /id="add-shade-\$\{id\}" type="button">\+ افزودن شید<\/button>/);
  // saved with «ذخیره همه», like everything else
  assert.match(fnSrc(adminJs, 'saveProductFull'), /shadeFormToSave\(\{ \.\.\.readShadeBlock\(id\), baseHeight: heightVal \}\)/);
});

test('admin form works at phone width: shade rows and price boxes wrap', () => {
  assert.match(adminHtml, /\.shade-row-head \{ display: flex; flex-wrap: wrap;/);
  assert.match(adminHtml, /\.shade-prices \{ display: flex; flex-wrap: wrap;/);
  assert.match(adminHtml, /\.s-price-cell \{ flex: 1 1 160px; min-width: 0;/);
  // the panel opens inside the sideways-scrolling products table: it keeps
  // the visible width and stays put, so no price box is off screen
  assert.match(adminHtml, /<div class="products-scroll" style="overflow-x:auto">\s*<table id="products-table">/);
  assert.match(adminHtml, /\.products-scroll \{ container-type: inline-size; \}/);
  assert.match(adminHtml, /\.edit-panel \{ position: sticky; right: 0; width: 100cqw; \}/);
  assert.match(adminJs, /<div class="edit-panel" id="edit-panel-\$\{p\.id\}"><\/div>/);
  assert.match(adminHtml, /@media \(max-width: 600px\) \{\s*\.edit-grid \{ grid-template-columns: 1fr; \}/);
});
