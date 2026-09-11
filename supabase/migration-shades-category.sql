-- Move the standalone lampshade products out of "آباژور" and into their own
-- top-level "شید" category (previously they were lamps/subcategory).
-- Safe to re-run.

update products set collection = 'shades', subcategory = 'ساده'
where slug in ('shade-cylinder', 'shade-raffia', 'shade-cylinder-fabric');

update products set collection = 'shades', subcategory = 'گلدوزی'
where slug in ('shade-embroidered-cylinder', 'shade-embroidered-roz', 'shade-embroidered-3');

-- Also rename the old "دکور منزل" label if any rows still reference the old
-- collection value under a different name — not needed here since the
-- 'decor' key itself didn't change, only its display label (in the code).
