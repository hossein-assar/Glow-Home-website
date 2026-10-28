// Main navigation in the storefront (app.js, a browser script): the
// hamburger's menu panel — a wide panel under the header from 900px up, a
// full-height drawer below that, built from the same nodes. Every category
// and every subcategory must be in it, linking where the menu always did;
// opening and closing must never go through render(); and the header markup
// must not depend on the menu or the route, so the search input is never
// replaced while someone types. Runs the real header(), render(), click
// handler and menu code, pulled out of the source text, against a small fake
// DOM (no jsdom in this project).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../../app.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../styles.css', import.meta.url), 'utf8');
const dataSrc = readFileSync(new URL('../../data.js', import.meta.url), 'utf8');
const grab = (re) => {
  const m = src.match(re);
  assert.ok(m, 'not found in app.js: ' + re);
  return m[0];
};
const fnSrc = (name) => grab(new RegExp(`function ${name}\\([\\s\\S]*?\\n}\\n`));
const escSrc = grab(/const esc = \(s\) =>[\s\S]*?;\n/);
const navSrc = grab(/\/\* ---- Navigation menu -[\s\S]*?(?=\/\/ Live search from the header)/);
const renderSrc = grab(/let lastChrome = '';[\s\S]*?\nfunction render\(\) \{[\s\S]*?\n}\n/);
const searchSrc = grab(/\/\/ Live search from the header[\s\S]*?document\.addEventListener\('input', \(e\) => \{\n  if \(e\.target\.id !== 'q'\) return;[\s\S]*?\n}\);\n/);
const clickSrc = grab(/document\.addEventListener\('click', \(e\) => \{\n  \/\/ A click outside the open menu[\s\S]*?\n}\);\n/);
const menuActionsSrc = grab(/ {2}\/\/ The menu never calls render\(\)[\s\S]*?'menu-close': [^\n]*\n/);
const { COLLECTIONS } = new Function(dataSrc + '\nreturn { COLLECTIONS };')();

// Subcategories as in the live catalog.
const SUBS = {
  lamps: ['سفالی', 'پلی استر', 'چوبی'],
  shades: ['ساده', 'گلدوزی'],
  candles: ['شاتی', 'قلمی'],
  decor: ['جا شمعی', 'ست پذیرایی'],
};

function headerFns(state, subs = SUBS) {
  return new Function(
    'state', 'COLLECTIONS', 'subcategoriesFor', 'cartCount',
    `const COPY = { noticeBar: 'notice' };
     const FA = String;
     const icon = (name) => '<svg data-icon="' + name + '"></svg>';
     ${escSrc}
     ${fnSrc('navItems')}
     ${fnSrc('header')}
     return { header };`
  )(state, COLLECTIONS, (col) => subs[col] || [], () => Object.values(state.cart).reduce((a, b) => a + b, 0));
}

const baseState = () => ({ route: 'home', param: null, filter: 'all', subFilter: 'all', query: '', cart: {}, menuOpen: false, catalog: 'ready' });

/** [label, href] of every nav button in a part of header() output. */
const links = (part) => [...part.matchAll(/<button[^>]*data-nav="([^"]*)"[^>]*>(?:<svg[^>]*><\/svg>)?(?:<span>)?([^<]*)</g)].map((m) => [m[2].trim(), m[1]]);
const between = (html, from, to) => html.slice(html.indexOf(from), html.indexOf(to, html.indexOf(from)));
const sub = (col, s) => [s, '#/c/' + col + '/' + encodeURIComponent(s)];

test('the menu lists every category with all its subcategories, linking where the menu always did', () => {
  const html = headerFns(baseState()).header();
  assert.deepEqual(links(between(html, 'class="menu-cats"', '</nav>')), [
    ['آباژور', '#/c/lamps'], sub('lamps', 'سفالی'), sub('lamps', 'پلی استر'), sub('lamps', 'چوبی'),
    ['شید', '#/c/shades'], sub('shades', 'ساده'), sub('shades', 'گلدوزی'),
    ['شمع', '#/c/candles'], sub('candles', 'شاتی'), sub('candles', 'قلمی'),
    ['اکسسوری منزل', '#/c/decor'], sub('decor', 'جا شمعی'), sub('decor', 'ست پذیرایی'),
  ]);
  // Each category is its own block: heading first, its subcategories right under it.
  const blocks = [...html.matchAll(/<section class="menu-cat">([\s\S]*?)<\/section>/g)].map((m) => links(m[1]).map(([, href]) => href));
  assert.equal(blocks.length, 4);
  for (const b of blocks) assert.ok(b.slice(1).every((h) => h.startsWith(b[0] + '/')), b.join(' '));
});

test('a category with no subcategories is still listed, as a heading alone', () => {
  const html = headerFns(baseState(), { lamps: ['سفالی'] }).header();
  assert.deepEqual(links(between(html, 'class="menu-cats"', '</nav>')).map(([, h]) => h), [
    '#/c/lamps', '#/c/lamps/' + encodeURIComponent('سفالی'), '#/c/shades', '#/c/candles', '#/c/decor',
  ]);
});

test('quick links and the cart, with its count', () => {
  const state = baseState();
  const { header } = headerFns(state);
  const quick = () => between(header(), 'class="menu-quick"', '</nav>');
  assert.deepEqual(links(quick()), [
    ['خانه', '#/'],
    ['همه‌ی محصولات', '#/shop'],
    ['درباره ما', '#/about'],
    ['سوالات متداول', '#/faq'],
    ['تماس', '#/contact'],
    ['پیگیری سفارش', '#/track'],
    ['سبد خرید', '#/cart'],
  ]);
  assert.doesNotMatch(quick(), /menu-count/);
  state.cart = { lale: 2, abrak: 1 };
  assert.match(quick(), /<span class="menu-count">3<\/span>/);
  assert.match(header(), /<span class="badge">3<\/span>/, 'header cart badge');
});

test('one panel serves both layouts, and the CSS never hides any of its links', () => {
  const html = headerFns(baseState()).header();
  assert.equal(html.match(/id="site-menu"/g).length, 1);
  assert.doesNotMatch(html, /catbar|accordion|aria-expanded="false" aria-controls="menu-sub/);
  const navs = [...html.matchAll(/data-nav="/g)].length;
  assert.equal(navs, links(between(html, 'id="site-menu"', '</header>')).length, 'nav links outside the panel');
  // No rule hides categories, subcategories or quick links at any width.
  for (const m of css.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    if (/\.menu-(cats|cat|cat-title|subs|sub|quick|quick-link|cart|body)\b/.test(m[1])) {
      assert.doesNotMatch(m[2], /display:\s*none|visibility:\s*hidden/, m[1].trim());
    }
  }
});

test('header markup does not depend on the menu or on the route', () => {
  const state = baseState();
  const { header } = headerFns(state);
  const first = header();
  for (const v of [
    { menuOpen: true },
    { route: 'shop' },
    { route: 'collection', filter: 'lamps' },
    { route: 'collection', filter: 'lamps', subFilter: 'سفالی' },
    { route: 'product', param: 'lale' },
    { route: 'track', menuOpen: true },
  ]) {
    Object.assign(state, baseState(), v);
    assert.equal(header(), first, JSON.stringify(v));
  }
});

/* ---- A small fake DOM for the menu code ---------------------------------- */

function makeDom() {
  const doc = { listeners: {}, activeElement: null };
  const all = [];
  class El {
    constructor(tag, { id = '', cls = [], data = {}, attrs = {} } = {}, children = []) {
      Object.assign(this, { tag, id, dataset: { ...data }, attrs: { ...attrs }, parent: null, children: [] });
      this.classes = new Set(cls);
      this.classList = {
        toggle: (c, on) => (on ? this.classes.add(c) : this.classes.delete(c)),
        contains: (c) => this.classes.has(c),
      };
      children.forEach((c) => { c.parent = this; this.children.push(c); });
      all.push(this);
    }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return this.attrs[k] ?? null; }
    focus() { doc.activeElement = this; }
    getClientRects() { return this.hidden ? [] : [{}]; }
    contains(o) { for (let n = o; n; n = n.parent) if (n === this) return true; return false; }
    matches(sel) {
      return sel.split(',').some((s) => {
        const m = s.trim().match(/^([a-z]+)?((?:[.#][\w-]+|\[[\w-]+(?:="[^"]*")?\])*)$/);
        if (!m) throw new Error('fake DOM cannot match ' + s);
        if (m[1] && m[1] !== this.tag) return false;
        return [...m[2].matchAll(/\.([\w-]+)|#([\w-]+)|\[([\w-]+)(?:="([^"]*)")?\]/g)].every(([, c, i, a, v]) => {
          if (c) return this.classes.has(c);
          if (i) return this.id === i;
          const val = a.startsWith('data-') ? this.dataset[a.slice(5).replace(/-(\w)/g, (_, x) => x.toUpperCase())] : this.attrs[a];
          return v === undefined ? val !== undefined : val === v;
        });
      });
    }
    closest(sel) { for (let n = this; n; n = n.parent) if (n.matches(sel)) return n; return null; }
    querySelectorAll(sel) { return all.filter((e) => e !== this && this.contains(e) && e.matches(sel)); }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  }
  const el = (tag, opts, children) => new El(tag, opts, children);
  const panel = el('div', { id: 'site-menu', cls: ['menu-panel'] }, [
    el('div', { cls: ['menu-head'] }, [el('button', { id: 'menu-close', data: { act: 'menu-close' } })]),
    el('section', { cls: ['menu-cat'] }, [
      el('button', { data: { nav: '#/c/lamps', navKey: 'c:lamps', navSection: 'lamps' } }),
      el('button', { data: { nav: '#/c/lamps/x', navKey: 'c:lamps/سفالی' } }),
    ]),
    el('nav', { cls: ['menu-quick'] }, [
      el('button', { data: { nav: '#/', navKey: 'home' } }),
      el('button', { data: { nav: '#/cart', navKey: 'cart' } }),
    ]),
  ]);
  const root = el('html', {}, [
    el('header', {}, [
      el('button', { id: 'menu-btn', data: { act: 'menu' }, attrs: { 'aria-expanded': 'false' } }),
      el('input', { id: 'q' }),
      el('div', { cls: ['menu-backdrop'], data: { act: 'menu-close' } }),
      panel,
    ]),
    el('main', {}, [el('p', { id: 'page-text' })]),
  ]);
  doc.documentElement = root;
  doc.getElementById = (id) => all.find((e) => e.id === id && root.contains(e)) || null;
  doc.querySelectorAll = (sel) => root.querySelectorAll(sel);
  doc.querySelector = (sel) => root.querySelector(sel);
  doc.addEventListener = (type, fn) => (doc.listeners[type] ||= []).push(fn);
  const fire = (type, target, extra = {}) => {
    const ev = { target, defaultPrevented: false, preventDefault() { ev.defaultPrevented = true; }, ...extra };
    (doc.listeners[type] || []).forEach((fn) => fn(ev));
    return ev;
  };
  return { doc, root, panel, fire, byId: doc.getElementById };
}

function menu(dom, state = baseState()) {
  let renders = 0;
  const went = [];
  const fns = new Function(
    'document', 'state', 'byId', 'render', 'go', 'syncForm',
    `${navSrc}
     const ACTIONS = {
     ${menuActionsSrc}
     };
     ${clickSrc}
     return { ACTIONS, syncNav };`
  )(dom.doc, state, (id) => (id === 'lale' ? { col: 'candles' } : null), () => renders++, (p) => went.push(p), () => {});
  const isOpen = () => state.menuOpen && dom.panel.classList.contains('is-open') && dom.root.classList.contains('menu-open');
  const isClosed = () => !state.menuOpen && !dom.panel.classList.contains('is-open') && !dom.root.classList.contains('menu-open');
  return { ...fns, state, went, isOpen, isClosed, renders: () => renders };
}

test('the hamburger opens the panel; the X, the backdrop and the hamburger close it — never through render()', () => {
  const dom = makeDom();
  const m = menu(dom);
  const box = dom.byId('q');
  const btn = dom.byId('menu-btn');
  m.syncNav();

  dom.fire('click', btn);
  assert.ok(m.isOpen(), 'open, page scroll locked');
  assert.equal(btn.getAttribute('aria-expanded'), 'true');
  assert.equal(btn.getAttribute('aria-label'), 'بستن فهرست');
  assert.equal(dom.doc.activeElement, dom.byId('menu-close'), 'focus moves into the panel');

  dom.fire('click', dom.byId('menu-close'));
  assert.ok(m.isClosed());
  assert.equal(btn.getAttribute('aria-expanded'), 'false');
  assert.equal(dom.doc.activeElement, btn, 'focus returns to the hamburger');

  dom.fire('click', btn);
  dom.fire('click', dom.root.querySelector('.menu-backdrop'));
  assert.ok(m.isClosed(), 'backdrop');

  dom.fire('click', btn);
  dom.fire('click', btn);
  assert.ok(m.isClosed(), 'the hamburger toggles');
  assert.equal(m.renders(), 0, 'menu called render()');
  assert.equal(dom.byId('q'), box);
});

test('a click outside the panel closes it; a click inside does not', () => {
  const dom = makeDom();
  const m = menu(dom);
  dom.fire('click', dom.byId('menu-btn'));
  dom.fire('click', dom.panel.querySelector('.menu-head'));
  assert.ok(m.isOpen(), 'click inside the panel closed it');
  dom.fire('click', dom.byId('page-text'));
  assert.ok(m.isClosed());
  dom.fire('click', dom.byId('menu-btn'));
  dom.fire('click', dom.byId('q')); // the search box, outside the panel
  assert.ok(m.isClosed());
  assert.equal(m.renders(), 0);
});

test('choosing a category, subcategory or quick link closes the panel and goes there', () => {
  const dom = makeDom();
  const m = menu(dom);
  for (const key of ['c:lamps', 'c:lamps/سفالی', 'cart']) {
    dom.fire('click', dom.byId('menu-btn'));
    dom.fire('click', dom.panel.querySelector(`[data-nav-key="${key}"]`));
    assert.ok(m.isClosed(), key);
  }
  assert.deepEqual(m.went, ['c/lamps', 'c/lamps/x', 'cart']);
});

test('Esc closes the panel; Tab stays inside it while open', () => {
  const dom = makeDom();
  const m = menu(dom);
  dom.fire('click', dom.byId('menu-btn'));
  const last = dom.panel.querySelector('[data-nav-key="cart"]');
  last.focus();
  const tab = dom.fire('keydown', last, { key: 'Tab', shiftKey: false });
  assert.ok(tab.defaultPrevented);
  assert.equal(dom.doc.activeElement, dom.byId('menu-close'), 'Tab wraps to the first item');
  dom.fire('keydown', dom.doc.activeElement, { key: 'Tab', shiftKey: true });
  assert.equal(dom.doc.activeElement, last, 'Shift+Tab wraps to the last item');

  dom.fire('keydown', last, { key: 'Escape' });
  assert.ok(m.isClosed());
  assert.equal(dom.doc.activeElement, dom.byId('menu-btn'));

  const closedTab = dom.fire('keydown', dom.byId('q'), { key: 'Tab', shiftKey: false });
  assert.ok(!closedTab.defaultPrevented, 'Tab trapped while closed');
  assert.equal(m.renders(), 0);
});

test('on open, focus goes to the first item shown (the panel X is hidden on desktop)', () => {
  const dom = makeDom();
  const m = menu(dom);
  dom.byId('menu-close').hidden = true;
  dom.fire('click', dom.byId('menu-btn'));
  const first = dom.panel.querySelector('[data-nav-key="c:lamps"]');
  assert.equal(dom.doc.activeElement, first);
  const last = dom.panel.querySelector('[data-nav-key="cart"]');
  last.focus();
  dom.fire('keydown', last, { key: 'Tab', shiftKey: false });
  assert.equal(dom.doc.activeElement, first, 'Tab wrapped onto the hidden X');
  assert.ok(m.isOpen());
});

test('closing does not take focus back from where the visitor is', () => {
  const dom = makeDom();
  const m = menu(dom);
  m.ACTIONS.menu();
  dom.byId('q').focus();
  m.ACTIONS['menu-close']();
  assert.equal(dom.doc.activeElement, dom.byId('q'));
});

test('syncNav marks the current page and its category, and keeps the menu state on a rebuilt header', () => {
  const dom = makeDom();
  const m = menu(dom);
  const cur = () => dom.doc.querySelectorAll('[data-nav-key]').filter((e) => e.getAttribute('aria-current') === 'page').map((e) => e.dataset.navKey);
  const inSection = () => dom.doc.querySelectorAll('[data-nav-key]').filter((e) => e.classList.contains('in-section')).length;

  m.syncNav();
  assert.deepEqual(cur(), ['home']);
  Object.assign(m.state, { route: 'collection', filter: 'lamps', subFilter: 'all' });
  m.syncNav();
  assert.deepEqual(cur(), ['c:lamps']);
  Object.assign(m.state, { subFilter: 'سفالی' });
  m.syncNav();
  assert.deepEqual(cur(), ['c:lamps/سفالی']);
  assert.equal(inSection(), 1);
  Object.assign(m.state, { route: 'cart' });
  m.syncNav();
  assert.deepEqual(cur(), ['cart']);
  assert.equal(inSection(), 0);

  m.state.menuOpen = true; // as after a header rebuild with the menu open
  m.syncNav();
  assert.ok(m.isOpen());
});

/* ---- With the real header() and render() --------------------------------- */

test('typing in the search box: opening, closing and Esc on the menu keep the same focused input', () => {
  // #app holds a <header> node (owning the #q input) and one node after it,
  // as in storefront-search.test.js.
  const doc = { activeElement: null, title: '', listeners: {}, body: { classList: { toggle() {} } } };
  doc.documentElement = { classList: { toggle() {} } };
  const app = { nodes: [] };
  let headerBuilds = 0;
  const node = (tag, html) => {
    const n = {
      tag,
      html,
      get nextSibling() { return app.nodes[app.nodes.indexOf(n) + 1] || null; },
      remove() { app.nodes.splice(app.nodes.indexOf(n), 1); },
      insertAdjacentHTML(where, h) { app.nodes.splice(app.nodes.indexOf(n) + 1, 0, node('rest', h)); },
    };
    if (tag === 'header') {
      headerBuilds++;
      n.input = {
        id: 'q', value: '', selectionStart: 0, selectionEnd: 0,
        focus() { doc.activeElement = this; },
        setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; },
      };
    }
    return n;
  };
  Object.defineProperty(app, 'innerHTML', {
    set(h) {
      const [head, rest] = h.split('</header>');
      app.nodes = [node('header', head + '</header>'), node('rest', rest)];
    },
  });
  doc.getElementById = (id) => (id === 'q' ? app.nodes.find((n) => n.input)?.input || null : null);
  doc.querySelectorAll = () => [];
  doc.querySelector = () => null;
  doc.addEventListener = (type, fn) => (doc.listeners[type] ||= []).push(fn);
  const $ = (sel) => (sel === '#app' ? app : sel === '#app > header' ? app.nodes.find((n) => n.tag === 'header') || null : null);

  const state = baseState();
  let renders = 0;
  const env = new Function(
    'document', '$', 'state', 'go', 'COLLECTIONS', 'subcategoriesFor', 'onRender',
    `const SCREENS = { home: () => 'HOME', shop: () => 'SHOP[' + state.query + ']' };
     const TITLES = { home: 'h' };
     const screenHome = SCREENS.home;
     const CATALOG_SCREENS = new Set();
     const COPY = { noticeBar: 'notice' };
     const FA = String;
     const icon = (name) => '<svg data-icon="' + name + '"></svg>';
     const cartCount = () => 0;
     const byId = () => null;
     const footer = () => '<footer></footer>';
     const tabbar = () => '';
     const renderLightbox = () => '';
     const hydrateMedia = () => {};
     ${escSrc}
     ${fnSrc('navItems')}
     ${fnSrc('header')}
     ${renderSrc.replace('function render() {', 'function render() { onRender();')}
     ${navSrc}
     ${searchSrc}
     const ACTIONS = {
     ${menuActionsSrc}
     };
     return { render, ACTIONS };`
  )(doc, $, state, (route) => {
    state.route = route;
    env.render();
  }, COLLECTIONS, (col) => SUBS[col] || [], () => renders++);
  env.render();
  const box = doc.getElementById('q');
  box.focus();
  const type = (text) => {
    box.value = text;
    box.selectionStart = box.selectionEnd = text.length;
    (doc.listeners.input || []).forEach((fn) => fn({ target: box }));
  };

  type('ش'); // home -> shop: the header (route-independent) stays
  assert.equal(state.route, 'shop');
  const before = renders;
  env.ACTIONS.menu();
  env.ACTIONS['menu-close']();
  env.ACTIONS.menu();
  (doc.listeners.keydown || []).forEach((fn) => fn({ key: 'Escape', target: box, preventDefault() {} }));
  assert.equal(renders, before, 'the menu re-rendered the page');
  assert.equal(state.menuOpen, false);

  box.focus();
  type('شمع');
  assert.equal(doc.getElementById('q'), box, 'search input replaced');
  assert.equal(doc.activeElement, box, 'focus lost');
  assert.equal(box.value, 'شمع');
  assert.equal(box.selectionStart, 3);
  assert.equal(headerBuilds, 1, 'header rebuilt');
  assert.match(app.nodes.find((n) => n.tag === 'rest').html, /SHOP\[شمع\]/);
});
