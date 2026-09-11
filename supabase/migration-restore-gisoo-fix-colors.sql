-- 1) Restore گیسو as its own product (it should never have been deleted —
--    only the 60cm size needed to be removed, same pattern as اقاقیا).
insert into products (slug, name_fa, name_en, collection, subcategory, style, material, height_cm, price, price_provisional, in_stock, photo_url, photos, variants, colors, description)
values (
  'gisoo', 'گیسو', 'Gisoo', 'lamps', 'سفالی', 'کنار سالنی', 'سفال', 80, 7100000, false, true,
  'images/gisoo.jpg',
  ARRAY['images/gisoo.jpg','images/gisoo-2.jpg','images/gisoo-3.jpg']::text[],
  '[{"height": 80, "price": 7100000},{"height": 100, "price": 8980000},{"height": 130, "price": 13180000}]'::jsonb,
  '{}'::text[],
  ''
)
on conflict (slug) do update set
  style = excluded.style,
  height_cm = excluded.height_cm,
  price = excluded.price,
  photo_url = excluded.photo_url,
  photos = excluded.photos,
  variants = excluded.variants,
  updated_at = now();

-- 2) رز — add the 3rd photo (the new زرشکی-color shot) to its gallery.
update products set
  photos = ARRAY['images/roz.jpg','images/roz-2.jpg','images/roz-3.jpg']::text[],
  updated_at = now()
where slug = 'roz';

-- 3) Re-confirm colors are set correctly (safe to re-run; fixes it either
--    way whether or not the earlier attempt actually took).
update products set colors = ARRAY['زرشکی','سبز','صورتی','آبی','یاسی']::text[], updated_at = now()
where slug = 'roz';

update products set colors = ARRAY['یاسی','سبز','آبی']::text[], updated_at = now()
where slug = 'samin';

update products set colors = ARRAY['مشکی','قهوه‌ای تیره','نسکافه‌ای','شیری','سبز','اجری']::text[], updated_at = now()
where slug = 'shade-raffia';

-- 4) Verification — run this after the above and check the output.
select slug, style, colors, variants from products where slug in ('gisoo','roz','samin','shade-raffia','deforme','aghaghia-tall');
