import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { taskCheckState, taskVerificationState } from '../public/control/task-verification-state.mjs';

const first={id:'task-1',title:'Create storefront catalog layout',acceptanceIds:['catalog'],status:'candidate'};
const second={id:'task-2',title:'Add category filters',acceptanceIds:['catalog'],status:'implementing'};
const check={id:'catalog',name:'Product grid and category filtering'};
const base=()=>({status:'running',stage:'implementing',tasks:[{...first},{...second}],generatedFlows:[check],
 milestones:[{taskId:'task-1',status:'awaiting_dependencies'},{taskId:'task-2',status:'implementing'}],verification:[],currentFlowId:null});

test('Task 1 awaiting a shared check names its missing dependency, not a bogus Kane PASS',()=>{
 const run=base();
 assert.match(taskVerificationState(run,run.tasks[0]).label,/Waiting for Add category filters/);
 assert.match(taskCheckState(run,run.tasks[0],check).label,/Waiting for Add category filters/);
 assert.equal(taskVerificationState(run,run.tasks[0]).kind,'waiting');
});

test('Kane executing after Task 2 shows the shared browser check on BOTH tasks',()=>{
 const run=base();run.tasks[1].status='candidate';run.stage='verifying';run.currentFlowId='feature-catalog';
 run.milestones[1].status='verifying';
 for(const task of run.tasks){
   assert.equal(taskCheckState(run,task,check).kind,'running');
   assert.equal(taskVerificationState(run,task).label,'Kane testing shared check');
 }
 assert.equal(run.verification.length,0,'no fake PASS is synthesized');
});

test('Kane PASS is recorded only after real saved evidence; task verified uses engine status',()=>{
 const run=base();run.tasks[1].status='candidate';run.stage='implementing';
 assert.notEqual(taskVerificationState(run,run.tasks[0]).kind,'verified');
 run.verification.push({flowId:'feature-catalog',verdict:'passed',gate:'After task-2: Add category filters',stdoutFile:'real-kane.ndjson'});
 assert.equal(taskCheckState(run,run.tasks[0],check).label,'Kane passed');
 assert.equal(taskVerificationState(run,run.tasks[0]).label,'Kane PASS recorded · final gate pending');
 run.tasks[0].status='verified';
 assert.equal(taskVerificationState(run,run.tasks[0]).label,'Kane verified');
});

test('Kane FAIL during repair remains visible and is not counted as PASS',()=>{
 const run=base();run.tasks[1].status='candidate';run.stage='repairing';run.activeGate='After task-2: Add category filters';
 run.failure={flowId:'feature-catalog'};
 run.verification=[{flowId:'feature-catalog',verdict:'failed',stdoutFile:'failed-kane.ndjson'}];
 assert.equal(taskCheckState(run,run.tasks[0],check).label,'Kane FAIL · agent repairing');
 assert.equal(taskVerificationState(run,run.tasks[0]).kind,'failed');
});

test('workbench exposes accessible mouse, keyboard and max-panel controls with liquid CSS',async()=>{
 const root=new URL('../public/control/',import.meta.url);
 const [html,js,css]=await Promise.all([
  readFile(new URL('index.html',root),'utf8'),
  readFile(new URL('studio.mjs',root),'utf8'),
  readFile(new URL('../assets/create-studio.css',root),'utf8')]);
 for(const id of ['paneDivider','layoutDetails','layoutSplit','layoutPreview'])assert.match(html,new RegExp(`id="${id}"`));
 for(const x of ['role="separator"','aria-valuenow','tabindex="0"'])assert.ok(html.includes(x));
 for(const x of ['pointerdown','pointermove','pointerup','pointercancel','lostpointercapture','keydown','localStorage.setItem','setPaneMode'])assert.ok(js.includes(x));
 for(const x of ['layout-left-max','layout-preview-max','--studio-sidebar-width','grid-template-columns:repeat(auto-fit','@media(max-width:700px)'])assert.ok(css.includes(x));
 assert.match(js,/taskVerificationState\(run,task\)/);
 assert.match(js,/flowAttempts\(run,checkId\)/);
});
