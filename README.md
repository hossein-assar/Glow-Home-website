# Glow Home — front-end prototype

Static site. One responsive page that serves desktop and phone from the same
code. No build step, no dependencies, no backend.

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
index.html    page shell — rarely needs touching
data.js       catalog, prices, shipping, discount codes, all site copy
app.js        screens and behaviour
styles.css    design tokens and components
images/       product photos, named after product ids (see images/README.txt)
fonts/        Farhang + IRANSansX + Marcellus, self-hosted
```

**`data.js` is the only file you need for day-to-day changes.** Prices, stock,
copy and new products all live there, and both layouts read from it, so there
is nothing to keep in sync.

## What works, and what is only pretending

Real: the cart, quantities, discount codes, shipping and free-shipping maths,
form validation, the order summary, search, filtering and sorting.

Faked: nothing is sent, charged or stored anywhere. Placing an order makes up
an order code and clears the cart. The OTP accepts any four digits. Order
tracking returns the same message for any code. The contact form goes nowhere.

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

## Before this can take real orders

1. **Confirm the seven photo matches above**, then finish photographing the
   remaining 15 pieces. See `images/README.txt` for the naming.
2. **Real prices.** Everything in `PRICE` is a placeholder. Replace the block,
   then set `PRICES_ARE_PROVISIONAL = false` to drop the «موقت» flags and the
   warning bar.
3. **Copy review.** Product descriptions, the about story and the FAQ answers
   in `data.js` are drafts written from the catalog specs, not the studio's own
   words.
4. **A backend.** Payment gateway, inventory and order storage. Nothing here
   presumes a particular platform.

## Demo values

- Discount codes: `GLOW10` (۱۰٪), `HANDMADE15` (۱۵٪)
- Free shipping over ۳٬۰۰۰٬۰۰۰ تومان
- Shipping: پست پیشتاز ۶۵٬۰۰۰ · پیک تهران ۹۰٬۰۰۰ · تیپاکس پس‌کرایه
- Out of stock: حبابی، پیرکس U — their button routes to تماس with the piece
  name filled into the message

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

Two entries in `data.js`, plus the photo:

```js
// in PRICE
bahar: 2400000,

// in PRODUCTS
{
  id: 'bahar', fa: 'بهار', en: 'Bahar', col: 'lamps',
  height: 45, material: 'clay',
  desc: 'یک یا دو جمله درباره‌ی این قطعه.',
},
```

Then save `images/bahar.png`. It appears in the shop, its collection, search
and the related-products strip automatically. If you forget the price the
console warns you and the piece shows as ۰ تومان rather than breaking.
