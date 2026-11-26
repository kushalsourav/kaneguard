import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {taskVerificationState} from '../public/control/task-verification-state.mjs';

test('continue keeps verified tasks unproven until the final suite re-runs them',async()=>{
  const src=await readFile(new URL('../engine/feature.mjs',import.meta.url),'utf8');
  // Kept checks only unblock ordering; verified status still comes from passedMilestoneIds alone.
  assert.match(src,/const carriedCheckIds = new Set\(\);/);
  assert.match(src,/verifiedTaskIds\(plan,passedMilestoneIds\)/);
  assert.match(src,/status:'carried_over'/);
  // The final suite runs every locked check, including the kept ones.
  assert.match(src,/verifyGateAndContinue\(\[\.\.\.protectedFeatureFlows,\.\.\.protectedRegressionFlows\],'Final full suite'\)/);
  // Same plan and same seals: the planner is never re-run for a continuation.
  assert.match(src,/if \(resumedPlan\) \{\n      plan = parseFeaturePlan/);
  assert.match(src,/\['interrupted','agent_error'\]\.includes\(prior\?\.status\)/);
});

test('kept task is labelled as such, never as Kane verified, until the run passes',()=>{
  const run={status:'running',tasks:[],generatedFlows:[],verification:[],milestones:[]};
  assert.equal(taskVerificationState(run,{id:'task-1',status:'candidate',carriedOver:true,acceptanceIds:[]}).label,'Kept from stopped run · rechecked at the end');
  assert.equal(taskVerificationState({...run,status:'passed'},{id:'task-1',status:'verified',carriedOver:true}).label,'Kane verified');
});

test('continue endpoint and button exist and are local-page only',async()=>{
  const server=await readFile(new URL('../server/main.mjs',import.meta.url),'utf8');
  assert.match(server,/\\\/continue\$\//);
  assert.match(server,/Continue is only available to the local KaneGuard page/);
  const html=await readFile(new URL('../public/control/index.html',import.meta.url),'utf8');
  assert.match(html,/id="continueButton"/);
});

test('a human-approved test revision continues the run with the new wording sealed as v2',async()=>{
  const src=await readFile(new URL('../engine/feature.mjs',import.meta.url),'utf8');
  assert.match(src,/d\.decision==='approve_new_version'&&d\.proposedObjective/);
  assert.match(src,/does not match its reviewed fingerprint/);
  assert.match(src,/no longer matches the disputed fingerprint/);
  assert.match(src,/Human-approved test revision sealed/);
  // A task owning a revised check is re-tested, never carried as verified.
  assert.match(src,/verified\.delete\(t\.id\)\) coded\.add\(t\.id\)/);
  const studio=await readFile(new URL('../public/control/studio.mjs',import.meta.url),'utf8');
  assert.match(studio,/Continue with approved test/);
});
