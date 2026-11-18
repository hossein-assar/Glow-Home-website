// Discount campaigns («تخفیف‌ها»): a percent off every size and shade of the
// products a campaign covers, rounded to 1,000 Toman, the larger campaign
// winning (never stacked), active only when switched on and between its
// dates on the server's clock. The payment server prices every order from
// the DB and its own read of the campaigns; a different total than the one
// shown is refused (409) instead of charged. Covers the shared rule (four
// identical copies), the payment server (pricing + HTTP), the storefront
// (card, product page, cart, summaries, checkout), the admin tab (form,
// Persian errors, preview, list, Jalali dates), the order lines in the
// admin card / print / email, and the SQL file.
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  priceCart, validateCheckoutBody, campaignIsActive, campaignCovers, bestCampaignFor, discountedPrice, applyCampaign,
  DISCOUNT_MAX_PERCENT, TEHRAN_PACKAGING_FEE_TOMAN, PACKAGING_FEE_TOMAN,
} from '../src/pricing.js';
import { createApp, PRICE_CHANGED_ERROR } from '../src/app.js';
import { tomanToGatewayAmount } from '../src/config.js';
import { paidOrderHtml } from '../src/email.js';
import { isMissingTable, isMissingColumn } from '../src/db.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const appJs = read('../../app.js');
const adminJs = read('../../admin/admin.js');
const adminHtml = read('../../admin/index.html');
const ordersJs = read('../../api/orders.js');
const pricingJs = read('../src/pricing.js');
const dataJs = read('../../data.js');
const stylesCss = read('../../styles.css');
const sql = read('../../supabase/migration-discount-campaigns.sql');
const schema = read('../../supabase/schema.sql');

const grab = (src, re) => {
  const m = src.match(re);
  assert.ok(m, 'not found: ' + re);
  return m[0];
};
const fnIn = (src, name) => grab(src, new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\n}\\n`));
const BLOCK_RE = /\/\/ ---- Campaign discounts \(shared rule\) -+\n[\s\S]*?\/\/ ---- end of campaign discounts -+\n/;
const block = (src) => grab(src, BLOCK_RE).replace(/^export /gm, '');

function loadOrdersJs() {
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', ordersJs)(() => { throw new Error('no require'); }, mod, mod.exports);
  return mod.exports;
}

// ---- fixtures ----------------------------------------------------------------

const NOW = Date.parse('2026-12-21T12:00:00Z'); // یلدا 1405, in the afternoon in Tehran
const H = 3600 * 1000;
const yalda = { id: 'c1', name: 'یلدا', percent: 20, scope: 'all', collections: [], product_slugs: [], starts_at: '2026-12-20T20:30:00Z', ends_at: '2026-12-22T20:30:00Z', enabled: true };
const lampsOnly = { id: 'c2', name: 'جشن آباژور', percent: 30, scope: 'collections', collections: ['lamps'], product_slugs: [], starts_at: null, ends_at: null, enabled: true };
const lalePick = { id: 'c3', name: 'لاله‌ی ویژه', percent: 10, scope: 'products', collections: [], product_slugs: ['lale'], starts_at: null, ends_at: null, enabled: true };

const gisoo = {
  id: 'g1', slug: 'gisoo', name_fa: 'گیسو', collection: 'lamps', price: 9100000, height_cm: 100, colors: [], in_stock: true,
  shade_types: [],
  variants: [
    { height: 100, price: 9100000, shades: { plain: 9100000, embroidered: 11450000 } },
    { height: 140, price: 12980000, shades: { plain: 12980000, embroidered: 15450000 } },
  ],
};
const mahtab = { id: 'm1', slug: 'mahtab', name_fa: 'مهتاب', collection: 'shades', price: 3500000, height_cm: 40, colors: [], in_stock: true, variants: [{ height: 50, price: 4000000 }] };
const lale = { id: 'l1', slug: 'lale', name_fa: 'لاله', collection: 'candles', price: 1234567, height_cm: null, colors: ['سبز'], in_stock: true, variants: [] };
const unpriced = { id: 'u1', slug: 'new-lamp', name_fa: 'آباژور تازه', collection: 'lamps', price: 0, height_cm: null, colors: [], in_stock: true, variants: [] };
const PRODUCTS = [gisoo, mahtab, lale, unpriced];

const price = (items, campaigns, { now = NOW, city = 'تهران', products = PRODUCTS } = {}) =>
  priceCart({ items: items.map(([cartKey, qty = 1]) => ({ cartKey, qty })), products, campaigns, now, city, discountCode: null });

// ---- the shared rule -------------------------------------------------------------

test('the campaign rule is one identical block in app.js, admin.js, api/orders.js and pricing.js', () => {
  assert.equal(block(appJs), block(pricingJs), 'app.js');
  assert.equal(block(adminJs), block(pricingJs), 'admin/admin.js');
  assert.equal(block(ordersJs), block(pricingJs), 'api/orders.js');
  const o = loadOrdersJs();
  for (const name of ['campaignIsActive', 'campaignCovers', 'bestCampaignFor', 'discountedPrice', 'applyCampaign']) assert.equal(typeof o[name], 'function', name);
  assert.equal(o.discountedPrice(12980000, 20), discountedPrice(12980000, 20));
  // api/orders.js still refuses every order
  assert.match(ordersJs, /res\.status\(410\)\.json\(\{ ok: false, error: RETIRED_ERROR \}\);/);
});

test('rounding: to the nearest 1,000 Toman; 90% at most; never below 1,000 nor above the price; unpriced untouched', () => {
  assert.equal(discountedPrice(12980000, 20), 10384000);
  assert.equal(discountedPrice(1234567, 10), 1111000); // 1,111,110.3 → 1,111,000
  assert.equal(discountedPrice(1234567, 15), 1049000); // 1,049,381.95 → 1,049,000
  assert.equal(discountedPrice(1001500, 50), 501000); // 500,750 → 501,000 (half rounds up)
  assert.equal(DISCOUNT_MAX_PERCENT, 90);
  assert.equal(discountedPrice(1000000, 90), 100000);
  assert.equal(discountedPrice(1000000, 99), 100000, 'capped at 90%');
  assert.equal(discountedPrice(1500, 90), 1000, 'never below 1,000');
  assert.equal(discountedPrice(1000, 1), 1000, 'never above the price');
  for (const bad of [0, -5, null, undefined, NaN, 1.5]) assert.deepEqual(discountedPrice(bad, 20), bad);
  assert.deepEqual(applyCampaign(1000, { percent: 1 }), { price: 1000, listPrice: 1000, campaign: null }, 'nothing off → no campaign shown');
  assert.deepEqual(applyCampaign(0, yalda), { price: 0, listPrice: 0, campaign: null });
});

test('active: switched on, a whole percent 1–90, a known scope, and starts_at ≤ now < ends_at', () => {
  assert.equal(campaignIsActive(yalda, NOW), true);
  assert.equal(campaignIsActive(yalda, Date.parse(yalda.starts_at)), true, 'from the first moment');
  assert.equal(campaignIsActive(yalda, Date.parse(yalda.starts_at) - 1), false, 'start in the future');
  assert.equal(campaignIsActive(yalda, Date.parse(yalda.ends_at)), false, 'expired at ends_at');
  assert.equal(campaignIsActive({ ...yalda, enabled: false }, NOW), false, 'switched off');
  assert.equal(campaignIsActive({ ...yalda, enabled: 'true' }, NOW), false);
  for (const percent of [0, 91, 20.5, '20', null]) assert.equal(campaignIsActive({ ...yalda, percent }, NOW), percent === '20', String(percent));
  assert.equal(campaignIsActive({ ...yalda, scope: 'everything' }, NOW), false);
  assert.equal(campaignIsActive({ ...yalda, starts_at: 'garbage' }, NOW), false);
  assert.equal(campaignIsActive(lampsOnly, NOW), true, 'no dates = no limit');
  assert.equal(campaignIsActive({ ...yalda, starts_at: '2030-01-01T00:00:00Z' }, null), true, 'the storefront skips dates (its read is already filtered)');
  assert.equal(campaignIsActive(null, NOW), false);
});

test('scope and the larger campaign wins (never stacked; a tie keeps the first)', () => {
  const p = (slug, collection) => ({ slug, collection });
  assert.equal(campaignCovers(yalda, p('x', 'decor')), true);
  assert.equal(campaignCovers(lampsOnly, p('gisoo', 'lamps')), true);
  assert.equal(campaignCovers(lampsOnly, p('mahtab', 'shades')), false);
  assert.equal(campaignCovers(lalePick, p('lale', 'candles')), true);
  assert.equal(campaignCovers(lalePick, p('lale-2', 'candles')), false);
  assert.equal(bestCampaignFor(p('gisoo', 'lamps'), [yalda, lampsOnly]), lampsOnly);
  assert.equal(bestCampaignFor(p('mahtab', 'shades'), [yalda, lampsOnly]), yalda);
  assert.equal(bestCampaignFor(p('lale', 'candles'), [lalePick, yalda]), yalda, '20% beats 10%');
  const twin = { ...yalda, id: 'c9', name: 'دوقلو' };
  assert.equal(bestCampaignFor(p('x', 'decor'), [yalda, twin]), yalda);
  assert.equal(bestCampaignFor(p('x', 'decor'), []), null);
  assert.equal(bestCampaignFor(p('x', 'decor'), null), null);
});

// ---- payment server: pricing -------------------------------------------------------

test('server: only the discounted lines change; each size and shade from its own price; the fee after, never discounted', () => {
  const r = price([['gisoo::h140::sembroidered', 2], ['mahtab::h50'], ['mahtab'], ['lale::c0', 3]], [lampsOnly]);
  assert.equal(r.error, undefined);
  const lines = r.orderItems;
  assert.deepEqual(lines[0], { product_id: 'g1', name_fa: 'گیسو (140 سانتی‌متر) — شید گلدوزی', qty: 2, unit_price: 10815000, list_price: 15450000, campaign_name: 'جشن آباژور' });
  assert.deepEqual(lines[1], { product_id: 'm1', name_fa: 'مهتاب (50 سانتی‌متر)', qty: 1, unit_price: 4000000 }, 'not covered: stored exactly as before');
  assert.deepEqual(lines[2], { product_id: 'm1', name_fa: 'مهتاب', qty: 1, unit_price: 3500000 });
  assert.deepEqual(lines[3], { product_id: 'l1', name_fa: 'لاله — سبز', qty: 3, unit_price: 1234567 });
  assert.deepEqual(lines[4], { product_id: null, name_fa: 'هزینه بسته‌بندی', qty: 1, unit_price: TEHRAN_PACKAGING_FEE_TOMAN });
  const productsCharged = 2 * 10815000 + 4000000 + 3500000 + 3 * 1234567;
  assert.equal(r.subtotal, productsCharged);
  assert.equal(r.listSubtotal, 2 * 15450000 + 4000000 + 3500000 + 3 * 1234567);
  assert.equal(r.campaignDiscount, 2 * (15450000 - 10815000));
  assert.equal(r.total, productsCharged + TEHRAN_PACKAGING_FEE_TOMAN);
  assert.equal(tomanToGatewayAmount(r.total), r.total * 10);
});

test('server: two campaigns on one product — the larger one, not both', () => {
  const r = price([['gisoo::h100::splain'], ['lale']], [yalda, lampsOnly, lalePick]);
  assert.equal(r.orderItems[0].unit_price, 6370000); // 9,100,000 − 30%
  assert.equal(r.orderItems[0].campaign_name, 'جشن آباژور');
  assert.equal(r.orderItems[1].unit_price, discountedPrice(1234567, 20)); // یلدا 20% beats 10%
  assert.equal(r.orderItems[1].campaign_name, 'یلدا');
});

test('server: future, expired, switched off and deleted campaigns charge the list price', () => {
  const full = price([['gisoo::h100::splain']], []).total;
  for (const [why, campaigns, now] of [
    ['starts later', [yalda], Date.parse(yalda.starts_at) - H],
    ['ended', [yalda], Date.parse(yalda.ends_at) + 1],
    ['switched off', [{ ...yalda, enabled: false }], NOW],
    ['deleted (no rows)', [], NOW],
    ['out-of-range percent from a hand edit', [{ ...yalda, percent: 95 }], NOW],
  ]) {
    const r = price([['gisoo::h100::splain']], campaigns, { now });
    assert.equal(r.total, full, why);
    assert.ok(!('list_price' in r.orderItems[0]), why);
  }
});

test('server: an unpriced product is still refused; a provisional price is discounted like any other', () => {
  assert.match(price([['new-lamp']], [yalda]).error, /قیمت «آباژور تازه» هنوز مشخص نشده است/);
  const provisional = { ...mahtab, price_provisional: true };
  const r = price([['mahtab']], [yalda], { products: [provisional] });
  assert.equal(r.orderItems[0].unit_price, 2800000);
});

test('server: a long campaign name is cut to 60 characters on the order line', () => {
  const r = price([['mahtab']], [{ ...yalda, name: 'ب'.repeat(80) }]);
  assert.equal(r.orderItems[0].campaign_name.length, 60);
});

test('server: the packaging fee outside Tehran is added after discounts and never discounted', () => {
  const r = price([['mahtab']], [{ ...yalda, percent: 90 }], { city: 'کرج' });
  assert.equal(r.total, 350000 + PACKAGING_FEE_TOMAN);
  assert.equal(r.orderItems.at(-1).unit_price, PACKAGING_FEE_TOMAN);
});

test('validation: expected_total is optional; when sent it must be a whole, non-negative Toman amount', () => {
  const body = { customer: { name: 'سارا', phone: '+989121234567', city: 'تهران', address: 'خیابان ولیعصر، کوچه ۱۲' }, items: [{ cartKey: 'mahtab', qty: 1 }] };
  assert.equal(validateCheckoutBody(body).value.expectedTotal, null);
  assert.equal(validateCheckoutBody({ ...body, expected_total: 3650000 }).value.expectedTotal, 3650000);
  for (const bad of [-1, 1.5, '3650000', 'x', {}, 1e20]) assert.equal(validateCheckoutBody({ ...body, expected_total: bad }).error, 'درخواست نامعتبر است.', String(bad));
});

// ---- payment server: HTTP ------------------------------------------------------------

let server, base, orders, zpCalls, campaignsInDb, logs;
const config = { publicSiteUrl: 'https://glow-home.ir', callbackUrl: 'https://pay.example.ir/api/verify', zarinpal: { mode: 'sandbox' } };
beforeEach(async () => {
  orders = [];
  zpCalls = [];
  logs = [];
  campaignsInDb = [yalda];
  const db = {
    async fetchProductsBySlugs(slugs) { return PRODUCTS.filter((p) => slugs.includes(p.slug)); },
    async fetchActiveCampaigns() { return campaignsInDb; },
    async nextOrderCode() { return 'GH-' + (2000 + orders.length); },
    async createOrder(o, items) { orders.push({ ...o, items }); return { id: 'o' + orders.length, code: o.code }; },
    async setAuthority() {},
    async markFailed() {},
  };
  const zarinpal = {
    startPayUrl: (a) => `https://sandbox.zarinpal.com/pg/StartPay/${a}`,
    async requestPayment(args) { zpCalls.push(args); return 'S' + '1'.repeat(35); },
  };
  if (server) server.close();
  const app = createApp({ config, db, zarinpal, logger: (...a) => logs.push(a) });
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server && server.close());

// The real clock decides on the server: yalda's dates are moved around "now".
const running = () => ({ ...yalda, starts_at: new Date(Date.now() - H).toISOString(), ends_at: new Date(Date.now() + H).toISOString() });
const body = (items, extra = {}) => ({
  customer: { name: 'سارا', phone: '+989121234567', city: 'تهران', address: 'خیابان ولیعصر، کوچه ۱۲، پلاک ۳', postcode: '' },
  items,
  ...extra,
});
const checkout = async (b) => {
  const res = await fetch(base + '/api/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://glow-home.ir' }, body: JSON.stringify(b) });
  return { status: res.status, json: await res.json() };
};

test('HTTP: a running campaign is charged, the order lines carry list price and name, ZarinPal gets total × 10', async () => {
  campaignsInDb = [running()];
  const expected = 2800000 + 2 * 1235000 + TEHRAN_PACKAGING_FEE_TOMAN; // mahtab 3.5M −20%, lale 1,234,567 −20% → 987,654 → 988,000
  const items = [{ cartKey: 'mahtab', qty: 1 }, { cartKey: 'lale', qty: 2 }];
  const r = await checkout(body(items, { expected_total: 2800000 + 2 * 988000 + TEHRAN_PACKAGING_FEE_TOMAN }));
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(orders.length, 1);
  assert.equal(orders[0].total, 2800000 + 2 * 988000 + TEHRAN_PACKAGING_FEE_TOMAN);
  assert.notEqual(orders[0].total, expected, 'rounding is per unit, to the nearest 1,000');
  assert.equal(orders[0].payment_amount_rial, orders[0].total * 10);
  assert.equal(zpCalls[0].amount, orders[0].total * 10);
  assert.deepEqual(orders[0].items.map((it) => [it.unit_price, it.list_price, it.campaign_name]), [
    [2800000, 3500000, 'یلدا'],
    [988000, 1234567, 'یلدا'],
    [TEHRAN_PACKAGING_FEE_TOMAN, undefined, undefined],
  ]);
});

test('HTTP: a campaign that ended while the customer was at checkout → 409 with the new total; no order, no payment', async () => {
  const shown = 2800000 + TEHRAN_PACKAGING_FEE_TOMAN; // the page still showed یلدا
  campaignsInDb = [{ ...running(), ends_at: new Date(Date.now() - 1000).toISOString() }];
  const r = await checkout(body([{ cartKey: 'mahtab', qty: 1 }], { expected_total: shown }));
  assert.equal(r.status, 409);
  assert.deepEqual(r.json, { ok: false, code: 'price_changed', total: 3500000 + TEHRAN_PACKAGING_FEE_TOMAN, error: PRICE_CHANGED_ERROR });
  assert.equal(orders.length, 0);
  assert.equal(zpCalls.length, 0);
  assert.ok(logs.some(([, event]) => event === 'checkout.price_changed'));
});

test('HTTP: a campaign switched off, deleted, or starting later → the list price; a tampered price or fee is ignored', async () => {
  for (const rows of [[{ ...running(), enabled: false }], [], [{ ...running(), starts_at: new Date(Date.now() + H).toISOString() }]]) {
    campaignsInDb = rows;
    orders.length = 0;
    const r = await checkout(body([{ cartKey: 'mahtab', qty: 1, price: 1, unit_price: 1 }], { fees: [], total: 1, subtotal: 1, campaigns: [{ ...yalda, percent: 90 }] }));
    assert.equal(r.status, 200);
    assert.equal(orders[0].total, 3500000 + TEHRAN_PACKAGING_FEE_TOMAN);
  }
});

test('HTTP: a lower expected_total never lowers the charge — it only refuses', async () => {
  campaignsInDb = [];
  const r = await checkout(body([{ cartKey: 'mahtab', qty: 1 }], { expected_total: 1000 }));
  assert.equal(r.status, 409);
  assert.equal(r.json.total, 3500000 + TEHRAN_PACKAGING_FEE_TOMAN);
  assert.equal(orders.length, 0);
  // matching it goes through, at the server's amount
  const ok = await checkout(body([{ cartKey: 'mahtab', qty: 1 }], { expected_total: r.json.total }));
  assert.equal(ok.status, 200);
  assert.equal(zpCalls[0].amount, r.json.total * 10);
});

test('HTTP: a page without expected_total (opened before this release) still checks out at the server price', async () => {
  campaignsInDb = [running()];
  const r = await checkout(body([{ cartKey: 'mahtab', qty: 1 }]));
  assert.equal(r.status, 200);
  assert.equal(orders[0].total, 2800000 + TEHRAN_PACKAGING_FEE_TOMAN);
});

test('db: the campaigns read and the email items read survive a database without the migration', () => {
  const dbJs = read('../src/db.js');
  assert.ok(isMissingTable({ code: 'PGRST205', message: "Could not find the table 'public.discount_campaigns'" }));
  assert.ok(isMissingTable({ code: '42P01', message: 'relation "discount_campaigns" does not exist' }));
  assert.ok(!isMissingTable({ code: '57014', message: 'canceling statement due to statement timeout' }));
  assert.ok(isMissingColumn({ code: '42703', message: 'column order_items.list_price does not exist' }));
  assert.ok(!isMissingColumn({ code: '08006', message: 'connection failure' }));
  assert.match(dbJs, /\.from\('discount_campaigns'\)\s*\.select\('id, name, percent, scope, collections, product_slugs, starts_at, ends_at, enabled'\)\s*\.eq\('enabled', true\)/);
  assert.match(dbJs, /if \(error && isMissingTable\(error\)\) return \[\];\s*check\(error, 'fetch campaigns'\);/);
  assert.match(read('../src/app.js'), /const campaigns = await guard\.run\('fetch_campaigns', \(\) => db\.fetchActiveCampaigns\(\)\);/);
});

// ---- storefront ------------------------------------------------------------------------

/** The real catalog → items → cart → screens code from app.js and data.js,
 * with a stub DOM. */
function storefront({ campaigns = [], cart = {}, route = 'product', param = 'gisoo', form = {} } = {}) {
  const state = {
    cart, favs: {}, route, param, selectedHeight: null, selectedShade: null, selectedColorIndex: 0, appliedCode: null, code: '',
    ship: 'peyk', pay: 'gateway', error: '', placingOrder: false, snappPayOpen: false,
    form: { name: '', phone: '', city: 'تهران', cityChoice: 'tehran', address: '', postcode: '', note: '', ...form },
    formErrors: {},
  };
  const rows = [
    { slug: 'gisoo', name_fa: 'گیسو', name_en: 'Gisoo', collection: 'lamps', height_cm: 100, price: 9100000, price_provisional: false, in_stock: true, material: 'سفال', variants: gisoo.variants, shade_types: [], colors: [] },
    { slug: 'mahtab', name_fa: 'مهتاب', name_en: '', collection: 'shades', height_cm: 40, price: 3500000, price_provisional: true, in_stock: true, material: 'متقال', variants: mahtab.variants, colors: [] },
    { slug: 'lale', name_fa: 'لاله', name_en: '', collection: 'candles', height_cm: null, price: 1234567, price_provisional: false, in_stock: true, material: '', variants: [], colors: [] },
  ];
  const appFns = [
    'toLatinDigits', 'normalizePersianText', 'isTehranCity', 'cityFees', 'campaignIsActive', 'campaignCovers', 'bestCampaignFor', 'discountedPrice', 'applyCampaign',
    'parseCartKey', 'hasShadeTypes', 'shadeTypesOf', 'withBaseSize', 'buildItems', 'saleOf', 'saleBadgeHtml', 'salePriceHtml', 'sizeShadesOf', 'defaultShade',
    'shadeOption', 'cartLineData', 'cartKeyFor', 'cardCartKey', 'shippingMethodForCity', 'syncShippingToCity', 'totals', 'feeRowsHtml', 'shipRowHtml', 'shipHintHtml',
    'shipOptionsHtml', 'media', 'card', 'screenProduct', 'screenCart', 'screenCheckout', 'applyCatalog', 'cartCount', 'groupDigits', 'isDigitChar', 'formatDigitsForDisplay',
  ];
  const code = [
    dataJs,
    grab(appJs, /const FA_DIGITS = [^\n]*\n/),
    grab(appJs, /const AR_DIGITS = [^\n]*\n/),
    grab(appJs, /const FA = [^\n]*\n/),
    grab(appJs, /const money = [^\n]*\n/),
    grab(appJs, /const esc = \(s\) =>[\s\S]*?;\n/),
    grab(appJs, /\/\/ ---- City fees \(shared rule\) -+\n[\s\S]*?\/\/ ---- end of city fees -+\n/).replace(/^(const|function) (normalizePersianText)/m, '$1 _unused_$2'),
    block(appJs),
    grab(appJs, /const SHADE_TYPES = [^\n]*\n/),
    'let OUT = new Set(OUT_OF_STOCK); let ITEMS = []; let CAMPAIGNS = [];',
    'const byId = (id) => ITEMS.find((p) => p.id === id);',
    'const proxiedPhotoUrl = (u) => u; const icon = (n) => ""; const gallery = () => ""; const saveStore = () => {};',
    'const fieldHtml = () => ""; const isOnlinePayment = () => true; const payByContactHtml = () => ""; const payByContactBarHtml = () => ""; const snappPayBannerHtml = () => "";',
    'const cityFieldHtml = () => ""; const sizeFa = String;',
    ...appFns.filter((n) => !['toLatinDigits', 'normalizePersianText', 'isTehranCity', 'cityFees', 'campaignIsActive', 'campaignCovers', 'bestCampaignFor', 'discountedPrice', 'applyCampaign'].includes(n)).map((n) => fnIn(appJs, n)),
    fnIn(appJs, 'toLatinDigits'),
    fnIn(appJs, 'normalizePersianText'),
    'return { setCampaigns: (c) => { CAMPAIGNS = c; }, applyCatalog, byId, cartLineData, totals, card, screenProduct, screenCart, screenCheckout };',
  ].join('\n');
  const api = new Function('state', 'console', '$', '$$', code)(state, { warn() {} }, () => null, () => []);
  api.setCampaigns(campaigns);
  api.applyCatalog(rows);
  return { ...api, state };
}
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

test('storefront: with no campaign every price and screen is exactly as before (no badge, no struck price)', () => {
  const sf = storefront({ cart: { 'gisoo::h140::sembroidered': 1, mahtab: 2 } });
  for (const html of [sf.card(sf.byId('gisoo')), sf.screenProduct(), sf.screenCart(), sf.screenCheckout()]) {
    assert.doesNotMatch(html, /sale-badge|price-was|sale-note/);
  }
  const t = sf.totals();
  assert.equal(t.discount, 0);
  assert.equal(t.subtotal, 15450000 + 2 * 3500000);
  assert.equal(t.total, t.subtotal + TEHRAN_PACKAGING_FEE_TOMAN);
});

test('storefront card: old price struck through, new price, «٪۲۰ تخفیف»', () => {
  const sf = storefront({ campaigns: [yalda] });
  const html = sf.card(sf.byId('gisoo'));
  assert.match(html, /<div class="card-price">\s*<s class="price-was" aria-label="قیمت قبل">۹٬۱۰۰٬۰۰۰ تومان<\/s><b>۷٬۲۸۰٬۰۰۰ تومان<\/b><span class="sale-badge">٪۲۰ تخفیف<\/span>/);
  // a provisional price keeps its flag next to the sale
  assert.match(sf.card(sf.byId('mahtab')), /<b>۲٬۸۰۰٬۰۰۰ تومان<\/b><span class="sale-badge">٪۲۰ تخفیف<\/span>\s*<span class="temp-flag">موقت<\/span>/);
});

test('storefront product page: the chosen size and shade price, the campaign name, and the pickers all discounted', () => {
  const sf = storefront({ campaigns: [lampsOnly, yalda] });
  sf.state.selectedHeight = 140;
  sf.state.selectedShade = 'embroidered';
  const html = sf.screenProduct();
  assert.match(html, /<div class="price-row">\s*<s class="price-was" aria-label="قیمت قبل">۱۵٬۴۵۰٬۰۰۰ تومان<\/s><b>۱۰٬۸۱۵٬۰۰۰ تومان<\/b><span class="sale-badge">٪۳۰ تخفیف<\/span>/);
  assert.match(html, /<div class="sale-note">تخفیف «جشن آباژور» — روی همه‌ی اندازه‌ها و شیدها<\/div>/);
  // the size picker shows each size at the chosen shade: 15,450,000 / 11,450,000 −30%
  assert.match(html, /۱۴۰ سانتی‌متر — ۱۰٬۸۱۵٬۰۰۰ تومان/, 'size picker, 140');
  assert.match(html, /۱۰۰ سانتی‌متر — ۸٬۰۱۵٬۰۰۰ تومان/, 'size picker, 100');
  assert.match(html, /شید گلدوزی — ۱۰٬۸۱۵٬۰۰۰ تومان/, 'shade picker');
  // a size the campaign leaves unrounded-equal shows no badge: none here; a product with no campaign:
  const plain = storefront({ campaigns: [lampsOnly], param: 'mahtab' });
  assert.doesNotMatch(plain.screenProduct(), /sale-badge|sale-note/);
});

test('storefront cart and checkout: line prices discounted, «تخفیف» is the amount saved, totals use the discounted prices', () => {
  const cart = { 'gisoo::h140::sembroidered': 2, 'mahtab::h50': 1, lale: 3 };
  const sf = storefront({ campaigns: [lampsOnly], cart, route: 'cart' });
  const t = sf.totals();
  assert.equal(t.subtotal, 2 * 15450000 + 4000000 + 3 * 1234567, '«جمع کالاها» at list prices');
  assert.equal(t.campaignDiscount, 2 * (15450000 - 10815000));
  assert.equal(t.discount, t.campaignDiscount);
  assert.equal(t.total, 2 * 10815000 + 4000000 + 3 * 1234567 + TEHRAN_PACKAGING_FEE_TOMAN);
  // the same number the payment server charges
  const server = price([['gisoo::h140::sembroidered', 2], ['mahtab::h50'], ['lale', 3]], [lampsOnly]);
  assert.equal(t.total, server.total);

  const cartHtml = sf.screenCart();
  assert.match(cartHtml, /واحد <s class="price-was">۱۵٬۴۵۰٬۰۰۰ تومان<\/s> ۱۰٬۸۱۵٬۰۰۰ تومان <span class="sale-badge">٪۳۰ تخفیف<\/span>/);
  assert.match(cartHtml, /<span>تخفیف<\/span><span class="sage" data-sum="discount">− ۹٬۲۷۰٬۰۰۰ تومان<\/span>/);
  assert.equal((cartHtml.match(/sale-badge/g) || []).length, 1, 'only the discounted line');

  const checkoutHtml = sf.screenCheckout();
  assert.match(checkoutHtml, /<span><s class="price-was">۳۰٬۹۰۰٬۰۰۰ تومان<\/s> ۲۱٬۶۳۰٬۰۰۰ تومان<\/span>/);
  assert.match(checkoutHtml, /<div class="sum-row"><span>تخفیف<\/span><span class="sage">− ۹٬۲۷۰٬۰۰۰ تومان<\/span><\/div>/);
  assert.match(text(checkoutHtml), new RegExp('قابل پرداخت ' + text(`${t.total}`.replace(/./g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d])).replace(/\B(?=([۰-۹]{3})+(?![۰-۹]))/g, '٬') + ' تومان'));
});

test('storefront: a product removed from every campaign, or a campaign deleted, just shows the list price — cart keys never change', () => {
  const cart = { 'gisoo::h100::splain': 1 };
  const before = storefront({ campaigns: [yalda], cart });
  const after = storefront({ campaigns: [], cart: { ...cart } });
  assert.deepEqual(Object.keys(before.state.cart), Object.keys(after.state.cart));
  assert.equal(before.cartLineData('gisoo::h100::splain').price, 7280000);
  assert.equal(after.cartLineData('gisoo::h100::splain').price, 9100000);
  assert.equal(after.cartLineData('gisoo::h100::splain').sale.campaign, null);
});

test('storefront: checkout sends the total it shows; a 409 reloads prices and shows the new total, never pays', () => {
  const place = fnIn(appJs, 'placeOrder');
  assert.match(place, /expected_total: t\.total,/);
  assert.doesNotMatch(place, /price:|unit_price|list_price/);
  const start = fnIn(appJs, 'startOnlinePayment');
  assert.ok(start.indexOf("res.code === 'price_changed'") < start.indexOf('location.href = res.url'));
  const changed = fnIn(appJs, 'priceChanged');
  assert.match(changed, /return refreshPrices\(\)\.then\(\(\) => fail\(msg\), \(\) => fail\(msg\)\);/);
  assert.match(changed, /'مبلغ جدید: ' \+ money\(res\.total\)/);
  assert.match(changed, /هیچ مبلغی پرداخت نشده است/);
  assert.match(fnIn(appJs, 'fetchCampaigns'), /\.from\('discount_campaigns'\)/);
  assert.match(fnIn(appJs, 'fetchCampaigns'), /return \[\];/, 'unreadable campaigns → full prices (the server still decides)');
});

test('storefront styles: badge and struck price exist; the badge is white on the shop red', () => {
  assert.match(stylesCss, /\.sale-badge \{[^}]*color: #fff;[^}]*background: var\(--color-red-700\);/);
  assert.match(stylesCss, /\.price-was \{/);
  assert.match(stylesCss, /\.sale-note \{/);
});

// ---- admin: the tab -----------------------------------------------------------------------

const adminFns = new Function(
  [
    grab(adminJs, /const COLLECTION_LABEL = [^\n]*\n/),
    block(adminJs),
    ...['TEHRAN_UTC_OFFSET_MIN', 'JALALI_MONTHS', 'CAMPAIGN_NAME_MAX'].map((n) => grab(adminJs, new RegExp(`const ${n} = [^\\n]*\\n`))),
    ...['escapeHtml', 'escapeAttr', 'faNum', 'money', 'toLatinDigits', 'gregorianToJalali', 'jalaliToGregorian', 'tehranDayStartIso', 'tehranJalaliOf', 'jalaliFieldValue',
      'campaignFormToSave', 'campaignStatus', 'campaignDateFa', 'campaignScopeFa', 'campaignPreviewRows', 'campaignPreviewHtml', 'campaignListHtml', 'jalaliPickerHtml', 'campaignFormHtml',
      'lineListPrice', 'lineDiscountNote', 'orderPaymentState', 'phoneDisplay', 'paymentInfoHtml', 'orderPrintHtml', 'orderCardHtml'].map((n) => fnIn(adminJs, n)),
    grab(adminJs, /const SHOP_INSTAGRAM = [^\n]*\n/),
    grab(adminJs, /const SHOP_SENDER_NAME = [^\n]*\n/),
    grab(adminJs, /const SHOP_SENDER_PHONE = [^\n]*\n/),
    grab(adminJs, /const SHIPPING_LABEL = [^\n]*\n/),
    grab(adminJs, /const STATUS_LABEL = \{[\s\S]*?\n\};\n/),
    grab(adminJs, /const UNPAID_ONLINE = [^\n]*\n/),
    'return { gregorianToJalali, jalaliToGregorian, tehranDayStartIso, tehranJalaliOf, campaignFormToSave, campaignStatus, campaignDateFa, campaignPreviewRows, campaignPreviewHtml, campaignListHtml, campaignFormHtml, orderPrintHtml, orderCardHtml };',
  ].join('\n')
)();

test('Jalali dates: day by day against the Persian calendar for 1395–1435', () => {
  const { gregorianToJalali, jalaliToGregorian } = adminFns;
  const fmt = new Intl.DateTimeFormat('en-u-ca-persian-nu-latn', { timeZone: 'UTC', year: 'numeric', month: 'numeric', day: 'numeric' });
  let checked = 0;
  for (let t = Date.UTC(2016, 2, 20); t < Date.UTC(2057, 2, 20); t += 86400000) {
    const d = new Date(t);
    const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
    const ref = [parseInt(parts.year, 10), Number(parts.month), Number(parts.day)];
    const g = [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
    assert.deepEqual(gregorianToJalali(...g), ref, g.join('-'));
    assert.deepEqual(jalaliToGregorian(...ref), g, ref.join('/'));
    checked++;
  }
  assert.ok(checked > 14000);
});

test('Jalali dates → Tehran time: start at 00:00, end after the whole last day; impossible days refused', () => {
  const { tehranDayStartIso, tehranJalaliOf } = adminFns;
  assert.equal(tehranDayStartIso(1405, 9, 30), '2026-12-20T20:30:00.000Z'); // یلدا 1405 starts 00:00 Tehran on 21 Dec
  assert.equal(tehranDayStartIso(1405, 9, 30, 1), '2026-12-21T20:30:00.000Z');
  assert.equal(tehranDayStartIso(1405, 1, 1), '2026-03-20T20:30:00.000Z'); // نوروز
  assert.equal(tehranDayStartIso(1403, 12, 30), '2025-03-19T20:30:00.000Z', '1403 is a leap year');
  assert.equal(tehranDayStartIso(1404, 12, 30), null, '1404 is not');
  assert.equal(tehranDayStartIso(1405, 7, 31), null, 'مهر has 30 days');
  assert.deepEqual(tehranJalaliOf(Date.parse('2026-12-20T20:29:59Z')), [1405, 9, 29]);
  assert.deepEqual(tehranJalaliOf(Date.parse('2026-12-20T20:30:00Z')), [1405, 9, 30]);
});

const form = (over = {}) => ({
  name: 'یلدا', percent: '20', scope: 'all', collections: [], productSlugs: [],
  start: { y: '1405', m: '9', d: '30' }, end: { y: '1405', m: '10', d: '1' }, enabled: true, ...over,
});

test('admin form → row: name, percent, scope, Tehran dates, switch', () => {
  const { campaignFormToSave } = adminFns;
  assert.deepEqual(campaignFormToSave(form()), {
    row: { name: 'یلدا', percent: 20, scope: 'all', collections: [], product_slugs: [], starts_at: '2026-12-20T20:30:00.000Z', ends_at: '2026-12-22T20:30:00.000Z', enabled: true },
  });
  const r = campaignFormToSave(form({ name: '  نوروز   ۱۴۰۶ ', percent: '۱۵', scope: 'collections', collections: ['lamps', 'decor', 'lamps', 'bogus'], productSlugs: ['x'], start: {}, end: {}, enabled: false })).row;
  assert.deepEqual(r, { name: 'نوروز ۱۴۰۶', percent: 15, scope: 'collections', collections: ['lamps', 'decor'], product_slugs: [], starts_at: null, ends_at: null, enabled: false });
  assert.deepEqual(campaignFormToSave(form({ scope: 'products', productSlugs: ['lale', 'lale', 'gisoo'] })).row.product_slugs, ['lale', 'gisoo']);
  assert.equal(campaignFormToSave(form({ start: { y: '1405', m: '9', d: '30' }, end: { y: '1405', m: '9', d: '30' } })).row.ends_at, '2026-12-21T20:30:00.000Z', 'a one-day campaign');
});

test('admin form: every mistake gets its own Persian error', () => {
  const { campaignFormToSave } = adminFns;
  const err = (over) => campaignFormToSave(form(over)).error;
  assert.equal(err({ name: '   ' }), 'نام مناسبت را وارد کنید (مثلاً «یلدا»).');
  assert.equal(err({ name: 'ی'.repeat(61) }), 'نام مناسبت حداکثر ۶۰ حرف باشد.');
  for (const percent of ['', '0', '91', '100', '12.5', '-5', 'بیست', '20%']) {
    assert.equal(err({ percent }), 'درصد تخفیف باید عددی صحیح از ۱ تا ۹۰ باشد.', percent);
  }
  assert.equal(campaignFormToSave(form({ percent: '۹۰' })).row.percent, 90);
  assert.equal(err({ scope: '' }), 'مشخص کنید تخفیف روی چه محصولاتی اعمال شود.');
  assert.equal(err({ scope: 'collections', collections: [] }), 'دست‌کم یک دسته را انتخاب کنید.');
  assert.equal(err({ scope: 'products', productSlugs: [] }), 'دست‌کم یک محصول را انتخاب کنید.');
  assert.equal(err({ start: { y: '1405', m: '', d: '1' } }), 'تاریخ شروع را کامل انتخاب کنید (سال، ماه و روز).');
  assert.equal(err({ end: { y: '1404', m: '12', d: '30' } }), 'تاریخ پایان معتبر نیست (این روز در تقویم وجود ندارد).');
  assert.equal(err({ start: { y: '1405', m: '10', d: '5' }, end: { y: '1405', m: '10', d: '1' } }), 'تاریخ پایان نباید پیش از تاریخ شروع باشد.');
});

const adminProducts = [
  { id: 'g1', slug: 'gisoo', name_fa: 'گیسو', collection: 'lamps', price: 9100000, variants: gisoo.variants, in_stock: true, price_provisional: false },
  { id: 'm1', slug: 'mahtab', name_fa: 'مهتاب', collection: 'shades', price: 3500000, variants: [], in_stock: false, price_provisional: true },
  { id: 'u1', slug: 'new-lamp', name_fa: 'آباژور تازه', collection: 'lamps', price: 0, variants: [], in_stock: true },
];

test('admin preview: product, price now, price after, and the notes that matter', () => {
  const { campaignPreviewRows, campaignPreviewHtml } = adminFns;
  const row = { id: null, name: 'یلدا', percent: 20, scope: 'all', collections: [], product_slugs: [] };
  const rows = campaignPreviewRows(row, adminProducts, [lampsOnly], NOW);
  assert.deepEqual(rows.map((r) => [r.name_fa, r.price, r.sale]), [['گیسو', 9100000, 7280000], ['مهتاب', 3500000, 2800000], ['آباژور تازه', 0, 0]]);
  assert.deepEqual(rows[0].notes, ['«جشن آباژور» با ٪۳۰ بیشتر است و هم‌زمان به جای این تخفیف اعمال می‌شود', 'همه‌ی اندازه‌ها و شیدها هم ٪۲۰']);
  assert.deepEqual(rows[1].notes, ['قیمت موقت', 'ناموجود']);
  assert.deepEqual(rows[2].notes.slice(0, 1), ['بدون قیمت — تخفیفی اعمال نمی‌شود']);
  const html = campaignPreviewHtml(rows);
  assert.match(html, /<thead><tr><th>محصول<\/th><th>قیمت فعلی<\/th><th>قیمت با تخفیف<\/th><th>توضیح<\/th><\/tr><\/thead>/);
  assert.match(html, /<td data-label="محصول">گیسو<\/td><td class="num" data-label="قیمت فعلی">۹٬۱۰۰٬۰۰۰ تومان<\/td><td class="num" data-label="قیمت با تخفیف"><b>۷٬۲۸۰٬۰۰۰ تومان<\/b><\/td>/);
  assert.match(html, /۳ محصول — قیمت‌ها گرد به نزدیک‌ترین ۱٬۰۰۰ تومان/);
  // only the chosen collection; a switched-off or ended rival doesn't count
  const lamps = campaignPreviewRows({ ...row, scope: 'collections', collections: ['lamps'] }, adminProducts, [{ ...lampsOnly, enabled: false }], NOW);
  assert.deepEqual(lamps.map((r) => r.name_fa), ['گیسو', 'آباژور تازه']);
  assert.ok(!lamps[0].notes.some((n) => n.includes('جشن')));
  assert.match(campaignPreviewHtml([]), /هیچ محصولی در این تخفیف نیست/);
  // the preview's prices are the rule's prices (the same block as the payment server)
  assert.equal(rows[0].sale, discountedPrice(9100000, 20));
});

test('admin list: status by date, scope, Jalali dates, and edit / stop / delete on every row', () => {
  const { campaignListHtml, campaignStatus } = adminFns;
  assert.equal(campaignStatus(yalda, NOW).label, 'فعال');
  assert.equal(campaignStatus(yalda, Date.parse(yalda.starts_at) - 1).label, 'زمان‌بندی‌شده');
  assert.equal(campaignStatus(yalda, Date.parse(yalda.ends_at)).label, 'پایان‌یافته');
  assert.equal(campaignStatus({ ...yalda, enabled: false }, NOW).label, 'خاموش');
  const html = campaignListHtml([yalda, lampsOnly, { ...lalePick, enabled: false }], NOW);
  assert.match(html, /<td class="dc-name"><b>یلدا<\/b><\/td>\s*<td data-label="درصد">٪۲۰<\/td>\s*<td data-label="اعمال روی">همه محصولات<\/td>\s*<td data-label="از">۳۰ آذر ۱۴۰۵<\/td>\s*<td data-label="تا">۱ دی ۱۴۰۵<\/td>/);
  assert.match(html, /<td data-label="اعمال روی">آباژور<\/td>\s*<td data-label="از">—<\/td>\s*<td data-label="تا">—<\/td>/);
  assert.match(html, /<td data-label="اعمال روی">۱ محصول انتخابی<\/td>/);
  assert.equal((html.match(/data-dc="edit">ویرایش</g) || []).length, 3);
  assert.equal((html.match(/data-dc="toggle">توقف</g) || []).length, 2);
  assert.equal((html.match(/data-dc="toggle">روشن کردن</g) || []).length, 1);
  assert.equal((html.match(/data-dc="delete">حذف</g) || []).length, 3);
  assert.match(campaignListHtml([{ ...yalda, name: '<img src=x>' }], NOW), /&lt;img src=x&gt;/);
});

test('admin form: filled from a saved campaign, with the four collections and a searchable product checklist', () => {
  const { campaignFormHtml } = adminFns;
  const html = campaignFormHtml({ ...lampsOnly, starts_at: yalda.starts_at, ends_at: yalda.ends_at }, adminProducts, NOW);
  assert.match(html, /ویرایش «جشن آباژور»/);
  assert.match(html, /id="dc-percent" inputmode="numeric" dir="ltr" value="30"/);
  assert.match(html, /value="collections" checked> یک یا چند دسته/);
  for (const label of ['آباژور', 'شید', 'شمع', 'اکسسوری منزل']) assert.match(html, new RegExp(`class="dc-col" value="[a-z]+"[^>]*> ${label}<`));
  assert.match(html, /class="dc-col" value="lamps" checked>/);
  assert.match(html, /id="dc-product-search"/);
  assert.match(html, /class="dc-prod" value="gisoo"/);
  assert.match(html, /<select id="dc-start-d"[\s\S]*?<option value="30" selected>۳۰<\/option>/);
  assert.match(html, /<select id="dc-start-m"[\s\S]*?<option value="9" selected>آذر<\/option>/);
  assert.match(html, /<select id="dc-end-d"[\s\S]*?<option value="1" selected>۱<\/option>/);
  assert.match(html, /<select id="dc-end-m"[\s\S]*?<option value="10" selected>دی<\/option>/);
  assert.match(html, /id="dc-enabled" checked/);
  assert.match(html, /id="dc-preview-btn">پیش‌نمایش قیمت‌ها</);
  assert.match(campaignFormHtml(null, adminProducts, NOW), /تخفیف تازه[\s\S]*value="all" checked> همه محصولات/);
});

test('admin at 390 px: date fields stack, the list and preview become cards with labels', () => {
  assert.match(adminHtml, /\.dc-dates > div \{ flex: 1 1 260px; \}/);
  assert.match(adminHtml, /@media \(max-width: 600px\) \{\s*\.dc-list thead, \.dc-preview thead \{ display: none; \}/);
  assert.match(adminHtml, /td\[data-label\]::before \{ content: attr\(data-label\) ': ';/);
});

test('admin: the tab, saving shows the preview first, delete asks, a missing table says which SQL to run', () => {
  assert.match(adminHtml, /<button class="tab-btn" data-tab="orders">سفارش‌ها<\/button>\s*<button class="tab-btn" data-tab="discounts">تخفیف‌ها<\/button>/);
  assert.match(adminHtml, /<div id="tab-discounts" class="tab-panel">/);
  assert.match(adminJs, /if \(btn\.dataset\.tab === 'discounts'\) loadCampaigns\(\);/);
  assert.match(fnIn(adminJs, 'saveCampaign'), /^async function saveCampaign\(\) \{\n  const row = previewCampaign\(\);\n  if \(!row\) return;/);
  assert.match(adminJs, /if \(!confirm\(`حذف تخفیف «\$\{c\.name\}»؟ سفارش‌های قبلی تغییری نمی‌کنند\.`\)\)/);
  assert.match(adminJs, /update\(\{ enabled: !c\.enabled, updated_at: /);
  assert.match(adminJs, /'جدول تخفیف‌ها هنوز ساخته نشده است\. اول فایل supabase\/migration-discount-campaigns\.sql را در Supabase اجرا کنید\.'/);
});

// ---- order lines: admin card, print, email ----------------------------------------------------

const ORDER = {
  id: 'o1', code: 'GH-1100', created_at: '2026-12-21T09:00:00Z', status: 'paid', paid_at: '2026-12-21T09:05:00Z', payment_method: 'zarinpal', payment_ref_id: '201',
  customer_name: 'سارا', phone: '09121234567', city: 'تهران', address: 'خیابان ولیعصر', postcode: '', note: '', shipping_method: 'peyk',
  total: 2 * 10815000 + 3500000 + TEHRAN_PACKAGING_FEE_TOMAN,
};
const LINES = [
  { product_id: 'g1', name_fa: 'گیسو (140 سانتی‌متر) — شید گلدوزی', qty: 2, unit_price: 10815000, list_price: 15450000, campaign_name: 'جشن آباژور' },
  { product_id: 'm1', name_fa: 'مهتاب', qty: 1, unit_price: 3500000, list_price: null, campaign_name: null },
  { product_id: null, name_fa: 'هزینه بسته‌بندی', qty: 1, unit_price: TEHRAN_PACKAGING_FEE_TOMAN, list_price: null, campaign_name: null },
];

test('order lines: the admin card, the print and the email show «قیمت اصلی / تخفیف» honestly and add up', () => {
  const card = adminFns.orderCardHtml(ORDER, LINES);
  assert.match(card, /گیسو \(140 سانتی‌متر\) — شید گلدوزی × 2<span class="order-item-was">قیمت اصلی ۱۵٬۴۵۰٬۰۰۰ تومان — تخفیف «جشن آباژور»<\/span><\/span><span>۲۱٬۶۳۰٬۰۰۰ تومان<\/span>/);
  assert.equal((card.match(/order-item-was/g) || []).length, 1);

  const print = adminFns.orderPrintHtml(ORDER, LINES, 'https://glow-home.ir');
  assert.match(print, /<td>گیسو \(140 سانتی‌متر\) — شید گلدوزی<div class="was">قیمت اصلی ۱۵٬۴۵۰٬۰۰۰ تومان — تخفیف «جشن آباژور»<\/div><\/td>/);
  assert.match(print, /<div><span>جمع اقلام با قیمت اصلی<\/span><span>۳۴٬۴۰۰٬۰۰۰ تومان<\/span><\/div>\s*<div><span>تخفیف مناسبت \(جشن آباژور\)<\/span><span>−۹٬۲۷۰٬۰۰۰ تومان<\/span><\/div>/);
  assert.match(print, /<div class="grand"><span>مبلغ پرداخت‌شده<\/span><span>۲۵٬۲۸۰٬۰۰۰ تومان<\/span><\/div>/);
  assert.doesNotMatch(print, /<span>تخفیف<\/span>/, 'no second, generic discount line');

  const email = paidOrderHtml(ORDER, LINES);
  assert.match(email, /گیسو \(140 سانتی‌متر\) — شید گلدوزی<br><span style="color:#555;font-size:12px">قیمت اصلی ۱۵٬۴۵۰٬۰۰۰ تومان — تخفیف «جشن آباژور»<\/span>/);
  assert.match(email, /جمع اقلام با قیمت اصلی<\/td><td[^>]*>۳۴٬۴۰۰٬۰۰۰ تومان/);
  assert.match(email, /تخفیف مناسبت \(جشن آباژور\)<\/td><td[^>]*>−۹٬۲۷۰٬۰۰۰ تومان/);
  // list − campaign + fee = total
  assert.equal(34400000 - 9270000 + TEHRAN_PACKAGING_FEE_TOMAN, ORDER.total);
});

test('order lines: old orders (no list_price) look exactly as before; names are escaped', () => {
  const old = LINES.map(({ list_price, campaign_name, ...rest }) => ({ ...rest, unit_price: rest.product_id === 'g1' ? 15450000 : rest.unit_price }));
  const oldOrder = { ...ORDER, total: 2 * 15450000 + 3500000 + TEHRAN_PACKAGING_FEE_TOMAN };
  for (const html of [adminFns.orderCardHtml(oldOrder, old), adminFns.orderPrintHtml(oldOrder, old), paidOrderHtml(oldOrder, old)]) {
    assert.doesNotMatch(html, /قیمت اصلی|تخفیف مناسبت|order-item-was|class="was"/);
  }
  assert.match(adminFns.orderPrintHtml(oldOrder, old), /<div><span>جمع اقلام<\/span><span>۳۴٬۴۰۰٬۰۰۰ تومان<\/span><\/div>/);
  const evil = [{ ...LINES[0], campaign_name: '<script>x</script>' }];
  for (const html of [adminFns.orderCardHtml(ORDER, evil), adminFns.orderPrintHtml(ORDER, evil), paidOrderHtml(ORDER, evil)]) {
    assert.doesNotMatch(html, /<script>x/);
    assert.match(html, /&lt;script&gt;x/);
  }
});

test('stats stay as they were: revenue is the order total, best-sellers count names and quantities', () => {
  assert.match(adminJs, /const revenue = counted\.reduce\(\(sum, o\) => sum \+ \(o\.total \|\| 0\), 0\);/);
  assert.match(adminJs, /\.select\('name_fa, qty, orders!inner\(status\)'\)/);
});

// ---- SQL ---------------------------------------------------------------------------------------

const code = (s) => s.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

test('SQL: one transaction, idempotent, nothing but the new table and two nullable columns', () => {
  const c = code(sql);
  assert.match(c, /^\s*begin;/m);
  assert.match(c, /^commit;/m);
  assert.match(c, /create table if not exists public\.discount_campaigns \(/);
  for (const col of ['name text not null', 'percent integer not null', "scope text not null default 'all'", "collections text[] not null default '{}'", "product_slugs text[] not null default '{}'", 'starts_at timestamptz', 'ends_at timestamptz', 'enabled boolean not null default true']) {
    assert.ok(c.includes(col), col);
  }
  for (const check of ['between 1 and 60', 'percent between 1 and 90', "scope in ('all', 'collections', 'products')", 'ends_at > starts_at']) assert.ok(c.includes(check), check);
  assert.equal((c.match(/if not exists \(select 1 from pg_constraint where conname = /g) || []).length, 4, 'checks only added when missing');
  assert.match(c, /alter table public\.order_items add column if not exists list_price bigint;/);
  assert.match(c, /alter table public\.order_items add column if not exists campaign_name text;/);
  assert.doesNotMatch(c, /\b(update\s+public\.|update\s+(products|orders|order_items)\b|delete from|insert into|drop table|drop column|truncate)/i, 'no data touched, nothing dropped');
  assert.doesNotMatch(c, /alter table public\.(products|orders) /);
  // every policy is dropped before it is created (re-runnable)
  const created = [...c.matchAll(/create policy "([^"]+)"/g)].map((m) => m[1]);
  const dropped = [...c.matchAll(/drop policy if exists "([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(dropped, created);
  assert.equal(created.length, 5);
});

test('SQL: RLS — the public reads only active campaigns; admins read and write all, with the products check', () => {
  const c = code(sql);
  assert.match(c, /alter table public\.discount_campaigns enable row level security;/);
  const pol = (name) => grab(c, new RegExp(`create policy "${name}"[\\s\\S]*?;`));
  const pub = pol('discount_campaigns: public read active');
  assert.match(pub, /for select/);
  assert.match(pub, /enabled\s+and percent between 1 and 90\s+and \(starts_at is null or starts_at <= now\(\)\)\s+and \(ends_at is null or ends_at > now\(\)\)/);
  const adminCheck = 'exists (select 1 from public.profiles where id = auth.uid() and is_admin)';
  assert.ok(schema.includes('exists (select 1 from profiles where id = auth.uid() and is_admin)'));
  for (const [name, cmd] of [['admin read', 'select'], ['admin insert', 'insert'], ['admin update', 'update'], ['admin delete', 'delete']]) {
    const p = pol('discount_campaigns: ' + name);
    assert.match(p, new RegExp(`for ${cmd}`), name);
    assert.ok(p.includes(adminCheck), name);
  }
  assert.match(pol('discount_campaigns: admin update'), /using \([\s\S]*\)\s*with check \(/);
  assert.equal((c.match(/for (insert|update|delete)/g) || []).length, 3, 'no public write policy');
  // the rollback is there, commented out
  assert.match(sql, /^-- Rollback/m);
  assert.match(sql, /^--   drop table if exists public\.discount_campaigns;$/m);
  // schema.sql (fresh installs) has the same table, columns and policies
  assert.match(schema, /create table if not exists discount_campaigns \(/);
  assert.match(schema, /list_price bigint,/);
  assert.match(schema, /campaign_name text /);
  assert.match(schema, /create policy "discount_campaigns: public read active"/);
});

test('discount codes are still none', () => {
  assert.match(pricingJs, /export const DISCOUNT_CODES = \{\};/);
  assert.match(ordersJs, /const DISCOUNT_CODES = \{\};/);
  assert.match(dataJs, /DISCOUNT_CODES = \{\}/);
});
