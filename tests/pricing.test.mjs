import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateOrder, PRODUCTS } from '../public/cartlab/pricing.mjs';

test('CartLab product prices and fixtures match the browser objectives', () => {
  assert.deepEqual(Object.fromEntries(PRODUCTS.map((p) => [p.id, p.priceCents])), { arc: 7900, notes: 2400, cup: 1800, bag: 6400 });
  assert.deepEqual(calculateOrder({ arc: 1, notes: 1 }, 'SAVE10'), { subtotal: 10300, discount: 1030, shipping: 0, tax: 742, total: 10012, coupon: 'SAVE10' });
});
test('CartLab guest checkout and invalid coupon retain correct totals', () => {
  assert.equal(calculateOrder({ arc: 1 }).total, 9231);
  assert.equal(calculateOrder({ notes: 1 }, 'BADCODE').total, 3291);
  assert.equal(calculateOrder({ notes: 1 }, 'BADCODE').discount, 0);
});
test('CartLab safe quantity treatment', () => {
  assert.equal(calculateOrder({ arc: -1, notes: Infinity }).total, 0);
  assert.equal(calculateOrder({ arc: 2.99 }).subtotal, 15800);
  assert.equal(calculateOrder({ arc: 1 }, 'save10').total, 8378);
});
