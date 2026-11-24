import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
const read=(file)=>readFile(path.resolve(import.meta.dirname,'..',file),'utf8');

test('studio fits one viewport with independent internal scroll areas',async()=>{
  const [html,css]=await Promise.all([read('public/control/index.html'),read('public/assets/create-studio.css')]);
  assert.match(css,/html,body\{[^}]*height:100dvh;overflow:hidden/);
  assert.match(css,/\.site-shell\{[^}]*height:100dvh;[^}]*overflow:hidden/);
  assert.match(css,/\.studio-layout\{[^}]*flex:1;min-height:0;[^}]*overflow:hidden/);
  assert.match(css,/\.sidebar-scroll\{[^}]*overflow-y:auto/);
  assert.match(css,/\.workbench-panel\{[^}]*overflow-y:auto/);
  assert.match(css,/\.preview-viewport\{[^}]*flex:1;min-height:0/);
  assert.match(css,/@media\(max-width:700px\)/);
  assert.match(html,/class="studio-layout"/);
  assert.match(html,/class="sidebar"/);
  assert.match(html,/class="preview-panel"/);
  assert.doesNotMatch(html,/id="site-footer"|id="themeToggle"|id="publishButton"|id="saveEditor"/);
});

test('build remains interactive: four real agent choices, live task, Kane and log panels and preview link',async()=>{
  const [html,js]=await Promise.all([read('public/control/index.html'),read('public/control/studio.mjs')]);
  for(const agent of ['cursor','antigravity','claude','codex']) assert.match(html,new RegExp(`name="agent" value="${agent}"`));
  assert.doesNotMatch(html,/id="verificationPanel"/);
  for(const panel of ['activityPanel','logsPanel']) assert.match(html,new RegExp(`id="${panel}"`));
  for(const id of ['createForm','createPrompt','createButton','openPreview','reloadPreview','previewFrame','previewEmpty','taskCards','logLines','resumeButton','evidencePlan','evidenceDiff','evidenceRequest','openLog']) assert.match(html,new RegExp(`id="${id}"`));
  const allIds=new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m)=>m[1]));
  for(const match of js.matchAll(/\$\('([^']+)'\)/g))assert.ok(allIds.has(match[1]),`missing UI element ${match[1]}`);
  assert.match(js,/function selectPanel/);
  assert.match(js,/setPreviewEmpty/);
  assert.match(js,/new EventSource/);
  assert.match(js,/\/api\/projects/);
  assert.match(js,/\/api\/agents/);
  assert.match(js,/knownCompletedAt/);
  assert.match(js,/source-version/);
  assert.match(js,/function renderTaskRows/);
});
