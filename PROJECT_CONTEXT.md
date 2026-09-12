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
- **Checkout field validation**: کد پستی and شماره موبایل are both
  validated and normalized on *both* sides — `app.js` client-side, mirrored
  by hand in `api/orders.js` server-side (never trusts the client's own
  normalization, same reasoning as the pricing re-fetch above). کد پستی:
  exactly 10 digits; Persian/Arabic-Indic numerals (۰-۹ / ٠-٩) are silently
  converted to Latin before validating and storing
  (`isValidPostcode`/`normalizePostcode`). شماره موبایل: real Iranian
  mobile format — accepts `+98`/`0098`/`98`/`0` prefixes, requires a
  9-prefixed 10-digit subscriber number, normalized to the canonical stored
  form `09XXXXXXXXX` (`isValidIranPhone`/`normalizeIranPhone`). Unlike
  postcode, phone numbers do **not** get Persian/Arabic digits silently
  converted: `containsPersianOrArabicDigits()` rejects them up front with a
  message asking for English digits instead, because the phone input
  doubles as the canonical stored value — see the gotcha below, this
  inconsistency with postcode is deliberate. Applied consistently across
  checkout, the contact form, and `/track`, though the contact form and
  `/track` keep their own looser length-based format check beyond the
  digit-rejection (contact may legitimately be a landline; `/track` only
  needs to match an already-valid stored phone).
- **Shipping method**: determined entirely by شهر, not chosen freely by the
  customer — تهران gets پیک تهران only, anywhere else (non-empty) gets
  تیپاکس only (`shippingMethodForCity()` in `app.js`, mirrored in
  `api/orders.js`; `normalizePersianText()` handles whitespace/half-space
  and Arabic-vs-Persian ی/ک variants so close spellings still match). Only
  these two methods exist — پست پیشتاز was retired from both `data.js`'s
  and `api/orders.js`'s `SHIPPING` once this rule made it permanently
  unreachable (no city could ever select it). The checkout UI disables
  (doesn't hide) the ineligible option with a reason, and reacts live to
  شهر edits. `api/orders.js` derives the shipping method solely from the
  validated city — it never trusts the client's own `shipping_method`
  choice, same "don't trust the client" pattern as pricing/stock.
- **Order notifications**: `/api/orders.js` emails the shop on every new
  order via Resend's API (plain `fetch()`, no SDK). Needs `RESEND_API_KEY`
  and `ORDER_NOTIFY_EMAIL` set in Vercel's environment variables — never in
  code. If either is missing, the notification step silently no-ops rather
  than breaking checkout; a failed send (bad key, Resend outage, etc.) is
  caught and logged with `console.error` but never surfaces to the customer.
- **Order tracking**: `/track` + `/api/track-order.js`. Requires BOTH the
  order code and the phone used at checkout to match — order codes are
  sequential and easily guessable, so code alone must never be enough;
  a mismatch on either one returns the identical generic error so it can't
  be used to probe which half was wrong. Returns order contents + status
  only, never the customer's name/phone/address. The code field only asks
  the customer for the part after "GH-" — `buildOrderCode()` in `app.js`
  reconstructs the full canonical form client-side (case-insensitive,
  handles a pasted "GH-"/"gh-" prefix, even doubled-up, gracefully).
  Letters are deliberately still accepted there, not just digits: rare as
  it is, `api/orders.js` has a base-36 fallback order-code path (letters
  included) for when its DB sequence RPC fails, and a customer with one of
  those still needs to be able to look it up.
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
- **Persian/Arabic-digit handling is inconsistent on purpose**: کد پستی
  silently converts Persian/Arabic-Indic numerals (۰-۹ / ٠-٩) to Latin
  before validating (`toLatinDigits()`); شماره موبایل fields do the
  opposite on purpose — `containsPersianOrArabicDigits()` rejects them with
  a message asking for English digits, rather than converting. Don't
  "clean this up" into one consistent behavior later without realizing it
  was a deliberate choice: phone input doubles as the canonical stored
  value (`09XXXXXXXXX`), so a silent conversion there is one more place a
  subtle bug could creep into what actually gets saved, whereas postcode's
  conversion is low-risk since it's just digits either way.

## Not yet built

- **Payment gateway** — no ZarinPal/Snapp Pay integration. Checkout creates
  a real, correctly-priced order but collects no money. The homepage copy
  currently promises Snapp Pay installments — that's aspirational, not real,
  as of this writing.
- **Customer accounts** — guest checkout only, no login, no order history
  for customers.
