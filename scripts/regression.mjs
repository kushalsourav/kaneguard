#!/usr/bin/env node
/** Explicit, labeled demo regression helper. NEVER presents these as accidental bugs. */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from '../engine/common.mjs';

const cases = {
  cartlab: {
    file: 'public/cartlab/pricing.mjs',
    original: 'Math.round(subtotal * 0.1)',
    broken: 'Math.round(subtotal * 0.2)',
    explanation: 'An INTENTIONALLY SEEDED bug makes SAVE10 a 20% discount.'
  },
  coinpulse: {
    file: 'public/coinpulse/math.mjs',
    original: '(assetValue(asset, quantities) ?? 0)',
    broken: '(assetValue(asset, quantities) ?? 100)',
    explanation: 'An INTENTIONALLY SEEDED bug treats missing-price holdings as $100 instead of $0.'
  }
};
const [action, app] = process.argv.slice(2);
if (!['seed', 'restore'].includes(action) || !cases[app]) {
  console.error('Usage: node scripts/regression.mjs seed|restore cartlab|coinpulse');
  process.exit(2);
}
const spec = cases[app];
const file = path.join(ROOT, spec.file);
const source = await readFile(file, 'utf8');
const [from, to] = action === 'seed' ? [spec.original, spec.broken] : [spec.broken, spec.original];
if (!source.includes(from)) {
  console.error(`No change: required code fragment was not found in ${spec.file}. The source may already be modified.`);
  process.exit(1);
}
await writeFile(file, source.replace(from, to));
console.log(action === 'seed' ? `INTENTIONAL SEEDED REGRESSION in ${spec.file}: ${spec.explanation}` : `RESTORED reference implementation in ${spec.file}.`);
console.log('The browser acceptance objectives and Kane logs were not touched.');
