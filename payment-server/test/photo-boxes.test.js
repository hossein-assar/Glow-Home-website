// The home hero and the آباژور banner show their photo whole: a rounded box
// shaped exactly like the photo (aspect-ratio from its width/height), with
// no object-fit: cover and no blurred layer. The other categories keep the
// blur-fill for their portrait photos. Source checks, plus the real sizes
// of the JPEG files, so the width/height in the code can't drift from them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const appJs = read('../../app.js');
const css = read('../../styles.css');
const { COLLECTIONS } = new Function(read('../../data.js') + '\nreturn { COLLECTIONS };')();
const fnSrc = (name) => {
  const m = appJs.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n}\\n`));
  assert.ok(m, 'not found: ' + name);
  return m[0];
};

/** Width × height from a JPEG's SOF marker. */
function jpegSize(rel) {
  const b = readFileSync(new URL(rel, import.meta.url));
  for (let i = 2; i < b.length; ) {
    const marker = b[i + 1];
    const len = b.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) };
    }
    i += 2 + len;
  }
  throw new Error('no SOF in ' + rel);
}

/** Every declaration block whose selector list mentions `sel`, joined. */
const rulesFor = (sel) =>
  [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, s]) => s.split(',').some((x) => x.includes(sel))).map(([, , body]) => body).join('\n');

const banner = (c) =>
  new Function(
    'c', 'cover',
    `const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
     ${fnSrc('collectionBannerHtml')} return collectionBannerHtml(c, cover);`
  )(c, { img: 'images/cover.jpg' });

// ---- home hero ------------------------------------------------------------

test('hero: width/height on the <img> are the real size of images/hero.jpg, and the box takes that ratio', () => {
  const { width, height } = jpegSize('../../images/hero.jpg');
  const home = fnSrc('screenHome');
  assert.ok(
    home.includes(`<div class="hero-photo" style="--w: ${width}; --h: ${height}">`),
    'box with --w/--h from the photo'
  );
  assert.match(home, new RegExp(`<img class="hero-bg" src="images/hero.jpg" width="${width}" height="${height}" alt="[^"]+">`));
  const box = rulesFor('.hero-photo');
  assert.match(box, /aspect-ratio: var\(--w\) \/ var\(--h\);/);
  assert.match(box, /width: calc\(min\(640px, 72vh\) \* var\(--w\) \/ var\(--h\)\);/, 'at most min(640px, 72vh) tall');
  assert.match(box, /border-radius: var\(--radius-lg\);/);
  assert.match(rulesFor('.hero-bg'), /width: 100%;\s*height: auto;/);
});

test('hero: no cropping and no blur — no object-fit / object-position / blur layer, text beside or under the photo', () => {
  const heroCss = ['.hero ', '.hero{', '.hero-photo', '.hero-bg', '.hero-copy'].map(rulesFor).join('\n');
  assert.doesNotMatch(heroCss, /object-fit|object-position|blur\(|backdrop-filter|position: absolute/);
  const home = fnSrc('screenHome');
  const hero = home.slice(home.indexOf('<section class="shell hero">'), home.indexOf('</section>'));
  assert.equal((hero.match(/<img /g) || []).length, 1, 'one image, no blurred copy');
  assert.doesNotMatch(hero, /banner-photo-bg|hero-inner/);
});

// ---- category banners -------------------------------------------------------

test('آباژور: bannerFit "whole" with the real size of images/banner-lamps.jpg; no other category has it', () => {
  const lamps = COLLECTIONS.lamps;
  assert.equal(lamps.bannerFit, 'whole');
  assert.equal(lamps.bannerImg, 'images/banner-lamps.jpg');
  assert.deepEqual({ width: lamps.bannerWidth, height: lamps.bannerHeight }, jpegSize('../../images/banner-lamps.jpg'));
  for (const [key, c] of Object.entries(COLLECTIONS)) {
    if (key !== 'lamps') assert.equal(c.bannerFit, undefined, key);
  }
});

test('آباژور banner: one photo in a box of its own shape, width/height set, title over it — no blur layer', () => {
  const html = banner(COLLECTIONS.lamps);
  assert.match(html, /^<div class="banner banner--whole" style="--w: 1600; --h: 1067">/);
  assert.match(html, /<img class="banner-photo" src="images\/banner-lamps\.jpg" width="1600" height="1067" alt="آباژور">/);
  assert.equal((html.match(/<img /g) || []).length, 1);
  assert.doesNotMatch(html, /banner-photo-bg|banner-photo-fg|banner-photo-fill/);
  assert.match(html, /<div class="banner-copy">\s*<h1 class="page-title banner-title">آباژور<\/h1>/);
  const box = rulesFor('.banner--whole');
  assert.match(box, /aspect-ratio: var\(--w\) \/ var\(--h\);/);
  assert.match(box, /width: min\(100%, calc\(min\(560px, 65vh\) \* var\(--w\) \/ var\(--h\)\)\);/, 'at most min(560px, 65vh) tall');
  assert.match(box, /min-height: 0;\s*max-height: none;/, 'the 3:1 banner limits are lifted');
  assert.match(box, /margin-inline: auto;/);
  assert.match(box, /width: 100%;\s*height: auto;/, 'the photo fills the box');
  assert.doesNotMatch(box, /object-fit|blur\(/);
});

test('the other categories keep the blur-fill (sharp contained photo over a blurred copy)', () => {
  for (const key of Object.keys(COLLECTIONS).filter((k) => k !== 'lamps')) {
    const html = banner({ ...COLLECTIONS[key], bannerImg: COLLECTIONS[key].bannerImg });
    assert.match(html, /^<div class="banner">/, key);
    assert.match(html, /<img class="banner-photo-bg" src="[^"]+" alt="">/, key);
    assert.match(html, /<img class="banner-photo-fg" src="[^"]+" alt="[^"]+">/, key);
  }
  // even a category given only some of the whole-photo settings falls back
  assert.match(banner({ ...COLLECTIONS.lamps, bannerWidth: undefined }), /banner-photo-bg/);
  assert.match(rulesFor('.banner-photo-bg'), /filter: blur\(28px\)/);
  assert.match(rulesFor('.banner-photo-fg'), /object-fit: contain;/);
  assert.match(fnSrc('screenCollection'), /\$\{collectionBannerHtml\(c, cover\)\}/);
});

test('آباژور banner on phones (≤ 760 px): a compact caption on the photo, white over a bottom-only gradient', () => {
  const phone = css.slice(css.indexOf('@media (max-width: 760px)'));
  const block = (sel) => {
    const m = phone.match(new RegExp(sel.replace(/[.()]/g, '\\$&') + ' \\{([^}]*)\\}'));
    assert.ok(m, 'phone rule: ' + sel);
    return m[1];
  };
  const copy = block('.banner--whole .banner-copy');
  assert.match(copy, /padding: 18px 12px 12px;/);
  assert.match(copy, /background: linear-gradient\(to top, rgba\(22, 21, 20, 0\.85\) 0%, rgba\(22, 21, 20, 0\.72\) 75%, rgba\(22, 21, 20, 0\) 100%\);/, 'dark behind the text, fading out only at the top');
  assert.match(block('.banner--whole .banner-copy .banner-title'), /font-size: 22px;/);
  const sub = block('.banner--whole .banner-copy p');
  assert.match(sub, /font-size: 13px;/);
  assert.match(sub, /-webkit-line-clamp: 2;/, 'subtitle at most two lines');
  assert.match(sub, /color: rgba\(255, 255, 255, 0\.9\);/);
  // still on the photo: nothing moves it out, the box keeps its shape and corners
  assert.doesNotMatch(phone, /\.banner--whole[^{]*\{[^}]*(position: static|aspect-ratio: auto|overflow: visible|background: none)/);
  assert.match(rulesFor('.banner--whole .banner-copy'), /position: absolute; inset-inline: 0; bottom: 0;/);
  assert.match(css, /\.banner-copy \.banner-title \{ color: #fff; \}/);
  assert.match(css.match(/\n\.banner \{[^}]*\}/)[0], /border-radius: var\(--radius-lg\);[\s\S]*overflow: hidden;/);
});
