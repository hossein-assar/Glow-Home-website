// POST /api/track-order
//
// Looks up an order for the customer-facing tracking page. Order codes are
// sequential (GH-1000, GH-1001, ...) and trivially guessable, so the code
// alone must never be enough to pull up someone else's name, address, and
// phone number. Tracking requires BOTH the order code AND the phone number
// used at checkout to match — a mismatch on either one returns the exact
// same generic error, so a wrong guess can't be used to probe which half
// (code vs. phone) was the wrong one.
//
// Runs with the Supabase service-role key, same as /api/orders.js — RLS on
// orders/order_items doesn't grant the public a read path, this function is
// the only way a customer gets order data back.

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://sgfoesnpodvwyzlxfhtq.supabase.co';

const GENERIC_ERROR = 'کد سفارش یا شماره موبایل مطابقت ندارد.';

function normalizePhone(p) {
  return String(p || '').replace(/\D/g, '');
}

// Order codes are always generated uppercase ("GH-140001"), but a customer
// typing one by hand may not match that casing — never let casing alone
// keep someone from finding their own order.
function normalizeCode(c) {
  return String(c || '').trim().toUpperCase();
}

// ilike treats % and _ as wildcards. Order codes only ever contain letters,
// digits, and dashes, so escape those two characters defensively rather
// than let a stray one turn an exact lookup into a broader pattern search.
function escapeIlike(s) {
  return s.replace(/[%_\\]/g, '\\$&');
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  try {
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

    const code = normalizeCode(body && body.code);
    const phone = normalizePhone(body && body.phone);

    if (!code || phone.length < 10) {
      res.status(400).json({ ok: false, error: GENERIC_ERROR });
      return;
    }

    const sb = createClient(SUPABASE_URL, serviceKey);

    const { data: order, error: orderErr } = await sb
      .from('orders')
      .select('id, code, phone, status, total, created_at')
      .ilike('code', escapeIlike(code))
      .maybeSingle();

    // Same generic error whether the code doesn't exist or the phone just
    // doesn't match it — never reveal which half was wrong.
    if (orderErr || !order || normalizePhone(order.phone) !== phone) {
      res.status(400).json({ ok: false, error: GENERIC_ERROR });
      return;
    }

    const { data: items, error: itemsErr } = await sb
      .from('order_items')
      .select('name_fa, qty')
      .eq('order_id', order.id);

    if (itemsErr) {
      res.status(400).json({ ok: false, error: 'خطا در دریافت اطلاعات سفارش. دوباره تلاش کنید.' });
      return;
    }

    // Deliberately not returning customer_name/phone/address — tracking
    // only needs order contents + status, not the private checkout details.
    res.status(200).json({
      ok: true,
      code: order.code,
      status: order.status,
      items: (items || []).map((it) => ({ name_fa: it.name_fa, qty: it.qty })),
      total: order.total,
      createdAt: order.created_at,
    });
  } catch (err) {
    console.error('track-order failed:', err);
    res.status(400).json({ ok: false, error: GENERIC_ERROR });
  }
};
