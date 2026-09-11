-- Run migration-add-colors.sql FIRST if you haven't already.
-- Everything below is safe to re-run.

-- ---------------------------------------------------------------------------
-- 1) Real prices from the studio's official price sheet (ا_باژور_v2.pdf).
--    Several of these correct earlier placeholder/estimated values.
-- ---------------------------------------------------------------------------
update products set price = 5500000, updated_at = now() where slug = 'rosha';
update products set price = 5500000, updated_at = now() where slug = 'lale';
update products set price = 5100000, updated_at = now() where slug = 'shiari';
update products set price = 6500000, updated_at = now() where slug = 'maha';
update products set price = 6980000, updated_at = now() where slug = 'gol-o-morgh';
update products set price = 5500000, updated_at = now() where slug = 'deforme-desk';
update products set price = 6980000, updated_at = now() where slug = 'delaram';
update products set price = 5500000, updated_at = now() where slug = 'mahgol';
update products set price = 4500000, updated_at = now() where slug = 'tara';
update products set price = 5500000, updated_at = now() where slug = 'rojan';
update products set price = 5200000, updated_at = now() where slug = 'ava';
update products set price = 5500000, updated_at = now() where slug = 'luna';
update products set price = 4500000, updated_at = now() where slug = 'selin';
update products set price = 4500000, updated_at = now() where slug = 'samin';

update products set
  price = 5500000,
  description = 'نسخه‌ی شید گلدوزی‌شده: ۸,۵۰۰,۰۰۰ تومان',
  updated_at = now()
where slug = 'nila';

-- ---------------------------------------------------------------------------
-- 2) Color choices (same price regardless of color — dropdown on the
--    product page, same pattern as the size picker).
-- ---------------------------------------------------------------------------
update products set colors = ARRAY['زرشکی','سبز','صورتی','آبی','یاسی']::text[], updated_at = now()
where slug = 'roz';

update products set colors = ARRAY['یاسی','سبز','آبی']::text[], updated_at = now()
where slug = 'samin';

update products set colors = ARRAY['مشکی','قهوه‌ای تیره','نسکافه‌ای','شیری','سبز','اجری']::text[], updated_at = now()
where slug = 'shade-raffia';

-- ---------------------------------------------------------------------------
-- 3) جاعودی دایره‌ای — price correction.
-- ---------------------------------------------------------------------------
update products set price = 1500000, updated_at = now() where slug = 'incense-holder-round';

-- ---------------------------------------------------------------------------
-- 4) گیسو — removed completely (its pricing/body was identical to دفرمه;
--    it was a duplicate listing, not a distinct product).
-- ---------------------------------------------------------------------------
delete from products where slug = 'gisoo';

-- ---------------------------------------------------------------------------
-- 5) دفرمه — merge دفرمه + دفرمه بلند into ONE product with a size picker
--    spanning every height, instead of two separate listings.
-- ---------------------------------------------------------------------------
update products set
  style = 'کنار سالنی',
  height_cm = 60,
  price = 6200000,
  description = 'نسخه‌ی شید گلدوزی‌شده: ۶۰ سانتی‌متر ۸,۷۰۰,۰۰۰ · ۸۰ سانتی‌متر ۹,۶۰۰,۰۰۰ · ۱۰۰ سانتی‌متر ۱۱,۴۸۰,۰۰۰ · ۱۳۰ سانتی‌متر ۱۵,۶۸۰,۰۰۰ تومان',
  variants = '[
    {"height": 60,  "price": 6200000},
    {"height": 80,  "price": 7100000},
    {"height": 100, "price": 8980000},
    {"height": 130, "price": 13180000}
  ]'::jsonb,
  updated_at = now()
where slug = 'deforme';

delete from products where slug = 'deforme-tall';
