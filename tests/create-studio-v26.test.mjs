import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
const html=readFileSync(new URL('../public/control/index.html', import.meta.url),'utf8');
const css=readFileSync(new URL('../public/assets/create-studio.css', import.meta.url),'utf8');
const js=readFileSync(new URL('../public/control/studio.mjs', import.meta.url),'utf8');

test('Create and Connect forms have collapsed optional verification but unchanged stable control IDs',()=>{
  assert.match(html,/<details class="advanced-verification"><summary>Advanced verification/);
  assert.equal((html.match(/<details class="advanced-verification">/g)||[]).length,2);
  for(const id of ['examinerAgent','connectedExaminer','blindBuilder','connectedBlindBuilder','sabotage'])
    assert.match(html,new RegExp(`id="${id}"`));
  assert.match(css,/\.create-view\{[^}]*overflow-y:auto/);
  assert.match(css,/\.create-view \.sidebar-scroll\{[^}]*overflow:visible/);
  assert.match(css,/\.create-view \.composer-actions\{[^}]*position:sticky;bottom:0/);
  assert.match(css,/@media\(max-height:940px\)/);
  assert.match(css,/\.create-view \.idea-grid\{display:flex/);
});

test('Trust actions look like buttons and PASS progress is evidence-backed green',()=>{
  assert.match(css,/\.assurance-actions a\{display:inline-flex/);
  assert.match(js,/classList\.toggle\('is-passed',run\.status==='passed'\)/);
  assert.match(css,/\.mini-progress span\.is-passed\{background:var\(--success\)/);
});

test('Projects link to actual saved PASS, and shorten WSL home paths for display only',()=>{
  assert.doesNotMatch(html,/id="featuredRun"|id="watchJourney"/); // v32.11: no featured run; the user picks from the list
  assert.match(js,/setPreviewEmpty\('Pick a project'/);
  assert.match(js,/function friendlyProjectPath\(path\)/);
  assert.match(js,/escape\(friendlyProjectPath\(project\.projectDir\)\)/);
});

test('Engine indicator differentiates health failure from unrelated data-fetch failure',()=>{
  assert.match(js,/Promise\.allSettled/);
  assert.match(js,/healthResponded=true/);
  assert.match(js,/Engine online · data unavailable/);
  assert.match(js,/Engine offline/);
});

test('New optional-verification and receipt icons are bundled locally, not empty fallbacks',()=>{
  const icons=readFileSync(new URL('../public/assets/icons.mjs', import.meta.url),'utf8');
  for(const name of ['chevron-down','file-check-2','play-circle'])assert.ok(icons.includes(`'${name}':`));
});
