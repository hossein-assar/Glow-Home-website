-- Migration: نیلا (nila) — shade type (شید ساده / شید گلدوزی) priced per
-- height, the same mechanism as migration-gisoo-shades.sql and
-- migration-deforme-shades.sql. Safe to re-run: it sets the same absolute
-- values every time.
--
-- nila has one height, 40 cm (table lamp). Stored in the existing `variants`
-- jsonb; `price` stays equal to the plain price:
--   {"height": 40, "price": 6500000, "shades": {"plain": 6500000, "embroidered": 8900000}}
-- Cart keys: nila::h40::splain / nila::h40::sembroidered. The old key
-- "nila" (no size, no shade) is rejected by api/orders.js and the payment
-- server, and dropped from carts by the storefront.
--
-- price (what the product card shows and adds to the cart) becomes the
-- plain price. The sentence «نسخه‌ی شید گلدوزی‌شده: ۸,۵۰۰,۰۰۰ تومان» is
-- removed from the description (the price now lives in the shade picker);
-- the description becomes empty (NULL) if nothing else is left. height_cm
-- (40) is checked, not changed. No other column or row is touched.
--
-- Run in Supabase -> SQL Editor as one script. If a safety check fails,
-- the whole transaction rolls back and nothing changes.

begin;

-- Safety checks: nila must exist exactly once, with base height 40 cm.
do $$
declare
  n int;
  h int;
begin
  select count(*), max(height_cm) into n, h from products where slug = 'nila';
  if n <> 1 then
    raise exception 'Expected exactly 1 product with slug nila, found %. Nothing was changed.', n;
  end if;
  if h is distinct from 40 then
    raise exception 'Expected nila height_cm = 40, found %. Nothing was changed.', h;
  end if;
end $$;

-- The update itself, inside a DO block so it can verify it hit exactly 1 row.
do $$
declare
  n int;
begin
  update products set
    variants = '[
      {"height": 40, "price": 6500000, "shades": {"plain": 6500000, "embroidered": 8900000}}
    ]'::jsonb,
    price = 6500000,
    -- Remove only the shade-price sentence (Persian or English digits, «,» or
    -- «٬» separators, with or without the half-spaces); keep anything else.
    description = nullif(
      btrim(regexp_replace(
        coalesce(description, ''),
        'نسخه[\u200c\s]?ی\s+شید\s+گلدوزی[\u200c\s]?شده\s*:\s*[0-9۰-۹,٬]+\s*تومان\.?',
        '',
        'g'
      )),
      ''
    ),
    updated_at = now()
  where slug = 'nila';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'Expected to update exactly 1 row for nila, updated %. Nothing was changed.', n;
  end if;
end $$;

commit;

-- Result: nila's stored prices and description (expected: 40 | 6500000 |
-- 40 | 6500000 | 6500000 | 8900000 | description NULL)
select
  p.slug,
  p.height_cm as base_height,
  p.price as base_price,
  (v ->> 'height')::int as height,
  (v ->> 'price')::bigint as variant_price,
  (v -> 'shades' ->> 'plain')::bigint as plain_price,
  (v -> 'shades' ->> 'embroidered')::bigint as embroidered_price,
  p.description
from products p, jsonb_array_elements(p.variants) as v
where p.slug = 'nila';
