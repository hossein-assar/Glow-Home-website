const sb = getSupabaseClient();

const loginView = document.getElementById('login-view');
const appView = document.getElementById('app-view');
const notAdminView = document.getElementById('not-admin-view');
const offlineView = document.getElementById('offline-view');
const loginMsg = document.getElementById('login-msg');

const NETWORK_ERROR = 'اتصال به سرور برقرار نشد. لطفاً اتصال اینترنت را بررسی کنید و دوباره تلاش کنید.';

/** True when the request never got a real answer from Supabase (offline,
 * blocked, timed out, or the /sb proxy answered with an error page instead
 * of Supabase's JSON) — as opposed to Supabase answering with an error. */
function isNetworkError(error) {
  if (!error) return false;
  if (error.name === 'AuthRetryableFetchError' || error.name === 'AuthUnknownError') return true;
  if (error.status === 0 || [502, 503, 504].includes(error.status)) return true;
  const m = String(error.message || error.error || error);
  return /failed to fetch|networkerror|network request failed|load failed|fetch failed|err_|aborterror|aborted|timed? ?out|not valid json|unexpected token|router_external_target/i.test(m);
}

/** Text to show for a Supabase error: a readable Persian message for
 * connection problems, Supabase's own message otherwise. */
function adminErrorText(error) {
  return isNetworkError(error) ? NETWORK_ERROR : String((error && error.message) || error || '');
}

/** Puts NETWORK_ERROR and a «تلاش دوباره» button into `el`. */
function showRetry(el, retry, wrap = (html) => html) {
  el.innerHTML = wrap(
    `<span style="color:#b3432f">${escapeHtml(NETWORK_ERROR)}</span> <button class="btn ghost" type="button" style="padding:4px 12px">تلاش دوباره</button>`
  );
  el.querySelector('button').addEventListener('click', retry);
}

function showView(view) {
  for (const v of [loginView, appView, notAdminView, offlineView]) v.style.display = v === view ? 'block' : 'none';
}

document.getElementById('btn-signin').addEventListener('click', async () => {
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  if (!email || !password) {
    loginMsg.textContent = 'ایمیل و رمز عبور را وارد کنید.';
    loginMsg.className = 'msg error';
    return;
  }
  loginMsg.textContent = 'در حال بررسی...';
  loginMsg.className = 'msg';

  // Log in only. Admin accounts are created in the Supabase dashboard
  // (Authentication → Add user), never from this page.
  const { error } = await sb.auth.signInWithPassword({ email, password });

  if (error) {
    loginMsg.textContent = adminErrorText(error);
    loginMsg.className = 'msg error';
    return;
  }

  await checkAdminAndRender();
});

async function signOut() {
  await sb.auth.signOut();
  location.reload();
}
document.getElementById('btn-signout').addEventListener('click', signOut);
document.getElementById('btn-signout-2').addEventListener('click', signOut);

async function checkAdminAndRender() {
  const { data: { session } = {}, error: sessionError } = await sb.auth.getSession();
  if (isNetworkError(sessionError)) return showOffline();
  if (!session) return showView(loginView);

  const { data: profile, error } = await sb
    .from('profiles')
    .select('is_admin')
    .eq('id', session.user.id)
    .single();

  // A connection problem is not "not an admin": offer a retry instead.
  if (isNetworkError(error)) return showOffline();
  if (error || !profile || !profile.is_admin) return showView(notAdminView);

  showView(appView);
  loadProducts();
}

function showOffline() {
  document.getElementById('offline-msg').textContent = NETWORK_ERROR;
  showView(offlineView);
}
document.getElementById('btn-offline-retry').addEventListener('click', () => checkAdminAndRender());

/* ---- Tabs ------------------------------------------------------------- */

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    if (btn.dataset.tab === 'orders') loadOrders();
    if (btn.dataset.tab === 'discounts') loadCampaigns();
  });
});

/* ---- Products ----------------------------------------------------------
   Each row has a quick-edit strip (price / provisional / in stock — the
   things you change often) plus a "ویرایش کامل" toggle that reveals every
   other field (subcategory, style, material, height, description, colors,
   size variants, shades). Colors are a plain comma-separated list. Variants
   are a small repeatable height+price list, stored as the same
   [{height,price}] shape the storefront's size picker already reads.
   A product with shades («شیدها») lists them in products.shade_types
   ({key, name_fa, name_en, in_stock}, in display order — see
   supabase/migration-shade-types.sql) and each size stores the FULL price
   per shade: {height, price: <first shade>, shades: {<key>: price, …}}. */

const COLLECTION_LABEL = { lamps: 'آباژور', shades: 'شید', candles: 'شمع', decor: 'اکسسوری منزل' };
const STYLE_OPTIONS = ['', 'رومیزی', 'کنار سالنی'];

const hasShadeTypes = (p) =>
  Array.isArray(p.variants) && p.variants.some((v) => v && v.shades && typeof v.shades === 'object');

// The original three shade types: only the fallback for a row whose
// shade_types is still empty (same in app.js, api/orders.js, payment-server).
const SHADE_TYPES = { plain: 'شید ساده', embroidered: 'شید گلدوزی', macrame: 'شید مکرومه' };

// ⚠ Same function in app.js, api/orders.js and payment-server/src/pricing.js.
function shadeTypesOf(p) {
  const stored = Array.isArray(p.shade_types) ? p.shade_types : [];
  if (stored.length) {
    return stored
      .filter((t) => t && typeof t.key === 'string' && /^[a-z][a-z0-9]{0,31}$/.test(t.key) && String(t.name_fa ?? '').trim())
      .map((t) => ({ key: t.key, name_fa: String(t.name_fa).trim(), name_en: String(t.name_en ?? '').trim(), in_stock: t.in_stock !== false }));
  }
  const variants = Array.isArray(p.variants) ? p.variants : [];
  return Object.keys(SHADE_TYPES)
    .filter((k) => variants.some((v) => v && v.shades && typeof v.shades === 'object' && Object.hasOwn(v.shades, k)))
    .map((k) => ({ key: k, name_fa: SHADE_TYPES[k], name_en: '', in_stock: true }));
}

/* ---- Shades («شیدها») -----------------------------------------------------
   A product with shades shows its sizes as heights only, and one row per
   shade: Persian name (required), English name (optional), «موجود», and
   one FULL price per size (a one-size product has one «قیمت»). Adding the
   first shade to a product with plain sizes turns those sizes into shade
   prices (pre-filled with today's prices); deleting the last shade turns
   them back. The key never changes once made — cart keys use it — so a
   rename never breaks a cart; orders keep their own copy of the name and
   price (order_items), so no edit here ever changes an old order. */

const SHADE_NAME_MAX = 40;

/** A new shade key, unlike any in `taken`: "k" + 6 base-36 characters. */
function newShadeKey(taken) {
  let key;
  do key = 'k' + Math.random().toString(36).slice(2, 8).padEnd(6, '0');
  while (taken.includes(key));
  return key;
}

/** What «ذخیره همه» writes for a product with shades, from the form as
 * typed. sizes: the heights, one per size row. shades: [{ key, name_fa,
 * name_en, in_stock, prices: [one per size, same order] }]. baseHeight:
 * «ارتفاع پایه». Returns { variants, shade_types, price } — price is the
 * base size with the first shade, like `price` on each size — or { error }
 * in Persian. */
function shadeFormToSave({ sizes, shades, baseHeight }) {
  const num = (v) => {
    const t = String(toLatinDigits(v ?? '')).trim();
    return t === '' ? NaN : Number(t);
  };
  const heights = [];
  for (const raw of sizes) {
    const h = num(raw);
    if (!Number.isSafeInteger(h) || h <= 0) return { error: 'خطا: ارتفاع هر اندازه را به سانتی‌متر (عدد صحیح بزرگ‌تر از صفر) وارد کنید.' };
    if (heights.includes(h)) return { error: `خطا: اندازه‌ی ${h} سانتی‌متر دو بار آمده است. یکی را حذف کنید.` };
    heights.push(h);
  }
  if (!heights.length) return { error: 'خطا: دست‌کم یک اندازه لازم است.' };
  const base = num(baseHeight);
  if (!heights.includes(base)) return { error: 'خطا: «ارتفاع پایه» باید یکی از اندازه‌ها باشد.' };
  if (!shades.length) return { error: 'خطا: دست‌کم یک شید لازم است.' };

  const sameName = (n) => n.replace(/[\u200c\u200e\u200f]/g, '').replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').toLowerCase();
  const names = new Set();
  const keys = new Set();
  const shade_types = [];
  const prices = heights.map(() => ({}));
  for (const [n, s] of shades.entries()) {
    const name = String(s.name_fa ?? '').trim().replace(/\s+/g, ' ');
    if (!name) return { error: `خطا: نام فارسی شید ردیف ${faNum(n + 1)} را وارد کنید.` };
    if (name.length > SHADE_NAME_MAX) return { error: `خطا: نام شید «${name}» بیش از ${faNum(SHADE_NAME_MAX)} حرف است.` };
    if (names.has(sameName(name))) return { error: `خطا: شید «${name}» دو بار آمده است. نام هر شید باید متفاوت باشد.` };
    names.add(sameName(name));
    if (typeof s.key !== 'string' || !/^[a-z][a-z0-9]{0,31}$/.test(s.key) || keys.has(s.key)) {
      return { error: 'خطا: شناسه‌ی یکی از شیدها نامعتبر است. صفحه را دوباره باز کنید.' };
    }
    keys.add(s.key);
    for (const [i, h] of heights.entries()) {
      const price = num(unformatPrice(s.prices[i] ?? ''));
      if (!Number.isSafeInteger(price) || price <= 0) {
        return { error: `خطا: قیمت شید «${name}» برای اندازه‌ی ${h} سانتی‌متر را به تومان (عدد صحیح بزرگ‌تر از صفر) وارد کنید.` };
      }
      prices[i][s.key] = price;
    }
    const name_en = String(s.name_en ?? '').trim().replace(/\s+/g, ' ');
    if (name_en.length > SHADE_NAME_MAX) return { error: `خطا: نام انگلیسی شید «${name}» بیش از ${faNum(SHADE_NAME_MAX)} حرف است.` };
    shade_types.push({ key: s.key, name_fa: name, name_en, in_stock: !!s.in_stock });
  }
  const first = shade_types[0].key;
  const variants = heights.map((h, i) => ({ height: h, price: prices[i][first], shades: prices[i] }));
  return { variants, shade_types, price: variants[heights.indexOf(base)].price };
}

/** Before supabase/migration-shade-types.sql has run (no shade_types column
 * on the row) only the original three, unchanged, can be saved: their
 * prices still work through the fallback, a new or renamed shade would not. */
function shadesNeedMigration(row, shade_types) {
  if (row && 'shade_types' in row) return false;
  return !shade_types.every((t) => Object.hasOwn(SHADE_TYPES, t.key) && t.name_fa === SHADE_TYPES[t.key] && t.in_stock && !t.name_en);
}

/* ---- Price inputs --------------------------------------------------------
   Every price box is a text input (class "price-input") that shows thousands
   separators while typing (9,100,000). Persian/Arabic digits become English,
   anything else is dropped. Saving strips the separators again
   (unformatPrice), so the DB gets the same plain integers as before. */

function toLatinDigits(s) {
  return String(s ?? '').replace(/[۰-۹٠-٩]/g, (d) => {
    const fa = '۰۱۲۳۴۵۶۷۸۹'.indexOf(d);
    return String(fa !== -1 ? fa : '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
  });
}

/** Digits only ('' when there are none), e.g. '۹٬۱۰۰٬۰۰۰' → '9100000'. */
function unformatPrice(raw) {
  return toLatinDigits(raw).replace(/[^0-9]/g, '').slice(0, 15);
}

/** '9100000' / 9100000 / '۹۱۰۰۰۰۰' → '9,100,000'; '' stays ''. */
function formatPrice(raw) {
  const digits = unformatPrice(raw).replace(/^0+(?=[0-9])/, '');
  return digits.replace(/\B(?=([0-9]{3})+(?![0-9]))/g, ',');
}

/** Reformats a typed value and keeps the caret after the same digit. */
function reformatPriceInput(value, caret) {
  const digitsBefore = formatPrice(value.slice(0, caret)).replace(/,/g, '').length;
  const formatted = formatPrice(value);
  let pos = 0;
  for (let seen = 0; pos < formatted.length && seen < digitsBefore; pos++) {
    if (formatted[pos] !== ',') seen++;
  }
  return { value: formatted, caret: pos };
}

document.addEventListener('input', (e) => {
  const el = e.target;
  if (!el.classList || !el.classList.contains('price-input')) return;
  const { value, caret } = reformatPriceInput(el.value, el.selectionStart ?? el.value.length);
  if (value !== el.value) el.value = value;
  if (document.activeElement === el) el.setSelectionRange(caret, caret);
});

/* ---- Sizes: the base size is a row ---------------------------------------
   The size list is the COMPLETE list of sizes. Older rows stored only the
   *other* sizes in `variants`, so «مهتاب», base 40 / 3,500,000 with a list of
   one row (50 / 4,000,000), reached the shop as a single size and showed no
   size picker. The full-edit panel now shows the base size — «ارتفاع پایه»
   plus the price box in the row above — as the first row of the list,
   read-only and kept in step with those two fields as they are typed, and
   «ذخیره همه» writes it into the list along with the price. Shade-type
   products keep their own rows, where the base must already be a size. */

// ⚠ Same function in app.js, api/orders.js and payment-server/src/pricing.js.
function withBaseSize(variants, baseHeight, basePrice) {
  const list = Array.isArray(variants) ? variants : [];
  if (!list.length || list.some((v) => v && v.shades && typeof v.shades === 'object')) return list;
  const price = Number(basePrice);
  if (!Number.isSafeInteger(baseHeight) || baseHeight < 0 || !Number.isSafeInteger(price) || price <= 0) return list;
  if (list.some((v) => v && v.height === baseHeight)) return list;
  return [{ height: baseHeight, price }, ...list];
}

/** The base size row: { height, price } from «ارتفاع پایه» and the price
 * box, or null when either is missing or there is no other size — a product
 * with only its base size has no size list (and no size picker). */
function baseSizeOf(heightValue, priceValue, otherSizes) {
  const h = String(toLatinDigits(heightValue ?? '')).trim();
  const height = h === '' ? NaN : Number(h);
  const price = Number(unformatPrice(priceValue));
  if (!otherSizes || !Number.isSafeInteger(height) || height < 0 || !Number.isSafeInteger(price) || price <= 0) return null;
  return { height, price };
}

/** What «ذخیره همه» writes for a product without shade types: the base size
 * first, then the other rows (half-empty rows skipped, as before). A height
 * listed twice — including another row at the base height — is an error,
 * not a silent merge. Returns { variants, price? } or { error }. */
function sizesToSave(otherRows, heightValue, priceValue) {
  const others = otherRows
    .filter((r) => r.height !== '' && r.price !== '')
    .map((r) => ({ height: Number(r.height), price: Number(r.price) }));
  const base = baseSizeOf(heightValue, priceValue, others.length);
  const variants = base ? [{ height: base.height, price: base.price }, ...others] : others;
  const seen = new Set();
  for (const v of variants) {
    if (seen.has(v.height)) {
      return {
        error: `خطا: اندازه‌ی ${v.height} سانتی‌متر دو بار آمده است.` +
          (base && v.height === base.height ? ' این ارتفاع پایه است و ردیف اول فهرست — ردیف تکراری را حذف کنید.' : ' یکی را حذف کنید.'),
      };
    }
    seen.add(v.height);
  }
  return base ? { variants, price: base.price } : { variants };
}

// The base-size row follows «ارتفاع پایه» and the price box as they are typed.
document.addEventListener('input', (e) => {
  const m = /^(?:f-height|price)-(.+)$/.exec((e.target && e.target.id) || '');
  if (m) syncBaseRow(m[1]);
});

/** Adds, updates or removes the base-size row so it always matches the two
 * fields above it. No-op while the form has shades, or a closed panel. */
function syncBaseRow(id) {
  const list = document.getElementById(`variants-list-${id}`);
  const heightInput = document.getElementById(`f-height-${id}`);
  const p = PRODUCTS_CACHE.find((x) => x.id === id);
  if (!list || !heightInput || !p) return; // the list exists only without shades
  const others = list.querySelectorAll('.variant-row:not([data-base])').length;
  const base = baseSizeOf(heightInput.value, document.getElementById(`price-${id}`).value, others);
  const row = list.querySelector('.variant-row[data-base]');
  if (!base) {
    if (row) row.remove();
  } else if (row) {
    row.querySelector('.v-height').value = base.height;
    row.querySelector('.v-price').value = formatPrice(base.price);
  } else {
    list.insertAdjacentHTML('afterbegin', baseRowHtml(base.height, base.price));
  }
}

/* ---- Photo upload ----------------------------------------------------------
   Every file added to a gallery (see «Photo gallery» below) is
   checked, turned upright (the browser applies the EXIF orientation when
   decoding), shrunk to at most 1600 px on the longest side, re-encoded as
   JPEG 0.85 (a PNG with transparency stays PNG), and uploaded to the public
   Supabase Storage bucket «product-images» (supabase/migration-product-
   images-bucket.sql). Its public URL goes into the gallery; the product
   itself is only saved by the usual save button. Old files are never
   deleted. */

const PHOTO_BUCKET = 'product-images';
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const PHOTO_MAX_BYTES = 15 * 1024 * 1024;
const PHOTO_MAX_SIDE = 1600;
// Uploads go through our /sb proxy on Vercel; Vercel's documented request-body
// cap (for functions) is 4.5 MB, so stay under it after resizing.
const PHOTO_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;
const photoUploads = new Set(); // photo editors with an upload in flight

/** '' when the file may be processed, else a Persian error. */
function checkPhotoFile(file) {
  if (!file || !PHOTO_TYPES.includes(file.type)) return 'این فایل عکس نیست. فقط JPG، PNG یا WebP انتخاب کنید.';
  if (file.size > PHOTO_MAX_BYTES) return 'حجم عکس بیشتر از ۱۵ مگابایت است. عکس کوچک‌تری انتخاب کنید.';
  return '';
}

/** Fits width × height inside max × max, keeping the ratio; never enlarges. */
function fitWithin(width, height, max) {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Safe ASCII storage name: <slug or "product">-<timestamp>.<ext>. */
function photoFileName(slug, now, ext) {
  const base = String(slug ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return `${base || 'product'}-${now}.${ext === 'png' ? 'png' : 'jpg'}`;
}

/** Preview src for a stored path. Old relative paths ("images/x.jpg") are
 * relative to the site root, but this page lives under /admin/. */
function resolvePhotoSrc(path) {
  const p = proxiedPhotoUrl(path); // supabase.co storage URLs load through /sb
  if (!p) return '';
  if (/^https?:\/\//i.test(p) || p.startsWith('/')) return p;
  return '/' + p;
}

async function decodePhoto(file) {
  if (window.createImageBitmap) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // fall through to <img>, which also applies EXIF orientation
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Resized, upright, re-encoded photo: { blob, ext, type }. */
async function preparePhoto(file) {
  const src = await decodePhoto(file);
  const { width, height } = fitWithin(src.width, src.height, PHOTO_MAX_SIDE);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(src, 0, 0, width, height);

  let keepPng = false;
  if (file.type === 'image/png') {
    const data = ctx.getImageData(0, 0, width, height).data;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 255) {
        keepPng = true;
        break;
      }
    }
  }
  if (!keepPng) {
    // JPEG has no transparency: put any see-through pixels on white, not black.
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
  }
  const type = keepPng ? 'image/png' : 'image/jpeg';
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, 0.85));
  if (!blob) throw new Error('canvas.toBlob returned null');
  return { blob, ext: keepPng ? 'png' : 'jpg', type };
}

function photoUploadError(error) {
  const m = String((error && (error.message || error.error)) || '');
  if (/bucket not found/i.test(m)) return 'فضای عکس‌ها هنوز ساخته نشده است. با پشتیبانی فنی تماس بگیرید.';
  if (/row-level security|unauthorized|not allowed|403/i.test(m)) return 'اجازه‌ی آپلود ندارید. دوباره وارد پنل شوید.';
  if (/size|too large|413/i.test(m)) return 'حجم عکس بعد از فشرده‌سازی هنوز زیاد است. عکس دیگری انتخاب کنید.';
  return 'آپلود انجام نشد. اتصال اینترنت را بررسی کنید و دوباره تلاش کنید.';
}

/* ---- Photo gallery ----------------------------------------------------------
   One editor for «افزودن محصول» and «ویرایش کامل»: a row of thumbnails, the
   first one the cover («عکس اصلی», what the shop shows first). «افزودن عکس»
   (several files at once, or drag and drop) sends each file through the
   pipeline above, one at a time; a file that fails shows its own error and
   never stops the others. Each thumbnail has «حذف», «انتقال به قبل/بعد» and
   (all but the cover) «انتخاب به عنوان عکس اصلی». Saving writes the whole
   ordered list in one update with photo_url = photos[0]; removing a photo
   only takes it off the product (the file stays in the bucket). The
   storefront has no limit; the editor stops at PHOTO_MAX_COUNT. */

const PHOTO_MAX_COUNT = 8;
const photoGalleries = {}; // key ("new" or a product id) → { list, pending, errors, queue, render }

/** The product's photos in shop order: photos when there are any, else
 * [photo_url], else [] (the same rule as app.js). */
function initialPhotos(p) {
  const photos = Array.isArray(p && p.photos) ? p.photos.map((s) => String(s ?? '').trim()).filter(Boolean) : [];
  if (photos.length) return photos;
  const url = String((p && p.photo_url) || '').trim();
  return url ? [url] : [];
}

/** The photo the storefront shows first. */
function mainPhoto(p) {
  return initialPhotos(p)[0] || '';
}

/** Adds url at the end; unchanged when full, empty or already there. */
function galleryAdd(list, url) {
  const u = String(url ?? '').trim();
  if (!u || list.includes(u) || list.length >= PHOTO_MAX_COUNT) return list;
  return [...list, u];
}

function galleryRemove(list, i) {
  return i >= 0 && i < list.length ? list.filter((_, j) => j !== i) : list;
}

/** Moves photo i by delta (-1 earlier, +1 later); unchanged at either end. */
function galleryMove(list, i, delta) {
  const j = i + delta;
  if (i < 0 || i >= list.length || j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/** Photo i becomes the cover; the others keep their order. */
function galleryMakeCover(list, i) {
  if (i <= 0 || i >= list.length) return list;
  return [list[i], ...list.filter((_, j) => j !== i)];
}

/** «آدرس دستی (پیشرفته)»: the typed address replaces the cover (or becomes
 * it on an empty list); emptied, the cover is removed. Same value: unchanged. */
function gallerySetCover(list, url) {
  const u = String(url ?? '').trim();
  if (u === (list[0] || '')) return list;
  if (!u) return list.slice(1);
  const rest = list.slice(1).filter((x) => x !== u);
  return [u, ...rest].slice(0, PHOTO_MAX_COUNT);
}

/** How many more files fit, counting uploads still in flight. */
function galleryRoom(list, pending = 0) {
  return Math.max(0, PHOTO_MAX_COUNT - list.length - pending);
}

function galleryLimitMessage(skipped) {
  return `هر محصول حداکثر ${faNum(PHOTO_MAX_COUNT)} عکس دارد؛ ${faNum(skipped)} عکس اضافه نشد.`;
}

/** Fields for «ویرایش کامل»: the whole ordered list and its cover in one
 * update, or null when the list is what the product already has. */
function galleryFields(p, list) {
  const clean = list.map((s) => String(s ?? '').trim()).filter(Boolean);
  const before = initialPhotos(p || {});
  if (clean.length === before.length && clean.every((u, i) => u === before[i])) return null;
  return { photo_url: clean[0] || null, photos: clean };
}

/** Fields for «افزودن محصول»: no photo → photo_url null as before (photos
 * keeps its database default); else the list and its cover. */
function newProductPhotoFields(list) {
  const clean = list.map((s) => String(s ?? '').trim()).filter(Boolean);
  return clean.length ? { photo_url: clean[0], photos: clean } : { photo_url: null };
}

/** The list to save: the editor's list with the manual cover address
 * applied, or the row's own photos when no editor is open. */
function galleryPhotos(key, urlInputId, row) {
  const g = photoGalleries[key];
  if (!g) return initialPhotos(row || {});
  const input = document.getElementById(urlInputId);
  if (input) g.list = gallerySetCover(g.list, input.value);
  return [...g.list];
}

let lastPhotoStamp = 0;

/** One file through the pipeline: { url } or { error } (Persian). Never throws. */
async function uploadPhotoFile(file, slug) {
  const problem = checkPhotoFile(file);
  if (problem) return { error: problem };
  let prepared;
  try {
    prepared = await preparePhoto(file);
  } catch (err) {
    console.error('[admin] photo decode failed:', err);
    return { error: 'این عکس باز نشد. فایل دیگری را امتحان کنید.' };
  }
  if (prepared.blob.size > PHOTO_UPLOAD_MAX_BYTES) {
    return { error: 'حجم عکس بعد از فشرده‌سازی هنوز زیاد است. عکس دیگری انتخاب کنید.' };
  }
  try {
    // A fresh name for every file, even two in the same millisecond.
    lastPhotoStamp = Math.max(Date.now(), lastPhotoStamp + 1);
    const name = photoFileName(slug, lastPhotoStamp, prepared.ext);
    const { error } = await sb.storage
      .from(PHOTO_BUCKET)
      .upload(name, prepared.blob, { contentType: prepared.type, cacheControl: '31536000', upsert: false });
    if (error) {
      console.error('[admin] photo upload failed:', error);
      return { error: photoUploadError(error) };
    }
    // Store the canonical supabase.co URL (the client's own URL is this
    // site's /sb proxy); previews and the shop rewrite it for display.
    const { data } = sb.storage.from(PHOTO_BUCKET).getPublicUrl(name);
    return { url: canonicalPhotoUrl(data.publicUrl) };
  } catch (err) {
    console.error('[admin] photo upload failed:', err);
    return { error: photoUploadError(err) };
  }
}

/** Queues files on gallery g: as many as fit, one upload at a time, each
 * success added in order, each failure listed by file name. `upload` is
 * uploadPhotoFile; `onChange` re-renders. Resolves when this batch is done. */
function addPhotoFiles(key, g, files, slug, upload, onChange) {
  files = [...files];
  if (!g.pending.length) g.errors = [];
  const take = files.slice(0, galleryRoom(g.list, g.pending.length));
  if (files.length > take.length) g.errors.push(galleryLimitMessage(files.length - take.length));
  const jobs = take.map((file) => ({ name: String((file && file.name) || 'عکس'), state: 'waiting' }));
  if (jobs.length) {
    g.pending.push(...jobs);
    photoUploads.add(key);
  }
  onChange();
  take.forEach((file, i) => {
    const job = jobs[i];
    g.queue = g.queue.then(async () => {
      job.state = 'uploading';
      onChange();
      let result;
      try {
        result = await upload(file, slug);
      } catch (err) {
        result = { error: photoUploadError(err) };
      }
      g.pending = g.pending.filter((j) => j !== job);
      if (result && result.url) {
        const next = galleryAdd(g.list, result.url);
        if (next === g.list && !g.list.includes(result.url)) g.errors.push(`«${job.name}»: ${galleryLimitMessage(1)}`);
        g.list = next;
      } else {
        g.errors.push(`«${job.name}»: ${(result && result.error) || photoUploadError(null)}`);
      }
      if (!g.pending.length) photoUploads.delete(key);
      onChange();
    });
  });
  return g.queue;
}

/** The thumbnails, the files in flight and the «افزودن عکس» tile. */
function galleryHtml(list, pending = []) {
  const last = list.length - 1;
  const tiles = list.map(
    (url, i) => `
      <div class="pg-tile${i === 0 ? ' cover' : ''}" data-i="${i}">
        <div class="pg-img">
          <img src="${escapeAttr(resolvePhotoSrc(url))}" alt="عکس ${faNum(i + 1)}">
          <span class="pg-broken">نمایش داده نمی‌شود</span>
          ${i === 0 ? '<span class="pg-cover-badge">عکس اصلی</span>' : ''}
        </div>
        <div class="pg-actions">
          <button type="button" class="pg-btn" data-g="earlier" data-i="${i}" aria-label="انتقال به قبل" title="انتقال به قبل" ${i === 0 ? 'disabled' : ''}>→</button>
          <button type="button" class="pg-btn" data-g="later" data-i="${i}" aria-label="انتقال به بعد" title="انتقال به بعد" ${i === last ? 'disabled' : ''}>←</button>
          <button type="button" class="pg-btn pg-remove" data-g="remove" data-i="${i}">حذف</button>
        </div>
        ${i > 0 ? `<button type="button" class="pg-btn pg-make-cover" data-g="cover" data-i="${i}">انتخاب به عنوان عکس اصلی</button>` : ''}
      </div>`
  );
  const waiting = pending.map(
    (job) => `
      <div class="pg-tile pending">
        <div class="pg-img"><span class="pg-wait">${job.state === 'uploading' ? 'در حال آپلود…' : 'در صف آپلود'}<small dir="auto">${escapeHtml(job.name)}</small></span></div>
      </div>`
  );
  const full = !galleryRoom(list, pending.length);
  const add = full
    ? `<div class="pg-full">به حداکثر ${faNum(PHOTO_MAX_COUNT)} عکس رسیده‌اید. برای عکس تازه، یکی را حذف کنید.</div>`
    : `<button type="button" class="pg-add" data-g="add"><span class="pg-plus">+</span>افزودن عکس<small>چند عکس با هم، یا اینجا رها کنید</small></button>`;
  return [...tiles, ...waiting, add].join('');
}

/** The editor's frame; wirePhotoGallery() fills the thumbnails. The URL
 * input (id = urlInputId) holds the cover's address, as before. */
function photoGalleryFieldHtml(key, urlInputId, photos) {
  return `
    <div class="photo-gallery" id="pg-${key}">
      <div class="pg-thumbs" id="pg-thumbs-${key}">${galleryHtml(photos)}</div>
      <input type="file" id="pg-file-${key}" accept="image/jpeg,image/png,image/webp" multiple hidden>
      <div class="pg-hint">عکس اول، عکس اصلی است (همان که در فروشگاه اول دیده می‌شود). حداکثر ${faNum(PHOTO_MAX_COUNT)} عکس.</div>
      <div class="msg" id="pg-status-${key}" role="status" aria-live="polite"></div>
      <ul class="pg-errors" id="pg-errors-${key}"></ul>
      <details class="photo-manual">
        <summary>آدرس دستی (پیشرفته)</summary>
        <span class="pg-hint">آدرس عکس اصلی</span>
        <input id="${urlInputId}" dir="ltr" value="${escapeAttr(photos[0] || '')}" placeholder="images/xxx.jpg">
      </details>
    </div>`;
}

/** Wires a rendered editor. slugOf() gives the product slug for file names. */
function wirePhotoGallery(key, urlInputId, slugOf, photos) {
  const root = document.getElementById(`pg-${key}`);
  const thumbs = document.getElementById(`pg-thumbs-${key}`);
  const fileInput = document.getElementById(`pg-file-${key}`);
  const status = document.getElementById(`pg-status-${key}`);
  const errors = document.getElementById(`pg-errors-${key}`);
  const urlInput = document.getElementById(urlInputId);
  const g = (photoGalleries[key] = { list: [...photos], initial: [...photos], pending: [], errors: [], queue: Promise.resolve() });

  g.render = () => {
    thumbs.innerHTML = galleryHtml(g.list, g.pending);
    if (document.activeElement !== urlInput) urlInput.value = g.list[0] || '';
    errors.innerHTML = g.errors.map((e) => `<li>${escapeHtml(e)}</li>`).join('');
    if (g.pending.length) {
      status.textContent = `در حال آپلود… ${faNum(g.pending.length)} عکس مانده. صبر کنید تا تمام شود.`;
      status.className = 'msg';
    } else if (g.list.join('\n') !== g.initial.join('\n')) {
      status.textContent = 'برای ثبت تغییر عکس‌ها، محصول را ذخیره کنید.';
      status.className = 'msg ok';
    } else {
      status.textContent = '';
      status.className = 'msg';
    }
  };
  const change = (next) => {
    g.list = next;
    g.render();
  };
  const addFiles = (files) => {
    if (!files || !files.length) return;
    addPhotoFiles(key, g, files, slugOf(), uploadPhotoFile, g.render);
  };

  thumbs.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-g]');
    if (!btn || btn.disabled) return;
    const i = Number(btn.dataset.i);
    const act = btn.dataset.g;
    if (act === 'add') fileInput.click();
    else if (act === 'remove') change(galleryRemove(g.list, i));
    else if (act === 'earlier') change(galleryMove(g.list, i, -1));
    else if (act === 'later') change(galleryMove(g.list, i, 1));
    else if (act === 'cover') change(galleryMakeCover(g.list, i));
  });
  // A thumbnail whose address doesn't load says so instead of a broken icon.
  thumbs.addEventListener('error', (e) => {
    const tile = e.target.closest && e.target.closest('.pg-tile');
    if (tile) tile.classList.add('broken');
  }, true);
  fileInput.addEventListener('change', () => {
    const files = [...fileInput.files];
    fileInput.value = '';
    addFiles(files);
  });
  urlInput.addEventListener('change', () => change(gallerySetCover(g.list, urlInput.value)));
  root.addEventListener('dragover', (e) => {
    e.preventDefault();
    root.classList.add('dragging');
  });
  root.addEventListener('dragleave', (e) => {
    if (!root.contains(e.relatedTarget)) root.classList.remove('dragging');
  });
  root.addEventListener('drop', (e) => {
    e.preventDefault();
    root.classList.remove('dragging');
    addFiles(e.dataTransfer && e.dataTransfer.files);
  });
  g.render();
  return g;
}

/** Empties an editor (after «افزودن محصول» succeeds). */
function resetPhotoGallery(key) {
  const g = photoGalleries[key];
  if (!g) return;
  g.list = [];
  g.initial = [];
  g.errors = [];
  g.render();
}

// A photo dropped next to (not onto) an editor must not make the browser
// leave the panel to open the image.
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

document.getElementById('new-photo-field').innerHTML = photoGalleryFieldHtml('new', 'new-photo', []);
wirePhotoGallery('new', 'new-photo', () => document.getElementById('new-slug').value, []);

let PRODUCTS_CACHE = [];
let productSearchTerm = '';

async function loadProducts() {
  const tbody = document.getElementById('products-tbody');
  tbody.innerHTML = '<tr><td colspan="7">در حال بارگذاری...</td></tr>';

  const { data, error } = await sb
    .from('products')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false });

  if (error) {
    if (isNetworkError(error)) return showRetry(tbody, loadProducts, (html) => `<tr><td colspan="7">${html}</td></tr>`);
    tbody.innerHTML = `<tr><td colspan="7" style="color:#b3432f">خطا: ${escapeHtml(error.message)}</td></tr>`;
    return;
  }

  PRODUCTS_CACHE = data || [];
  renderProductsTable();
}

// Client-side only — PRODUCTS_CACHE is already the full list (loadProducts()
// doesn't paginate), so there's no reason to round-trip Supabase again just
// to filter what's already sitting in memory.
function filteredProducts() {
  const q = productSearchTerm.trim().toLowerCase();
  if (!q) return PRODUCTS_CACHE;
  return PRODUCTS_CACHE.filter((p) => {
    const haystack = [p.name_fa, p.name_en, p.slug, COLLECTION_LABEL[p.collection] || p.collection]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(q);
  });
}

function renderProductsTable() {
  const tbody = document.getElementById('products-tbody');

  if (!PRODUCTS_CACHE.length) {
    tbody.innerHTML = '<tr><td colspan="7">هنوز محصولی ثبت نشده.</td></tr>';
    return;
  }

  const list = filteredProducts();
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="7">نتیجه‌ای یافت نشد.</td></tr>';
    return;
  }

  tbody.innerHTML = list.map(rowHtml).join('');

  list.forEach((p) => {
    document.getElementById(`save-${p.id}`).addEventListener('click', () => saveProduct(p.id));
    document.getElementById(`del-${p.id}`).addEventListener('click', () => deleteProduct(p.id, p.name_fa));
    document.getElementById(`toggle-${p.id}`).addEventListener('click', () => toggleEdit(p.id));
  });
}

document.getElementById('product-search').addEventListener('input', (e) => {
  productSearchTerm = e.target.value;
  renderProductsTable();
});

function rowHtml(p) {
  return `
    <tr data-id="${p.id}">
      <td>
        <div style="font-weight:600" id="name-${p.id}">${escapeHtml(p.name_fa)}</div>
        <div style="color:#8a7d6e; font-size:12px">${escapeHtml(p.slug)}</div>
        <button class="link-btn" id="toggle-${p.id}" style="padding:2px 0">ویرایش کامل ▾</button>
      </td>
      <td>${COLLECTION_LABEL[p.collection] || escapeHtml(p.collection)}</td>
      <td><input type="text" inputmode="numeric" dir="ltr" class="price-input" id="price-${p.id}" value="${formatPrice(p.price)}" style="width:120px"></td>
      <td class="checkbox-cell"><input type="checkbox" id="prov-${p.id}" ${p.price_provisional ? 'checked' : ''}></td>
      <td class="checkbox-cell"><input type="checkbox" id="stock-${p.id}" ${p.in_stock ? 'checked' : ''}></td>
      <td class="narrow"><button class="btn ghost" id="save-${p.id}" style="padding:6px 12px">ذخیره</button></td>
      <td class="narrow"><button class="btn danger" id="del-${p.id}" style="padding:6px 12px">حذف</button></td>
    </tr>
    <tr id="edit-wrap-${p.id}" style="display:none">
      <td colspan="7" style="padding:0; border:0">
        <div class="edit-panel" id="edit-panel-${p.id}"></div>
      </td>
    </tr>`;
}

function editPanelHtml(p) {
  const variants = Array.isArray(p.variants) ? p.variants : [];
  const colors = Array.isArray(p.colors) ? p.colors.join('، ') : '';
  return `
    <tr class="edit-row" id="edit-row-${p.id}">
      <td colspan="7">
        <div class="edit-grid" style="margin-bottom:10px">
          <div>
            <label>نام فارسی</label>
            <input id="f-name-fa-${p.id}" value="${escapeAttr(p.name_fa || '')}">
          </div>
          <div>
            <label>نام انگلیسی (اختیاری)</label>
            <input id="f-name-en-${p.id}" dir="ltr" value="${escapeAttr(p.name_en || '')}">
          </div>
          <div></div>
        </div>
        <div class="edit-grid">
          <div>
            <label>زیردسته (جنس بدنه)</label>
            <input id="f-subcategory-${p.id}" value="${escapeAttr(p.subcategory || '')}">
          </div>
          <div>
            <label>محل قرارگیری</label>
            <select id="f-style-${p.id}">
              ${STYLE_OPTIONS.map(
                (s) => `<option value="${escapeAttr(s)}" ${p.style === s ? 'selected' : ''}>${s || '—'}</option>`
              ).join('')}
            </select>
          </div>
          <div>
            <label>جنس</label>
            <input id="f-material-${p.id}" value="${escapeAttr(p.material || '')}">
          </div>
          <div>
            <label>ارتفاع پایه (سانتی‌متر)</label>
            <input id="f-height-${p.id}" type="number" value="${p.height_cm ?? ''}">
          </div>
          <div>
            <label>رنگ‌ها (با ویرگول فارسی یا انگلیسی جدا کنید)</label>
            <input id="f-colors-${p.id}" value="${escapeAttr(colors)}" placeholder="مثلاً: یاسی، سبز، آبی">
          </div>
          <div></div>
        </div>
        <div class="edit-grid" style="margin-top:10px">
          <div>
            <label>اندازه بدنه (سانتی‌متر)</label>
            <input id="f-body-size-${p.id}" value="${escapeAttr(p.body_size || '')}" placeholder="مثلاً: ارتفاع ۱۰ / قطر ۲۵">
          </div>
          <div>
            <label>اندازه شید (سانتی‌متر)</label>
            <input id="f-shade-size-${p.id}" value="${escapeAttr(p.shade_size || '')}" placeholder="مثلاً: قطر ۳۵ / ارتفاع ۲۰">
          </div>
          <div></div>
        </div>
        <div class="edit-grid wide" style="margin-top:10px">
          <div>
            <label>عکس‌ها</label>
            ${photoGalleryFieldHtml(p.id, `f-photo-${p.id}`, initialPhotos(p))}
          </div>
        </div>
        <div class="edit-grid wide" style="margin-top:10px">
          <div>
            <label>توضیحات</label>
            <input id="f-desc-${p.id}" value="${escapeAttr(p.description || '')}">
          </div>
        </div>
        <div id="sizes-block-${p.id}" style="margin-top:14px">${
          hasShadeTypes(p)
            ? shadeBlockHtml(p.id, shadeModelOf(p))
            : plainSizesBlockHtml(p.id, variants, p.height_cm, p.price)
        }</div>
        <div style="margin-top:16px">
          <button class="btn" id="save-full-${p.id}">ذخیره همه</button>
          <span id="save-full-msg-${p.id}" class="msg" style="display:inline-block"></span>
        </div>
      </td>
    </tr>`;
}

/** The base size, read-only: it is «ارتفاع پایه» and the price box above,
 * and changes with them. No «حذف» — to drop it, change the base height. */
function baseRowHtml(height, price) {
  return `
    <div class="variant-row" data-base="1">
      <input type="number" class="v-height" value="${height}" readonly tabindex="-1">
      <input type="text" inputmode="numeric" dir="ltr" class="v-price price-input" value="${formatPrice(price)}" readonly tabindex="-1">
      <span style="color:#8a7d6e; font-size:12px">اندازه پایه — از «ارتفاع پایه» و قیمت بالا</span>
    </div>`;
}

function variantRowHtml(pid, i, height, price) {
  return `
    <div class="variant-row" data-idx="${i}">
      <input type="number" placeholder="ارتفاع (سانتی‌متر)" class="v-height" value="${height ?? ''}">
      <input type="text" inputmode="numeric" dir="ltr" placeholder="قیمت (تومان)" class="v-price price-input" value="${formatPrice(price)}">
      <button class="btn ghost remove-variant" type="button">حذف</button>
    </div>`;
}

/** A stored product with shades as the form's model (see shadeBlockHtml):
 * its sizes in order, and each shade with its price per size ('' where a
 * size has none — the form then asks for it). */
function shadeModelOf(p) {
  const sizes = (Array.isArray(p.variants) ? p.variants : []).filter((v) => v && v.shades && typeof v.shades === 'object');
  return {
    sizes: sizes.map((v) => String(v.height)),
    shades: shadeTypesOf(p).map((t) => ({ ...t, prices: sizes.map((v) => (Object.hasOwn(v.shades, t.key) ? v.shades[t.key] : '')) })),
  };
}

/** Sizes with a price each, for a product without shades (the base size
 * first, read-only — see "Sizes" above), and the «شیدها» heading with its
 * «+ افزودن شید» button. A stored row at the base height IS the base row. */
function plainSizesBlockHtml(id, variants, baseHeight, basePrice) {
  const otherSizes = withBaseSize(variants, baseHeight, basePrice).filter((v) => v.height !== baseHeight);
  const baseSize = baseSizeOf(baseHeight, basePrice, otherSizes.length);
  return `
          <label>اندازه‌ها و قیمت هر اندازه (در صورت وجود چند سایز)</label>
          <div id="variants-list-${id}">
            ${baseSize ? baseRowHtml(baseSize.height, baseSize.price) : ''}${otherSizes
              .map((v, i) => variantRowHtml(id, i, v.height, v.price))
              .join('')}
          </div>
          <button class="link-btn" id="add-variant-${id}" type="button">+ افزودن اندازه</button>
          <div class="shades-head">
            <label>شیدها</label>
            <span class="hint">این محصول شید ندارد. با افزودن شید، برای هر شید (و هر اندازه) قیمت کامل جدا وارد می‌کنید.</span>
          </div>
          <button class="link-btn" id="add-shade-${id}" type="button">+ افزودن شید</button>`;
}

/** Sizes (heights only) and one row per shade with a full price per size.
 * model: { sizes: [height as typed], shades: [{ key, name_fa, name_en,
 * in_stock, prices: [one per size] }] }. Every value is escaped. */
function shadeBlockHtml(id, model) {
  const sizeLabel = (h) => (String(h).trim() ? `${escapeHtml(String(h).trim())} سانتی‌متر` : 'اندازه‌ی جدید');
  return `
          <label>اندازه‌ها (سانتی‌متر)</label>
          <div id="sh-sizes-${id}">
            ${model.sizes
              .map(
                (h, i) => `
            <div class="variant-row sh-size-row" data-idx="${i}">
              <input type="number" placeholder="ارتفاع (سانتی‌متر)" class="v-height" value="${escapeAttr(h)}">
              <button class="btn ghost remove-size" type="button">حذف</button>
            </div>`
              )
              .join('')}
          </div>
          <button class="link-btn" id="add-size-${id}" type="button">+ افزودن اندازه</button>
          <div class="shades-head">
            <label>شیدها</label>
            <span class="hint">قیمت کامل محصول با هر شید، برای هر اندازه (تومان). حذف یا تغییر نام شید، سفارش‌های قبلی را تغییر نمی‌دهد.</span>
          </div>
          <div id="sh-list-${id}">
            ${model.shades
              .map(
                (s) => `
            <div class="shade-row" data-key="${escapeAttr(s.key)}">
              <div class="shade-row-head">
                <input class="s-name-fa" placeholder="نام شید (فارسی)" maxlength="${SHADE_NAME_MAX}" value="${escapeAttr(s.name_fa || '')}">
                <input class="s-name-en" dir="ltr" placeholder="English name (اختیاری)" maxlength="${SHADE_NAME_MAX}" value="${escapeAttr(s.name_en || '')}">
                <label class="s-stock"><input type="checkbox" class="s-in-stock" ${s.in_stock !== false ? 'checked' : ''}> موجود</label>
                <button class="btn ghost remove-shade" type="button">حذف</button>
              </div>
              <div class="shade-prices">
                ${model.sizes
                  .map(
                    (h, i) => `
                <label class="s-price-cell" data-idx="${i}">
                  <span>${model.sizes.length > 1 ? 'قیمت — ' + sizeLabel(h) : 'قیمت'}</span>
                  <input type="text" inputmode="numeric" dir="ltr" class="s-price price-input" data-idx="${i}" placeholder="قیمت (تومان)" value="${formatPrice(s.prices[i] ?? '')}">
                </label>`
                  )
                  .join('')}
              </div>
            </div>`
              )
              .join('')}
          </div>
          <button class="link-btn" id="add-shade-${id}" type="button">+ افزودن شید</button>`;
}

/** The shade block as typed, in the shape shadeBlockHtml() and
 * shadeFormToSave() take. */
function readShadeBlock(id) {
  const sizes = [...document.querySelectorAll(`#sh-sizes-${id} .sh-size-row .v-height`)].map((i) => i.value);
  const shades = [...document.querySelectorAll(`#sh-list-${id} .shade-row`)].map((row) => ({
    key: row.dataset.key,
    name_fa: row.querySelector('.s-name-fa').value,
    name_en: row.querySelector('.s-name-en').value,
    in_stock: row.querySelector('.s-in-stock').checked,
    prices: sizes.map((_, i) => {
      const input = row.querySelector(`.s-price[data-idx="${i}"]`);
      return input ? input.value : '';
    }),
  }));
  return { sizes, shades };
}

/** Re-draws the sizes/shades block and wires its buttons. */
function renderSizesBlock(id, html) {
  document.getElementById(`sizes-block-${id}`).innerHTML = html;
  wireSizesBlock(id);
}

function wireSizesBlock(id) {
  const msg = () => document.getElementById(`save-full-msg-${id}`);
  const plainList = document.getElementById(`variants-list-${id}`);
  if (plainList) {
    // No shades: sizes with a price each, as before.
    document.getElementById(`add-variant-${id}`).addEventListener('click', () => {
      plainList.insertAdjacentHTML('beforeend', variantRowHtml(id, plainList.children.length, '', ''));
      // The first added size brings the base size in with it, as row one.
      syncBaseRow(id);
      wireVariantRemove(plainList, () => syncBaseRow(id));
    });
    wireVariantRemove(plainList, () => syncBaseRow(id));
    // The first shade: today's sizes and prices become its prices.
    document.getElementById(`add-shade-${id}`).addEventListener('click', () => {
      const baseHeight = document.getElementById(`f-height-${id}`).value.trim();
      if (!baseHeight) {
        msg().textContent = 'خطا: برای افزودن شید، اول «ارتفاع پایه» را وارد کنید.';
        msg().className = 'msg error';
        return;
      }
      const others = [...plainList.querySelectorAll('.variant-row:not([data-base])')]
        .map((row) => ({ height: row.querySelector('.v-height').value.trim(), price: row.querySelector('.v-price').value }))
        .filter((r) => r.height !== '' && r.height !== baseHeight);
      const sizes = [{ height: baseHeight, price: document.getElementById(`price-${id}`).value }, ...others];
      renderSizesBlock(id, shadeBlockHtml(id, {
        sizes: sizes.map((x) => x.height),
        shades: [{ key: newShadeKey([]), name_fa: '', name_en: '', in_stock: true, prices: sizes.map((x) => x.price) }],
      }));
      msg().textContent = '';
    });
    return;
  }

  // With shades.
  const redraw = (change) => {
    const model = readShadeBlock(id);
    change(model);
    if (!model.shades.length) {
      // The last shade is gone: back to sizes with a price each — the
      // removed shade's prices, the base size's in the price box above.
      const removed = model.removed;
      const prices = removed ? removed.prices : [];
      const baseHeight = Number(document.getElementById(`f-height-${id}`).value);
      const variants = model.sizes
        .map((h, i) => ({ height: Number(h), price: Number(unformatPrice(prices[i] ?? '')) }))
        .filter((v) => String(v.height) !== 'NaN' && v.price > 0);
      const base = variants.find((v) => v.height === baseHeight);
      if (base) document.getElementById(`price-${id}`).value = formatPrice(base.price);
      renderSizesBlock(id, plainSizesBlockHtml(id, variants, baseHeight, base ? base.price : null));
      syncBaseRow(id);
      return;
    }
    renderSizesBlock(id, shadeBlockHtml(id, model));
  };
  document.getElementById(`add-size-${id}`).addEventListener('click', () =>
    redraw((m) => {
      m.sizes.push('');
      m.shades.forEach((s) => s.prices.push(''));
    })
  );
  document.querySelectorAll(`#sh-sizes-${id} .remove-size`).forEach((btn, i) => {
    btn.addEventListener('click', () =>
      redraw((m) => {
        m.sizes.splice(i, 1);
        m.shades.forEach((s) => s.prices.splice(i, 1));
      })
    );
  });
  document.getElementById(`add-shade-${id}`).addEventListener('click', () =>
    redraw((m) => {
      m.shades.push({ key: newShadeKey(m.shades.map((s) => s.key)), name_fa: '', name_en: '', in_stock: true, prices: m.sizes.map(() => '') });
    })
  );
  document.querySelectorAll(`#sh-list-${id} .remove-shade`).forEach((btn, i) => {
    btn.addEventListener('click', () =>
      redraw((m) => {
        [m.removed] = m.shades.splice(i, 1);
      })
    );
  });
  // A size's height relabels its price boxes as it is typed (a one-size
  // product's box is just «قیمت»).
  const heightInputs = document.querySelectorAll(`#sh-sizes-${id} .v-height`);
  if (heightInputs.length < 2) return;
  heightInputs.forEach((input, i) => {
    input.addEventListener('input', () => {
      const h = input.value.trim();
      document.querySelectorAll(`#sh-list-${id} .s-price-cell[data-idx="${i}"] span`).forEach((span) => {
        span.textContent = 'قیمت — ' + (h ? h + ' سانتی‌متر' : 'اندازه‌ی جدید');
      });
    });
  });
}

function toggleEdit(id) {
  const wrap = document.getElementById(`edit-wrap-${id}`);
  const btn = document.getElementById(`toggle-${id}`);
  const isOpen = wrap.style.display !== 'none';
  if (isOpen) {
    wrap.style.display = 'none';
    btn.textContent = 'ویرایش کامل ▾';
    return;
  }
  const p = PRODUCTS_CACHE.find((x) => x.id === id);
  const panel = document.getElementById(`edit-panel-${id}`);
  panel.innerHTML = `<table style="width:100%"><tbody>${editPanelHtml(p)}</tbody></table>`;
  wrap.style.display = 'table-row';
  btn.textContent = 'بستن ویرایش ▴';

  wireSizesBlock(id);

  wirePhotoGallery(id, `f-photo-${id}`, () => p.slug, initialPhotos(p));
  document.getElementById(`save-full-${id}`).addEventListener('click', () => saveProductFull(id));
}

function wireVariantRemove(list, onRemove) {
  list.querySelectorAll('.remove-variant').forEach((btn) => {
    btn.onclick = () => {
      btn.closest('.variant-row').remove();
      if (onRemove) onRemove();
    };
  });
}

async function saveProduct(id) {
  const price = Number(unformatPrice(document.getElementById(`price-${id}`).value)) || 0;
  const price_provisional = document.getElementById(`prov-${id}`).checked;
  const in_stock = document.getElementById(`stock-${id}`).checked;
  const fields = { price, price_provisional, in_stock };
  // The price box is the base size's price: a stored row at the base height
  // moves with it, or the shop's size picker would keep the old price.
  const row = PRODUCTS_CACHE.find((x) => x.id === id);
  if (row && !hasShadeTypes(row) && Array.isArray(row.variants) && row.variants.some((v) => v && v.height === row.height_cm)) {
    fields.variants = row.variants.map((v) => (v && v.height === row.height_cm ? { ...v, price } : v));
  }

  const { error } = await sb
    .from('products')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) {
    alert('خطا در ذخیره: ' + adminErrorText(error));
  } else {
    loadProducts();
  }
}

async function saveProductFull(id) {
  const msg = document.getElementById(`save-full-msg-${id}`);
  if (photoUploads.has(id)) {
    msg.textContent = 'صبر کنید تا آپلود عکس‌ها تمام شود.';
    msg.className = 'msg error';
    return;
  }
  const name_fa = document.getElementById(`f-name-fa-${id}`).value.trim();
  // Empty English name is stored as null: the shop then shows no English line.
  const name_en = document.getElementById(`f-name-en-${id}`).value.trim() || null;
  if (!name_fa) {
    msg.textContent = 'خطا: نام فارسی را وارد کنید.';
    msg.className = 'msg error';
    return;
  }

  msg.textContent = 'در حال ذخیره...';
  msg.className = 'msg';

  const subcategory = document.getElementById(`f-subcategory-${id}`).value.trim() || null;
  const style = document.getElementById(`f-style-${id}`).value || null;
  const material = document.getElementById(`f-material-${id}`).value.trim() || null;
  const heightVal = document.getElementById(`f-height-${id}`).value;
  const height_cm = heightVal ? Number(heightVal) : null;
  const description = document.getElementById(`f-desc-${id}`).value.trim() || null;
  const body_size = document.getElementById(`f-body-size-${id}`).value.trim() || null;
  const shade_size = document.getElementById(`f-shade-size-${id}`).value.trim() || null;

  const colorsRaw = document.getElementById(`f-colors-${id}`).value.trim();
  const colors = colorsRaw
    ? colorsRaw.split(/[,،]/).map((s) => s.trim()).filter(Boolean)
    : [];

  const cachedRow = PRODUCTS_CACHE.find((x) => x.id === id);
  const variantRows = document.querySelectorAll(`#variants-list-${id} .variant-row:not([data-base])`);
  const variants = [];
  let basePrice = null;
  // [] = no shades: written whenever the row has the column, so deleting the
  // last shade also clears the list.
  let shade_types = [];
  if (document.getElementById(`sh-list-${id}`)) {
    // With shades: every size needs every shade's price — a half-filled
    // row is an error, not silently dropped, because the server rejects
    // unknown sizes and shades. The base size must be one of the sizes
    // (the card and its «افزودن به سبد» use it).
    const saved = shadeFormToSave({ ...readShadeBlock(id), baseHeight: heightVal });
    if (saved.error) {
      msg.textContent = saved.error;
      msg.className = 'msg error';
      return;
    }
    if (shadesNeedMigration(cachedRow, saved.shade_types)) {
      msg.textContent = 'خطا: برای افزودن، تغییر نام یا ناموجود کردن شید، اول فایل supabase/migration-shade-types.sql باید در Supabase اجرا شود.';
      msg.className = 'msg error';
      return;
    }
    variants.push(...saved.variants);
    shade_types = saved.shade_types;
    basePrice = saved.price;
  } else {
    const otherRows = [];
    for (const row of variantRows) {
      const h = row.querySelector('.v-height').value;
      const pr = unformatPrice(row.querySelector('.v-price').value);
      otherRows.push({ height: h, price: pr });
    }
    // The base size comes from the two fields, never from its read-only row.
    const sizes = sizesToSave(otherRows, heightVal, document.getElementById(`price-${id}`).value);
    if (sizes.error) {
      msg.textContent = sizes.error;
      msg.className = 'msg error';
      return;
    }
    variants.push(...sizes.variants);
    if (sizes.price != null) basePrice = sizes.price;
  }

  const photos = galleryPhotos(id, `f-photo-${id}`, cachedRow);
  if (!photos.length && initialPhotos(cachedRow || {}).length) {
    msg.textContent = 'خطا: محصول بدون عکس نمی‌ماند. پیش از حذف آخرین عکس، عکس دیگری اضافه کنید.';
    msg.className = 'msg error';
    return;
  }

  const fields = { name_fa, name_en, subcategory, style, material, height_cm, description, colors, variants };
  if (basePrice != null) fields.price = basePrice;
  // The whole ordered list and its cover, only when the gallery changed.
  const photoFields = galleryFields(cachedRow || {}, photos);
  if (photoFields) Object.assign(fields, photoFields);
  // body_size / shade_size only exist after supabase/migration-lamp-sizes.sql.
  // Send them only when the loaded row has them, so a save still works if
  // this panel is deployed before the migration runs.
  if (cachedRow && 'body_size' in cachedRow) Object.assign(fields, { body_size, shade_size });
  // shade_types only exists after supabase/migration-shade-types.sql — same rule.
  if (cachedRow && 'shade_types' in cachedRow) fields.shade_types = shade_types;

  const { error } = await sb
    .from('products')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) {
    msg.textContent = 'خطا: ' + adminErrorText(error);
    msg.className = 'msg error';
    return;
  }

  // Update the local cache in place rather than reloading the whole table —
  // reloading would collapse this panel immediately, hiding the very
  // confirmation message we're about to show.
  if (cachedRow) Object.assign(cachedRow, fields);
  const g = photoGalleries[id];
  if (g && g.render) {
    g.initial = [...photos];
    g.render();
  }
  const nameCell = document.getElementById(`name-${id}`);
  if (nameCell) nameCell.textContent = name_fa;

  msg.textContent = 'ذخیره شد.';
  msg.className = 'msg ok';
}

async function deleteProduct(id, name) {
  if (!confirm(`حذف «${name}»؟ این عمل قابل بازگشت نیست.`)) return;
  const { error } = await sb.from('products').delete().eq('id', id);
  if (error) {
    alert('خطا در حذف: ' + adminErrorText(error));
    return;
  }
  loadProducts();
}

document.getElementById('btn-add').addEventListener('click', async () => {
  const addMsg = document.getElementById('add-msg');
  if (photoUploads.has('new')) {
    addMsg.textContent = 'صبر کنید تا آپلود عکس‌ها تمام شود.';
    addMsg.className = 'msg error';
    return;
  }
  const payload = {
    slug: document.getElementById('new-slug').value.trim(),
    name_fa: document.getElementById('new-name-fa').value.trim(),
    name_en: document.getElementById('new-name-en').value.trim() || null,
    collection: document.getElementById('new-collection').value,
    subcategory: document.getElementById('new-subcategory').value.trim() || null,
    style: document.getElementById('new-style').value || null,
    material: document.getElementById('new-material').value.trim() || null,
    height_cm: document.getElementById('new-height').value ? Number(document.getElementById('new-height').value) : null,
    price: Number(unformatPrice(document.getElementById('new-price').value)) || 0,
    ...newProductPhotoFields(galleryPhotos('new', 'new-photo', null)),
    description: document.getElementById('new-desc').value.trim() || null,
  };
  // Only sent when filled in, so adding a product still works before
  // supabase/migration-lamp-sizes.sql has run.
  const newBody = document.getElementById('new-body-size').value.trim();
  const newShade = document.getElementById('new-shade-size').value.trim();
  if (newBody) payload.body_size = newBody;
  if (newShade) payload.shade_size = newShade;

  if (!payload.slug || !payload.name_fa) {
    addMsg.textContent = 'Slug و نام فارسی الزامی است.';
    addMsg.className = 'msg error';
    return;
  }

  const { error } = await sb.from('products').insert(payload);
  if (error) {
    addMsg.textContent = 'خطا: ' + adminErrorText(error);
    addMsg.className = 'msg error';
    return;
  }

  addMsg.textContent = 'محصول اضافه شد.';
  addMsg.className = 'msg ok';
  [
    'new-slug', 'new-name-fa', 'new-name-en', 'new-subcategory', 'new-material',
    'new-height', 'new-price', 'new-desc', 'new-body-size', 'new-shade-size',
  ].forEach((id) => (document.getElementById(id).value = ''));
  document.getElementById('new-style').value = '';
  resetPhotoGallery('new');
  loadProducts();
});

/* ---- Orders -------------------------------------------------------------
   Read-only list plus a status dropdown per order (pending/paid/shipped/
   cancelled). Order creation itself only ever happens through the real
   checkout flow (/api/orders) — this tab is for tracking, not creating. */

const STATUS_LABEL = {
  pending: 'در انتظار',
  paid: 'پرداخت‌شده',
  preparing: 'در حال آماده‌سازی',
  shipped: 'ارسال‌شده',
  delivered: 'تحویل‌شده',
  cancelled: 'لغوشده',
  // Online payment (payment-server/). These are NOT real orders yet: the
  // customer never finished paying. Never ship them.
  pending_payment: 'پرداخت‌نشده (آنلاین)',
  payment_failed: 'پرداخت ناموفق (آنلاین)',
};

// Excluded from revenue / order count / best-sellers, same as 'cancelled'.
const NOT_COUNTED_STATUSES = ['cancelled', 'pending_payment', 'payment_failed'];
const UNPAID_ONLINE = new Set(['pending_payment', 'payment_failed']);

// Mirrors data.js/api/orders.js's SHIPPING — kept in sync by hand, same
// reasoning as elsewhere in this project (no shared module between the
// storefront and this panel). Only the label is needed here.
const SHIPPING_LABEL = { peyk: 'پیک تهران', tipax: 'تیپاکس' };
// Mirrors data.js COPY.instagram (the printed order's footer); a test keeps
// them equal. data.js isn't loaded here: its globals would clash.
const SHOP_INSTAGRAM = 'glow.home__';
// The sender on the printed parcel label. The number mirrors data.js
// COPY.contactWhatsapp (a test keeps them equal); the print is the one place
// it is shown as digits — the storefront only links to it.
const SHOP_SENDER_NAME = 'سحر راد';
const SHOP_SENDER_PHONE = '+989353431782';

let ORDERS_CACHE = [];
let ORDER_ITEMS_BY_ORDER = {};
let orderSearchTerm = '';

async function loadOrders() {
  const list = document.getElementById('orders-list');
  list.innerHTML = 'در حال بارگذاری...';

  const { data: orders, error } = await sb
    .from('orders')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    if (isNetworkError(error)) return showRetry(list, loadOrders, (html) => `<p>${html}</p>`);
    list.innerHTML = `<p style="color:#b3432f">خطا: ${escapeHtml(error.message)}</p>`;
    return;
  }

  ORDERS_CACHE = orders || [];

  if (!ORDERS_CACHE.length) {
    list.innerHTML = '<p>هنوز سفارشی ثبت نشده.</p>';
    return;
  }

  const orderIds = ORDERS_CACHE.map((o) => o.id);
  const { data: items } = await sb
    .from('order_items')
    .select('*')
    .in('order_id', orderIds);

  ORDER_ITEMS_BY_ORDER = {};
  (items || []).forEach((it) => {
    (ORDER_ITEMS_BY_ORDER[it.order_id] = ORDER_ITEMS_BY_ORDER[it.order_id] || []).push(it);
  });

  renderOrdersList();

  loadOrdersSummary();
}

// Client-side only, same reasoning as filteredProducts() above — the list
// tab is already capped at 100 orders in memory (see loadOrders()), and the
// sales-summary tab above it runs its own separate, unfiltered Supabase
// query, so nothing here touches that.
function filteredOrders() {
  const q = orderSearchTerm.trim().toLowerCase();
  if (!q) return ORDERS_CACHE;
  return ORDERS_CACHE.filter((o) => {
    const haystack = [o.code, o.customer_name, o.phone, o.city].filter(Boolean).join(' ').toLowerCase();
    return haystack.includes(q);
  });
}

function renderOrdersList() {
  const list = document.getElementById('orders-list');

  if (!ORDERS_CACHE.length) {
    list.innerHTML = '<p>هنوز سفارشی ثبت نشده.</p>';
    return;
  }

  const orders = filteredOrders();
  if (!orders.length) {
    list.innerHTML = '<p>نتیجه‌ای یافت نشد.</p>';
    return;
  }

  list.innerHTML = orders.map((o) => orderCardHtml(o, ORDER_ITEMS_BY_ORDER[o.id] || [])).join('');

  orders.forEach((o) => {
    const sel = document.getElementById(`order-status-${o.id}`);
    if (sel) sel.addEventListener('change', () => updateOrderStatus(o.id, sel.value));
    const print = document.getElementById(`order-print-${o.id}`);
    if (print) print.addEventListener('click', () => printOrder(o.id));
  });
}

document.getElementById('order-search').addEventListener('input', (e) => {
  orderSearchTerm = e.target.value;
  renderOrdersList();
});

/* ---- Sales summary --------------------------------------------------------
   The order list above is capped at 100 for display, so it must NOT be the
   source for these numbers — a "total revenue" that silently only covered
   the most recent 100 orders would be actively misleading. This fetches its
   own uncapped(-ish) set instead. 1000 orders is generous headroom for this
   shop's current volume; revisit if that ever actually gets hit. */
async function loadOrdersSummary() {
  const el = document.getElementById('orders-summary');
  if (!el) return;

  const { data: allOrders, error: ordersErr } = await sb
    .from('orders')
    .select('total, status')
    .limit(1000);

  if (ordersErr || !allOrders) {
    el.innerHTML = '<p style="color:var(--danger)">خطا در محاسبه‌ی آمار فروش.</p>';
    return;
  }

  const counted = allOrders.filter((o) => !NOT_COUNTED_STATUSES.includes(o.status));
  const revenue = counted.reduce((sum, o) => sum + (o.total || 0), 0);
  const count = counted.length;
  const avg = count ? revenue / count : 0;

  // Best-sellers by quantity, excluding cancelled orders — same exclusion
  // as revenue/count above, for consistency. order_items has no status of
  // its own, so this joins against orders.status directly (via the
  // order_items -> orders foreign key) rather than filtering by an .in()
  // list of order ids, which would mean sending up to 1000 ids in the
  // query string. Not bounded by the 1000-order cap either way.
  const { data: allItems } = await sb
    .from('order_items')
    .select('name_fa, qty, orders!inner(status)')
    .not('orders.status', 'in', `(${NOT_COUNTED_STATUSES.join(',')})`)
    .not('product_id', 'is', null) // fee lines (هزینه بسته‌بندی) are not products
    .limit(5000);

  const qtyByName = {};
  (allItems || []).forEach((it) => {
    qtyByName[it.name_fa] = (qtyByName[it.name_fa] || 0) + (it.qty || 0);
  });
  const topProducts = Object.entries(qtyByName)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  el.innerHTML = `
    <div class="stat-row">
      <div class="stat-box">
        <div class="stat-label">درآمد کل</div>
        <div class="stat-value">${money(revenue)}</div>
      </div>
      <div class="stat-box">
        <div class="stat-label">تعداد سفارش</div>
        <div class="stat-value">${count.toLocaleString('fa-IR')}</div>
      </div>
      <div class="stat-box">
        <div class="stat-label">میانگین ارزش سفارش</div>
        <div class="stat-value">${count ? money(avg) : '—'}</div>
      </div>
      <div class="stat-box stat-box-wide">
        <div class="stat-label">پرفروش‌ترین محصولات</div>
        ${
          topProducts.length
            ? `<ol class="top-products">${topProducts
                .map(
                  ([name, qty], i) =>
                    `<li><span>${i + 1}. ${escapeHtml(name)}</span><span>${qty.toLocaleString('fa-IR')} عدد</span></li>`
                )
                .join('')}</ol>`
            : '<div class="stat-value">—</div>'
        }
      </div>
    </div>
    <div style="margin-top:10px; font-size:12.5px; color:#8a7d6e">
      «درآمد کل» و «میانگین ارزش سفارش» شامل هزینه‌ی پس‌کرایه (مثلاً پیک تهران) نمی‌شود — این مبلغ را مشتری نقداً به مأمور تحویل می‌دهد، نه از طریق سایت.
    </div>`;
}

function orderCardHtml(o, items) {
  const statusClass = 'status-' + (o.status || 'pending');
  const date = o.created_at ? new Date(o.created_at).toLocaleString('fa-IR') : '';
  const unpaid = UNPAID_ONLINE.has(o.status);
  return `
    <div class="order-card${unpaid ? ' order-card-unpaid' : ''}">
      ${
        unpaid
          ? '<div class="unpaid-banner">پرداخت آنلاین انجام نشده — این سفارش را آماده یا ارسال نکنید.</div>'
          : ''
      }
      <div class="order-head">
        <div>
          <b>${escapeHtml(o.code)}</b>
          <span class="status-pill ${statusClass}">${STATUS_LABEL[o.status] || o.status}</span>
          <div style="color:#8a7d6e; font-size:12.5px; margin-top:4px">${escapeHtml(date)}</div>
        </div>
        <div style="text-align:left">
          <div>${escapeHtml(o.customer_name || '')} — <span class="ltr" style="direction:ltr;unicode-bidi:embed">${escapeHtml(o.phone || '')}</span></div>
          <div style="color:#8a7d6e; font-size:12.5px">${escapeHtml(o.city || '')}${o.address ? '، ' + escapeHtml(o.address) : ''}</div>
        </div>
      </div>
      <div class="order-items">
        ${items
          .map(
            (it) =>
              `<div class="order-item-row"><span>${escapeHtml(it.name_fa)} × ${it.qty}${lineDiscountNote(it, '<span class="order-item-was">', '</span>')}</span><span>${money(it.unit_price * it.qty)}</span></div>`
          )
          .join('')}
        <div class="order-item-row" style="font-weight:700; margin-top:6px; padding-top:6px; border-top:1px solid var(--divider)">
          <span>جمع کل</span><span>${money(o.total)}</span>
        </div>
        <div style="margin-top:8px; color:#6b5f52">روش ارسال: ${escapeHtml(SHIPPING_LABEL[o.shipping_method] || o.shipping_method || '—')}</div>
        ${o.note ? `<div style="margin-top:8px; color:#6b5f52">یادداشت: ${escapeHtml(o.note)}</div>` : ''}
        ${o.payment_method === 'zarinpal' ? paymentInfoHtml(o) : ''}
      </div>
      <div style="margin-top:12px">
        <label style="display:inline;margin-inline-end:8px">وضعیت:</label>
        <select id="order-status-${o.id}" style="width:auto; display:inline-block">
          ${Object.keys(STATUS_LABEL)
            .map((k) => `<option value="${k}" ${o.status === k ? 'selected' : ''}>${STATUS_LABEL[k]}</option>`)
            .join('')}
        </select>
        <button type="button" class="btn ghost" id="order-print-${o.id}" style="padding:6px 14px; margin-inline-start:8px">چاپ سفارش</button>
      </div>
    </div>`;
}

// Online-payment details (columns from supabase/migration-online-payment.sql).
function paymentInfoHtml(o) {
  const parts = ['پرداخت آنلاین (زرین‌پال)'];
  if (o.paid_at) parts.push('پرداخت: ' + escapeHtml(new Date(o.paid_at).toLocaleString('fa-IR')));
  if (o.payment_ref_id) parts.push('کد پیگیری: <span style="direction:ltr;unicode-bidi:embed">' + escapeHtml(o.payment_ref_id) + '</span>');
  if (o.payment_card_pan) parts.push('کارت: <span style="direction:ltr;unicode-bidi:embed">' + escapeHtml(o.payment_card_pan) + '</span>');
  if (!o.paid_at && o.payment_error) parts.push('خطا: ' + escapeHtml(o.payment_error));
  return `<div style="margin-top:8px; color:#6b5f52">${parts.join(' — ')}</div>`;
}

/* ---- Printable order ------------------------------------------------------
   «چاپ سفارش» opens one order as an A4 page and starts the print dialog:
   a shipping label to cut out (name, mobile, address, method) and a packing
   slip (items, fees, total, payment). Built from the order already loaded
   here — no request. Every value from the order is escaped. Never printed:
   the card number, and any phone number of the shop (it shows none). */

// Paid or not, for the slip. Online orders: paid once verified (paid_at or
// a tracking code) and not in an unpaid-online status. Older orders without
// online payment: paid once marked paid or further along.
function orderPaymentState(o) {
  const online = o.payment_method === 'zarinpal';
  const paid = online
    ? !UNPAID_ONLINE.has(o.status) && Boolean(o.paid_at || o.payment_ref_id)
    : ['paid', 'preparing', 'shipped', 'delivered'].includes(o.status);
  return {
    paid,
    label: `${online ? 'پرداخت آنلاین' : 'کارت به کارت'} — ${paid ? 'پرداخت‌شده' : 'پرداخت‌نشده'}`,
    refId: online && paid ? o.payment_ref_id || '' : '',
  };
}

// "+989123456789" → "+98 912 345 6789" (country code, then 3-3-4).
function phoneDisplay(intl) {
  const d = String(intl || '').replace(/\D/g, '');
  return d.length === 12 && d.startsWith('98') ? `+98 ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}` : String(intl || '');
}

function faNum(n) {
  return Number(n || 0).toLocaleString('fa-IR');
}

/** The price an order line had before its campaign (order_items.list_price,
 * from supabase/migration-discount-campaigns.sql); unit_price when there was
 * none — old orders, fees, lines sold at the list price. Same as email.js. */
function lineListPrice(it) {
  const list = Number(it.list_price);
  return Number.isSafeInteger(list) && list > it.unit_price ? list : it.unit_price;
}

/** «قیمت اصلی … — تخفیف «name»» for a discounted line, wrapped in open/close. */
function lineDiscountNote(it, open, close) {
  const list = lineListPrice(it);
  if (!(list > it.unit_price)) return '';
  return `${open}قیمت اصلی ${money(list)} — تخفیف${it.campaign_name ? ` «${escapeHtml(it.campaign_name)}»` : ''}${close}`;
}

// `origin` (location.origin) makes the font URLs absolute: the print window
// starts as about:blank, where a root-relative URL may not resolve.
function orderPrintHtml(o, items, origin = '') {
  const products = items.filter((it) => it.product_id != null);
  const fees = items.filter((it) => it.product_id == null);
  const itemsSum = products.reduce((sum, it) => sum + it.unit_price * it.qty, 0);
  const listSum = products.reduce((sum, it) => sum + lineListPrice(it) * it.qty, 0);
  const campaignDiscount = listSum - itemsSum;
  const campaigns = [...new Set(products.filter((it) => lineListPrice(it) > it.unit_price && it.campaign_name).map((it) => it.campaign_name))];
  const feesSum = fees.reduce((sum, it) => sum + it.unit_price * it.qty, 0);
  const discount = Math.max(0, itemsSum + feesSum - (o.total || 0));
  const pay = orderPaymentState(o);
  const when = o.created_at ? new Date(o.created_at) : null;
  const date = when
    ? when.toLocaleDateString('fa-IR', { year: 'numeric', month: '2-digit', day: '2-digit' }) +
      '، ساعت ' +
      when.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })
    : '';
  const method = SHIPPING_LABEL[o.shipping_method] || o.shipping_method || '—';
  const ltr = (s) => `<span class="ltr">${escapeHtml(s)}</span>`;
  const font = (file) => escapeHtml(String(origin || '') + '/fonts/' + file);
  // The storefront's line-art daffodil (images/motif-flower.png), reused as
  // two faint watermarks: one behind the header (top-right, mirrored) and
  // one behind the packing slip (bottom-left) — never behind the label.
  const watermark = escapeHtml(String(origin || '') + '/images/motif-flower.png');
  return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<title>سفارش ${escapeHtml(o.code)}</title>
<style>
  @font-face { font-family: 'IRANSansX'; src: url('${font('iransansx-400.woff2')}') format('woff2'); font-weight: 400; }
  @font-face { font-family: 'IRANSansX'; src: url('${font('iransansx-700.woff2')}') format('woff2'); font-weight: 700; }
  @page { size: A4 portrait; margin: 10mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: #fff; color: #000; }
  body { font-family: 'IRANSansX', Tahoma, sans-serif; font-size: 11pt; line-height: 1.6; }
  .page { max-width: 186mm; margin: 0 auto; }
  .ltr { direction: ltr; unicode-bidi: isolate; }
  .head { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 2px solid #000; padding-bottom: 2mm; }
  .brand { font-size: 16pt; font-weight: 700; }
  .doc { font-size: 13pt; font-weight: 700; }
  .meta { display: flex; justify-content: space-between; align-items: baseline; margin: 2mm 0 3mm; }
  .code { font-size: 22pt; font-weight: 700; letter-spacing: 0.5px; }
  h2 { font-size: 11pt; margin: 0 0 1.5mm; }
  .label { border: 2px solid #000; padding: 3mm 4mm; font-size: 13pt; }
  .label .name { font-size: 19pt; font-weight: 700; line-height: 1.3; }
  .label .row { margin-top: 1mm; }
  .label .method { margin-top: 2mm; padding-top: 1.5mm; border-top: 1px solid #000; font-weight: 700; font-size: 14pt; }
  .label-area { position: relative; z-index: 1; background: #fff; }
  .label-area h2 { margin-top: 3mm; }
  .sender { border: 1.5px solid #000; padding: 1.5mm 4mm; font-size: 12pt; }
  .sender b { font-size: 11pt; }
  .notes { border: 1px solid #000; padding: 2.5mm 4mm; margin-top: 3mm; font-size: 11pt; white-space: pre-wrap; }
  .cut { margin: 4.5mm 0 4mm; border-top: 1.5px dashed #000; position: relative; height: 0; }
  .cut span { position: absolute; top: -9pt; inset-inline-start: 4mm; background: #fff; padding: 0 2mm; font-size: 12pt; }
  table { width: 100%; border-collapse: collapse; font-size: 10.5pt; }
  th, td { border: 1px solid #000; padding: 1.1mm 2mm; text-align: start; vertical-align: top; }
  th { font-weight: 700; }
  td.n, th.n { text-align: center; width: 10mm; }
  td.num, th.num { text-align: left; white-space: nowrap; }
  td .was { font-size: 9pt; color: #555; margin-top: 1mm; }
  tr { page-break-inside: avoid; break-inside: avoid; }
  thead { display: table-header-group; }
  .totals { margin-top: 2mm; margin-inline-start: auto; width: 82mm; font-size: 11pt; }
  .totals div { display: flex; justify-content: space-between; padding: 0.8mm 0; }
  .totals .grand { border-top: 2px solid #000; margin-top: 1mm; padding-top: 1.6mm; font-weight: 700; font-size: 13pt; }
  .pay { margin-top: 2mm; font-weight: 700; }
  .checks { margin-top: 4mm; display: flex; gap: 12mm; font-size: 12pt; }
  .box { display: inline-block; width: 5mm; height: 5mm; border: 1.5px solid #000; vertical-align: middle; margin-inline-start: 2mm; }
  .foot { margin-top: 4mm; padding-top: 2mm; border-top: 1px solid #000; display: flex; justify-content: space-between; font-size: 10pt; }
  .block, .totals, .checks, .foot { page-break-inside: avoid; break-inside: avoid; }
  /* The watermarks: faint and grey so they never get in the way of the
     text, and forced to print (browsers drop images styled as
     backgrounds). Each one is clipped by its own box — the header (.top)
     or the slip — so it can never add a page or reach the label. */
  .watermark {
    position: absolute; z-index: 0; height: auto;
    /* motif-flower.png's lines are themselves only ~42% opaque, so 0.3 here
       prints them like solid lines at ~0.12: faint, never in the way. */
    opacity: 0.3; filter: grayscale(1); pointer-events: none;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  /* Top-right, behind the header: mirrored and tilted so it isn't an
     obvious copy of the bottom one; only its bloom shows, the rest is
     clipped at the header's bottom edge (above the sender box). */
  .top { position: relative; overflow: hidden; overflow: clip; }
  .top > *:not(.watermark) { position: relative; z-index: 1; }
  .watermark-top { top: -24mm; right: -12mm; width: 100mm; transform: scaleX(-1) rotate(-8deg); }
  /* Bottom-left, behind the items, totals and footer. */
  .slip { position: relative; overflow: hidden; overflow: clip; }
  .slip > *:not(.watermark) { position: relative; z-index: 1; }
  .slip > .watermark { bottom: -14mm; inset-inline-end: -20mm; width: 120mm; }
  .screen-only { margin: 12px auto; max-width: 186mm; text-align: center; font-family: inherit; }
  .screen-only button { font: inherit; padding: 8px 22px; border: 1px solid #000; background: #fff; cursor: pointer; }
  @media print { .screen-only { display: none; } }
</style>
</head>
<body>
<div class="screen-only"><button type="button" id="print-again">چاپ دوباره</button></div>
<div class="page">
  <div class="top">
  <img class="watermark watermark-top" src="${watermark}" alt="" aria-hidden="true">
  <div class="head"><span class="brand ltr">Glow Home</span><span class="doc">برگه سفارش</span></div>
  <div class="meta"><span class="code ltr">${escapeHtml(o.code)}</span><span>${escapeHtml(date)}</span></div>
  </div>

  <div class="block label-area">
    <div class="sender"><b>فرستنده:</b> ${escapeHtml(SHOP_SENDER_NAME)} — ${ltr(phoneDisplay(SHOP_SENDER_PHONE))}</div>
    <h2>گیرنده</h2>
    <div class="label">
      <div class="name">${escapeHtml(o.customer_name || '')}</div>
      <div class="row">موبایل: ${ltr(o.phone || '')}</div>
      <div class="row">نشانی: ${escapeHtml(o.address || '')}</div>
      <div class="row">شهر: ${escapeHtml(o.city || '')}</div>
      ${o.postcode ? `<div class="row">کد پستی: ${ltr(o.postcode)}</div>` : ''}
      <div class="method">روش ارسال: ${escapeHtml(method)}</div>
    </div>
    ${o.note ? `<div class="notes"><b>توضیحات مشتری:</b> ${escapeHtml(o.note)}</div>` : ''}
  </div>

  <div class="cut" aria-hidden="true"><span>✂</span></div>

  <div class="slip">
  <img class="watermark" src="${watermark}" alt="" aria-hidden="true">
  <h2>محتویات سفارش</h2>
  <table>
    <thead><tr><th class="n">ردیف</th><th>نام محصول</th><th class="n">تعداد</th><th class="num">قیمت واحد</th><th class="num">جمع</th></tr></thead>
    <tbody>
      ${products
        .map(
          (it, i) =>
            `<tr><td class="n">${faNum(i + 1)}</td><td>${escapeHtml(it.name_fa)}${lineDiscountNote(it, '<div class="was">', '</div>')}</td><td class="n">${faNum(it.qty)}</td><td class="num">${money(it.unit_price)}</td><td class="num">${money(it.unit_price * it.qty)}</td></tr>`
        )
        .join('')}
    </tbody>
  </table>
  <div class="totals">
    ${
      campaignDiscount > 0
        ? `<div><span>جمع اقلام با قیمت اصلی</span><span>${money(listSum)}</span></div>
    <div><span>تخفیف مناسبت${campaigns.length ? ` (${campaigns.map(escapeHtml).join('، ')})` : ''}</span><span>−${money(campaignDiscount)}</span></div>`
        : `<div><span>جمع اقلام</span><span>${money(itemsSum)}</span></div>`
    }
    ${fees.map((f) => `<div><span>${escapeHtml(f.name_fa)}</span><span>${money(f.unit_price * f.qty)}</span></div>`).join('')}
    ${discount > 0 ? `<div><span>تخفیف${o.discount_code ? ` (${ltr(o.discount_code)})` : ''}</span><span>−${money(discount)}</span></div>` : ''}
    <div class="grand"><span>${pay.paid ? 'مبلغ پرداخت‌شده' : 'مبلغ سفارش (پرداخت‌نشده)'}</span><span>${money(o.total)}</span></div>
  </div>
  <div class="pay">${pay.label}${pay.refId ? ` — کد پیگیری: ${ltr(pay.refId)}` : ''}</div>

  <div class="checks"><span>بسته‌بندی شد<span class="box"></span></span><span>ارسال شد<span class="box"></span></span></div>

  <div class="foot"><span>از خرید شما سپاسگزاریم</span><span class="ltr">glow-home.ir · Instagram: @${escapeHtml(SHOP_INSTAGRAM)}</span></div>
  </div>
</div>
</body>
</html>`;
}

const PRINT_WAIT_MS = 3000;

// A new window rather than a hidden iframe: Safari (iPhone/Mac) prints the
// parent page instead of a hidden iframe. Opened in the click itself, so
// pop-up blockers allow it.
function printOrder(id) {
  const o = ORDERS_CACHE.find((x) => x.id === id);
  if (!o) return;
  const win = window.open('', '_blank');
  if (!win) {
    alert('پنجره‌ی چاپ باز نشد. لطفاً اجازه‌ی باز شدن پنجره (pop-up) را برای این سایت بدهید.');
    return;
  }
  win.document.open();
  win.document.write(orderPrintHtml(o, ORDER_ITEMS_BY_ORDER[o.id] || [], location.origin));
  win.document.close();
  const print = () => {
    win.focus();
    win.print();
  };
  win.document.getElementById('print-again').addEventListener('click', print);
  // Wait for the font and both watermark images — but never more than
  // PRINT_WAIT_MS: if any fails or hangs, print anyway (a watermark that
  // didn't load is removed; the page is fine without it).
  const fonts = (win.document.fonts && win.document.fonts.ready) || Promise.resolve();
  const images = [...win.document.querySelectorAll('.watermark')].map(
    (img) =>
      new Promise((resolve) => {
        const failed = () => {
          img.remove();
          resolve();
        };
        if (img.complete) return img.naturalWidth ? resolve() : failed();
        img.addEventListener('load', resolve);
        img.addEventListener('error', failed);
      })
  );
  const timeout = new Promise((resolve) => setTimeout(resolve, PRINT_WAIT_MS));
  Promise.race([Promise.all([fonts, ...images]), timeout]).then(() => setTimeout(print, 100));
}

async function updateOrderStatus(id, status) {
  const { error } = await sb.from('orders').update({ status }).eq('id', id);
  if (error) {
    alert('خطا در تغییر وضعیت: ' + adminErrorText(error));
    loadOrders();
    return;
  }
  // Status feeds directly into the revenue/count exclusion above, so a
  // change here (into or out of 'cancelled') must refresh the summary too.
  loadOrdersSummary();
}

function money(n) {
  return new Intl.NumberFormat('fa-IR').format(Math.round(n || 0)) + ' تومان';
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) {
  return escapeHtml(s);
}

/* ---- Discounts («تخفیف‌ها») -------------------------------------------------
   Campaigns for occasions (یلدا, نوروز…): a whole percent off all products,
   some collections, or chosen products, optionally between two Jalali dates,
   with an on/off switch. Stored in discount_campaigns
   (supabase/migration-discount-campaigns.sql). The storefront shows them;
   the payment server reads them itself and decides the price charged — this
   tab only edits the rows. The preview uses the same rule as both. */

// ---- Campaign discounts (shared rule) -------------------------------------------
// ⚠ This block is identical in app.js, admin/admin.js, api/orders.js and
// payment-server/src/pricing.js (`npm test` in payment-server/ checks it).
// A campaign (table discount_campaigns, edited in the admin «تخفیف‌ها» tab)
// takes a whole percent (1–90) off every size and every shade of the
// products it covers: all of them, some collections, or chosen products
// (by slug). Each unit price is discounted on its own and rounded to the
// nearest 1,000 Toman; fees are never discounted. Two campaigns on one
// product never stack: the larger percent wins (on a tie, the first one).
// Active = switched on and starts_at ≤ now < ends_at (an empty date is no
// limit); the payment server decides with its own clock.
const DISCOUNT_MAX_PERCENT = 90;
const DISCOUNT_ROUND_TOMAN = 1000;
const DISCOUNT_SCOPES = ['all', 'collections', 'products'];

/** True when campaign c is valid and running at `now` (ms). now == null
 * skips the dates (the storefront: its database read returns only running
 * campaigns, and the visitor's clock may be wrong). */
function campaignIsActive(c, now) {
  if (!c || c.enabled !== true || !DISCOUNT_SCOPES.includes(c.scope)) return false;
  const percent = Number(c.percent);
  if (!Number.isInteger(percent) || percent < 1 || percent > DISCOUNT_MAX_PERCENT) return false;
  if (now == null) return true;
  const start = c.starts_at ? Date.parse(c.starts_at) : null;
  const end = c.ends_at ? Date.parse(c.ends_at) : null;
  if (Number.isNaN(start) || Number.isNaN(end)) return false;
  return (start == null || start <= now) && (end == null || now < end);
}

/** True when campaign c covers product p ({ slug, collection }). */
function campaignCovers(c, p) {
  if (c.scope === 'all') return true;
  if (c.scope === 'collections') return Array.isArray(c.collections) && c.collections.includes(p.collection);
  if (c.scope === 'products') return Array.isArray(c.product_slugs) && c.product_slugs.includes(p.slug);
  return false;
}

/** The covering campaign with the largest percent, or null. `campaigns`
 * must already be the active ones. */
function bestCampaignFor(p, campaigns) {
  let best = null;
  for (const c of Array.isArray(campaigns) ? campaigns : []) {
    if (campaignCovers(c, p) && (!best || Number(c.percent) > Number(best.percent))) best = c;
  }
  return best;
}

/** price less percent, rounded to the nearest DISCOUNT_ROUND_TOMAN, never
 * below DISCOUNT_ROUND_TOMAN nor above price. An unpriced (0, missing,
 * not a whole number) price is returned as it is. */
function discountedPrice(price, percent) {
  if (!Number.isSafeInteger(price) || price <= 0) return price;
  const pct = Math.min(DISCOUNT_MAX_PERCENT, Math.max(0, Math.floor(Number(percent) || 0)));
  const rounded = Math.round((price * (100 - pct)) / 100 / DISCOUNT_ROUND_TOMAN) * DISCOUNT_ROUND_TOMAN;
  return Math.min(price, Math.max(DISCOUNT_ROUND_TOMAN, rounded));
}

/** One unit at listPrice under campaign c (or none): { price, listPrice,
 * campaign } — campaign is null when nothing comes off. */
function applyCampaign(listPrice, c) {
  const price = c ? discountedPrice(listPrice, c.percent) : listPrice;
  if (!c || !(price < listPrice)) return { price: listPrice, listPrice, campaign: null };
  return { price, listPrice, campaign: c };
}
// ---- end of campaign discounts ---------------------------------------------------

// Iran has had no daylight saving time since 2022: Tehran is UTC+03:30
// all year. A campaign starts at 00:00 Tehran time on its first day and
// ends at 24:00 on its last day (stored as 00:00 of the next day, exclusive).
const TEHRAN_UTC_OFFSET_MIN = 210;
const JALALI_MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
const CAMPAIGN_NAME_MAX = 60;
const MISSING_CAMPAIGNS_TABLE =
  'جدول تخفیف‌ها هنوز ساخته نشده است. اول فایل supabase/migration-discount-campaigns.sql را در Supabase اجرا کنید.';

/** [jy, jm, jd] for a Gregorian date (checked day by day against the
 * Persian calendar for 1395–1435 in test/discount-campaigns.test.js). */
function gregorianToJalali(gy, gm, gd) {
  const gdm = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const gy2 = gm > 2 ? gy + 1 : gy;
  let days = 355666 + 365 * gy + Math.floor((gy2 + 3) / 4) - Math.floor((gy2 + 99) / 100) + Math.floor((gy2 + 399) / 400) + gd + gdm[gm - 1];
  let jy = -1595 + 33 * Math.floor(days / 12053);
  days %= 12053;
  jy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    jy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  const jm = days < 186 ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30);
  const jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30);
  return [jy, jm, jd];
}

/** [gy, gm, gd] for a Jalali date. */
function jalaliToGregorian(jy, jm, jd) {
  jy += 1595;
  let days = -355668 + 365 * jy + Math.floor(jy / 33) * 8 + Math.floor(((jy % 33) + 3) / 4) + jd + (jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186);
  let gy = 400 * Math.floor(days / 146097);
  days %= 146097;
  if (days > 36524) {
    gy += 100 * Math.floor(--days / 36524);
    days %= 36524;
    if (days >= 365) days++;
  }
  gy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    gy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  let gd = days + 1;
  const ml = [0, 31, (gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let gm = 1;
  for (; gm <= 12 && gd > ml[gm]; gm++) gd -= ml[gm];
  return [gy, gm, gd];
}

/** The instant 00:00 Tehran time on Jalali day jy/jm/jd, plus `addDays`
 * days, as an ISO string; null when that day doesn't exist (30 اسفند of a
 * common year, 31 مهر…). */
function tehranDayStartIso(jy, jm, jd, addDays = 0) {
  const [gy, gm, gd] = jalaliToGregorian(jy, jm, jd);
  const back = gregorianToJalali(gy, gm, gd);
  if (back[0] !== jy || back[1] !== jm || back[2] !== jd) return null;
  return new Date(Date.UTC(gy, gm - 1, gd + addDays) - TEHRAN_UTC_OFFSET_MIN * 60000).toISOString();
}

/** Jalali [jy, jm, jd] of an instant, in Tehran time. */
function tehranJalaliOf(ms) {
  const d = new Date(ms + TEHRAN_UTC_OFFSET_MIN * 60000);
  return gregorianToJalali(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** The form's start (or end) day from its three dropdowns: null when all
 * are empty, { error } when only some are, or [jy, jm, jd]. */
function jalaliFieldValue(d, label) {
  const parts = [d && d.y, d && d.m, d && d.d].map((v) => String(v ?? '').trim());
  if (parts.every((v) => !v)) return null;
  if (parts.some((v) => !v)) return { error: `${label} را کامل انتخاب کنید (سال، ماه و روز).` };
  const [jy, jm, jd] = parts.map(Number);
  if (!Number.isInteger(jy) || !Number.isInteger(jm) || !Number.isInteger(jd) || !tehranDayStartIso(jy, jm, jd)) {
    return { error: `${label} معتبر نیست (این روز در تقویم وجود ندارد).` };
  }
  return [jy, jm, jd];
}

/**
 * The form → a discount_campaigns row, or { error } in Persian.
 * f: { name, percent, scope, collections[], productSlugs[], start: {y,m,d},
 * end: {y,m,d}, enabled }.
 */
function campaignFormToSave(f) {
  const name = String(f.name ?? '').trim().replace(/\s+/g, ' ');
  if (!name) return { error: 'نام مناسبت را وارد کنید (مثلاً «یلدا»).' };
  if (name.length > CAMPAIGN_NAME_MAX) return { error: `نام مناسبت حداکثر ${faNum(CAMPAIGN_NAME_MAX)} حرف باشد.` };
  const pct = toLatinDigits(String(f.percent ?? '')).trim();
  if (!/^[0-9]{1,3}$/.test(pct) || Number(pct) < 1 || Number(pct) > DISCOUNT_MAX_PERCENT) {
    return { error: `درصد تخفیف باید عددی صحیح از ۱ تا ${faNum(DISCOUNT_MAX_PERCENT)} باشد.` };
  }
  if (!DISCOUNT_SCOPES.includes(f.scope)) return { error: 'مشخص کنید تخفیف روی چه محصولاتی اعمال شود.' };
  const collections = [...new Set((f.collections || []).filter((k) => Object.hasOwn(COLLECTION_LABEL, k)))];
  const slugs = [...new Set((f.productSlugs || []).map((s) => String(s).trim()).filter(Boolean))];
  if (f.scope === 'collections' && !collections.length) return { error: 'دست‌کم یک دسته را انتخاب کنید.' };
  if (f.scope === 'products' && !slugs.length) return { error: 'دست‌کم یک محصول را انتخاب کنید.' };
  const start = jalaliFieldValue(f.start, 'تاریخ شروع');
  if (start && start.error) return start;
  const end = jalaliFieldValue(f.end, 'تاریخ پایان');
  if (end && end.error) return end;
  const starts_at = start ? tehranDayStartIso(...start) : null;
  const ends_at = end ? tehranDayStartIso(...end, 1) : null; // the whole last day
  if (starts_at && ends_at && Date.parse(ends_at) <= Date.parse(starts_at)) {
    return { error: 'تاریخ پایان نباید پیش از تاریخ شروع باشد.' };
  }
  return {
    row: {
      name,
      percent: Number(pct),
      scope: f.scope,
      collections: f.scope === 'collections' ? collections : [],
      product_slugs: f.scope === 'products' ? slugs : [],
      starts_at,
      ends_at,
      enabled: f.enabled === true,
    },
  };
}

/** Where a campaign stands at `now`, for the list (the payment server decides
 * with its own clock): خاموش / زمان‌بندی‌شده / فعال / پایان‌یافته. */
function campaignStatus(c, now) {
  if (!c.enabled) return { key: 'off', label: 'خاموش' };
  if (c.ends_at && Date.parse(c.ends_at) <= now) return { key: 'ended', label: 'پایان‌یافته' };
  if (c.starts_at && Date.parse(c.starts_at) > now) return { key: 'scheduled', label: 'زمان‌بندی‌شده' };
  return { key: 'active', label: 'فعال' };
}

/** «۳۰ آذر ۱۴۰۵» for a stored start (or, with endExclusive, the last day of
 * a stored end); '—' when empty. */
function campaignDateFa(iso, endExclusive = false) {
  if (!iso) return '—';
  const [jy, jm, jd] = tehranJalaliOf(Date.parse(iso) - (endExclusive ? 1 : 0));
  return `${faNum(jd)} ${JALALI_MONTHS[jm - 1]} ${String(jy).replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d])}`;
}

function campaignScopeFa(c) {
  if (c.scope === 'all') return 'همه محصولات';
  if (c.scope === 'collections') return (c.collections || []).map((k) => COLLECTION_LABEL[k] || k).join('، ') || '—';
  return `${faNum((c.product_slugs || []).length)} محصول انتخابی`;
}

/**
 * The preview table's rows: every product the campaign covers, its price
 * now (the base size) and after the discount, and a note — no price, a
 * bigger campaign that wins, sizes/shades, provisional price, out of stock.
 * `others`: the other saved campaigns (switched on and not ended).
 */
function campaignPreviewRows(row, products, others = [], now = Date.now()) {
  const rivals = others.filter((o) => o.id !== row.id && o.enabled && !(o.ends_at && Date.parse(o.ends_at) <= now));
  return products
    .filter((p) => campaignCovers(row, { slug: p.slug, collection: p.collection }))
    .map((p) => {
      const price = Number(p.price);
      const priced = Number.isSafeInteger(price) && price > 0;
      const notes = [];
      if (!priced) notes.push('بدون قیمت — تخفیفی اعمال نمی‌شود');
      const bigger = bestCampaignFor({ slug: p.slug, collection: p.collection }, rivals);
      if (bigger && Number(bigger.percent) > row.percent) {
        notes.push(`«${bigger.name}» با ٪${faNum(bigger.percent)} بیشتر است و هم‌زمان به جای این تخفیف اعمال می‌شود`);
      }
      if (priced && Array.isArray(p.variants) && p.variants.length) notes.push(`همه‌ی اندازه‌ها و شیدها هم ٪${faNum(row.percent)}`);
      if (p.price_provisional) notes.push('قیمت موقت');
      if (p.in_stock === false) notes.push('ناموجود');
      return { name_fa: p.name_fa, price: priced ? price : 0, sale: priced ? discountedPrice(price, row.percent) : 0, notes };
    });
}

function campaignPreviewHtml(rows) {
  if (!rows.length) return '<p class="msg error">هیچ محصولی در این تخفیف نیست.</p>';
  return `
    <div class="dc-preview-head">${faNum(rows.length)} محصول — قیمت‌ها گرد به نزدیک‌ترین ۱٬۰۰۰ تومان</div>
    <div class="dc-scroll"><table class="dc-preview">
      <thead><tr><th>محصول</th><th>قیمت فعلی</th><th>قیمت با تخفیف</th><th>توضیح</th></tr></thead>
      <tbody>${rows
        .map(
          (r) => `<tr><td data-label="محصول">${escapeHtml(r.name_fa)}</td><td class="num" data-label="قیمت فعلی">${r.price ? money(r.price) : '—'}</td><td class="num" data-label="قیمت با تخفیف"><b>${
            r.sale ? money(r.sale) : '—'
          }</b></td><td class="dc-note">${r.notes.map(escapeHtml).join('<br>')}</td></tr>`
        )
        .join('')}</tbody>
    </table></div>`;
}

function campaignListHtml(campaigns, now = Date.now()) {
  if (!campaigns.length) return '<p>هنوز تخفیفی ساخته نشده است.</p>';
  return `<div class="dc-scroll"><table class="dc-list">
    <thead><tr><th>نام مناسبت</th><th>درصد</th><th>اعمال روی</th><th>از</th><th>تا</th><th>وضعیت</th><th></th></tr></thead>
    <tbody>${campaigns
      .map((c) => {
        const st = campaignStatus(c, now);
        return `<tr data-id="${escapeAttr(c.id)}">
        <td class="dc-name"><b>${escapeHtml(c.name)}</b></td>
        <td data-label="درصد">٪${faNum(c.percent)}</td>
        <td data-label="اعمال روی">${escapeHtml(campaignScopeFa(c))}</td>
        <td data-label="از">${campaignDateFa(c.starts_at)}</td>
        <td data-label="تا">${campaignDateFa(c.ends_at, true)}</td>
        <td data-label="وضعیت"><span class="status-pill dc-${st.key}">${st.label}</span></td>
        <td class="dc-actions">
          <button type="button" class="btn ghost" data-dc="edit">ویرایش</button>
          <button type="button" class="btn ghost" data-dc="toggle">${c.enabled ? 'توقف' : 'روشن کردن'}</button>
          <button type="button" class="btn danger" data-dc="delete">حذف</button>
        </td>
      </tr>`;
      })
      .join('')}</tbody>
  </table></div>`;
}

/** Year / month / day dropdowns for one date; `years` to offer. */
function jalaliPickerHtml(prefix, value, years) {
  const [vy, vm, vd] = value || [];
  const opt = (v, label, sel) => `<option value="${v}"${sel ? ' selected' : ''}>${label}</option>`;
  const ys = [...new Set([...years, ...(vy ? [vy] : [])])].sort();
  return `<span class="dc-date">
      <select id="${prefix}-d" aria-label="روز">${opt('', 'روز', !vd)}${Array.from({ length: 31 }, (_, i) => opt(i + 1, faNum(i + 1), vd === i + 1)).join('')}</select>
      <select id="${prefix}-m" aria-label="ماه">${opt('', 'ماه', !vm)}${JALALI_MONTHS.map((m, i) => opt(i + 1, m, vm === i + 1)).join('')}</select>
      <select id="${prefix}-y" aria-label="سال">${opt('', 'سال', !vy)}${ys.map((y) => opt(y, String(y).replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]), vy === y)).join('')}</select>
    </span>`;
}

/** The form, empty or filled from campaign c. */
function campaignFormHtml(c, products, now = Date.now()) {
  const thisYear = tehranJalaliOf(now)[0];
  const years = [thisYear, thisYear + 1, thisYear + 2];
  const start = c && c.starts_at ? tehranJalaliOf(Date.parse(c.starts_at)) : null;
  const end = c && c.ends_at ? tehranJalaliOf(Date.parse(c.ends_at) - 1) : null;
  const scope = (c && c.scope) || 'all';
  const cols = new Set((c && c.collections) || []);
  const slugs = new Set((c && c.product_slugs) || []);
  const sorted = [...products].sort((a, b) => String(a.name_fa).localeCompare(String(b.name_fa), 'fa'));
  return `
    <h2 style="margin-top:0; font-size:16px">${c ? `ویرایش «${escapeHtml(c.name)}»` : 'تخفیف تازه'}</h2>
    <div class="row">
      <div style="flex:2"><label for="dc-name">نام مناسبت (به مشتری نشان داده می‌شود)</label><input id="dc-name" maxlength="${CAMPAIGN_NAME_MAX}" value="${escapeAttr((c && c.name) || '')}" placeholder="مثلاً: یلدا"></div>
      <div><label for="dc-percent">درصد تخفیف (۱ تا ${faNum(DISCOUNT_MAX_PERCENT)})</label><input id="dc-percent" inputmode="numeric" dir="ltr" value="${c ? escapeAttr(c.percent) : ''}" placeholder="20"></div>
    </div>
    <fieldset class="dc-scope">
      <legend>اعمال روی</legend>
      <label><input type="radio" name="dc-scope" value="all" ${scope === 'all' ? 'checked' : ''}> همه محصولات</label>
      <label><input type="radio" name="dc-scope" value="collections" ${scope === 'collections' ? 'checked' : ''}> یک یا چند دسته</label>
      <label><input type="radio" name="dc-scope" value="products" ${scope === 'products' ? 'checked' : ''}> محصولات انتخابی</label>
    </fieldset>
    <div class="dc-cols" id="dc-cols" ${scope === 'collections' ? '' : 'hidden'}>
      ${Object.entries(COLLECTION_LABEL)
        .map(([k, label]) => `<label><input type="checkbox" class="dc-col" value="${k}" ${cols.has(k) ? 'checked' : ''}> ${escapeHtml(label)}</label>`)
        .join('')}
    </div>
    <div class="dc-products" id="dc-products" ${scope === 'products' ? '' : 'hidden'}>
      <input type="search" id="dc-product-search" placeholder="جستجوی محصول...">
      <div class="dc-checklist" id="dc-checklist">
        ${sorted
          .map(
            (p) =>
              `<label data-q="${escapeAttr((p.name_fa + ' ' + (p.name_en || '') + ' ' + p.slug).toLowerCase())}"><input type="checkbox" class="dc-prod" value="${escapeAttr(p.slug)}" ${
                slugs.has(p.slug) ? 'checked' : ''
              }> ${escapeHtml(p.name_fa)} <span class="dc-slug">${escapeHtml(p.slug)}</span></label>`
          )
          .join('')}
      </div>
    </div>
    <div class="row dc-dates">
      <div><label>تاریخ شروع (اختیاری — از ابتدای روز، به وقت ایران)</label>${jalaliPickerHtml('dc-start', start, years)}</div>
      <div><label>تاریخ پایان (اختیاری — تا پایان روز)</label>${jalaliPickerHtml('dc-end', end, years)}</div>
    </div>
    <label class="dc-switch"><input type="checkbox" id="dc-enabled" ${!c || c.enabled ? 'checked' : ''}> روشن (در بازه‌ی تاریخ، روی فروشگاه اعمال شود)</label>
    <div class="dc-buttons">
      <button type="button" class="btn ghost" id="dc-preview-btn">پیش‌نمایش قیمت‌ها</button>
      <button type="button" class="btn" id="dc-save">${c ? 'ذخیره تغییرات' : 'ذخیره تخفیف'}</button>
      ${c ? '<button type="button" class="btn ghost" id="dc-cancel">انصراف</button>' : ''}
    </div>
    <div class="msg" id="dc-msg"></div>
    <div id="dc-preview-box"></div>`;
}

let CAMPAIGNS_CACHE = [];
let campaignEditingId = null;

function readCampaignForm() {
  const val = (id) => (document.getElementById(id) || {}).value || '';
  const scopeEl = document.querySelector('input[name="dc-scope"]:checked');
  return {
    name: val('dc-name'),
    percent: val('dc-percent'),
    scope: scopeEl ? scopeEl.value : '',
    collections: [...document.querySelectorAll('.dc-col:checked')].map((el) => el.value),
    productSlugs: [...document.querySelectorAll('.dc-prod:checked')].map((el) => el.value),
    start: { y: val('dc-start-y'), m: val('dc-start-m'), d: val('dc-start-d') },
    end: { y: val('dc-end-y'), m: val('dc-end-m'), d: val('dc-end-d') },
    enabled: !!(document.getElementById('dc-enabled') || {}).checked,
  };
}

function setCampaignMsg(text, cls = '') {
  const msg = document.getElementById('dc-msg');
  msg.textContent = text;
  msg.className = 'msg' + (cls ? ' ' + cls : '');
}

function renderCampaignForm() {
  const c = CAMPAIGNS_CACHE.find((x) => x.id === campaignEditingId) || null;
  const box = document.getElementById('discount-form');
  box.innerHTML = campaignFormHtml(c, PRODUCTS_CACHE);
  box.querySelectorAll('input[name="dc-scope"]').forEach((r) =>
    r.addEventListener('change', () => {
      document.getElementById('dc-cols').hidden = r.value !== 'collections';
      document.getElementById('dc-products').hidden = r.value !== 'products';
    })
  );
  document.getElementById('dc-product-search').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    document.querySelectorAll('#dc-checklist label').forEach((l) => (l.hidden = !!q && !l.dataset.q.includes(q)));
  });
  document.getElementById('dc-preview-btn').addEventListener('click', () => previewCampaign());
  document.getElementById('dc-save').addEventListener('click', () => saveCampaign());
  const cancel = document.getElementById('dc-cancel');
  if (cancel)
    cancel.addEventListener('click', () => {
      campaignEditingId = null;
      renderCampaignForm();
    });
}

/** Validates the form and shows the preview table; returns the row or null. */
function previewCampaign() {
  const saved = campaignFormToSave(readCampaignForm());
  const box = document.getElementById('dc-preview-box');
  if (saved.error) {
    setCampaignMsg(saved.error, 'error');
    box.innerHTML = '';
    return null;
  }
  setCampaignMsg('');
  const row = { ...saved.row, id: campaignEditingId };
  box.innerHTML = campaignPreviewHtml(campaignPreviewRows(row, PRODUCTS_CACHE, CAMPAIGNS_CACHE));
  return saved.row;
}

async function saveCampaign() {
  const row = previewCampaign();
  if (!row) return;
  setCampaignMsg('در حال ذخیره...');
  const now = new Date().toISOString();
  const { error } = campaignEditingId
    ? await sb.from('discount_campaigns').update({ ...row, updated_at: now }).eq('id', campaignEditingId)
    : await sb.from('discount_campaigns').insert(row);
  if (error) return setCampaignMsg('خطا: ' + campaignErrorText(error), 'error');
  campaignEditingId = null;
  await loadCampaigns();
  setCampaignMsg('ذخیره شد. پیش‌نمایش بالا همان قیمت‌هایی است که فروشگاه نشان می‌دهد.', 'ok');
}

function campaignErrorText(error) {
  const m = String((error && (error.message || error.code)) || '');
  if (/discount_campaigns/.test(m) && /does not exist|could not find/i.test(m)) return MISSING_CAMPAIGNS_TABLE;
  return adminErrorText(error);
}

async function loadCampaigns() {
  const list = document.getElementById('discount-list');
  list.innerHTML = 'در حال بارگذاری...';
  if (!PRODUCTS_CACHE.length) {
    const { data } = await sb.from('products').select('*').order('sort_order', { ascending: true });
    PRODUCTS_CACHE = data || [];
  }
  const { data, error } = await sb.from('discount_campaigns').select('*').order('created_at', { ascending: false });
  if (error) {
    if (isNetworkError(error)) return showRetry(list, loadCampaigns);
    list.innerHTML = `<p class="msg error">${escapeHtml(campaignErrorText(error))}</p>`;
    return;
  }
  CAMPAIGNS_CACHE = data || [];
  list.innerHTML = campaignListHtml(CAMPAIGNS_CACHE);
  renderCampaignForm();
}

document.getElementById('discount-list').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-dc]');
  if (!btn) return;
  const id = btn.closest('tr').dataset.id;
  const c = CAMPAIGNS_CACHE.find((x) => String(x.id) === id);
  if (!c) return;
  if (btn.dataset.dc === 'edit') {
    campaignEditingId = c.id;
    renderCampaignForm();
    document.getElementById('discount-form').scrollIntoView({ block: 'start', behavior: 'smooth' });
    return;
  }
  btn.disabled = true;
  let error = null;
  if (btn.dataset.dc === 'toggle') {
    ({ error } = await sb.from('discount_campaigns').update({ enabled: !c.enabled, updated_at: new Date().toISOString() }).eq('id', c.id));
  } else if (btn.dataset.dc === 'delete') {
    if (!confirm(`حذف تخفیف «${c.name}»؟ سفارش‌های قبلی تغییری نمی‌کنند.`)) {
      btn.disabled = false;
      return;
    }
    ({ error } = await sb.from('discount_campaigns').delete().eq('id', c.id));
    if (!error && campaignEditingId === c.id) campaignEditingId = null;
  }
  if (error) {
    btn.disabled = false;
    alert('خطا: ' + campaignErrorText(error));
    return;
  }
  loadCampaigns();
});

// Boot
checkAdminAndRender();
