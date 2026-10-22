-- Migration: online payment through ZarinPal (payment-server/).
-- Safe to re-run. Run it in Supabase -> SQL Editor BEFORE turning on
-- ONLINE_PAYMENT.enabled in data.js.
--
-- New order statuses (orders.status stays free text, no CHECK constraint,
-- same as before — existing rows are untouched):
--   pending_payment  order created by payment-server, customer sent to
--                    ZarinPal, not paid (yet). Abandoned checkouts stay here.
--   payment_failed   customer cancelled at ZarinPal, or verification failed.
--   paid             set ONLY by mark_order_paid() below for online orders.
-- Pay-at-door / card-to-card orders from /api/orders keep using 'pending'.

-- ---------------------------------------------------------------------------
-- Payment columns
-- ---------------------------------------------------------------------------
-- payment_authority / payment_ref_id are already in schema.sql, but may not
-- exist in the live database — "if not exists" covers both cases.
alter table orders add column if not exists payment_method text;          -- 'zarinpal' for online orders, null otherwise
alter table orders add column if not exists payment_authority text;       -- ZarinPal Authority (36 chars)
alter table orders add column if not exists payment_amount_rial bigint;   -- exact amount sent to ZarinPal, in Rial
alter table orders add column if not exists payment_ref_id text;          -- ZarinPal ref_id after a successful verify
alter table orders add column if not exists payment_card_pan text;        -- masked card, e.g. 502229******5995
alter table orders add column if not exists payment_error text;           -- last ZarinPal error code / reason, for admin
alter table orders add column if not exists paid_at timestamptz;

-- One authority belongs to exactly one order; /api/verify looks orders up
-- by this column, so it must be unique and indexed.
create unique index if not exists orders_payment_authority_key
  on orders (payment_authority)
  where payment_authority is not null;

-- ---------------------------------------------------------------------------
-- mark_order_paid — the ONLY way an online order becomes 'paid'.
-- ---------------------------------------------------------------------------
-- Idempotent: the row is locked (FOR UPDATE), and the status only changes
-- if it's still unpaid. A repeated or concurrent ZarinPal callback gets
-- 'already_paid' back and changes nothing. Stock is NOT touched
-- (products.in_stock stays a manual on/off switch).
--
-- payment_failed -> paid is allowed on purpose: if ZarinPal confirms the
-- money for this authority (code 100/101), that confirmation beats an
-- earlier failure we recorded (e.g. a timeout on our side).
-- Any other status (cancelled, or an admin-moved order) is left alone and
-- reported as 'invalid_status' so the server can log it for manual review.
--
-- Returns one row: result is 'paid' | 'already_paid' | 'not_found' | 'invalid_status'.
create or replace function mark_order_paid(
  p_authority text,
  p_ref_id text,
  p_card_pan text
)
returns table (order_id uuid, order_code text, result text)
language plpgsql
security invoker
set search_path = public
as $$
declare
  o orders%rowtype;
begin
  select * into o
  from orders
  where payment_authority = p_authority
  for update;

  if not found then
    return query select null::uuid, null::text, 'not_found'::text;
    return;
  end if;

  if o.paid_at is not null then
    return query select o.id, o.code, 'already_paid'::text;
    return;
  end if;

  if o.status not in ('pending_payment', 'payment_failed') then
    return query select o.id, o.code, 'invalid_status'::text;
    return;
  end if;

  update orders
  set status = 'paid',
      payment_ref_id = p_ref_id,
      payment_card_pan = p_card_pan,
      payment_error = null,
      paid_at = now()
  where id = o.id;

  return query select o.id, o.code, 'paid'::text;
end;
$$;

-- Functions are executable by PUBLIC by default, and PostgREST exposes
-- them as /rpc/... — only the payment server (service role) may call this.
revoke all on function mark_order_paid(text, text, text) from public;
revoke all on function mark_order_paid(text, text, text) from anon, authenticated;
grant execute on function mark_order_paid(text, text, text) to service_role;
