import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
const read=(name)=>readFile(path.resolve(import.meta.dirname,'..',name),'utf8');

test('new creation studio replaces old control dashboard with all four agent choices',async()=>{
  const [html,css,js]=await Promise.all([read('public/control/index.html'),read('public/assets/create-studio.css'),read('public/control/studio.mjs')]);
  for(const id of ['createForm','createPrompt','createButton','agentOptions','projectCards','runCards','workbenchView','previewFrame','taskCards','logLines','deleteRunButton']) assert.match(html,new RegExp(`id="${id}"`));
  for(const agent of ['cursor','antigravity','claude','codex']) assert.match(html,new RegExp(`name="agent" value="${agent}"`));
  assert.doesNotMatch(html,/What will you build|Your projects</); // v32.7: intro headers removed
  assert.match(html,/class="create-mode-toggle"/);assert.match(html,/class="projects-bar"/);
  assert.match(css,/\.agent-grid/);
  assert.match(css,/@media\(max-width:700px\)/);
  assert.match(js,/EventSource/);
  assert.match(js,/\/api\/projects/);
  assert.match(js,/\/api\/agents/);
  assert.doesNotMatch(html,/id="featureBuildForm"|id="buildApp"|id="historyRows"/);
});

test('new workbench shows source-backed Kane status and reloads preview on source change',async()=>{
  const js=await read('public/control/studio.mjs');
  assert.match(js,/Testing now/); // short sidebar status; full sentence ("Kane browser running") is the tooltip
  assert.match(await read('public/control/task-verification-state.mjs'),/Kane verified/);
  assert.match(js,/source-version/);
  assert.doesNotMatch(await read('public/control/index.html'),/id="verificationCards"/); // Kane detail lives in the Live loop now
  assert.match(js,/tc-checks/);
  assert.match(js,/knownCompletedAt/);
  assert.match(js,/sourceLink\(run/);
});
