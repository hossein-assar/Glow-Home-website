// گیسو in the storefront (app.js, a browser script): every way of adding it
// to the cart must produce a key the cart can price — never a line that
// loadProductsFromSupabase() would later drop. Runs the real app.js
// functions, pulled out of the source text, against a stub catalog.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../../app.js', import.meta.url), 'utf8');
const grab = (re) => {
  const m = src.match(re);
  assert.ok(m, 'not found in app.js: ' + re);
  return m[0];
};
const fnSrc = (name) => grab(new RegExp(`function ${name}\\([\\s\\S]*?\\n}\\n`));

const gisoo = {
  id: 'gisoo',
  height: 100,
  heightFa: '۱۰۰ سانتی‌متر',
  materialFa: 'سفال',
  price: 9100000,
  colors: [],
  variants: [
    { height: 140, price: 12980000, shades: { plain: 12980000, embroidered: 15450000 } },
    { height: 120, price: 9980000, shades: { plain: 9980000, embroidered: 12480000 } },
    { height: 100, price: 9100000, shades: { plain: 9100000, embroidered: 11600000 } },
  ],
};
const lale = { id: 'lale', height: 40, heightFa: '۴۰', materialFa: 'سفال', price: 6500000, colors: [], variants: [] };

function storefront(catalog) {
  const code = [
    fnSrc('parseCartKey'),
    grab(/const SHADE_TYPES = [^\n]*\n/),
    fnSrc('hasShadeTypes'),
    fnSrc('shadeOption'),
    fnSrc('cartLineData'),
    fnSrc('cartKeyFor'),
    fnSrc('cardCartKey'),
    fnSrc('addToCart'),
    'return { cartKeyFor, cardCartKey, cartLineData, addToCart };',
  ].join('\n');
  const state = { cart: {} };
  const byId = (id) => catalog.find((p) => p.id === id);
  const fns = new Function('state', 'byId', 'FA', 'money', 'saveStore', code)(state, byId, String, (n) => 'M' + n, () => {});
  return { ...fns, state };
}

test('a gisoo product card adds the base height with the plain shade', () => {
  const sf = storefront([gisoo, lale]);
  assert.equal(sf.cardCartKey(gisoo), 'gisoo::h100::splain');
  assert.equal(sf.addToCart(sf.cardCartKey(gisoo)), true);
  assert.deepEqual(sf.state.cart, { 'gisoo::h100::splain': 1 });
  assert.equal(sf.cartLineData('gisoo::h100::splain').price, 9100000);
});

test('if gisoo\'s base height is not a stored size, the card opens the product page instead', () => {
  const sf = storefront([{ ...gisoo, height: 80 }]);
  assert.equal(sf.cardCartKey({ ...gisoo, height: 80 }), null);
});

test('addToCart refuses any gisoo key the cart cannot price', () => {
  const sf = storefront([gisoo, lale]);
  for (const key of ['gisoo', 'gisoo::h100', 'gisoo::h80::splain', 'gisoo::h100::sgold', 'gisoo::h130']) {
    assert.equal(sf.addToCart(key), false, key);
  }
  assert.deepEqual(sf.state.cart, {});
  assert.equal(sf.addToCart('gisoo::h140::sembroidered', 2), true);
  assert.deepEqual(sf.state.cart, { 'gisoo::h140::sembroidered': 2 });
});

test('other products are added exactly as before', () => {
  const sf = storefront([gisoo, lale]);
  assert.equal(sf.cardCartKey(lale), 'lale');
  assert.equal(sf.addToCart('lale'), true);
  assert.equal(sf.addToCart('unknown-slug'), true); // unchanged: no guard for products without shade types
  assert.deepEqual(sf.state.cart, { lale: 1, 'unknown-slug': 1 });
});

test('no add path bypasses the guard', () => {
  // The only writes to state.cart are addToCart, setQty (existing lines),
  // the post-order reset and the stale-line cleanup.
  const writes = [...src.matchAll(/state\.cart\[[^\]]+\]\s*=(?!=)/g)].length;
  assert.equal(writes, 2, 'expected only addToCart and setQty to assign state.cart[...]');
  // Every addToCart call checks the result.
  const calls = [...src.matchAll(/addToCart\(/g)].length - 1; // minus the definition
  const guarded = [...src.matchAll(/if \(!addToCart\(/g)].length;
  assert.equal(guarded, calls, 'an addToCart() call ignores its result');
  // Cards are the only add button outside the product page, and they use cardCartKey.
  assert.equal([...src.matchAll(/data-act="\$\{act\}"/g)].length, 1);
  assert.match(fnSrc('card'), /const cartKey = cardCartKey\(p\);/);
  // The product page builds its key from the chosen height and shade.
  assert.match(src, /cartKeyFor\(p, effectiveHeight, effectiveColorIndex, effectiveShade\)/);
});
