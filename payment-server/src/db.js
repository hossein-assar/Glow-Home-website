// Every Supabase call the payment server makes, in one place. app.js only
// talks to this interface, so tests can swap in an in-memory fake.
// Errors thrown here carry Supabase's message for server logs only — app.js
// never sends them to the client.

import { createClient } from '@supabase/supabase-js';

function check(error, what) {
  if (error) throw new Error(`${what}: ${error.message || error.code || 'unknown error'}`);
}

// Each Supabase HTTP request is aborted after this long. Without it a
// connection that opens but never answers waits for Node's own 300 s limit,
// long after nginx (60 s) has given up — a checkout that hangs silently.
export const SUPABASE_TIMEOUT_MS = 10000;

/**
 * An AbortSignal that fires after ms with a TimeoutError. Built on a plain
 * setTimeout, not AbortSignal.timeout(): that one's timer doesn't keep Node
 * running, so code (or a test) waiting only on it can be cut off on Node 22.
 * Call clear() as soon as the work is done, so no timer is left behind.
 */
export function deadline(ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new DOMException(`timed out after ${ms} ms`, 'TimeoutError')), ms);
  return { signal: ctrl.signal, clear: () => clearTimeout(timer) };
}

/** Runs attempt(signal) with a deadline of ms; the timer is always cleared. */
export async function within(attempt, ms) {
  const d = deadline(ms);
  try {
    return await attempt(d.signal);
  } finally {
    d.clear();
  }
}

/**
 * fetch with a hard time limit until the response headers arrive, keeping any
 * signal supabase-js passes (each call's own deadline, below, also covers
 * reading the body).
 */
export function fetchWithTimeout(fetchImpl = fetch, ms = SUPABASE_TIMEOUT_MS) {
  return async (url, options = {}) => {
    const d = deadline(ms);
    const signal = options.signal ? AbortSignal.any([options.signal, d.signal]) : d.signal;
    try {
      return await fetchImpl(url, { ...options, signal });
    } finally {
      d.clear();
    }
  };
}

// Calls that are safe to repeat get one more try after RETRY_DELAY_MS, each
// try limited to ATTEMPT_MS so both fit inside the app's 10 s step limit
// (4.5 + 0.5 + 4.5 s). Which calls, and why the others are not retried:
//   fetchProductsBySlugs, findOrderByAuthority, ping — reads.
//   setAuthority — sets the same value on the same pending order; a second
//     run after a lost answer finds it already set, so it's harmless.
//   nextOrderCode — a sequence never hands out a number twice, so a retry
//     can't duplicate an order code; at worst one number is skipped, exactly
//     like any checkout abandoned after its code was taken.
//   createOrder — NOT retried: an insert whose answer was lost may have
//     succeeded, and running it again would leave a second order (and its
//     items) for the same checkout. The customer retries the whole checkout.
//   markFailed / markPaid — not retried here; the callback flow already
//     handles a failure (see app.js).
export const ATTEMPT_MS = 4500;
export const RETRY_DELAY_MS = 500;

/** Runs attempt(signal); on any error waits delayMs and runs it once more. */
export async function retryOnce(attempt, { attemptMs = ATTEMPT_MS, delayMs = RETRY_DELAY_MS } = {}) {
  try {
    return await within(attempt, attemptMs);
  } catch {
    await new Promise((r) => setTimeout(r, delayMs));
    return within(attempt, attemptMs);
  }
}

export function createDb({
  supabaseUrl,
  serviceRoleKey,
  fetchImpl = fetch,
  timeoutMs = SUPABASE_TIMEOUT_MS,
  attemptMs = ATTEMPT_MS,
  retryDelayMs = RETRY_DELAY_MS,
}) {
  const sb = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: fetchWithTimeout(fetchImpl, timeoutMs) },
    // supabase-js retries a timed-out GET 3 more times (1 s, 2 s, 4 s apart):
    // up to ~47 s for one lookup. One attempt; the customer can try again.
    db: { retry: false },
  });
  const retry = (attempt) => retryOnce(attempt, { attemptMs, delayMs: retryDelayMs });

  return {
    async fetchProductsBySlugs(slugs) {
      return retry(async (signal) => {
        const { data, error } = await sb
          .from('products')
          .select('id, slug, name_fa, price, height_cm, variants, colors, in_stock')
          .in('slug', slugs)
          .abortSignal(signal);
        check(error, 'fetch products');
        return data || [];
      });
    },

    // Same GH-<seq> code as api/orders.js, including its fallback.
    async nextOrderCode() {
      try {
        return await retry(async (signal) => {
          const { data, error } = await sb.rpc('nextval_order_code').abortSignal(signal);
          check(error || (data == null && { message: 'empty result' }), 'order code');
          return 'GH-' + data;
        });
      } catch {
        return 'GH-' + Date.now().toString(36).toUpperCase();
      }
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
      const data = await retry(async (signal) => {
        const { data, error } = await sb
          .from('orders')
          .update({ payment_authority: authority })
          .eq('id', orderId)
          .eq('status', 'pending_payment')
          .select('id')
          .abortSignal(signal);
        check(error, 'save authority');
        return data;
      });
      if (!data || data.length !== 1) throw new Error('save authority: order not in pending_payment');
    },

    async findOrderByAuthority(authority) {
      return retry(async (signal) => {
        const { data, error } = await sb
          .from('orders')
          .select('id, code, status, total, payment_amount_rial, paid_at')
          .eq('payment_authority', authority)
          .maybeSingle()
          .abortSignal(signal);
        check(error, 'find order by authority');
        return data;
      });
    },

    /** Smallest possible read, for /health/deep. One try, no retry. */
    async ping(signal) {
      const { error } = await sb.from('products').select('id').limit(1).abortSignal(signal);
      check(error, 'ping');
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
