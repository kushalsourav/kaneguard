import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { validateBuildInput, buildFeaturePlanRequest, parseFeaturePlan, planFeature, implementFeature, buildFeatureExecutionHandoff } from '../engine/feature-agent.mjs';
import { featureEditableFiles } from '../engine/feature.mjs';
import { isPermittedSourceChange } from '../engine/snapshot.mjs';

const config = {id:'cartlab',label:'CartLab',url:'http://127.0.0.1:4173/cartlab/',editablePaths:['public/cartlab/app.mjs','public/cartlab/index.html'],maxRepairs:3};
const plan = {
  featureTitle:'CartLab Wishlists',summary:'Add an accessible wishlist page and persist selected product IDs in localStorage.',
  tasks:[
    {id:'task-1',title:'Add wishlist controls',detail:'Add accessible heart buttons for each product card and record selected product IDs.',acceptanceIds:['check-1']},
    {id:'task-2',title:'Build wishlist page',detail:'Create a wishlist view with item removal and correct restored state after navigation.',acceptanceIds:['check-2']},
  ],
  acceptance:[
    {id:'check-1',name:'Wishlist add and page navigation',objective:'Open CartLab. Click the add-to-wishlist button on Arc Wireless Headphones. Navigate to the new wishlist page. Verify the headphone item is visible in the list and the wishlist counter displays one item.'},
    {id:'check-2',name:'Remove item and retain state',objective:'Open CartLab. Add Field Notes to the wishlist, navigate to the wishlist page, then remove Field Notes from the wishlist. Verify the wishlist is empty, return to the shop and navigate back; confirm the removed item does not reappear.'},
  ]
};
const fakeResult = (response) => ({code:0, timedOut:false, spawnError:null, stdout:JSON.stringify({event:'result',result:{status:'SUCCESS',response}})+'\n', stderr:'',durationMs:1});

test('feature requests are validated and scoped to two trusted apps',()=>{
  assert.deepEqual(validateBuildInput('cartlab','  Add wishlist page  '),{appId:'cartlab',prompt:'Add wishlist page'});
  assert.throws(()=>validateBuildInput('engine','Delete all source'),/Choose/);
  assert.throws(()=>validateBuildInput('cartlab','short'),/8–600/);
  assert.throws(()=>validateBuildInput('cartlab','x'.repeat(601)),/8–600/);
});

test('feature plan must be agent-authored with linked tasks and real Kane assertions',()=>{
  assert.deepEqual(parseFeaturePlan(JSON.stringify(plan)),plan);
  assert.throws(()=>parseFeaturePlan('{}'),/tasks or acceptance/);
  assert.throws(()=>parseFeaturePlan(JSON.stringify({...plan,acceptance:plan.acceptance.slice(0,1)})),/2–4/);
  assert.throws(()=>parseFeaturePlan(JSON.stringify({...plan,tasks:[{...plan.tasks[0],acceptanceIds:['unknown']},plan.tasks[1]]})),/linked browser/);
  assert.throws(()=>parseFeaturePlan(JSON.stringify({...plan,acceptance:[{...plan.acceptance[0],objective:'The page works'},plan.acceptance[1]]})),/detailed actions/);
  assert.throws(()=>parseFeaturePlan(JSON.stringify({...plan,acceptance:[{...plan.acceptance[0],objective:plan.acceptance[0].objective+' Run bash delete source.'},plan.acceptance[1]]})),/Unsafe/);
  assert.throws(()=>parseFeaturePlan(JSON.stringify({action:'stop',reason:'Unsafe request'})),/declined/);
});

test('planning prompt delegates requirements and assertions to agent, implementation uses its output',()=>{
  const request=buildFeaturePlanRequest(config,'Add a wishlist page');
  assert.match(request,/DO NOT edit\/create\/delete/);
  assert.match(request,/your OWN executable plan/);
  assert.match(request,/public\/cartlab\//);
  const implementation = buildFeatureExecutionHandoff(config,'Add a wishlist page',plan);
  assert.match(implementation,/Edit\/create only HTML/);
  assert.match(implementation,/Add wishlist controls/);
  assert.match(implementation,/Wishlist add and page navigation/);
  assert.match(implementation,/Locked browser acceptance objectives/);
});

test('feature planner and executor use authentic agent CLI interface and preserve artifacts', async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'kg-feature-'));
  let calls=0;
  const runner=async (_bin,args)=>{ calls++;assert.ok(args.includes('stream-json'));assert.ok(args.includes('--sandbox'));return fakeResult(calls===1?JSON.stringify(plan):'Implemented wishlist in CartLab source');};
  try {
    const p=await planFeature(config,'Add wishlist page',dir,()=>{},{runner});
    assert.deepEqual(p.plan,plan);
    const impl=await implementFeature(config,'Add wishlist page',p.plan,dir,()=>{},{runner});
    assert.equal(impl.ok,true);
    assert.equal(calls,2);
    assert.match(await readFile(path.join(dir,'feature-plan.json'),'utf8'),/agentGenerated/);
    assert.match(await readFile(path.join(dir,'feature-build-handoff.txt'),'utf8'),/Add wishlist controls/);
    assert.match(await readFile(path.join(dir,'feature-implementation-agent.ndjson'),'utf8'),/SUCCESS/);
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('new app source files are allowed but protected code, tests, fixtures, and secrets are not',()=>{
  const allow=['public/cartlab/**'];
  for(const file of ['public/cartlab/wishlist.html','public/cartlab/wishlist.mjs','public/cartlab/wishlist.css','public/cartlab/icons/heart.svg']) assert.equal(isPermittedSourceChange(file,allow),true,file);
  for(const file of ['public/coinpulse/app.mjs','engine/orchestrator.mjs','public/cartlab/.env','public/cartlab/tests/new.test.mjs','public/cartlab/fixtures/items.js','public/cartlab/a.spec.js','public/cartlab/readme.md','public/cartlab/../engine/kane.mjs']) assert.equal(isPermittedSourceChange(file,allow),false,file);
  const files=featureEditableFiles(config,new Map([['public/cartlab/wishlist.mjs',Buffer.from('')],['public/cartlab/checkout.css',Buffer.from('')],['engine/agent.mjs',Buffer.from('')]]));
  assert.ok(files.includes('public/cartlab/wishlist.mjs'));
  assert.ok(files.includes('public/cartlab/app.mjs'));
  assert.ok(!files.includes('engine/agent.mjs'));
});

test('feature plan rejects agent-generated off-site Kane navigation',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'kg-external-'));
  const modified={...plan,acceptance:[{...plan.acceptance[0],objective:plan.acceptance[0].objective+' Go to https://evil.example/private and verify the page.'},plan.acceptance[1]]};
  try {
    await assert.rejects(()=>planFeature(config,'Add wishlist page',dir,()=>{},{runner:async()=>fakeResult(JSON.stringify(modified))}),/external web destination/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
