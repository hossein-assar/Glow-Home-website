// Fails if the hand-copied pricing rules in api/orders.js, data.js and
// payment-server/src/pricing.js drift apart. Reads the other two files as
// text (they're not ESM modules) and extracts the literals.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { DISCOUNT_CODES, FREE_SHIP_OVER, SHIPPING } from '../src/pricing.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const ordersJs = read('../../api/orders.js');
const dataJs = read('../../data.js');

function discountCodes(src) {
  const block = src.match(/const DISCOUNT_CODES = \{([^}]*)\}/);
  assert.ok(block, 'DISCOUNT_CODES not found');
  return Object.fromEntries([...block[1].matchAll(/([A-Z0-9_]+)\s*:\s*([0-9.]+)/g)].map((m) => [m[1], Number(m[2])]));
}
const freeShip = (src) => Number(src.match(/const FREE_SHIP_OVER = ([0-9_]+)/)[1]);
function shippingCosts(src) {
  return Object.fromEntries(
    [...src.matchAll(/(?:id:\s*'|\b)(peyk|tipax)'?[:,][^}]*?cost:\s*([0-9]+)[^}]*?payAtDoor:\s*(true|false)/g)].map((m) => [
      m[1],
      { cost: Number(m[2]), payAtDoor: m[3] === 'true' },
    ])
  );
}

const ours = Object.fromEntries(Object.entries(SHIPPING).map(([k, v]) => [k, { cost: v.cost, payAtDoor: v.payAtDoor }]));

test('discount codes match api/orders.js and data.js', () => {
  assert.deepEqual(discountCodes(ordersJs), DISCOUNT_CODES);
  assert.deepEqual(discountCodes(dataJs), DISCOUNT_CODES);
});

test('free-shipping threshold matches', () => {
  assert.equal(freeShip(ordersJs), FREE_SHIP_OVER);
  assert.equal(freeShip(dataJs), FREE_SHIP_OVER);
});

test('shipping costs / payAtDoor match', () => {
  assert.deepEqual(shippingCosts(ordersJs), ours);
  assert.deepEqual(shippingCosts(dataJs), ours);
});
