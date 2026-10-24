-- Migration: دفرمه (deforme — NOT deforme-desk) — shade type (شید ساده /
-- شید مکرومه) priced per height, the same mechanism as
-- migration-gisoo-shades.sql. Safe to re-run: it sets the same absolute
-- values every time.
--
-- Stored in the existing `variants` jsonb. Each size gets a `shades` map;
-- `price` stays equal to the plain price:
--   {"height": 140, "price": 13100000, "shades": {"plain": 13100000, "macrame": 13500000}}
-- A size accepts only the shade types stored in its own `shades` map, so
-- deforme takes plain/macrame (not embroidered) and gisoo plain/embroidered
-- (not macrame). Cart keys: deforme::h140::splain / deforme::h140::smacrame.
-- Old keys (deforme::h60 without a shade, or the removed 60/80/130 sizes)
-- are rejected by api/orders.js and the payment server.
--
-- height_cm / price (the base size the product card shows and adds to the
-- cart) become the 100 cm plain option. The description is NOT touched.
-- No other row is touched.
--
-- ⚠ Do NOT re-run the old seed/migration files that write deforme's sizes
-- (import-real-catalog.sql, migration-aghaghia-split-and-styles.sql,
-- migration-pdf-prices-colors-cleanup.sql) after this one: they would put
-- back the removed 60/80/130 sizes without shade prices and undo this.
--
-- Run in Supabase -> SQL Editor as one script. If a safety check fails,
-- the whole transaction rolls back and nothing changes.

begin;

-- Safety check: deforme must exist exactly once.
do $$
declare
  n int;
begin
  select count(*) into n from products where slug = 'deforme';
  if n <> 1 then
    raise exception 'Expected exactly 1 product with slug deforme, found %. Nothing was changed.', n;
  end if;
end $$;

-- The update itself, inside a DO block so it can verify it hit exactly 1 row.
do $$
declare
  n int;
begin
  update products set
    variants = '[
      {"height": 140, "price": 13100000, "shades": {"plain": 13100000, "macrame": 13500000}},
      {"height": 120, "price": 10100000, "shades": {"plain": 10100000, "macrame": 10500000}},
      {"height": 100, "price": 9400000,  "shades": {"plain": 9400000,  "macrame": 9800000}}
    ]'::jsonb,
    height_cm = 100,
    price = 9400000,
    updated_at = now()
  where slug = 'deforme';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'Expected to update exactly 1 row for deforme, updated %. Nothing was changed.', n;
  end if;
end $$;

commit;

-- Result: the stored deforme prices, one row per height
select
  p.slug,
  p.height_cm as base_height,
  p.price as base_price,
  (v ->> 'height')::int as height,
  (v ->> 'price')::bigint as variant_price,
  (v -> 'shades' ->> 'plain')::bigint as plain_price,
  (v -> 'shades' ->> 'macrame')::bigint as macrame_price
from products p, jsonb_array_elements(p.variants) as v
where p.slug = 'deforme'
order by height desc;
