# Glow Home — project context for a fresh session

Farsi (RTL) storefront for a small handmade home-decor studio (pottery lamps,
candles, decor). Static front-end + real Supabase backend, deployed on
Vercel. This file exists so a new session doesn't have to reverse-engineer
decisions from code alone — read this before making structural changes.

## Stack

- **Front end**: plain HTML/CSS/JS, no framework, no build step. `index.html`
  loads `data.js` (fallback catalog + copy) then `app.js` (all screens/logic)
  then fetches the real catalog from Supabase and re-renders.
- **Backend**: Supabase (Postgres + RLS). Schema/history lives entirely in
  `supabase/*.sql` — these are NOT auto-applied; each one had to be run by
  hand in the Supabase SQL Editor, in the order they were created. There is
  no migration tool tracking what's already run — check the live schema via
  the Supabase dashboard if unsure whether one landed.
- **Order creation**: `/api/orders.js`, a Vercel serverless function using
  `@supabase/supabase-js` with the **service role** key (`SUPABASE_SERVICE_ROLE_KEY`
  env var in Vercel, never in code). This is deliberate: the browser only
  sends *which* products and *how many* — the function re-fetches real
  prices/stock from the DB itself, so nobody can tamper with pricing from
  devtools. Never let the browser write directly to `orders`/`order_items`.
- **Admin panel**: `/admin/` — plain Supabase-auth login, `is_admin` flag on
  `profiles`. Can edit every product field (price, stock, subcategory, style,
  variants, colors) and view/update order status. This is the only place
  product data is edited now — don't hand-write SQL for routine catalog
  edits, use the panel.

## Catalog data model (products table)

- `collection`: lamps | shades | candles | decor (the 4 top-level nav items)
- `subcategory`: material-based grouping *within* a collection (سفالی,
  پلی‌استر, چوبی for lamps; ساده/گلدوزی for shades; شاتی/قلمی for candles)
- `style`: placement-based, lamps only — رومیزی (desk) vs کنار سالنی
  (sofa-side/floor). A second, independent filter row from subcategory.
- `variants`: `[{height, price}]` jsonb — powers the size-picker dropdown on
  the product page. A product with 0-1 variants shows no dropdown.
- `colors`: `text[]` — powers the color-picker dropdown. Same price
  regardless of color (no per-color pricing exists).
- `photos`: ordered array, first element is always the "اصلی" (primary/hero)
  shot — when processing new product photos from a zip, a file with اصلی in
  its name goes first, everything else keeps its given order after it.

### Why some products are split and others are merged

اقاقیا is **two separate product rows** (اقاقیا رومیزی / اقاقیا کنار سالنی)
with entirely different photos — the business wanted these marketed as
visually distinct products, not size options of one listing. دفرمه and گیسو
are the opposite: **one product row each** with a `variants` array covering
their full size range (60→130cm), because they're the same design just
offered in different sizes, no separate marketing needed. If asked to
restructure a product family, ask which pattern applies rather than
assuming — it's been gotten wrong more than once in this project's history.

### Cart key format (front-end, app.js)

Cart lines are keyed by `slug`, or `slug::h<height>` and/or `slug::c<colorIndex>`
when the product has variants/colors selected (see `parseCartKey`/`cartKeyFor`
in app.js). This lets two sizes/colors of the same product sit as distinct,
correctly-priced cart lines. `/api/orders.js` re-parses this same key format
server-side to resolve authoritative prices — if you change this format,
update both sides.

## Known gotchas (already fixed, don't reintroduce)

- **Image caching**: `vercel.json` sets images to `no-store`-equivalent
  (`max-age=0, must-revalidate`), matching html/js/css. It used to be a
  24-hour cache and caused repeated "I updated the photo and it's not
  showing" confusion. Don't re-add long-lived image caching without a
  cache-busting filename strategy.
- **Category banners**: `screenCollection()` in app.js renders every banner
  photo via a blur-fill technique (`.banner-photo-bg` blurred/cropped behind,
  `.banner-photo-fg` sharp/`contain` on top) rather than a plain
  `object-fit: cover`, because every product photo in the catalog is
  portrait-oriented and cropped badly at the banner's ~3:1 aspect ratio.
  آباژور's banner uses a dedicated wide lifestyle photo
  (`images/banner-lamps.jpg`) through the same mechanism. If you get a real
  wide "lineup" photo for another category, wire it the same way via
  `COLLECTIONS.<key>.bannerImg` in data.js.

## Not yet built

- **Payment gateway** — no ZarinPal/Snapp Pay integration. Checkout creates
  a real, correctly-priced order but collects no money. The homepage copy
  currently promises Snapp Pay installments — that's aspirational, not real,
  as of this writing.
- **Customer accounts** — guest checkout only, no login, no order history
  for customers.
- **Order tracking page** — a "پیگیری سفارش" link exists in the footer nav;
  whether it actually looks up a real order by code was never verified.
