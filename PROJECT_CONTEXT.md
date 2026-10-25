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
  (`isValidPostcode`/`normalizePostcode`). شماره موبایل: the checkout
  field shows a fixed "+98" prefix in the UI — the customer only ever
  types the bare 10-digit subscriber number, which gets reconstructed to
  `+98XXXXXXXXXX` before validating/sending
  (`isValidIranPhone`/`iranPhoneSubscriberPart`, simplified accordingly —
  no longer needs to guess between the old `+98`/`0098`/`98`/`0`-prefixed
  or bare shapes). The canonical **stored** format is unchanged,
  `09XXXXXXXXX` (`normalizeIranPhone`), specifically so existing orders,
  the admin panel, and `/track` matching all keep working with no changes
  on their end. One consequence: `api/orders.js`'s public validation
  surface narrowed along with it — it no longer accepts the old
  `0098…`/bare-`98…`/leading-`0` phone shapes directly. That only matters
  to something calling `/api/orders` outside the browser (curl/devtools);
  the real checkout flow only ever sends the new `+98` form, so no actual
  customer is affected. Unlike postcode, phone numbers do **not** get Persian/Arabic digits silently
  converted: `containsPersianOrArabicDigits()` rejects them up front with a
  message asking for English digits instead, because the phone input
  doubles as the canonical stored value — see the gotcha below, this
  inconsistency with postcode is deliberate. Applied consistently across
  checkout, the contact form, and `/track`. The contact form requires an
  Iranian mobile (any common shape, normalized to `09XXXXXXXXX` by
  `contactMobile()` in app.js / `normalizeMobile()` in `api/contact.js`);
  `/track` keeps its own looser length-based check beyond the
  digit-rejection (it only needs to match an already-valid stored phone).
- **Checkout errors are inline, per-field, and live**: نام, شماره موبایل,
  شهر, نشانی and کد پستی each show their own error message directly under
  that field (`.field-error`, a true red — `--color-red-700` — chosen
  deliberately distinct from the site's existing warm `--color-accent-800`
  "error" tone that `.alert-error` uses elsewhere), not one shared box.
  Validated live on blur (`focusout`, not `change` — `change` alone misses
  a field left empty and never edited) via `FIELD_VALIDATORS` in `app.js`,
  and re-checked in full on submit so nothing skips validation just by
  never being blurred. The shared `state.error`/`.alert-error` box still
  exists for everything that isn't a single field's problem — empty cart,
  network/server failures. Checkout is guest-only: no login or OTP step.
- **Shipping method**: determined entirely by شهر, not chosen freely by the
  customer — تهران gets پیک تهران only, anywhere else (non-empty) gets
  تیپاکس only (`shippingMethodForCity()` in `app.js`, mirrored in
  `api/orders.js`; `normalizePersianText()` handles whitespace/half-space
  and Arabic-vs-Persian ی/ک variants so close spellings still match). شهر
  itself is a تهران / شهرستان dropdown, not free text — picking شهرستان
  reveals a free-text city-name field, and that typed value is what
  actually feeds `shippingMethodForCity()`. Only these two methods exist —
  پست پیشتاز was retired from both `data.js`'s and `api/orders.js`'s
  `SHIPPING` once this rule made it permanently unreachable (no city could
  ever select it). The checkout UI disables (doesn't hide) the ineligible
  option with a reason, and reacts live to شهر edits. `api/orders.js`
  derives the shipping method solely from the validated city — it never
  trusts the client's own `shipping_method` choice, same "don't trust the
  client" pattern as pricing/stock. Both پیک تهران and تیپاکس are
  `payAtDoor` now — the courier/carrier collects in cash, so neither cost
  is added to the site's charged `total` (and `payAtDoor` alone already
  excludes a method from the `FREE_SHIP_OVER` discount too — there used to
  be a separate `neverFree` flag for پیک specifically, but it became dead
  weight once پیک also became `payAtDoor` and was removed). Customer-facing
  copy deliberately no longer states پیک's ۹۰,۰۰۰ تومان fee anywhere
  (checkout's order-summary hint, the cart page's equivalent, and the
  shipping option's own note in `data.js` all now read generically, the
  same as تیپاکس's phrasing always has) — but the real, known fee is still
  stored server-side: `api/orders.js` writes `method.cost` (not the
  charged amount) into `shipping_cost`, so it isn't lost from the database,
  and the admin panel still surfaces it per-order and in the sales-summary
  COD note (see below).
- **Snapp Pay installment banner**: a blue banner at the very top of
  checkout (above ورود) — static "برای خرید اقساطی با اسنپ‌پی..." prompt
  plus a بیشتر/بستن toggle button (`state.snappPayOpen`, same accordion
  pattern as the FAQ page's `state.faqOpen`) that expands an inline
  7-step purchase-flow card (`SNAPP_PAY_STEPS` in `app.js`, exact business-
  provided copy — don't reword), pushing the rest of the page down rather
  than overlaying it. Built as real HTML/CSS blue "step pill" rows, not an
  embedded image. Ends with `images/snapp-pay-logo.png` again, larger.
  This replaced an earlier version of the banner that asked customers to
  screenshot their cart and message a WhatsApp number — that flow and its
  icon/CSS (`whatsappIcon()`, `.whatsapp-number`) are gone entirely now.
- **Order notifications**: `/api/orders.js` emails the shop on every new
  order via Resend's API (plain `fetch()`, no SDK). Needs `RESEND_API_KEY`
  and `ORDER_NOTIFY_EMAIL` set in Vercel's environment variables — never in
  code. If either is missing, the notification step silently no-ops rather
  than breaking checkout; a failed send (bad key, Resend outage, etc.) is
  caught and logged with `console.error` but never surfaces to the customer.
- **Contact form**: `/api/contact.js` emails the shop through the same
  Resend call, env vars, sender and recipient (`ORDER_NOTIFY_EMAIL`), subject
  «پیام جدید از فرم تماس». Unlike the order email, a missing key or failed
  send returns a generic error to the page (the email is the whole job, so
  it must not pretend to succeed). Origin must be exactly
  `https://glow-home.ir` (www redirects there; Vercel preview URLs are
  refused), hidden honeypot field `website`, per-IP rate limit (in memory,
  per warm instance — a brake, not a guarantee), every value HTML-escaped.
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
  edits, use the panel. Both the products table and the orders list have a
  live client-side search box (`admin/admin.js`) filtering the already-
  loaded list in memory — no extra Supabase query per keystroke. Products
  match against name_fa/name_en/slug/category; orders match against
  code/customer_name/phone/city. The sales-summary stats above the orders
  list always reflect *all* orders regardless of the search box — they run
  their own separate, unfiltered query and never read the search term.

## Catalog data model (products table)

- `collection`: lamps | shades | candles | decor (the 4 top-level nav items)
- `subcategory`: material-based grouping *within* a collection (سفالی,
  پلی‌استر, چوبی for lamps; ساده/گلدوزی for shades; شاتی/قلمی for candles)
- `style`: placement-based, lamps only — رومیزی (desk) vs کنار سالنی
  (sofa-side/floor). A second, independent filter row from subcategory.
- `variants`: `[{height, price}]` jsonb — powers the size-picker dropdown on
  the product page. A product with 0-1 sizes shows no dropdown.
  **The base size is a size.** Older rows store only the *other* sizes here
  (schema.sql's comment still says so), so `withBaseSize()` — one function,
  copied in app.js, admin/admin.js, api/orders.js and payment-server — adds
  `height_cm` + `price` as the first size whenever the list is non-empty and
  no entry has that height. «شید گلدوزی مهتاب» (base 40, variants [50]) is
  two sizes because of it. Shade-type products are exempt: their sizes are
  exactly what is stored. The admin's «ویرایش کامل» shows the base size as a
  read-only first row that follows «ارتفاع پایه» and the price box, and saves
  the complete list; the quick «ذخیره» moves a stored base row's price with
  the price box, so the two never disagree.
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

A product whose `variants` entries carry a `shades` map (گیسو: plain /
embroidered, دفرمه: plain / macrame — see `supabase/migration-*-shades.sql`)
is also priced by shade type:
`{"height":140,"price":<plain>,"shades":{"plain":…,"embroidered":…}}`, cart
key `gisoo::h140::splain` / `::sembroidered`. A size accepts only the keys in
its own `shades` map; labels are `SHADE_TYPES`, copied in app.js,
admin/admin.js, api/orders.js and payment-server. Such a product is priced
strictly on both servers — a key without a stored height + shade (e.g. an
old `gisoo::h100`) is rejected, not guessed; the storefront drops those
stale lines from the cart once the live catalog loads.

Sizes are strict the same way for every product: a key naming a height must
name one of `withBaseSize()`'s sizes, or both servers reject it (it used to
be priced at the base price, whatever the height). A key with no height is
the base size. The storefront drops any cart line it can't price —
`cartLineData()` returns null — when the catalog loads.

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
- **Phone autofill vs. the fixed +98 field**: some browsers autofill an
  Iranian phone number in the old national format (leading `0`,
  `09121234567`) — since the checkout phone field now only accepts the
  bare 10-digit subscriber number (no leading `0`), an autofilled value
  can show as invalid until the customer deletes the leading `0` by hand.
  `autocomplete="tel-national"` is set as a partial mitigation (asks the
  browser to fill just the national significant number), but this isn't
  guaranteed across all browsers/autofill sources. Worth revisiting if
  real complaints come in — not something to "fix" reactively without
  first checking whether it's actually causing trouble.
- **Some copy strings intentionally contain raw HTML — don't esc() them**:
  `heroBody`, every `faq[].a` entry, `COLLECTIONS.decor.blurb`, and
  `contactHours` in `data.js` deliberately embed `<b>`/`<br>` for inline
  bold/line-breaks. Their render call sites in `app.js` interpolate these
  raw (`${COPY.heroBody}`, not `${esc(COPY.heroBody)}`) so the tags work
  as real markup instead of showing as literal text. `contactHours` was
  fixed to match this pattern (2026-09) — it used to go through `esc()`
  at both its call sites, so a `<br>` there would have rendered as visible
  "<br>" text. If you add a new render call site for any of these fields,
  or a new field that needs inline HTML, keep using raw interpolation —
  everything else in the codebase should still go through `esc()` as
  normal; this is a small, deliberate exception, not a new default.

## Not yet built

- **Payment gateway** — no ZarinPal/Snapp Pay *API* integration. Checkout
  itself still creates a real, correctly-priced order but collects no money
  automatically. Snapp Pay installments are no longer purely aspirational
  copy, though: checkout's banner (see above) now walks the customer
  through a real, if manual/human-in-the-loop, purchase flow (direct
  message to the shop, admin sends a payment link outside this codebase).
  There's still no automated gateway callback/webhook here — "not built"
  refers to that integration, not to the installment option existing at all.
- **Customer accounts** — guest checkout only, no login, no order history
  for customers.
