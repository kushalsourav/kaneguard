import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {buildFeaturePlanRequest, implementFeatureTask} from '../engine/feature-agent.mjs';

const base={id:'app-test23',kind:'connected',framework:'Next.js',projectDir:'/tmp/connected-project',url:'http://127.0.0.1:3000/',agentId:'cursor'};
const plan={featureTitle:'Navbar improvements',summary:'Polish the existing navbar',tasks:[{id:'task-1',title:'Improve navigation',detail:'Make nav accessible',dependsOn:[],acceptanceIds:['check-1']}],acceptance:[{id:'check-1',name:'Navigation works',objective:'Navigate to the app and verify the navigation link works.'}]};

test('existing app planner keeps vague prompts scoped and forbids fabricated login credentials',()=>{
  const text=buildFeaturePlanRequest(base,'improve the navbar','FILE connected/app-test23/app/page.tsx\n<nav>Home</nav>');
  assert.match(text,/SCOPE CONTROL/);
  assert.match(text,/not permission to add authentication/);
  assert.match(text,/Never invent email addresses, passwords/);
  assert.match(text,/Keep its framework, files, dependencies/);
  assert.match(text,/375px/);
});

test('connected and generated tasks receive a 30-minute default',async()=>{
  const runDir=await mkdtemp(path.join(os.tmpdir(),'kg-v23-timeout-'));
  const prior=process.env.KANEGUARD_TASK_TIMEOUT_MS;
  delete process.env.KANEGUARD_TASK_TIMEOUT_MS;
  const limits=[];
  const runner=async (_binary,_args,options)=>{
    limits.push(options.timeoutMs);
    return {timedOut:true,code:null,stdout:'',stderr:'error: interrupted',durationMs:options.timeoutMs};
  };
  try{
    const connected=await implementFeatureTask(base,'improve the navbar',plan,plan.tasks[0],[],runDir,()=>{},{runner});
    const generated=await implementFeatureTask({...base,kind:'playground'},'improve the navbar',plan,plan.tasks[0],[],runDir,()=>{},{runner});
    assert.deepEqual(limits,[1_800_000,1_800_000]);
    assert.equal(connected.ok,false);
    assert.equal(connected.recoverableTimeout,true);
    assert.match(connected.summary,/30-minute coding time limit/);
    assert.match(generated.summary,/30-minute coding time limit/);
    assert.match(await readFile(path.join(runDir,'feature-task-task-1-agent.stderr.log'),'utf8'),/interrupted/);
  }finally{
    if(prior===undefined)delete process.env.KANEGUARD_TASK_TIMEOUT_MS;
    else process.env.KANEGUARD_TASK_TIMEOUT_MS=prior;
    await rm(runDir,{recursive:true,force:true});
  }
});


test('custom task timeout accepts 45 minutes, clamps at 60, and keeps malformed input bounded',async()=>{
  const runDir=await mkdtemp(path.join(os.tmpdir(),'kg-v313-timeout-'));
  const prior=process.env.KANEGUARD_TASK_TIMEOUT_MS;
  const observed=[];
  const runner=async (_binary,_args,options)=>{
    observed.push(options.timeoutMs);
    return {timedOut:true,code:null,stdout:'',stderr:'error: interrupted',durationMs:options.timeoutMs};
  };
  try{
    for (const value of ['2700000','7200000','not-a-number']) {
      process.env.KANEGUARD_TASK_TIMEOUT_MS=value;
      await implementFeatureTask({...base,kind:'playground'},'improve the navbar',plan,plan.tasks[0],[],runDir,()=>{},{runner});
    }
    assert.deepEqual(observed,[2_700_000,3_600_000,1_800_000]);
  }finally{
    if(prior===undefined)delete process.env.KANEGUARD_TASK_TIMEOUT_MS;
    else process.env.KANEGUARD_TASK_TIMEOUT_MS=prior;
    await rm(runDir,{recursive:true,force:true});
  }
});
