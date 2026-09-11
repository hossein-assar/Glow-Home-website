-- Fix: اصلی-marked photo now shown first for every product, and the
-- اقاقیا رومیزی / کنار سالنی photo swap is corrected.
-- Only touches photo_url + photos — no other fields affected. Safe to re-run.

update products set photo_url = 'images/rosha.jpg', photos = ARRAY['images/rosha.jpg','images/rosha-2.jpg','images/rosha-3.jpg','images/rosha-4.jpg']::text[], updated_at = now() where slug = 'rosha';
update products set photo_url = 'images/lale.jpg', photos = ARRAY['images/lale.jpg','images/lale-2.jpg','images/lale-3.jpg']::text[], updated_at = now() where slug = 'lale';
update products set photo_url = 'images/shiari.jpg', photos = ARRAY['images/shiari.jpg','images/shiari-2.jpg','images/shiari-3.jpg']::text[], updated_at = now() where slug = 'shiari';
update products set photo_url = 'images/maha.jpg', photos = ARRAY['images/maha.jpg','images/maha-2.jpg','images/maha-3.jpg','images/maha-4.jpg']::text[], updated_at = now() where slug = 'maha';
update products set photo_url = 'images/gol-o-morgh.jpg', photos = ARRAY['images/gol-o-morgh.jpg','images/gol-o-morgh-2.jpg','images/gol-o-morgh-3.jpg']::text[], updated_at = now() where slug = 'gol-o-morgh';
update products set photo_url = 'images/deforme-desk.jpg', photos = ARRAY['images/deforme-desk.jpg','images/deforme-desk-2.jpg','images/deforme-desk-3.jpg']::text[], updated_at = now() where slug = 'deforme-desk';
update products set photo_url = 'images/delaram.jpg', photos = ARRAY['images/delaram.jpg','images/delaram-2.jpg','images/delaram-3.jpg']::text[], updated_at = now() where slug = 'delaram';
update products set photo_url = 'images/mahgol.jpg', photos = ARRAY['images/mahgol.jpg','images/mahgol-2.jpg']::text[], updated_at = now() where slug = 'mahgol';
update products set photo_url = 'images/roz.jpg', photos = ARRAY['images/roz.jpg','images/roz-2.jpg']::text[], updated_at = now() where slug = 'roz';
update products set photo_url = 'images/nila.jpg', photos = ARRAY['images/nila.jpg','images/nila-2.jpg']::text[], updated_at = now() where slug = 'nila';
update products set photo_url = 'images/rojan.jpg', photos = ARRAY['images/rojan.jpg','images/rojan-2.jpg']::text[], updated_at = now() where slug = 'rojan';
update products set photo_url = 'images/luna.jpg', photos = ARRAY['images/luna.jpg','images/luna-2.jpg']::text[], updated_at = now() where slug = 'luna';
update products set photo_url = 'images/tara.jpg', photos = ARRAY['images/tara.jpg','images/tara-2.jpg','images/tara-3.jpg']::text[], updated_at = now() where slug = 'tara';
update products set photo_url = 'images/samin.jpg', photos = ARRAY['images/samin.jpg','images/samin-2.jpg','images/samin-3.jpg']::text[], updated_at = now() where slug = 'samin';
update products set photo_url = 'images/selin.jpg', photos = ARRAY['images/selin.jpg']::text[], updated_at = now() where slug = 'selin';
update products set photo_url = 'images/ava.jpg', photos = ARRAY['images/ava.jpg','images/ava-2.jpg']::text[], updated_at = now() where slug = 'ava';
update products set photo_url = 'images/incense-holder-round.jpg', photos = ARRAY['images/incense-holder-round.jpg','images/incense-holder-round-2.jpg','images/incense-holder-round-3.jpg']::text[], updated_at = now() where slug = 'incense-holder-round';
update products set photo_url = 'images/pirex.jpg', photos = ARRAY['images/pirex.jpg','images/pirex-2.jpg']::text[], updated_at = now() where slug = 'pirex';
update products set photo_url = 'images/raha-set.jpg', photos = ARRAY['images/raha-set.jpg','images/raha-set-2.jpg','images/raha-set-3.jpg']::text[], updated_at = now() where slug = 'raha-set';
update products set photo_url = 'images/rosha-set.jpg', photos = ARRAY['images/rosha-set.jpg','images/rosha-set-2.jpg','images/rosha-set-3.jpg']::text[], updated_at = now() where slug = 'rosha-set';
update products set photo_url = 'images/abrak.jpg', photos = ARRAY['images/abrak.jpg','images/abrak-2.jpg','images/abrak-3.jpg']::text[], updated_at = now() where slug = 'abrak';
update products set photo_url = 'images/baloot.jpg', photos = ARRAY['images/baloot.jpg','images/baloot-2.jpg']::text[], updated_at = now() where slug = 'baloot';
update products set photo_url = 'images/candle-bahar.jpg', photos = ARRAY['images/candle-bahar.jpg','images/candle-bahar-2.jpg','images/candle-bahar-3.jpg','images/candle-bahar-4.jpg']::text[], updated_at = now() where slug = 'candle-bahar';
update products set photo_url = 'images/hobabi.jpg', photos = ARRAY['images/hobabi.jpg','images/hobabi-2.jpg']::text[], updated_at = now() where slug = 'hobabi';
update products set photo_url = 'images/candle-girl.jpg', photos = ARRAY['images/candle-girl.jpg','images/candle-girl-2.jpg']::text[], updated_at = now() where slug = 'candle-girl';
update products set photo_url = 'images/candle-polygon.jpg', photos = ARRAY['images/candle-polygon.jpg','images/candle-polygon-2.jpg']::text[], updated_at = now() where slug = 'candle-polygon';
update products set photo_url = 'images/candle-pumpkin.jpg', photos = ARRAY['images/candle-pumpkin.jpg','images/candle-pumpkin-2.jpg','images/candle-pumpkin-3.jpg']::text[], updated_at = now() where slug = 'candle-pumpkin';
update products set photo_url = 'images/roz-gift.jpg', photos = ARRAY['images/roz-gift.jpg','images/roz-gift-2.jpg','images/roz-gift-3.jpg']::text[], updated_at = now() where slug = 'roz-gift';
update products set photo_url = 'images/lale-taper.jpg', photos = ARRAY['images/lale-taper.jpg','images/lale-taper-2.jpg','images/lale-taper-3.jpg']::text[], updated_at = now() where slug = 'lale-taper';
update products set photo_url = 'images/shade-cylinder.jpg', photos = ARRAY['images/shade-cylinder.jpg']::text[], updated_at = now() where slug = 'shade-cylinder';
update products set photo_url = 'images/shade-raffia.jpg', photos = ARRAY['images/shade-raffia.jpg','images/shade-raffia-2.jpg']::text[], updated_at = now() where slug = 'shade-raffia';
update products set photo_url = 'images/shade-cylinder-fabric.jpg', photos = ARRAY['images/shade-cylinder-fabric.jpg']::text[], updated_at = now() where slug = 'shade-cylinder-fabric';
update products set photo_url = 'images/shade-embroidered-cylinder.jpg', photos = ARRAY['images/shade-embroidered-cylinder.jpg']::text[], updated_at = now() where slug = 'shade-embroidered-cylinder';
update products set photo_url = 'images/shade-embroidered-roz.jpg', photos = ARRAY['images/shade-embroidered-roz.jpg']::text[], updated_at = now() where slug = 'shade-embroidered-roz';
update products set photo_url = 'images/shade-embroidered-3.jpg', photos = ARRAY['images/shade-embroidered-3.jpg']::text[], updated_at = now() where slug = 'shade-embroidered-3';
update products set photo_url = 'images/aghaghia.jpg', photos = ARRAY['images/aghaghia.jpg','images/aghaghia-2.jpg','images/aghaghia-3.jpg']::text[], updated_at = now() where slug = 'aghaghia';
update products set photo_url = 'images/aghaghia-tall.jpg', photos = ARRAY['images/aghaghia-tall.jpg','images/aghaghia-tall-2.jpg','images/aghaghia-tall-3.jpg']::text[], updated_at = now() where slug = 'aghaghia-tall';
update products set photo_url = 'images/deforme-tall.jpg', photos = ARRAY['images/deforme-tall.jpg','images/deforme-tall-2.jpg','images/deforme-tall-3.jpg','images/deforme-tall-4.jpg']::text[], updated_at = now() where slug = 'deforme-tall';
update products set photo_url = 'images/gisoo.jpg', photos = ARRAY['images/gisoo.jpg','images/gisoo-2.jpg','images/gisoo-3.jpg']::text[], updated_at = now() where slug = 'gisoo';
