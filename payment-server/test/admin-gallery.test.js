// Admin photo gallery (admin/admin.js): one editor in «افزودن محصول» and
// «ویرایش کامل» — add several photos, remove, move, choose the cover; the
// cover is always photos[0] and photo_url; saves write the whole ordered
// list in one update; at most PHOTO_MAX_COUNT photos; each file goes through
// the same pipeline as before, one at a time, and a failed one never loses
// the others. Runs the real functions, pulled out of the source text, with
// stubs for the DOM, the canvas step and Supabase.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const adminJs = read('../../admin/admin.js');
const adminHtml = read('../../admin/index.html');
const appJs = read('../../app.js');
const configJs = read('../../supabase-config.js');

const grab = (src, re) => {
  const m = src.match(re);
  assert.ok(m, 'not found: ' + re);
  return m[0];
};
const fnSrc = (name) => grab(adminJs, new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\n}\\n`));
const constSrc = (name) => grab(adminJs, new RegExp(`(?:const|let) ${name} = [^\\n]*\\n`));

const GALLERY_FNS = [
  'escapeHtml', 'escapeAttr', 'faNum', 'resolvePhotoSrc', 'checkPhotoFile', 'photoFileName', 'photoUploadError',
  'initialPhotos', 'mainPhoto', 'galleryAdd', 'galleryRemove', 'galleryMove', 'galleryMakeCover', 'gallerySetCover',
  'galleryRoom', 'galleryLimitMessage', 'galleryFields', 'newProductPhotoFields', 'galleryPhotos',
  'uploadPhotoFile', 'addPhotoFiles', 'galleryHtml', 'photoGalleryFieldHtml', 'resetPhotoGallery',
];
const GALLERY_CONSTS = ['PHOTO_BUCKET', 'PHOTO_TYPES', 'PHOTO_MAX_BYTES', 'PHOTO_UPLOAD_MAX_BYTES', 'photoUploads', 'PHOTO_MAX_COUNT', 'photoGalleries', 'lastPhotoStamp'];

/** The gallery code with stubbed document / sb / preparePhoto. */
function env({ els = {}, sb = null, prepare = async (f) => ({ blob: { size: 1000 }, ext: 'jpg', type: 'image/jpeg', from: f.name }) } = {}) {
  const document = { getElementById: (id) => els[id] || null };
  const errors = [];
  const fns = new Function(
    'location', 'window', 'document', 'sb', 'preparePhoto', 'console',
    configJs + '\n' + GALLERY_CONSTS.map(constSrc).join('') + GALLERY_FNS.map(fnSrc).join('\n') +
      `return { ${GALLERY_FNS.join(', ')}, PHOTO_MAX_COUNT, photoUploads, photoGalleries };`
  )({ origin: 'https://glow-home.ir' }, {}, document, sb, prepare, { error: (...a) => errors.push(a) });
  return { ...fns, els, errors };
}

const UP = (n) => `https://sgfoesnpodvwyzlxfhtq.supabase.co/storage/v1/object/public/product-images/rosha-${n}.jpg`;
const file = (name, type = 'image/jpeg', size = 2000) => ({ name, type, size });

// ---- the list ---------------------------------------------------------------

test('the storefront has no photo limit, so the editor stops at 8', () => {
  // app.js shows every photo: all thumbnails (scrolling row) and the lightbox
  assert.match(appJs, /const thumbs = photos\s*\n\s*\.map\(/);
  assert.doesNotMatch(appJs, /photos\.slice\(/);
  assert.equal(env().PHOTO_MAX_COUNT, 8);
});

test('opening: photos when there are any, else [photo_url], else nothing', () => {
  const { initialPhotos, mainPhoto } = env();
  assert.deepEqual(initialPhotos({ photo_url: 'images/rosha.jpg', photos: ['images/rosha.jpg', 'images/rosha-2.jpg'] }), ['images/rosha.jpg', 'images/rosha-2.jpg']);
  assert.deepEqual(initialPhotos({ photo_url: 'images/a.jpg', photos: [] }), ['images/a.jpg']);
  assert.deepEqual(initialPhotos({ photo_url: 'images/a.jpg', photos: null }), ['images/a.jpg']);
  assert.deepEqual(initialPhotos({ photo_url: null, photos: [] }), []);
  assert.deepEqual(initialPhotos({ photo_url: '  ', photos: ['', ' '] }), []);
  // a gallery wins over a different photo_url, as in the shop
  assert.deepEqual(initialPhotos({ photo_url: 'x.jpg', photos: ['y.jpg'] }), ['y.jpg']);
  assert.equal(mainPhoto({ photo_url: 'x.jpg', photos: ['y.jpg'] }), 'y.jpg');
});

test('add / remove / move / make cover', () => {
  const { galleryAdd, galleryRemove, galleryMove, galleryMakeCover } = env();
  const l = ['a', 'b', 'c', 'd'];
  assert.deepEqual(galleryAdd(l, ' e '), ['a', 'b', 'c', 'd', 'e']);
  assert.equal(galleryAdd(l, 'b'), l, 'no duplicate');
  assert.equal(galleryAdd(l, ''), l);
  assert.deepEqual(galleryRemove(l, 0), ['b', 'c', 'd'], 'removing the cover: the next one is the cover');
  assert.deepEqual(galleryRemove(l, 3), ['a', 'b', 'c']);
  assert.equal(galleryRemove(l, 9), l);
  assert.deepEqual(galleryMove(l, 2, -1), ['a', 'c', 'b', 'd']);
  assert.deepEqual(galleryMove(l, 1, -1), ['b', 'a', 'c', 'd'], 'moving to the front makes it the cover');
  assert.deepEqual(galleryMove(l, 1, 1), ['a', 'c', 'b', 'd']);
  assert.equal(galleryMove(l, 0, -1), l);
  assert.equal(galleryMove(l, 3, 1), l);
  assert.deepEqual(galleryMakeCover(l, 2), ['c', 'a', 'b', 'd'], 'the others keep their order');
  assert.equal(galleryMakeCover(l, 0), l);
  assert.deepEqual(l, ['a', 'b', 'c', 'd'], 'never mutates');
});

test('«آدرس دستی (پیشرفته)» edits the cover', () => {
  const { gallerySetCover } = env();
  const l = ['a', 'b', 'c'];
  assert.equal(gallerySetCover(l, 'a'), l, 'same address: unchanged');
  assert.equal(gallerySetCover(l, ' a '), l);
  assert.deepEqual(gallerySetCover(l, 'images/new.jpg'), ['images/new.jpg', 'b', 'c']);
  assert.deepEqual(gallerySetCover(l, 'c'), ['c', 'b'], 'no duplicate');
  assert.deepEqual(gallerySetCover(l, ''), ['b', 'c'], 'emptied: the cover is removed');
  assert.deepEqual(gallerySetCover([], 'images/x.jpg'), ['images/x.jpg']);
  assert.deepEqual(gallerySetCover([], ''), []);
});

test('the cover and the list stay in sync: photo_url = photos[0] after every change', () => {
  const { galleryFields, galleryAdd, galleryRemove, galleryMove, galleryMakeCover, gallerySetCover } = env();
  const row = { photo_url: 'a', photos: ['a', 'b', 'c'] };
  const lists = [
    galleryAdd(row.photos, 'd'), galleryRemove(row.photos, 0), galleryMove(row.photos, 1, -1),
    galleryMakeCover(row.photos, 2), gallerySetCover(row.photos, 'z'), galleryRemove(galleryRemove(row.photos, 0), 0),
  ];
  for (const l of lists) {
    const f = galleryFields(row, l);
    assert.deepEqual(f.photos, l);
    assert.equal(f.photo_url, f.photos[0]);
  }
  assert.equal(galleryFields(row, ['a', 'b', 'c']), null, 'unchanged: nothing written');
  assert.deepEqual(galleryFields(row, ['a', 'b']), { photo_url: 'a', photos: ['a', 'b'] }, 'the whole list, not only the cover');
  assert.deepEqual(galleryFields(row, []), { photo_url: null, photos: [] });
});

test('the limit: 8 photos, counting uploads in flight, with a Persian message', () => {
  const { galleryAdd, galleryRoom, galleryLimitMessage } = env();
  const eight = Array.from({ length: 8 }, (_, i) => 'p' + i);
  assert.equal(galleryAdd(eight, 'p8'), eight);
  assert.equal(galleryRoom(eight), 0);
  assert.equal(galleryRoom(['a', 'b'], 3), 3);
  assert.equal(galleryRoom(['a'], 20), 0);
  assert.equal(galleryLimitMessage(2), 'هر محصول حداکثر ۸ عکس دارد؛ ۲ عکس اضافه نشد.');
});

// ---- uploading ---------------------------------------------------------------

function fakeStorage({ fail = {} } = {}) {
  const uploads = [];
  const sb = {
    storage: {
      from: (bucket) => ({
        upload: async (name, blob, opts) => {
          uploads.push({ bucket, name, blob, opts });
          return fail[blob.from] ? { error: { message: fail[blob.from] } } : { error: null };
        },
        getPublicUrl: (name) => ({ data: { publicUrl: 'https://glow-home.ir/sb/storage/v1/object/public/product-images/' + name } }),
      }),
    },
  };
  return { sb, uploads };
}

test('one file through the same pipeline: checks, resize step, safe name, no overwrite, canonical URL', async () => {
  const { sb, uploads } = fakeStorage({ fail: { 'denied.jpg': 'new row violates row-level security policy' } });
  const prepared = [];
  const big = new Set(['big.jpg']);
  const e = env({
    sb,
    prepare: async (f) => {
      if (f.name === 'broken.jpg') throw new Error('decode');
      prepared.push(f.name);
      return { blob: { size: big.has(f.name) ? 5 * 1024 * 1024 : 1000, from: f.name }, ext: 'jpg', type: 'image/jpeg' };
    },
  });
  const ok = await e.uploadPhotoFile(file('IMG 0001.HEIC.jpg'), 'Rosha Lamp');
  assert.match(ok.url, /^https:\/\/sgfoesnpodvwyzlxfhtq\.supabase\.co\/storage\/v1\/object\/public\/product-images\/rosha-lamp-\d+\.jpg$/);
  assert.deepEqual(uploads[0].opts, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false });
  assert.equal(uploads[0].bucket, 'product-images');
  assert.match(uploads[0].name, /^[a-z0-9-]+\.jpg$/);

  assert.deepEqual(await e.uploadPhotoFile(file('doc.pdf', 'application/pdf'), 'x'), { error: 'این فایل عکس نیست. فقط JPG، PNG یا WebP انتخاب کنید.' });
  assert.deepEqual(await e.uploadPhotoFile(file('huge.jpg', 'image/jpeg', 16 * 1024 * 1024), 'x'), { error: 'حجم عکس بیشتر از ۱۵ مگابایت است. عکس کوچک‌تری انتخاب کنید.' });
  assert.deepEqual(await e.uploadPhotoFile(file('broken.jpg'), 'x'), { error: 'این عکس باز نشد. فایل دیگری را امتحان کنید.' });
  assert.deepEqual(await e.uploadPhotoFile(file('big.jpg'), 'x'), { error: 'حجم عکس بعد از فشرده‌سازی هنوز زیاد است. عکس دیگری انتخاب کنید.' });
  assert.deepEqual(await e.uploadPhotoFile(file('denied.jpg'), 'x'), { error: 'اجازه‌ی آپلود ندارید. دوباره وارد پنل شوید.' });
  assert.ok(!prepared.includes('doc.pdf') && !prepared.includes('huge.jpg'), 'checked before the resize');
  assert.equal(uploads.length, 2, 'only files that passed every check were sent');

  // two files in the same millisecond still get two names (upsert is off)
  const names = [];
  for (let i = 0; i < 3; i++) await e.uploadPhotoFile(file(`s${i}.jpg`), 'rosha');
  for (const u of uploads.slice(-3)) names.push(u.name);
  assert.equal(new Set(names).size, 3);
});

/** A gallery object as wirePhotoGallery() makes it. */
const gal = (list = []) => ({ list: [...list], initial: [...list], pending: [], errors: [], queue: Promise.resolve(), render() {} });

test('several files: uploaded one at a time, added in order, progress shown while they run', async () => {
  const e = env();
  const g = gal([UP(0)]);
  let running = 0;
  let maxRunning = 0;
  const seen = [];
  const upload = async (f) => {
    running++;
    maxRunning = Math.max(maxRunning, running);
    await new Promise((r) => setTimeout(r, 5));
    running--;
    return { url: 'https://x/' + f.name };
  };
  const done = e.addPhotoFiles('7', g, [file('1.jpg'), file('2.jpg'), file('3.jpg')], 'rosha', upload, () =>
    seen.push(g.pending.map((j) => j.state).join(','))
  );
  assert.ok(e.photoUploads.has('7'), 'save is blocked while uploading');
  assert.equal(g.pending.length, 3);
  await done;
  assert.equal(maxRunning, 1, 'one by one');
  assert.deepEqual(g.list, [UP(0), 'https://x/1.jpg', 'https://x/2.jpg', 'https://x/3.jpg']);
  assert.deepEqual(g.errors, []);
  assert.ok(!e.photoUploads.has('7'));
  assert.equal(seen[0], 'waiting,waiting,waiting');
  assert.ok(seen.includes('uploading,waiting,waiting'));
  assert.equal(seen.at(-1), '');
});

test('a failed upload never loses the others; each failure has its own Persian error with the file name', async () => {
  const e = env();
  const g = gal();
  const upload = async (f) => {
    if (f.name === 'bad.jpg') return { error: 'این عکس باز نشد. فایل دیگری را امتحان کنید.' };
    if (f.name === 'throws.jpg') throw new Error('network down');
    return { url: 'https://x/' + f.name };
  };
  await e.addPhotoFiles('new', g, [file('a.jpg'), file('bad.jpg'), file('throws.jpg'), file('b.jpg')], 'x', upload, () => {});
  assert.deepEqual(g.list, ['https://x/a.jpg', 'https://x/b.jpg']);
  assert.deepEqual(g.errors, [
    '«bad.jpg»: این عکس باز نشد. فایل دیگری را امتحان کنید.',
    '«throws.jpg»: آپلود انجام نشد. اتصال اینترنت را بررسی کنید و دوباره تلاش کنید.',
  ]);
  assert.equal(g.pending.length, 0);
  assert.ok(!e.photoUploads.has('new'), 'the save button works again');
});

test('choosing more files than fit: the first ones up to 8 are uploaded, the rest get the limit message', async () => {
  const e = env();
  const g = gal(Array.from({ length: 6 }, (_, i) => UP(i)));
  const sent = [];
  const upload = async (f) => (sent.push(f.name), { url: 'https://x/' + f.name });
  await e.addPhotoFiles('7', g, ['1', '2', '3', '4'].map((n) => file(n + '.jpg')), 'x', upload, () => {});
  assert.deepEqual(sent, ['1.jpg', '2.jpg']);
  assert.equal(g.list.length, 8);
  assert.deepEqual(g.errors, ['هر محصول حداکثر ۸ عکس دارد؛ ۲ عکس اضافه نشد.']);
  await e.addPhotoFiles('7', g, [file('9.jpg')], 'x', upload, () => {});
  assert.deepEqual(sent, ['1.jpg', '2.jpg'], 'full: nothing is uploaded');
  assert.deepEqual(g.errors, ['هر محصول حداکثر ۸ عکس دارد؛ ۱ عکس اضافه نشد.']);
});

// ---- the markup --------------------------------------------------------------

test('thumbnails: the cover marked «عکس اصلی», arrows, «حذف», «انتخاب به عنوان عکس اصلی» on the others', () => {
  const { galleryHtml } = env();
  const html = galleryHtml([UP(0), 'images/rosha-2.jpg', 'images/rosha-3.jpg']);
  const tiles = html.split('<div class="pg-tile').slice(1);
  assert.equal(tiles.length, 3);
  assert.match(tiles[0], /^ cover"/);
  assert.equal((html.match(/pg-cover-badge">عکس اصلی</g) || []).length, 1);
  assert.match(tiles[0], /src="https:\/\/glow-home\.ir\/sb\/storage\/v1\/object\/public\/product-images\/rosha-0\.jpg"/, 'loads through /sb');
  assert.match(tiles[1], /src="\/images\/rosha-2\.jpg"/, 'old relative paths from the site root');
  assert.doesNotMatch(tiles[0], /data-g="cover"/);
  for (const t of tiles.slice(1)) assert.match(t, /data-g="cover" data-i="\d">انتخاب به عنوان عکس اصلی<\/button>/);
  for (const t of tiles) assert.match(t, /data-g="remove" data-i="\d">حذف<\/button>/);
  assert.match(tiles[0], /data-g="earlier" data-i="0" aria-label="انتقال به قبل" title="انتقال به قبل" disabled>/);
  assert.match(tiles[2], /data-g="later" data-i="2" aria-label="انتقال به بعد" title="انتقال به بعد" disabled>/);
  assert.match(tiles[1], /data-g="earlier" data-i="1" aria-label="انتقال به قبل" title="انتقال به قبل" >/);
  assert.match(html, /<button type="button" class="pg-add" data-g="add">[\s\S]*افزودن عکس/);
  for (const t of tiles) assert.match(t, /type="button"/, 'no button submits anything');
});

test('uploads in flight show as tiles; a full gallery hides «افزودن عکس» and says why; names are escaped', () => {
  const { galleryHtml } = env();
  const html = galleryHtml(['a.jpg'], [{ name: '<b>x</b>.jpg', state: 'uploading' }, { name: 'y.jpg', state: 'waiting' }]);
  assert.match(html, /در حال آپلود…<small dir="auto">&lt;b&gt;x&lt;\/b&gt;\.jpg<\/small>/);
  assert.match(html, /در صف آپلود<small dir="auto">y\.jpg<\/small>/);
  const full = galleryHtml(Array.from({ length: 7 }, (_, i) => `p${i}.jpg`), [{ name: 'z.jpg', state: 'uploading' }]);
  assert.doesNotMatch(full, /data-g="add"/);
  assert.match(full, /به حداکثر ۸ عکس رسیده‌اید\. برای عکس تازه، یکی را حذف کنید\./);
  assert.match(galleryHtml([]), /data-g="add"/, 'an empty gallery shows only «افزودن عکس»');
  assert.match(galleryHtml(['a"onerror="x.jpg']), /src="\/a&quot;onerror=&quot;x\.jpg"/);
});

test('the editor frame: several files at once, the same accepted types, the manual cover address', () => {
  const { photoGalleryFieldHtml } = env();
  const html = photoGalleryFieldHtml('7', 'f-photo-7', ['images/rosha.jpg', 'images/rosha-2.jpg']);
  assert.match(html, /<input type="file" id="pg-file-7" accept="image\/jpeg,image\/png,image\/webp" multiple hidden>/);
  assert.match(html, /<summary>آدرس دستی \(پیشرفته\)<\/summary>/);
  assert.match(html, /<input id="f-photo-7" dir="ltr" value="images\/rosha\.jpg"/);
  assert.match(html, /حداکثر ۸ عکس/);
  assert.match(photoGalleryFieldHtml('new', 'new-photo', []), /<input id="new-photo" dir="ltr" value=""/);
});

test('both forms use the gallery editor; wiring covers click, choose, drop and the manual address', () => {
  assert.match(adminJs, /photoGalleryFieldHtml\(p\.id, `f-photo-\$\{p\.id\}`, initialPhotos\(p\)\)/);
  assert.match(adminJs, /wirePhotoGallery\(id, `f-photo-\$\{id\}`, \(\) => p\.slug, initialPhotos\(p\)\);/);
  assert.match(adminJs, /document\.getElementById\('new-photo-field'\)\.innerHTML = photoGalleryFieldHtml\('new', 'new-photo', \[\]\);/);
  assert.match(adminJs, /wirePhotoGallery\('new', 'new-photo', \(\) => document\.getElementById\('new-slug'\)\.value, \[\]\);/);
  const wire = fnSrc('wirePhotoGallery');
  for (const act of ['add', 'remove', 'earlier', 'later', 'cover']) assert.match(wire, new RegExp(`act === '${act}'`));
  assert.match(wire, /const files = \[\.\.\.fileInput\.files\];/, 'every chosen file');
  assert.match(wire, /urlInput\.addEventListener\('change', \(\) => change\(gallerySetCover\(g\.list, urlInput\.value\)\)\);/);
  assert.doesNotMatch(adminJs, /photoFieldHtml|wirePhotoField\(/, 'the single-photo field is gone');
  assert.match(adminHtml, /<label>عکس‌ها<\/label><div id="new-photo-field"><\/div>/);
});

test('at 390 px thumbnails wrap two per row and every button is at least 40 px tall', () => {
  assert.match(adminHtml, /\.pg-thumbs \{ display: flex; flex-wrap: wrap; gap: 10px; \}/);
  assert.match(adminHtml, /\.pg-btn \{ min-height: 40px;/);
  assert.match(adminHtml, /@media \(max-width: 420px\) \{\s*\.pg-tile, \.pg-add, \.pg-full \{ flex: 1 1 calc\(50% - 5px\); width: auto; \}/);
});

test('removing a photo never deletes the file in the bucket', () => {
  assert.doesNotMatch(adminJs, /\.storage[\s\S]{0,120}\.remove\(/);
  assert.doesNotMatch(fnSrc('galleryRemove'), /storage|sb\./);
});

// ---- saving ------------------------------------------------------------------

test('galleryPhotos: the editor list with the manual address applied, or the row as it is', () => {
  const els = { 'f-photo-7': { value: 'a.jpg' } };
  const e = env({ els });
  assert.deepEqual(e.galleryPhotos('7', 'f-photo-7', { photo_url: 'r.jpg', photos: [] }), ['r.jpg'], 'no editor open');
  e.photoGalleries['7'] = gal(['a.jpg', 'b.jpg']);
  assert.deepEqual(e.galleryPhotos('7', 'f-photo-7', null), ['a.jpg', 'b.jpg']);
  els['f-photo-7'].value = 'https://x/typed.jpg'; // typed, then Save pressed without leaving the field
  assert.deepEqual(e.galleryPhotos('7', 'f-photo-7', null), ['https://x/typed.jpg', 'b.jpg']);
});

test('add form: no photo → photo_url null as before; several → the whole list with photo_url = photos[0]', () => {
  const { newProductPhotoFields } = env();
  assert.deepEqual(newProductPhotoFields([]), { photo_url: null });
  assert.deepEqual(newProductPhotoFields(['https://x/1.jpg', 'https://x/2.jpg', 'https://x/3.jpg']), {
    photo_url: 'https://x/1.jpg',
    photos: ['https://x/1.jpg', 'https://x/2.jpg', 'https://x/3.jpg'],
  });
});

/** Runs the real «افزودن محصول» click handler with stubs. */
async function runAdd(list, { insertError = null } = {}) {
  const els = {};
  for (const id of ['new-slug', 'new-name-fa', 'new-name-en', 'new-collection', 'new-subcategory', 'new-style', 'new-material', 'new-height', 'new-price', 'new-desc', 'new-body-size', 'new-shade-size', 'new-photo', 'add-msg']) {
    els[id] = { value: '', textContent: '', className: '' };
  }
  Object.assign(els['new-slug'], { value: 'rosha-2' });
  Object.assign(els['new-name-fa'], { value: 'رشا ۲' });
  Object.assign(els['new-collection'], { value: 'lamps' });
  Object.assign(els['new-price'], { value: '1,200,000' });
  els['new-photo'].value = list[0] || '';
  let handler;
  els['btn-add'] = { addEventListener: (ev, fn) => (handler = fn) };
  const inserts = [];
  const sb = { from: (t) => ({ insert: async (payload) => (inserts.push({ t, payload }), { error: insertError }) }) };
  const e = env({ els, sb });
  const g = gal(list);
  let renders = 0;
  g.render = () => renders++;
  e.photoGalleries.new = g;
  new Function(
    'document', 'sb', 'photoUploads', 'galleryPhotos', 'newProductPhotoFields', 'resetPhotoGallery', 'loadProducts', 'adminErrorText',
    [fnSrc('toLatinDigits'), fnSrc('unformatPrice'), grab(adminJs, /document\.getElementById\('btn-add'\)\.addEventListener\('click', async \(\) => \{[\s\S]*?\n\}\);\n/)].join('\n')
  )({ getElementById: (id) => els[id] }, sb, e.photoUploads, e.galleryPhotos, e.newProductPhotoFields, e.resetPhotoGallery, () => {}, (x) => String(x.message));
  await handler();
  return { inserts, els, g, renders, e };
}

test('add form saves the whole ordered list in one insert, then empties the editor', async () => {
  const list = ['https://x/1.jpg', 'https://x/2.jpg', 'https://x/3.jpg'];
  const { inserts, els, g, renders } = await runAdd(list);
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].t, 'products');
  assert.equal(inserts[0].payload.photo_url, 'https://x/1.jpg');
  assert.deepEqual(inserts[0].payload.photos, list);
  assert.equal(els['add-msg'].textContent, 'محصول اضافه شد.');
  assert.deepEqual(g.list, []);
  assert.ok(renders > 0);
});

test('add form with no photo sends photo_url null and no photos, as before', async () => {
  const { inserts } = await runAdd([]);
  assert.equal(inserts[0].payload.photo_url, null);
  assert.ok(!('photos' in inserts[0].payload));
});

test('add form: a failed insert keeps the photos in the editor', async () => {
  const list = ['https://x/1.jpg'];
  const { g, els } = await runAdd(list, { insertError: { message: 'duplicate key' } });
  assert.deepEqual(g.list, list);
  assert.equal(els['add-msg'].className, 'msg error');
});

/** «ویرایش کامل» with stubs (as product-names.test.js), editor included. */
function editEnv(cached) {
  const updates = [];
  const els = {};
  const document = {
    getElementById: (id) => (/^sh-(list|sizes)-/.test(id) ? null : (els[id] ||= { value: '', textContent: '', className: '' })),
    querySelectorAll: () => [],
  };
  const sb = { from: () => ({ update: (fields) => ({ eq: async () => (updates.push(fields), { error: null }) }) }) };
  const fns = new Function(
    'document', 'sb', 'PRODUCTS_CACHE',
    [
      grab(adminJs, /const STYLE_OPTIONS = [^\n]*\n/),
      grab(adminJs, /const hasShadeTypes = [\s\S]*?;\n/),
      grab(adminJs, /const SHADE_TYPES = [^\n]*\n/),
      grab(adminJs, /const SHADE_NAME_MAX = [^\n]*\n/),
      ...['photoUploads', 'PHOTO_MAX_COUNT', 'photoGalleries'].map(constSrc),
      ...['escapeHtml', 'escapeAttr', 'toLatinDigits', 'unformatPrice', 'formatPrice', 'initialPhotos', 'mainPhoto', 'galleryFields', 'gallerySetCover', 'galleryPhotos',
        'withBaseSize', 'baseSizeOf', 'sizesToSave', 'baseRowHtml', 'variantRowHtml', 'shadeTypesOf', 'shadeModelOf', 'plainSizesBlockHtml', 'shadeBlockHtml', 'readShadeBlock', 'shadeFormToSave', 'shadesNeedMigration', 'faNum', 'saveProductFull'].map(fnSrc),
      'return { saveProductFull, photoGalleries, photoUploads };',
    ].join('\n')
  )(document, sb, [cached]);
  els[`f-name-fa-${cached.id}`] = { value: cached.name_fa };
  els[`f-name-en-${cached.id}`] = { value: '' };
  els[`f-style-${cached.id}`] = { value: '' };
  els[`f-height-${cached.id}`] = { value: '' };
  els[`f-photo-${cached.id}`] = { value: initialPhotosOf(cached)[0] || '' };
  /** Opens the editor the way wirePhotoGallery() does. */
  const open = () => {
    const g = gal(initialPhotosOf(cached));
    fns.photoGalleries[cached.id] = g;
    return g;
  };
  return { ...fns, els, updates, open, msg: () => els[`save-full-msg-${cached.id}`] };
}
const initialPhotosOf = (p) => env().initialPhotos(p);

const rosha = () => ({ id: 3, slug: 'rosha', name_fa: 'رشا', variants: [], colors: [], photo_url: 'images/rosha.jpg', photos: ['images/rosha.jpg', 'images/rosha-2.jpg', 'images/rosha-3.jpg', 'images/rosha-4.jpg'] });
const single = () => ({ id: 4, slug: 'lale', name_fa: 'لاله', variants: [], colors: [], photo_url: 'images/lale.jpg', photos: [] });

test('edit: a gallery or a single photo opens as it is, and saving untouched writes no photo field', async () => {
  for (const row of [rosha(), single(), { ...single(), photos: null }]) {
    const e = editEnv(row);
    const g = e.open();
    assert.deepEqual(g.list, row.photos && row.photos.length ? row.photos : [row.photo_url]);
    await e.saveProductFull(row.id);
    assert.equal(e.msg().textContent, 'ذخیره شد.');
    assert.ok(!('photos' in e.updates[0]) && !('photo_url' in e.updates[0]), 'nothing changes until she edits');
  }
});

test('edit saves the whole ordered list in one update, photo_url = photos[0], and the row is updated', async () => {
  const row = rosha();
  const e = editEnv(row);
  const g = e.open();
  g.list = ['images/rosha-3.jpg', 'images/rosha.jpg', 'https://x/new.jpg']; // reordered, one removed, one added
  e.els['f-photo-3'].value = 'images/rosha-3.jpg';
  await e.saveProductFull(3);
  assert.equal(e.updates.length, 1);
  assert.deepEqual(e.updates[0].photos, ['images/rosha-3.jpg', 'images/rosha.jpg', 'https://x/new.jpg']);
  assert.equal(e.updates[0].photo_url, 'images/rosha-3.jpg');
  assert.deepEqual(row.photos, e.updates[0].photos, 'the cached row now matches');
  assert.deepEqual(g.initial, e.updates[0].photos, 'the editor counts the list as saved');
});

test('edit: a single-photo product gets its first gallery; the manual address replaces the cover', async () => {
  const row = single();
  const e = editEnv(row);
  const g = e.open();
  g.list = ['images/lale.jpg', 'https://x/2.jpg'];
  await e.saveProductFull(4);
  assert.deepEqual(e.updates[0], { ...e.updates[0], photo_url: 'images/lale.jpg', photos: ['images/lale.jpg', 'https://x/2.jpg'] });

  const e2 = editEnv(single());
  e2.open();
  e2.els['f-photo-4'].value = 'images/lale-new.jpg';
  await e2.saveProductFull(4);
  assert.equal(e2.updates[0].photo_url, 'images/lale-new.jpg');
  assert.deepEqual(e2.updates[0].photos, ['images/lale-new.jpg']);
});

test('edit: removing the last photo of a product that has one is refused; saving waits for uploads', async () => {
  const e = editEnv(single());
  const g = e.open();
  g.list = [];
  e.els['f-photo-4'].value = '';
  await e.saveProductFull(4);
  assert.equal(e.updates.length, 0);
  assert.match(e.msg().textContent, /^خطا: محصول بدون عکس نمی‌ماند/);

  const e2 = editEnv(rosha());
  e2.open();
  e2.photoUploads.add(3);
  await e2.saveProductFull(3);
  assert.equal(e2.updates.length, 0);
  assert.equal(e2.msg().textContent, 'صبر کنید تا آپلود عکس‌ها تمام شود.');
});

// ---- the storefront reads the result --------------------------------------------

test('the storefront shows the saved list in order, cover first', () => {
  const photoChoice = grab(appJs, /const photos = \(p\.photos && p\.photos\.length \? p\.photos : \[p\.photo_url \|\| 'images\/' \+ p\.id \+ '\.jpg'\]\)\.map\(\s*proxiedPhotoUrl\s*\);/);
  const pick = new Function('location', 'window', configJs + '\nreturn (p) => { ' + photoChoice + ' return photos; };')({ origin: 'https://glow-home.ir' }, {});
  // as loadCatalog() maps a row
  const fromRow = (r) => ({ id: 'rosha', photo_url: r.photo_url || null, photos: Array.isArray(r.photos) && r.photos.length ? r.photos : null });
  const { galleryFields, newProductPhotoFields } = env();
  const saved = galleryFields(rosha(), [UP(9), 'images/rosha-2.jpg']);
  assert.deepEqual(pick(fromRow(saved)), ['https://glow-home.ir/sb/storage/v1/object/public/product-images/rosha-9.jpg', 'images/rosha-2.jpg']);
  const added = newProductPhotoFields(['https://x/1.jpg', 'https://x/2.jpg']);
  assert.deepEqual(pick(fromRow(added)), ['https://x/1.jpg', 'https://x/2.jpg']);
  // a new product with no photo: the shop falls back exactly as before
  assert.deepEqual(pick(fromRow({ ...newProductPhotoFields([]), photos: [] })), ['images/rosha.jpg']);
});
