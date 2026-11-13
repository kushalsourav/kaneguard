import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const read = (path) => readFile(resolve(root, path), 'utf8');

test('compact control center remains one-screen on desktop with scrollable data panes', async () => {
  const [markup, css, script] = await Promise.all([
    read('public/control/index.html'),
    read('public/assets/control-compact.css'),
    read('public/control/app.mjs')
  ]);
  assert.match(markup, /class="guard-body kg-compact"/);
  assert.match(markup, /\/assets\/control-compact\.css/);
  assert.match(css, /height:100vh/);
  assert.match(css, /grid-template-rows:62px 75px minmax\(0,1fr\) auto/);
  assert.match(css, /overflow:auto/);
  for (const id of ['totalRuns','passRuns','totalRepairs','engineStatus','historyRows','liveActivity','verificationResults','diffView','detailBadge']) {
    assert.match(markup, new RegExp(`id="${id}"`));
  }
  assert.match(script, /scrollOffsets/);
  assert.doesNotMatch(markup, /hero-seal|pipeline-flow|sidebar-note|kg-page-title|pipelineState|Verification overview/);
  assert.doesNotMatch(script, /pipelineState/);
});
