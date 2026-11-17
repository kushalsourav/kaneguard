import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
const read=(name)=>readFile(path.resolve(import.meta.dirname,'..',name),'utf8');

test('new creation studio replaces old control dashboard with all four agent choices',async()=>{
  const [html,css,js]=await Promise.all([read('public/control/index.html'),read('public/assets/create-studio.css'),read('public/control/studio.mjs')]);
  for(const id of ['createForm','createPrompt','createButton','agentOptions','projectCards','runCards','workbenchView','previewFrame','taskCards','verificationCards','logLines']) assert.match(html,new RegExp(`id="${id}"`));
  for(const agent of ['cursor','antigravity','claude','codex']) assert.match(html,new RegExp(`name="agent" value="${agent}"`));
  assert.match(html,/What will you/);
  assert.match(css,/\.agent-grid/);
  assert.match(css,/@media\(max-width:700px\)/);
  assert.match(js,/EventSource/);
  assert.match(js,/\/api\/projects/);
  assert.match(js,/\/api\/agents/);
  assert.doesNotMatch(html,/id="featureBuildForm"|id="buildApp"|id="historyRows"/);
});

test('new workbench shows source-backed Kane status and reloads preview on source change',async()=>{
  const js=await read('public/control/studio.mjs');
  assert.match(js,/Kane browser running/);
  assert.match(js,/Kane verified/);
  assert.match(js,/source-version/);
  assert.match(js,/renderAllVerificationJourneys/);
  assert.match(js,/knownCompletedAt/);
  assert.match(js,/renderCheckJourney/);
  assert.match(js,/sourceLink\(run/);
});
