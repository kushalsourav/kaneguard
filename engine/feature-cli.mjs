#!/usr/bin/env node
import { buildFeature } from './feature.mjs';
const [appId, ...words] = process.argv.slice(2);
const prompt = words.join(' ') || process.env.KANEGUARD_FEATURE_REQUEST;
if (!appId || !prompt) {
  console.error('Usage: node engine/feature-cli.mjs cartlab "Add a wishlist page with add/remove and persistence"');
  process.exit(2);
}
try {
  const run = await buildFeature(appId, prompt);
  console.log(`\nFeature result: ${run.status.toUpperCase()} | ${run.id}\nEvidence: runs/${run.id}/`);
  if (run.status !== 'passed') process.exitCode = 1;
} catch (error) { console.error(`Feature build error: ${error.message}`); process.exitCode = 1; }
