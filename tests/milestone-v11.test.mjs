import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {orderedFeatureTasks, readyMilestoneChecks, verifiedTaskIds} from '../engine/milestones.mjs';
import {parseFeaturePlan, buildFeatureTaskHandoff, implementFeatureTask} from '../engine/feature-agent.mjs';
import {promptArtifacts} from '../public/control/artifacts.mjs';

const config = {id:'cartlab',label:'CartLab',url:'http://127.0.0.1:4173/cartlab/',maxRepairs:3,
  editablePaths:['public/cartlab/app.mjs','public/cartlab/index.html']};
const plan = {
  featureTitle:'Save favorites',
  summary:'Implement browser-persisted favorites with a list of saved products and a removal control.',
  tasks:[
    {id:'task-ui', title:'Add favorites navigation',detail:'Add a navigation link and a toggle button to each catalog item.',dependsOn:['task-storage'],acceptanceIds:['check-add']},
    {id:'task-storage',title:'Save favorites locally',detail:'Persist chosen product IDs in browser localStorage with error handling.',acceptanceIds:['check-add','check-remove']},
    {id:'task-view',title:'Create favorites list',detail:'Render saved items on a separate page with a remove control.',dependsOn:['task-ui'],acceptanceIds:['check-remove']}
  ],
  acceptance:[
    {id:'check-add',name:'Add a favorite',objective:'Navigate to CartLab, click the add-to-favorites control for Arc Wireless Headphones and open Favorites. Verify the item appears with the correct price on the favorites page.'},
    {id:'check-remove',name:'Remove a favorite',objective:'Navigate to CartLab, click Add to favorites on Arc Wireless Headphones, open the Favorites page, remove the item and reload. Verify the item is no longer present and the empty state is visible.'}
  ]
};
const success = (body) => ({code:0,spawnError:null,timedOut:false,stderr:'',durationMs:8,stdout:JSON.stringify({event:'result',result:{status:'SUCCESS',response:body}})+'\n'});

test('agent task dependencies determine implementation order instead of list order',()=>{
  const parsed = parseFeaturePlan(JSON.stringify(plan));
  assert.deepEqual(orderedFeatureTasks(parsed).map((task)=>task.id),['task-storage','task-ui','task-view']);
});

test('Kane check remains locked until every claiming task is implemented',()=>{
  assert.deepEqual(readyMilestoneChecks(plan,['task-storage']).map((check)=>check.id),[]);
  assert.deepEqual(readyMilestoneChecks(plan,['task-storage','task-ui']).map((check)=>check.id),['check-add']);
  assert.deepEqual(readyMilestoneChecks(plan,['task-storage','task-ui','task-view'],new Set(['check-add'])).map((check)=>check.id),['check-remove']);
});

test('an agent completion and syntax check cannot produce a verified task',()=>{
  assert.deepEqual(verifiedTaskIds(plan,new Set()),[]);
  assert.deepEqual(verifiedTaskIds(plan,new Set(['check-add'])),['task-ui']);
  assert.deepEqual(verifiedTaskIds(plan,new Set(['check-add','check-remove'])),['task-ui','task-storage','task-view']);
});

test('invalid dependencies, unknown prerequisites and cycles are rejected',()=>{
  const unknown={...plan,tasks:[{...plan.tasks[0],dependsOn:['task-not-real']},...plan.tasks.slice(1)]};
  assert.throws(()=>parseFeaturePlan(JSON.stringify(unknown)),/dependency/);
  const cycle={...plan,tasks:[plan.tasks[0],{...plan.tasks[1],dependsOn:['task-ui']},plan.tasks[2]]};
  assert.throws(()=>parseFeaturePlan(JSON.stringify(cycle)),/cycle/);
  assert.throws(()=>parseFeaturePlan(JSON.stringify({...plan,tasks:[{...plan.tasks[0],dependsOn:['task-ui']},...plan.tasks.slice(1)]})),/dependency/);
  assert.throws(()=>parseFeaturePlan(JSON.stringify({...plan,tasks:[{...plan.tasks[0],dependsOn:'task-storage'},...plan.tasks.slice(1)]})),/dependencies/);
});

test('single-task handoff preserves locked checks and does not author the next task',()=>{
  const task=orderedFeatureTasks(plan)[0];
  const prompt=buildFeatureTaskHandoff(config,'Add a saved favorites feature',plan,task,[]);
  assert.match(prompt,/CURRENT TASK task-storage/);
  assert.match(prompt,/Persist chosen product IDs/);
  assert.match(prompt,/Locked, relevant browser acceptance checks/);
  assert.match(prompt,/Implement THIS TASK only/);
  assert.doesNotMatch(prompt,/CURRENT TASK task-view/);
  assert.doesNotMatch(prompt,/--dangerously-skip-permissions/);
});

test('one task invokes Antigravity once, saves authentic CLI output and does not award a PASS',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'kg-v11-task-'));
  try {
    const invocations=[];
    const task=orderedFeatureTasks(plan)[0];
    const executed=await implementFeatureTask(config,'Build favorites',plan,task,[],dir,()=>{},
      {runner:async(bin,args,opts)=>{invocations.push({bin,args,opts});return success('Updated favorites storage helper.');}});
    assert.equal(invocations.length,1);
    assert.equal(invocations[0].bin,'agy');
    assert.ok(invocations[0].args.includes('--sandbox'));
    assert.ok(invocations[0].args.includes('0s'));
    assert.ok(invocations[0].opts.timeoutMs <= 60*60_000);
    assert.equal(executed.ok,true);
    assert.equal(executed.verdict,undefined);
    assert.match(await readFile(path.join(dir,executed.handoffFile),'utf8'),/task-storage/);
    assert.match(await readFile(path.join(dir,executed.outputFile),'utf8'),/Updated favorites storage helper/);
    const list=promptArtifacts({mode:'build',taskExecutions:[executed]});
    assert.ok(list.some((item)=>item.name===executed.handoffFile && /KaneGuard/.test(item.label)));
    assert.ok(list.some((item)=>item.name===executed.outputFile && /Antigravity/.test(item.label)));
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('timed out partial coding turn remains unverified and leaves distinct agent stderr evidence',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'kg-v11-timeout-'));
  try {
    const task=orderedFeatureTasks(plan)[0];
    const outcome=await implementFeatureTask(config,'Build favorites',plan,task,[],dir,()=>{},
      {runner:async()=>({code:1,spawnError:null,timedOut:true,stderr:'Timeout elapsed',stdout:'{"event":"init"}\n',durationMs:480000})});
    assert.equal(outcome.ok,false);
    assert.equal(outcome.recoverableTimeout,true);
    assert.equal(outcome.verdict,undefined);
    assert.match(await readFile(path.join(dir,outcome.stderrFile),'utf8'),/Timeout/);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('task-by-task orchestration and final protected suite are connected to real Kane calls',async()=>{
  const source=await readFile(new URL('../engine/feature.mjs',import.meta.url),'utf8');
  assert.match(source,/for \(const task of allOrderedTasks\)/);
  assert.match(source,/implementFeatureTask\(/);
  assert.match(source,/readyMilestoneChecks\(/);
  assert.match(source,/await runKane\(/);
  assert.match(source,/verifyGate\(\[\.\.\.protectedFeatureFlows,\.\.\.protectedRegressionFlows\]/);
  assert.match(source,/await planRepair\(/);
  assert.match(source,/await runAgent\(/);
});
