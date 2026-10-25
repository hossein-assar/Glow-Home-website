// Packaging fee outside Tehran: 250,000 Toman on the bill (the online total
// and the order total), never waived; nothing in Tehran. TIPAX_EXTRA_FEE_TOMAN
// is prepared but 0. One shared rule — identical in app.js, api/orders.js and
// payment-server/src/pricing.js — and the servers take the fee from the city
// alone. Stored as its own order line «هزینه بسته‌بندی» (no product).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  cityFees, isTehranCity, shippingMethodForCity, priceCart, validateCheckoutBody,
  PACKAGING_FEE_TOMAN, TIPAX_EXTRA_FEE_TOMAN, FREE_SHIP_OVER,
} from '../src/pricing.js';
import { tomanToGatewayAmount } from '../src/config.js';
import { createApp } from '../src/app.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const appJs = read('../../app.js');
const ordersJs = read('../../api/orders.js');
const pricingJs = read('../src/pricing.js');
const adminJs = read('../../admin/admin.js');

const FEE_LINE = { product_id: null, name_fa: 'هزینه بسته‌بندی', qty: 1, unit_price: 250000 };

// The live gisoo row (same as checkout-timeouts.test.js).
const gisoo = {
  id: 'g1', slug: 'gisoo', name_fa: 'گیسو', price: 9100000, height_cm: 100, colors: [], in_stock: true,
  variants: [
    { price: 12980000, height: 140, shades: { plain: 12980000, embroidered: 15450000 } },
    { price: 9980000, height: 120, shades: { plain: 9980000, embroidered: 12480000 } },
    { price: 9100000, height: 100, shades: { plain: 9100000, embroidered: 11600000 } },
  ],
};
const CART = [{ cartKey: 'gisoo::h140::sembroidered', qty: 1 }];

const TEHRAN = [
  'تهران', '  تهران ', 'تهران‌', '‏تهران', 'تهران  ', 'Tehran', 'TEHRAN', ' tehran ', 'Teheran',
  'شهر تهران', 'شهر  تهران', 'تهران - ونک', 'تهران-ونک', 'تهران – پاسداران', 'تهران، ونک', 'تهران,ونک', 'تهران (ونک)', 'تهران/سعادت‌آباد',
];
const OUTSIDE = ['کرج', 'Karaj', 'اصفهان', 'Isfahan', 'كرج', 'شيراز', 'شهریار', 'اسلامشهر', 'مشهد - احمدآباد'];

// ---- one shared rule ---------------------------------------------------------------

const block = (src) => {
  const m = src.match(/\/\/ ---- City fees \(shared rule\) -+\n[\s\S]*?\/\/ ---- end of city fees -+\n/);
  assert.ok(m, 'city fees block not found');
  return m[0].replace(/^export /gm, '');
};

test('the city-fee rule is the same block in app.js, api/orders.js and pricing.js', () => {
  assert.equal(block(appJs), block(pricingJs), 'app.js');
  assert.equal(block(ordersJs), block(pricingJs), 'api/orders.js');
  // and the normalisation it relies on is the same function body too
  const norm = (src) => src.match(/function normalizePersianText\(s\) \{[\s\S]*?\n\}\n/)[0];
  assert.equal(norm(appJs), norm(pricingJs));
  assert.equal(norm(ordersJs), norm(pricingJs));
});

test('amounts: packaging 250,000 Toman; the Tipax extra is prepared but off', () => {
  assert.equal(PACKAGING_FEE_TOMAN, 250000);
  assert.equal(TIPAX_EXTRA_FEE_TOMAN, 0);
});

// ---- deciding "in Tehran" ---------------------------------------------------------------

test('every spelling of Tehran is Tehran: no fee, courier پیک', () => {
  for (const city of TEHRAN) {
    assert.equal(isTehranCity(city), true, JSON.stringify(city));
    assert.deepEqual(cityFees(city), [], JSON.stringify(city));
    assert.equal(shippingMethodForCity(city), 'peyk', JSON.stringify(city));
  }
});

test('outside Tehran (Karaj, Isfahan, Arabic ك/ي spellings, …): the packaging fee, courier تیپاکس', () => {
  for (const city of OUTSIDE) {
    assert.equal(isTehranCity(city), false, city);
    assert.deepEqual(cityFees(city), [{ label: 'هزینه بسته‌بندی', amount: 250000 }], city);
    assert.equal(shippingMethodForCity(city), 'tipax', city);
  }
  // a different city that merely starts with the letters of تهران is not Tehran
  assert.equal(isTehranCity('تهرانی‌ها'), false);
});

test('empty city: no fee from the rule — and both servers refuse the order («شهر را وارد کنید.»)', async () => {
  for (const city of ['', '   ', '‌', null, undefined]) assert.deepEqual(cityFees(city), [], String(city));
  const body = { customer: { name: 'سارا', phone: '+989121234567', city: '  ', address: 'خیابان ولیعصر، کوچه ۱۲، پلاک ۳', postcode: '' }, items: CART };
  assert.equal(validateCheckoutBody(body).error, 'شهر را وارد کنید.');
  const r = await postOrder({ city: '  ' });
  assert.equal(r.status, 400);
  assert.equal(r.json.error, 'شهر را وارد کنید.');
});

test('the Tipax extra, once set above 0, adds its own line outside Tehran only', () => {
  const src = block(pricingJs).replace('const TIPAX_EXTRA_FEE_TOMAN = 0;', 'const TIPAX_EXTRA_FEE_TOMAN = 100000;');
  const { cityFees: fees } = new Function(
    `function normalizePersianText(s) { return String(s ?? '').replace(/[\\u200c\\u200e\\u200f]/g, '').trim().replace(/\\s+/g, ' ').replace(/[يى]/g, 'ی').replace(/ك/g, 'ک'); }
     ${src} return { cityFees };`
  )();
  assert.deepEqual(fees('کرج'), [{ label: 'هزینه بسته‌بندی', amount: 250000 }, { label: 'هزینه اضافه تیپاکس', amount: 100000 }]);
  assert.deepEqual(fees('تهران'), []);
});

// ---- payment-server pricing --------------------------------------------------------------

test('Karaj: total = products + 250,000 Toman; ZarinPal gets it ×10 in Rial; its own order line', () => {
  const r = priceCart({ items: CART, products: [gisoo], discountCode: null, city: 'کرج' });
  assert.equal(r.subtotal, 15450000); // products only
  assert.equal(r.total, 15700000);
  assert.equal(tomanToGatewayAmount(r.total), 157000000);
  assert.deepEqual(r.orderItems.at(-1), FEE_LINE);
  assert.equal(r.orderItems.length, 2);
  assert.deepEqual(r.fees, [{ label: 'هزینه بسته‌بندی', amount: 250000 }]);
});

test('Tehran: no fee line, total = products', () => {
  const r = priceCart({ items: CART, products: [gisoo], discountCode: null, city: 'تهران' });
  assert.equal(r.total, 15450000);
  assert.equal(tomanToGatewayAmount(r.total), 154500000);
  assert.equal(r.orderItems.length, 1);
});

test('the free-shipping threshold never waives the fee', () => {
  const r = priceCart({ items: [{ cartKey: 'gisoo::h140::sembroidered', qty: 3 }], products: [gisoo], discountCode: null, city: 'اصفهان' });
  assert.ok(r.subtotal > FREE_SHIP_OVER);
  assert.equal(r.total, 3 * 15450000 + 250000);
});

test('a client-sent fee is ignored: it is not even read from the body', () => {
  for (const [city, expected] of [['کرج', 15700000], ['تهران', 15450000]]) {
    const v = validateCheckoutBody({
      customer: { name: 'سارا', phone: '+989121234567', city, address: 'خیابان ولیعصر، کوچه ۱۲، پلاک ۳', postcode: '' },
      items: [{ cartKey: CART[0].cartKey, qty: 1, packaging_fee: 0 }],
      packaging_fee: city === 'کرج' ? 0 : 250000,
      fees: [],
      total: 1,
    });
    assert.equal(v.error, undefined);
    assert.ok(!('packaging_fee' in v.value) && !('fees' in v.value));
    assert.equal(priceCart({ items: v.value.items, products: [gisoo], discountCode: null, city: v.value.city }).total, expected);
  }
});

// ---- api/orders.js, end to end with a fake Supabase ------------------------------------------

async function postOrder({ city, extra = {} }) {
  const inserted = {};
  const sb = {
    from(table) {
      return {
        select: () => ({ in: async () => ({ data: [gisoo], error: null }) }),
        insert(row) {
          inserted[table] = row;
          return table === 'orders'
            ? { select: () => ({ single: async () => ({ data: { id: 1, ...row }, error: null }) }) }
            : Promise.resolve({ error: null });
        },
      };
    },
    rpc: async () => ({ data: 1020, error: null }),
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
    await mod.exports({
      method: 'POST',
      body: {
        customer: { name: 'سارا', phone: '+989121234567', city, address: 'خیابان ولیعصر، کوچه ۱۲، پلاک ۳', postcode: '' },
        items: CART,
        ...extra,
      },
    }, res);
  } finally {
    process.env = saved;
  }
  return { status, json, order: inserted.orders, items: inserted.order_items };
}

test('api/orders.js (card-to-card): the same fee, total and order line as the payment server', async () => {
  for (const city of [...TEHRAN.slice(0, 6), ...OUTSIDE.slice(0, 5)]) {
    const r = await postOrder({ city, extra: { packaging_fee: 0, fees: [{ label: 'x', amount: 1 }], total: 1 } });
    const p = priceCart({ items: CART, products: [gisoo], discountCode: null, city });
    assert.equal(r.status, 200, city);
    assert.equal(r.order.total, p.total, city);
    assert.equal(r.json.total, p.total, city);
    assert.equal(r.order.subtotal, p.subtotal, city);
    assert.deepEqual(r.items.map(({ order_id, ...it }) => it), p.orderItems.map((it) => ({ ...it, product_id: it.product_id === 'g1' ? gisoo.id : it.product_id })), city);
  }
  const karaj = await postOrder({ city: 'کرج' });
  assert.deepEqual(karaj.items.at(-1), { ...FEE_LINE, order_id: 1 });
  // the confirmation screen shows the line too
  assert.deepEqual(karaj.json.items.at(-1), { fa: 'هزینه بسته‌بندی', qty: 1, line: 250000 });
});

// ---- payment-server route: the amount ZarinPal is asked for ------------------------------------

const servers = [];
after(() => servers.forEach((s) => s.close()));

test('online checkout from Karaj: ZarinPal is asked for 157,000,000 Rial; the order stores the fee line', async () => {
  const orders = [];
  let requested;
  const app = createApp({
    config: { publicSiteUrl: 'https://glow-home.ir', callbackUrl: 'https://pay.glow-home.ir/api/verify', zarinpal: { mode: 'sandbox' } },
    db: {
      fetchProductsBySlugs: async () => [gisoo],
      nextOrderCode: async () => 'GH-1020',
      createOrder: async (o, items) => (orders.push({ ...o, items }), { id: 'o1', code: o.code }),
      setAuthority: async () => {},
      markFailed: async () => {},
    },
    zarinpal: { startPayUrl: (a) => 'https://sandbox.zarinpal.com/pg/StartPay/' + a, requestPayment: async (args) => ((requested = args), 'S' + '0'.repeat(35)) },
    logger: () => {},
  });
  const server = app.listen(0, '127.0.0.1');
  servers.push(server);
  await new Promise((r) => server.once('listening', r));
  const res = await fetch(`http://127.0.0.1:${server.address().port}/api/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://glow-home.ir' },
    body: JSON.stringify({
      customer: { name: 'سارا', phone: '+989121234567', city: 'کرج', address: 'خیابان ولیعصر، کوچه ۱۲، پلاک ۳', postcode: '' },
      items: CART,
      packaging_fee: 0, // ignored
    }),
  });
  assert.equal(res.status, 200);
  assert.equal(requested.amount, 157000000);
  assert.equal(orders[0].total, 15700000);
  assert.equal(orders[0].payment_amount_rial, 157000000);
  assert.deepEqual(orders[0].items.at(-1), FEE_LINE);
});

// ---- storefront ------------------------------------------------------------------------------

function storefront(city) {
  const fnSrc = (name) => appJs.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n}\\n`))[0];
  const state = { cart: { [CART[0].cartKey]: 1 }, appliedCode: null, ship: 'tipax', form: { city } };
  const nodes = { fees: [{ innerHTML: 'old' }], total: [{ textContent: 'old' }, { textContent: 'old' }] };
  const code = [
    block(appJs),
    appJs.match(/const money = [^\n]*\n/)[0],
    ...['normalizePersianText', 'totals', 'feeRowsHtml', 'refreshSummaryTotals'].map(fnSrc),
    'return { totals, feeRowsHtml, refreshSummaryTotals };',
  ].join('\n');
  const fns = new Function(
    'state', 'cartLineData', 'DISCOUNT_CODES', 'SHIPPING', 'FREE_SHIP_OVER', 'FA', 'esc', '$$',
    code
  )(
    state,
    () => ({ price: 15450000 }),
    {},
    [{ id: 'peyk', label: 'پیک تهران', cost: 90000, payAtDoor: true }, { id: 'tipax', label: 'تیپاکس', cost: 0, payAtDoor: true }],
    3000000,
    (s) => String(s).replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]),
    (s) => String(s),
    (sel) => (sel === '[data-sum="fees"]' ? nodes.fees : sel === '[data-sum="total"]' ? nodes.total : [])
  );
  return { ...fns, state, nodes };
}

test('checkout summary: «هزینه بسته‌بندی ۲۵۰٬۰۰۰ تومان» outside Tehran only, in the total', () => {
  const out = storefront('اصفهان');
  const t = out.totals();
  assert.equal(t.total, 15700000);
  assert.equal(out.feeRowsHtml(t), '<div class="sum-row"><span>هزینه بسته‌بندی</span><span>۲۵۰٬۰۰۰ تومان</span></div>');
  for (const city of ['تهران', 'Tehran', '']) {
    const sf = storefront(city);
    assert.equal(sf.totals().total, 15450000, city);
    assert.equal(sf.feeRowsHtml(sf.totals()), '', city); // empty city: no line until a city is chosen
  }
});

test('typing the city updates only the fee rows and totals — no re-render', () => {
  const sf = storefront('');
  sf.state.form.city = 'کرج';
  sf.refreshSummaryTotals();
  assert.match(sf.nodes.fees[0].innerHTML, /هزینه بسته‌بندی/);
  assert.deepEqual(sf.nodes.total.map((n) => n.textContent), ['۱۵٬۷۰۰٬۰۰۰ تومان', '۱۵٬۷۰۰٬۰۰۰ تومان']);
  sf.state.form.city = 'تهران';
  sf.refreshSummaryTotals();
  assert.equal(sf.nodes.fees[0].innerHTML, '');
  // the #city input handler sets the city and refreshes; it never calls render()
  const handler = appJs.match(/document\.addEventListener\('input', \(e\) => \{\n  if \(e\.target\.id !== 'city' \|\| state\.route !== 'checkout'\) return;[\s\S]*?\n\}\);\n/)[0];
  assert.match(handler, /state\.form\.city = e\.target\.value;\n  refreshSummaryTotals\(\);/);
  assert.doesNotMatch(handler, /render\(\)/);
  // cart, checkout and the mobile bar all carry the hooks
  assert.equal((appJs.match(/<div data-sum="fees">\$\{feeRowsHtml\(t\)\}<\/div>/g) || []).length, 2);
  assert.equal((appJs.match(/data-sum="total">\$\{money\(t\.total\)\}/g) || []).length, 3);
});

test('admin best sellers count products only, not the fee line', () => {
  assert.match(adminJs, /\.not\('product_id', 'is', null\) \/\/ fee lines/);
});
