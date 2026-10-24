# Glow Home

Online shop for the Glow Home studio, live at <https://glow-home.ir>. One
responsive page serves desktop and phone from the same code, with no build
step. Behind it: Supabase (products, orders, admin login), Vercel functions in
`api/` (orders, contact form, order tracking), and `payment-server/` for
ZarinPal online payment.

## Deploy

Drag this folder onto <https://vercel.com/new>, or:

```
npm i -g vercel
cd glow-home
vercel          # preview URL
vercel --prod   # production URL
```

Then open the URL on a laptop and on a phone — it is the same page, laid out
for the screen it is on. There is no separate `/mobile` address any more.

## Files

```
index.html      page shell — rarely needs touching
data.js         site copy, shipping, discount codes, fallback catalog
app.js          screens and behaviour
styles.css      design tokens and components
admin/          admin panel (products, prices, photos, orders)
api/            Vercel functions: orders, contact, track-order, pay-callback
payment-server/ ZarinPal payment server (runs on the Iranian VPS) + all tests
supabase/       schema and migrations, run by hand in the SQL Editor
images/         site images and fallback product photos (see images/README.txt)
fonts/          Farhang + IRANSansX + Marcellus, self-hosted
```

**Products, prices, stock and photos are edited in the admin panel**
(`/admin`), which writes to Supabase. The storefront shows the catalog in
`data.js` first and swaps in the live one as soon as it loads, so `data.js`
is only a fallback for products. Site copy, shipping and discount codes do
live in `data.js`.

## What it does

Checkout is guest-only: name, mobile, city, address, then pay. There is no
customer login or account. Orders are priced on the server from the database
(never from the browser) and stored in Supabase: online payment goes through
ZarinPal (`payment-server/`), «کارت به کارت» orders through `/api/orders`.
Order tracking (`/api/track-order`) needs both the order code and the mobile
used at checkout. The contact form sends an email to the studio through
`/api/contact`.

The cart is kept in the browser's own storage, so it survives a refresh on that
device. It is not an account.

## Photo status

22 of 30 products now have a photo. 30, not 22, because eight products
turned up with real Farsi filenames that don't match the original 22-item
list — they're in the catalog now with a real name and photo, but
unconfirmed height, material or price. Their height shows as «نامشخص»
rather than a guessed number. Four more photos are still unconfirmed
matches (orange "?" badge). Full status, and three corrections made to
photos I'd previously guessed wrong, are in `images/README.txt` — read it
before assuming any product's photo is right.

## Logo

The header mark and footer lockup come from the studio's logo, split into
three files: `images/logo-mark.png` (ink, for the light header),
`images/logo-mark-light.png` (cream, if the header background is ever
darkened), and `images/logo-full-light.png` (the complete lockup with
wordmark, used in the footer). All three are transparent PNGs recoloured
from the studio's original artwork — keep them as PNG, not jpg.

## Prices

Real prices are set per product in the admin panel; the server always
re-prices an order from the database. «موقت» flags are per product (the
admin panel's «قیمت موقت» checkbox). `PRICE` and `PRICES_ARE_PROVISIONAL` in
`data.js` only feed the fallback catalog shown before the live one loads.

## Checkout rules

- Discount codes: none for now. `DISCOUNT_CODES` is hand-copied in `data.js`,
  `api/orders.js` and `payment-server/src/pricing.js`; to add a code, add it
  to all three (`npm test` in `payment-server/` fails if they differ).
- Shipping is set by the city: پیک تهران for Tehran, تیپاکس elsewhere. Both
  are پس‌کرایه — the customer pays the courier on delivery, so shipping is
  never part of the charged total.
- Payment: درگاه پرداخت آنلاین (ZarinPal) or کارت به کارت.
- Out-of-stock products (set in the admin panel): their button routes to
  تماس with the piece name filled into the message.

## Fonts

| Role | Face | Weights shipped |
|---|---|---|
| Headings | **Farhang 2** | 500 (Medium) |
| Body and UI | **IRANSansX** | 400, 500, 700, 900 |
| Latin wordmark and product names | Marcellus (SIL OFL) | 400 |

Headings use Farhang Medium (500) throughout, not Bold or Black — at large sizes
the heavy Naskh weights read as a newspaper masthead. Only that one weight is
shipped, so a heading given `font-weight: 700` will render as a synthesised
fake bold; add the real weight from your Fontiran download instead.

Farhang and IRANSansX are commercial Fontiran faces, licensed by the studio.
Only the weights the site actually uses are included — not the full families —
which keeps the whole font folder at about 225 KB. All three are self-hosted
from `fonts/`, so nothing is fetched from Google or any other third party at
runtime, and the site does not depend on a CDN being reachable from Iran.

**One outstanding task.** `fonts/LICENSE-Farhang.txt` contains a blank field:

```
This set of fonts are used in this project under the license: (.....)
```

Fontiran asks you to write your licence code into that gap and keep the file
next to the fonts. Do the same for IRANSansX. It takes a minute and it is the
documentation you would want if anyone ever asks.

Swapping either face is one line in `styles.css`:

```css
--font-display: 'Farhang', Georgia, serif;        /* headings */
--font-body: 'IRANSansX', system-ui, sans-serif;  /* body + UI */
--font-latin: 'Marcellus', Georgia, serif;        /* wordmark, Latin names */
```

If you add a weight to the design, add the matching `@font-face` block and copy
that weight's woff2 in from your Fontiran download — the packages ship nine to
eleven weights each, so everything is already available to you.

## Adding a product

Add it in the admin panel (`/admin`): name, slug, collection, price (and
sizes / shade prices if it has them), then upload its photo there. It
appears in the shop, its collection, search and the related-products strip
as soon as it is saved. `data.js` does not need to change.
