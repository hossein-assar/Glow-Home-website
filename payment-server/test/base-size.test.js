// The base size is a size. «مهتاب» (shade-embroidered-cylinder) has base
// height 40 / price 3,500,000 and a size list of ONE row, 50 / 4,000,000 —
// older rows stored only the *other* sizes in `variants`. The storefront saw
// one size and showed no size picker. Now:
//   - admin «ویرایش کامل» shows the base size as the first, read-only row and
//     saves the complete list (admin/admin.js);
//   - the storefront and both servers treat height_cm + products.price as a
//     size when no variant has that height (withBaseSize), and price strictly:
//     an unknown height is rejected, a client price is never read;
//   - shade-type products (گیسو, دفرمه, نیلا) are unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { withBaseSize, sizeLine, priceCart, validateCheckoutBody } from '../src/pricing.js';
import { tomanToGatewayAmount } from '../src/config.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const appJs = read('../../app.js');
const adminJs = read('../../admin/admin.js');
const ordersJs = read('../../api/orders.js');
const pricingJs = read('../src/pricing.js');
const dbJs = read('../src/db.js');

const grab = (src, re) => {
  const m = src.match(re);
  assert.ok(m, 'not found: ' + re);
  return m[0];
};
const fnSrc = (src, name) => grab(src, new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\n}\\n`));

// The live row, as read from the catalog on 2026-10-25.
const mahtab = {
  id: 'm1',
  slug: 'shade-embroidered-cylinder',
  name_fa: 'شید گلدوزی مهتاب',
  price: 3500000,
  height_cm: 40,
  variants: [{ height: 50, price: 4000000 }],
  colors: [],
  in_stock: true,
};
const nila = {
  id: 'n1', slug: 'nila', name_fa: 'نیلا', price: 6500000, height_cm: 40, colors: [], in_stock: true,
  variants: [{ height: 40, price: 6500000, shades: { plain: 6500000, embroidered: 8900000 } }],
};
const gisoo = {
  id: 'g1', slug: 'gisoo', name_fa: 'گیسو', price: 9100000, height_cm: 100, colors: [], in_stock: true,
  variants: [
    { height: 140, price: 12980000, shades: { plain: 12980000, embroidered: 15450000 } },
    { height: 120, price: 9980000, shades: { plain: 9980000, embroidered: 12480000 } },
    { height: 100, price: 9100000, shades: { plain: 9100000, embroidered: 11600000 } },
  ],
};
const lale = { id: 'l1', slug: 'lale', name_fa: 'لاله', price: 6500000, height_cm: 40, variants: [], colors: [], in_stock: true };

// ---- withBaseSize: one function, four copies ------------------------------------

test('withBaseSize is the same function in app.js, admin.js, api/orders.js and pricing.js', () => {
  const body = (src) => fnSrc(src, 'withBaseSize');
  const reference = body(pricingJs);
  for (const [name, src] of [['app.js', appJs], ['admin/admin.js', adminJs], ['api/orders.js', ordersJs]]) {
    assert.equal(body(src), reference, name);
  }
});

test('withBaseSize: the base size first when no variant has its height', () => {
  assert.deepEqual(withBaseSize(mahtab.variants, 40, 3500000), [{ height: 40, price: 3500000 }, { height: 50, price: 4000000 }]);
  // Already a row: unchanged, no duplicate, order kept (اقاقیا کنار سالنی).
  const tall = [{ height: 140, price: 12980000 }, { height: 120, price: 9980000 }, { height: 100, price: 9100000 }];
  assert.equal(withBaseSize(tall, 140, 12980000), tall);
  // No sizes stays no sizes: a single-size product gets no list, no picker.
  assert.deepEqual(withBaseSize([], 40, 6500000), []);
  assert.deepEqual(withBaseSize(null, 40, 6500000), []);
  // No usable base: unchanged.
  for (const [h, p] of [[null, 3500000], ['unknown', 3500000], [-1, 3500000], [40, 0], [40, null], [40.5, 3500000]]) {
    assert.deepEqual(withBaseSize(mahtab.variants, h, p), mahtab.variants, `${h} / ${p}`);
  }
});

test('withBaseSize leaves shade-type products exactly as stored', () => {
  assert.equal(withBaseSize(gisoo.variants, 80, 9100000), gisoo.variants); // base not a size: still not added
  assert.equal(withBaseSize(nila.variants, 40, 6500000), nila.variants);
});

// ---- both servers ------------------------------------------------------------------

/** api/orders.js run end to end against a fake Supabase client. */
async function postOrder(items, products = [mahtab]) {
  const inserted = {};
  const selected = [];
  const sb = {
    from(table) {
      return {
        select: (cols) => (selected.push(cols), { in: async () => ({ data: products, error: null }) }),
        insert(row) {
          inserted[table] = row;
          return table === 'orders'
            ? { select: () => ({ single: async () => ({ data: { id: 1, ...row }, error: null }) }) }
            : Promise.resolve({ error: null });
        },
      };
    },
    rpc: async () => ({ data: 1000, error: null }),
  };
  const mod = { exports: {} };
  const stubRequire = (id) => {
    if (id === '@supabase/supabase-js') return { createClient: () => sb };
    throw new Error('unexpected require ' + id);
  };
  new Function('require', 'module', 'exports', ordersJs)(stubRequire, mod, mod.exports);

  const saved = { ...process.env };
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';
  delete process.env.RESEND_API_KEY;
  let status, json;
  const res = { status(s) { status = s; return this; }, json(j) { json = j; return this; } };
  try {
    await mod.exports(
      {
        method: 'POST',
        body: {
          customer: { name: 'سارا', phone: '+989121234567', city: 'تهران', address: 'خیابان ولیعصر، کوچه ۱۲، پلاک ۳', postcode: '' },
          items,
          total: 1,
        },
      },
      res
    );
  } finally {
    process.env = saved;
  }
  return { status, json, items: inserted.order_items, selected };
}

const customer = { name: 'سارا', phone: '+989121234567', city: 'تهران', address: 'خیابان ولیعصر، کوچه ۱۲، پلاک ۳', postcode: '' };
/** payment-server: the same validate + price pair its /api/checkout runs. */
function payServer(items, products = [mahtab]) {
  const v = validateCheckoutBody({ customer, items, total: 1 });
  assert.equal(v.error, undefined);
  return priceCart({ items: v.value.items, products, discountCode: null, city: 'تهران' });
}

for (const [height, toman] of [[40, 3500000], [50, 4000000]]) {
  const key = `shade-embroidered-cylinder::h${height}`;
  test(`${key}: ${toman} Toman in both servers, labelled with its size`, async () => {
    const label = `شید گلدوزی مهتاب (${height} سانتی‌متر)`;
    const r = payServer([{ cartKey: key, qty: 2 }]);
    assert.equal(r.error, undefined);
    assert.deepEqual(r.orderItems, [{ product_id: 'm1', name_fa: label, qty: 2, unit_price: toman }]);
    assert.equal(r.total, toman * 2);
    assert.equal(tomanToGatewayAmount(r.total), toman * 2 * 10);

    const o = await postOrder([{ cartKey: key, qty: 2 }]);
    assert.equal(o.status, 200, JSON.stringify(o.json));
    assert.equal(o.json.total, toman * 2);
    assert.deepEqual(o.items.map(({ name_fa, qty, unit_price }) => ({ name_fa, qty, unit_price })), [{ name_fa: label, qty: 2, unit_price: toman }]);
  });
}

test('both sizes of مهتاب in one cart are two lines at their own prices', async () => {
  const items = [{ cartKey: 'shade-embroidered-cylinder::h40', qty: 1 }, { cartKey: 'shade-embroidered-cylinder::h50', qty: 1 }];
  assert.equal(payServer(items).total, 7500000);
  const o = await postOrder(items);
  assert.equal(o.json.total, 7500000);
  assert.deepEqual(o.items.map((i) => i.unit_price), [3500000, 4000000]);
});

test('a tampered client price is ignored in both servers: the price comes from the DB', async () => {
  const items = [{ cartKey: 'shade-embroidered-cylinder::h50', qty: 1, price: 1000, unit_price: 1000 }];
  const v = validateCheckoutBody({ customer, items, total: 1000 });
  assert.deepEqual(v.value.items, [{ cartKey: 'shade-embroidered-cylinder::h50', qty: 1 }]);
  assert.equal(payServer(items).total, 4000000);
  const o = await postOrder(items);
  assert.equal(o.json.total, 4000000);
  assert.equal(o.items[0].unit_price, 4000000);
});

test('unknown heights are rejected in both servers, never priced at the base price', async () => {
  const error = 'اندازه‌ی «شید گلدوزی مهتاب» در سبد شما دیگر معتبر نیست. لطفاً آن را از سبد حذف کنید و دوباره انتخاب کنید.';
  for (const key of ['shade-embroidered-cylinder::h60', 'shade-embroidered-cylinder::h0', 'shade-embroidered-cylinder::hx', 'shade-embroidered-cylinder::h']) {
    assert.equal(payServer([{ cartKey: key, qty: 1 }]).error, error, key);
    const o = await postOrder([{ cartKey: key, qty: 1 }]);
    assert.equal(o.status, 400, key);
    assert.equal(o.json.error, error, key);
    assert.equal(o.items, undefined, key); // no order written
  }
  // A height on a product with no sizes is not a size either.
  assert.match(payServer([{ cartKey: 'lale::h40', qty: 1 }], [lale]).error, /دیگر معتبر نیست/);
  assert.equal((await postOrder([{ cartKey: 'lale::h40', qty: 1 }], [lale])).status, 400);
});

test('a key with no height is the base size, as before', async () => {
  assert.deepEqual(sizeLine(mahtab, null), { price: 3500000, label: 'شید گلدوزی مهتاب' });
  assert.equal(payServer([{ cartKey: 'lale', qty: 1 }], [lale]).total, 6500000);
  assert.equal((await postOrder([{ cartKey: 'lale', qty: 1 }], [lale])).json.total, 6500000);
});

test('both servers read height_cm with the product', async () => {
  assert.match(dbJs, /\.select\('id, slug, name_fa, price, height_cm, variants, colors, in_stock'\)/);
  const o = await postOrder([{ cartKey: 'shade-embroidered-cylinder::h40', qty: 1 }]);
  assert.deepEqual(o.selected, ['id, slug, name_fa, price, height_cm, variants, colors, in_stock']);
});

test('shade-type products are unchanged: strict shade keys, no base size added', async () => {
  for (const [key, toman] of [['nila::h40::sembroidered', 8900000], ['gisoo::h120::splain', 9980000]]) {
    assert.equal(payServer([{ cartKey: key, qty: 1 }], [nila, gisoo]).total, toman, key);
    assert.equal((await postOrder([{ cartKey: key, qty: 1 }], [nila, gisoo])).json.total, toman, key);
  }
  for (const key of ['nila::h40', 'gisoo::h100', 'gisoo::h80::splain']) {
    assert.match(payServer([{ cartKey: key, qty: 1 }], [nila, gisoo]).error, /نوع شید/, key);
    assert.equal((await postOrder([{ cartKey: key, qty: 1 }], [nila, gisoo])).status, 400, key);
  }
});

// ---- storefront --------------------------------------------------------------------

/** The storefront item buildItems() makes from the live row. */
const fnFromApp = (name) => new Function(`${fnSrc(appJs, name)} return ${name};`)();
const appWithBaseSize = fnFromApp('withBaseSize');
const item = {
  id: 'shade-embroidered-cylinder', fa: 'شید گلدوزی مهتاب', en: '', col: 'shades', height: 40, heightFa: '۴۰ سانتی‌متر',
  materialFa: 'پارچه', meta: '۴۰ سانتی‌متر · پارچه', price: 3500000, priceFa: 'M3500000', colors: [], inStock: true,
  img: 'images/x.jpg', photos: null, desc: '', style: null,
  variants: appWithBaseSize(mahtab.variants, 40, 3500000),
};

function storefront(state) {
  const code = [
    fnSrc(appJs, 'parseCartKey'),
    grab(appJs, /const SHADE_TYPES = [^\n]*\n/),
    ...['hasShadeTypes', 'shadeOption', 'cartLineData', 'cartKeyFor', 'cardCartKey', 'addToCart', 'screenProduct'].map((n) => fnSrc(appJs, n)),
    'return { cartKeyFor, cardCartKey, cartLineData, addToCart, screenProduct };',
  ].join('\n');
  const fns = new Function(
    'state', 'byId', 'ITEMS', 'FA', 'money', 'saveStore', 'esc', 'icon', 'gallery', 'card', 'sizeFa', 'HEIGHT_UNKNOWN',
    code
  )(state, (id) => (id === item.id ? item : null), [item], String, (n) => 'M' + n, () => {}, (s) => String(s ?? ''), () => '', () => '', () => '', String, 'unknown');
  return { ...fns, state };
}

test('buildItems completes every product\'s sizes with withBaseSize', () => {
  assert.match(appJs, /variants: withBaseSize\(p\.variants, p\.height, price \?\? 0\),/);
});

test('storefront: مهتاب gets a size picker with both sizes, base selected first', () => {
  const html = storefront({ cart: {}, favs: {}, selectedHeight: null, param: item.id }).screenProduct();
  assert.match(html, /<select id="height-picker"/);
  const options = [...html.matchAll(/<option value="(\d+)"([^>]*)>([^<]*)<\/option>/g)].map((m) => [m[1], m[2].trim(), m[3]]);
  assert.deepEqual(options, [['40', 'selected', '40 سانتی‌متر — M3500000'], ['50', '', '50 سانتی‌متر — M4000000']]);
  assert.match(html, /<div class="price-row">\s*<b>M3500000<\/b>/);
  assert.match(html, /data-id="shade-embroidered-cylinder::h40"/);
});

test('storefront: picking 50 shows its price and adds its own cart line', () => {
  const html = storefront({ cart: {}, favs: {}, selectedHeight: 50, param: item.id }).screenProduct();
  assert.match(html, /<option value="50" selected>/);
  assert.match(html, /<div class="price-row">\s*<b>M4000000<\/b>/);
  assert.match(html, /data-id="shade-embroidered-cylinder::h50"/);
});

test('storefront cart: both sizes are lines at their prices; unknown heights cannot be added', () => {
  const sf = storefront({ cart: {}, favs: {} });
  assert.equal(sf.cardCartKey(item), 'shade-embroidered-cylinder::h40');
  for (const [key, price, heightFa] of [['shade-embroidered-cylinder::h40', 3500000, '40 سانتی‌متر'], ['shade-embroidered-cylinder::h50', 4000000, '50 سانتی‌متر']]) {
    assert.equal(sf.addToCart(key), true, key);
    const line = sf.cartLineData(key);
    assert.equal(line.price, price, key);
    assert.equal(line.heightFa, heightFa, key);
  }
  assert.deepEqual(sf.state.cart, { 'shade-embroidered-cylinder::h40': 1, 'shade-embroidered-cylinder::h50': 1 });
  for (const key of ['shade-embroidered-cylinder::h60', 'shade-embroidered-cylinder::hx']) {
    assert.equal(sf.cartLineData(key), null, key); // the catalog load drops these
    assert.equal(sf.addToCart(key), false, key);
  }
});

test('storefront: the catalog load drops any cart line it cannot price, not only shade ones', () => {
  assert.match(appJs, /if \(p && !cartLineData\(key\)\) \{\n\s*delete state\.cart\[key\];/);
  assert.match(appJs, /function addToCart\(id, n = 1\) \{\n\s*const p = byId\(parseCartKey\(id\)\.id\);\n\s*if \(p && !cartLineData\(id\)\) return false;/);
});

test('storefront card shows «· چند اندازه» for مهتاب now', () => {
  const card = new Function('state', 'byId', 'cardCartKey', 'icon', 'esc', `${fnSrc(appJs, 'media')}${fnSrc(appJs, 'card')} return card;`)(
    { favs: {}, cart: {} }, () => null, () => null, () => '', (s) => String(s ?? '')
  );
  assert.match(card(item), /چند اندازه/);
  assert.doesNotMatch(card({ ...item, variants: mahtab.variants }), /چند اندازه/); // the old, one-size view
});

// ---- admin «ویرایش کامل» --------------------------------------------------------

/** admin.js's panel and save code against a small fake DOM. */
function adminEnv(cached, { fHeight = cached.height_cm ?? '', priceBox = cached.price ?? '' } = {}) {
  const updates = [];
  const els = {};
  const rows = []; // the size list, in order: { base, height, price }
  const field = (value) => ({ value: String(value) });
  const rowEl = (r) => ({
    querySelector: (sel) => ({ '.v-height': r.h, '.v-price': r.p })[sel],
    remove: () => rows.splice(rows.indexOf(r), 1),
  });
  const list = {
    querySelectorAll: (sel) => (sel === '.variant-row:not([data-base])' ? rows.filter((r) => !r.base).map(rowEl) : []),
    querySelector: (sel) => {
      const r = sel === '.variant-row[data-base]' ? rows.find((x) => x.base) : null;
      return r ? rowEl(r) : null;
    },
    insertAdjacentHTML: (where, html) => {
      assert.equal(where, 'afterbegin');
      const [, h] = html.match(/class="v-height" value="([^"]*)"/);
      const [, p] = html.match(/class="v-price price-input" value="([^"]*)"/);
      rows.unshift({ base: /data-base="1"/.test(html), h: field(h), p: field(p) });
    },
  };
  const document = {
    getElementById: (id) => (id === `variants-list-${cached.id}` ? list : (els[id] ||= { value: '', textContent: '', className: '' })),
    querySelectorAll: (sel) => (sel === `#variants-list-${cached.id} .variant-row:not([data-base])` ? rows.filter((r) => !r.base).map(rowEl) : []),
  };
  els[`f-name-fa-${cached.id}`] = { value: cached.name_fa };
  els[`f-name-en-${cached.id}`] = { value: '' };
  els[`f-style-${cached.id}`] = { value: '' };
  els[`f-photo-${cached.id}`] = { value: cached.photo_url };
  els[`f-height-${cached.id}`] = { value: String(fHeight) };
  els[`price-${cached.id}`] = { value: String(priceBox) };
  els[`prov-${cached.id}`] = { checked: false };
  els[`stock-${cached.id}`] = { checked: true };
  const sb = { from: () => ({ update: (fields) => ({ eq: async () => (updates.push(fields), { error: null }) }) }) };
  const fns = new Function(
    'document', 'sb', 'PRODUCTS_CACHE', 'loadProducts',
    [
      grab(adminJs, /const STYLE_OPTIONS = [^\n]*\n/),
      grab(adminJs, /const hasShadeTypes = [\s\S]*?;\n/),
      grab(adminJs, /const SHADE_TYPES = [^\n]*\n/),
      grab(adminJs, /const shadeKeysOf = [\s\S]*?;\n/),
      grab(adminJs, /const photoUploads = [^\n]*\n/),
      ...['escapeHtml', 'escapeAttr', 'toLatinDigits', 'unformatPrice', 'formatPrice', 'mainPhoto', 'mainPhotoFields',
        'withBaseSize', 'baseSizeOf', 'sizesToSave', 'syncBaseRow', 'baseRowHtml', 'variantRowHtml', 'shadeVariantRowHtml',
        'editPanelHtml', 'saveProduct', 'saveProductFull'].map((n) => fnSrc(adminJs, n)),
      'const photoFieldHtml = () => "";',
      'return { editPanelHtml, syncBaseRow, saveProduct, saveProductFull };',
    ].join('\n')
  )(document, sb, [cached], () => {});
  /** Load the panel's rows the way the browser parses editPanelHtml. */
  const open = () => {
    const html = fns.editPanelHtml(cached);
    for (const m of html.matchAll(/<div class="variant-row"([^>]*)>[\s\S]*?class="v-height"[^>]*value="([^"]*)"[\s\S]*?class="v-(?:shade-)?price[^"]*"[^>]*value="([^"]*)"/g)) {
      rows.push({ base: /data-base/.test(m[1]), h: field(m[2]), p: field(m[3]) });
    }
    return html;
  };
  const addRow = (h, p) => {
    rows.push({ base: false, h: field(h), p: field(p) });
    fns.syncBaseRow(cached.id); // what «+ افزودن اندازه» runs after inserting
  };
  const type = (id, value) => {
    els[id].value = String(value);
    fns.syncBaseRow(cached.id); // what the delegated input listener runs
  };
  const view = () => rows.map((r) => (r.base ? 'base ' : '') + `${r.h.value} / ${r.p.value}`);
  return { ...fns, els, rows, updates, open, addRow, type, view, msg: () => els[`save-full-msg-${cached.id}`] };
}

const mahtabRow = { ...mahtab, id: 'm1', photo_url: 'images/x.jpg' };

test('admin: مهتاب opens with its base size as the first, read-only row', () => {
  const env = adminEnv({ ...mahtabRow });
  const html = env.open();
  assert.deepEqual(env.view(), ['base 40 / 3,500,000', '50 / 4,000,000']);
  const baseRow = html.match(/<div class="variant-row" data-base="1">[\s\S]*?<\/div>/)[0];
  assert.match(baseRow, /class="v-height" value="40" readonly/);
  assert.match(baseRow, /class="v-price price-input" value="3,500,000" readonly/);
  assert.match(baseRow, /اندازه پایه — از «ارتفاع پایه» و قیمت بالا/);
  assert.doesNotMatch(baseRow, /remove-variant/); // not removable on its own
});

test('admin: saving مهتاب writes the complete list of two sizes, and the base price', async () => {
  const env = adminEnv({ ...mahtabRow });
  env.open();
  await env.saveProductFull('m1');
  assert.equal(env.msg().textContent, 'ذخیره شد.');
  assert.deepEqual(env.updates[0].variants, [{ height: 40, price: 3500000 }, { height: 50, price: 4000000 }]);
  assert.equal(env.updates[0].price, 3500000);
  assert.equal(env.updates[0].height_cm, 40);
});

test('admin: on a product with no sizes, adding 50 / 4,000,000 brings the base row in first', async () => {
  const env = adminEnv({ ...mahtabRow, variants: [] });
  env.open();
  assert.deepEqual(env.view(), []); // one size: no list
  env.addRow('50', '4,000,000');
  assert.deepEqual(env.view(), ['base 40 / 3,500,000', '50 / 4,000,000']);
  await env.saveProductFull('m1');
  assert.deepEqual(env.updates[0].variants, [{ height: 40, price: 3500000 }, { height: 50, price: 4000000 }]);
});

test('admin: changing ارتفاع پایه moves the base row with it — no stale row, no duplicate', async () => {
  const env = adminEnv({ ...mahtabRow });
  env.open();
  env.type('f-height-m1', '45');
  assert.deepEqual(env.view(), ['base 45 / 3,500,000', '50 / 4,000,000']);
  env.type('price-m1', '3,600,000');
  assert.deepEqual(env.view(), ['base 45 / 3,600,000', '50 / 4,000,000']);
  await env.saveProductFull('m1');
  assert.deepEqual(env.updates[0].variants, [{ height: 45, price: 3600000 }, { height: 50, price: 4000000 }]);
  assert.equal(env.updates[0].height_cm, 45);
  assert.equal(env.updates[0].price, 3600000);
});

test('admin: a base height equal to another row is an error, and nothing is saved', async () => {
  const env = adminEnv({ ...mahtabRow });
  env.open();
  env.type('f-height-m1', '50');
  await env.saveProductFull('m1');
  assert.equal(env.updates.length, 0);
  assert.equal(env.msg().className, 'msg error');
  assert.match(env.msg().textContent, /اندازه‌ی 50 سانتی‌متر دو بار آمده است\. این ارتفاع پایه است/);
  // A typed duplicate of the base height in an extra row is refused the same way.
  const env2 = adminEnv({ ...mahtabRow });
  env2.open();
  env2.addRow('40', '3,900,000');
  await env2.saveProductFull('m1');
  assert.equal(env2.updates.length, 0);
  assert.match(env2.msg().textContent, /اندازه‌ی 40 سانتی‌متر دو بار آمده است/);
});

test('admin: clearing ارتفاع پایه or removing the last other size takes the base row away', async () => {
  const env = adminEnv({ ...mahtabRow });
  env.open();
  env.type('f-height-m1', '');
  assert.deepEqual(env.view(), ['50 / 4,000,000']);
  env.type('f-height-m1', '40');
  assert.deepEqual(env.view(), ['base 40 / 3,500,000', '50 / 4,000,000']);
  env.rows.splice(1, 1); // «حذف» on the 50 row …
  env.syncBaseRow('m1'); // … which then runs this
  assert.deepEqual(env.view(), []);
  await env.saveProductFull('m1');
  assert.deepEqual(env.updates[0].variants, []); // back to a one-size product
  assert.equal(env.updates[0].price, undefined); // the full save leaves price to the quick save, as before
});

test('admin: a product already listing its base height shows it once, as the base row', async () => {
  const tall = {
    ...mahtabRow, id: 't1', slug: 'aghaghia-tall', name_fa: 'اقاقیا کنار سالنی', price: 12980000, height_cm: 140,
    variants: [{ height: 140, price: 12980000 }, { height: 120, price: 9980000 }, { height: 100, price: 9100000 }],
  };
  const env = adminEnv(tall);
  env.open();
  assert.deepEqual(env.view(), ['base 140 / 12,980,000', '120 / 9,980,000', '100 / 9,100,000']);
  await env.saveProductFull('t1');
  assert.deepEqual(env.updates[0].variants, tall.variants); // byte-for-byte what was stored
});

test('admin quick «ذخیره»: a stored base row follows the new price; others untouched', async () => {
  const tall = {
    ...mahtabRow, id: 't1', price: 12980000, height_cm: 140,
    variants: [{ height: 140, price: 12980000 }, { height: 120, price: 9980000 }],
  };
  const env = adminEnv(tall, { priceBox: '13,500,000' });
  await env.saveProduct('t1');
  assert.equal(env.updates[0].price, 13500000);
  assert.deepEqual(env.updates[0].variants, [{ height: 140, price: 13500000 }, { height: 120, price: 9980000 }]);
  // مهتاب stores no base row: only the price changes, the list is derived from it.
  const env2 = adminEnv({ ...mahtabRow }, { priceBox: '3,700,000' });
  await env2.saveProduct('m1');
  assert.equal(env2.updates[0].price, 3700000);
  assert.equal(env2.updates[0].variants, undefined);
});

test('admin: shade-type products keep their own rows, no base row', async () => {
  const env = adminEnv({ ...nila, photo_url: 'images/x.jpg' });
  const html = env.open();
  assert.doesNotMatch(html, /data-base/);
  assert.match(html, /data-shade="embroidered" value="8,900,000"/);
  env.syncBaseRow('n1');
  assert.ok(env.rows.every((r) => !r.base));
  // Quick save does not touch a shade product's sizes.
  const env2 = adminEnv({ ...nila, photo_url: 'images/x.jpg' }, { priceBox: '7,000,000' });
  await env2.saveProduct('n1');
  assert.equal(env2.updates[0].variants, undefined);
});

test('admin: the base row follows ارتفاع پایه and the price box through one delegated listener', () => {
  assert.match(adminJs, /document\.addEventListener\('input', \(e\) => \{\n\s*const m = \/\^\(\?:f-height\|price\)-\(\.\+\)\$\/\.exec/);
  assert.match(adminJs, /if \(m\) syncBaseRow\(m\[1\]\);/);
  assert.match(adminJs, /syncBaseRow\(id\);\n\s*wireVariantRemove\(list, \(\) => syncBaseRow\(id\)\);/);
  assert.match(adminJs, /\.variant-row:not\(\[data-base\]\)`\);/); // the full save never reads the read-only row
});
