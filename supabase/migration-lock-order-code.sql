-- Migration: lock down nextval_order_code(). Safe to re-run.
--
-- nextval_order_code() (supabase/migration-order-code-sequence.sql) is
-- SECURITY DEFINER and was never revoked from PUBLIC, so anyone — even a
-- signed-out visitor — could call it via /rest/v1/rpc/nextval_order_code and
-- burn order numbers. It also had no fixed search_path.
--
-- After this, only the service role may run it. That is the only caller:
--   - api/orders.js            createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) → sb.rpc('nextval_order_code')
--   - payment-server/src/db.js createClient(supabaseUrl, SUPABASE_SERVICE_ROLE_KEY) → sb.rpc('nextval_order_code')
-- Neither the storefront nor the admin panel calls it. Both callers also
-- fall back to a GH-<base36 time> code if the call ever fails, so a mistake
-- here could not stop orders, only change how their codes look.
--
-- Signature (unchanged): nextval_order_code() returns bigint, no arguments.
--
-- Run in Supabase -> SQL Editor as one script.

begin;

revoke execute on function public.nextval_order_code() from public, anon, authenticated;
grant execute on function public.nextval_order_code() to service_role;
alter function public.nextval_order_code() set search_path = public;

commit;

-- Result: who may execute it (expected: anon false, authenticated false, service_role true)
select
  r.rolname as role,
  has_function_privilege(r.rolname, 'public.nextval_order_code()', 'execute') as can_execute,
  (select array_to_string(p.proconfig, ', ') from pg_proc p where p.oid = 'public.nextval_order_code()'::regprocedure) as settings
from pg_roles r
where r.rolname in ('anon', 'authenticated', 'service_role')
order by r.rolname;
