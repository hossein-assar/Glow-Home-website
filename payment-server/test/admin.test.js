// Admin panel (admin/admin.js, a browser script): price formatting and the
// photo-upload helpers. Runs the real functions, pulled out of the source
// text, plus source checks on the markup. The canvas/Storage parts need a
// browser and are not run here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const adminJs = read('../../admin/admin.js');
const adminHtml = read('../../admin/index.html');

const fnSrc = (name) => {
  const m = adminJs.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n}\\n`));
  assert.ok(m, `function ${name} not found in admin/admin.js`);
  return m[0];
};
const constSrc = (name) => {
  const m = adminJs.match(new RegExp(`const ${name} = [^\\n]*\\n`));
  assert.ok(m, `const ${name} not found in admin/admin.js`);
  return m[0];
};

// supabase-config.js (loaded before admin.js) gives proxiedPhotoUrl.
const configJs = read('../../supabase-config.js');
const fns = new Function(
  'location', 'window',
  configJs + '\n' +
  [
    'toLatinDigits', 'unformatPrice', 'formatPrice', 'reformatPriceInput',
    'checkPhotoFile', 'fitWithin', 'photoFileName', 'resolvePhotoSrc', 'mainPhoto', 'mainPhotoFields',
  ].map(fnSrc).join('\n') +
    ['PHOTO_TYPES', 'PHOTO_MAX_BYTES', 'PHOTO_MAX_SIDE'].map(constSrc).join('') +
    'return { unformatPrice, formatPrice, reformatPriceInput, checkPhotoFile, fitWithin, photoFileName, resolvePhotoSrc, mainPhoto, mainPhotoFields, PHOTO_MAX_SIDE };'
)({ origin: 'https://glow-home.ir' }, {});

// ---- prices -------------------------------------------------------------------

test('formatPrice adds thousands separators', () => {
  const { formatPrice } = fns;
  assert.equal(formatPrice('9100000'), '9,100,000');
  assert.equal(formatPrice(9100000), '9,100,000');
  assert.equal(formatPrice(12980000), '12,980,000');
  assert.equal(formatPrice('999'), '999');
  assert.equal(formatPrice('1000'), '1,000');
  assert.equal(formatPrice('0'), '0');
  assert.equal(formatPrice('0009100'), '9,100'); // leading zeros dropped
  assert.equal(formatPrice('9,100,000'), '9,100,000'); // already formatted stays the same
});

test('Persian and Arabic digits become English; other characters are dropped', () => {
  const { formatPrice, unformatPrice } = fns;
  assert.equal(unformatPrice('۹٬۱۰۰٬۰۰۰'), '9100000');
  assert.equal(formatPrice('۹۱۰۰۰۰۰'), '9,100,000');
  assert.equal(formatPrice('٩١٠٠٠٠٠'), '9,100,000');
  assert.equal(formatPrice('۱۲,۹۸۰,۰۰۰ تومان'), '12,980,000');
  assert.equal(formatPrice('9.100.000abc -'), '9,100,000');
});

test('empty input stays empty', () => {
  const { formatPrice, unformatPrice } = fns;
  for (const v of ['', '   ', 'abc', ',', null, undefined]) {
    assert.equal(formatPrice(v), '', String(v));
    assert.equal(unformatPrice(v), '', String(v));
  }
  // Empty is treated exactly as before: Number('') was 0 → `|| 0` / isPrice() fails / `pr === ''` skips.
  assert.equal(Number(unformatPrice('')), 0);
});

test('saved values are plain integers, same as before', () => {
  const { unformatPrice, formatPrice } = fns;
  for (const [typed, expected] of [['9,100,000', 9100000], ['۱۵٬۴۵۰٬۰۰۰', 15450000], ['12980000', 12980000], [formatPrice(9400000), 9400000]]) {
    const saved = Number(unformatPrice(typed));
    assert.equal(saved, expected, typed);
    assert.ok(Number.isSafeInteger(saved));
  }
  // Every save path strips the separators before Number().
  assert.match(adminJs, /const price = Number\(unformatPrice\(document\.getElementById\(`price-\$\{id\}`\)\.value\)\) \|\| 0;/);
  assert.match(adminJs, /price: Number\(unformatPrice\(document\.getElementById\('new-price'\)\.value\)\) \|\| 0,/);
  assert.match(adminJs, /const pr = unformatPrice\(row\.querySelector\('\.v-price'\)\.value\);/);
  assert.match(adminJs, /shades\[input\.dataset\.shade\] = Number\(unformatPrice\(input\.value\)\);/);
});

test('the caret stays after the same digit while typing', () => {
  const { reformatPriceInput } = fns;
  // typed a 7th digit at the end
  assert.deepEqual(reformatPriceInput('9,100,0000', 10), { value: '91,000,000', caret: 10 });
  // inserted "5" after the first digit of "9,100,000"
  assert.deepEqual(reformatPriceInput('95,100,000', 2), { value: '95,100,000', caret: 2 });
  // deleted the "1" in "9,100,000" (caret was after it)
  assert.deepEqual(reformatPriceInput('9,00,000', 2), { value: '900,000', caret: 1 });
  // typed a Persian digit at the start
  assert.deepEqual(reformatPriceInput('۱9,100,000', 1), { value: '19,100,000', caret: 1 });
  // empty
  assert.deepEqual(reformatPriceInput('', 0), { value: '', caret: 0 });
});

test('no price input is left as type="number"', () => {
  const inputs = [...(adminJs + adminHtml).matchAll(/<input\b[^>]*>/g)].map((m) => m[0]);
  const priceInputs = inputs.filter((t) => !/type="checkbox"/.test(t) && /price|قیمت/.test(t));
  assert.ok(priceInputs.length >= 4, 'expected the new, quick-edit, size and shade price inputs');
  for (const tag of priceInputs) {
    assert.doesNotMatch(tag, /type="number"/, tag);
    assert.match(tag, /class="[^"]*price-input/, tag);
    assert.match(tag, /inputmode="numeric"/, tag);
    assert.match(tag, /dir="ltr"/, tag);
  }
  // DB values are shown formatted when the panel loads.
  assert.match(adminJs, /value="\$\{formatPrice\(p\.price\)\}"/);
  assert.match(adminJs, /value="\$\{formatPrice\(price\)\}"/);
  assert.match(adminJs, /value="\$\{formatPrice\(sh\[k\]\)\}"/);
  assert.match(adminHtml, /<th>قیمت \(تومان\)<\/th>/);
});

// ---- photos -------------------------------------------------------------------

test('photo files: only JPEG/PNG/WebP up to 15 MB', () => {
  const { checkPhotoFile } = fns;
  const MB = 1024 * 1024;
  assert.equal(checkPhotoFile({ type: 'image/jpeg', size: 3 * MB }), '');
  assert.equal(checkPhotoFile({ type: 'image/png', size: 15 * MB }), '');
  assert.equal(checkPhotoFile({ type: 'image/webp', size: 1 }), '');
  assert.match(checkPhotoFile({ type: 'image/jpeg', size: 15 * MB + 1 }), /۱۵ مگابایت/);
  for (const type of ['image/heic', 'image/gif', 'application/pdf', 'image/svg+xml', '']) {
    assert.match(checkPhotoFile({ type, size: 1000 }), /عکس نیست/, type);
  }
  assert.match(checkPhotoFile(null), /عکس نیست/);
});

test('resize: longest side at most 1600 px, ratio kept, never enlarged', () => {
  const { fitWithin, PHOTO_MAX_SIDE } = fns;
  assert.equal(PHOTO_MAX_SIDE, 1600);
  assert.deepEqual(fitWithin(4000, 3000, 1600), { width: 1600, height: 1200 });
  assert.deepEqual(fitWithin(3024, 4032, 1600), { width: 1200, height: 1600 });
  assert.deepEqual(fitWithin(1600, 1600, 1600), { width: 1600, height: 1600 });
  assert.deepEqual(fitWithin(800, 600, 1600), { width: 800, height: 600 }); // not enlarged
});

test('file names are safe ASCII: <slug or "product">-<timestamp>.jpg', () => {
  const { photoFileName } = fns;
  assert.equal(photoFileName('gisoo', 1730000000000, 'jpg'), 'gisoo-1730000000000.jpg');
  assert.equal(photoFileName('deforme-desk', 1, 'jpg'), 'deforme-desk-1.jpg');
  assert.equal(photoFileName('Shade Raffia', 1, 'jpg'), 'shade-raffia-1.jpg');
  assert.equal(photoFileName('گیسو', 1, 'jpg'), 'product-1.jpg');
  assert.equal(photoFileName('', 1, 'jpg'), 'product-1.jpg');
  assert.equal(photoFileName(undefined, 1, 'jpg'), 'product-1.jpg');
  assert.equal(photoFileName('../../etc/passwd', 1, 'jpg'), 'etc-passwd-1.jpg');
  assert.equal(photoFileName('logo', 1, 'png'), 'logo-1.png');
  assert.equal(photoFileName('x', 1, 'exe'), 'x-1.jpg');
  for (const name of [photoFileName('آباژور گیسو ۱۴۰', 5, 'jpg'), photoFileName('a b/c\\d?e', 5, 'jpg')]) {
    assert.match(name, /^[a-z0-9-]+-[0-9]+\.(jpg|png)$/, name);
  }
});

test('preview: old relative paths resolve from the site root, supabase.co photos load through /sb', () => {
  const { resolvePhotoSrc } = fns;
  assert.equal(resolvePhotoSrc('images/gisoo.jpg'), '/images/gisoo.jpg');
  assert.equal(resolvePhotoSrc('/images/gisoo.jpg'), '/images/gisoo.jpg');
  const url = 'https://sgfoesnpodvwyzlxfhtq.supabase.co/storage/v1/object/public/product-images/gisoo-1.jpg';
  const proxied = 'https://glow-home.ir/sb/storage/v1/object/public/product-images/gisoo-1.jpg';
  assert.equal(resolvePhotoSrc(url), proxied);
  assert.equal(resolvePhotoSrc(proxied), proxied);
  assert.equal(resolvePhotoSrc('https://example.com/a.jpg'), 'https://example.com/a.jpg');
  assert.equal(resolvePhotoSrc(''), '');
  assert.equal(resolvePhotoSrc(null), '');
});

test('replacing the main photo moves photo_url and photos[0] together; the rest of the gallery stays', () => {
  const { mainPhoto, mainPhotoFields } = fns;
  const rosha = { photo_url: 'images/rosha.jpg', photos: ['images/rosha.jpg', 'images/rosha-2.jpg', 'images/rosha-3.jpg'] };
  assert.equal(mainPhoto(rosha), 'images/rosha.jpg');
  assert.equal(mainPhotoFields(rosha, 'images/rosha.jpg'), null); // unchanged → nothing sent
  assert.deepEqual(mainPhotoFields(rosha, 'https://x/new.jpg'), {
    photo_url: 'https://x/new.jpg',
    photos: ['https://x/new.jpg', 'images/rosha-2.jpg', 'images/rosha-3.jpg'],
  });
  const noGallery = { photo_url: 'images/a.jpg', photos: [] };
  assert.deepEqual(mainPhotoFields(noGallery, 'https://x/b.jpg'), { photo_url: 'https://x/b.jpg' });
  assert.equal(mainPhoto({ photo_url: null, photos: [] }), '');
});

test('uploads go to the product-images bucket and never overwrite or delete', () => {
  assert.match(adminJs, /const PHOTO_BUCKET = 'product-images';/);
  assert.match(adminJs, /upsert: false/);
  assert.doesNotMatch(adminJs, /\.storage[\s\S]{0,80}\.remove\(/);
  assert.match(adminJs, /accept="image\/jpeg,image\/png,image\/webp"/);
  assert.match(adminJs, /canvas\.toBlob\(resolve, type, 0\.85\)/);
  assert.doesNotMatch(adminHtml, /آدرس عکس \(images\/xxx\.jpg\)/);
});

test('bucket migration uses exactly the products admin check', () => {
  const schema = read('../../supabase/schema.sql');
  const sql = read('../../supabase/migration-product-images-bucket.sql')
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  const check = 'exists (select 1 from profiles where id = auth.uid() and is_admin)';
  assert.ok(schema.includes(check));
  const qualified = check.replace('from profiles', 'from public.profiles');
  // insert (with check), update (using + with check), delete (using)
  assert.equal(sql.split(qualified).length - 1, 4);
  assert.match(sql, /'product-images', 'product-images', true, 5242880, array\['image\/jpeg', 'image\/png', 'image\/webp'\]/);
  assert.match(sql, /for select\s+using \(bucket_id = 'product-images'\);/);
  assert.doesNotMatch(sql, /create (or replace )?function/i);
});

test('drag-and-drop: only the drop handler uploads (files are empty during dragover)', () => {
  const wire = fnSrc('wirePhotoField');
  const handler = (event) => {
    const m = wire.match(new RegExp(`drop\\.addEventListener\\('${event}', \\(e?\\) => \\{?([\\s\\S]*?)\\n  \\}?\\);`));
    assert.ok(m, `no ${event} handler on the drop box`);
    return m[1];
  };
  const over = handler('dragover');
  assert.match(over, /e\.preventDefault\(\);/);
  assert.match(over, /classList\.add\('dragging'\)/);
  assert.doesNotMatch(over, /upload\(|dataTransfer/);
  assert.match(handler('dragleave'), /classList\.remove\('dragging'\)/);
  const drop = handler('drop');
  assert.match(drop, /e\.preventDefault\(\);/);
  assert.match(drop, /classList\.remove\('dragging'\)/);
  assert.match(drop, /e\.dataTransfer && e\.dataTransfer\.files\[0\]/);
  assert.match(drop, /upload\(file\)/);
});
