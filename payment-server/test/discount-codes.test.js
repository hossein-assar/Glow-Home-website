// Discount codes are off for now (GLOW10 / HANDMADE15 retired): DISCOUNT_CODES
// is empty in all three copies, so any code a customer types is rejected and
// the total is unchanged — in the browser, in api/orders.js (card-to-card)
// and in payment-server (ZarinPal). The server derives the discount from the
// code only; the browser never sends a total.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { DISCOUNT_CODES, priceCart } from '../src/pricing.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const CODES = ['GLOW10', 'HANDMADE15', 'glow10', 'NOPE', 'constructor', '__proto__', 'toString', ''];

const product = { id: 'p1', slug: 'lamp-a', name_fa: 'آباژور الف', price: 1000000, variants: [], colors: [], in_stock: true };

test('no discount codes are defined anywhere', () => {
  assert.deepEqual(DISCOUNT_CODES, {});
  assert.match(read('../../data.js'), /\nconst DISCOUNT_CODES = \{\};/);
  assert.match(read('../../api/orders.js'), /\nconst DISCOUNT_CODES = \{\};/);
  assert.doesNotMatch(read('../../app.js'), /GLOW10|HANDMADE15/);
});

test('payment-server: with no codes defined, any code is rejected and the total is unchanged', () => {
  const plain = priceCart({ items: [{ cartKey: 'lamp-a', qty: 2 }], products: [product], discountCode: null, city: 'تهران' });
  assert.equal(plain.total, 2000000);
  for (const code of CODES) {
    const r = priceCart({ items: [{ cartKey: 'lamp-a', qty: 2 }], products: [product], discountCode: code, city: 'تهران' });
    assert.equal(r.discount, 0, code);
    assert.equal(r.discountCode, null, code);
    assert.equal(r.total, plain.total, code);
  }
});

/** api/orders.js run end to end against a fake Supabase client. */
async function postOrder(discount_code) {
  const inserted = {};
  const sb = {
    from(table) {
      return {
        select: () => ({ in: async () => ({ data: [product], error: null }) }),
        insert(row) {
          inserted[table] = row;
          return table === 'orders'
            ? { select: () => ({ single: async () => ({ data: { id: 1, ...row }, error: null }) }) }
            : Promise.resolve({ error: null });
        },
      };
    },
    rpc: async () => ({ data: 1000, error: null }),
  };
  const mod = { exports: {} };
  const stubRequire = (id) => {
    if (id === '@supabase/supabase-js') return { createClient: () => sb };
    throw new Error('unexpected require ' + id);
  };
  new Function('require', 'module', 'exports', read('../../api/orders.js'))(stubRequire, mod, mod.exports);

  const saved = { ...process.env };
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';
  delete process.env.RESEND_API_KEY;
  let status, json;
  const res = { status(s) { status = s; return this; }, json(j) { json = j; return this; } };
  try {
    await mod.exports(
      {
        method: 'POST',
        body: {
          customer: { name: 'سارا', phone: '+989121234567', city: 'تهران', address: 'خیابان ولیعصر، کوچه ۱۲، پلاک ۳', postcode: '' },
          items: [{ cartKey: 'lamp-a', qty: 2, price: 1 }],
          discount_code,
          total: 1,
          discount: 999999,
        },
      },
      res
    );
  } finally {
    process.env = saved;
  }
  return { status, json, order: inserted.orders };
}

test('api/orders.js: with no codes defined, any code is rejected and the total is unchanged', async () => {
  for (const code of [...CODES, ['GLOW10'], { a: 1 }]) {
    const { status, json, order } = await postOrder(code);
    assert.equal(status, 200, String(code));
    assert.equal(json.discount, 0, String(code));
    assert.equal(json.total, 2000000, String(code));
    assert.equal(order.total, 2000000, String(code));
    assert.equal(order.discount_code, null, String(code));
  }
});

test('storefront: any code shows «این کد معتبر نیست.» and applies nothing', () => {
  const src = read('../../app.js');
  const action = src.match(/'apply-code': \(\) => \{[\s\S]*?\n  \},\n/)[0];
  const state = { code: '', appliedCode: null, codeMsg: '' };
  const apply = new Function(
    'state',
    `const DISCOUNT_CODES = {}; const syncForm = () => {}; const render = () => {}; const FA = String;
     return { ${action} }['apply-code'];`
  )(state);
  for (const code of CODES) {
    state.code = code;
    apply();
    assert.equal(state.appliedCode, null, code);
    assert.equal(state.codeMsg, 'این کد معتبر نیست.', code);
  }
});
