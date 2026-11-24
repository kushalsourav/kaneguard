import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,cp,mkdir,writeFile,chmod,readFile,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import path from 'node:path';import os from 'node:os';
import {ROOT} from '../engine/common.mjs';
// Every CLI in this test is a test double, NOT authenticated Kane or agent activity.
async function port(){const s=createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const n=s.address().port;await new Promise(r=>s.close(r));return n;}
for (const alwaysFails of [false,true]) test(`v31.1 browser-agent misstep ${alwaysFails ? 'remains INCONCLUSIVE after one retry' : 'passes on genuine second Kane result'}`, {timeout:45000},async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'kg-v311-misstep-'));const serverPort=await port();let server;let logs='';
  try{
    for(const name of ['engine','server','public','configs'])await cp(path.join(ROOT,name),path.join(dir,name),{recursive:true});
    await cp(path.join(ROOT,'package.json'),path.join(dir,'package.json'));
    const cfgFile=path.join(dir,'configs','cartlab.json');const cfg=JSON.parse(await readFile(cfgFile,'utf8'));
    cfg.url=`http://127.0.0.1:${serverPort}/cartlab/`;await writeFile(cfgFile,JSON.stringify(cfg));
    const bin=path.join(dir,'fake-bin');await mkdir(bin);
    const builder=path.join(bin,'builder.mjs'),examiner=path.join(bin,'examiner.mjs'),kane=path.join(bin,'kane.mjs');
    await writeFile(builder,`#!/usr/bin/env node
import fs from 'node:fs';const args=process.argv.slice(2),prompt=args[args.indexOf('-p')+1]||'';
const output=x=>process.stdout.write(JSON.stringify({event:'result',result:{status:'SUCCESS',response:typeof x==='string'?x:JSON.stringify(x)}})+'\\n');
const url='http://127.0.0.1:'+process.env.KG_TEST_PORT+'/cartlab/';
if(prompt.includes('PLAN a real feature'))output({featureTitle:'Demo change',summary:'Create two separate browser interactions and independently check them with different Kane flows.',tasks:[{id:'task-a',title:'First browser interaction',detail:'Implement a visible first demo action with an independently inspectable browser result.',acceptanceIds:['check-a']},{id:'task-b',title:'Second browser interaction',detail:'Implement a visible second demo action while preserving the first result.',dependsOn:['task-a'],acceptanceIds:['check-b']}],acceptance:[{id:'check-a',name:'First browser check',objective:'Navigate to '+url+' and click first-demo action. Verify the first browser result is visible on the page after the click and remains correct.'},{id:'check-b',name:'Second browser check',objective:'Navigate to '+url+' and click second-demo action. Verify the second browser result appears after the click and remains correct.'}]});
else if(prompt.includes('CURRENT TASK task-a')){fs.writeFileSync('public/cartlab/v31-demo-a.mjs','export const a=1;\\n');output('First task saved');}
else if(prompt.includes('CURRENT TASK task-b')){fs.writeFileSync('public/cartlab/v31-demo-b.mjs','export const b=2;\\n');output('Second task saved');}
else{process.stderr.write('Builder must not diagnose or repair a classified test defect');process.exit(42)}
`);
    await writeFile(examiner,`#!/usr/bin/env node
const args=process.argv.slice(2),prompt=args[args.indexOf('-p')+1]||'';
const url='http://127.0.0.1:'+process.env.KG_TEST_PORT+'/cartlab/';
if(prompt.includes('PLAN a real feature')){
const plan={featureTitle:'Demo change',summary:'Create two separate browser interactions and independently check them with different Kane flows.',tasks:[{id:'task-a',title:'First browser interaction',detail:'Implement a visible first demo action with an independently inspectable browser result.',acceptanceIds:['check-a']},{id:'task-b',title:'Second browser interaction',detail:'Implement a visible second demo action while preserving the first result.',dependsOn:['task-a'],acceptanceIds:['check-b']}],acceptance:[{id:'check-a',name:'First browser check',objective:'Navigate to '+url+' and click first-demo action. Verify the first browser result is visible on the page after the click and remains correct.'},{id:'check-b',name:'Second browser check',objective:'Navigate to '+url+' and click second-demo action. Verify the second browser result appears after the click and remains correct.'}]};
process.stdout.write(JSON.stringify({type:'result',subtype:'success',is_error:false,result:JSON.stringify(plan)})+'\\n');process.exit(0);
}
if(!prompt.includes('READ-ONLY KaneGuard TEST EXAMINER'))process.exit(13);
const review={finding:'test_defect',confidence:'high',rationale:'The test double reported a failure even though the visible action result was correct, so the test assumption must be reviewed before changing source.',evidenceNotes:['Fake browser log reports a deliberate test mismatch.'],proposedObjective:'Navigate to '+url+' and click second-demo action. Verify the resulting second browser result text appears and matches the value shown on the actual page after the action.'};
process.stdout.write(JSON.stringify({type:'result',subtype:'success',is_error:false,result:JSON.stringify(review)})+'\\n');
`);
    await writeFile(kane,`#!/usr/bin/env node
import fs from 'node:fs';
const objective=process.argv[3]||'';
const targeted=objective.includes('second-demo action');
const countFile=process.env.KG_MISSTEP_COUNTER;
let count=0;
if(targeted){try{count=Number(fs.readFileSync(countFile,'utf8'));}catch{}fs.writeFileSync(countFile,String(count+1));}
const fail=targeted && (process.env.KG_MISSTEP_ALWAYS_FAIL==='yes'||count===0);
process.stdout.write(JSON.stringify({type:'run_end',status:fail?'failed':'passed',
  summary:fail?'TEST DOUBLE: browser agent forgot to click filter, not an app defect':'TEST DOUBLE: browser run passed',
  verdict:fail?{family:'automation_bug',category:'agent_misstep',confirmed:false}:null})+'\\n');
`);
    for(const x of [builder,examiner,kane])await chmod(x,0o755);
    server=spawn(process.execPath,['server/main.mjs'],{cwd:dir,env:{...process.env,PORT:String(serverPort),KG_TEST_PORT:String(serverPort),KANEGUARD_AGENT_BIN:builder,KANEGUARD_CURSOR_BIN:examiner,KANE_CLI_BIN:kane,KG_MISSTEP_COUNTER:path.join(dir,'misstep-counter.txt'),KG_MISSTEP_ALWAYS_FAIL:alwaysFails?'yes':'no'},stdio:['ignore','pipe','pipe']});
    server.stdout.on('data',v=>logs+=String(v));server.stderr.on('data',v=>logs+=String(v));
    const base=`http://127.0.0.1:${serverPort}`;let started=false;
    for(let i=0;i<80;i++){try{if((await fetch(`${base}/api/health`)).ok){started=true;break}}catch{}await delay(60);}
    assert.equal(started,true,logs.slice(-1000));
    const response=await fetch(`${base}/api/build`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({appId:'cartlab',prompt:'Build two independent browser demo interactions',agentId:'antigravity',examinerAgentId:'cursor'})});
    assert.equal(response.status,202,await response.text());
    let run;
    for(let i=0;i<240;i++){const list=await(await fetch(`${base}/api/runs`)).json();if(list[0]?.status!=='running'&&list[0]){run=list[0];break;}await delay(75);}
    assert.ok(run,logs.slice(-2200));
    assert.equal(run.status,alwaysFails?'verification_inconclusive':'passed',JSON.stringify(run.timeline?.at(-1)));
    assert.equal(run.examinerAgentId,'cursor');assert.equal(run.agentId,'antigravity');
    assert.equal(run.repairs.length,0,'Kane automation missteps must never invoke source repair');
    assert.equal(run.examinerReviews.length,0,'Kane structured missteps retry without needing examiner');
    const second=run.verification.filter(v=>v.flowId==='feature-check-b');
    assert.equal(second.length,2,'two real CLI invocations expected, initial + one retry');
    assert.deepEqual(second.map(v=>v.verdict),alwaysFails?['failed','failed']:['failed','passed']);
    assert.equal(second[0].automationMisstepRetry,undefined);
    assert.equal(second[1].automationMisstepRetry,true);
    assert.equal(second[0].objective,second[1].objective,'the sealed objective must remain unchanged');
    assert.equal(second[0].objectiveHash,second[1].objectiveHash);
    assert.equal(second[1].objectiveHashVerified,true);
    const original=run.objectiveSeals.find(v=>v.id==='check-b');assert.ok(original);
    assert.equal(original.sha256,second[1].objectiveHash);
    assert.ok(run.timeline.some(e=>e.kind==='kane_agent_misstep_retry'));
    assert.equal((await readFile(path.join(dir,'misstep-counter.txt'),'utf8')).trim(),'2');
    if(alwaysFails){
      assert.ok(run.timeline.some(e=>e.kind==='kane_automation_inconclusive'));
      assert.equal(run.failure?.verdict,'failed');
      assert.equal(run.verification.some(v=>v.flowId==='feature-check-b'&&v.verdict==='passed'),false);
    }else{
      assert.ok(run.timeline.some(e=>e.kind==='kane_pass'));
      assert.equal(run.failure,null);
    }
  }finally{
    if(server&&!server.killed){server.kill('SIGTERM');await Promise.race([new Promise(r=>server.once('exit',r)),delay(1200)]);}
    await rm(dir,{recursive:true,force:true});
  }
});
