import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,cp,mkdir,writeFile,chmod,readFile,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import path from 'node:path';
import os from 'node:os';
import {ROOT} from '../engine/common.mjs';

// This test deliberately uses TEST-DOUBLE commands in an isolated copy. It
// validates orchestration but never claims authentic Kane browser verification.
async function freePort() {
  const server=createServer();
  await new Promise((resolve)=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  await new Promise((resolve)=>server.close(resolve));
  return port;
}

test('isolated orchestration: task1 → Kane gate → task2 → Kane fail → Antigravity repair → full suite', {timeout:35000}, async()=>{
  const folder=await mkdtemp(path.join(os.tmpdir(),'kg-v11-pipeline-'));
  const port=await freePort();
  let server;
  try {
    for(const name of ['engine','server','public','configs']) await cp(path.join(ROOT,name),path.join(folder,name),{recursive:true});
    await cp(path.join(ROOT,'package.json'),path.join(folder,'package.json'));
    const cfgPath=path.join(folder,'configs/cartlab.json');
    const cfg=JSON.parse(await readFile(cfgPath,'utf8'));
    cfg.url=`http://127.0.0.1:${port}/cartlab/`;
    await writeFile(cfgPath,JSON.stringify(cfg));
    const fakeDir=path.join(folder,'cli-fixtures');
    await mkdir(fakeDir);
    const fakeAgy=path.join(fakeDir,'agy-test-double.mjs');
    const fakeKane=path.join(fakeDir,'kane-test-double.mjs');
    const agentScript=`#!/usr/bin/env node
import fs from 'node:fs';
const args=process.argv.slice(2);
const prompt=args[args.indexOf('-p')+1]||'';
const base=process.cwd();
const output=(response)=>process.stdout.write(JSON.stringify({event:'result',result:{status:'SUCCESS',response}})+'\\n');
const url='http://127.0.0.1:'+process.env.KG_TEST_PORT+'/cartlab/';
if(prompt.includes('PLAN a real feature')) {
  const plan={featureTitle:'Demo milestone feature',summary:'Add two incremental modules and verify each task in the local browser using distinct assertions.',
    tasks:[{id:'task-a',title:'Implement first demo module',detail:'Create source module A that supports the first local-browser user interaction.',acceptanceIds:['check-a']},
      {id:'task-b',title:'Implement second demo module',detail:'Create source module B with a second visible action and correct output.',dependsOn:['task-a'],acceptanceIds:['check-b']}],
    acceptance:[{id:'check-a',name:'First module browser flow',objective:'Navigate to '+url+' then click the first demo action. Verify that its result is visible and the page contains the correct first message after the user interaction.'},
      {id:'check-b',name:'Second module browser flow',objective:'Navigate to '+url+' then click the second demo action. Verify that its visible result is updated correctly and the second message remains present after refresh.'}]};
  output(JSON.stringify(plan));
}else if(prompt.includes('CURRENT TASK task-a')) {
  fs.writeFileSync(base+'/public/cartlab/feature-a.mjs','export const a = 1;\\n');output('Task A code written');
}else if(prompt.includes('CURRENT TASK task-b')) {
  if(!fs.existsSync(base+'/public/cartlab/feature-a.mjs')) {process.stderr.write('Dependency missing');process.exit(5)}
  fs.writeFileSync(base+'/public/cartlab/feature-b.mjs','export const b = 1;\\n');output('Task B code written');
}else if(prompt.includes('INVESTIGATION AGENT')) {
  const response={action:'repair',diagnosis:'The second module lacks a visible state marker. It needs a real source edit to pass the observed Kane check.',confidence:'high',
   targetFiles:['public/cartlab/feature-b.mjs'],repairPrompt:'Update the second feature module to export the missing state marker that the browser requires. Keep the first module and all test criteria unchanged. Retest both flows after the change and preserve the original app behavior.'};
  output(JSON.stringify(response));
}else if(prompt.includes('KaneGuard coding agent')) {
  fs.writeFileSync(base+'/public/cartlab/feature-b.mjs','export const b = 2;\\n');output('Applied the actual repair');
}else {process.stderr.write('Unexpected Antigravity prompt');process.exit(4)}
`;
    const kaneScript=`#!/usr/bin/env node
import fs from 'node:fs';
const objective=process.argv[3]||'';
const base=process.cwd()+'/public/cartlab/';
let status='passed';
if(objective.includes('first demo action')) {
  status=fs.existsSync(base+'feature-a.mjs')?'passed':'failed';
  // Simulate one successful-looking run_end followed by a nonzero CLI exit.
  // It must be counted as infrastructure, then retried, never as PASS.
  const marker=process.cwd()+'/first-kane-interruption';
  if(!fs.existsSync(marker)) {
    fs.writeFileSync(marker,'once');
    process.stdout.write(JSON.stringify({type:'run_end',status:'passed',summary:'TEST DOUBLE interrupted after browser result'})+'\\n');
    process.exit(31);
  }
}
if(objective.includes('second demo action')) {
  const code=fs.existsSync(base+'feature-b.mjs')?fs.readFileSync(base+'feature-b.mjs','utf8'):'';
  status=code.includes('b = 2')?'passed':'failed';
}
process.stdout.write(JSON.stringify({type:'run_end',status,summary:'TEST DOUBLE (not an actual browser run): '+objective.slice(0,65)})+'\\n');
`;
    await writeFile(fakeAgy,agentScript);
    await writeFile(fakeKane,kaneScript);
    await chmod(fakeAgy,0o755);await chmod(fakeKane,0o755);
    const stdout=[];
    server=spawn(process.execPath,['server/main.mjs'],{
      cwd:folder,env:{...process.env,PORT:String(port),KANEGUARD_AGENT_BIN:fakeAgy,KANE_CLI_BIN:fakeKane,KG_TEST_PORT:String(port)},stdio:['ignore','pipe','pipe']
    });
    server.stdout.on('data',(buf)=>stdout.push(String(buf)));
    server.stderr.on('data',(buf)=>stdout.push(String(buf)));
    let healthy=false;
    for(let i=0;i<65;i++) {
      if(server.exitCode!==null) break;
      try {healthy=(await fetch(`http://127.0.0.1:${port}/api/health`)).ok;if(healthy)break;}
      catch {} await delay(70);
    }
    assert.equal(healthy,true,`temp server didn't start: ${stdout.join('').slice(-1200)}`);
    const response=await fetch(`http://127.0.0.1:${port}/api/build`,{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({appId:'cartlab',prompt:'Build two simple demo UI modules'})
    });
    assert.equal(response.status,202);
    let result;
    for(let i=0;i<180;i++) {
      await delay(95);
      const runs=await (await fetch(`http://127.0.0.1:${port}/api/runs`)).json();
      if(runs.length && runs[0].status!=='running') {result=runs[0];break;}
    }
    assert.ok(result,`Workflow did not finish: ${stdout.join('').slice(-3500)}`);
    assert.equal(result.status,'passed',`${result.status} ${result.failure?.summary||''} ${stdout.join('').slice(-1900)}`);
    assert.equal(result.workflowVersion,31);
    assert.deepEqual(result.taskExecutions.map((t)=>t.taskId),['task-a','task-b']);
    assert.equal(result.repairs.length,1);
    assert.equal(result.milestones.length,3);
    assert.ok(result.milestones.every((m)=>m.status==='passed'));
    assert.ok(result.verification.some((v)=>v.verdict==='failed'));
    assert.equal(result.verification.filter((v)=>v.verdict==='infrastructure_error').length,1);
    assert.ok(result.verification.some((v)=>v.infrastructureRetry===1&&v.verdict==='passed'));
    assert.ok(result.timeline.some((event)=>event.kind==='kane_retry')); 
    assert.equal(result.verification.filter((v)=>v.gate==='Final full suite' && v.verdict==='passed').length,4);
    assert.equal(result.reusedVerification.filter((v)=>v.gate==='Final full suite').length,1);
    assert.equal(result.reusedVerification[0].flowName,'Second module browser flow');
    assert.equal(result.reusedVerification[0].fromGate,'After task-b: Implement second demo module');
    assert.ok(result.timeline.some((event)=>event.kind==='kane_reused'));
    const startA=result.timeline.findIndex((e)=>e.kind==='task_start'&&e.title.includes('first'));
    const kaneA=result.timeline.findIndex((e)=>e.kind==='kane_pass'&&e.detail==='First module browser flow');
    const startB=result.timeline.findIndex((e)=>e.kind==='task_start'&&e.title.includes('second'));
    const repairStart=result.timeline.findIndex((e)=>e.kind==='repair_start');
    assert.ok(repairStart>=0, 'coding repair must publish its status before starting the agent');
    const repair=result.timeline.findIndex((e)=>e.kind==='recheck');
    assert.ok(startA>=0 && kaneA>startA && startB>kaneA && repairStart>startB && repair>repairStart, 'Kane must gate task A before task B and repair after task B fails');
    assert.deepEqual(result.tasks.map((t)=>t.status),['verified','verified']);
    assert.equal(await readFile(path.join(folder,'public/cartlab/feature-b.mjs'),'utf8'),'export const b = 2;\n');
    // v31.4: A successful build retains protected regressions. On a later
    // build they MUST have current-source Kane evidence, but an identical
    // objective already executed on those exact source bytes is sufficient.
    const baseline=JSON.parse(await readFile(path.join(folder,'regression-baselines','cartlab.json'),'utf8'));
    assert.equal(baseline.entries.length,2);
    assert.equal(result.regressionProtection.addedAfterPass,2);
    const secondStart=await fetch(`http://127.0.0.1:${port}/api/build`,{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({appId:'cartlab',prompt:'Improve the same demo UI modules and preserve earlier behavior'})});
    assert.equal(secondStart.status,202);
    let second;
    for(let i=0;i<185;i++){
      await delay(95);
      const all=await(await fetch(`http://127.0.0.1:${port}/api/runs`)).json();
      const found=all.find(r=>r.id!==result.id);
      if(found && found.status!=='running'){second=found;break;}
    }
    assert.ok(second,'A second independent build should finish');
    assert.equal(second.status,'passed',second.timeline?.at(-1)?.detail);
    assert.equal(second.regressionProtection.carriedFromPreviousRuns,2);
    const repeatedRegressions=second.reusedVerification.filter(v=>v.gate==='Final full suite'&&v.flowId?.startsWith('reg-'));
    assert.equal(repeatedRegressions.length,2,'Identical historical objectives are covered by current-build Kane PASSes, not needlessly executed twice');
    assert.ok(repeatedRegressions.every(v=>v.reuseReason==='identical-objective-and-source' && v.originalFlowId.startsWith('feature-') && v.sourceFingerprint && v.stdoutFile),
      'Every reused regression has verifiable same-run Kane evidence on exactly the current application source');
    assert.equal(second.verification.filter(v=>v.flowId?.startsWith('reg-')&&v.verdict==='passed').length,0,
      'Duplicate final regression browser sessions are avoided');
    assert.ok(second.verification.filter(v=>v.flowId?.startsWith('feature-')&&v.verdict==='passed').length>=2,
      'The second build must actually run current-source Kane browser checks before reusing them');
    assert.equal(second.regressionProtection.addedAfterPass,0,'identical previously sealed objectives do not duplicate');
  }finally{
    if(server && server.exitCode===null){server.kill('SIGTERM');await Promise.race([new Promise((resolve)=>server.once('exit',resolve)),delay(1500)]);}
    await rm(folder,{recursive:true,force:true});
  }
});
