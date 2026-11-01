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
  });
});

/* ---- Products ----------------------------------------------------------
   Each row has a quick-edit strip (price / provisional / in stock — the
   things you change often) plus a "ویرایش کامل" toggle that reveals every
   other field (subcategory, style, material, height, description, colors,
   size variants). Colors are a plain comma-separated list. Variants are a
   small repeatable height+price list, stored as the same [{height,price}]
   shape the storefront's size picker already reads. A product whose sizes
   are also priced by shade type (گیسو, دفرمه — see supabase/migration-*-shades.sql)
   gets one price per shade type found in its data instead, stored as
   {height, price: <plain>, shades: {plain, embroidered | macrame}}. */

const COLLECTION_LABEL = { lamps: 'آباژور', shades: 'شید', candles: 'شمع', decor: 'اکسسوری منزل' };
const STYLE_OPTIONS = ['', 'رومیزی', 'کنار سالنی'];

const hasShadeTypes = (p) =>
  Array.isArray(p.variants) && p.variants.some((v) => v && v.shades && typeof v.shades === 'object');

// Same labels as SHADE_TYPES in app.js, api/orders.js and payment-server.
const SHADE_TYPES = { plain: 'شید ساده', embroidered: 'شید گلدوزی', macrame: 'شید مکرومه' };

// The shade types a product's sizes are priced by, in SHADE_TYPES order
// (plain first): gisoo → plain, embroidered; deforme → plain, macrame.
const shadeKeysOf = (p) =>
  Object.keys(SHADE_TYPES).filter((k) => p.variants.some((v) => v && v.shades && Object.hasOwn(v.shades, k)));

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
 * fields above it. No-op for shade-type products or a closed panel. */
function syncBaseRow(id) {
  const list = document.getElementById(`variants-list-${id}`);
  const heightInput = document.getElementById(`f-height-${id}`);
  const p = PRODUCTS_CACHE.find((x) => x.id === id);
  if (!list || !heightInput || !p || hasShadeTypes(p)) return;
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
   «انتخاب عکس از کامپیوتر» (or drag-and-drop onto the preview): the photo is
   checked, turned upright (the browser applies the EXIF orientation when
   decoding), shrunk to at most 1600 px on the longest side, re-encoded as
   JPEG 0.85 (a PNG with transparency stays PNG), and uploaded to the public
   Supabase Storage bucket «product-images» (supabase/migration-product-
   images-bucket.sql). Its public URL goes into the photo field; the product
   itself is only saved by the usual save button. Old files are never
   deleted. */

const PHOTO_BUCKET = 'product-images';
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const PHOTO_MAX_BYTES = 15 * 1024 * 1024;
const PHOTO_MAX_SIDE = 1600;
// Uploads go through our /sb proxy on Vercel; Vercel's documented request-body
// cap (for functions) is 4.5 MB, so stay under it after resizing.
const PHOTO_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;
const photoUploads = new Set(); // photo fields with an upload in flight

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

/** Markup for one photo field; `key` is "new" or a product id. The URL input
 * (id = urlInputId) is what the save code reads, as before. */
function photoFieldHtml(key, urlInputId, path) {
  const src = resolvePhotoSrc(path);
  return `
    <div class="photo-field">
      <div class="photo-drop" id="photo-drop-${key}" title="عکس را اینجا رها کنید">
        <img id="photo-preview-${key}" alt="" ${src ? `src="${escapeAttr(src)}"` : 'hidden'}>
        <span class="photo-empty" id="photo-empty-${key}" ${src ? 'hidden' : ''}>بدون عکس<br>عکس را اینجا رها کنید</span>
      </div>
      <div class="photo-side">
        <button type="button" class="btn ghost" id="photo-pick-${key}">انتخاب عکس از کامپیوتر</button>
        <input type="file" id="photo-file-${key}" accept="image/jpeg,image/png,image/webp" hidden>
        <div class="msg" id="photo-status-${key}"></div>
        <details class="photo-manual">
          <summary>آدرس دستی (پیشرفته)</summary>
          <input id="${urlInputId}" dir="ltr" value="${escapeAttr(path || '')}" placeholder="images/xxx.jpg">
        </details>
      </div>
    </div>`;
}

/** Wires a rendered photo field. slugOf() gives the product slug for the file name. */
function wirePhotoField(key, urlInputId, slugOf) {
  const drop = document.getElementById(`photo-drop-${key}`);
  const preview = document.getElementById(`photo-preview-${key}`);
  const empty = document.getElementById(`photo-empty-${key}`);
  const pick = document.getElementById(`photo-pick-${key}`);
  const fileInput = document.getElementById(`photo-file-${key}`);
  const status = document.getElementById(`photo-status-${key}`);
  const urlInput = document.getElementById(urlInputId);

  const showPreview = (path) => {
    const src = resolvePhotoSrc(path);
    preview.hidden = !src;
    empty.hidden = !!src;
    if (src) preview.src = src;
    else preview.removeAttribute('src');
  };
  const setStatus = (text, cls = '') => {
    status.textContent = text;
    status.className = 'msg' + (cls ? ' ' + cls : '');
  };

  async function upload(file) {
    if (photoUploads.has(key)) return;
    const problem = checkPhotoFile(file);
    if (problem) return setStatus(problem, 'error');

    photoUploads.add(key);
    pick.disabled = true;
    setStatus('در حال آپلود…');
    try {
      let prepared;
      try {
        prepared = await preparePhoto(file);
      } catch (err) {
        console.error('[admin] photo decode failed:', err);
        return setStatus('این عکس باز نشد. فایل دیگری را امتحان کنید.', 'error');
      }
      if (prepared.blob.size > PHOTO_UPLOAD_MAX_BYTES) {
        return setStatus('حجم عکس بعد از فشرده‌سازی هنوز زیاد است. عکس دیگری انتخاب کنید.', 'error');
      }
      const name = photoFileName(slugOf(), Date.now(), prepared.ext);
      const { error } = await sb.storage
        .from(PHOTO_BUCKET)
        .upload(name, prepared.blob, { contentType: prepared.type, cacheControl: '31536000', upsert: false });
      if (error) {
        console.error('[admin] photo upload failed:', error);
        return setStatus(photoUploadError(error), 'error');
      }
      // Store the canonical supabase.co URL (the client's own URL is this
      // site's /sb proxy); previews and the shop rewrite it for display.
      const { data } = sb.storage.from(PHOTO_BUCKET).getPublicUrl(name);
      urlInput.value = canonicalPhotoUrl(data.publicUrl);
      showPreview(urlInput.value);
      setStatus('عکس آپلود شد. برای ثبت، محصول را ذخیره کنید.', 'ok');
    } catch (err) {
      console.error('[admin] photo upload failed:', err);
      setStatus(photoUploadError(err), 'error');
    } finally {
      photoUploads.delete(key);
      pick.disabled = false;
      fileInput.value = '';
    }
  }

  pick.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => fileInput.files[0] && upload(fileInput.files[0]));
  urlInput.addEventListener('input', () => showPreview(urlInput.value));
  preview.addEventListener('error', () => setStatus('این عکس نمایش داده نمی‌شود. آدرس را بررسی کنید.', 'error'));
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('dragging');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('dragging'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('dragging');
    const file = e.dataTransfer && e.dataTransfer.files[0];
    if (file) upload(file);
  });
}

// A photo dropped next to (not onto) a drop box must not make the browser
// leave the panel to open the image.
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

document.getElementById('new-photo-field').innerHTML = photoFieldHtml('new', 'new-photo', '');
wirePhotoField('new', 'new-photo', () => document.getElementById('new-slug').value);

/** The photo the storefront shows first: photos[0] when there is a gallery,
 * else photo_url (same rule as app.js). */
function mainPhoto(p) {
  return (Array.isArray(p.photos) && p.photos[0]) || p.photo_url || '';
}

/** Fields to save when the main photo changed: photo_url and photos[0] move
 * together (the rest of the gallery stays); null when unchanged. */
function mainPhotoFields(p, newPath) {
  const path = String(newPath ?? '').trim();
  if (path === mainPhoto(p)) return null;
  const fields = { photo_url: path };
  if (Array.isArray(p.photos) && p.photos.length) fields.photos = [path, ...p.photos.slice(1)];
  return fields;
}

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
        <div id="edit-panel-${p.id}"></div>
      </td>
    </tr>`;
}

function editPanelHtml(p) {
  const variants = Array.isArray(p.variants) ? p.variants : [];
  const shadeKeys = hasShadeTypes(p) ? shadeKeysOf(p) : null;
  // Without shade types: the base size first (see "Sizes" above), then the
  // other sizes. A stored row at the base height IS the base row.
  const otherSizes = shadeKeys ? variants : withBaseSize(variants, p.height_cm, p.price).filter((v) => v.height !== p.height_cm);
  const baseSize = shadeKeys ? null : baseSizeOf(p.height_cm, p.price, otherSizes.length);
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
            <label>عکس اصلی</label>
            ${photoFieldHtml(p.id, `f-photo-${p.id}`, mainPhoto(p))}
          </div>
        </div>
        <div class="edit-grid wide" style="margin-top:10px">
          <div>
            <label>توضیحات</label>
            <input id="f-desc-${p.id}" value="${escapeAttr(p.description || '')}">
          </div>
        </div>
        <div style="margin-top:14px">
          <label>${
            shadeKeys
              ? 'اندازه‌ها و قیمت هر اندازه برای ' + shadeKeys.map((k) => SHADE_TYPES[k]).join(' و ') + ' (تومان)'
              : 'اندازه‌ها و قیمت هر اندازه (در صورت وجود چند سایز)'
          }</label>
          <div id="variants-list-${p.id}">
            ${baseSize ? baseRowHtml(baseSize.height, baseSize.price) : ''}${otherSizes
              .map((v, i) => (shadeKeys ? shadeVariantRowHtml(i, shadeKeys, v) : variantRowHtml(p.id, i, v.height, v.price)))
              .join('')}
          </div>
          <button class="link-btn" id="add-variant-${p.id}">+ افزودن اندازه</button>
        </div>
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

function shadeVariantRowHtml(i, shadeKeys, v = {}) {
  const sh = v.shades || {};
  return `
    <div class="variant-row" data-idx="${i}">
      <input type="number" placeholder="ارتفاع (سانتی‌متر)" class="v-height" value="${v.height ?? ''}">
      ${shadeKeys
        .map(
          (k) =>
            `<input type="text" inputmode="numeric" dir="ltr" placeholder="قیمت ${SHADE_TYPES[k]} (تومان)" class="v-shade-price price-input" data-shade="${k}" value="${formatPrice(sh[k])}">`
        )
        .join('')}
      <button class="btn ghost remove-variant" type="button">حذف</button>
    </div>`;
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

  document.getElementById(`add-variant-${id}`).addEventListener('click', () => {
    const list = document.getElementById(`variants-list-${id}`);
    const idx = list.children.length;
    list.insertAdjacentHTML(
      'beforeend',
      hasShadeTypes(p) ? shadeVariantRowHtml(idx, shadeKeysOf(p)) : variantRowHtml(id, idx, '', '')
    );
    // The first added size brings the base size in with it, as row one.
    syncBaseRow(id);
    wireVariantRemove(list, () => syncBaseRow(id));
  });
  wireVariantRemove(document.getElementById(`variants-list-${id}`), () => syncBaseRow(id));

  wirePhotoField(id, `f-photo-${id}`, () => p.slug);
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
    msg.textContent = 'صبر کنید تا آپلود عکس تمام شود.';
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
  if (cachedRow && hasShadeTypes(cachedRow)) {
    // Every size needs every shade price — a half-filled row is an error,
    // not silently dropped, because the server rejects unknown sizes.
    const isPrice = (n) => Number.isSafeInteger(n) && n > 0;
    const shadeKeys = shadeKeysOf(cachedRow);
    for (const row of variantRows) {
      const h = Number(row.querySelector('.v-height').value);
      const shades = {};
      for (const input of row.querySelectorAll('.v-shade-price')) shades[input.dataset.shade] = Number(unformatPrice(input.value));
      const complete = shadeKeys.every((k) => isPrice(shades[k]));
      if (!isPrice(h) || !complete || variants.some((v) => v.height === h)) {
        msg.textContent = 'خطا: برای هر اندازه، ارتفاع (تکراری نباشد) و همه‌ی قیمت‌های شید را وارد کنید.';
        msg.className = 'msg error';
        return;
      }
      variants.push({ height: h, price: shades.plain ?? shades[shadeKeys[0]], shades });
    }
    // The card and its "افزودن به سبد" use the base size, so it must be one
    // of the sizes; the base price follows that size's plain price.
    const base = variants.find((v) => v.height === height_cm);
    if (!base) {
      msg.textContent = 'خطا: ارتفاع پایه باید یکی از اندازه‌های بالا باشد.';
      msg.className = 'msg error';
      return;
    }
    basePrice = base.price;
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

  const photoPath = document.getElementById(`f-photo-${id}`).value.trim();
  if (!photoPath && mainPhoto(cachedRow || {})) {
    msg.textContent = 'خطا: عکس اصلی را نمی‌توان خالی گذاشت. برای عوض کردن، عکس دیگری انتخاب کنید.';
    msg.className = 'msg error';
    return;
  }

  const fields = { name_fa, name_en, subcategory, style, material, height_cm, description, colors, variants };
  if (basePrice != null) fields.price = basePrice;
  const photoFields = mainPhotoFields(cachedRow || {}, photoPath);
  if (photoFields) Object.assign(fields, photoFields);
  // body_size / shade_size only exist after supabase/migration-lamp-sizes.sql.
  // Send them only when the loaded row has them, so a save still works if
  // this panel is deployed before the migration runs.
  if (cachedRow && 'body_size' in cachedRow) Object.assign(fields, { body_size, shade_size });

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
    addMsg.textContent = 'صبر کنید تا آپلود عکس تمام شود.';
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
    photo_url: document.getElementById('new-photo').value.trim() || null,
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
    'new-height', 'new-price', 'new-photo', 'new-desc', 'new-body-size', 'new-shade-size',
  ].forEach((id) => (document.getElementById(id).value = ''));
  document.getElementById('new-style').value = '';
  document.getElementById('new-photo').dispatchEvent(new Event('input')); // clear the preview
  document.getElementById('photo-status-new').textContent = '';
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
              `<div class="order-item-row"><span>${escapeHtml(it.name_fa)} × ${it.qty}</span><span>${money(it.unit_price * it.qty)}</span></div>`
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

// `origin` (location.origin) makes the font URLs absolute: the print window
// starts as about:blank, where a root-relative URL may not resolve.
function orderPrintHtml(o, items, origin = '') {
  const products = items.filter((it) => it.product_id != null);
  const fees = items.filter((it) => it.product_id == null);
  const itemsSum = products.reduce((sum, it) => sum + it.unit_price * it.qty, 0);
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
  .sender { border: 1.5px solid #000; padding: 1.5mm 4mm; margin-top: 3mm; font-size: 12pt; }
  .sender b { font-size: 11pt; }
  .notes { border: 1px solid #000; padding: 2.5mm 4mm; margin-top: 3mm; font-size: 11pt; white-space: pre-wrap; }
  .cut { margin: 4.5mm 0 4mm; border-top: 1.5px dashed #000; position: relative; height: 0; }
  .cut span { position: absolute; top: -9pt; inset-inline-start: 4mm; background: #fff; padding: 0 2mm; font-size: 12pt; }
  table { width: 100%; border-collapse: collapse; font-size: 10.5pt; }
  th, td { border: 1px solid #000; padding: 1.1mm 2mm; text-align: start; vertical-align: top; }
  th { font-weight: 700; }
  td.n, th.n { text-align: center; width: 10mm; }
  td.num, th.num { text-align: left; white-space: nowrap; }
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
  .screen-only { margin: 12px auto; max-width: 186mm; text-align: center; font-family: inherit; }
  .screen-only button { font: inherit; padding: 8px 22px; border: 1px solid #000; background: #fff; cursor: pointer; }
  @media print { .screen-only { display: none; } }
</style>
</head>
<body>
<div class="screen-only"><button type="button" id="print-again">چاپ دوباره</button></div>
<div class="page">
  <div class="head"><span class="brand ltr">Glow Home</span><span class="doc">برگه سفارش</span></div>
  <div class="meta"><span class="code ltr">${escapeHtml(o.code)}</span><span>${escapeHtml(date)}</span></div>

  <div class="block">
    <h2>ارسال به</h2>
    <div class="label">
      <div class="name">${escapeHtml(o.customer_name || '')}</div>
      <div class="row">موبایل: ${ltr(o.phone || '')}</div>
      <div class="row">نشانی: ${escapeHtml(o.address || '')}</div>
      <div class="row">شهر: ${escapeHtml(o.city || '')}</div>
      ${o.postcode ? `<div class="row">کد پستی: ${ltr(o.postcode)}</div>` : ''}
      <div class="method">روش ارسال: ${escapeHtml(method)}</div>
    </div>
    <div class="sender"><b>فرستنده:</b> ${escapeHtml(SHOP_SENDER_NAME)} — ${ltr(phoneDisplay(SHOP_SENDER_PHONE))}</div>
    ${o.note ? `<div class="notes"><b>توضیحات مشتری:</b> ${escapeHtml(o.note)}</div>` : ''}
  </div>

  <div class="cut" aria-hidden="true"><span>✂</span></div>

  <h2>محتویات سفارش</h2>
  <table>
    <thead><tr><th class="n">ردیف</th><th>نام محصول</th><th class="n">تعداد</th><th class="num">قیمت واحد</th><th class="num">جمع</th></tr></thead>
    <tbody>
      ${products
        .map(
          (it, i) =>
            `<tr><td class="n">${faNum(i + 1)}</td><td>${escapeHtml(it.name_fa)}</td><td class="n">${faNum(it.qty)}</td><td class="num">${money(it.unit_price)}</td><td class="num">${money(it.unit_price * it.qty)}</td></tr>`
        )
        .join('')}
    </tbody>
  </table>
  <div class="totals">
    <div><span>جمع اقلام</span><span>${money(itemsSum)}</span></div>
    ${fees.map((f) => `<div><span>${escapeHtml(f.name_fa)}</span><span>${money(f.unit_price * f.qty)}</span></div>`).join('')}
    ${discount > 0 ? `<div><span>تخفیف${o.discount_code ? ` (${ltr(o.discount_code)})` : ''}</span><span>−${money(discount)}</span></div>` : ''}
    <div class="grand"><span>${pay.paid ? 'مبلغ پرداخت‌شده' : 'مبلغ سفارش (پرداخت‌نشده)'}</span><span>${money(o.total)}</span></div>
  </div>
  <div class="pay">${pay.label}${pay.refId ? ` — کد پیگیری: ${ltr(pay.refId)}` : ''}</div>

  <div class="checks"><span>بسته‌بندی شد<span class="box"></span></span><span>ارسال شد<span class="box"></span></span></div>

  <div class="foot"><span>از خرید شما سپاسگزاریم</span><span class="ltr">glow-home.ir · Instagram: @${escapeHtml(SHOP_INSTAGRAM)}</span></div>
</div>
</body>
</html>`;
}

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
  const fonts = win.document.fonts && win.document.fonts.ready;
  (fonts || Promise.resolve()).then(() => setTimeout(print, 100));
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

// Boot
checkAdminAndRender();
