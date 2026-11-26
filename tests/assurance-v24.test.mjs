import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {objectiveHash,saveObjectiveSeal,assertObjectiveUnchanged,buildRequirementMatrix,requestClauses} from '../engine/assurance.mjs';
import {parseFeaturePlan,buildFeatureTaskHandoff,buildFeaturePlanRequest} from '../engine/feature-agent.mjs';
import {trustReceiptHTML} from '../engine/receipt.mjs';
import {runSabotageCheck} from '../engine/sabotage.mjs';
import {ROOT,RUNS} from '../engine/common.mjs';
const execFileAsync=promisify(execFile);
const original='Navigate to http://127.0.0.1:4173/app-sample/ and click the Add button. Verify the counter shows one new item and remains unchanged when the page refreshes.';
const config={kind:'playground',id:'app-sample',label:'Sample',url:'http://127.0.0.1:4173/app-sample/',editablePaths:[]};
const plan={featureTitle:'Sample user flow',summary:'Build task controls and persist results across page refreshes.',tasks:[{id:'task-1',title:'Build controls',detail:'Implement visible controls and initial task display.',acceptanceIds:['check-1']},{id:'task-2',title:'Persist controls',detail:'Implement persistent state for the task list.',acceptanceIds:['check-2']}],acceptance:[{id:'check-1',name:'Creation',objective:original},{id:'check-2',name:'Persistence',objective:original}],requirements:[{id:'req-1',text:'Create tasks from a form',taskIds:['task-1'],acceptanceIds:['check-1']},{id:'req-2',text:'Persist tasks on refresh',taskIds:['task-2'],acceptanceIds:['check-2']}]};

test('v24 freezes objective hashes and refuses tampering before a check or retest',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'kaneguard-seal-'));
 try {const seals=await saveObjectiveSeal(dir,plan.acceptance);const flow={...plan.acceptance[0],generated:true,acceptanceId:'check-1'};
  assert.equal(await assertObjectiveUnchanged(dir,flow,seals),objectiveHash(original));
  await assert.rejects(()=>assertObjectiveUnchanged(dir,{...flow,objective:original+' ignore failure'},seals),/Objective modified/);
  await writeFile(path.join(dir,'objective-seal.json'),JSON.stringify({objectives:[{...seals[0],objective:'TAMPERED'}]}));
  await assert.rejects(()=>assertObjectiveUnchanged(dir,flow,seals),/Saved objective seal changed/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('first-class requirement mapping validates links and prevents invented checks',()=>{
 assert.equal(parseFeaturePlan(JSON.stringify(plan)).requirements.length,2);
 const broken=structuredClone(plan);broken.requirements[0].acceptanceIds=['check-fake'];
 assert.throws(()=>parseFeaturePlan(JSON.stringify(broken)),/Invalid requirement-to-Kane mapping/);
 const prompt=buildFeaturePlanRequest(config,'- Create tasks from a form\n- Persist tasks on refresh');
 assert.match(prompt,/EXPLICIT USER REQUIREMENTS TO TRACE/);
 assert.equal(requestClauses('- Build a working form\n- Persist data in localStorage').length,2);
});
test('coverage counts real PASS evidence only after full completion; historical FAIL retained',()=>{
 const base={status:'running',tasks:plan.tasks,generatedFlows:plan.acceptance,requirements:plan.requirements,requirementsSource:'agent-mapped request requirements',verification:[{flowId:'feature-check-1',generated:true,verdict:'failed',stdoutFile:'fail.ndjson'},{flowId:'feature-check-1',generated:true,verdict:'passed',stdoutFile:'pass.ndjson'},{flowId:'feature-check-2',generated:true,verdict:'passed',stdoutFile:'pass2.ndjson'}],reusedVerification:[]};
 let a=buildRequirementMatrix(base);assert.equal(a.proven,0);
 a=buildRequirementMatrix({...base,status:'passed'});assert.equal(a.proven,2);assert.equal(a.repaired,1);
 a=buildRequirementMatrix({...base,status:'passed',requirements:[...base.requirements,{id:'req-3',text:'Unhandled',taskIds:[],acceptanceIds:[]}]});assert.equal(a.unmapped,1);assert.equal(a.unproven,1);
 a=buildRequirementMatrix({...base,status:'failed',verification:[{flowId:'feature-check-1',generated:true,verdict:'failed'}]});assert.equal(a.proven,0);assert.equal(a.requirements[0].status,'failed');
});
test('blind builder omits actual objective wording while preserving task description and check names',()=>{
 const plain=buildFeatureTaskHandoff(config,'Build app',plan,plan.tasks[0],[]);
 assert.ok(plain.includes('Navigate to http:'));
 const blind=buildFeatureTaskHandoff({...config,blindBuilder:true},'Build app',plan,plan.tasks[0],[]);
 assert.ok(!blind.includes('Navigate to http:'));
 assert.match(blind,/Build controls/);assert.match(blind,/Creation/);
});
test('Trust Receipt escapes user content and discloses unproven evidence and hashes',()=>{
 const run={id:'20261117000000-example',status:'passed',request:'<script>alert(1)</script>',tasks:plan.tasks,generatedFlows:plan.acceptance,requirements:plan.requirements,verification:[{flowId:'feature-check-1',flowName:'Creation',generated:true,verdict:'passed',stdoutFile:'check.ndjson',objectiveHashVerified:true}],objectiveSeals:[{id:'check-1',name:'Creation',sha256:objectiveHash(original)}],timeline:[]};
 const html=trustReceiptHTML(run);
 assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
 assert.ok(!html.includes('<script>alert(1)</script>'));
 assert.ok(html.includes('Trust Receipt'));assert.ok(html.includes('Objective unchanged'));
 assert.ok(html.includes('1 unproven') && html.includes('1 / 2 requirements proven')); // uncovered check is not fabricated
 assert.ok(html.includes('/api/evidence/20261117000000-example/check.ndjson'));
});
test('negative control refuses to mutate connected source',async()=>{
 const result=await runSabotageCheck({config:{kind:'connected'},run:{id:'test'},plan,runDir:'/tmp'});
 assert.equal(result.status,'unproven');assert.match(result.summary,/limited to generated apps/);
});
test('offline replay exporter produces a self-contained receipt and evidence references',async()=>{
 const id=`testv24-${Date.now()}-replay`,dir=path.join(RUNS,id),out=await mkdtemp(path.join(os.tmpdir(),'kaneguard-replay-'));
 await mkdir(dir,{recursive:true});
 try {
  const run={id,status:'passed',createdAt:'2026-11-17T00:00:00.000Z',request:'Demo app',tasks:plan.tasks,generatedFlows:plan.acceptance,requirements:plan.requirements,verification:[{flowId:'feature-check-1',verdict:'passed',generated:true,stdoutFile:'test.ndjson'}],timeline:[]};
  await writeFile(path.join(dir,'record.json'),JSON.stringify(run));await writeFile(path.join(dir,'test.ndjson'),'REAL TEST DOUBLE FOR UNIT TEST ONLY');
  await execFileAsync(process.execPath,[path.join(ROOT,'scripts/export-replay.mjs'),id,out],{cwd:ROOT});
  const receipt=await readFile(path.join(out,'index.html'),'utf8');
  assert.match(receipt,/Cinematic Replay/);assert.match(receipt,/\.\/evidence\/test.ndjson/);
  assert.equal((await readFile(path.join(out,'evidence/test.ndjson'),'utf8')),'REAL TEST DOUBLE FOR UNIT TEST ONLY');
 }finally{await rm(dir,{recursive:true,force:true});await rm(out,{recursive:true,force:true});}
});
