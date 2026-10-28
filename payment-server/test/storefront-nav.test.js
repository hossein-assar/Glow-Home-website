// Main navigation in the storefront (app.js, a browser script): the desktop
// category bar with its dropdowns and the mobile drawer. Its items and links
// must stay what they were, opening and closing must never go through
// render(), and the header markup must not depend on the menu or the route,
// so the search input is never replaced while someone types. Runs the real
// header(), render() and menu code, pulled out of the source text, against a
// small fake DOM (no jsdom in this project).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../../app.js', import.meta.url), 'utf8');
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
const menuActionsSrc = grab(/ {2}\/\/ The menu never calls render\(\)[\s\S]*?'nav-dropdown': [\s\S]*?\n {2}},\n/);
const { COLLECTIONS } = new Function(dataSrc + '\nreturn { COLLECTIONS };')();

const SUBS = { lamps: ['سفالی', 'پلی استر', 'چوبی'], shades: [], candles: [], decor: [] };

function headerFns(state) {
  return new Function(
    'state', 'COLLECTIONS', 'subcategoriesFor', 'cartCount',
    `const COPY = { noticeBar: 'notice' };
     const FA = String;
     const icon = (name) => '<svg data-icon="' + name + '"></svg>';
     ${escSrc}
     ${fnSrc('navItems')}
     ${fnSrc('header')}
     return { header };`
  )(state, COLLECTIONS, (col) => SUBS[col] || [], () => Object.values(state.cart).reduce((a, b) => a + b, 0));
}

const baseState = () => ({ route: 'home', param: null, filter: 'all', subFilter: 'all', query: '', cart: {}, menuOpen: false, catalog: 'ready' });

/** [label, href] of every nav button between two markers in header() output. */
function links(html, from, to) {
  const part = html.slice(html.indexOf(from), to ? html.indexOf(to) : undefined);
  return [...part.matchAll(/<button[^>]*data-nav="([^"]*)"[^>]*>([^<]*)</g)].map((m) => [m[2], m[1]]);
}

const EXPECTED = [
  ['خانه', '#/'],
  ['فروشگاه', '#/shop'],
  ['آباژور', '#/c/lamps'],
  ['سفالی', '#/c/lamps/' + encodeURIComponent('سفالی')],
  ['پلی استر', '#/c/lamps/' + encodeURIComponent('پلی استر')],
  ['چوبی', '#/c/lamps/' + encodeURIComponent('چوبی')],
  ['شید', '#/c/shades'],
  ['شمع', '#/c/candles'],
  ['اکسسوری منزل', '#/c/decor'],
  ['درباره ما', '#/about'],
  ['سوالات متداول', '#/faq'],
  ['تماس', '#/contact'],
];

test('the category bar and the drawer list the same items, linking where the menu always did', () => {
  const { header } = headerFns(baseState());
  const html = header();
  assert.deepEqual(links(html, 'class="catbar"', 'class="drawer-backdrop"'), EXPECTED);
  assert.deepEqual(links(html, 'class="drawer-nav"', 'class="drawer-foot"'), EXPECTED);
});

test('the drawer footer links to order tracking, contact and the cart, with the cart count', () => {
  const state = baseState();
  const { header } = headerFns(state);
  const foot = (h) => h.slice(h.indexOf('class="drawer-foot"'));
  const navs = (h) => [...foot(h).matchAll(/data-nav="([^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(navs(header()), ['#/track', '#/contact', '#/cart']);
  assert.match(foot(header()), /پیگیری سفارش[\s\S]*تماس با ما[\s\S]*سبد خرید/);
  assert.doesNotMatch(foot(header()), /drawer-count/);
  state.cart = { lale: 2, abrak: 1 };
  assert.match(foot(header()), /<span class="drawer-count">3<\/span>/);
  assert.match(header(), /<span class="badge">3<\/span>/, 'header cart badge');
});

test('header markup does not depend on the menu or on the route', () => {
  const state = baseState();
  const { header } = headerFns(state);
  const first = header();
  const variants = [
    { menuOpen: true },
    { route: 'shop' },
    { route: 'collection', filter: 'lamps' },
    { route: 'collection', filter: 'lamps', subFilter: 'سفالی' },
    { route: 'product', param: 'lale' },
    { route: 'about', menuOpen: true },
  ];
  for (const v of variants) {
    Object.assign(state, baseState(), v);
    assert.equal(header(), first, JSON.stringify(v));
  }
});

/* ---- A small fake DOM for the menu code ---------------------------------- */

function makeDom() {
  const doc = { listeners: {}, activeElement: null, focusVisible: false };
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
    contains(o) { for (let n = o; n; n = n.parent) if (n === this) return true; return false; }
    matches(sel) {
      return sel.split(',').some((s) => {
        s = s.trim();
        if (s === ':focus-visible') return doc.focusVisible && doc.activeElement === this;
        const m = s.match(/^([a-z]+)?((?:[.#][\w-]+|\[[\w-]+(?:="[^"]*")?\])*)$/);
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
  const lamps = el('li', { cls: ['catbar-item'], data: { sub: 'lamps' } }, [
    el('button', { cls: ['catbar-link'], data: { navKey: 'c:lamps', navSection: 'lamps' } }),
    el('button', { cls: ['catbar-toggle'], attrs: { 'aria-expanded': 'false' } }),
    el('div', { cls: ['catbar-dropdown'] }, [el('button', { data: { navKey: 'c:lamps/سفالی' } })]),
  ]);
  const drawer = el('div', { id: 'site-drawer', cls: ['drawer'] }, [
    el('button', { id: 'drawer-close' }),
    el('button', { cls: ['drawer-link'], data: { navKey: 'home' } }),
    el('button', { cls: ['drawer-link'], data: { navKey: 'c:lamps', navSection: 'lamps' } }),
    el('button', { cls: ['drawer-foot-link'] }),
  ]);
  const root = el('html', {}, [
    el('header', {}, [
      el('button', { id: 'menu-btn', attrs: { 'aria-expanded': 'false' } }),
      el('input', { id: 'q' }),
      el('ul', { cls: ['catbar-list'] }, [el('li', { cls: ['catbar-item'] }, [el('button', { data: { navKey: 'shop' } })]), lamps]),
      drawer,
    ]),
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
  return { doc, el, root, lamps, drawer, fire, byId: doc.getElementById };
}

function menu(dom, state = baseState()) {
  let renders = 0;
  const win = { matchMedia: () => ({ addEventListener() {} }) };
  const fns = new Function(
    'document', 'window', 'state', 'byId', 'render',
    `${navSrc}
     const ACTIONS = {
     ${menuActionsSrc}
     };
     return { ACTIONS, syncNav, getDropdown: () => navDropdown };`
  )(dom.doc, win, state, (id) => (id === 'lale' ? { col: 'candles' } : null), () => renders++);
  return { ...fns, state, renders: () => renders };
}

test('the hamburger opens the drawer and the close button / backdrop closes it, without render()', () => {
  const dom = makeDom();
  const m = menu(dom);
  const box = dom.byId('q');
  m.syncNav();
  m.ACTIONS.menu();
  assert.equal(m.state.menuOpen, true);
  assert.ok(dom.root.classList.contains('menu-open'), 'page scroll lock');
  assert.ok(dom.drawer.classList.contains('is-open'));
  assert.equal(dom.byId('menu-btn').getAttribute('aria-expanded'), 'true');
  assert.equal(dom.doc.activeElement, dom.byId('drawer-close'), 'focus moves into the drawer');

  m.ACTIONS['menu-close'](); // the X button and the backdrop
  assert.equal(m.state.menuOpen, false);
  assert.ok(!dom.root.classList.contains('menu-open'));
  assert.ok(!dom.drawer.classList.contains('is-open'));
  assert.equal(dom.byId('menu-btn').getAttribute('aria-expanded'), 'false');
  assert.equal(dom.doc.activeElement, dom.byId('menu-btn'), 'focus returns to the hamburger');

  m.ACTIONS.menu();
  m.ACTIONS.menu(); // the hamburger toggles
  assert.equal(m.state.menuOpen, false);
  assert.equal(m.renders(), 0, 'menu called render()');
  assert.equal(dom.byId('q'), box);
});

test('Esc closes the drawer; Tab stays inside it while open', () => {
  const dom = makeDom();
  const m = menu(dom);
  m.ACTIONS.menu();
  const last = dom.drawer.querySelector('.drawer-foot-link');
  last.focus();
  const tab = dom.fire('keydown', last, { key: 'Tab', shiftKey: false });
  assert.ok(tab.defaultPrevented);
  assert.equal(dom.doc.activeElement, dom.byId('drawer-close'), 'Tab wraps to the first item');
  dom.fire('keydown', dom.doc.activeElement, { key: 'Tab', shiftKey: true });
  assert.equal(dom.doc.activeElement, last, 'Shift+Tab wraps to the last item');

  dom.fire('keydown', last, { key: 'Escape' });
  assert.equal(m.state.menuOpen, false);
  assert.ok(!dom.drawer.classList.contains('is-open'));
  assert.equal(dom.doc.activeElement, dom.byId('menu-btn'));
  assert.equal(m.renders(), 0);
});

test('a closed drawer does not take focus back from where the visitor is', () => {
  const dom = makeDom();
  const m = menu(dom);
  m.ACTIONS.menu();
  dom.byId('q').focus();
  m.ACTIONS['menu-close']();
  assert.equal(dom.doc.activeElement, dom.byId('q'));
});

test('the آباژور dropdown: arrow toggles it, Esc closes it and puts focus on the arrow', () => {
  const dom = makeDom();
  const m = menu(dom);
  const toggle = dom.lamps.querySelector('.catbar-toggle');
  m.ACTIONS['nav-dropdown']('lamps');
  assert.ok(dom.lamps.classList.contains('is-open'));
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  m.ACTIONS['nav-dropdown']('lamps');
  assert.ok(!dom.lamps.classList.contains('is-open'));
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');

  m.ACTIONS['nav-dropdown']('lamps');
  const sub = dom.lamps.querySelector('.catbar-dropdown').children[0];
  sub.focus();
  dom.fire('keydown', sub, { key: 'Escape' });
  assert.ok(!dom.lamps.classList.contains('is-open'));
  assert.equal(dom.doc.activeElement, toggle);
  assert.equal(m.getDropdown(), null, 'focus on the arrow re-opened it');
  assert.equal(m.renders(), 0);
});

test('the dropdown opens on keyboard focus and closes when focus leaves the item', () => {
  const dom = makeDom();
  const m = menu(dom);
  const link = dom.lamps.querySelector('.catbar-link');
  dom.doc.focusVisible = false; // a mouse click's focus: the click decides
  link.focus();
  dom.fire('focusin', link);
  assert.ok(!dom.lamps.classList.contains('is-open'));

  dom.doc.focusVisible = true; // Tab
  dom.fire('focusin', link);
  assert.ok(dom.lamps.classList.contains('is-open'));
  const sub = dom.lamps.querySelector('.catbar-dropdown').children[0];
  dom.fire('focusout', link, { relatedTarget: sub });
  assert.ok(dom.lamps.classList.contains('is-open'), 'moving into the dropdown keeps it open');
  dom.fire('focusout', sub, { relatedTarget: dom.byId('q') });
  assert.ok(!dom.lamps.classList.contains('is-open'));
});

test('hover opens the dropdown, a click on the arrow keeps it open, leaving closes a hover-opened one', async () => {
  const dom = makeDom();
  const m = menu(dom);
  const link = dom.lamps.querySelector('.catbar-link');
  dom.fire('pointerover', link, { pointerType: 'touch' });
  assert.ok(!dom.lamps.classList.contains('is-open'), 'touch does not hover');
  dom.fire('pointerover', link, { pointerType: 'mouse' });
  assert.ok(dom.lamps.classList.contains('is-open'));
  dom.fire('pointerout', link, { pointerType: 'mouse', relatedTarget: dom.byId('q') });
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(!dom.lamps.classList.contains('is-open'));

  dom.fire('pointerover', link, { pointerType: 'mouse' });
  m.ACTIONS['nav-dropdown']('lamps');
  assert.ok(dom.lamps.classList.contains('is-open'), 'click on a hover-opened dropdown closed it');
  dom.fire('pointerout', link, { pointerType: 'mouse', relatedTarget: dom.byId('q') });
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(dom.lamps.classList.contains('is-open'), 'a clicked-open dropdown stays until Esc / outside click');
});

test('syncNav marks the current page and its section', () => {
  const dom = makeDom();
  const m = menu(dom);
  const cur = () => dom.doc.querySelectorAll('[data-nav-key]').filter((e) => e.getAttribute('aria-current') === 'page').map((e) => e.dataset.navKey);
  const inSection = () => dom.doc.querySelectorAll('[data-nav-key]').filter((e) => e.classList.contains('in-section')).length;

  m.syncNav();
  assert.deepEqual(cur(), ['home']);
  Object.assign(m.state, { route: 'collection', filter: 'lamps', subFilter: 'all' });
  m.syncNav();
  assert.deepEqual(cur(), ['c:lamps', 'c:lamps']);
  Object.assign(m.state, { subFilter: 'سفالی' });
  m.syncNav();
  assert.deepEqual(cur(), ['c:lamps/سفالی']);
  assert.equal(inSection(), 2, 'آباژور marked as the section in the bar and the drawer');
  Object.assign(m.state, { route: 'shop' });
  m.syncNav();
  assert.deepEqual(cur(), ['shop']);
  assert.equal(inSection(), 0);
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
  const win = { matchMedia: () => ({ addEventListener() {} }) };

  const state = baseState();
  let renders = 0;
  const env = new Function(
    'document', 'window', '$', 'state', 'go', 'COLLECTIONS', 'subcategoriesFor', 'onRender',
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
  ).call(null, doc, win, $, state, (route) => {
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

  type('ش'); // home -> shop: the header (now route-independent) stays
  assert.equal(state.route, 'shop');
  const before = renders;
  env.ACTIONS.menu();
  env.ACTIONS['menu-close']();
  env.ACTIONS.menu();
  (doc.listeners.keydown || []).forEach((fn) => fn({ key: 'Escape', target: box, preventDefault() {} }));
  env.ACTIONS['nav-dropdown']('lamps');
  env.ACTIONS['nav-dropdown']('lamps');
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
