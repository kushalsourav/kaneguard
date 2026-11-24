import test from 'node:test';
import assert from 'node:assert/strict';
import { ASSETS, fixtureAssets, parsePrice, assetValue, portfolioTotal, safeQuantity } from '../public/coinpulse/math.mjs';
test('CoinPulse baseline and quantity mutation', () => {
  assert.equal(portfolioTotal(ASSETS), 23374);
  assert.equal(portfolioTotal(ASSETS, { sol: 22 }), 24824);
  assert.equal(assetValue(ASSETS[2], { sol: 22 }), 3190);
});
test('CoinPulse missing and malformed prices are never treated as valid market prices', () => {
  assert.equal(parsePrice(null), null);
  assert.equal(parsePrice('not-a-number'), null);
  assert.equal(parsePrice(Infinity), null);
  assert.equal(parsePrice(-10), null);
  assert.equal(parsePrice(''), null);
  assert.equal(parsePrice('14'), 14);
  assert.equal(safeQuantity('nope'), 0);
  assert.equal(portfolioTotal(fixtureAssets('malformed')), 23290);
  assert.equal(assetValue(fixtureAssets('malformed').find((a) => a.id === 'link')), null);
});
