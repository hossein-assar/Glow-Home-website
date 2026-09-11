create sequence if not exists order_code_seq start 1000;

-- Exposes nextval() as something the Supabase client can call via .rpc() —
-- the REST API doesn't let you call nextval() directly.
create or replace function nextval_order_code()
returns bigint
language sql
security definer
as $$
  select nextval('order_code_seq');
$$;
