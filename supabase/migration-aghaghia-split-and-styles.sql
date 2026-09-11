-- Run supabase/migration-style-variants.sql BEFORE this file.

-- ---------------------------------------------------------------------------
-- 1) Split اقاقیا into two real, distinct products (desk vs. sofa-side).
--    Both slugs already exist from the original import — this just renames
--    them, points each at its correct photos, and clears the old text note
--    now that sizing is handled by the dropdown/name split instead.
-- ---------------------------------------------------------------------------

update products set
  name_fa = 'اقاقیا رومیزی',
  name_en = 'Aghaghia Desk',
  style = 'رومیزی',
  description = '',
  photo_url = 'images/aghaghia.jpg',
  photos = ARRAY['images/aghaghia.jpg', 'images/aghaghia-2.jpg', 'images/aghaghia-3.jpg']::text[],
  height_cm = 60,
  price = 6500000,
  variants = '[]'::jsonb,
  updated_at = now()
where slug = 'aghaghia';

update products set
  name_fa = 'اقاقیا کنار سالنی',
  name_en = 'Aghaghia Sofa-Side',
  style = 'کنار سالنی',
  description = '',
  photo_url = 'images/aghaghia-tall.jpg',
  photos = ARRAY['images/aghaghia-tall.jpg', 'images/aghaghia-tall-2.jpg', 'images/aghaghia-tall-3.jpg']::text[],
  height_cm = 140,
  price = 12980000,
  variants = '[
    {"height": 140, "price": 12980000},
    {"height": 120, "price": 9980000},
    {"height": 100, "price": 9100000},
    {"height": 80,  "price": 7100000}
  ]'::jsonb,
  updated_at = now()
where slug = 'aghaghia-tall';

-- ---------------------------------------------------------------------------
-- 2) دفرمه family — same desk/sofa-side split, already two separate
--    products, just needs the style tag + variants added to the tall one.
-- ---------------------------------------------------------------------------

update products set style = 'رومیزی' where slug in ('deforme', 'deforme-desk');

update products set
  style = 'کنار سالنی',
  description = '',
  variants = '[
    {"height": 130, "price": 13180000},
    {"height": 100, "price": 8980000},
    {"height": 80,  "price": 7100000}
  ]'::jsonb,
  updated_at = now()
where slug = 'deforme-tall';

-- ---------------------------------------------------------------------------
-- 3) گیسو — stays a single product, tagged کنار سالنی, sizes via the same
--    dropdown pattern (its own base 60cm stays as the pre-selected size).
-- ---------------------------------------------------------------------------

update products set
  style = 'کنار سالنی',
  description = '',
  variants = '[
    {"height": 60,  "price": 6200000},
    {"height": 80,  "price": 7100000},
    {"height": 100, "price": 8980000},
    {"height": 130, "price": 13180000}
  ]'::jsonb,
  updated_at = now()
where slug = 'gisoo';

-- ---------------------------------------------------------------------------
-- 4) Every other lamp defaults to رومیزی.
-- ---------------------------------------------------------------------------

update products set style = 'رومیزی'
where collection = 'lamps' and style is null;
