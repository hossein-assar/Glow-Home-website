// Product names: the admin «ویرایش کامل» panel edits «نام فارسی» (required)
// and «نام انگلیسی (اختیاری)»; the storefront shows the English line only
// when name_en is filled in — never the Persian name again in its place.
// Runs the real functions, pulled out of the source text, with stubs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const adminJs = read('../../admin/admin.js');
const adminHtml = read('../../admin/index.html');
const appJs = read('../../app.js');

const grab = (src, re) => {
  const m = src.match(re);
  assert.ok(m, 'not found: ' + re);
  return m[0];
};
const fnSrc = (src, name) => grab(src, new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\n}\\n`));

// ---- admin --------------------------------------------------------------------

const row = { id: 7, slug: 'shade-embroidered-3', name_fa: 'شید گلدوزی شمسا', name_en: 'Embroidered Shade No.3', variants: [], colors: [], photo_url: 'images/x.jpg' };

function adminEnv(cached) {
  const updates = [];
  const els = {};
  const document = {
    getElementById: (id) => (els[id] ||= { value: '', textContent: '', className: '' }),
    querySelectorAll: () => [],
  };
  const sb = {
    from: () => ({
      update: (fields) => ({
        eq: async () => {
          updates.push(fields);
          return { error: null };
        },
      }),
    }),
  };
  const fns = new Function(
    'document', 'sb', 'PRODUCTS_CACHE',
    [
      grab(adminJs, /const STYLE_OPTIONS = [^\n]*\n/),
      grab(adminJs, /const hasShadeTypes = [\s\S]*?;\n/),
      grab(adminJs, /const SHADE_TYPES = [^\n]*\n/),
      grab(adminJs, /const shadeKeysOf = [\s\S]*?;\n/),
      grab(adminJs, /const photoUploads = [^\n]*\n/),
      ...['escapeHtml', 'escapeAttr', 'toLatinDigits', 'unformatPrice', 'formatPrice', 'mainPhoto', 'mainPhotoFields',
        'withBaseSize', 'baseSizeOf', 'sizesToSave', 'baseRowHtml',
        'variantRowHtml', 'shadeVariantRowHtml', 'editPanelHtml', 'rowHtml', 'saveProductFull'].map((n) => fnSrc(adminJs, n)),
      'const photoFieldHtml = () => "";',
      'const COLLECTION_LABEL = {};',
      'return { editPanelHtml, rowHtml, saveProductFull };',
    ].join('\n')
  )(document, sb, [cached]);
  return { ...fns, els, updates };
}

test('admin edit panel loads «نام فارسی» and «نام انگلیسی (اختیاری)» from the row', () => {
  const { editPanelHtml } = adminEnv(row);
  const html = editPanelHtml(row);
  assert.match(html, /<label>نام فارسی<\/label>\s*<input id="f-name-fa-7" value="شید گلدوزی شمسا">/);
  assert.match(html, /<label>نام انگلیسی \(اختیاری\)<\/label>\s*<input id="f-name-en-7" dir="ltr" value="Embroidered Shade No.3">/);
  assert.match(editPanelHtml({ ...row, name_en: null }), /id="f-name-en-7" dir="ltr" value=""/);
  assert.match(editPanelHtml({ ...row, name_fa: 'a"<b' }), /value="a&quot;&lt;b"/);
});

/** Fill the panel's inputs the way the browser would, then save. */
async function save(nameFa, nameEn) {
  const cached = { ...row };
  const env = adminEnv(cached);
  env.els['f-name-fa-7'] = { value: nameFa };
  env.els['f-name-en-7'] = { value: nameEn };
  env.els['f-style-7'] = { value: '' };
  env.els['f-photo-7'] = { value: 'images/x.jpg' };
  env.els['name-7'] = { textContent: row.name_fa };
  await env.saveProductFull(7);
  return { ...env, cached, msg: env.els['save-full-msg-7'] };
}

test('admin saves both names trimmed, and updates the table row', async () => {
  const { updates, cached, els, msg } = await save('  شید گلدوزی مهتاب ', ' Mahtab Embroidered Shade  ');
  assert.equal(updates.length, 1);
  assert.equal(updates[0].name_fa, 'شید گلدوزی مهتاب');
  assert.equal(updates[0].name_en, 'Mahtab Embroidered Shade');
  assert.equal(cached.name_en, 'Mahtab Embroidered Shade');
  assert.equal(els['name-7'].textContent, 'شید گلدوزی مهتاب');
  assert.equal(msg.textContent, 'ذخیره شد.');
});

test('admin saves an empty English name as empty (null)', async () => {
  for (const en of ['', '   ']) {
    const { updates } = await save('شید گلدوزی شمسا', en);
    assert.equal(updates[0].name_en, null);
  }
});

test('admin refuses to save an empty Persian name', async () => {
  for (const fa of ['', '   ']) {
    const { updates, msg } = await save(fa, 'Something');
    assert.equal(updates.length, 0);
    assert.equal(msg.textContent, 'خطا: نام فارسی را وارد کنید.');
    assert.equal(msg.className, 'msg error');
  }
});

test('add-product form: English name is labelled optional and saved empty as null', () => {
  assert.match(adminHtml, /<label>نام انگلیسی \(اختیاری\)<\/label><input id="new-name-en">/);
  assert.match(adminJs, /name_en: document\.getElementById\('new-name-en'\)\.value\.trim\(\) \|\| null,/);
});

// ---- storefront ---------------------------------------------------------------

const card = new Function(
  'state', 'byId', 'cardCartKey', 'icon', 'esc',
  `${fnSrc(appJs, 'media')}${fnSrc(appJs, 'card')} return card;`
)({ favs: {} }, () => null, () => null, () => '', (s) => String(s ?? ''));

const item = (en) => ({ id: 'shade-embroidered-3', fa: 'شید گلدوزی شمسا', en, col: 'shades', img: 'images/x.jpg', meta: '۲۰ سانتی‌متر · متقال', priceFa: '۱', inStock: true, variants: [] });

test('storefront card shows the English line only when name_en is filled in', () => {
  const empty = card(item(''));
  assert.doesNotMatch(empty, /latin-name/);
  assert.equal((empty.match(/شید گلدوزی شمسا/g) || []).length, 3); // name, alt text, photo placeholder — never as "English"
  const filled = card(item('Shamsa Embroidered Shade'));
  assert.match(filled, /<span class="latin-name">Shamsa Embroidered Shade<\/span>/);
});

test('storefront placeholder shows only the Persian name', () => {
  assert.doesNotMatch(appJs, /fb-latin/);
  assert.doesNotMatch(card(item('Shamsa Embroidered Shade')).match(/<div class="media-fallback">[\s\S]*?<\/div>/)[0], /Shamsa/);
});

test('storefront keeps an empty name_en empty: no fallback to the Persian name', () => {
  assert.doesNotMatch(appJs, /name_en \|\| r\.name_fa/);
  const toEn = new Function('r', `return ${grab(appJs, /String\(r\.name_en \?\? ''\)\.trim\(\)/)};`);
  assert.equal(toEn({ name_en: null, name_fa: 'گیسو' }), '');
  assert.equal(toEn({ name_en: '  ', name_fa: 'گیسو' }), '');
  assert.equal(toEn({ name_en: ' Gisoo ', name_fa: 'گیسو' }), 'Gisoo');
});

test('product page shows the English line only when name_en is filled in', () => {
  assert.match(appJs, /\$\{p\.en \? `<div class="latin-name" style="font-size:19px;margin-top:4px">\$\{esc\(p\.en\)\}<\/div>` : ''\}/);
});
