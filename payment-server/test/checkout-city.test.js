// Checkout, city = شهرستان, typing «مشهد» in «نام شهر» (cursor still there):
// the «نام شهر را وارد کنید.» error must go as soon as the field has a value,
// and the courier options, the «ارسال» row and the note under the total must
// switch to تیپاکس while typing — without re-rendering the form. Runs the
// real app.js input handler and summary helpers against a small fake page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const appJs = read('../../app.js');
const dataJs = read('../../data.js');
const grab = (src, re) => {
  const m = src.match(re);
  assert.ok(m, 'not found: ' + re);
  return m[0];
};
const fnSrc = (name) => grab(appJs, new RegExp(`function ${name}\\([\\s\\S]*?\\n}\\n`));
const handlerSrc = grab(appJs, /document\.addEventListener\('input', \(e\) => \{\n  if \(e\.target\.id !== 'city' \|\| state\.route !== 'checkout'\) return;[\s\S]*?\n\}\);\n/);

const HINT_PEYK = 'هزینه‌ی پیک تهران جداگانه هنگام تحویل پرداخت می‌شود.';
const HINT_TIPAX = 'هزینه‌ی تیپاکس جداگانه هنگام تحویل پرداخت می‌شود.';

/** The checkout as it stands after choosing «شهرستان»: city empty, error shown. */
function checkout() {
  const state = {
    route: 'checkout',
    cart: { 'gisoo::h140::sembroidered': 1 },
    appliedCode: null,
    ship: 'peyk',
    form: { name: '', phone: '', city: '', cityChoice: 'other', address: '', postcode: '', note: '' },
    formErrors: { city: 'نام شهر را وارد کنید.' },
  };
  const page = {
    'ship-options': [{ innerHTML: '' }],
    'ship-row': [{ innerHTML: '' }],
    'ship-hint': [{ innerHTML: '' }],
    fees: [{ innerHTML: '' }],
    total: [{ textContent: '' }, { textContent: '' }],
  };
  const errorSpan = { removed: false, remove() { this.removed = true; } };
  const field = { querySelector: (sel) => (sel === '.field-error' && !errorSpan.removed ? errorSpan : null) };
  const cityInput = { id: 'city', value: '', closest: (sel) => (sel === '.field' ? field : null) };
  const listeners = [];
  let renders = 0;
  const code = [
    grab(appJs, /\/\/ ---- City fees \(shared rule\) -+\n[\s\S]*?\/\/ ---- end of city fees -+\n/),
    grab(dataJs, /const SHIPPING = \[[\s\S]*?\];\n/),
    grab(appJs, /const FIELD_VALIDATORS = \{[\s\S]*?\n\};\n/),
    grab(appJs, /const money = [^\n]*\n/),
    ...['normalizePersianText', 'shippingMethodForCity', 'syncShippingToCity', 'totals', 'feeRowsHtml', 'shipOptionsHtml', 'shipRowHtml', 'shipHintHtml', 'refreshSummaryTotals'].map(fnSrc),
    handlerSrc,
    'return { totals };',
  ].join('\n');
  const api = new Function(
    'state', 'document', '$$', 'render', 'cartLineData', 'DISCOUNT_CODES', 'FREE_SHIP_OVER', 'FA', 'esc',
    code
  )(
    state,
    { addEventListener: (type, fn) => listeners.push({ type, fn }) },
    (sel) => page[sel.match(/data-sum="([^"]+)"/)?.[1]] || [],
    () => renders++,
    () => ({ price: 15450000 }),
    {},
    3000000,
    (s) => String(s).replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]),
    (s) => String(s)
  );
  const type = (value) => {
    cityInput.value = value;
    listeners.filter((l) => l.type === 'input').forEach((l) => l.fn({ target: cityInput }));
  };
  const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const option = (id) => {
    const m = page['ship-options'][0].innerHTML.match(new RegExp(`<button class="option" data-act="ship" data-id="${id}"[^>]*>[\\s\\S]*?</button>`));
    return { checked: /aria-checked="true"/.test(m[0]), disabled: / disabled>/.test(m[0]), text: text(m[0]) };
  };
  return { state, page, errorSpan, type, text, option, renders: () => renders, api };
}

test('typing a city clears «نام شهر را وارد کنید.» at the first letter', () => {
  const c = checkout();
  c.type('م');
  assert.equal(c.state.formErrors.city, '');
  assert.equal(c.errorSpan.removed, true);
  c.type('مشهد');
  assert.equal(c.state.form.city, 'مشهد');
  assert.equal(c.renders(), 0, 'the form was re-rendered');
});

test('emptying the field does not bring the error back while typing; leaving it empty does', () => {
  const c = checkout();
  c.type('مشهد');
  c.type('');
  assert.equal(c.state.formErrors.city, ''); // not while the cursor is in the field
  // on leaving, the focusout handler runs validateCheckoutField('city') as before:
  const validate = new Function(
    'state',
    `${grab(appJs, /const FIELD_VALIDATORS = \{[\s\S]*?\n\};\n/)}${fnSrc('validateCheckoutField')} return validateCheckoutField;`
  )(c.state);
  validate('city');
  assert.equal(c.state.formErrors.city, 'نام شهر را وارد کنید.');
  assert.match(grab(appJs, /document\.addEventListener\('focusout'[\s\S]*?\n\}\);\n/), /validateCheckoutField\(id\);/);
});

test('typing a city outside Tehran switches courier, «ارسال» row and the note to تیپاکس — and adds the fee', () => {
  const c = checkout();
  c.type('مشهد');
  assert.equal(c.state.ship, 'tipax');
  assert.deepEqual(c.option('tipax'), { checked: true, disabled: false, text: 'تیپاکس پس‌کرایه — هزینه را هنگام تحویل می‌پردازید پس‌کرایه' });
  assert.deepEqual(c.option('peyk'), { checked: false, disabled: true, text: 'پیک تهران پس‌کرایه — هزینه را هنگام تحویل می‌پردازید — فقط برای تهران پس‌کرایه' });
  assert.equal(c.text(c.page['ship-row'][0].innerHTML), 'ارسال پس‌کرایه');
  assert.equal(c.text(c.page['ship-hint'][0].innerHTML), HINT_TIPAX);
  assert.equal(c.text(c.page.fees[0].innerHTML), 'هزینه بسته‌بندی ۲۵۰٬۰۰۰ تومان');
  assert.deepEqual(c.page.total.map((n) => n.textContent), ['۱۵٬۷۰۰٬۰۰۰ تومان', '۱۵٬۷۰۰٬۰۰۰ تومان']);
  assert.equal(c.renders(), 0);
});

test('switching back to تهران switches them back: پیک, its note, no fee', () => {
  const c = checkout();
  c.type('مشهد');
  c.type('تهران');
  assert.equal(c.state.ship, 'peyk');
  assert.equal(c.option('peyk').checked, true);
  assert.equal(c.option('tipax').disabled, true);
  assert.equal(c.text(c.page['ship-hint'][0].innerHTML), HINT_PEYK);
  assert.equal(c.page.fees[0].innerHTML, '');
  assert.deepEqual(c.page.total.map((n) => n.textContent), ['۱۵٬۴۵۰٬۰۰۰ تومان', '۱۵٬۴۵۰٬۰۰۰ تومان']);
});

test('an emptied city keeps the last courier and shows «روش ارسال بر اساس شهری…»', () => {
  const c = checkout();
  c.type('مشهد');
  c.type('');
  assert.equal(c.state.ship, 'tipax'); // unchanged until a city is known again
  assert.match(c.page['ship-options'][0].innerHTML, /روش ارسال بر اساس شهری که انتخاب می‌کنید تعیین می‌شود\./);
  assert.equal(c.page.fees[0].innerHTML, ''); // no city, no fee
});

test('the handler never re-renders, and the checkout carries all the hooks it updates', () => {
  assert.doesNotMatch(handlerSrc.replace(/\/\/[^\n]*/g, ''), /render\(\)/);
  const screen = fnSrc('screenCheckout');
  for (const hook of ['ship-options', 'ship-row', 'ship-hint', 'fees']) assert.match(screen, new RegExp(`data-sum="${hook}"`), hook);
});

test('«پرداخت آنلاین»: state.ship follows the typed city — kept in step while typing, and placeOrder re-syncs it', () => {
  const c = checkout();
  c.type('اصفهان');
  assert.equal(c.state.ship, 'tipax');
  // placeOrder() starts with syncForm(), which reads #city and calls syncShippingToCity()
  assert.match(fnSrc('placeOrder'), /if \(state\.placingOrder\) return;\n  syncForm\(\);/);
  assert.match(fnSrc('syncForm'), /if \(cityChoiceEl\) state\.form\.cityChoice = cityChoiceEl\.value;\n    syncShippingToCity\(\);/);
  // (the servers derive the courier from the city anyway: shippingMethodForCity)
});
