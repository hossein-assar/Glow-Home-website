// Checkout validation + server-side pricing, ported from api/orders.js.
// Pure functions only — no database or network — so they can be unit tested.
//
// ⚠ BUSINESS RULES DUPLICATED BY HAND — keep ALL of these in sync:
//   DISCOUNT_CODES, SHIPPING, FREE_SHIP_OVER live in
//     - payment-server/src/pricing.js   (this file)
//     - api/orders.js                   (pay-at-door / card-to-card checkout)
//     - data.js                         (what the browser shows)
//   `npm test` in payment-server/ fails if the three copies drift apart
//   (test/rules-sync.test.js).

export const DISCOUNT_CODES = {}; // none for now — see data.js

// Both methods are payAtDoor: the courier collects the fee in cash, so it is
// never part of the amount charged online (same as api/orders.js).
export const SHIPPING = {
  peyk: { label: 'پیک تهران', cost: 90000, payAtDoor: true },
  tipax: { label: 'تیپاکس', cost: 0, payAtDoor: true },
};
export const FREE_SHIP_OVER = 3000000;

// Input size limits (api/orders.js has none; this server is exposed
// directly, so everything is bounded).
export const LIMITS = {
  name: 100,
  city: 60,
  address: 500,
  note: 1000,
  discountCode: 32,
  cartKey: 200,
  maxItems: 50,
  maxQty: 20,
};

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';

function toLatinDigits(s) {
  return String(s ?? '').replace(/[۰-۹٠-٩]/g, (d) => {
    const fa = FA_DIGITS.indexOf(d);
    if (fa !== -1) return String(fa);
    return String(AR_DIGITS.indexOf(d));
  });
}

function containsPersianOrArabicDigits(raw) {
  return /[۰-۹٠-٩]/.test(String(raw ?? ''));
}

function iranPhoneSubscriberPart(raw) {
  let v = String(raw ?? '').replace(/\s+/g, '');
  if (v.startsWith('+98')) v = v.slice(3);
  return /^9[0-9]{9}$/.test(v) ? v : null;
}

export function normalizePersianText(s) {
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
// Amounts in Toman. Every order carries the packaging fee, on the bill:
// TEHRAN_PACKAGING_FEE_TOMAN in Tehran, PACKAGING_FEE_TOMAN everywhere else
// (the free-shipping threshold never waives either); delivery itself stays
// pay-at-door. Each fee is stored as its own order line (order_items, no
// product). Outside Tehran the courier is always Tipax, so
// TIPAX_EXTRA_FEE_TOMAN applies to the same orders — it is OFF (0) until
// confirmed; a fee of 0 adds no line.
export const PACKAGING_FEE_TOMAN = 250000;
export const TEHRAN_PACKAGING_FEE_TOMAN = 150000;
export const TIPAX_EXTRA_FEE_TOMAN = 0;
export const PACKAGING_FEE_LABEL = 'هزینه بسته‌بندی';
export const TIPAX_EXTRA_FEE_LABEL = 'هزینه اضافه تیپاکس';
export const TEHRAN_NAMES = ['تهران', 'tehran', 'teheran'];

/** True for «تهران» in any spelling the city field can hold: ي/ك variants,
 * extra spaces, half-spaces, «Tehran», «شهر تهران», «تهران - ونک»,
 * «تهران، ونک», «تهران (ونک)». */
export function isTehranCity(rawCity) {
  const city = normalizePersianText(rawCity).toLowerCase().replace(/^شهر\s+/, '');
  return TEHRAN_NAMES.includes(city.split(/\s*[-–—,،(/]\s*/)[0].trim());
}

/** The fees a city adds to the bill, as [{ label, amount }]: the packaging
 * fee (Tehran's or everywhere else's) and, outside Tehran, the Tipax extra.
 * None for an empty city (both servers reject an empty city). */
export function cityFees(rawCity) {
  if (!normalizePersianText(rawCity)) return [];
  const tehran = isTehranCity(rawCity);
  const fees = [];
  const packaging = tehran ? TEHRAN_PACKAGING_FEE_TOMAN : PACKAGING_FEE_TOMAN;
  if (packaging > 0) fees.push({ label: PACKAGING_FEE_LABEL, amount: packaging });
  if (!tehran && TIPAX_EXTRA_FEE_TOMAN > 0) fees.push({ label: TIPAX_EXTRA_FEE_LABEL, amount: TIPAX_EXTRA_FEE_TOMAN });
  return fees;
}
// ---- end of city fees ----------------------------------------------------------

// ---- Campaign discounts (shared rule) -------------------------------------------
// ⚠ This block is identical in app.js, admin/admin.js, api/orders.js and
// payment-server/src/pricing.js (`npm test` in payment-server/ checks it).
// A campaign (table discount_campaigns, edited in the admin «تخفیف‌ها» tab)
// takes a whole percent (1–90) off every size and every shade of the
// products it covers: all of them, some collections, or chosen products
// (by slug). Each unit price is discounted on its own and rounded to the
// nearest 1,000 Toman; fees are never discounted. Two campaigns on one
// product never stack: the larger percent wins (on a tie, the first one).
// Active = switched on and starts_at ≤ now < ends_at (an empty date is no
// limit); the payment server decides with its own clock.
export const DISCOUNT_MAX_PERCENT = 90;
export const DISCOUNT_ROUND_TOMAN = 1000;
export const DISCOUNT_SCOPES = ['all', 'collections', 'products'];

/** True when campaign c is valid and running at `now` (ms). now == null
 * skips the dates (the storefront: its database read returns only running
 * campaigns, and the visitor's clock may be wrong). */
export function campaignIsActive(c, now) {
  if (!c || c.enabled !== true || !DISCOUNT_SCOPES.includes(c.scope)) return false;
  const percent = Number(c.percent);
  if (!Number.isInteger(percent) || percent < 1 || percent > DISCOUNT_MAX_PERCENT) return false;
  if (now == null) return true;
  const start = c.starts_at ? Date.parse(c.starts_at) : null;
  const end = c.ends_at ? Date.parse(c.ends_at) : null;
  if (Number.isNaN(start) || Number.isNaN(end)) return false;
  return (start == null || start <= now) && (end == null || now < end);
}

/** True when campaign c covers product p ({ slug, collection }). */
export function campaignCovers(c, p) {
  if (c.scope === 'all') return true;
  if (c.scope === 'collections') return Array.isArray(c.collections) && c.collections.includes(p.collection);
  if (c.scope === 'products') return Array.isArray(c.product_slugs) && c.product_slugs.includes(p.slug);
  return false;
}

/** The covering campaign with the largest percent, or null. `campaigns`
 * must already be the active ones. */
export function bestCampaignFor(p, campaigns) {
  let best = null;
  for (const c of Array.isArray(campaigns) ? campaigns : []) {
    if (campaignCovers(c, p) && (!best || Number(c.percent) > Number(best.percent))) best = c;
  }
  return best;
}

/** price less percent, rounded to the nearest DISCOUNT_ROUND_TOMAN, never
 * below DISCOUNT_ROUND_TOMAN nor above price. An unpriced (0, missing,
 * not a whole number) price is returned as it is. */
export function discountedPrice(price, percent) {
  if (!Number.isSafeInteger(price) || price <= 0) return price;
  const pct = Math.min(DISCOUNT_MAX_PERCENT, Math.max(0, Math.floor(Number(percent) || 0)));
  const rounded = Math.round((price * (100 - pct)) / 100 / DISCOUNT_ROUND_TOMAN) * DISCOUNT_ROUND_TOMAN;
  return Math.min(price, Math.max(DISCOUNT_ROUND_TOMAN, rounded));
}

/** One unit at listPrice under campaign c (or none): { price, listPrice,
 * campaign } — campaign is null when nothing comes off. */
export function applyCampaign(listPrice, c) {
  const price = c ? discountedPrice(listPrice, c.percent) : listPrice;
  if (!c || !(price < listPrice)) return { price: listPrice, listPrice, campaign: null };
  return { price, listPrice, campaign: c };
}
// ---- end of campaign discounts ---------------------------------------------------

export function shippingMethodForCity(rawCity) {
  return isTehranCity(rawCity) ? 'peyk' : 'tipax';
}

export function parseCartKey(key) {
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

// Shades are data (supabase/migration-shade-types.sql): products.shade_types
// lists them in display order as [{key, name_fa, name_en, in_stock}], and
// each size stores the FULL price per shade in variants[].shades
// ({"height": 140, "price": <first shade>, "shades": {"plain": …, "k3x9a": …}}).
// `key` never changes (cart keys use it: "gisoo::h140::splain"); the name
// can. SHADE_TYPES is only the fallback for a row whose shade_types is
// still empty (the three original types, by the keys in its variants).
// ⚠ shadeTypesOf and shadeLine are the same in app.js (shadeTypesOf),
// admin/admin.js (shadeTypesOf), api/orders.js and
// payment-server/src/pricing.js — `npm test` in payment-server/ checks.
export const SHADE_TYPES = { plain: 'شید ساده', embroidered: 'شید گلدوزی', macrame: 'شید مکرومه' };

export function hasShadeTypes(p) {
  return Array.isArray(p.variants) && p.variants.some((v) => v && v.shades && typeof v.shades === 'object');
}

/** The product's shades, in display order: shade_types, or the fallback. */
export function shadeTypesOf(p) {
  const stored = Array.isArray(p.shade_types) ? p.shade_types : [];
  if (stored.length) {
    return stored
      .filter((t) => t && typeof t.key === 'string' && /^[a-z][a-z0-9]{0,31}$/.test(t.key) && String(t.name_fa ?? '').trim())
      .map((t) => ({ key: t.key, name_fa: String(t.name_fa).trim(), name_en: String(t.name_en ?? '').trim(), in_stock: t.in_stock !== false }));
  }
  const variants = Array.isArray(p.variants) ? p.variants : [];
  return Object.keys(SHADE_TYPES)
    .filter((k) => variants.some((v) => v && v.shades && typeof v.shades === 'object' && Object.hasOwn(v.shades, k)))
    .map((k) => ({ key: k, name_fa: SHADE_TYPES[k], name_en: '', in_stock: true }));
}

/**
 * Strict pricing for a product with shades: the cart key must name a stored
 * height AND one of the product's shades stored for that size; an
 * unavailable shade is refused. Old keys (no shade, a removed size or
 * shade) are rejected, never guessed. Returns { price, label } or { error }.
 */
export function shadeLine(p, height, shade) {
  const v = height == null ? null : p.variants.find((x) => x && x.shades && x.height === height);
  const type = shade == null ? null : shadeTypesOf(p).find((t) => t.key === shade);
  if (!v || !type || !Object.hasOwn(v.shades, shade)) {
    return { error: `اندازه یا نوع شید «${p.name_fa}» در سبد شما دیگر معتبر نیست. لطفاً آن را از سبد حذف کنید و دوباره انتخاب کنید.` };
  }
  if (!type.in_stock) return { error: `«${p.name_fa}» با «${type.name_fa}» فعلاً موجود نیست. لطفاً شید دیگری انتخاب کنید.` };
  const price = Number(v.shades[shade]);
  if (!Number.isSafeInteger(price) || price <= 0) return { error: `قیمت «${p.name_fa}» هنوز مشخص نشده است.` };
  return { price, label: `${p.name_fa} (${v.height} سانتی‌متر) — ${type.name_fa}` };
}

// The complete size list of a product without shade types: its `variants`,
// plus the base size (height_cm + products.price) first when no variant has
// that height. Older rows store only the *other* sizes in `variants` (the
// schema once described it that way), so «مهتاب», base 40 / variants [50],
// is two sizes, not one. Shade-type products and products with no variants
// are returned unchanged — their sizes are exactly what is stored.
// ⚠ Same function in app.js, admin/admin.js, api/orders.js and
// payment-server/src/pricing.js; `npm test` in payment-server/ checks them.
export function withBaseSize(variants, baseHeight, basePrice) {
  const list = Array.isArray(variants) ? variants : [];
  if (!list.length || list.some((v) => v && v.shades && typeof v.shades === 'object')) return list;
  const price = Number(basePrice);
  if (!Number.isSafeInteger(baseHeight) || baseHeight < 0 || !Number.isSafeInteger(price) || price <= 0) return list;
  if (list.some((v) => v && v.height === baseHeight)) return list;
  return [{ height: baseHeight, price }, ...list];
}

/**
 * Strict pricing by size for a product without shade types: a key that names
 * a height must name one of withBaseSize()'s sizes — a removed size, a typo,
 * or any height on a product with no sizes is rejected, never priced at the
 * base price. A key with no height is the base size (products.price).
 * Returns { price, label } or { error }.
 */
export function sizeLine(p, height) {
  if (height == null) return { price: Number(p.price), label: p.name_fa };
  const v = withBaseSize(p.variants, p.height_cm, p.price).find((x) => x && x.height === height);
  if (!v) return { error: `اندازه‌ی «${p.name_fa}» در سبد شما دیگر معتبر نیست. لطفاً آن را از سبد حذف کنید و دوباره انتخاب کنید.` };
  return { price: Number(v.price), label: `${p.name_fa} (${v.height} سانتی‌متر)` };
}

const str = (v) => (typeof v === 'string' ? v.trim() : v == null ? '' : null);

/**
 * Validates the raw JSON body. Returns { error } (Persian, safe to show) or
 * { value: { name, phone, city, address, postcode, note, items, discountCode } }.
 */
export function validateCheckoutBody(body) {
  const bad = (error) => ({ error });
  if (!body || typeof body !== 'object' || Array.isArray(body)) return bad('درخواست نامعتبر است.');

  const { customer, note, items, discount_code, expected_total } = body;
  if (!customer || typeof customer !== 'object') return bad('اطلاعات مشتری ناقص است.');

  const name = str(customer.name);
  const phoneRaw = str(customer.phone);
  const city = str(customer.city);
  const address = str(customer.address);
  const postcodeRaw = str(customer.postcode);
  const noteStr = str(note);
  const code = str(discount_code);
  if ([name, phoneRaw, city, address, postcodeRaw, noteStr, code].some((v) => v === null)) {
    return bad('درخواست نامعتبر است.');
  }

  if (!name) return bad('نام و نام خانوادگی را وارد کنید.');
  if (name.length > LIMITS.name) return bad('نام بیش از حد طولانی است.');
  if (containsPersianOrArabicDigits(phoneRaw)) return bad('لطفاً شماره موبایل را با اعداد انگلیسی وارد کنید.');
  const sub = iranPhoneSubscriberPart(phoneRaw);
  if (!sub) return bad('شماره موبایل معتبر نیست.');
  if (!city) return bad('شهر را وارد کنید.');
  if (city.length > LIMITS.city) return bad('نام شهر بیش از حد طولانی است.');
  if (address.length < 10) return bad('نشانی را کامل‌تر بنویسید.');
  if (address.length > LIMITS.address) return bad('نشانی بیش از حد طولانی است.');
  const postcode = postcodeRaw ? toLatinDigits(postcodeRaw).trim() : '';
  if (postcode && !/^[0-9]{10}$/.test(postcode)) return bad('کد پستی باید دقیقاً ۱۰ رقم باشد.');
  if (noteStr.length > LIMITS.note) return bad('یادداشت بیش از حد طولانی است.');
  if (code.length > LIMITS.discountCode) return bad('کد تخفیف نامعتبر است.');
  // The total the customer was shown (Toman). Only ever compared with the
  // server's own total — never used to price anything. Optional, so a page
  // opened before this field existed can still check out.
  if (expected_total != null && (!Number.isSafeInteger(expected_total) || expected_total < 0)) {
    return bad('درخواست نامعتبر است.');
  }

  if (!Array.isArray(items) || !items.length) return bad('سبد خرید خالی است.');
  if (items.length > LIMITS.maxItems) return bad('تعداد اقلام سبد بیش از حد مجاز است.');

  const cleanItems = [];
  for (const it of items) {
    if (!it || typeof it !== 'object' || typeof it.cartKey !== 'string') return bad('سبد خرید نامعتبر است.');
    if (!it.cartKey || it.cartKey.length > LIMITS.cartKey) return bad('سبد خرید نامعتبر است.');
    const qty = Math.floor(Number(it.qty));
    if (!Number.isFinite(qty) || qty < 1) return bad('تعداد کالا نامعتبر است.');
    if (qty > LIMITS.maxQty) return bad(`حداکثر ${LIMITS.maxQty} عدد از هر کالا قابل سفارش آنلاین است.`);
    cleanItems.push({ cartKey: it.cartKey, qty });
  }

  return {
    value: {
      name,
      phone: '0' + sub, // canonical 09XXXXXXXXX, same as api/orders.js
      city,
      address,
      postcode,
      note: noteStr || null,
      items: cleanItems,
      discountCode: code || null,
      expectedTotal: expected_total == null ? null : expected_total,
    },
  };
}

/**
 * Re-prices the cart from DB product rows and the server's own campaign
 * rows. Never uses a client price.
 * products: rows with { id, slug, name_fa, collection, price, height_cm, variants, shade_types, colors, in_stock }.
 * campaigns: discount_campaigns rows as read by the server; only those
 * campaignIsActive() at `now` count.
 * Returns { error } or { orderItems, subtotal, listSubtotal, campaignDiscount,
 * discount, discountCode, fees, total, shippingMethod, shippingCost }.
 * subtotal is the products at the prices charged (after campaigns);
 * listSubtotal the same at list prices. orderItems and total also include
 * cityFees(city), added after every discount and never discounted. A
 * discounted line also carries list_price and campaign_name. `codes`
 * defaults to DISCOUNT_CODES (tests pass their own).
 */
export function priceCart({ items, products, discountCode, city, campaigns = [], now = Date.now(), codes = DISCOUNT_CODES }) {
  const bySlug = Object.fromEntries(products.map((p) => [p.slug, p]));
  const active = (Array.isArray(campaigns) ? campaigns : []).filter((c) => campaignIsActive(c, now));
  const orderItems = [];
  let subtotal = 0;
  let listSubtotal = 0;

  for (const it of items) {
    const { id: slug, height, colorIndex, shade } = parseCartKey(it.cartKey);
    const p = bySlug[slug];
    if (!p) return { error: 'یکی از محصولات سبد پیدا نشد.' };
    if (!p.in_stock) return { error: `«${p.name_fa}» فعلاً موجود نیست.` };

    let price = Number(p.price);
    let label = p.name_fa;
    if (hasShadeTypes(p)) {
      const line = shadeLine(p, height, shade);
      if (line.error) return { error: line.error };
      ({ price, label } = line);
    } else {
      const line = sizeLine(p, height);
      if (line.error) return { error: line.error };
      ({ price, label } = line);
    }
    if (colorIndex != null && Array.isArray(p.colors) && p.colors[colorIndex] != null) {
      label += ` — ${p.colors[colorIndex]}`;
    }
    if (!Number.isSafeInteger(price) || price <= 0) {
      // A 0/unset price must never reach the gateway as a free item.
      return { error: `قیمت «${p.name_fa}» هنوز مشخص نشده است.` };
    }

    // The campaign is applied to this size/shade's own price.
    const sale = applyCampaign(price, bestCampaignFor({ slug: p.slug, collection: p.collection }, active));
    subtotal += sale.price * it.qty;
    listSubtotal += price * it.qty;
    const line = { product_id: p.id, name_fa: label, qty: it.qty, unit_price: sale.price };
    // Only on a discounted line, so an order without a campaign is stored
    // exactly as before (and works before the new columns exist).
    if (sale.campaign) Object.assign(line, { list_price: price, campaign_name: String(sale.campaign.name ?? '').trim().slice(0, 60) || null });
    orderItems.push(line);
  }

  // Unknown codes are ignored, same as api/orders.js.
  const code = discountCode && Object.hasOwn(codes, discountCode) ? discountCode : null;
  const discount = code ? Math.round(subtotal * codes[code]) : 0;
  const base = subtotal - discount;

  const shippingMethod = shippingMethodForCity(city);
  const method = SHIPPING[shippingMethod];
  const freeShip = !method.payAtDoor && base >= FREE_SHIP_OVER;
  const shipCost = method.payAtDoor || freeShip ? 0 : method.cost;

  // City fees (packaging, Tehran's or the rest's) from the city alone — nothing the
  // client sends about fees is read. Each is stored as its own order line,
  // and is part of the total sent to ZarinPal.
  const fees = cityFees(city);
  for (const f of fees) orderItems.push({ product_id: null, name_fa: f.label, qty: 1, unit_price: f.amount });

  return {
    orderItems,
    subtotal,
    listSubtotal,
    campaignDiscount: listSubtotal - subtotal,
    discount,
    discountCode: code,
    fees,
    total: base + shipCost + fees.reduce((sum, f) => sum + f.amount, 0),
    shippingMethod,
    // Nominal fee the courier collects, stored for admin (see api/orders.js).
    shippingCost: method.cost,
  };
}
