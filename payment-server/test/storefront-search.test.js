// Header search in the storefront (app.js, a browser script): typing must not
// replace the input element, so focus and caret survive every keystroke —
// including the first letter typed on another screen, which switches to the
// shop. Runs the real render() and search listeners, pulled out of the source
// text, against a small fake DOM (no jsdom in this project).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../../app.js', import.meta.url), 'utf8');
const grab = (re) => {
  const m = src.match(re);
  assert.ok(m, 'not found in app.js: ' + re);
  return m[0];
};
const renderSrc = grab(/let lastChrome = '';[\s\S]*?\nfunction render\(\) \{[\s\S]*?\n}\n/);
const searchSrc = grab(/function onSearchInput\([\s\S]*?document\.addEventListener\('compositionend'[\s\S]*?\n}\);\n/);

/** #app holds a <header> node (owning the #q input) followed by one node for
 * everything after it — enough for render()'s two paths. */
function makeEnv() {
  const doc = { activeElement: null, title: '', listeners: {}, body: { classList: { toggle() {} } } };
  const makeInput = () => ({
    id: 'q',
    value: '',
    selectionStart: 0,
    selectionEnd: 0,
    focus() { doc.activeElement = this; },
    setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; },
  });
  const app = { nodes: [] };
  const node = (tag, html) => {
    const n = {
      tag,
      html,
      get nextSibling() { return app.nodes[app.nodes.indexOf(n) + 1] || null; },
      remove() {
        if (doc.activeElement && doc.activeElement === n.input) doc.activeElement = null;
        app.nodes.splice(app.nodes.indexOf(n), 1);
      },
      insertAdjacentHTML(where, h) { app.nodes.splice(app.nodes.indexOf(n) + 1, 0, node('rest', h)); },
    };
    if (tag === 'header') n.input = makeInput();
    return n;
  };
  Object.defineProperty(app, 'innerHTML', {
    set(h) {
      if (app.nodes.some((n) => n.input && n.input === doc.activeElement)) doc.activeElement = null;
      const [head, rest] = h.split('</header>');
      app.nodes = [node('header', head + '</header>'), node('rest', rest)];
    },
  });
  doc.getElementById = (id) => (id === 'q' ? app.nodes.find((n) => n.input)?.input || null : null);
  doc.addEventListener = (type, fn) => (doc.listeners[type] ||= []).push(fn);
  const $ = (sel) => (sel === '#app' ? app : sel === '#app > header' ? app.nodes.find((n) => n.tag === 'header') || null : null);

  const state = { route: 'home', query: '', filter: 'lamps', cartCount: 0 };
  const env = new Function(
    'document', '$', 'state', 'go',
    `const SCREENS = { home: () => 'HOME', shop: () => 'SHOP[' + state.query + ']' };
     const TITLES = { home: 'h' };
     const screenHome = SCREENS.home;
     const header = () => '<header>badge=' + state.cartCount + '</header>';
     const footer = () => '<footer></footer>';
     const tabbar = () => '';
     const renderLightbox = () => '';
     const hydrateMedia = () => {};
     ${renderSrc}
     ${searchSrc}
     return { render };`
  )(doc, $, state, (route) => {
    // go('shop') changes the hash; hashchange then calls render().
    state.route = route;
    env.render();
  });
  const main = () => app.nodes.find((n) => n.tag === 'rest').html;
  const fire = (type, target, extra = {}) => (doc.listeners[type] || []).forEach((fn) => fn({ target, ...extra }));
  const type = (box, text) => {
    box.value = text;
    box.selectionStart = box.selectionEnd = text.length;
    fire('input', box);
  };
  return { doc, state, env, main, fire, type };
}

test('typing on the home screen: the first letter switches to the shop and the input stays the same focused node', () => {
  const { doc, state, env, main, type } = makeEnv();
  env.render();
  const box = doc.getElementById('q');
  box.focus();

  type(box, 'گ');
  assert.equal(state.route, 'shop');
  assert.equal(state.filter, 'all');
  assert.equal(doc.getElementById('q'), box, 'input replaced on first letter');
  assert.equal(doc.activeElement, box, 'focus lost on first letter');
  assert.match(main(), /SHOP\[گ\]/);

  type(box, 'گیس');
  assert.equal(doc.getElementById('q'), box);
  assert.equal(doc.activeElement, box);
  assert.equal(box.value, 'گیس');
  assert.equal(box.selectionStart, 3);
  assert.match(main(), /SHOP\[گیس\]/);
});

test('editing in the middle keeps the caret where it is', () => {
  const { doc, state, env, type } = makeEnv();
  state.route = 'shop';
  env.render();
  const box = doc.getElementById('q');
  box.focus();
  type(box, 'گیسو');
  box.value = 'گسو';
  box.selectionStart = box.selectionEnd = 1;
  doc.listeners.input.forEach((fn) => fn({ target: box }));
  assert.equal(doc.getElementById('q'), box);
  assert.equal(box.selectionStart, 1);
  assert.equal(box.selectionEnd, 1);
});

test('IME composition: no render until compositionend', () => {
  const { doc, state, env, main, fire } = makeEnv();
  state.route = 'shop';
  env.render();
  const box = doc.getElementById('q');
  box.focus();

  box.value = 'سل';
  fire('input', box, { isComposing: true });
  assert.equal(state.query, '');
  assert.match(main(), /SHOP\[\]/);

  box.value = 'سلام';
  fire('compositionend', box);
  assert.equal(state.query, 'سلام');
  assert.match(main(), /SHOP\[سلام\]/);
  assert.equal(doc.getElementById('q'), box);
  assert.equal(doc.activeElement, box);
});

test('clearing the search empties the kept input', () => {
  const { doc, state, env, type } = makeEnv();
  state.route = 'shop';
  env.render();
  const box = doc.getElementById('q');
  type(box, 'شمع');
  state.query = ''; // ACTIONS['clear-search']
  env.render();
  assert.equal(doc.getElementById('q'), box);
  assert.equal(box.value, '');
});

test('if the header itself changes, focus and caret are restored on the new input', () => {
  const { doc, state, env, type } = makeEnv();
  state.route = 'shop';
  env.render();
  const box = doc.getElementById('q');
  box.focus();
  type(box, 'لامپ');
  box.setSelectionRange(2, 3);

  state.cartCount = 1; // cart badge changes the header markup
  env.render();
  const fresh = doc.getElementById('q');
  assert.notEqual(fresh, box);
  assert.equal(fresh.value, 'لامپ');
  assert.equal(doc.activeElement, fresh);
  assert.equal(fresh.selectionStart, 2);
  assert.equal(fresh.selectionEnd, 3);
});

test('the search input value is not baked into header markup', () => {
  assert.doesNotMatch(src, /id="q"[^>]*value=/);
});
