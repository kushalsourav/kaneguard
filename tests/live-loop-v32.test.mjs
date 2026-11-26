import test from 'node:test';
import assert from 'node:assert/strict';
import {kaneStepFromEvent,formatKaneStep,parseKaneTrace,agentActionFromEvent,diffStat} from '../engine/kane-trace.mjs';
import {compactEvent} from '../engine/live-logger.mjs';
import {renderTrustAtelier,liveFeeds} from '../public/control/trust-atelier.mjs';

test('Kane browser steps (no type field) become readable live lines; placeholders are skipped',()=>{
  assert.equal(kaneStepFromEvent({step:2,status:'running',remark:'Step 1'}),null);
  const s=kaneStepFromEvent({step:7,status:'done',remark:'press_key: PRIMARY: Activate the Iced tab with Enter'});
  assert.deepEqual([s.action,s.status,s.text],['press_key','done','Activate the Iced tab with Enter']);
  assert.equal(compactEvent({step:12,status:'failed',remark:'wait: Waiting after filter'}),'step 12 ✕ wait — Waiting after filter');
  assert.equal(formatKaneStep(s),'step 7 ✓ press_key — Activate the Iced tab with Enter');
});

test('Kane trace keeps the final state of each step and the run_end facts verbatim',()=>{
  const nd=[{type:'stream_start'},{step:2,status:'running',remark:'Step 1'},{step:2,status:'done',remark:'click: Click Iced'},
    {step:3,status:'failed',remark:'assert: Only iced drinks'},{type:'run_end',status:'failed',one_liner:'Filter did nothing',reason:'All stays selected',test_url:'https://test-manager.lambdatest.com/x'}].map(JSON.stringify).join('\n');
  const t=parseKaneTrace(nd);
  assert.equal(t.steps.length,2);assert.equal(t.steps[1].status,'failed');
  assert.equal(t.status,'failed');assert.equal(t.oneLiner,'Filter did nothing');assert.equal(t.reason,'All stays selected');
  assert.match(t.testUrl,/^https:/);
});

test('agent actions are extracted from Antigravity, Codex and Claude Code streams',()=>{
  assert.deepEqual(agentActionFromEvent({event:'step_update',step_update:{step_type:'tool',state:'ACTIVE',tool_name:'edit_file',tool_info:{parameters:{Path:'/a/b/app.js'}}}}),{kind:'edit',text:'app.js'});
  assert.deepEqual(agentActionFromEvent({type:'item.completed',item:{type:'file_change',changes:[{path:'/x/style.css'}]}}),{kind:'edit',text:'style.css'});
  assert.equal(agentActionFromEvent({type:'assistant',message:{content:[{type:'tool_use',name:'Bash',input:{command:'npm test'}}]}}).kind,'run');
  assert.equal(compactEvent({event:'step_update',step_update:{step_type:'agent_response',state:'DONE'}}),null);
});

test('diff stats count per-file changes',()=>{
  const d=diffStat('--- a/app.js\n+++ b/app.js\n@@ -1 +1,2 @@\n-old\n+new\n+more\n');
  assert.deepEqual(d.files,[{path:'app.js',added:2,removed:1}]);
});

const run=(o={})=>({id:'20261124-live1',featureTitle:'Shop',agentId:'codex',status:'running',stage:'verifying',
  tasks:[{id:'task-1',status:'candidate'}],generatedFlows:[{id:'one',name:'Filter'}],verification:[],repairs:[],...o});

test('live loop shows the active station and streamed Kane steps, and escapes them',()=>{
  const lines=['[2026-11-24T10:00:01.000Z] [r] [KANE] Starting Filter · browser timeout 120s',
    '[2026-11-24T10:00:02.000Z] [r] [KANE] step 2 ✓ click — <img src=x onerror=alert(1)>',
    '[2026-11-24T10:00:03.000Z] [r] [AGENT] ▸ edit app.js','[2026-11-24T10:00:04.000Z] [r] [BUILD task-1] ▸ run node --check app.js'];
  const f=liveFeeds(lines);assert.equal(f.kane.flow,'Filter');assert.equal(f.kane.steps.length,1);assert.equal(f.agent[0].kind,'edit');assert.equal(f.agent[1].kind,'run'); // task-suffixed source tags are parsed
  const html=renderTrustAtelier(run(),{lines});
  assert.match(html,/lp-st is-active[^"]*"[^>]*>\s*<span class="lp-ico"[^>]*>◉/);
  assert.match(html,/deciding the next browser action/);
  assert.doesNotMatch(html,/<img src=x/);
});

test('live loop never shows a fixed loop without a real later PASS',()=>{
  const failedOnly=run({status:'failed',stage:'finished',verification:[{flowId:'feature-one',flowName:'Filter',verdict:'failed',stdoutFile:'f.ndjson'}]});
  const html=renderTrustAtelier(failedOnly);
  assert.match(html,/>Caught</);assert.doesNotMatch(html,/Caught &amp; fixed|Caught & fixed/);
});

import {parseFeaturePlan} from '../engine/feature-agent.mjs';
test('planner accepts concrete chat-app objectives (log in / send) and explains vague ones',()=>{
  const plan=(o)=>JSON.stringify({featureTitle:'Chat',summary:'A chat app with login and one contact.',
    tasks:[{id:'task-1',title:'Login',detail:'Build the login screen form',acceptanceIds:['check-1']},{id:'task-2',title:'Chat',detail:'Build contact list and messaging',acceptanceIds:['check-2'],dependsOn:['task-1']}],
    acceptance:[{id:'check-1',name:'Login',objective:o},{id:'check-2',name:'Chat',objective:'Log in with the demo account, open the contact Alex, type Hello and send it; verify the message Hello appears in the conversation.'}]});
  assert.doesNotThrow(()=>parseFeaturePlan(plan('Log in with the demo credentials and confirm the chat list displays exactly one contact named Alex Rivera.')));
  assert.throws(()=>parseFeaturePlan(plan('Log in.')),/too short.*no observable assertion/);
});

test('saved runs keep the log panes, render identically each poll and never animate',()=>{
  const done=run({status:'passed',stage:'finished',verification:[{flowId:'feature-one',flowName:'Filter',verdict:'passed',stdoutFile:'p.ndjson'}]});
  const trace={kane:{'p.ndjson':{steps:[{step:2,status:'done',action:'click',text:'Click Iced'}],oneLiner:'ok'}},agent:{label:'Task task-1',actions:[{kind:'edit',text:'app.js'}]}};
  const a=renderTrustAtelier(done,{trace});
  assert.equal(a,renderTrustAtelier(done,{trace})); // identical output → the Studio skips the DOM update
  assert.match(a,/lp-panes/);assert.match(a,/Click Iced/);assert.match(a,/app\.js/);
  assert.doesNotMatch(a,/lp-live|journey/i);
});

import {buildFeaturePlanRequest,buildFeatureTaskHandoff} from '../engine/feature-agent.mjs';
test('connected apps may build their own API routes; new apps stay static HTML/CSS/JS',()=>{
  const connected={id:'app-abcde-12345',kind:'connected',framework:'Next.js',projectDir:'/home/u/notes',url:'http://127.0.0.1:5000/',editablePaths:[]};
  const playground={id:'app-abcde-12345',kind:'playground',url:'http://127.0.0.1:4173/app-abcde-12345/',editablePaths:[]};
  const pc=buildFeaturePlanRequest(connected,'Notes saved through /api/notes');
  assert.match(pc,/OWN routes \(same origin/);assert.match(pc,/do not substitute browser-only storage/);
  assert.doesNotMatch(pc,/must work offline/);
  assert.match(buildFeaturePlanRequest(playground,'A notes app'),/plain HTML\/CSS\/JS/);
  const plan={featureTitle:'Notes',summary:'s',acceptance:[{id:'check-1',name:'n',objective:'o'}]};
  const task={id:'task-1',title:'API',detail:'d',acceptanceIds:['check-1'],dependsOn:[]};
  const tc=buildFeatureTaskHandoff(connected,'r',plan,task);
  assert.match(tc,/route handlers \/ API routes/);assert.doesNotMatch(tc,/standalone HTML\/CSS\/JS app/);
  assert.match(buildFeatureTaskHandoff(playground,'r',plan,task),/standalone HTML\/CSS\/JS app/);
});
