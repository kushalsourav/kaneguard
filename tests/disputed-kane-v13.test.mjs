import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, cp, writeFile, readFile, chmod, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import os from 'node:os';
import { ROOT } from '../engine/common.mjs';

// These are TEST-DOUBLE processes, never real Kane evidence or browser passes.
async function unusedPort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
async function runFixture(repeatFailure) {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'kg-disputed-v13-'));
  const port = await unusedPort();
  let server;
  const logs = [];
  try {
    for (const dir of ['engine', 'server', 'configs', 'public']) await cp(path.join(ROOT, dir), path.join(folder, dir), { recursive:true });
    await cp(path.join(ROOT, 'package.json'), path.join(folder, 'package.json'));
    const configFile = path.join(folder, 'configs/cartlab.json');
    const config = JSON.parse(await readFile(configFile, 'utf8'));
    config.url = `http://127.0.0.1:${port}/cartlab/`;
    await writeFile(configFile, JSON.stringify(config));
    const cli = path.join(folder, 'fake-clis');
    await mkdir(cli);
    const agy = path.join(cli, 'agy.mjs');
    const kane = path.join(cli, 'kane.mjs');
    await writeFile(agy, `#!/usr/bin/env node
import fs from 'node:fs';
const args=process.argv.slice(2), prompt=args[args.indexOf('-p')+1]||'';
const send=(answer)=>process.stdout.write(JSON.stringify({event:'result',result:{status:'SUCCESS',response:typeof answer==='string'?answer:JSON.stringify(answer)}})+'\\n');
const url='http://127.0.0.1:'+process.env.KG_TEST_PORT+'/cartlab/';
if(prompt.includes('PLAN a real feature')) {
 send({featureTitle:'Two-stage genuine pass requirement',summary:'Implement the first and second independent browser-facing tasks with sequential milestones and protected regressions.',
 tasks:[{id:'task-a',title:'Create first browser task',detail:'Add the first module to enable the browser-facing first step.',acceptanceIds:['check-a']},
 {id:'task-b',title:'Create second browser task',detail:'Add the second module after task-a and preserve current behavior.',dependsOn:['task-a'],acceptanceIds:['check-b']}],
 acceptance:[{id:'check-a',name:'Test first browser feature',objective:'Navigate to '+url+' and click the first browser action on the page. Verify that the expected first task result is visible and its text remains correct after clicking.'},
 {id:'check-b',name:'Test second browser feature',objective:'Navigate to '+url+' and click the second browser action on the page. Verify that the expected second task result is visible and its text remains correct after clicking.'}]});
} else if(prompt.includes('CURRENT TASK task-a')) {
 fs.writeFileSync('public/cartlab/demo-a.mjs','export const demoA=1;\\n'); send('First task implementation saved');
} else if(prompt.includes('CURRENT TASK task-b')) {
 fs.writeFileSync('public/cartlab/demo-b.mjs','export const demoB=2;\\n'); send('Second task implementation saved');
} else if(prompt.includes('INVESTIGATION AGENT')) {
 send({action:'stop',diagnosis:'All stated amounts matched, no reproducible application defect was identified. Kane erroneously reported FAIL.',reason:'No source change is warranted',confidence:'high',targetFiles:[]});
} else {process.stderr.write('Unexpected attempt to run coding repair');process.exit(33)}
`);
    await writeFile(kane, `#!/usr/bin/env node
import fs from 'node:fs';
const objective=process.argv[3]||'';
let status='passed';
if(objective.includes('SAVE10')) {
 const flag='.fake-first-mismarked-result';
 if(!fs.existsSync(flag)) {fs.writeFileSync(flag,'yes');status='failed'}
 else if(process.env.KG_REPEAT_DISPUTE==='1') status='failed';
}
const summary=status==='failed'?'TEST DOUBLE: expected values matched but run_end says failed':'TEST DOUBLE: successful independent browser run';
process.stdout.write(JSON.stringify({type:'run_end',status,summary})+'\\n');
`);
    await chmod(agy,0o755);await chmod(kane,0o755);
    server=spawn(process.execPath,['server/main.mjs'],{cwd:folder,env:{...process.env,PORT:String(port),KANEGUARD_AGENT_BIN:agy,KANE_CLI_BIN:kane,KG_TEST_PORT:String(port),KG_REPEAT_DISPUTE:repeatFailure?'1':'0'},stdio:['ignore','pipe','pipe']});
    server.stdout.on('data',(part)=>logs.push(String(part)));
    server.stderr.on('data',(part)=>logs.push(String(part)));
    let ready=false;
    for(let n=0;n<65;n++) {
      if(server.exitCode!==null) break;
      try {ready=(await fetch(`http://127.0.0.1:${port}/api/health`)).ok;if(ready)break;} catch {}
      await delay(90);
    }
    assert.equal(ready,true,`Server failed startup: ${logs.join('').slice(-900)}`);
    const started=await fetch(`http://127.0.0.1:${port}/api/build`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({appId:'cartlab',prompt:'Build exactly two sequential demo actions with browser checks'})});
    assert.equal(started.status,202);
    let ended;
    for(let n=0;n<270;n++) {
      const runs=await(await fetch(`http://127.0.0.1:${port}/api/runs`)).json();
      if(runs[0] && runs[0].status!=='running') {ended=runs[0];break;}
      await delay(90);
    }
    assert.ok(ended,`Workflow did not complete: ${logs.join('').slice(-1500)}`);
    // The list API may return a shortened run; fetch complete record.
    const details=await fetch(`http://127.0.0.1:${port}/api/runs/${ended.id}`);
    assert.equal(details.status,200);
    return await details.json();
  } finally {
    if(server) {server.kill('SIGTERM');await delay(70);if(server.exitCode===null)server.kill('SIGKILL');}
    await rm(folder,{recursive:true,force:true});
  }
}

test('agent says no defect: recheck genuine Kane failure on unchanged source and only then pass', {timeout:55000}, async () => {
  const run=await runFixture(false);
  assert.equal(run.status,'passed');
  assert.equal(run.repairs.length,0);
  assert.equal(run.plans.length,1);
  assert.equal(run.plans[0].plan.action,'stop');
  const coupon=run.verification.filter((x)=>x.flowId==='coupon-total');
  assert.deepEqual(coupon.map((x)=>x.verdict),['failed','passed']);
  assert.equal(coupon[1].diagnosticRetry,true);
  assert.ok(run.timeline.some((x)=>x.kind==='kane_disputed_retry'));
  assert.equal(run.iteration,0); // no code repair consumed
});

test('two disputed Kane failures remain inconclusive, never agent-error or a fabricated pass', {timeout:55000}, async () => {
  const run=await runFixture(true);
  assert.equal(run.status,'verification_inconclusive');
  assert.equal(run.repairs.length,0);
  assert.equal(run.plans.length,1);
  const coupon=run.verification.filter((x)=>x.flowId==='coupon-total');
  assert.deepEqual(coupon.map((x)=>x.verdict),['failed','failed']);
  assert.equal(coupon[1].diagnosticRetry,true);
});
