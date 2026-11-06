-- Migration: shades («شیدها») become data the admin can edit.
--
-- Adds products.shade_types — the product's shades, in display order:
--   [{"key": "plain", "name_fa": "شید ساده", "name_en": "", "in_stock": true}, …]
-- Prices do NOT move: each size keeps its FULL price per shade in the
-- existing `variants` jsonb, keyed by the same `key`:
--   {"height": 140, "price": 12980000, "shades": {"plain": 12980000, "embroidered": 15450000}}
-- `key` never changes (cart keys use it: gisoo::h140::splain); name_fa,
-- name_en and in_stock are edited in the admin («ویرایش کامل» → «شیدها»).
--
-- Backfill: every product whose sizes already carry shades (today گیسو,
-- دفرمه, نیلا — found by their data, not by slug) gets the original three
-- types it uses, with today's labels and in today's order (ساده first):
--   plain → «شید ساده», embroidered → «شید گلدوزی», macrame → «شید مکرومه».
-- So every product keeps exactly the same shades and prices, and the
-- storefront, cart keys and order labels are unchanged.
--
-- Only the new column is written: variants, price and every other column
-- stay exactly as they are (updated_at too). Orders are not touched: each
-- order line keeps its own copy of the shade name and price.
--
-- RLS: unchanged. The column belongs to `products`, so the existing
-- policies apply as they are — anyone may read, only admins may write.
--
-- Idempotent: safe to run more than once (the column and the check are
-- added only if missing; the backfill only fills rows whose list is still
-- empty, so a shade added or renamed in the admin is never overwritten).
--
-- Run in Supabase -> SQL Editor as one script. If a safety check fails,
-- the whole transaction rolls back and nothing changes.

begin;

alter table products add column if not exists shade_types jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'products_shade_types_is_array') then
    alter table products add constraint products_shade_types_is_array check (jsonb_typeof(shade_types) = 'array');
  end if;
end $$;

-- The rows this run fills: those whose list is still empty. Every check
-- below looks only at them, so a re-run never trips over a product whose
-- shades were already edited in the admin.
create temp table shade_backfill on commit drop as
  select id from products where shade_types = '[]'::jsonb;

-- Safety check: every shade key stored today must be one of the original
-- three — anything else would have no name to give it.
do $$
declare
  unknown text;
begin
  select string_agg(distinct p.slug || ':' || k, ', ') into unknown
  from products p
  cross join lateral jsonb_array_elements(case when jsonb_typeof(p.variants) = 'array' then p.variants else '[]'::jsonb end) as v
  cross join lateral jsonb_object_keys(case when jsonb_typeof(v -> 'shades') = 'object' then v -> 'shades' else '{}'::jsonb end) as k
  where p.id in (select id from shade_backfill)
    and k not in ('plain', 'embroidered', 'macrame');
  if unknown is not null then
    raise exception 'Unknown shade keys (no name to give them): %. Nothing was changed.', unknown;
  end if;
end $$;

-- Backfill: the original types each product's sizes use, in this order.
update products p
set shade_types = sub.types
from (
  select p2.id,
         jsonb_agg(
           jsonb_build_object('key', t.key, 'name_fa', t.name_fa, 'name_en', '', 'in_stock', true)
           order by t.ord
         ) as types
  from products p2
  cross join (values
    (1, 'plain',       'شید ساده'),
    (2, 'embroidered', 'شید گلدوزی'),
    (3, 'macrame',     'شید مکرومه')
  ) as t(ord, key, name_fa)
  where exists (
    select 1
    from jsonb_array_elements(case when jsonb_typeof(p2.variants) = 'array' then p2.variants else '[]'::jsonb end) as v
    where jsonb_typeof(v -> 'shades') = 'object' and (v -> 'shades') ? t.key
  )
  group by p2.id
) as sub
where p.id = sub.id
  and p.id in (select id from shade_backfill);

-- Check: every shade key on every size of the filled rows now has a named shade.
do $$
declare
  missing text;
begin
  select string_agg(distinct p.slug || ':' || k, ', ') into missing
  from products p
  cross join lateral jsonb_array_elements(case when jsonb_typeof(p.variants) = 'array' then p.variants else '[]'::jsonb end) as v
  cross join lateral jsonb_object_keys(case when jsonb_typeof(v -> 'shades') = 'object' then v -> 'shades' else '{}'::jsonb end) as k
  where p.id in (select id from shade_backfill)
    and not exists (select 1 from jsonb_array_elements(p.shade_types) as t where t ->> 'key' = k);
  if missing is not null then
    raise exception 'Shade prices without a named shade: %. Nothing was changed.', missing;
  end if;
end $$;

commit;

-- Result: each product with shades, its shades in order, and its prices per
-- size (expected: گیسو / نیلا → شید ساده, شید گلدوزی; دفرمه → شید ساده,
-- شید مکرومه; the prices exactly as before).
select
  p.slug,
  p.name_fa,
  (select string_agg(t ->> 'name_fa', ' | ' order by o) from jsonb_array_elements(p.shade_types) with ordinality as x(t, o)) as shades,
  (v ->> 'height')::int as height,
  v -> 'shades' as prices
from products p
cross join lateral jsonb_array_elements(case when jsonb_typeof(p.variants) = 'array' then p.variants else '[]'::jsonb end) as v
where jsonb_array_length(p.shade_types) > 0
order by p.slug, (v ->> 'height')::int desc;

-- ---------------------------------------------------------------------------
-- ROLLBACK (only if needed) — run ONLY after the payment server and the site
-- are back on the code before this change: that payment server code does
-- not read shade_types, the new code does (its product query names the
-- column and would fail without it).
--
-- Dropping the column loses the shade NAMES and «موجود» switches edited in
-- the admin. The original three keep working from their built-in names; a
-- shade ADDED in the admin keeps its prices in `variants` but would no
-- longer be offered (the old code knows only plain / embroidered / macrame)
-- — delete such shades in the admin first, or restore them by hand later.
-- Orders are not affected either way.
--
-- begin;
-- alter table products drop constraint if exists products_shade_types_is_array;
-- alter table products drop column if exists shade_types;
-- commit;
-- ---------------------------------------------------------------------------
