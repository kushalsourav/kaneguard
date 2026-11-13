import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const file = (path) => readFile(resolve(root, path), 'utf8');

test('control and CoinPulse use local UI theme and SVG icon module', async () => {
  const [control, coin, icons, theme] = await Promise.all([
    file('public/control/index.html'),
    file('public/coinpulse/index.html'),
    file('public/assets/icons.mjs'),
    file('public/assets/upgrade.css')
  ]);
  assert.match(control, /\/assets\/upgrade\.css/);
  assert.match(coin, /\/assets\/upgrade\.css/);
  assert.match(control, /data-icon="shield-check"/);
  assert.match(coin, /data-icon="chart-pie"/);
  assert.match(icons, /export function hydrateIcons/);
  assert.match(theme, /@media\(max-width:740px\)/);
});

test('UI update leaves CartLab markup untouched and preserves functional CoinPulse elements', async () => {
  const [cart, coin] = await Promise.all([file('public/cartlab/index.html'), file('public/coinpulse/index.html')]);
  assert.doesNotMatch(cart, /upgrade\.css/);
  for (const name of ['assetSearch', 'sortAssets', 'assetRows', 'resetHoldings', 'exportHoldings', 'portfolioTotal']) {
    assert.match(coin, new RegExp(`id="${name}"`));
  }
});
