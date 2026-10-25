// supabase.co is blocked in Iran without a VPN, so the browser reaches
// Supabase through our own domain: vercel.json rewrites /sb/{rest,auth,
// storage}/v1 to the project, supabase-config.js points the client there,
// and photo URLs are mapped for display. The storefront waits for the live
// catalog (loading → one retry → error with «تلاش دوباره»), never showing the
// old data.js catalog; the admin panel shows Persian connection errors.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const configJs = read('../../supabase-config.js');
const appJs = read('../../app.js');
const adminJs = read('../../admin/admin.js');
const adminHtml = read('../../admin/index.html');
const vercel = JSON.parse(read('../../vercel.json'));

const SUPABASE = 'https://sgfoesnpodvwyzlxfhtq.supabase.co';
const grab = (src, re) => {
  const m = src.match(re);
  assert.ok(m, 'not found: ' + re);
  return m[0];
};

/** Runs supabase-config.js as the browser would, on the given origin. */
function loadConfig(origin) {
  const calls = [];
  const window = { supabase: { createClient: (...args) => (calls.push(args), { client: true }) } };
  const api = new Function(
    'location', 'window',
    configJs + '\nreturn { getSupabaseClient, proxiedPhotoUrl, canonicalPhotoUrl, SUPABASE_URL };'
  )({ origin }, window);
  return { ...api, calls };
}

// ---- photo URL helpers --------------------------------------------------------

test('proxiedPhotoUrl: supabase.co storage URLs go through /sb on the current origin', () => {
  const { proxiedPhotoUrl } = loadConfig('https://glow-home.ir');
  const path = '/storage/v1/object/public/product-images/gisoo-1730000000000.jpg';
  assert.equal(proxiedPhotoUrl(SUPABASE + path), 'https://glow-home.ir/sb' + path);
  assert.equal(proxiedPhotoUrl('  ' + SUPABASE + path + '?v=2 '), 'https://glow-home.ir/sb' + path + '?v=2');
  // www and preview deployments use their own origin
  assert.equal(loadConfig('https://www.glow-home.ir').proxiedPhotoUrl(SUPABASE + path), 'https://www.glow-home.ir/sb' + path);
  assert.equal(loadConfig('https://glow-home-abc.vercel.app').proxiedPhotoUrl(SUPABASE + path), 'https://glow-home-abc.vercel.app/sb' + path);
});

test('proxiedPhotoUrl: /sb URLs, relative paths and other hosts are unchanged; null/empty is safe', () => {
  const { proxiedPhotoUrl } = loadConfig('https://glow-home.ir');
  for (const url of [
    'https://glow-home.ir/sb/storage/v1/object/public/product-images/a.jpg',
    'images/gisoo.jpg',
    '/images/gisoo.jpg',
    'https://example.com/storage/v1/object/public/a.jpg',
    SUPABASE + '/rest/v1/products', // only storage is mapped
  ]) {
    assert.equal(proxiedPhotoUrl(url), url);
  }
  for (const v of [null, undefined, '', '   ']) assert.equal(proxiedPhotoUrl(v), '');
});

test('canonicalPhotoUrl turns the /sb form back into the supabase.co URL to store', () => {
  const { canonicalPhotoUrl, proxiedPhotoUrl } = loadConfig('https://glow-home.ir');
  const stored = SUPABASE + '/storage/v1/object/public/product-images/a-1.jpg';
  assert.equal(canonicalPhotoUrl('https://glow-home.ir/sb/storage/v1/object/public/product-images/a-1.jpg'), stored);
  assert.equal(canonicalPhotoUrl(stored), stored);
  assert.equal(canonicalPhotoUrl('images/a.jpg'), 'images/a.jpg');
  assert.equal(canonicalPhotoUrl(null), '');
  assert.equal(canonicalPhotoUrl(proxiedPhotoUrl(stored)), stored);
});

// ---- client ------------------------------------------------------------------

test('the Supabase client is created with <origin>/sb, the same key, and the old session key', () => {
  const { getSupabaseClient, calls } = loadConfig('https://glow-home.ir');
  getSupabaseClient();
  assert.equal(calls.length, 1);
  const [url, key, options] = calls[0];
  assert.equal(url, 'https://glow-home.ir/sb');
  assert.equal(key, 'sb_publishable_A27vHVa_NH46_BdUbwSZXQ_wWSHebBz');
  assert.deepEqual(options, { auth: { storageKey: 'sb-sgfoesnpodvwyzlxfhtq-auth-token' } });
  assert.equal(loadConfig('https://www.glow-home.ir').getSupabaseClient() && true, true);
});

test('no browser code calls supabase.co directly', () => {
  for (const [name, src] of [['app.js', appJs], ['admin.js', adminJs], ['admin/index.html', adminHtml], ['index.html', read('../../index.html')]]) {
    assert.doesNotMatch(src, /https?:\/\/[a-z0-9.-]*supabase\.co/i, name);
  }
  // the only createClient call is the one in supabase-config.js
  assert.doesNotMatch(appJs + adminJs, /createClient/);
});

test('the bundled supabase-js builds rest/auth/storage URLs under the base URL (keeps /sb)', () => {
  const vendor = read('../../vendor/supabase.js');
  assert.match(vendor, /PostgrestClient\(`\$\{a\}\/rest\/v1`/);
  assert.match(vendor, /this\.authUrl=`\$\{a\}\/auth\/v1`/);
  assert.match(vendor, /this\.storageUrl=`\$\{a\}\/storage\/v1`/);
});

// ---- vercel.json -------------------------------------------------------------

test('vercel.json proxies exactly /sb/rest, /sb/auth and /sb/storage to the project', () => {
  assert.deepEqual(vercel.rewrites, ['rest', 'auth', 'storage'].map((s) => ({
    source: `/sb/${s}/v1/:path*`,
    destination: `${SUPABASE}/${s}/v1/:path*`,
  })));
  // nothing else is rewritten, so /api/*, /admin and the storefront are untouched
  for (const r of vercel.rewrites) assert.match(r.source, /^\/sb\/(rest|auth|storage)\/v1\//);
});

test('vercel.json: data and sessions are never cached; public photos are cached for a year', () => {
  const headersFor = (source) => Object.fromEntries((vercel.headers.find((h) => h.source === source) || { headers: [] }).headers.map((h) => [h.key, h.value]));
  for (const source of ['/sb/rest/v1/(.*)', '/sb/auth/v1/(.*)']) {
    assert.deepEqual(headersFor(source), { 'x-vercel-enable-rewrite-caching': '0', 'Cache-Control': 'no-store' }, source);
  }
  assert.deepEqual(headersFor('/sb/storage/v1/object/public/(.*)'), {
    'x-vercel-enable-rewrite-caching': '1',
    'CDN-Cache-Control': 'public, max-age=31536000, immutable',
    'Cache-Control': 'public, max-age=31536000, immutable',
  });
  // year-long caching is safe only because every upload gets a new name and never overwrites
  assert.match(adminJs, /return `\$\{base \|\| 'product'\}-\$\{now\}\.\$\{ext === 'png' \? 'png' : 'jpg'\}`;/);
  assert.match(adminJs, /upsert: false/);
});

// ---- storefront catalog -------------------------------------------------------

/** Runs the real fetchCatalog / loadProductsFromSupabase with a fake client. */
function catalogEnv(tries, { tryMs = [10000, 5000] } = {}) {
  const state = { catalog: 'loading', cart: {}, route: 'home' };
  const renders = [];
  const loader = grab(appJs, /const CATALOG_TRY_MS = [\s\S]*?\nasync function loadProductsFromSupabase\(\) \{[\s\S]*?\n}\n/)
    .replace(/const CATALOG_TRY_MS = \[[^\]]*\];/, `const CATALOG_TRY_MS = ${JSON.stringify(tryMs)};`)
    .replace('const CATALOG_RETRY_PAUSE_MS = 1000;', 'const CATALOG_RETRY_PAUSE_MS = 1;');
  let calls = 0;
  const sb = {
    from: () => {
      const q = {
        select: () => q,
        order: () => q,
        abortSignal: (signal) => {
          const behaviour = tries[calls++] || 'fail';
          if (behaviour === 'hang') {
            return new Promise((resolve) => signal.addEventListener('abort', () => resolve({ data: null, error: { message: 'AbortError: aborted' } })));
          }
          if (behaviour === 'fail') return Promise.resolve({ data: null, error: { message: 'TypeError: Failed to fetch' } });
          if (behaviour === 'empty') return Promise.resolve({ data: [], error: null });
          return Promise.resolve({ data: [{ slug: 'gisoo', name_fa: 'گیسو', name_en: '', collection: 'lamps', price: 9100000, in_stock: true }], error: null });
        },
      };
      return q;
    },
  };
  const env = { PRODUCTS: 'data.js catalog', ITEMS: [] };
  const api = new Function(
    'state', 'render', 'getSupabaseClient', 'env',
    `let PRODUCTS = env.PRODUCTS, PRICE, PROVISIONAL, OUT_OF_STOCK, ITEMS = [];
     const HEIGHT_UNKNOWN = -1, saveStore = () => {}, hasShadeTypes = () => false, cartLineData = () => null, parseCartKey = (k) => ({ id: k });
     const byId = (id) => ITEMS.find((p) => p.id === id);
     function buildItems() { ITEMS = PRODUCTS.map((p) => ({ ...p })); env.ITEMS = ITEMS; }
     ${loader}
     return { loadProductsFromSupabase, products: () => PRODUCTS };`
  )(state, () => renders.push(state.catalog), () => sb, env);
  return { state, renders, api, env, calls: () => calls };
}

test('catalog: both tries fail → error state, and the data.js catalog is never used', async () => {
  const { state, renders, api, env, calls } = catalogEnv(['fail', 'fail']);
  await api.loadProductsFromSupabase();
  assert.equal(calls(), 2, 'one automatic retry');
  assert.equal(state.catalog, 'error');
  assert.deepEqual(renders, ['loading', 'error']);
  assert.equal(api.products(), 'data.js catalog'); // untouched, and never built into ITEMS
  assert.deepEqual(env.ITEMS, []);
});

test('catalog: first try fails, the automatic retry succeeds → ready', async () => {
  const { state, renders, env, api, calls } = catalogEnv(['fail', 'ok']);
  await api.loadProductsFromSupabase();
  assert.equal(calls(), 2);
  assert.equal(state.catalog, 'ready');
  assert.deepEqual(renders, ['loading', 'ready']);
  assert.equal(env.ITEMS[0].fa, 'گیسو');
});

test('catalog: a hanging request times out, is retried once, then shows the error', async () => {
  const { state, api, calls } = catalogEnv(['hang', 'hang'], { tryMs: [20, 20] });
  const t0 = Date.now();
  await api.loadProductsFromSupabase();
  assert.equal(calls(), 2);
  assert.equal(state.catalog, 'error');
  assert.ok(Date.now() - t0 < 2000);
});

test('catalog: an empty product list counts as a failure, not as "no products"', async () => {
  const { state, api, calls } = catalogEnv(['empty', 'empty']);
  await api.loadProductsFromSupabase();
  assert.equal(calls(), 2);
  assert.equal(state.catalog, 'error');
});

test('catalog: the error shows within 15 s — 10 s first try, 5 s retry', () => {
  const tries = JSON.parse(grab(appJs, /const CATALOG_TRY_MS = (\[[^\]]*\]);/).match(/\[[^\]]*\]/)[0]);
  assert.deepEqual(tries, [10000, 5000]);
  assert.ok(tries.reduce((a, b) => a + b, 0) + 1000 <= 16000);
});

test('product screens show loading / the Persian error with «تلاش دوباره»; other pages do not wait', () => {
  const statusSrc = grab(appJs, /const CATALOG_ERROR =[\s\S]*?\nfunction screenCatalogStatus\(\) \{[\s\S]*?\n}\n/);
  const screen = (catalog) => new Function('state', 'esc', statusSrc + 'return screenCatalogStatus();')({ catalog }, String);
  const error = screen('error');
  assert.match(error, /در حال حاضر دریافت محصولات ممکن نیست\. لطفاً اتصال اینترنت را بررسی کنید و دوباره تلاش کنید\./);
  assert.match(error, /<button class="btn btn-primary" data-act="catalog-retry">تلاش دوباره<\/button>/);
  assert.match(screen('loading'), /در حال بارگذاری محصولات…/);

  assert.match(appJs, /const CATALOG_SCREENS = new Set\(\[screenHome, screenShop, screenCollection, screenProduct, screenCart, screenCheckout\]\);/);
  assert.match(appJs, /const body = \(state\.catalog !== 'ready' && CATALOG_SCREENS\.has\(screen\) \? screenCatalogStatus : screen\)\(\);/);
  assert.match(appJs, /'catalog-retry': \(\) => \{\n    if \(state\.catalog === 'loading'\) return;\n    loadProductsFromSupabase\(\);/);
});

test('the data.js catalog is never built at startup', () => {
  // buildItems() runs only inside loadProductsFromSupabase, after a successful fetch
  assert.equal((appJs.match(/\n\s*buildItems\(\);/g) || []).length, 1);
  const loader = grab(appJs, /async function loadProductsFromSupabase\(\) \{[\s\S]*?\n}\n/);
  assert.ok(loader.indexOf('buildItems();') > loader.indexOf("state.catalog = 'error'"));
  assert.match(appJs, /catalog: 'loading',/);
});

// ---- admin --------------------------------------------------------------------

const adminFns = new Function(
  grab(adminJs, /const NETWORK_ERROR = [^\n]*\n/) +
    grab(adminJs, /function isNetworkError\([\s\S]*?\n}\n/) +
    grab(adminJs, /function adminErrorText\([\s\S]*?\n}\n/) +
    'return { isNetworkError, adminErrorText, NETWORK_ERROR };'
)();

test('admin: connection failures show a Persian message, not "TypeError: Failed to fetch"', () => {
  const { adminErrorText, NETWORK_ERROR } = adminFns;
  assert.equal(NETWORK_ERROR, 'اتصال به سرور برقرار نشد. لطفاً اتصال اینترنت را بررسی کنید و دوباره تلاش کنید.');
  for (const e of [
    { message: 'TypeError: Failed to fetch' },
    { message: 'Failed to fetch', name: 'AuthRetryableFetchError', status: 0 },
    { name: 'AuthRetryableFetchError', message: '' },
    { message: 'NetworkError when attempting to fetch resource.' },
    { message: 'Load failed' }, // Safari
    { message: 'AbortError: The user aborted a request.' },
    new TypeError('Failed to fetch'),
    // the /sb proxy answered with an error page instead of Supabase's JSON
    { name: 'AuthUnknownError', message: 'Unexpected token \'o\', "not found" is not valid JSON' },
    { message: 'SyntaxError: Unexpected token \'<\', "<!DOCTYPE "... is not valid JSON' },
    { message: 'ROUTER_EXTERNAL_TARGET_ERROR', status: 502 },
    { message: 'Bad gateway', status: 504 },
  ]) {
    assert.equal(adminErrorText(e), NETWORK_ERROR, JSON.stringify(e));
  }
});

test('admin: real Supabase errors keep their own message', () => {
  const { adminErrorText, isNetworkError } = adminFns;
  assert.equal(adminErrorText({ message: 'Invalid login credentials', status: 400 }), 'Invalid login credentials');
  assert.equal(adminErrorText({ message: 'new row violates row-level security policy' }), 'new row violates row-level security policy');
  assert.equal(isNetworkError(null), false);
});

test('admin: retry buttons for login check, products and orders; no raw error text on those paths', () => {
  assert.match(adminHtml, /<div id="offline-view" class="wrap">[\s\S]*?<button class="btn" id="btn-offline-retry">تلاش دوباره<\/button>/);
  assert.match(adminHtml, /#not-admin-view, #offline-view \{ display: none;/);
  assert.match(adminJs, /if \(isNetworkError\(error\)\) return showOffline\(\);/); // not "not an admin"
  assert.match(adminJs, /if \(isNetworkError\(error\)\) return showRetry\(tbody, loadProducts,/);
  assert.match(adminJs, /if \(isNetworkError\(error\)\) return showRetry\(list, loadOrders,/);
  assert.match(adminJs, /loginMsg\.textContent = adminErrorText\(error\);/);
  assert.doesNotMatch(adminJs, /loginMsg\.textContent = error\.message/);
  assert.doesNotMatch(adminJs, /alert\([^)]*error\.message/);
});

test('admin photo upload: stores the canonical supabase.co URL and stays under the proxy body limit', () => {
  assert.match(adminJs, /urlInput\.value = canonicalPhotoUrl\(data\.publicUrl\);/);
  assert.match(adminJs, /const PHOTO_UPLOAD_MAX_BYTES = 4 \* 1024 \* 1024;/);
  assert.match(adminJs, /if \(prepared\.blob\.size > PHOTO_UPLOAD_MAX_BYTES\) \{/);
  // the guard runs before the upload
  assert.ok(adminJs.indexOf('prepared.blob.size > PHOTO_UPLOAD_MAX_BYTES') < adminJs.indexOf('.upload(name, prepared.blob'));
  // the existing resize stays: longest side 1600 px, JPEG 0.85
  assert.match(adminJs, /const PHOTO_MAX_SIDE = 1600;/);
  assert.match(adminJs, /canvas\.toBlob\(resolve, type, 0\.85\)/);
});
