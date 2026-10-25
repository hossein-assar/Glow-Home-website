// Every Supabase call the payment server makes, in one place. app.js only
// talks to this interface, so tests can swap in an in-memory fake.
// Errors thrown here carry Supabase's message for server logs only — app.js
// never sends them to the client.

import { createClient } from '@supabase/supabase-js';

function check(error, what) {
  if (error) throw new Error(`${what}: ${error.message || error.code || 'unknown error'}`);
}

export function createDb({ supabaseUrl, serviceRoleKey }) {
  const sb = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return {
    async fetchProductsBySlugs(slugs) {
      const { data, error } = await sb
        .from('products')
        .select('id, slug, name_fa, price, height_cm, variants, colors, in_stock')
        .in('slug', slugs);
      check(error, 'fetch products');
      return data || [];
    },

    // Same GH-<seq> code as api/orders.js, including its fallback.
    async nextOrderCode() {
      const { data, error } = await sb.rpc('nextval_order_code');
      if (error || data == null) return 'GH-' + Date.now().toString(36).toUpperCase();
      return 'GH-' + data;
    },

    /** Inserts the order + its items; removes the order again if the items fail. */
    async createOrder(order, items) {
      const { data, error } = await sb.from('orders').insert(order).select('id, code').single();
      check(error, 'insert order');
      const { error: itemsErr } = await sb
        .from('order_items')
        .insert(items.map((it) => ({ ...it, order_id: data.id })));
      if (itemsErr) {
        await sb.from('orders').delete().eq('id', data.id);
        check(itemsErr, 'insert order items');
      }
      return data;
    },

    async setAuthority(orderId, authority) {
      const { data, error } = await sb
        .from('orders')
        .update({ payment_authority: authority })
        .eq('id', orderId)
        .eq('status', 'pending_payment')
        .select('id');
      check(error, 'save authority');
      if (!data || data.length !== 1) throw new Error('save authority: order not in pending_payment');
    },

    async findOrderByAuthority(authority) {
      const { data, error } = await sb
        .from('orders')
        .select('id, code, status, total, payment_amount_rial, paid_at')
        .eq('payment_authority', authority)
        .maybeSingle();
      check(error, 'find order by authority');
      return data;
    },

    /**
     * pending_payment -> payment_failed. Never touches an order in any other
     * status, so a late/forged failure can't undo a paid order.
     */
    async markFailed(orderId, reason) {
      const { error } = await sb
        .from('orders')
        .update({ status: 'payment_failed', payment_error: String(reason).slice(0, 200) })
        .eq('id', orderId)
        .eq('status', 'pending_payment');
      check(error, 'mark order failed');
    },

    /** Calls the idempotent SQL function. Returns 'paid' | 'already_paid' | 'not_found' | 'invalid_status'. */
    async markPaid({ authority, refId, cardPan }) {
      const { data, error } = await sb.rpc('mark_order_paid', {
        p_authority: authority,
        p_ref_id: refId,
        p_card_pan: cardPan,
      });
      check(error, 'mark order paid');
      const row = Array.isArray(data) ? data[0] : data;
      if (!row || !row.result) throw new Error('mark order paid: empty result');
      return row.result;
    },
  };
}
