/* ==========================================================================
   Glow Home — front-end prototype.
   No backend: nothing is sent, charged or stored on a server. Placing an
   order generates an order code locally and clears the cart.
   ========================================================================== */

/* ---- Helpers ------------------------------------------------------------ */

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

/** Convert Latin digits to Persian digits. */
const FA = (s) => String(s).replace(/[0-9]/g, (d) => FA_DIGITS[d]);

/** Format a toman amount with Persian digits and Persian thousands marks. */
const money = (n) => FA(Number(n).toLocaleString('en-US').replace(/,/g, '٬')) + ' تومان';

/** Escape text before it goes into innerHTML. */
const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/* ---- Icons (Lucide, stroke-width 2.75) ---------------------------------- */

const ICON_PATHS = {
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  bag: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>',
  heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
  home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
  grid: '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  minus: '<path d="M5 12h14"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  chevronLeft: '<path d="m15 18-6-6 6-6"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  arrowLeft: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  instagram:
    '<rect width="20" height="20" x="2" y="2" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37Z"/><path d="M17.5 6.5h.01"/>',
  truck:
    '<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>',
  package:
    '<path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z"/><path d="M12 22V12"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="m7.5 4.27 9 5.15"/>',
  shield:
    '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  flame:
    '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  card: '<rect width="20" height="14" x="2" y="5" rx="2"/><path d="M2 10h20"/>',
  phone:
    '<path d="M13.83 16.57a1 1 0 0 0 1.21-.3l.36-.47A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.47.35a1 1 0 0 0-.29 1.23 14 14 0 0 0 6.39 6.39"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  menu: '<line x1="4" x2="20" y1="7" y2="7"/><line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="17" y2="17"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
};

function icon(name, cls = 'icon') {
  const d = ICON_PATHS[name];
  if (!d) return '';
  return (
    `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
    `stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`
  );
}

/* ---- Derived catalog -----------------------------------------------------
   OUT and ITEMS are rebuilt (not just computed once) because the catalog can
   be replaced at runtime once the live Supabase products load in — see
   loadProductsFromSupabase() near the bottom of this file. */

let OUT = new Set(OUT_OF_STOCK);
let ITEMS = [];

function buildItems() {
  OUT = new Set(OUT_OF_STOCK);
  ITEMS = PRODUCTS.map((p) => {
    const heightFa =
      p.height === HEIGHT_UNKNOWN ? 'ارتفاع نامشخص' : p.height === 0 ? 'ست' : FA(p.height) + ' سانتی‌متر';
    const price = PRICE[p.id];
    if (price === undefined) {
      console.warn('[glow] no price for "' + p.id + '" — add it to PRICE in data.js');
    }
    const materialFa = MATERIALS[p.material] || p.material || '';
    const photos = p.photos && p.photos.length ? p.photos : [p.photo_url || 'images/' + p.id + '.jpg'];
    return {
      ...p,
      price: price ?? 0,
      priceFa: money(price ?? 0),
      provisional: PROVISIONAL[p.id] ?? PRICES_ARE_PROVISIONAL,
      heightFa,
      materialFa,
      meta: heightFa + ' · ' + materialFa,
      colFa: COLLECTIONS[p.col].fa,
      colEn: COLLECTIONS[p.col].en,
      img: photos[0],
      photos,
      subcategory: p.subcategory || null,
      style: p.style || null,
      variants: Array.isArray(p.variants) ? p.variants : [],
      colors: Array.isArray(p.colors) ? p.colors : [],
      inStock: !OUT.has(p.id),
    };
  });
}
buildItems();

const byId = (id) => ITEMS.find((p) => p.id === id);

/* ---- State -------------------------------------------------------------- */

const STORE_KEY = 'glowhome.v1';

function loadStore() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY)) || {};
  } catch {
    return {};
  }
}

function saveStore() {
  try {
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify({ cart: state.cart, favs: state.favs, seq: state.seq })
    );
  } catch {
    /* private mode — the prototype still works, it just won't persist */
  }
}

const saved = loadStore();

const state = {
  route: 'home',
  param: null,
  filter: 'all',
  subFilter: 'all',
  styleFilter: 'all',
  sort: 'catalog',
  query: '',
  qty: 1,
  cart: saved.cart || {},
  favs: saved.favs || {},
  seq: saved.seq || 140000,
  code: '',
  appliedCode: null,
  codeMsg: '',
  ship: 'post',
  pay: 'gateway',
  auth: 'guest',
  otpSent: false,
  otp: '',
  form: { name: '', phone: '', city: '', address: '', postcode: '', note: '' },
  error: '',
  order: null,
  faqOpen: 0,
  trackCode: '',
  trackPhone: '',
  trackLoading: false, // true while /api/track-order is in flight
  trackError: '',
  trackData: null, // { code, status, items, total, createdAt } from a matched lookup
  contact: { name: '', phone: '', msg: '' },
  contactSent: false,
  contactError: '',
  menuOpen: false,
  lightbox: null, // { id, index } while the full-screen photo popup is open
  selectedHeight: null, // chosen size on a product page with variants
  selectedColorIndex: 0, // chosen color on a product page with colors
  placingOrder: false, // true while /api/orders is in flight
};

/* ---- Cart maths --------------------------------------------------------- */

function cartCount() {
  return Object.values(state.cart).reduce((a, b) => a + b, 0);
}

/** Cart keys are either a plain slug ("lale"), or for a product with size
 * and/or color choices, the slug plus "::h<height>" and/or "::c<colorIndex>"
 * so two different sizes/colors of the same product sit in the cart as
 * distinct, correctly-labelled lines instead of colliding. */
function parseCartKey(key) {
  const parts = key.split('::');
  const id = parts[0];
  let height = null;
  let colorIndex = null;
  for (const part of parts.slice(1)) {
    if (part[0] === 'h') height = Number(part.slice(1));
    if (part[0] === 'c') colorIndex = Number(part.slice(1));
  }
  return { id, height, colorIndex };
}

/** Resolve a cart key back to full product info, swapping in the chosen
 * variant's height/price and/or color when the key encodes them. */
function cartLineData(key) {
  const { id, height, colorIndex } = parseCartKey(key);
  const p = byId(id);
  if (!p) return null;

  let line = { ...p, cartKey: key };

  if (height != null && p.variants && p.variants.length) {
    const v = p.variants.find((x) => x.height === height);
    if (v) {
      const heightFa = v.height === 0 ? 'ست' : FA(v.height) + ' سانتی‌متر';
      line = { ...line, height: v.height, heightFa, price: v.price, priceFa: money(v.price) };
    }
  }

  if (colorIndex != null && p.colors && p.colors[colorIndex] != null) {
    line.color = p.colors[colorIndex];
  }

  line.meta = line.heightFa + ' · ' + line.materialFa + (line.color ? ' · ' + line.color : '');
  return line;
}

/** The cart key a product's own "افزودن به سبد" button should use — plain id
 * normally, or with a ::h/::c suffix when the product has size and/or color
 * choices (so even the default choice is tracked distinctly). */
function cartKeyFor(p, height = p.height, colorIndex = 0) {
  let key = p.id;
  if (p.variants && p.variants.length) key += '::h' + height;
  if (p.colors && p.colors.length > 1) key += '::c' + colorIndex;
  return key;
}

function totals() {
  const rows = Object.keys(state.cart)
    .map((key) => {
      const p = cartLineData(key);
      if (!p) return null;
      const qty = state.cart[key];
      return { ...p, qty, line: p.price * qty };
    })
    .filter(Boolean);

  const subtotal = rows.reduce((s, r) => s + r.line, 0);
  const rate = state.appliedCode ? DISCOUNT_CODES[state.appliedCode] : 0;
  const discount = Math.round(subtotal * rate);
  const base = subtotal - discount;

  const method = SHIPPING.find((s) => s.id === state.ship) || SHIPPING[0];
  const freeShip = !method.payAtDoor && base >= FREE_SHIP_OVER;
  const shipCost = method.payAtDoor || freeShip ? 0 : method.cost;

  // Tipax is collect-on-delivery: it is never "free", the customer pays the
  // courier. Check payAtDoor before the free-shipping threshold.
  let shipLabel;
  if (method.payAtDoor) shipLabel = 'پس‌کرایه';
  else if (freeShip) shipLabel = 'رایگان';
  else shipLabel = money(method.cost);

  return { rows, subtotal, discount, base, method, freeShip, shipCost, shipLabel, total: base + shipCost };
}

function addToCart(id, n = 1) {
  state.cart[id] = (state.cart[id] || 0) + n;
  saveStore();
}

function setQty(id, q) {
  if (q <= 0) delete state.cart[id];
  else state.cart[id] = q;
  saveStore();
}

/* ---- Routing ------------------------------------------------------------ */

const ROUTES = {
  '': ['home', null],
  shop: ['shop', null],
  cart: ['cart', null],
  checkout: ['checkout', null],
  done: ['done', null],
  about: ['about', null],
  contact: ['contact', null],
  faq: ['faq', null],
  track: ['track', null],
};

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [head, param, sub] = raw.split('/');
  if (head === 'c') return ['collection', param || 'lamps', sub ? decodeURIComponent(sub) : null];
  if (head === 'p') return ['product', param];
  const hit = ROUTES[head];
  return hit ? [hit[0], param || null] : ['home', null];
}

function go(path, opts = {}) {
  if (opts.reset) state.error = '';
  const target = '#/' + String(path).replace(/^\/+/, '');
  if (location.hash === target) onRouteChange();
  else location.hash = target;
}

function onRouteChange() {
  const [route, param, subParam] = parseHash();
  state.route = route;
  state.param = param;
  state.error = '';

  if (route === 'collection' && COLLECTIONS[param]) {
    if (state.filter !== param) {
      state.subFilter = 'all';
      state.styleFilter = 'all';
    }
    state.filter = param;
    if (subParam) state.subFilter = subParam;
  }
  if (route === 'product') {
    state.qty = 1;
    const p = byId(param);
    state.selectedHeight = p ? p.height : null;
    state.selectedColorIndex = 0;
  }

  // The confirmation screen is only reachable straight after an order.
  if (route === 'done' && !state.order) {
    location.replace('#/');
    return;
  }

  render();
  window.scrollTo({ top: 0 });
}

/* ---- Media component ---------------------------------------------------- */

/**
 * Product image with a designed fallback for pieces that have no photo file.
 * Drop images/<id>.png into the folder and the photo replaces the placeholder
 * with no code change.
 */
function media(p, extraClass = '') {
  return (
    `<div class="media col-${p.col} ${extraClass}">` +
    `<img src="${esc(p.img)}" alt="${esc(p.fa)}" loading="lazy">` +
    `<div class="media-fallback">` +
    `<span class="fb-latin">${esc(p.en)}</span>` +
    `<span class="fb-fa">${esc(p.fa)}</span>` +
    `<span class="fb-note">عکس به‌زودی</span>` +
    `</div></div>`
  );
}

/**
 * Product detail page gallery: the cover photo plus a thumbnail strip when a
 * product has more than one photo. Clicking any of them opens the full-screen
 * lightbox at that photo — see openLightbox() / renderLightbox().
 */
function gallery(p) {
  const photos = p.photos && p.photos.length ? p.photos : [p.img];
  const cover = `
    <button class="media col-${p.col} gallery-cover" data-act="open-lightbox" data-id="${p.id}" data-index="0" aria-label="بزرگ‌نمایی عکس">
      <img src="${esc(photos[0])}" alt="${esc(p.fa)}" loading="lazy">
      <div class="media-fallback">
        <span class="fb-latin">${esc(p.en)}</span>
        <span class="fb-fa">${esc(p.fa)}</span>
        <span class="fb-note">عکس به‌زودی</span>
      </div>
    </button>`;
  if (photos.length < 2) return cover;
  const thumbs = photos
    .map(
      (src, i) => `
    <button class="gallery-thumb" data-act="open-lightbox" data-id="${p.id}" data-index="${i}" aria-label="عکس ${FA(i + 1)}">
      <img src="${esc(src)}" alt="" loading="lazy">
    </button>`
    )
    .join('');
  return `${cover}<div class="gallery-thumbs">${thumbs}</div>`;
}

/**
 * Full-screen photo popup — every photo a product has, opened from the
 * gallery on its product page. Rendered as an overlay appended after the
 * rest of the page (see render()) so it sits on top regardless of route.
 */
function renderLightbox() {
  if (!state.lightbox) return '';
  const p = byId(state.lightbox.id);
  if (!p) return '';
  const photos = p.photos && p.photos.length ? p.photos : [p.img];
  const i = Math.max(0, Math.min(state.lightbox.index, photos.length - 1));

  return `
  <div class="lightbox-overlay" data-act="lightbox-close">
    <button class="lightbox-close" data-act="lightbox-close" aria-label="بستن">${icon('x')}</button>
    <div class="lightbox-stage" data-stop-close="1">
      ${
        photos.length > 1
          ? `<button class="lightbox-nav lightbox-prev" data-act="lightbox-prev" aria-label="عکس قبلی">${icon(
              'chevronRight',
              'icon'
            )}</button>`
          : ''
      }
      <img class="lightbox-img" src="${esc(photos[i])}" alt="${esc(p.fa)} — عکس ${FA(i + 1)}">
      ${
        photos.length > 1
          ? `<button class="lightbox-nav lightbox-next" data-act="lightbox-next" aria-label="عکس بعدی">${icon(
              'chevronLeft',
              'icon'
            )}</button>`
          : ''
      }
    </div>
    ${
      photos.length > 1
        ? `<div class="lightbox-thumbs" data-stop-close="1">
      ${photos
        .map(
          (src, idx) =>
            `<button class="lightbox-thumb ${idx === i ? 'is-active' : ''}" data-act="open-lightbox" data-id="${
              p.id
            }" data-index="${idx}"><img src="${esc(src)}" alt=""></button>`
        )
        .join('')}
    </div>`
        : ''
    }
    <div class="lightbox-count" data-stop-close="1">${FA(i + 1)} از ${FA(photos.length)}</div>
  </div>`;
}

/** Flip .media into placeholder mode when the photo file is missing. */
function hydrateMedia(root = document) {
  $$('.media img', root).forEach((img) => {
    const mark = () => img.closest('.media')?.classList.add('no-photo');
    if (img.complete && img.naturalWidth === 0) mark();
    img.addEventListener('error', mark, { once: true });
  });
}

/* ---- Shared chrome ------------------------------------------------------ */

function header() {
  const n = cartCount();
  const topItems = [
    ['home', 'خانه', '#/'],
    ['shop', 'فروشگاه', '#/shop'],
  ];
  const bottomItems = [
    ['about', 'درباره ما', '#/about'],
    ['faq', 'سوالات متداول', '#/faq'],
    ['contact', 'تماس', '#/contact'],
  ];
  const categoryKeys = ['lamps', 'shades', 'candles', 'decor'];

  const current = state.route === 'collection' ? 'collection:' + state.filter : state.route;

  const menuOverlay = state.menuOpen ? `<div class="menu-overlay" data-act="menu-close"></div>` : '';

  const renderNavButton = ([key, label, href]) =>
    `<button data-nav="${href}" aria-current="${current === key}">${esc(label)}</button>`;

  const renderCategoryBlock = (col) => {
    const c = COLLECTIONS[col];
    const subs = subcategoriesFor(col);
    const isCurrentCol = state.route === 'collection' && state.filter === col;
    return `
      <div class="menu-nav-group">
        <button data-nav="#/c/${col}" aria-current="${current === 'collection:' + col && state.subFilter === 'all'}">${esc(
      c.fa
    )}</button>
        ${
          subs.length
            ? `<div class="menu-nav-sub">
          ${subs
            .map(
              (s) =>
                `<button data-nav="#/c/${col}/${encodeURIComponent(s)}" aria-current="${
                  isCurrentCol && state.subFilter === s
                }">${esc(s)}</button>`
            )
            .join('')}
        </div>`
            : ''
        }
      </div>`;
  };

  const menuPanel = state.menuOpen
    ? `
    <div class="menu-panel" role="dialog" aria-label="فهرست فروشگاه">
      <div class="menu-search">
        ${icon('search', 'icon icon-sm')}
        <input id="q" type="search" placeholder="جست‌وجو در محصولات" value="${esc(state.query)}"
               aria-label="جست‌وجو در محصولات">
      </div>
      <nav class="menu-nav" aria-label="بخش‌های فروشگاه">
        ${topItems.map(renderNavButton).join('')}
        ${categoryKeys.map(renderCategoryBlock).join('')}
        ${bottomItems.map(renderNavButton).join('')}
      </nav>
    </div>`
    : '';

  return `
    <div class="notice">
      <img class="notice-motif" src="images/motif-flower-light.png" alt="">
      ${esc(COPY.noticeBar)}
    </div>
    <header class="header">
      ${menuOverlay}
      <div class="shell">
        <div class="header-top">
          <div class="header-start">
            <button class="icon-btn" data-act="menu" aria-label="${state.menuOpen ? 'بستن فهرست' : 'باز کردن فهرست'}"
                    aria-expanded="${state.menuOpen}">
              ${icon(state.menuOpen ? 'x' : 'menu')}
            </button>
            ${menuPanel}
          </div>
          <a class="wordmark" href="#/" aria-label="Glow Home Decor — خانه">
            <img class="wordmark-badge" src="images/logo-badge.png" alt="">
            <span class="wordmark-caption">Glow Home Decor</span>
          </a>
          <div class="header-actions">
            <button class="icon-btn" data-act="track" aria-label="پیگیری سفارش">${icon('package')}</button>
            <button class="icon-btn" data-act="cart" aria-label="سبد خرید">
              ${icon('bag')}
              ${n ? `<span class="badge">${FA(n)}</span>` : ''}
            </button>
          </div>
        </div>
      </div>
    </header>`;
}

function footer() {
  return `
    <footer class="footer">
      <img class="footer-motif" src="images/motif-flower-light.png" alt="">
      <div class="shell">
        <div class="footer-grid">
          <div>
            <img class="footer-logo" src="images/logo-full-light.png" alt="Glow Home Decor">
            <p class="footer-blurb">${esc(COPY.footerBlurb)}</p>
          </div>
          <div>
            <h4>فروشگاه</h4>
            <div class="footer-links">
              <button data-nav="#/shop">همه‌ی محصولات</button>
              <button data-nav="#/c/lamps">${esc(COLLECTIONS.lamps.fa)}</button>
              <button data-nav="#/c/shades">${esc(COLLECTIONS.shades.fa)}</button>
              <button data-nav="#/c/candles">${esc(COLLECTIONS.candles.fa)}</button>
              <button data-nav="#/c/decor">${esc(COLLECTIONS.decor.fa)}</button>
            </div>
          </div>
          <div>
            <h4>راهنما</h4>
            <div class="footer-links">
              <button data-nav="#/faq">سوالات متداول</button>
              <button data-nav="#/track">پیگیری سفارش</button>
              <button data-nav="#/about">درباره ما</button>
              <button data-nav="#/contact">تماس</button>
            </div>
          </div>
          <div>
            <h4>تماس</h4>
            <div class="footer-links">
              <a href="${esc(COPY.instagramUrl)}" target="_blank" rel="noopener"
                 style="display:flex;align-items:center;gap:7px">
                ${icon('instagram', 'icon icon-sm')}<span class="ltr">@${esc(COPY.instagram)}</span>
              </a>
              <span class="ltr" style="direction:ltr;text-align:right">${esc(COPY.contactPhone)}</span>
              <span>${esc(COPY.contactHours)}</span>
            </div>
          </div>
        </div>
        <div class="footer-base">${esc(COPY.footerBase)}</div>
      </div>
    </footer>`;
}

function tabbar() {
  const n = cartCount();
  const tabs = [
    ['#/', 'home', 'خانه', ['home']],
    ['#/shop', 'grid', 'فروشگاه', ['shop', 'collection', 'product']],
    ['#/cart', 'bag', 'سبد', ['cart', 'checkout', 'done']],
    ['#/track', 'package', 'پیگیری', ['track']],
    ['#/contact', 'user', 'تماس', ['contact', 'about', 'faq']],
  ];
  return `
    <nav class="tabbar" aria-label="ناوبری اصلی">
      ${tabs
        .map(
          ([href, ic, label, routes]) => `
        <button data-nav="${href}" aria-current="${routes.includes(state.route)}">
          ${icon(ic)}
          ${ic === 'bag' && n ? `<span class="badge">${FA(n)}</span>` : ''}
          <span>${esc(label)}</span>
        </button>`
        )
        .join('')}
    </nav>`;
}

/* ---- Product card ------------------------------------------------------- */

function card(p) {
  const fav = !!state.favs[p.id];
  const cartKey = cartKeyFor(p);
  const inCart = !!state.cart[cartKey];
  const label = !p.inStock ? 'اطلاع از موجودی' : inCart ? 'در سبد ✓ افزودن دوباره' : 'افزودن به سبد';
  return `
    <article class="card">
      <div class="card-media">
        ${!p.inStock ? '<span class="tag tag-out">ناموجود</span>' : ''}
        <button class="fav" data-act="fav" data-id="${p.id}" aria-pressed="${fav}"
                aria-label="${fav ? 'حذف از' : 'افزودن به'} علاقه‌مندی‌ها">${icon('heart', 'icon icon-sm')}</button>
        <div data-act="open" data-id="${p.id}">${media(p)}</div>
      </div>
      <div class="card-body">
        <div class="card-title-row" data-act="open" data-id="${p.id}">
          <span class="card-name">${esc(p.fa)}</span>
          <span class="latin-name">${esc(p.en)}</span>
        </div>
        <span class="card-meta">${esc(p.meta)}${p.variants && p.variants.length ? ' · چند اندازه' : ''}</span>
        <div class="card-price">
          <b>${p.priceFa}</b>
          ${p.provisional ? '<span class="temp-flag">موقت</span>' : ''}
        </div>
        <button class="btn ${p.inStock ? 'btn-primary' : 'btn-ghost'} btn-block"
                data-act="${p.inStock ? 'add' : 'ask'}" data-id="${p.inStock ? cartKey : p.id}">${esc(label)}</button>
      </div>
    </article>`;
}

/* ---- Screens ------------------------------------------------------------ */

function screenHome() {
  const featured = ['lale', 'parasto', 'raha', 'maha'].map(byId).filter(Boolean);
  const counts = Object.fromEntries(Object.keys(COLLECTIONS).map((k) => [k, 0]));
  ITEMS.forEach((p) => counts[p.col]++);

  return `
  <section class="hero">
    <img class="hero-bg" src="images/hero.jpg" alt="آباژور سفالی روشن روی میز کنار پنجره">
    <div class="shell hero-inner">
      <div class="hero-copy">
        <h1>${esc(COPY.heroTitle)}</h1>
        <p class="lead">${COPY.heroBody}</p>
        <div class="hero-actions">
          <button class="btn btn-accent" data-nav="#/shop">دیدن همه‌ی محصولات</button>
          <button class="btn btn-ghost" data-nav="#/c/lamps">${esc(COLLECTIONS.lamps.fa)}</button>
        </div>
      </div>
    </div>
  </section>

  <div class="shell screen">
    <img class="page-motif page-motif--mirror" src="images/motif-flower.png" alt="">
    <div class="assurances">
      ${COPY.assurances
        .map(
          (a) => `
        <div class="assurance">
          ${icon(a.icon)}
          <div><b>${esc(a.title)}</b><span>${esc(a.body)}</span></div>
        </div>`
        )
        .join('')}
    </div>

    <section class="block">
      <div class="section-head"><h2 class="section-title">دسته‌ها</h2></div>
      <div class="collections">
        ${Object.entries(COLLECTIONS)
          .map(([key, c]) => {
            const cover = byId(c.cover) || ITEMS[0];
            return `
          <button class="collection-card" data-nav="#/c/${key}">
            ${media({ ...cover, fa: c.fa, en: c.en, col: key })}
            <div>
              <b>${esc(c.fa)}</b>
              <div class="muted">${FA(counts[key])} قطعه · ${esc(c.material)}</div>
            </div>
          </button>`;
          })
          .join('')}
      </div>
    </section>

    <section class="block">
      <div class="section-head">
        <h2 class="section-title">منتخب این فصل</h2>
        <button class="btn btn-ghost" data-nav="#/shop">همه</button>
      </div>
      <div class="grid-products">${featured.map(card).join('')}</div>
    </section>

    <section class="block">
      <div class="studio-strip">
        <div class="studio-note">
          <h3>${esc(COPY.studioTitle)}</h3>
          <p>${esc(COPY.studioBody)}</p>
          <div><button class="btn btn-accent" data-nav="#/about">درباره ما</button></div>
        </div>
        <div class="media"><img src="images/studio-1.jpg" alt="کار در استودیو"></div>
      </div>
    </section>
  </div>`;
}

function filteredItems() {
  const q = state.query.trim();
  const match = (p) =>
    !q ||
    p.fa.includes(q) ||
    p.en.toLowerCase().includes(q.toLowerCase()) ||
    p.colFa.includes(q);

  let list = ITEMS.filter(
    (p) =>
      (state.filter === 'all' || p.col === state.filter) &&
      (state.subFilter === 'all' || p.subcategory === state.subFilter) &&
      (state.styleFilter === 'all' || p.style === state.styleFilter) &&
      match(p)
  );

  if (state.sort === 'name') list = [...list].sort((a, b) => a.fa.localeCompare(b.fa, 'fa'));
  if (state.sort === 'cheap') list = [...list].sort((a, b) => a.price - b.price);
  if (state.sort === 'dear') list = [...list].sort((a, b) => b.price - a.price);
  return list;
}

const SORT_LABELS = {
  catalog: 'ترتیب کاتالوگ',
  name: 'ترتیب الفبا',
  cheap: 'ارزان‌ترین',
  dear: 'گران‌ترین',
};
const NEXT_SORT = { catalog: 'name', name: 'cheap', cheap: 'dear', dear: 'catalog' };

/** Unique subcategories within a collection, in first-seen catalog order. */
function subcategoriesFor(col) {
  const seen = [];
  ITEMS.forEach((p) => {
    if (p.col === col && p.subcategory && !seen.includes(p.subcategory)) seen.push(p.subcategory);
  });
  return seen;
}

/** Same idea, for the placement-style dimension (رومیزی / کنار سالنی) — a
 * second, independent filter shown alongside subcategory, currently only
 * meaningful for lamps. */
function stylesFor(col) {
  const seen = [];
  ITEMS.forEach((p) => {
    if (p.col === col && p.style && !seen.includes(p.style)) seen.push(p.style);
  });
  return seen;
}

/** Renders a "همه / option / option..." row of small filter chips. */
function chipRow(options, current, action) {
  if (!options.length) return '';
  return `<div class="chips subchips">
    <button class="chip chip-sm" data-act="${action}" data-id="all" aria-pressed="${current === 'all'}">همه</button>
    ${options
      .map(
        (s) =>
          `<button class="chip chip-sm" data-act="${action}" data-id="${esc(s)}" aria-pressed="${
            current === s
          }">${esc(s)}</button>`
      )
      .join('')}
  </div>`;
}

function toolbar() {
  const chips = [
    ['all', 'همه'],
    ['lamps', COLLECTIONS.lamps.fa],
    ['shades', COLLECTIONS.shades.fa],
    ['candles', COLLECTIONS.candles.fa],
    ['decor', COLLECTIONS.decor.fa],
  ];
  const subs = state.filter === 'all' ? [] : subcategoriesFor(state.filter);
  const styles = state.filter === 'all' ? [] : stylesFor(state.filter);
  return `
    <div class="toolbar">
      <div class="chips">
        ${chips
          .map(
            ([k, label]) =>
              `<button class="chip" data-act="filter" data-id="${k}" aria-pressed="${state.filter === k}">${esc(
                label
              )}</button>`
          )
          .join('')}
      </div>
      <button class="chip sort" data-act="sort">${esc(SORT_LABELS[state.sort])}</button>
    </div>
    ${chipRow(subs, state.subFilter, 'subfilter')}
    ${chipRow(styles, state.styleFilter, 'stylefilter')}`;
}

function emptyState() {
  return `
    <div class="empty">
      <h3 class="section-title">چیزی پیدا نشد</h3>
      <p>عبارت دیگری را امتحان کنید یا فیلتر را بردارید.</p>
      <button class="btn btn-primary" data-act="clear-search">دیدن همه‌ی محصولات</button>
    </div>`;
}

function screenShop() {
  const list = filteredItems();
  const q = state.query.trim();
  const title = state.filter === 'all' ? 'همه‌ی محصولات' : COLLECTIONS[state.filter].fa;
  return `
  <div class="shell screen">
    <img class="page-motif" src="images/motif-flower.png" alt="">
    <h1 class="page-title">${esc(title)}</h1>
    ${toolbar()}
    <p class="result-line">${FA(list.length)} قطعه${q ? ' برای «' + esc(q) + '»' : ''}${
    list.some((p) => p.provisional) ? ' · قیمت‌ها موقت است' : ''
  }</p>
    ${list.length ? `<div class="grid-products">${list.map(card).join('')}</div>` : emptyState()}
  </div>`;
}

function screenCollection() {
  const key = COLLECTIONS[state.filter] ? state.filter : 'lamps';
  const c = COLLECTIONS[key];
  const cover = byId(c.cover) || ITEMS[0];
  const subs = subcategoriesFor(key);
  const styles = stylesFor(key);
  const list = ITEMS.filter(
    (p) =>
      p.col === key &&
      (state.subFilter === 'all' || p.subcategory === state.subFilter) &&
      (state.styleFilter === 'all' || p.style === state.styleFilter)
  );
  return `
  <div class="shell screen">
    <div class="banner">
      ${(() => {
        const bannerSrc = c.bannerImg || cover.img;
        return `<div class="banner-photo-fill">
               <img class="banner-photo-bg" src="${esc(bannerSrc)}" alt="">
               <img class="banner-photo-fg" src="${esc(bannerSrc)}" alt="${esc(c.fa)}">
             </div>`;
      })()}
      <div class="banner-copy">
        <h1 class="page-title" style="color:#fff">${esc(c.fa)}</h1>
        <p>${c.blurb}</p>
      </div>
    </div>
    <div class="motif-anchor">
      <img class="page-motif" src="images/motif-flower.png" alt="">
      ${chipRow(subs, state.subFilter, 'subfilter')}
      ${chipRow(styles, state.styleFilter, 'stylefilter')}
      <p class="result-line">${FA(list.length)} قطعه · ${esc(c.material)}</p>
      <div class="grid-products">${list.map(card).join('')}</div>
    </div>
  </div>`;
}

function screenProduct() {
  const p = byId(state.param);
  if (!p) return `<div class="shell screen">${emptyState()}</div>`;

  const fav = !!state.favs[p.id];
  const related = ITEMS.filter((x) => x.col === p.col && x.id !== p.id).slice(0, 4);

  const hasVariants = p.variants && p.variants.length > 1;
  const effectiveHeight = hasVariants ? state.selectedHeight ?? p.height : p.height;
  const effectiveVariant = hasVariants ? p.variants.find((v) => v.height === effectiveHeight) : null;
  const effectivePrice = effectiveVariant ? effectiveVariant.price : p.price;
  const effectivePriceFa = money(effectivePrice);
  const effectiveHeightFa =
    effectiveHeight === HEIGHT_UNKNOWN
      ? 'نامشخص'
      : effectiveHeight === 0
      ? 'ست'
      : FA(effectiveHeight) + ' سانتی‌متر';
  const hasColors = p.colors && p.colors.length > 1;
  const effectiveColorIndex = hasColors ? state.selectedColorIndex ?? 0 : 0;
  const cartKey = cartKeyFor(p, effectiveHeight, effectiveColorIndex);

  return `
  <div class="shell screen">
    <img class="page-motif" src="images/motif-flower.png" alt="">
    <div class="crumbs">
      <button data-nav="#/shop">فروشگاه</button>
      ${icon('chevronLeft', 'icon icon-sm')}
      <button data-nav="#/c/${p.col}">${esc(p.colFa)}</button>
      ${icon('chevronLeft', 'icon icon-sm')}
      <span>${esc(p.fa)}</span>
    </div>

    <div class="product">
      <div>${gallery(p)}</div>
      <div>
        <h1 class="page-title">${esc(p.fa)}</h1>
        <div class="latin-name" style="font-size:19px;margin-top:4px">${esc(p.en)}</div>

        <div class="price-row">
          <b>${effectivePriceFa}</b>
          ${p.provisional ? '<span class="temp-flag">قیمت موقت</span>' : ''}
          ${!p.inStock ? '<span class="temp-flag" style="background:var(--color-neutral-200);color:var(--color-neutral-700)">ناموجود</span>' : ''}
        </div>

        <p class="lead" style="margin-top:18px">${esc(p.desc)}</p>

        ${
          hasVariants
            ? `
        <div class="field" style="max-width:280px;margin-top:6px">
          <label for="height-picker">اندازه</label>
          <select id="height-picker" class="input" data-act="select-height">
            ${p.variants
              .map((v) => {
                const label = (v.height === 0 ? 'ست' : FA(v.height) + ' سانتی‌متر') + ' — ' + money(v.price);
                return `<option value="${v.height}" ${v.height === effectiveHeight ? 'selected' : ''}>${esc(label)}</option>`;
              })
              .join('')}
          </select>
        </div>`
            : ''
        }

        ${
          hasColors
            ? `
        <div class="field" style="max-width:280px;margin-top:6px">
          <label for="color-picker">رنگ</label>
          <select id="color-picker" class="input" data-act="select-color">
            ${p.colors
              .map(
                (c, i) =>
                  `<option value="${i}" ${i === effectiveColorIndex ? 'selected' : ''}>${esc(c)}</option>`
              )
              .join('')}
          </select>
        </div>`
            : ''
        }

        <dl class="spec-list">
          <div><dt>دسته</dt><dd>${esc(p.colFa)}</dd></div>
          <div><dt>جنس</dt><dd>${esc(p.materialFa)}</dd></div>
          <div><dt>ارتفاع</dt><dd>${esc(effectiveHeightFa)}</dd></div>
          <div><dt>ساخت</dt><dd>دست‌ساز، استودیو Glow Home</dd></div>
        </dl>

        ${
          p.inStock
            ? `
        <div class="buy-row">
          <div class="qty">
            <button data-act="qty-dec" aria-label="کم کردن">${icon('minus', 'icon icon-sm')}</button>
            <span aria-live="polite">${FA(state.qty)}</span>
            <button data-act="qty-inc" aria-label="زیاد کردن">${icon('plus', 'icon icon-sm')}</button>
          </div>
          <button class="btn btn-primary" data-act="add-current" data-id="${cartKey}">افزودن به سبد</button>
          <button class="btn btn-accent" data-act="buy-now" data-id="${cartKey}">خرید فوری</button>
        </div>`
            : `
        <div class="alert alert-info">این قطعه فعلاً موجود نیست. نام‌تان را بگذارید تا وقتی ساخته شد خبرتان کنیم.</div>
        <div class="buy-row">
          <button class="btn btn-primary" data-act="ask" data-id="${p.id}">اطلاع از موجودی</button>
        </div>`
        }

        <div style="margin-top:16px">
          <button class="btn btn-ghost" data-act="fav" data-id="${p.id}" aria-pressed="${fav}">
            ${icon('heart', 'icon icon-sm')} ${fav ? 'در علاقه‌مندی‌ها' : 'افزودن به علاقه‌مندی‌ها'}
          </button>
        </div>

        <div class="ship-hint">
          ارسال شهرستان با تیپاکس (پس‌کرایه)<br>
          داخل تهران (هماهنگی با پیک، ماشین ارسال می‌شود)
        </div>
      </div>
    </div>

    ${
      related.length
        ? `
    <section class="block">
      <div class="section-head"><h2 class="section-title">قطعه‌های مرتبط</h2></div>
      <div class="grid-products">${related.map(card).join('')}</div>
    </section>`
        : ''
    }
  </div>

  ${
    p.inStock
      ? `
  <div class="action-bar">
    <div class="ab-info"><b>${effectivePriceFa}</b>${p.provisional ? 'قیمت موقت' : esc(effectiveHeightFa + ' · ' + p.materialFa)}</div>
    <button class="btn btn-accent" data-act="add-current" data-id="${cartKey}">افزودن به سبد</button>
  </div>`
      : `
  <div class="action-bar">
    <button class="btn btn-primary btn-block" data-act="ask" data-id="${p.id}">اطلاع از موجودی</button>
  </div>`
  }`;
}

function screenCart() {
  const t = totals();

  if (!t.rows.length) {
    return `
    <div class="shell screen">
      <img class="page-motif" src="images/motif-flower.png" alt="">
      <h1 class="page-title">سبد خرید</h1>
      <div class="empty" style="margin-top:24px">
        <h3 class="section-title">سبد خرید خالی است</h3>
        <p>هنوز چیزی اضافه نکرده‌اید.</p>
        <button class="btn btn-primary" data-nav="#/shop">دیدن محصولات</button>
      </div>
    </div>`;
  }

  return `
  <div class="shell screen">
    <img class="page-motif" src="images/motif-flower.png" alt="">
    <h1 class="page-title">سبد خرید</h1>
    <div class="cart-layout" style="margin-top:22px">
      <div>
        ${t.rows
          .map(
            (r) => `
          <div class="cart-row">
            <div data-act="open" data-id="${r.id}">${media(r)}</div>
            <div>
              <b data-act="open" data-id="${r.id}">${esc(r.fa)}</b>
              <div class="cart-meta">${esc(r.meta)} · واحد ${r.priceFa}</div>
              <div class="qty" style="margin-top:10px">
                <button data-act="row-dec" data-id="${r.cartKey}" aria-label="کم کردن">${icon('minus', 'icon icon-sm')}</button>
                <span>${FA(r.qty)}</span>
                <button data-act="row-inc" data-id="${r.cartKey}" aria-label="زیاد کردن">${icon('plus', 'icon icon-sm')}</button>
              </div>
            </div>
            <div class="cart-row-end">
              <b>${money(r.line)}</b>
              <button class="link-danger" data-act="row-del" data-id="${r.cartKey}">
                ${icon('trash', 'icon icon-sm')} حذف
              </button>
            </div>
          </div>`
          )
          .join('')}
      </div>

      <aside class="panel">
        <h3>خلاصه‌ی سفارش</h3>
        <div class="sum-row"><span>جمع کالاها</span><span>${money(t.subtotal)}</span></div>
        <div class="sum-row"><span>تخفیف</span><span class="${t.discount ? 'sage' : ''}">${
    t.discount ? '− ' + money(t.discount) : '—'
  }</span></div>
        <div class="sum-row"><span>ارسال (${esc(t.method.label)})</span><span class="${
    t.freeShip ? 'sage' : ''
  }">${esc(t.shipLabel)}</span></div>
        <div class="sum-row total"><span>قابل پرداخت</span><span>${money(t.total)}</span></div>

        <div class="ship-hint">${
          t.method.payAtDoor
            ? 'هزینه‌ی تیپاکس را هنگام تحویل به پیک می‌پردازید و در مبلغ بالا حساب نشده است.'
            : t.freeShip
            ? 'ارسال این سفارش رایگان است.'
            : 'تا ارسال رایگان: ' + money(Math.max(0, FREE_SHIP_OVER - t.base))
        }</div>

        <div class="code-row">
          <input class="input" id="code" placeholder="کد تخفیف" value="${esc(state.code)}" aria-label="کد تخفیف">
          <button class="btn btn-ghost" data-act="apply-code">اعمال</button>
        </div>
        ${
          state.codeMsg
            ? `<div class="code-msg ${state.appliedCode ? '' : 'bad'}">${esc(state.codeMsg)}</div>`
            : ''
        }

        <button class="btn btn-accent btn-block" style="margin-top:18px" data-nav="#/checkout">ادامه‌ی خرید</button>
      </aside>
    </div>
  </div>

  <div class="action-bar">
    <div class="ab-info"><b>${money(t.total)}</b>${FA(cartCount())} قطعه</div>
    <button class="btn btn-accent" data-nav="#/checkout">ادامه</button>
  </div>`;
}

function screenCheckout() {
  const t = totals();
  if (!t.rows.length) {
    return `
    <div class="shell screen">
      <img class="page-motif" src="images/motif-flower.png" alt="">
      <h1 class="page-title">تسویه‌حساب</h1>
      <div class="empty" style="margin-top:24px">
        <h3 class="section-title">سبد خرید خالی است</h3>
        <p>برای تسویه‌حساب اول چند قطعه به سبد اضافه کنید.</p>
        <button class="btn btn-primary" data-nav="#/shop">دیدن محصولات</button>
      </div>
    </div>`;
  }

  const f = state.form;

  return `
  <div class="shell screen">
    <img class="page-motif" src="images/motif-flower.png" alt="">
    <h1 class="page-title">تسویه‌حساب</h1>
    <div class="checkout-layout" style="margin-top:22px">
      <div>
        <section class="checkout-step">
          <h3>ورود</h3>
          <div class="option-stack">
            <button class="option" data-act="auth" data-id="guest" role="radio" aria-checked="${state.auth === 'guest'}">
              <div><b>خرید بدون عضویت</b><span>فقط شماره تماس و نشانی لازم است</span></div>
            </button>
            <button class="option" data-act="auth" data-id="otp" role="radio" aria-checked="${state.auth === 'otp'}">
              <div><b>ورود با شماره موبایل</b><span>کد تأیید پیامک می‌شود</span></div>
            </button>
          </div>
          ${
            state.auth === 'otp'
              ? state.otpSent
                ? `<div style="margin-top:14px" class="field">
                     <label for="otp">کد تأیید</label>
                     <input class="input ltr" id="otp" inputmode="numeric" placeholder="۱۲۳۴" value="${esc(state.otp)}">
                     <span class="hint">نسخه‌ی نمایشی: هر چهار رقمی پذیرفته می‌شود.</span>
                   </div>`
                : `<button class="btn btn-ghost" style="margin-top:14px" data-act="send-otp">ارسال کد تأیید</button>`
              : ''
          }
        </section>

        <section class="checkout-step">
          <h3>نشانی تحویل</h3>
          <div class="form-grid">
            <div class="field">
              <label for="name">نام و نام خانوادگی</label>
              <input class="input" id="name" value="${esc(f.name)}" autocomplete="name">
            </div>
            <div class="field">
              <label for="phone">شماره موبایل</label>
              <input class="input ltr" id="phone" inputmode="tel" placeholder="09xxxxxxxxx" value="${esc(
                f.phone
              )}" autocomplete="tel">
            </div>
            <div class="field">
              <label for="city">شهر</label>
              <input class="input" id="city" value="${esc(f.city)}" autocomplete="address-level2">
            </div>
            <div class="field">
              <label for="postcode">کد پستی</label>
              <input class="input ltr" id="postcode" inputmode="numeric" value="${esc(f.postcode)}" autocomplete="postal-code">
            </div>
            <div class="field span-2">
              <label for="address">نشانی کامل</label>
              <textarea class="input" id="address" autocomplete="street-address">${esc(f.address)}</textarea>
            </div>
            <div class="field span-2">
              <label for="note">یادداشت سفارش</label>
              <textarea class="input" id="note" placeholder="مثلاً ارتفاع دلخواه برای دفرمه بلند، یا پیام روی کارت هدیه">${esc(
                f.note
              )}</textarea>
            </div>
          </div>
        </section>

        <section class="checkout-step">
          <h3>روش ارسال</h3>
          <div class="option-stack">
            ${SHIPPING.map(
              (s) => `
              <button class="option" data-act="ship" data-id="${s.id}" role="radio" aria-checked="${state.ship === s.id}">
                <div><b>${esc(s.label)}</b><span>${esc(s.note)}</span></div>
                <span class="opt-end">${s.payAtDoor ? 'پس‌کرایه' : money(s.cost)}</span>
              </button>`
            ).join('')}
          </div>
        </section>

        <section class="checkout-step">
          <h3>روش پرداخت</h3>
          <div class="option-stack">
            ${PAYMENTS.map(
              (p) => `
              <button class="option" data-act="pay" data-id="${p.id}" role="radio" aria-checked="${state.pay === p.id}">
                <div><b>${esc(p.label)}</b><span>${esc(p.note)}</span></div>
              </button>`
            ).join('')}
          </div>
          ${
            state.pay === 'card'
              ? `<div class="alert alert-info">پس از ثبت سفارش شماره کارت را برای شما می‌فرستیم. سفارش بعد از دریافت فیش آماده‌سازی می‌شود.</div>`
              : ''
          }
        </section>
      </div>

      <aside class="panel">
        <h3>سفارش شما</h3>
        ${t.rows
          .map(
            (r) => `
          <div class="sum-row">
            <span>${esc(r.fa)} × ${FA(r.qty)}</span>
            <span>${money(r.line)}</span>
          </div>`
          )
          .join('')}
        <div class="sum-row" style="border-top:1px solid var(--color-divider);margin-top:8px;padding-top:12px">
          <span>جمع کالاها</span><span>${money(t.subtotal)}</span>
        </div>
        ${
          t.discount
            ? `<div class="sum-row"><span>تخفیف ${esc(state.appliedCode)}</span><span class="sage">− ${money(
                t.discount
              )}</span></div>`
            : ''
        }
        <div class="sum-row"><span>ارسال</span><span class="${t.freeShip ? 'sage' : ''}">${esc(
    t.shipLabel
  )}</span></div>
        <div class="sum-row total"><span>قابل پرداخت</span><span>${money(t.total)}</span></div>
        ${
          t.method.payAtDoor
            ? `<div class="ship-hint">هزینه‌ی تیپاکس جداگانه هنگام تحویل پرداخت می‌شود.</div>`
            : ''
        }
        ${state.error ? `<div class="alert alert-error">${esc(state.error)}</div>` : ''}
        <button class="btn btn-accent btn-block" style="margin-top:18px" data-act="place-order" ${
          state.placingOrder ? 'disabled' : ''
        }>${state.placingOrder ? 'در حال ثبت سفارش…' : 'ثبت سفارش'}</button>
        <p class="muted" style="margin-top:12px;font-size:13px">سفارش شما ثبت می‌شود؛ پرداخت طبق روش انتخابی هماهنگ خواهد شد.</p>
      </aside>
    </div>
  </div>

  <div class="action-bar">
    <div class="ab-info"><b>${money(t.total)}</b>قابل پرداخت</div>
    <button class="btn btn-accent" data-act="place-order" ${state.placingOrder ? 'disabled' : ''}>${
    state.placingOrder ? 'در حال ثبت…' : 'ثبت سفارش'
  }</button>
  </div>`;
}

function screenDone() {
  const o = state.order;
  if (!o) return screenHome();
  return `
  <div class="shell-narrow screen">
    <img class="page-motif" src="images/motif-flower.png" alt="">
    <div class="done">
      <div class="done-mark">${icon('check')}</div>
      <h1 class="page-title">سفارش ثبت شد</h1>
      <p class="lead" style="margin:12px auto 0">${esc(o.name)} عزیز، سفارش شما ثبت شد. جزئیات به شماره ${esc(
    o.phone
  )} پیامک می‌شود.</p>
      <div class="order-code ltr">${esc(o.no)}</div>
    </div>

    <div class="panel" style="margin-top:30px">
      <h3>جزئیات سفارش</h3>
      ${o.rows
        .map(
          (r) => `<div class="sum-row"><span>${esc(r.fa)} × ${esc(r.qtyFa)}</span><span>${esc(
            r.lineFa
          )}</span></div>`
        )
        .join('')}
      <div class="sum-row" style="border-top:1px solid var(--color-divider);margin-top:8px;padding-top:12px">
        <span>روش ارسال</span><span>${esc(o.shipLabel)}</span>
      </div>
      <div class="sum-row"><span>روش پرداخت</span><span>${esc(o.payLabel)}</span></div>
      <div class="sum-row total"><span>مبلغ کل</span><span>${esc(o.totalFa)}</span></div>
    </div>

    <div class="alert alert-info" style="margin-top:20px">
      سفارش شما ثبت شد. برای هماهنگی پرداخت و ارسال با شما تماس گرفته می‌شود؛ پیامک خودکار هنوز فعال نیست.
    </div>

    <div style="display:flex;gap:12px;margin-top:24px;flex-wrap:wrap">
      <button class="btn btn-primary" data-nav="#/shop">ادامه‌ی خرید</button>
      <button class="btn btn-ghost" data-nav="#/track">پیگیری سفارش</button>
    </div>
  </div>`;
}

function screenAbout() {
  return `
  <div class="shell screen">
    <div class="about-grid">
      <div class="about-body motif-anchor">
        <img class="page-motif page-motif--start" src="images/motif-flower.png" alt="">
        <h1 class="page-title">${esc(COPY.aboutTitle)}</h1>
        ${COPY.aboutBody.map((p) => `<p class="lead">${esc(p)}</p>`).join('')}
        <div class="stat-row">
          ${COPY.aboutStats
            .map((s) => `<div class="stat"><b>${esc(s.value)}</b><span>${esc(s.label)}</span></div>`)
            .join('')}
        </div>
      </div>
      <div class="media"><img src="images/banner-lamps.jpg" alt="مجموعه‌ای از آباژورهای دست‌ساز گلو هوم"></div>
    </div>

    <section class="block">
      <div class="studio-strip">
        <div class="media"><img src="images/studio-1.jpg" alt="قطعه‌های آماده در استودیو"></div>
        <div class="studio-note">
          <h3>${esc(COPY.studioTitle)}</h3>
          <p>${esc(COPY.studioBody)}</p>
          <div><button class="btn btn-accent" data-nav="#/contact">سفارش خاص دارید؟</button></div>
        </div>
      </div>
    </section>
  </div>`;
}

function screenFaq() {
  return `
  <div class="shell-narrow screen">
    <img class="page-motif" src="images/motif-flower.png" alt="">
    <h1 class="page-title">سوالات متداول</h1>
    <div style="margin-top:24px;border-top:1px solid var(--color-divider)">
      ${COPY.faq
        .map(
          (row, i) => `
        <div class="faq-item ${state.faqOpen === i ? 'open' : ''}">
          <button class="faq-q" data-act="faq" data-id="${i}" aria-expanded="${state.faqOpen === i}">
            <span>${esc(row.q)}</span>${icon('chevronDown', 'icon icon-sm')}
          </button>
          <div class="faq-a">${row.a}</div>
        </div>`
        )
        .join('')}
    </div>
    <div class="panel" style="margin-top:30px;display:flex;gap:18px;align-items:center;justify-content:space-between;flex-wrap:wrap">
      <div>
        <b style="font-size:17px">پاسخ‌تان را پیدا نکردید؟</b>
        <div class="muted">در اینستاگرام یا از فرم تماس بپرسید.</div>
      </div>
      <button class="btn btn-primary" data-nav="#/contact">تماس با ما</button>
    </div>
  </div>`;
}

function screenContact() {
  const c = state.contact;
  if (state.contactSent) {
    return `
    <div class="shell-narrow screen">
      <div class="done">
        <div class="done-mark">${icon('check')}</div>
        <h1 class="page-title">پیام شما ثبت شد</h1>
        <p class="lead" style="margin:12px auto 0">معمولاً ظرف یک روز کاری پاسخ می‌دهیم.</p>
      </div>
      <div class="alert alert-info" style="margin-top:22px">نسخه‌ی نمایشی: پیام واقعاً ارسال نشد.</div>
      <div style="display:flex;gap:12px;margin-top:22px;flex-wrap:wrap">
        <button class="btn btn-primary" data-nav="#/shop">بازگشت به فروشگاه</button>
        <button class="btn btn-ghost" data-act="contact-reset">نوشتن پیام دیگر</button>
      </div>
    </div>`;
  }

  return `
  <div class="shell-narrow screen">
    <img class="page-motif" src="images/motif-flower.png" alt="">
    <h1 class="page-title">تماس با ما</h1>
    <p class="lead" style="margin-top:12px">${esc(COPY.contactIntro)}</p>

    <div class="form-grid" style="margin-top:26px">
      <div class="field">
        <label for="c-name">نام</label>
        <input class="input" id="c-name" value="${esc(c.name)}" autocomplete="name">
      </div>
      <div class="field">
        <label for="c-phone">شماره تماس</label>
        <input class="input ltr" id="c-phone" inputmode="tel" value="${esc(c.phone)}" autocomplete="tel">
      </div>
      <div class="field span-2">
        <label for="c-msg">پیام</label>
        <textarea class="input" id="c-msg">${esc(c.msg)}</textarea>
      </div>
    </div>
    ${state.contactError ? `<div class="alert alert-error">${esc(state.contactError)}</div>` : ''}
    <button class="btn btn-accent" style="margin-top:18px" data-act="send-contact">ارسال پیام</button>

    <div class="panel" style="margin-top:30px">
      <div style="display:flex;align-items:center;gap:12px">
        ${icon('instagram')}
        <a class="ltr" href="${esc(COPY.instagramUrl)}" target="_blank" rel="noopener">@${esc(COPY.instagram)}</a>
      </div>
      <div style="display:flex;align-items:center;gap:12px;margin-top:14px">
        ${icon('phone')}<span class="ltr" style="direction:ltr">${esc(COPY.contactPhone)}</span>
      </div>
      <div style="display:flex;align-items:center;gap:12px;margin-top:14px">
        ${icon('clock')}<span>${esc(COPY.contactHours)}</span>
      </div>
    </div>
  </div>`;
}

// Which status values light up which step of the three-step tracker.
// pending/paid -> step 1, preparing -> step 2, shipped/delivered -> step 3.
// 'cancelled' (and anything unrecognized) maps to 0 — no step highlighted.
const TRACK_STEP = { pending: 1, paid: 1, preparing: 2, shipped: 3, delivered: 3 };

function screenTrack() {
  const d = state.trackData;
  const step = d ? TRACK_STEP[d.status] || 0 : 0;
  const cancelled = d && d.status === 'cancelled';

  return `
  <div class="shell-narrow screen">
    <img class="page-motif" src="images/motif-flower.png" alt="">
    <h1 class="page-title">پیگیری سفارش</h1>
    <p class="lead" style="margin-top:12px">کد سفارش و شماره موبایلی که هنگام ثبت سفارش وارد کرده‌اید را وارد کنید.</p>

    <div style="display:flex;gap:12px;align-items:flex-end;margin-top:22px;flex-wrap:wrap">
      <div class="field" style="flex:1;min-width:220px">
        <label for="track">کد سفارش</label>
        <input class="input ltr" id="track" placeholder="GH-140001" value="${esc(state.trackCode)}">
      </div>
      <div class="field" style="flex:1;min-width:220px">
        <label for="track-phone">شماره موبایل</label>
        <input class="input ltr" id="track-phone" placeholder="0912 123 4567" value="${esc(state.trackPhone)}">
      </div>
      <button class="btn btn-primary" data-act="track-submit" ${state.trackLoading ? 'disabled' : ''}>${state.trackLoading ? 'در حال بررسی…' : 'پیگیری'}</button>
    </div>

    ${state.trackError ? `<div class="alert alert-error" style="margin-top:18px">${esc(state.trackError)}</div>` : ''}
    ${cancelled ? `<div class="alert alert-error" style="margin-top:18px">این سفارش لغو شده است.</div>` : ''}

    ${d && !cancelled ? `
      <div class="track-items">
        <b>${esc(d.code)}</b>
        <ul>
          ${d.items.map((it) => `<li><span>${esc(it.name_fa)}</span><span>${FA(it.qty)} عدد</span></li>`).join('')}
        </ul>
        <div class="track-total"><span>جمع کل</span><span>${money(d.total)}</span></div>
      </div>
    ` : ''}

    <div class="track-steps ${d ? 'has-status' : ''}">
      <div class="track-step ${step >= 1 ? 'is-active' : ''}">${icon('check')}<div><b>ثبت سفارش</b><span>سفارش دریافت شد</span></div></div>
      <div class="track-step ${step >= 2 ? 'is-active' : ''}">${icon('package')}<div><b>آماده‌سازی</b><span>بسته‌بندی در استودیو، یک تا دو روز کاری</span></div></div>
      <div class="track-step ${step >= 3 ? 'is-active' : ''}">${icon('truck')}<div><b>ارسال</b><span>کد رهگیری پس از تحویل به پست پیامک می‌شود</span></div></div>
    </div>
  </div>`;
}

/* ---- Render ------------------------------------------------------------- */

const SCREENS = {
  home: screenHome,
  shop: screenShop,
  collection: screenCollection,
  product: screenProduct,
  cart: screenCart,
  checkout: screenCheckout,
  done: screenDone,
  about: screenAbout,
  contact: screenContact,
  faq: screenFaq,
  track: screenTrack,
};

const TITLES = {
  home: 'Glow Home — لوازم دست‌ساز خانه',
  shop: 'فروشگاه — Glow Home',
  collection: 'دسته — Glow Home',
  product: 'محصول — Glow Home',
  cart: 'سبد خرید — Glow Home',
  checkout: 'تسویه‌حساب — Glow Home',
  done: 'سفارش ثبت شد — Glow Home',
  about: 'درباره ما — Glow Home',
  contact: 'تماس — Glow Home',
  faq: 'سوالات متداول — Glow Home',
  track: 'پیگیری سفارش — Glow Home',
};

function render() {
  const body = (SCREENS[state.route] || screenHome)();
  document.title = TITLES[state.route] || TITLES.home;

  $('#app').innerHTML = header() + '<main>' + body + '</main>' + footer() + tabbar() + renderLightbox();

  document.body.classList.toggle('has-action-bar', !!$('.action-bar'));
  hydrateMedia();
}

/* ---- Events ------------------------------------------------------------- */

/** Read the live value of an input that exists on the current screen. */
function val(id) {
  const el = document.getElementById(id);
  return el ? el.value : '';
}

/** Pull checkout / contact field values out of the DOM before acting on them. */
function syncForm() {
  if (state.route === 'checkout') {
    ['name', 'phone', 'city', 'address', 'postcode', 'note'].forEach((k) => {
      const el = document.getElementById(k);
      if (el) state.form[k] = el.value;
    });
    const otp = document.getElementById('otp');
    if (otp) state.otp = otp.value;
  }
  if (state.route === 'contact') {
    const map = { 'c-name': 'name', 'c-phone': 'phone', 'c-msg': 'msg' };
    Object.entries(map).forEach(([id, k]) => {
      const el = document.getElementById(id);
      if (el) state.contact[k] = el.value;
    });
  }
  if (state.route === 'cart') {
    const el = document.getElementById('code');
    if (el) state.code = el.value;
  }
  if (state.route === 'track') {
    const codeEl = document.getElementById('track');
    if (codeEl) state.trackCode = codeEl.value;
    const phoneEl = document.getElementById('track-phone');
    if (phoneEl) state.trackPhone = phoneEl.value;
  }
}

function placeOrder() {
  syncForm();
  const t = totals();
  const f = state.form;

  if (!t.rows.length) return fail('سبد خرید خالی است.');
  if (!f.name.trim()) return fail('نام و نام خانوادگی را وارد کنید.');
  if (f.phone.replace(/\D/g, '').length < 10) return fail('شماره موبایل را کامل وارد کنید.');
  if (!f.city.trim()) return fail('شهر را وارد کنید.');
  if (f.address.trim().length < 10) return fail('نشانی را کامل‌تر بنویسید.');
  if (state.auth === 'otp' && state.otp.trim().length < 4) return fail('کد تأیید را وارد کنید.');
  if (state.placingOrder) return; // already submitting — ignore a double-click

  state.placingOrder = true;
  state.error = '';
  render();

  fetch('/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customer: { name: f.name, phone: f.phone, city: f.city, address: f.address, postcode: f.postcode },
      note: f.note,
      items: t.rows.map((r) => ({ cartKey: r.cartKey, qty: r.qty })),
      shipping_method: state.ship,
      discount_code: state.appliedCode,
    }),
  })
    .then((r) => r.json())
    .then((res) => {
      state.placingOrder = false;
      if (!res.ok) return fail(res.error || 'ثبت سفارش با خطا مواجه شد. دوباره تلاش کنید.');

      // Snapshot: the confirmation screen must survive the cart being cleared.
      state.order = {
        no: res.code,
        rows: res.items.map((r) => ({ fa: r.fa, qtyFa: FA(r.qty), lineFa: money(r.line) })),
        totalFa: money(res.total),
        shipLabel: res.shipLabel === 'رایگان' || res.shipLabel === 'پس‌کرایه' ? res.shipLabel : money(Number(res.shipLabel)),
        payLabel: (PAYMENTS.find((p) => p.id === state.pay) || PAYMENTS[0]).label,
        name: f.name,
        phone: f.phone,
      };

      state.cart = {};
      state.appliedCode = null;
      state.code = '';
      state.codeMsg = '';
      state.error = '';
      saveStore();
      go('done');
    })
    .catch(() => {
      state.placingOrder = false;
      fail('اتصال برقرار نشد. اینترنت خود را بررسی کنید و دوباره تلاش کنید.');
    });

  function fail(msg) {
    state.error = msg;
    state.placingOrder = false;
    render();
    $('.alert-error')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

const ACTIONS = {
  cart: () => go('cart'),
  track: () => go('track'),

  menu: () => {
    state.menuOpen = !state.menuOpen;
    render();
    if (state.menuOpen) document.getElementById('q')?.focus();
  },
  'menu-close': () => {
    state.menuOpen = false;
    render();
  },

  open: (id) => go('p/' + id),

  fav: (id) => {
    if (state.favs[id]) delete state.favs[id];
    else state.favs[id] = true;
    saveStore();
    render();
  },

  add: (id) => {
    addToCart(id, 1);
    render();
  },

  ask: (id) => {
    const p = byId(id);
    state.contact.msg = 'لطفاً موجودی «' + (p ? p.fa : id) + '» را به من اطلاع دهید.';
    state.contactSent = false;
    state.contactError = '';
    go('contact');
  },

  'add-current': (id) => {
    addToCart(id, state.qty);
    go('cart');
  },

  'buy-now': (id) => {
    addToCart(id, state.qty);
    go('checkout');
  },

  'qty-inc': () => {
    state.qty += 1;
    render();
  },
  'qty-dec': () => {
    state.qty = Math.max(1, state.qty - 1);
    render();
  },

  'row-inc': (id) => {
    setQty(id, (state.cart[id] || 0) + 1);
    render();
  },
  'row-dec': (id) => {
    setQty(id, (state.cart[id] || 0) - 1);
    render();
  },
  'row-del': (id) => {
    setQty(id, 0);
    render();
  },

  filter: (id) => {
    state.filter = id;
    state.subFilter = 'all';
    state.styleFilter = 'all';
    if (state.route !== 'shop') go('shop');
    else render();
  },

  subfilter: (id) => {
    state.subFilter = id;
    render();
  },

  stylefilter: (id) => {
    state.styleFilter = id;
    render();
  },

  sort: () => {
    state.sort = NEXT_SORT[state.sort];
    render();
  },

  'open-lightbox': (id, dataset) => {
    state.lightbox = { id, index: Number(dataset?.index || 0) };
    render();
  },
  'lightbox-close': () => {
    state.lightbox = null;
    render();
  },
  'lightbox-next': () => {
    if (!state.lightbox) return;
    const p = byId(state.lightbox.id);
    const n = (p?.photos?.length || 1);
    state.lightbox.index = (state.lightbox.index + 1) % n;
    render();
  },
  'lightbox-prev': () => {
    if (!state.lightbox) return;
    const p = byId(state.lightbox.id);
    const n = (p?.photos?.length || 1);
    state.lightbox.index = (state.lightbox.index - 1 + n) % n;
    render();
  },

  'clear-search': () => {
    state.query = '';
    state.filter = 'all';
    go('shop');
  },

  'apply-code': () => {
    syncForm();
    const key = state.code.trim().toUpperCase();
    if (DISCOUNT_CODES[key]) {
      state.appliedCode = key;
      state.codeMsg = 'کد ' + key + ' اعمال شد: ' + FA(Math.round(DISCOUNT_CODES[key] * 100)) + '٪ تخفیف';
    } else {
      state.appliedCode = null;
      state.codeMsg = 'این کد معتبر نیست. کد نمونه: GLOW10';
    }
    render();
  },

  auth: (id) => {
    syncForm();
    state.auth = id;
    render();
  },
  'send-otp': () => {
    syncForm();
    state.otpSent = true;
    render();
  },
  ship: (id) => {
    syncForm();
    state.ship = id;
    render();
  },
  pay: (id) => {
    syncForm();
    state.pay = id;
    render();
  },

  'place-order': placeOrder,

  faq: (id) => {
    const i = Number(id);
    state.faqOpen = state.faqOpen === i ? -1 : i;
    render();
  },

  'send-contact': () => {
    syncForm();
    if (!state.contact.name.trim()) {
      state.contactError = 'نام را وارد کنید.';
      return render();
    }
    if (state.contact.phone.replace(/\D/g, '').length < 10) {
      state.contactError = 'شماره تماس را کامل وارد کنید.';
      return render();
    }
    state.contactError = '';
    state.contactSent = true;
    render();
  },

  'contact-reset': () => {
    state.contactSent = false;
    state.contact = { name: '', phone: '', msg: '' };
    render();
  },

  'track-submit': () => {
    syncForm();
    const code = state.trackCode.trim();
    const phone = state.trackPhone.trim();

    state.trackError = '';
    state.trackData = null;

    if (!code || phone.replace(/\D/g, '').length < 10) {
      state.trackError = 'کد سفارش و شماره موبایل را کامل وارد کنید.';
      render();
      return;
    }
    if (state.trackLoading) return; // already checking — ignore a double-click

    state.trackLoading = true;
    render();

    fetch('/api/track-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, phone }),
    })
      .then((r) => r.json())
      .then((res) => {
        state.trackLoading = false;
        if (!res.ok) {
          state.trackError = res.error || 'کد سفارش یا شماره موبایل مطابقت ندارد.';
        } else {
          state.trackData = res;
        }
        render();
      })
      .catch(() => {
        state.trackLoading = false;
        state.trackError = 'اتصال برقرار نشد. اینترنت خود را بررسی کنید و دوباره تلاش کنید.';
        render();
      });
  },
};

document.addEventListener('click', (e) => {
  const navEl = e.target.closest('[data-nav]');
  if (navEl) {
    e.preventDefault();
    syncForm();
    state.menuOpen = false;
    go(navEl.dataset.nav.replace(/^#\//, ''));
    return;
  }

  const actEl = e.target.closest('[data-act]');
  if (!actEl) return;
  const fn = ACTIONS[actEl.dataset.act];
  if (fn) {
    e.preventDefault();
    fn(actEl.dataset.id, actEl.dataset);
  }
});

// Size-picker dropdown on a product page — changing it swaps which variant
// is shown/priced/added to cart, without leaving the page.
document.addEventListener('change', (e) => {
  if (e.target.id === 'height-picker') {
    state.selectedHeight = Number(e.target.value);
    render();
  }
  if (e.target.id === 'color-picker') {
    state.selectedColorIndex = Number(e.target.value);
    render();
  }
});

// Live search from the header, on every screen.
document.addEventListener('input', (e) => {
  if (e.target.id !== 'q') return;
  state.query = e.target.value;
  if (state.route !== 'shop') {
    state.filter = 'all';
    go('shop');
  } else {
    render();
  }
  const box = document.getElementById('q');
  if (box) {
    box.focus();
    box.setSelectionRange(box.value.length, box.value.length);
  }
});

document.addEventListener('keydown', (e) => {
  if (state.lightbox) {
    if (e.key === 'Escape') { ACTIONS['lightbox-close'](); return; }
    if (e.key === 'ArrowLeft') { ACTIONS['lightbox-next'](); return; }
    if (e.key === 'ArrowRight') { ACTIONS['lightbox-prev'](); return; }
  }
  if (e.key !== 'Enter') return;
  if (e.target.id === 'code') ACTIONS['apply-code']();
  if (e.target.id === 'track' || e.target.id === 'track-phone') ACTIONS['track-submit']();
});

window.addEventListener('hashchange', onRouteChange);

onRouteChange();

/* ---- Live catalog from Supabase ------------------------------------------
   The site renders instantly from the fallback catalog in data.js, then
   quietly swaps in the live database catalog once it arrives — so a slow or
   failed connection never leaves the visitor looking at a blank page, it
   just means they briefly see the last-known catalog instead of the newest
   one. */

async function loadProductsFromSupabase() {
  try {
    const sb = getSupabaseClient();
    const { data, error } = await sb.from('products').select('*').order('sort_order', { ascending: true });

    if (error) {
      console.warn('[glow] could not load live catalog, using fallback:', error.message);
      return;
    }
    if (!data || !data.length) return; // admin panel is empty so far — keep the fallback catalog

    PRODUCTS = data.map((r) => ({
      id: r.slug,
      fa: r.name_fa,
      en: r.name_en || r.name_fa,
      col: r.collection,
      subcategory: r.subcategory || null,
      style: r.style || null,
      variants: Array.isArray(r.variants) ? r.variants : [],
      colors: Array.isArray(r.colors) ? r.colors : [],
      height: r.height_cm ?? HEIGHT_UNKNOWN,
      material: r.material || '',
      desc: r.description || '',
      photo_url: r.photo_url || null,
      photos: Array.isArray(r.photos) && r.photos.length ? r.photos : null,
    }));
    PRICE = Object.fromEntries(data.map((r) => [r.slug, r.price]));
    PROVISIONAL = Object.fromEntries(data.map((r) => [r.slug, r.price_provisional]));
    OUT_OF_STOCK = data.filter((r) => !r.in_stock).map((r) => r.slug);

    buildItems();
    render();
  } catch (e) {
    console.warn('[glow] live catalog fetch failed, using fallback:', e.message);
  }
}

loadProductsFromSupabase();
