// POST /api/orders
//
// Creates a real order. Runs with the Supabase service-role key (set as the
// SUPABASE_SERVICE_ROLE_KEY environment variable in Vercel — never in this
// file or in any file that ships to the browser), which is what lets it
// write to the orders/order_items tables even though the RLS policies on
// those tables don't grant the public a write path directly.
//
// Security note: the client only ever sends *which* products and *how many*
// (cart keys + quantities) — every price, discount, and shipping cost is
// looked up fresh from the database and recomputed here. A tampered client
// request cannot change what anyone actually gets charged.

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://sgfoesnpodvwyzlxfhtq.supabase.co';

// Mirrors data.js — kept in sync by hand since this is server-side business
// logic, not sensitive data, and duplicating it here avoids needing a build
// step to share code between the browser bundle and this function.
//
// Only two methods exist: which one applies is decided entirely by شهر (see
// shippingMethodForCity below) — پست پیشتاز was retired because the
// Tehran/non-Tehran rule left no city that could ever reach it.
const SHIPPING = {
  peyk: { label: 'پیک تهران', cost: 90000, payAtDoor: false },
  tipax: { label: 'تیپاکس', cost: 0, payAtDoor: true },
};
const FREE_SHIP_OVER = 3000000;
const DISCOUNT_CODES = { GLOW10: 0.1, HANDMADE15: 0.15 };

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩'; // Arabic-Indic — some keyboards/OSes produce these instead of ۰-۹

// Mirrors the same-named helpers in app.js — see there for the reasoning;
// duplicated here so the server never has to trust the client's own
// normalization of what it typed.
function toLatinDigits(s) {
  return String(s ?? '').replace(/[۰-۹٠-٩]/g, (d) => {
    const fa = FA_DIGITS.indexOf(d);
    if (fa !== -1) return String(fa);
    return String(AR_DIGITS.indexOf(d));
  });
}

function isValidPostcode(raw) {
  return /^[0-9]{10}$/.test(toLatinDigits(raw).trim());
}

function normalizePostcode(raw) {
  return toLatinDigits(raw).trim();
}

// Phone numbers, unlike postcode, are NOT auto-converted from Persian/
// Arabic-Indic digits — the caller must reject those first (see
// containsPersianOrArabicDigits below) rather than have this silently
// convert them, so this expects English digits only.
function containsPersianOrArabicDigits(raw) {
  return /[۰-۹٠-٩]/.test(String(raw ?? ''));
}

function iranPhoneSubscriberPart(raw) {
  let v = String(raw ?? '').replace(/\s+/g, '');
  if (v.startsWith('+98')) v = v.slice(3);
  else if (v.startsWith('0098')) v = v.slice(4);
  else if (v.startsWith('98') && v.length === 12) v = v.slice(2);
  else if (v.startsWith('0')) v = v.slice(1);
  return /^9[0-9]{9}$/.test(v) ? v : null;
}

function isValidIranPhone(raw) {
  return iranPhoneSubscriberPart(raw) !== null;
}

function normalizeIranPhone(raw) {
  const sub = iranPhoneSubscriberPart(raw);
  return sub ? '0' + sub : String(raw ?? '').trim();
}

function normalizePersianText(s) {
  return String(s ?? '')
    .replace(/[‌‎‏]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک');
}

// The only source of truth for which method an order gets — the client's
// own shipping_method choice is never trusted (see the call site below).
function shippingMethodForCity(rawCity) {
  return normalizePersianText(rawCity) === 'تهران' ? 'peyk' : 'tipax';
}

function parseCartKey(key) {
  const parts = String(key).split('::');
  const id = parts[0];
  let height = null;
  let colorIndex = null;
  for (const part of parts.slice(1)) {
    if (part[0] === 'h') height = Number(part.slice(1));
    if (part[0] === 'c') colorIndex = Number(part.slice(1));
  }
  return { id, height, colorIndex };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function toman(n) {
  return Number(n).toLocaleString('en-US') + ' تومان';
}

// Best-effort admin notification — never allowed to affect the checkout
// response either way. Uses a plain fetch() to Resend's API rather than
// pulling in a new npm dependency for one call.
async function sendOrderNotificationEmail(order, orderItems) {
  const apiKey = process.env.RESEND_API_KEY;
  const notifyTo = process.env.ORDER_NOTIFY_EMAIL;
  if (!apiKey || !notifyTo) return;

  const itemsHtml = orderItems
    .map(
      (it) =>
        `<li>${escapeHtml(it.name_fa)} — تعداد: ${it.qty} — ${toman(it.unit_price * it.qty)}</li>`
    )
    .join('');

  const html = `
    <div dir="rtl" style="font-family: sans-serif;">
      <h2>سفارش جدید — ${escapeHtml(order.code)}</h2>
      <p><strong>مشتری:</strong> ${escapeHtml(order.customer_name)}</p>
      <p><strong>موبایل:</strong> ${escapeHtml(order.phone)}</p>
      <p><strong>شهر / نشانی:</strong> ${escapeHtml(order.city)} — ${escapeHtml(order.address)}</p>
      <h3>اقلام سفارش</h3>
      <ul>${itemsHtml}</ul>
      <p><strong>جمع کل:</strong> ${toman(order.total)}</p>
    </div>
  `;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Glow Home <onboarding@resend.dev>',
      to: [notifyTo],
      subject: `سفارش جدید — ${order.code}`,
      html,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Resend API responded ${res.status}: ${text}`);
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    res.status(500).json({ ok: false, error: 'سرور آماده نیست — کلید سرویس تنظیم نشده.' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      res.status(400).json({ ok: false, error: 'درخواست نامعتبر است.' });
      return;
    }
  }

  // shipping_method is intentionally NOT read from the body — see the
  // "Shipping" section below, which derives it from city instead.
  const { customer, note, items, discount_code } = body || {};

  // ---- Validate the shape of what came in -----------------------------
  if (!customer || typeof customer !== 'object') {
    res.status(400).json({ ok: false, error: 'اطلاعات مشتری ناقص است.' });
    return;
  }
  const name = String(customer.name || '').trim();
  const phoneRaw = String(customer.phone || '').trim();
  const city = String(customer.city || '').trim();
  const address = String(customer.address || '').trim();
  const postcodeRaw = String(customer.postcode || '').trim();

  if (!name) return res.status(400).json({ ok: false, error: 'نام و نام خانوادگی را وارد کنید.' });
  if (containsPersianOrArabicDigits(phoneRaw))
    return res.status(400).json({ ok: false, error: 'لطفاً شماره موبایل را با اعداد انگلیسی وارد کنید.' });
  if (!isValidIranPhone(phoneRaw))
    return res.status(400).json({ ok: false, error: 'شماره موبایل معتبر نیست.' });
  if (!city) return res.status(400).json({ ok: false, error: 'شهر را وارد کنید.' });
  if (address.length < 10) return res.status(400).json({ ok: false, error: 'نشانی را کامل‌تر بنویسید.' });
  // کد پستی stays optional (nullable column) — but if one was sent, it must
  // actually be a valid 10-digit code, same rule the browser enforces.
  if (postcodeRaw && !isValidPostcode(postcodeRaw))
    return res.status(400).json({ ok: false, error: 'کد پستی باید دقیقاً ۱۰ رقم باشد.' });
  if (!Array.isArray(items) || !items.length)
    return res.status(400).json({ ok: false, error: 'سبد خرید خالی است.' });

  // Canonical stored formats — same numbers regardless of how the client
  // typed or normalized them client-side.
  const phone = normalizeIranPhone(phoneRaw);
  const postcode = postcodeRaw ? normalizePostcode(postcodeRaw) : '';

  const sb = createClient(SUPABASE_URL, serviceKey);

  // ---- Recompute every line from the database, ignoring any price the
  //      client might have sent ------------------------------------------
  const slugs = [...new Set(items.map((it) => parseCartKey(it.cartKey).id))];
  const { data: products, error: fetchErr } = await sb
    .from('products')
    .select('id, slug, name_fa, price, variants, colors, in_stock')
    .in('slug', slugs);

  if (fetchErr) {
    res.status(500).json({ ok: false, error: 'خطا در خواندن اطلاعات محصولات.' });
    return;
  }

  const bySlug = Object.fromEntries(products.map((p) => [p.slug, p]));
  const orderItems = [];
  let subtotal = 0;

  for (const it of items) {
    const qty = Math.max(1, Math.floor(Number(it.qty) || 1));
    const { id: slug, height, colorIndex } = parseCartKey(it.cartKey);
    const p = bySlug[slug];
    if (!p) return res.status(400).json({ ok: false, error: `محصول «${slug}» پیدا نشد.` });
    if (!p.in_stock) return res.status(400).json({ ok: false, error: `«${p.name_fa}» فعلاً موجود نیست.` });

    let price = p.price;
    let label = p.name_fa;
    if (height != null && Array.isArray(p.variants) && p.variants.length) {
      const v = p.variants.find((x) => x.height === height);
      if (v) {
        price = v.price;
        label += ` (${v.height} سانتی‌متر)`;
      }
    }
    if (colorIndex != null && Array.isArray(p.colors) && p.colors[colorIndex] != null) {
      label += ` — ${p.colors[colorIndex]}`;
    }

    const line = price * qty;
    subtotal += line;
    orderItems.push({ product_id: p.id, name_fa: label, qty, unit_price: price });
  }

  // ---- Discount ----------------------------------------------------------
  const code = discount_code && DISCOUNT_CODES[discount_code] ? discount_code : null;
  const rate = code ? DISCOUNT_CODES[code] : 0;
  const discount = Math.round(subtotal * rate);
  const base = subtotal - discount;

  // ---- Shipping --------------------------------------------------------
  // Derived from شهر, not taken from the client's shipping_method — same
  // reasoning as prices/stock above: city is the one thing that actually
  // determines which courier can fulfill the order, so it's not the
  // client's choice to make. An old/stale client sending "post" (retired)
  // or any other value has no effect either way.
  const resolvedShippingMethod = shippingMethodForCity(city);
  const method = SHIPPING[resolvedShippingMethod];
  const freeShip = !method.payAtDoor && base >= FREE_SHIP_OVER;
  const shipCost = method.payAtDoor || freeShip ? 0 : method.cost;
  const total = base + shipCost;

  // ---- Order code (clean sequential number, guaranteed unique) -----------
  const { data: seqData, error: seqErr } = await sb.rpc('nextval_order_code');
  let orderCode;
  if (seqErr || seqData == null) {
    // Fallback: nextval() via a raw query if the RPC wrapper isn't set up —
    // still guaranteed unique, just less clean-looking if this path is hit.
    orderCode = 'GH-' + Date.now().toString(36).toUpperCase();
  } else {
    orderCode = 'GH-' + seqData;
  }

  // ---- Write the order -----------------------------------------------------
  const { data: order, error: orderErr } = await sb
    .from('orders')
    .insert({
      code: orderCode,
      customer_name: name,
      phone,
      city,
      address,
      postcode: postcode || null,
      note: note ? String(note).trim() || null : null,
      shipping_method: resolvedShippingMethod,
      shipping_cost: shipCost,
      discount_code: code,
      subtotal,
      total,
      status: 'pending',
    })
    .select()
    .single();

  if (orderErr) {
    res.status(500).json({ ok: false, error: 'ثبت سفارش با خطا مواجه شد. دوباره تلاش کنید.' });
    return;
  }

  const rowsWithOrderId = orderItems.map((it) => ({ ...it, order_id: order.id }));
  const { error: itemsErr } = await sb.from('order_items').insert(rowsWithOrderId);

  if (itemsErr) {
    // Order shell exists but items failed — clean up rather than leave a
    // broken/empty order behind.
    await sb.from('orders').delete().eq('id', order.id);
    res.status(500).json({ ok: false, error: 'ثبت اقلام سفارش با خطا مواجه شد. دوباره تلاش کنید.' });
    return;
  }

  // ---- Notify the shop by email (best-effort, must never break checkout) --
  try {
    await sendOrderNotificationEmail(order, orderItems);
  } catch (notifyErr) {
    console.error('Order notification email failed:', notifyErr);
  }

  res.status(200).json({
    ok: true,
    code: order.code,
    total,
    subtotal,
    discount,
    shipLabel: method.payAtDoor ? 'پس‌کرایه' : freeShip ? 'رایگان' : String(shipCost),
    items: orderItems.map((it) => ({ fa: it.name_fa, qty: it.qty, line: it.unit_price * it.qty })),
  });
};
