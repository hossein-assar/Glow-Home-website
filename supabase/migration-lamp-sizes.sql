-- Migration: body / shade size for lamps + the owner-supplied new table-lamp data
-- (phase 1: table lamps only). Safe to re-run.
--
-- Floor lamps (gisoo, deforme, aghaghia-tall) are phase 2 and are NOT touched.
-- material is NOT touched on any row.
-- height_cm holds only the plain number («حدودا» from the file is dropped).
-- Where the owner file had a dash, that column is left out of the UPDATE.
-- Table lamps have no size variants (checked below), so `price` is the
-- price the site shows AND the price api/orders.js and the payment server
-- charge.
--
-- Run in Supabase -> SQL Editor as one script. If the safety check fails,
-- the whole transaction rolls back and nothing changes.

begin;

alter table products add column if not exists body_size text;   -- اندازه بدنه, free text in cm, e.g. 'ارتفاع ۱۰ / قطر ۲۵'
alter table products add column if not exists shade_size text;  -- اندازه شید, free text in cm, e.g. 'قطر ۳۵ / ارتفاع ۲۰'

-- Safety check: all 17 slugs must exist as table lamps without size variants.
do $$
declare
  n int;
begin
  select count(*) into n
  from products
  where slug in (
      'rosha', 'lale', 'mahgol', 'delaram', 'nila', 'samin', 'tara', 'maha',
      'aghaghia', 'deforme-desk', 'shiari', 'rojan', 'roz', 'luna', 'selin',
      'ava', 'gol-o-morgh'
    )
    and collection = 'lamps'
    and style = 'رومیزی'
    and variants = '[]'::jsonb;
  if n <> 17 then
    raise exception 'Expected 17 table-lamp rows without variants, found %. Nothing was changed.', n;
  end if;
end $$;

-- 1. روشا
update products set price = 6500000, height_cm = 43,
  body_size = 'ارتفاع ۱۰ / قطر ۲۵', shade_size = 'قطر ۳۵ / ارتفاع ۲۰', updated_at = now()
where slug = 'rosha';

-- 2. لاله
update products set price = 6500000, height_cm = 40,
  body_size = 'ارتفاع ۱۵ / قطر ۲۶', shade_size = 'قطر ۳۵ / ارتفاع ۲۰', updated_at = now()
where slug = 'lale';

-- 3. مهگل
update products set price = 6500000, height_cm = 45,
  body_size = 'ارتفاع ۱۷ / قطر کف ۲۴', shade_size = 'قطر ۳۵ / ارتفاع ۲۵', updated_at = now()
where slug = 'mahgol';

-- 4. دل‌آرام: price 7.500 from the file replaces 6,980,000. Body and total
-- height are dashes in the file, so those columns are left out.
update products set price = 7500000,
  shade_size = 'قطر ۳۵ / ارتفاع ۲۰', updated_at = now()
where slug = 'delaram';

-- 5. نیلا
update products set price = 6500000, height_cm = 40,
  body_size = 'ارتفاع ۲۶ / قطر ۱۶', shade_size = 'قطر ۳۵ / ارتفاع ۲۰', updated_at = now()
where slug = 'nila';

-- 6. ثمین (price unchanged in value, set explicitly as the file gives it)
update products set price = 4500000, height_cm = 38,
  body_size = 'ارتفاع ۱۲ / قطر ۷', shade_size = 'قطر ۱۵ / ارتفاع ۲۵', updated_at = now()
where slug = 'samin';

-- 7. تارا: price is a dash in the file → current price kept
update products set height_cm = 50,
  body_size = 'ارتفاع ۲۵', shade_size = 'قطر ۱۵ / ارتفاع ۲۵', updated_at = now()
where slug = 'tara';

-- 8. مها
update products set price = 7500000, height_cm = 40,
  body_size = 'ارتفاع ۲۰ / قطر ۲۵', shade_size = 'قطر بزرگ ۳۵، قطر کوچک ۱۰، ارتفاع ۱۹', updated_at = now()
where slug = 'maha';

-- 9. اقاقیا رومیزی
update products set price = 7500000, height_cm = 60,
  body_size = 'ارتفاع ۳۰', shade_size = 'قطر ۲۰ / ارتفاع ۳۰', updated_at = now()
where slug = 'aghaghia';

-- 10. دفرمه رومیزی
update products set price = 6500000, height_cm = 63,
  body_size = 'ارتفاع ۳۵', shade_size = 'قطر بزرگ ۳۵، قطر کوچک ۱۸، ارتفاع ۲۵', updated_at = now()
where slug = 'deforme-desk';

-- 14. شیاری
update products set price = 6500000, height_cm = 40,
  body_size = 'ارتفاع ۲۶ / قطر ۱۶', shade_size = 'قطر ۲۰ / ارتفاع ۲۰', updated_at = now()
where slug = 'shiari';

-- 15. روژان
update products set price = 6500000, height_cm = 40,
  body_size = 'ارتفاع ۲۶ / قطر ۱۶', shade_size = 'قطر ۲۰ / ارتفاع ۲۰', updated_at = now()
where slug = 'rojan';

-- 16. رز (the file says «زر»; confirmed as roz). Price is a dash → kept.
update products set height_cm = 30,
  body_size = 'ارتفاع ۱۵ / قطر ۲۲', shade_size = 'قطر ۲۰ / ارتفاع ۲۰', updated_at = now()
where slug = 'roz';

-- 17. لونا
update products set price = 6500000, height_cm = 40,
  body_size = 'ارتفاع ۲۶ / قطر ۱۶', shade_size = 'قطر ۲۰ / ارتفاع ۲۰', updated_at = now()
where slug = 'luna';

-- 18. سلین (price unchanged in value, set explicitly as the file gives it)
update products set price = 4500000, height_cm = 43,
  body_size = 'قطر ۲۴', shade_size = 'قطر ۲۰ / ارتفاع ۲۰', updated_at = now()
where slug = 'selin';

-- 19. آوا
update products set price = 5500000, height_cm = 40,
  body_size = 'ارتفاع ۲۰ / قطر ۱۵', shade_size = 'قطر بزرگ ۳۵، قطر کوچک ۱۰، ارتفاع ۱۹', updated_at = now()
where slug = 'ava';

-- 20. گل و مرغ: price is a dash in the file → current price kept
update products set height_cm = 60,
  body_size = 'ارتفاع ۳۰', shade_size = 'قطر بزرگ ۳۵، قطر کوچک ۱۰، ارتفاع ۱۹', updated_at = now()
where slug = 'gol-o-morgh';

commit;

-- Result: the 17 changed rows
select slug, name_fa, material, price, height_cm, body_size, shade_size, updated_at
from products
where slug in (
    'rosha', 'lale', 'mahgol', 'delaram', 'nila', 'samin', 'tara', 'maha',
    'aghaghia', 'deforme-desk', 'shiari', 'rojan', 'roz', 'luna', 'selin',
    'ava', 'gol-o-morgh'
  )
order by slug;
