// Product photos in the storefront (app.js) must work both as old relative
// paths (images/x.jpg) and as full https:// URLs from the admin's Supabase
// Storage upload — the latter shown through our /sb proxy, since supabase.co
// is blocked in Iran. Runs the real app.js functions that turn a photo into
// an <img src>: the photo choice in buildItems, media() (cards, search
// results, collection pages, related products, cart), gallery() and the
// lightbox, with proxiedPhotoUrl from supabase-config.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../../app.js', import.meta.url), 'utf8');
const grab = (re) => {
  const m = src.match(re);
  assert.ok(m, 'not found in app.js: ' + re);
  return m[0];
};

const UPLOADED = 'https://sgfoesnpodvwyzlxfhtq.supabase.co/storage/v1/object/public/product-images/gisoo-1730000000000.jpg';
const PROXIED = 'https://glow-home.ir/sb/storage/v1/object/public/product-images/gisoo-1730000000000.jpg';
const OLD = 'images/gisoo.jpg';

// The same expression buildItems() uses to pick a product's photos.
const photoChoice = grab(/const photos = \(p\.photos && p\.photos\.length \? p\.photos : \[p\.photo_url \|\| 'images\/' \+ p\.id \+ '\.jpg'\]\)\.map\(\s*proxiedPhotoUrl\s*\);/);
const configJs = readFileSync(new URL('../../supabase-config.js', import.meta.url), 'utf8');
const pickPhotos = new Function('location', 'window', configJs + '\nreturn (p) => { ' + photoChoice + ' return photos; };')(
  { origin: 'https://glow-home.ir' },
  {}
);

const state = { lightbox: null };
const { media, gallery, renderLightbox } = new Function(
  'state', 'byId', 'FA', 'icon',
  [grab(/const esc = \(s\) =>[\s\S]*?;\n/), grab(/function media\([\s\S]*?\n}\n/), grab(/function gallery\([\s\S]*?\n}\n/), grab(/function renderLightbox\([\s\S]*?\n}\n/)].join('\n') +
    'return { media, gallery, renderLightbox };'
)(state, (id) => product(id), String, () => '');

let current;
const product = () => current;
const item = (photos, photo_url = null) => {
  const ps = pickPhotos({ id: 'gisoo', photos, photo_url });
  return { id: 'gisoo', fa: 'گیسو', en: 'Gisoo', col: 'lamps', img: ps[0], photos: ps };
};
const srcs = (html) => [...html.matchAll(/<img[^>]*\ssrc="([^"]*)"/g)].map((m) => m[1]);

for (const [kind, stored, url] of [
  ['supabase.co URL', UPLOADED, PROXIED],
  ['/sb URL', PROXIED, PROXIED],
  ['old relative path', OLD, OLD],
]) {
  test(`photo as ${kind}: shown as ${url === OLD ? 'is' : 'the /sb URL'} everywhere`, () => {
    // photos[0] and photo_url both work as the source
    assert.deepEqual(pickPhotos({ id: 'gisoo', photos: [stored, 'images/gisoo-2.jpg'], photo_url: 'x' }), [url, 'images/gisoo-2.jpg']);
    assert.deepEqual(pickPhotos({ id: 'gisoo', photos: null, photo_url: stored }), [url]);

    current = item([stored, 'images/gisoo-2.jpg']);
    assert.deepEqual(srcs(media(current)), [url]); // cards, search, collection, related, cart
    assert.deepEqual(srcs(gallery(current)), [url, url, 'images/gisoo-2.jpg']); // cover + thumbnails
    state.lightbox = { id: 'gisoo', index: 0 };
    const lb = srcs(renderLightbox());
    assert.equal(lb[0], url); // big photo
    assert.ok(lb.includes(url) && lb.includes('images/gisoo-2.jpg')); // thumbnail strip
    state.lightbox = null;
  });
}

test('the fallback path is only built when there is no photo at all', () => {
  assert.deepEqual(pickPhotos({ id: 'gisoo', photos: null, photo_url: null }), ['images/gisoo.jpg']);
  assert.deepEqual(pickPhotos({ id: 'gisoo', photos: [], photo_url: UPLOADED }), [PROXIED]);
});

test('app.js only rewrites photo paths through proxiedPhotoUrl', () => {
  assert.doesNotMatch(src, /startsWith\(['"]images/);
  assert.doesNotMatch(src, /['"]\/['"] \+ (p\.)?(img|photo)/);
  assert.doesNotMatch(src, /location\.origin \+/);
  // a URL with a query string survives escaping (the browser decodes &amp;)
  current = item([UPLOADED + '?v=1&w=2']);
  assert.deepEqual(srcs(media(current)), [PROXIED + '?v=1&amp;w=2']);
});
