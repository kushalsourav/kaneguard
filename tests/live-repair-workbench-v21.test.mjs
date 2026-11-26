import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { liveTaskPhase, pendingCheckPhase } from '../public/control/live-task-state.mjs';
import { renderCheckJourney, renderAllVerificationJourneys } from '../public/control/verification-history.mjs';

const gate = 'After task-2: Implement interactive task management';
const fail = {flowId:'feature-task-lifecycle',flowName:'Task creation and metrics',gate,taskId:'task-2',verdict:'failed',
  summary:'Submit reloaded the page without adding a task, and the counters did not update',
  stdoutFile:'kane-failure.ndjson',finishedAt:'2026-11-17T10:45:30Z'};
const task = {id:'task-2',title:'Implement task management',status:'repairing'};
const base = ()=>({id:'20261117102650-qh681',status:'running',stage:'diagnosing',activeGate:gate,
  tasks:[task], milestones:[{taskId:'task-2',status:'verifying'}],
  failure:{flowId:fail.flowId,summary:fail.summary},
  verification:[fail], plans:[],repairs:[],currentFlow:null,currentFlowId:null,timeline:[]});
const link = file => `/api/evidence/20261117102650-qh681/${file}`;

test('TaskFlow diagnosis is visibly in progress without hiding the original Kane failure',()=>{
  const run=base();
  assert.equal(liveTaskPhase(run,task)?.label,'Agent investigating Kane failure');
  assert.equal(pendingCheckPhase(run,run.verification)?.key,'diagnosing');
  const html=renderCheckJourney(run,run.verification,link);
  assert.match(html,/Kane FAIL · Attempt 1/);
  assert.match(html,/Submit reloaded the page/);
  assert.match(html,/Agent diagnosis in progress/);
  assert.match(html,/Kane FAIL · Agent diagnosis in progress/);
  assert.match(html,/kane-failure\.ndjson/);
  assert.doesNotMatch(html,/Kane PASS/);
  assert.doesNotMatch(html,/<li[\s>]/, 'no unexplained empty numbered list items');
  assert.match(html,/role="listitem"/);
});

test('during Antigravity coding repair, task and check show live repair (not stale Kane testing)',()=>{
  const run=base();run.stage='repairing';
  run.plans=[{attempt:1,gate,plan:{action:'repair',diagnosis:'Missing form submit handler and toggle listeners'},stdoutFile:'diagnosis.ndjson',planFile:'diagnosis.json'}];
  assert.equal(liveTaskPhase(run,task)?.label,'Agent coding repair');
  const html=renderAllVerificationJourneys(run,link);
  assert.match(html,/Kane FAIL · Attempt 1/);
  assert.match(html,/Missing form submit handler/);
  assert.match(html,/Agent coding repair now/);
  assert.match(html,/kane-failure\.ndjson/);
  assert.match(html,/diagnosis\.ndjson/);
  assert.doesNotMatch(html,/Kane PASS/);
});

test('retest remains pending until a genuine Kane browser result is saved; final PASS retains all history',()=>{
  const run=base();run.stage='reverifying';run.currentFlowId=fail.flowId;
  run.plans=[{attempt:1,gate,plan:{action:'repair',diagnosis:'Add missing handlers'},stdoutFile:'diagnosis.ndjson'}];
  run.repairs=[{attempt:1,gate,changedFiles:['public/app-demo/app.js'],outFile:'repair.ndjson'}];
  let html=renderCheckJourney(run,run.verification,link);
  assert.match(html,/Kane retest in progress/);
  assert.doesNotMatch(html,/Kane PASS/);
  run.verification.push({...fail,verdict:'passed',summary:'Task creation and status metrics now update',stdoutFile:'kane-pass.ndjson'});
  run.status='passed';run.stage='finished';
  html=renderCheckJourney(run,run.verification,link);
  for(const fragment of ['Kane FAIL · Attempt 1','Agent diagnosis #1','Agent repair #1','Kane PASS · Attempt 2','kane-pass.ndjson'])
    assert.ok(html.includes(fragment),`lost saved evidence: ${fragment}`);
  assert.doesNotMatch(html,/Agent coding repair now|Kane retest in progress/);
});

test('other task and a completed run do not inherit a pending repair',()=>{
  const run=base();run.stage='repairing';
  assert.equal(liveTaskPhase(run,{id:'task-1',status:'verified'}),null);
  assert.equal(pendingCheckPhase({...run,activeGate:'Other gate'},run.verification),null);
  run.status='verification_inconclusive';
  assert.equal(liveTaskPhase(run,task),null);
  assert.equal(pendingCheckPhase(run,run.verification),null);
});

test('repair-start is saved before agent execution, and streaming log events trigger throttled UI refresh',async()=>{
  const [engine,ui,css]=await Promise.all([
    readFile(new URL('../engine/feature.mjs',import.meta.url),'utf8'),
    readFile(new URL('../public/control/studio.mjs',import.meta.url),'utf8'),
    readFile(new URL('../public/assets/create-studio.css',import.meta.url),'utf8')]);
  const start=engine.indexOf("await log('repair_start'");
  const invocation=engine.indexOf('try { repair = await runAgent',start);
  assert.ok(start>=0 && invocation>start,'persist the repair stage before starting long-running coding');
  assert.match(ui,/const live=liveTaskPhase\(run,task\)/);
  assert.match(ui,/const state=live\?\.label/);
  assert.match(ui,/scheduleStreamRefresh\(id\)/);
  assert.match(ui,/setTimeout\(async\(\)=>/);
  assert.match(ui,/\/api\/runs\/\$\{encodeURIComponent\(id\)\}/);
  assert.doesNotMatch(ui,/renderCheckJourney\(/, 'sidebar no longer repeats Kane evidence; it lives in the Live loop');
  assert.match(css,/\.task-live-repairing/);
  assert.match(css,/\.journey-event\.pending/);
});
