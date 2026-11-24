// v32.3: no slideshow, no waterfall page. Saved runs open in the Live loop view.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,access,rm,cp} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import path from 'node:path';
import os from 'node:os';
import {ROOT} from '../engine/common.mjs';

const fixture=(id,status='passed')=>({
  id,projectId:'app-acme123',appId:'app-acme123',createdAt:'2026-11-17T12:00:00Z',completedAt:'2026-11-17T12:07:00Z',
  request:'Build a form and fix the calculation',status,featureTitle:'Expense Tracker',
  timeline:[
    {at:'2026-11-17T12:00:01Z',kind:'start',title:'Request received',detail:'Build the app'},
    {at:'2026-11-17T12:01:00Z',kind:'agent_plan',title:'Agent authored plan',detail:'Two tasks'},
    {at:'2026-11-17T12:02:00Z',kind:'task_start',title:'Agent coding task 1',detail:'Editing JS'},
    {at:'2026-11-17T12:03:00Z',kind:'kane_fail',title:'Kane found a failure',detail:'Wrong total'},
    {at:'2026-11-17T12:04:00Z',kind:'repair_start',title:'Agent repairing code',detail:'Fix total'},
    {at:'2026-11-17T12:06:00Z',kind:'recheck',title:'Kane retesting',detail:'Same objective'},
    {at:'2026-11-17T12:07:00Z',kind:'success',title:'Kane-verified completion',detail:'Saved after real result'}
  ],tasks:[{id:'task-1',title:'Build interactive form'}],
  verification:[
    {flowId:'feature-check-1',flowName:'Calculate cart',verdict:'failed',finishedAt:'2026-11-17T12:03:01Z',stdoutFile:'fail.ndjson',summary:'Wrong total'},
    {flowId:'feature-check-1',flowName:'Calculate cart',verdict:'passed',finishedAt:'2026-11-17T12:06:45Z',stdoutFile:'pass.ndjson',summary:'Correct total',objectiveHashVerified:true}
  ]
});

test('Studio has no Workflow/waterfall view; saved runs open in the Live loop',async()=>{
 const html=await readFile(new URL('../public/control/index.html',import.meta.url),'utf8');
 const js=await readFile(new URL('../public/control/studio.mjs',import.meta.url),'utf8');
 const server=await readFile(new URL('../server/main.mjs',import.meta.url),'utf8');
 const storage=await readFile(new URL('../engine/storage.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(html,/id="showWorkflow"|Cinematic Replay|Watch replay|data-idea=/);
 assert.match(html,/id="showLiveApp"/);assert.match(html,/id="showAtelier"[^>]*>Live loop</);
 assert.doesNotMatch(js,/showWorkflowInPreview|\/workflow`/);
 assert.match(js,/function selectProjectWorkflow/);assert.match(js,/previewMode='atelier'/);assert.match(js,/\/trace`/);
 assert.doesNotMatch(server,/workflowWaterfallHTML|workflow-waterfall|backfillSavedReplays/);
 assert.doesNotMatch(storage,/queueReplayExport/);
});

test('HTTP receipt, trace and evidence use saved records; the waterfall routes are gone', {timeout:18000},async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'kaneguard-v30-http-'));
 const net=createServer();await new Promise(resolve=>net.listen(0,'127.0.0.1',resolve));
 const port=net.address().port;await new Promise(resolve=>net.close(resolve));
 const id='20261118123456-route1',projectId='app-waterfall123';let child;
 try{
  for(const dir of ['engine','server','public'])await cp(path.join(ROOT,dir),path.join(root,dir),{recursive:true});
  await mkdir(path.join(root,'runs',id),{recursive:true});await mkdir(path.join(root,'configs'));
  const run=fixture(id);run.projectId=run.appId=projectId;
  await writeFile(path.join(root,'runs',id,'record.json'),JSON.stringify(run));
  await writeFile(path.join(root,'runs',id,'fail.ndjson'),'TEST FIXTURE, NOT AN AUTHENTIC KANE RESULT');
  await writeFile(path.join(root,'configs',`${projectId}.json`),JSON.stringify({id:projectId,kind:'playground',label:'Test app',editablePaths:[],flows:[],launchUrl:`/${projectId}/`}));
  let error='';child=spawn(process.execPath,['server/main.mjs'],{cwd:root,env:{...process.env,PORT:String(port)},stdio:['ignore','pipe','pipe']});
  child.stderr.on('data',d=>error+=String(d));
  let ready=false;for(let i=0;i<75;i++){try{const r=await fetch(`http://127.0.0.1:${port}/api/health`);if(r.ok){ready=true;break;}}catch{}await delay(60);}
  assert.ok(ready,error);
  let res=await fetch(`http://127.0.0.1:${port}/api/runs/${id}/workflow`);
  assert.equal(res.status,404);
  res=await fetch(`http://127.0.0.1:${port}/api/projects/${projectId}/workflow`,{redirect:'manual'});
  assert.equal(res.status,404);
  res=await fetch(`http://127.0.0.1:${port}/api/runs/${id}/trace`);
  assert.equal(res.status,200);const trace=await res.json();assert.ok(trace.kane&&trace.diffs);
  res=await fetch(`http://127.0.0.1:${port}/api/runs/${id}/receipt`);
  assert.equal(res.status,200);assert.match(await res.text(),/Trust Receipt/);
  res=await fetch(`http://127.0.0.1:${port}/api/runs/${id}/replay`);
  assert.equal(res.status,404);
  await assert.rejects(()=>access(path.join(root,'judge-replays',id,'index.html')),{code:'ENOENT'});
  res=await fetch(`http://127.0.0.1:${port}/api/evidence/${id}/fail.ndjson`);
  assert.equal(res.status,200);assert.match(await res.text(),/TEST FIXTURE/);
 }finally{
  if(child&&child.exitCode===null){child.kill('SIGTERM');await Promise.race([new Promise(resolve=>child.once('exit',resolve)),delay(1000)]);}
  await rm(root,{recursive:true,force:true});
 }
});
