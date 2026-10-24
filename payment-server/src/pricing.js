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

export const DISCOUNT_CODES = { GLOW10: 0.1, HANDMADE15: 0.15 };

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

export function shippingMethodForCity(rawCity) {
  return normalizePersianText(rawCity) === 'تهران' ? 'peyk' : 'tipax';
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

// Shade types a size can be priced by (only گیسو so far). Prices live in the
// DB on each variant: {"height": 140, "price": …, "shades": {"plain": …,
// "embroidered": …}}. Same labels in api/orders.js and app.js.
export const SHADE_TYPES = { plain: 'شید ساده', embroidered: 'شید گلدوزی' };

export function hasShadeTypes(p) {
  return Array.isArray(p.variants) && p.variants.some((v) => v && v.shades && typeof v.shades === 'object');
}

/**
 * Strict pricing for a product with shade types: the cart key must name a
 * stored height AND a stored shade type for it. Old keys (no shade, or a
 * removed size) are rejected, never guessed. Returns { price, label } or { error }.
 */
export function shadeLine(p, height, shade) {
  const v = height == null ? null : p.variants.find((x) => x && x.shades && x.height === height);
  const known = v && shade != null && Object.hasOwn(SHADE_TYPES, shade) && Object.hasOwn(v.shades, shade);
  if (!known) {
    return { error: `اندازه یا نوع شید «${p.name_fa}» در سبد شما دیگر معتبر نیست. لطفاً آن را از سبد حذف کنید و دوباره انتخاب کنید.` };
  }
  const price = Number(v.shades[shade]);
  if (!Number.isSafeInteger(price) || price <= 0) return { error: `قیمت «${p.name_fa}» هنوز مشخص نشده است.` };
  return { price, label: `${p.name_fa} (${v.height} سانتی‌متر) — ${SHADE_TYPES[shade]}` };
}

const str = (v) => (typeof v === 'string' ? v.trim() : v == null ? '' : null);

/**
 * Validates the raw JSON body. Returns { error } (Persian, safe to show) or
 * { value: { name, phone, city, address, postcode, note, items, discountCode } }.
 */
export function validateCheckoutBody(body) {
  const bad = (error) => ({ error });
  if (!body || typeof body !== 'object' || Array.isArray(body)) return bad('درخواست نامعتبر است.');

  const { customer, note, items, discount_code } = body;
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
    },
  };
}

/**
 * Re-prices the cart from DB product rows. Never uses a client price.
 * products: rows with { id, slug, name_fa, price, variants, colors, in_stock }.
 * Returns { error } or { orderItems, subtotal, discount, discountCode, total,
 * shippingMethod, shippingCost }.
 */
export function priceCart({ items, products, discountCode, city }) {
  const bySlug = Object.fromEntries(products.map((p) => [p.slug, p]));
  const orderItems = [];
  let subtotal = 0;

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
    } else if (height != null && Array.isArray(p.variants) && p.variants.length) {
      const v = p.variants.find((x) => x.height === height);
      if (v) {
        price = Number(v.price);
        label += ` (${v.height} سانتی‌متر)`;
      }
    }
    if (colorIndex != null && Array.isArray(p.colors) && p.colors[colorIndex] != null) {
      label += ` — ${p.colors[colorIndex]}`;
    }
    if (!Number.isSafeInteger(price) || price <= 0) {
      // A 0/unset price must never reach the gateway as a free item.
      return { error: `قیمت «${p.name_fa}» هنوز مشخص نشده است.` };
    }

    subtotal += price * it.qty;
    orderItems.push({ product_id: p.id, name_fa: label, qty: it.qty, unit_price: price });
  }

  // Unknown codes are ignored, same as api/orders.js.
  const code = discountCode && Object.hasOwn(DISCOUNT_CODES, discountCode) ? discountCode : null;
  const discount = code ? Math.round(subtotal * DISCOUNT_CODES[code]) : 0;
  const base = subtotal - discount;

  const shippingMethod = shippingMethodForCity(city);
  const method = SHIPPING[shippingMethod];
  const freeShip = !method.payAtDoor && base >= FREE_SHIP_OVER;
  const shipCost = method.payAtDoor || freeShip ? 0 : method.cost;

  return {
    orderItems,
    subtotal,
    discount,
    discountCode: code,
    total: base + shipCost,
    shippingMethod,
    // Nominal fee the courier collects, stored for admin (see api/orders.js).
    shippingCost: method.cost,
  };
}
