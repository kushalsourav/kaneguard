import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseFeaturePlan, planFeature, buildFeaturePlanRequest } from '../engine/feature-agent.mjs';
import { promptArtifacts, extractAgentPlan } from '../public/control/artifacts.mjs';

const example = {
  featureTitle:'Persistent Wishlist Page',
  summary:'Create a persistent wishlist feature for CartLab with an independent page.',
  tasks:[
    {id:'task-1',title:'Add product wishlist controls',detail:'Implement a saved wishlist toggle on catalog products.',acceptanceIds:['check-1']},
    {id:'task-2',title:'Build wishlist saved view',detail:'Render saved items and allow users to remove them from the wishlist.',acceptanceIds:['check-2']},
  ],
  acceptance:[
    {id:'check-1',name:'Adding wishlist items',objective:'Navigate to the CartLab homepage, click Add to wishlist for Arc Wireless Headphones, then open Wishlist. Observe that Arc Wireless Headphones appears with its correct price and the counter displays 1 item.'},
    {id:'check-2',name:'Removing wishlist items',objective:'Navigate to CartLab. Click Add to wishlist on Field Notes, then open Wishlist. Click Remove. Observe that the item disappears, the empty state is visible, and the count remains 0 on reload.'},
  ],
  implementationPrompt:'Build a real persistent wishlist using localStorage and the CartLab catalog data. Add accessible product wishlist controls and a wishlist page with linked product content and remove actions. Handle malformed stored data and preserve the original checkout and coupon behavior.'
};

const config = {id:'cartlab',label:'CartLab',url:'http://127.0.0.1:4173/cartlab/',editablePaths: ['public/cartlab/app.mjs'],maxRepairs:3};
const stream = (response) => JSON.stringify({event:'result',result:{status:'SUCCESS',response}})+'\n';
const runner = async (_bin, _args) => ({code:0,spawnError:null,timedOut:false,stderr:'',stdout:stream(JSON.stringify(example)),durationMs:1});

test('natural language assertions with observe/remains are accepted, vague flows rejected', () => {
  const plan = parseFeaturePlan(JSON.stringify(example));
  assert.equal(plan.acceptance.length,2);
  assert.throws(() => parseFeaturePlan(JSON.stringify({...example,acceptance:[
    {...example.acceptance[0],objective:'The wishlist should work correctly and everything should be okay after opening it. There should be no problems at all.'},example.acceptance[1]
  ]})),/detailed actions and assertions/);
  assert.throws(() => parseFeaturePlan(JSON.stringify({...example,acceptance:[
    {...example.acceptance[0],objective:'Navigate to homepage then click all the links and click all buttons one after another with no assertions in this whole test flow.'}, example.acceptance[1]
  ]})),/detailed actions and assertions/);
  assert.match(buildFeaturePlanRequest(config,'Add wishlist'), /FRESH browser session/);
});

test('planner saves a genuine agent-authored candidate plan before deciding whether it meets validation', async() => {
  const dir = await mkdtemp(path.join(os.tmpdir(),'kg-v9-plan-'));
  try {
    await planFeature(config,'Add wishlist',dir,()=>{},{runner});
    const candidate = JSON.parse(await readFile(path.join(dir,'feature-plan-candidate.json'),'utf8'));
    assert.equal(candidate.plan.featureTitle,'Persistent Wishlist Page');
    assert.equal(candidate.agentGenerated,true);
    assert.equal(candidate.validation,'pending');
    const invalid = {...example,acceptance:[{...example.acceptance[0],objective:'not a test'},example.acceptance[1]]};
    await assert.rejects(()=>planFeature(config,'Add wishlist',dir,()=>{},{runner:async()=>({...await runner(),stdout:stream(JSON.stringify(invalid))})}), /detailed actions/);
    const saved = JSON.parse(await readFile(path.join(dir,'feature-plan-candidate.json'),'utf8'));
    assert.equal(saved.plan.acceptance[0].objective,'not a test');
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('dashboard extracts candidate plan from accepted JSON, wrapped candidate, and genuine agent NDJSON',()=>{
  assert.equal(extractAgentPlan(JSON.stringify(example)).featureTitle,example.featureTitle);
  assert.equal(extractAgentPlan(JSON.stringify({plan:example})).featureTitle,example.featureTitle);
  assert.equal(extractAgentPlan(stream(JSON.stringify(example))).featureTitle,example.featureTitle);
  assert.equal(extractAgentPlan('not a plan'),null);
});

test('dashboard lists authentic planning, implementation and repair artifacts with clear labels',()=>{
  const choices=promptArtifacts({mode:'build', artifacts:{plannerPrompt:'feature-planning-prompt.txt',featurePlan:'feature-plan.json',implementationPrompt:'feature-implementation-prompt.txt'}, plans:[{attempt:1,planFile:'diagnosis-1-plan.json',requestFile:'diagnosis-1-input.txt'}], repairs:[{attempt:1,ticketFile:'repair-ticket-1.txt',outFile:'agent-1.ndjson'}]});
  assert.ok(choices.some(c=>/Repair 1 · handoff/.test(c.label) && c.name==='repair-ticket-1.txt'));
  assert.ok(choices.some(c=>/Repair 1 · diagnosis/.test(c.label)));
  assert.ok(choices.some(c=>/Legacy handoff/i.test(c.label)));
  assert.equal(promptArtifacts({mode:'verify'}).length,0);
  assert.ok(!promptArtifacts({mode:'build', artifacts:{plannerPrompt:'../secrets.txt'}}).length);
});
