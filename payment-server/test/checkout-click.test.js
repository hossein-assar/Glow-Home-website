// «پرداخت آنلاین» needed two clicks. Leaving a checkout field by pressing the
// button blurred the field, and its focusout re-render replaced the button
// between press and release, so the first click never fired. app.js now
// defers re-renders while a press is in progress (until just after its
// click), ignores the focusout Chrome fires when render() itself removes a
// focused field, and placeOrder() returns at once while an order is being
// placed. Runs the real app.js code, pulled out of the source text, against
// a small fake document. (Checked end to end in headless Chrome as well.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../../app.js', import.meta.url), 'utf8');
const grab = (re) => {
  const m = src.match(re);
  assert.ok(m, 'not found in app.js: ' + re);
  return m[0];
};
const pressSrc = grab(/const PRESS_FALLBACK_MS = [\s\S]*?document\.addEventListener\('pointercancel', endPress, true\);\n/);
const focusoutSrc = grab(/document\.addEventListener\('focusout', \(e\) => \{[\s\S]*?\n\}\);\n/);
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

/** The press logic + focusout handler with a fake document. */
function env({ fallbackMs = 1000 } = {}) {
  const listeners = {};
  const calls = [];
  const fields = {};
  const document = {
    activeElement: null,
    addEventListener: (type, fn, capture) => (listeners[type] ||= []).push({ fn, capture: !!capture }),
    getElementById: (id) => fields[id] || null,
  };
  const state = { route: 'checkout', form: { name: '', phone: '', city: '', address: '', postcode: '' } };
  const ctl = { rendering: false };
  const fire = (type, target = {}) => (listeners[type] || []).forEach((l) => l.fn({ target, type }));
  new Function(
    'document', 'state', 'render', 'syncForm', 'validateCheckoutField', 'syncShippingToCity', 'ctl',
    `${pressSrc.replace('const PRESS_FALLBACK_MS = 1000;', `const PRESS_FALLBACK_MS = ${fallbackMs};`)}
     ${focusoutSrc.replace('if (rendering) return;', 'if (ctl.rendering) return;')}`
  )(
    document, state,
    () => calls.push('render'), () => calls.push('syncForm'),
    (id) => calls.push('validate:' + id), () => calls.push('syncShipping'), ctl
  );
  return { listeners, calls, fire, document, state, fields, ctl };
}

const leave = (id, value) => ({ id, value, isConnected: true });

test('without a press, leaving a field re-renders at once (keyboard / tab, as before)', () => {
  const e = env();
  e.fire('focusout', leave('address', 'خیابان ولیعصر، کوچه ۱۲'));
  assert.deepEqual(e.calls, ['validate:address', 'render']);
  assert.equal(e.state.form.address, 'خیابان ولیعصر، کوچه ۱۲');
});

test('pressing the pay button: the field\'s re-render waits until just after the click', async () => {
  const e = env();
  e.fire('pointerdown', { id: '' });
  e.fire('focusout', leave('address', 'خیابان ولیعصر، کوچه ۱۲')); // the press blurs the field
  assert.deepEqual(e.calls, ['validate:address']); // validated and stored, NOT re-rendered
  assert.equal(e.state.form.address, 'خیابان ولیعصر، کوچه ۱۲');
  e.fire('click', { id: '' }); // capture listener; the action runs on the same, untouched button
  assert.ok(!e.calls.includes('render'));
  await tick();
  assert.deepEqual(e.calls, ['validate:address', 'syncForm', 'render']);
});

test('a press that never becomes a click still renders after the fallback delay', async () => {
  const e = env({ fallbackMs: 20 });
  e.fire('pointerdown', {});
  e.fire('focusout', leave('phone', '912 123 4567'));
  assert.equal(e.state.form.phone, '9121234567');
  await tick(40);
  assert.deepEqual(e.calls, ['validate:phone', 'syncForm', 'render']);
});

test('a cancelled touch renders right away', () => {
  const e = env();
  e.fire('pointerdown', {});
  e.fire('focusout', leave('name', 'سارا'));
  e.fire('pointercancel', {});
  assert.deepEqual(e.calls, ['validate:name', 'syncForm', 'render']);
});

test('a press with nothing pending renders nothing extra', async () => {
  const e = env();
  e.fire('pointerdown', {});
  e.fire('click', {});
  await tick();
  assert.deepEqual(e.calls, []);
});

test('the deferred render puts focus and caret back on the field the press moved to', async () => {
  const e = env();
  const focusCalls = [];
  const oldPostcode = { id: 'postcode', selectionStart: 3, selectionEnd: 3 };
  const newPostcode = {
    id: 'postcode',
    focus() { focusCalls.push('focus'); e.document.activeElement = newPostcode; },
    setSelectionRange(a, b) { focusCalls.push(`caret ${a}-${b}`); },
  };
  e.fire('pointerdown', {});
  e.fire('focusout', leave('address', 'x'));
  e.document.activeElement = oldPostcode; // the press focused «کد پستی»
  e.fields.postcode = newPostcode; // what render() puts in its place
  e.fire('click', oldPostcode);
  await tick();
  assert.deepEqual(focusCalls, ['focus', 'caret 3-3']);
});

test('focusout fired while render() replaces the page is ignored (no second render)', () => {
  const e = env();
  e.ctl.rendering = true;
  e.fire('focusout', leave('postcode', '1234567890'));
  assert.deepEqual(e.calls, []);
  assert.equal(e.state.form.postcode, '');
  // render() sets the flag around exactly the DOM swap
  const render = grab(/function render\(\) \{[\s\S]*?\n}\n/);
  assert.match(render, /rendering = true;\n  try \{[\s\S]*app\.innerHTML = chrome \+ rest;[\s\S]*\} finally \{\n    rendering = false;\n  \}/);
});

test('the focusout handler uses renderWhenIdle, never a direct render()', () => {
  const code = focusoutSrc.replace(/\/\/[^\n]*/g, ''); // comments may say "render()"
  assert.match(code, /renderWhenIdle\(\);/);
  assert.doesNotMatch(code.replace(/renderWhenIdle\(\)/g, ''), /render\(\)/);
});

// ---- placeOrder: busy at once, never twice ----------------------------------------

function placeOrderEnv() {
  const calls = [];
  const state = {
    placingOrder: false,
    form: { name: 'سارا', phone: '9121234567', city: 'تهران', address: 'خیابان ولیعصر، کوچه ۱۲، پلاک ۳', postcode: '', note: '' },
    formErrors: {},
    error: '',
    ship: 'peyk',
    appliedCode: null,
  };
  const placeOrder = new Function(
    'state', 'syncForm', 'totals', 'render', 'isOnlinePayment', 'startOnlinePayment', 'fetch', '$',
    `const FIELD_VALIDATORS = {}; const validateCheckoutField = () => {}; const normalizePostcode = (x) => x;
     ${grab(/function placeOrder\(\) \{[\s\S]*?\n}\n/)} return placeOrder;`
  )(
    state,
    () => calls.push('syncForm'),
    () => ({ rows: [{ cartKey: 'gisoo::h140::sembroidered', qty: 1 }], total: 15450000 }),
    () => calls.push('render busy=' + state.placingOrder),
    () => true,
    () => calls.push('startOnlinePayment'),
    () => { calls.push('fetch'); return new Promise(() => {}); },
    () => null
  );
  return { placeOrder, calls, state };
}

test('the first click shows the busy state before the request starts', () => {
  const { placeOrder, calls, state } = placeOrderEnv();
  placeOrder();
  assert.deepEqual(calls, ['syncForm', 'render busy=true', 'startOnlinePayment']);
  assert.equal(state.placingOrder, true);
});

test('a second click while busy does nothing at all — no second order', () => {
  const { placeOrder, calls } = placeOrderEnv();
  placeOrder();
  placeOrder();
  placeOrder();
  assert.equal(calls.filter((c) => c === 'startOnlinePayment').length, 1);
  assert.equal(calls.filter((c) => c === 'syncForm').length, 1); // returns before reading the form
});

test('both pay buttons are disabled with a busy label while busy', () => {
  const checkout = grab(/function screenCheckout\(\) \{[\s\S]*?\n}\n/);
  assert.equal((checkout.match(/data-act="place-order" \$\{\s*state\.placingOrder \? 'disabled' : ''\s*\}/g) || []).length, 2);
  assert.match(checkout, /state\.placingOrder \? 'در حال انتقال به درگاه…' : 'پرداخت آنلاین'/);
  assert.match(checkout, /state\.placingOrder \? 'در حال انتقال…' : 'پرداخت آنلاین'/);
});
