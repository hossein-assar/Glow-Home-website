-- 1) رافیا — remove the raw-material color-reference photo (rope spools),
--    keep only the real product shot.
update products set
  photos = ARRAY['images/shade-raffia.jpg']::text[],
  updated_at = now()
where slug = 'shade-raffia';

-- 2) مها — reclassify as پلی‌استر (per the reorganized zip folder), not سفالی.
update products set
  subcategory = 'پلی استر',
  material = 'پلی‌استر',
  updated_at = now()
where slug = 'maha';

-- Verification
select slug, subcategory, material, photos from products where slug in ('shade-raffia', 'maha');
