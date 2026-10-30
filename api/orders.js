// POST /api/orders — retired: refuses every order.
//
// This endpoint used to create «کارت به کارت» orders (and, with
// ONLINE_PAYMENT switched off in data.js, every order) straight into the
// database. Card-to-card no longer places an order at all: checkout asks the
// customer to contact the shop instead (see payByContactHtml() in app.js).
// The only way to order on the site is online payment, which goes to the
// payment server (payment-server/, POST /api/checkout) and never here.
//
// The browser never sent a payment method, so this endpoint could not tell a
// card-to-card order from any other: it refuses them all, before reading the
// body, touching the database or sending any email.
//
// The pricing helpers below are kept as the third hand-copied set of the
// shop's rules (with data.js and payment-server/src/pricing.js) — `npm test`
// in payment-server/ checks the copies still match.

const RETIRED_ERROR =
  'ثبت سفارش از این مسیر انجام نمی‌شود. برای خرید از «پرداخت آنلاین» در صفحه‌ی تکمیل خرید استفاده کنید؛ برای پرداخت کارت به کارت با ما تماس بگیرید.';

// Mirrors data.js — kept in sync by hand since this is server-side business
// logic, not sensitive data, and duplicating it here avoids needing a build
// step to share code between the browser bundle and this function.
//
// Only two methods exist: which one applies is decided entirely by شهر (see
// shippingMethodForCity below) — پست پیشتاز was retired because the
// Tehran/non-Tehran rule left no city that could ever reach it.
//
// Both are payAtDoor — the courier/carrier collects in cash, so neither
// cost is added to the site's charged total (see freeShip/shipCost
// below), which already excludes a payAtDoor method from ever being
// "free" too (no separate neverFree flag needed for that).
const SHIPPING = {
  peyk: { label: 'پیک تهران', cost: 90000, payAtDoor: true },
  tipax: { label: 'تیپاکس', cost: 0, payAtDoor: true },
};
const FREE_SHIP_OVER = 3000000;
// ⚠ SHIPPING, FREE_SHIP_OVER and DISCOUNT_CODES are also copied in
// payment-server/src/pricing.js (online payment) and data.js. Change all
// three together. `npm test` in payment-server/ fails if they differ.
const DISCOUNT_CODES = {}; // none for now — see data.js

function normalizePersianText(s) {
  return String(s ?? '')
    .replace(/[‌‎‏]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک');
}

// ---- City fees (shared rule) -------------------------------------------------
// ⚠ This block is identical in app.js, api/orders.js and
// payment-server/src/pricing.js (`npm test` in payment-server/ checks it).
// Amounts in Toman. Outside Tehran every order carries the packaging fee, on
// the bill (the free-shipping threshold never waives it); delivery itself
// stays pay-at-door. Each fee is stored as its own order line (order_items,
// no product). Outside Tehran the courier is always Tipax, so
// TIPAX_EXTRA_FEE_TOMAN applies to the same orders — it is OFF (0) until
// confirmed; a fee of 0 adds no line.
const PACKAGING_FEE_TOMAN = 250000;
const TIPAX_EXTRA_FEE_TOMAN = 0;
const PACKAGING_FEE_LABEL = 'هزینه بسته‌بندی';
const TIPAX_EXTRA_FEE_LABEL = 'هزینه اضافه تیپاکس';
const TEHRAN_NAMES = ['تهران', 'tehran', 'teheran'];

/** True for «تهران» in any spelling the city field can hold: ي/ك variants,
 * extra spaces, half-spaces, «Tehran», «شهر تهران», «تهران - ونک»,
 * «تهران، ونک», «تهران (ونک)». */
function isTehranCity(rawCity) {
  const city = normalizePersianText(rawCity).toLowerCase().replace(/^شهر\s+/, '');
  return TEHRAN_NAMES.includes(city.split(/\s*[-–—,،(/]\s*/)[0].trim());
}

/** The fees a city adds to the bill, as [{ label, amount }]. None for
 * Tehran, and none for an empty city (both servers reject an empty city). */
function cityFees(rawCity) {
  if (!normalizePersianText(rawCity) || isTehranCity(rawCity)) return [];
  const fees = [{ label: PACKAGING_FEE_LABEL, amount: PACKAGING_FEE_TOMAN }];
  if (TIPAX_EXTRA_FEE_TOMAN > 0) fees.push({ label: TIPAX_EXTRA_FEE_LABEL, amount: TIPAX_EXTRA_FEE_TOMAN });
  return fees;
}
// ---- end of city fees ----------------------------------------------------------

// Which courier a city gets: پیک in Tehran, تیپاکس everywhere else.
function shippingMethodForCity(rawCity) {
  return isTehranCity(rawCity) ? 'peyk' : 'tipax';
}

function parseCartKey(key) {
  const parts = String(key).split('::');
  const id = parts[0];
  let height = null;
  let colorIndex = null;
  let shade = null;
  for (const part of parts.slice(1)) {
    if (part[0] === 'h') height = Number(part.slice(1));
    if (part[0] === 'c') colorIndex = Number(part.slice(1));
    if (part[0] === 's') shade = part.slice(1);
  }
  return { id, height, colorIndex, shade };
}

// Shade types a size can be priced by (گیسو, دفرمه). The prices live in the
// DB on each variant: {"height": 140, "price": …, "shades": {"plain": …,
// "embroidered": …}} — the client only names which one it wants, and a size
// accepts only the keys stored in its own `shades` map.
// ⚠ Same as SHADE_TYPES/shadeLine in payment-server/src/pricing.js and the
// labels in app.js; `npm test` in payment-server/ checks this copy too.
const SHADE_TYPES = { plain: 'شید ساده', embroidered: 'شید گلدوزی', macrame: 'شید مکرومه' };

function hasShadeTypes(p) {
  return Array.isArray(p.variants) && p.variants.some((v) => v && v.shades && typeof v.shades === 'object');
}

// Strict: the cart key must name a stored height AND a stored shade type for
// it. An old key (no shade, or a removed size) is rejected rather than
// guessed — the customer never chose a shade for it, and the old sizes had
// different prices. Returns { price, label } or { error }.
function shadeLine(p, height, shade) {
  const v = height == null ? null : p.variants.find((x) => x && x.shades && x.height === height);
  const known = v && shade != null && Object.hasOwn(SHADE_TYPES, shade) && Object.hasOwn(v.shades, shade);
  if (!known) {
    return { error: `اندازه یا نوع شید «${p.name_fa}» در سبد شما دیگر معتبر نیست. لطفاً آن را از سبد حذف کنید و دوباره انتخاب کنید.` };
  }
  const price = Number(v.shades[shade]);
  if (!Number.isSafeInteger(price) || price <= 0) return { error: `قیمت «${p.name_fa}» هنوز مشخص نشده است.` };
  return { price, label: `${p.name_fa} (${v.height} سانتی‌متر) — ${SHADE_TYPES[shade]}` };
}

// The complete size list of a product without shade types: its `variants`,
// plus the base size (height_cm + products.price) first when no variant has
// that height. Older rows store only the *other* sizes in `variants` (the
// schema once described it that way), so «مهتاب», base 40 / variants [50],
// is two sizes, not one. Shade-type products and products with no variants
// are returned unchanged — their sizes are exactly what is stored.
// ⚠ Same function in app.js, admin/admin.js, api/orders.js and
// payment-server/src/pricing.js; `npm test` in payment-server/ checks them.
function withBaseSize(variants, baseHeight, basePrice) {
  const list = Array.isArray(variants) ? variants : [];
  if (!list.length || list.some((v) => v && v.shades && typeof v.shades === 'object')) return list;
  const price = Number(basePrice);
  if (!Number.isSafeInteger(baseHeight) || baseHeight < 0 || !Number.isSafeInteger(price) || price <= 0) return list;
  if (list.some((v) => v && v.height === baseHeight)) return list;
  return [{ height: baseHeight, price }, ...list];
}

// Strict, same as sizeLine in payment-server/src/pricing.js: a key naming a
// height must name one of withBaseSize()'s sizes, or it is rejected; no
// height is the base size. Returns { price, label } or { error }.
function sizeLine(p, height) {
  if (height == null) return { price: p.price, label: p.name_fa };
  const v = withBaseSize(p.variants, p.height_cm, p.price).find((x) => x && x.height === height);
  if (!v) return { error: `اندازه‌ی «${p.name_fa}» در سبد شما دیگر معتبر نیست. لطفاً آن را از سبد حذف کنید و دوباره انتخاب کنید.` };
  return { price: Number(v.price), label: `${p.name_fa} (${v.height} سانتی‌متر)` };
}

module.exports = (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }
  res.status(410).json({ ok: false, error: RETIRED_ERROR });
};

// Pricing helpers, exposed only so payment-server's tests can check this copy.
module.exports.parseCartKey = parseCartKey;
module.exports.shadeLine = shadeLine;
module.exports.hasShadeTypes = hasShadeTypes;
module.exports.SHADE_TYPES = SHADE_TYPES;
module.exports.withBaseSize = withBaseSize;
module.exports.sizeLine = sizeLine;
module.exports.cityFees = cityFees;
module.exports.shippingMethodForCity = shippingMethodForCity;
module.exports.RETIRED_ERROR = RETIRED_ERROR;
