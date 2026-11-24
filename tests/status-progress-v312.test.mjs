import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {recordedCheckProgress,requirementProgressLabel} from '../public/control/assurance-progress.mjs';
import {taskVerificationState} from '../public/control/task-verification-state.mjs';

const checks=Array.from({length:5},(_,i)=>({id:`check-${i+1}`,name:`Check ${i+1}`}));
const requirements=[
 {id:'req-1',status:'unproven',acceptanceIds:['check-1','check-2']},
 {id:'req-2',status:'unproven',acceptanceIds:['check-1','check-2']},
 {id:'req-3',status:'unproven',acceptanceIds:['check-3']},
 {id:'req-4',status:'failed',acceptanceIds:['check-4','check-5']}
];
const run=(status='verification_inconclusive')=>({
 status,stage:'finished',generatedFlows:checks,requirements,
 tasks:checks.map((c,i)=>({id:`task-${i+1}`,status:'verification_inconclusive',acceptanceIds:[c.id]})),
 verification:[
  {flowId:'feature-check-1',generated:true,verdict:'passed',stdoutFile:'1.ndjson'},
  {flowId:'feature-check-2',generated:true,verdict:'passed',stdoutFile:'2.ndjson'},
  {flowId:'feature-check-3',generated:true,verdict:'passed',stdoutFile:'3.ndjson'},
  {flowId:'feature-check-4',generated:true,verdict:'failed',stdoutFile:'4.ndjson'}
 ]
});

test('v31.2 accurately shows three real Kane PASSes even while final certification is blocked',()=>{
 const r=run();const s=recordedCheckProgress(r);
 assert.deepEqual([s.total,s.passed,s.failed],[5,3,1]);
 assert.equal(requirementProgressLabel(r,requirements[0],s),'Kane checks passed · full suite incomplete');
 assert.equal(requirementProgressLabel(r,requirements[1],s),'Kane checks passed · full suite incomplete');
 assert.equal(requirementProgressLabel(r,requirements[2],s),'Kane checks passed · full suite incomplete');
 assert.equal(requirementProgressLabel(r,requirements[3],s),'0/2 checks passed · Kane FAIL (disputed)');
 assert.equal(taskVerificationState(r,r.tasks[0]).label,'Kane PASS recorded · full suite incomplete');
 assert.notEqual(taskVerificationState(r,r.tasks[0]).kind,'verified');
 assert.equal(taskVerificationState(r,r.tasks[3]).kind,'failed');
});

test('progress reports only latest terminal check verdict and never counts objective-free evidence',()=>{
 const r=run('running');r.verification.push({flowId:'feature-check-1',verdict:'failed'});
 r.verification.push({flowId:'other-foo',verdict:'passed'});
 r.verification.push({flowId:'feature-check-3',verdict:'passed'});
 const s=recordedCheckProgress(r);
 assert.deepEqual([s.total,s.passed,s.failed],[5,2,2]);
 assert.match(requirementProgressLabel(r,requirements[0],s),/1\/2 checks passed · Kane FAIL/);
 r.currentFlowId='feature-check-5';
 assert.equal(requirementProgressLabel(r,requirements[3],s),'0/2 checks passed · Kane FAIL');
});

test('studio displays recorded check evidence separately from strictly certified requirements',async()=>{
 const source=await readFile(new URL('../public/control/studio.mjs',import.meta.url),'utf8');
 assert.match(source,/recordedCheckProgress\(run\)/);
 assert.match(source,/fully certified/);
 assert.match(source,/checks with recorded PASS/);
 assert.match(source,/Full certification requires the final suite to pass/);
 assert.doesNotMatch(source,/Kane PASS recorded · updating/);
 assert.match(source,/No proposed replacement objective/);
});

test('unshared Kane checks do not misleadingly show a shared-check badge',()=>{
 const r=run('running');r.stage='final_verification';r.currentFlowId='feature-check-5';
 r.tasks[4].status='candidate';
 assert.equal(taskVerificationState(r,r.tasks[4]).label,'Kane browser testing');
});
