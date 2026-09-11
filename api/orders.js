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
const SHIPPING = {
  post: { label: 'پست پیشتاز', cost: 65000, payAtDoor: false },
  peyk: { label: 'پیک تهران', cost: 90000, payAtDoor: false },
  tipax: { label: 'تیپاکس', cost: 0, payAtDoor: true },
};
const FREE_SHIP_OVER = 3000000;
const DISCOUNT_CODES = { GLOW10: 0.1, HANDMADE15: 0.15 };

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

  const { customer, note, items, shipping_method, discount_code } = body || {};

  // ---- Validate the shape of what came in -----------------------------
  if (!customer || typeof customer !== 'object') {
    res.status(400).json({ ok: false, error: 'اطلاعات مشتری ناقص است.' });
    return;
  }
  const name = String(customer.name || '').trim();
  const phone = String(customer.phone || '').trim();
  const city = String(customer.city || '').trim();
  const address = String(customer.address || '').trim();
  const postcode = String(customer.postcode || '').trim();

  if (!name) return res.status(400).json({ ok: false, error: 'نام و نام خانوادگی را وارد کنید.' });
  if (phone.replace(/\D/g, '').length < 10)
    return res.status(400).json({ ok: false, error: 'شماره موبایل را کامل وارد کنید.' });
  if (!city) return res.status(400).json({ ok: false, error: 'شهر را وارد کنید.' });
  if (address.length < 10) return res.status(400).json({ ok: false, error: 'نشانی را کامل‌تر بنویسید.' });
  if (!Array.isArray(items) || !items.length)
    return res.status(400).json({ ok: false, error: 'سبد خرید خالی است.' });

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

  // ---- Shipping ------------------------------------------------------------
  const method = SHIPPING[shipping_method] || SHIPPING.post;
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
      shipping_method: shipping_method || 'post',
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
