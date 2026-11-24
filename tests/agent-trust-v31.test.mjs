import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {objectiveHash} from '../engine/assurance.mjs';
import {loadRegressionBaseline,saveRegressionBaseline,inspectRegressionEntry} from '../engine/regression-baseline.mjs';
import {parseExaminerReview,buildExaminerReviewRequest} from '../engine/test-court.mjs';
import {decideTestDispute} from '../engine/test-dispute-decisions.mjs';
import {trustReceiptHTML} from '../engine/receipt.mjs';
import {kaneRequirementSource} from '../engine/native-assurance-source.mjs';
import {removeRegressionProofForRun} from '../engine/regression-baseline.mjs';

const objective='Navigate to http://127.0.0.1:4173/app-abc123/catalog and click Add to cart. Verify the cart item is visible and the displayed total updates after the click.';
const config={id:'app-abc123',url:'http://127.0.0.1:4173/app-abc123/'};
const runId='20261122093030-abcde';
const run={id:runId,status:'passed',generatedFlows:[{id:'check-cart',name:'Cart totals browser check',objective}],
  verification:[{generated:true,flowId:'feature-check-cart',verdict:'passed',objectiveHashVerified:true}],
  reusedVerification:[]};

test('v31 promotes only genuinely verified original objectives; next build reloads them, no fake current-source PASS',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'kg-v31-reg-'));
  try{
    let loaded=await loadRegressionBaseline(config,{root});assert.equal(loaded.flows.length,0);
    const failed={...run,status:'failed'};
    await assert.rejects(saveRegressionBaseline(config,failed,{root}),/Cannot promote/);
    const noProof={...run,verification:[]};
    assert.deepEqual((await saveRegressionBaseline(config,noProof,{root})).added,0);
    assert.equal((await loadRegressionBaseline(config,{root})).flows.length,0);
    const first=await saveRegressionBaseline(config,run,{root});
    assert.equal(first.added,1);
    loaded=await loadRegressionBaseline(config,{root});
    assert.equal(loaded.flows[0].objective,objective);
    assert.equal(loaded.flows[0].generated,false);
    assert.equal(loaded.flows[0].protectedRegression,true);
    assert.equal(loaded.flows[0].originRunId,runId);
    assert.equal((await saveRegressionBaseline(config,run,{root})).added,0);
    assert.equal(await removeRegressionProofForRun(config.id,'different-run',{root}),0);
    const baselineFile=path.join(root,'regression-baselines',`${config.id}.json`);
    const tampered=JSON.parse(await readFile(baselineFile,'utf8'));
    tampered.entries[0].objective+=' HACK';
    await writeFile(baselineFile,JSON.stringify(tampered));
    await assert.rejects(loadRegressionBaseline(config,{root}),/tampered/);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('v31 protected regression rejects changes of app origin and tampered hashes',()=>{
  const entry={name:'Cart',objective,sha256:objectiveHash(objective),originRunId:runId};
  assert.equal(inspectRegressionEntry(entry,config).id.startsWith('reg-'),true);
  assert.throws(()=>inspectRegressionEntry({...entry,sha256:'0'.repeat(64)},config),/tampered/);
  assert.throws(()=>inspectRegressionEntry({...entry,objective:objective.replace('4173','6124'),sha256:objectiveHash(objective.replace('4173','6124'))},config),/different server/);
});

test('v31 examiner records classification but never accepts a proposed replacement as a PASS',()=>{
  const candidate='Navigate to http://127.0.0.1:4173/app-abc123/catalog and click Add to cart. Verify the displayed cart total matches exactly two items at the listed unit price.';
  const sample={finding:'test_defect',confidence:'high',rationale:'The screenshot shows a single cart item, but the original check wrongly expects the total for two items.',evidenceNotes:['The cart badge shows one item.'],proposedObjective:candidate};
  const result=parseExaminerReview(JSON.stringify(sample),objective);
  assert.equal(result.finding,'test_defect');
  assert.equal(result.originalObjectiveHash,objectiveHash(objective));
  assert.equal(result.proposedObjectiveHash,objectiveHash(candidate));
  assert.equal(result.reviewStatus,'unapproved');
  assert.ok(!('verdict' in result));
  assert.throws(()=>parseExaminerReview(JSON.stringify({...sample,proposedObjective:candidate.replace('4173','1999')}),objective),/unapproved origin/);
  assert.equal(parseExaminerReview(JSON.stringify({...sample,confidence:'low',proposedObjective:null}),objective).finding,'uncertain');
  const prompt=buildExaminerReviewRequest({...config,label:'Demo'}, {objective,verdict:'failed',summary:'Browser objective failed'}, 'export const app = 1;', 'run_end failed');
  assert.match(prompt,/READ-ONLY/);assert.match(prompt,/test.*assumptions/i);assert.match(prompt,/failed/i);
});

test('v31.1 uncertain examiner with optional proposed objective is accepted but suggestion discarded',()=>{
  const evidence={finding:'uncertain',confidence:'medium',rationale:'Kane did not select the separate Resolved list filter, so the browser trace does not prove the application itself is broken.',
    evidenceNotes:['Kane clicked the status control but did not click the Resolved list filter.'],
    proposedObjective:'Navigate to the app. Mark Login button broken as Resolved. Select the Resolved list filter and verify that only the resolved issue is visible.'};
  const response=parseExaminerReview(JSON.stringify(evidence),objective);
  assert.equal(response.finding,'uncertain');
  assert.equal(response.reportedFinding,'uncertain');
  assert.equal(response.proposedObjective,null);
  assert.equal(response.proposedObjectiveHash,null);
  assert.equal(response.originalObjectiveHash,objectiveHash(objective));
  assert.equal(response.reviewStatus,'unapproved');
  // This is untrusted optional text, ignored for findings other than test_defect.
  const malformed=parseExaminerReview(JSON.stringify({...evidence,proposedObjective:42}),objective);
  assert.equal(malformed.finding,'uncertain');
  assert.equal(malformed.proposedObjective,null);
  const low=parseExaminerReview(JSON.stringify({...evidence,finding:'test_defect',confidence:'low'}),objective);
  assert.equal(low.finding,'uncertain');
  assert.equal(low.proposedObjective,null);
});

test('v31 review decision preserves original failed Kane proof and cannot run a replacement',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'kg-v31-decision-'));
  try{
    const dir=path.join(root,'runs',runId);await mkdir(dir,{recursive:true});
    const revised='Navigate to http://127.0.0.1:4173/app-abc123/catalog and click Add to cart. Verify that the cart item count is exactly one and the total equals the price.';
    const saved={id:runId,status:'verification_inconclusive',timeline:[],verification:[{flowId:'feature-check-cart',verdict:'failed',summary:'Original Kane FAIL'}],
      objectiveSeals:[{id:'check-cart',objective,sha256:objectiveHash(objective)}],
      testDisputes:[{flowName:'Cart',decision:'pending_human_review',proposedObjective:revised,proposedObjectiveHash:objectiveHash(revised)}]};
    await writeFile(path.join(dir,'record.json'),JSON.stringify(saved));
    await assert.rejects(decideTestDispute(runId,0,'approve_new_version','short',{root}),/reason/);
    const result=await decideTestDispute(runId,0,'approve_new_version','The new test matches the observed one-item state.',{root});
    assert.equal(result.newTestRan,false);
    const after=JSON.parse(await readFile(path.join(dir,'record.json'),'utf8'));
    assert.equal(after.status,'verification_inconclusive');
    assert.equal(after.verification[0].verdict,'failed');
    assert.equal(after.objectiveSeals[0].objective,objective);
    assert.equal(after.testDisputes[0].newObjectiveExecution,'not_run');
    assert.equal(after.testDisputes[0].decision,'approve_new_version');
    await assert.rejects(decideTestDispute(runId,0,'reject','Please do not change this answer.',{root}),/not pending/);
    const receipt=trustReceiptHTML({...after,appId:config.id});
    assert.match(receipt,/Independent Test Court/);
    assert.match(receipt,/Proposed test revision/);
    assert.match(receipt,/not_run|unexecuted/i);
  }finally{await rm(root,{recursive:true,force:true});}
});


test('v31 native assurance source is explicitly UNREVIEWED, not manufactured Kane coverage',()=>{
  const source=kaneRequirementSource({id:runId,appLabel:'Demo',request:'Build a cart with accurate totals',requirements:[{id:'req-1',text:'Cart total updates',taskIds:['task-a'],acceptanceIds:['check-a']}]});
  assert.match(source,/Original developer request/);
  assert.match(source,/UNREVIEWED/);
  assert.match(source,/agent-authored, not independently validated/);
  assert.match(source,/Cart total updates/);
  assert.doesNotMatch(source,/Kane-native PASSED|all requirements trusted/);
});

test('v31 intentionally deleting the sole supporting run retires its regression evidence',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'kg-v31-retire-'));
  try {
    await saveRegressionBaseline(config,run,{root});
    assert.equal(await removeRegressionProofForRun(config.id,runId,{root}),1);
    const read=await loadRegressionBaseline(config,{root});
    assert.equal(read.flows.length,0);
  }finally{await rm(root,{recursive:true,force:true});}
});
