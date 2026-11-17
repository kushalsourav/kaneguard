import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, access, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import os from 'node:os';
import { ROOT } from '../engine/common.mjs';
import { reconcileAbandonedRuns, deleteGeneratedProject, deleteSavedRun } from '../engine/project-management.mjs';

const baseRun=(id,projectId,status='running')=>({id,appId:projectId,projectId,status,stage:'implementing',createdAt:'2026-11-17T08:00:00.000Z',completedAt:null,timeline:[{at:'2026-11-17T08:00:00.000Z',kind:'start',title:'Plan started'}],tasks:[{id:'task-1',status:'verified'},{id:'task-2',status:'implementing'}],verification:[{flowId:'check-1',verdict:'passed',stdoutFile:'kane-1.ndjson'}]});
async function setup(){
  const root=await mkdtemp(path.join(os.tmpdir(),'kaneguard-v20-'));
  for(const dir of ['configs','public','runs'])await mkdir(path.join(root,dir));
  return root;
}
async function save(root,run){
  await mkdir(path.join(root,'runs',run.id));
  await writeFile(path.join(root,'runs',run.id,'record.json'),JSON.stringify(run));
  await writeFile(path.join(root,'runs',run.id,'kane-1.ndjson'),'REAL-SAVED-EVIDENCE');
}
async function absent(file){await assert.rejects(()=>access(file),{code:'ENOENT'});}

test('server restart preserves every existing Kane verdict but changes orphaned running build to interrupted',async()=>{
  const root=await setup();
  try {
    const projectId='app-example123';
    await save(root,baseRun('20261117080000-demo1',projectId));
    await save(root,baseRun('20261117080000-demo2',projectId,'passed'));
    const touched=await reconcileAbandonedRuns({root,at:'2026-11-17T08:30:00.000Z'});
    assert.deepEqual(touched,['20261117080000-demo1']);
    const data=JSON.parse(await readFile(path.join(root,'runs','20261117080000-demo1','record.json')));
    assert.equal(data.status,'interrupted');assert.equal(data.stage,'finished');
    assert.equal(data.tasks[0].status,'verified');assert.equal(data.tasks[1].status,'interrupted');
    assert.equal(data.verification[0].verdict,'passed');
    assert.equal(await readFile(path.join(root,'runs',data.id,'kane-1.ndjson'),'utf8'),'REAL-SAVED-EVIDENCE');
    assert.deepEqual(await reconcileAbandonedRuns({root}),[]);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('delete project removes only its source, config, and all related evidence, never protected example apps',async()=>{
  const root=await setup();
  try {
    const id='app-example123', another='app-another123';
    for(const projectId of [id,another]){
      await mkdir(path.join(root,'public',projectId));
      await writeFile(path.join(root,'public',projectId,'index.html'),'<h1>app</h1>');
      await writeFile(path.join(root,'configs',projectId+'.json'),JSON.stringify({id:projectId,kind:'playground'}));
    }
    await save(root,baseRun('20261117080000-demo1',id));
    await save(root,baseRun('20261117080000-demo2',id,'passed'));
    await save(root,baseRun('20261117080000-demo3',another,'failed'));
    await writeFile(path.join(root,'configs','cartlab.json'),JSON.stringify({id:'cartlab',kind:'example'}));
    await assert.rejects(()=>deleteGeneratedProject('cartlab',{root}),/Only generated projects/);
    await assert.rejects(()=>deleteGeneratedProject('../evil',{root}),/Only generated projects/);
    const result=await deleteGeneratedProject(id,{root});
    assert.deepEqual(result.deletedRuns,['20261117080000-demo1','20261117080000-demo2']);
    await absent(path.join(root,'public',id));await absent(path.join(root,'configs',id+'.json'));
    await absent(path.join(root,'runs','20261117080000-demo1'));
    await access(path.join(root,'runs','20261117080000-demo3','kane-1.ndjson'));
    await access(path.join(root,'public',another,'index.html'));
    await access(path.join(root,'configs','cartlab.json'));
  }finally{await rm(root,{recursive:true,force:true});}
});

test('delete a single saved run deletes evidence but keeps the app project',async()=>{
  const root=await setup();
  try {
    const id='app-example123',runId='20261117080000-demo1';
    await mkdir(path.join(root,'public',id));await writeFile(path.join(root,'public',id,'index.html'),'keep');
    await save(root,baseRun(runId,id,'failed'));
    assert.deepEqual(await deleteSavedRun(runId,{root}),{deletedRun:runId,projectId:id});
    await absent(path.join(root,'runs',runId));
    assert.equal(await readFile(path.join(root,'public',id,'index.html'),'utf8'),'keep');
    await assert.rejects(()=>deleteSavedRun('../wrong',{root}),/Invalid run ID/);
  }finally{await rm(root,{recursive:true,force:true});}
});

async function freePort(){const net=createServer();await new Promise(r=>net.listen(0,'127.0.0.1',r));const port=net.address().port;await new Promise(r=>net.close(r));return port;}
test('HTTP delete endpoints and startup recovery operate on saved data, with no fake Kane results', {timeout:20000}, async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'kaneguard-v20-server-'));
  const port=await freePort();let processHandle;
  try {
    for(const dir of ['engine','server','public','configs']){
      const {cp}=await import('node:fs/promises');await cp(path.join(ROOT,dir),path.join(root,dir),{recursive:true});
    }
    await mkdir(path.join(root,'runs'));
    const id='app-httptest123';
    await mkdir(path.join(root,'public',id));await writeFile(path.join(root,'public',id,'index.html'),'hello');
    await writeFile(path.join(root,'configs',id+'.json'),JSON.stringify({id,kind:'playground',label:'Demo',launchUrl:`/${id}/`,editablePaths:[],flows:[]}));
    await save(root,baseRun('20261117080000-http1',id));
    const messages=[];
    processHandle=spawn(process.execPath,['server/main.mjs'],{cwd:root,env:{...process.env,PORT:String(port)},stdio:['ignore','pipe','pipe']});
    processHandle.stderr.on('data',b=>messages.push(String(b)));
    let started=false;
    for(let i=0;i<100;i++){
      try {const response=await fetch(`http://127.0.0.1:${port}/api/runs`);if(response.ok){const records=await response.json();if(records[0]?.status==='interrupted'){started=true;break;}}}catch{}
      await delay(80);
    }
    assert.equal(started,true,`Startup failed: ${messages.join('')}`);
    let res=await fetch(`http://127.0.0.1:${port}/api/projects/${id}`,{method:'DELETE'});
    assert.equal(res.status,200,await res.text());
    res=await fetch(`http://127.0.0.1:${port}/${id}/`);assert.equal(res.status,404);
    res=await fetch(`http://127.0.0.1:${port}/api/evidence/20261117080000-http1/kane-1.ndjson`);assert.equal(res.status,404);
    res=await fetch(`http://127.0.0.1:${port}/api/projects/cartlab`,{method:'DELETE'});assert.notEqual(res.status,200);
  }finally {
    if(processHandle && processHandle.exitCode===null){processHandle.kill('SIGTERM');await Promise.race([new Promise(r=>processHandle.once('exit',r)),delay(1000)]);}
    await rm(root,{recursive:true,force:true});
  }
});
