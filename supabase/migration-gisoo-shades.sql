-- Migration: گیسو (gisoo) — shade type (شید ساده / شید گلدوزی) priced per
-- height. Safe to re-run: it sets the same absolute values every time.
--
-- Stored in the existing `variants` jsonb (no new column). Each size gets a
-- `shades` map; `price` stays equal to the plain price so anything that only
-- reads {height, price} keeps working:
--   {"height": 140, "price": 12980000, "shades": {"plain": 12980000, "embroidered": 15450000}}
-- A product whose variants carry `shades` is priced strictly by api/orders.js
-- and the payment server: the cart key must name one of these heights AND a
-- shade type (gisoo::h140::splain / gisoo::h140::sembroidered). Old keys
-- (gisoo::h100 without a shade, or the removed 60/80/130 sizes) are rejected.
--
-- height_cm / price (the base size the product card shows and adds to the
-- cart) become the 100 cm plain option. No other row is touched.
--
-- Run in Supabase -> SQL Editor as one script. If the safety check fails,
-- the whole transaction rolls back and nothing changes.

begin;

-- Safety check: gisoo must exist exactly once.
do $$
declare
  n int;
begin
  select count(*) into n from products where slug = 'gisoo';
  if n <> 1 then
    raise exception 'Expected exactly 1 product with slug gisoo, found %. Nothing was changed.', n;
  end if;
end $$;

-- The update itself, inside a DO block so it can verify it hit exactly 1 row.
do $$
declare
  n int;
begin
  update products set
    variants = '[
      {"height": 140, "price": 12980000, "shades": {"plain": 12980000, "embroidered": 15450000}},
      {"height": 120, "price": 9980000,  "shades": {"plain": 9980000,  "embroidered": 12480000}},
      {"height": 100, "price": 9100000,  "shades": {"plain": 9100000,  "embroidered": 11600000}}
    ]'::jsonb,
    height_cm = 100,
    price = 9100000,
    updated_at = now()
  where slug = 'gisoo';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'Expected to update exactly 1 row for gisoo, updated %. Nothing was changed.', n;
  end if;
end $$;

commit;

-- Result: the stored gisoo prices, one row per height
select
  p.slug,
  p.height_cm as base_height,
  p.price as base_price,
  (v ->> 'height')::int as height,
  (v ->> 'price')::bigint as variant_price,
  (v -> 'shades' ->> 'plain')::bigint as plain_price,
  (v -> 'shades' ->> 'embroidered')::bigint as embroidered_price
from products p, jsonb_array_elements(p.variants) as v
where p.slug = 'gisoo'
order by height desc;
