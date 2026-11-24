import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, mkdir, writeFile, chmod, readFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import os from 'node:os';
import { ROOT } from '../engine/common.mjs';

async function freePort() {
  const server=createServer();
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  await new Promise(resolve=>server.close(resolve));
  return port;
}

// Full HTTP + file writing + independent Kane execution integration. The CLI
// executables are deliberately TEST DOUBLES, not real vendor/Kane binaries.
test('create-your-own-app HTTP: fake Cursor creates isolated app, fake Kane gates tasks and records evidence', {timeout:50000}, async()=>{
  const folder=await mkdtemp(path.join(os.tmpdir(),'kg-v16-project-'));
  const port=await freePort();
  let server;
  const stdio=[];
  try {
    for(const item of ['engine','server','public','configs']) await cp(path.join(ROOT,item),path.join(folder,item),{recursive:true});
    await cp(path.join(ROOT,'package.json'),path.join(folder,'package.json'));
    await mkdir(path.join(folder,'fake-cli'));
    const fakeCursor=path.join(folder,'fake-cli','cursor-double.mjs');
    const fakeKane=path.join(folder,'fake-cli','kane-double.mjs');
    await writeFile(fakeCursor,`#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
const args=process.argv.slice(2);
const prompt=args[args.indexOf('-p')+1]||'';
const cwd=process.cwd(),appId=path.basename(cwd);
const url='http://127.0.0.1:'+process.env.KG_TEST_PORT+'/'+appId+'/';
function emit(content) {process.stdout.write(JSON.stringify({type:'result',subtype:'success',is_error:false,result:content})+'\\n');}
if(prompt.includes('PLAN the creation of a completely new functional web app')) {
  emit(JSON.stringify({featureTitle:'Dynamic Todo App',summary:'Create a new isolated todo application with two independently browser-testable implementation milestones.',tasks:[
    {id:'task-1',title:'Add todo form and list',detail:'Replace the placeholder with an interactive form that adds a todo item to the rendered list.',dependsOn:[],acceptanceIds:['check-1']},
    {id:'task-2',title:'Add completion toggle',detail:'Make list rows interactive so the user can click to toggle completion state on the created task.',dependsOn:['task-1'],acceptanceIds:['check-2']}
  ],acceptance:[
    {id:'check-1',name:'Add a todo item',objective:'Navigate to '+url+' then enter Buy milk in the todo field, click Add item, and verify the visible list contains Buy milk after the action.'},
    {id:'check-2',name:'Complete a todo item',objective:'Navigate to '+url+' then enter Buy milk in the todo field, click Add item, select the new task, and confirm the list displays a completed state for Buy milk.'}
  ]}));
} else if(prompt.includes('CURRENT TASK task-1')) {
  fs.writeFileSync(path.join(cwd,'index.html'),'<!doctype html><html><head><title>Todo</title><link rel="stylesheet" href="./style.css"></head><body><h1>My Todo App</h1><form><input aria-label="Todo"><button>Add item</button></form><ul id="todos"></ul><script type="module" src="./app.js"></script></body></html>');
  fs.writeFileSync(path.join(cwd,'app.js'), 'document.querySelector("form").addEventListener("submit",e=>{e.preventDefault();let li=document.createElement("li");li.textContent=document.querySelector("input").value;document.querySelector("ul").append(li);});\\n');
  emit('Created a new functional todo form and dynamic todo list.');
} else if(prompt.includes('CURRENT TASK task-2')) {
  fs.writeFileSync(path.join(cwd,'app.js'), 'document.querySelector("form").addEventListener("submit",e=>{e.preventDefault();let li=document.createElement("li");li.textContent=document.querySelector("input").value;li.addEventListener("click",()=>li.classList.toggle("completed"));document.querySelector("ul").append(li);});\\n');
  emit('Added task completion toggling.');
} else {process.stderr.write('Unknown Cursor request');process.exit(1)}
`);
    await writeFile(fakeKane,`#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
const args=process.argv.slice(2), url=args[args.indexOf('--url')+1];
const objective=args[1]||'';
const id=new URL(url).pathname.split('/')[1];
const dir=path.join(process.cwd(),'public',id);
const html=fs.readFileSync(path.join(dir,'index.html'),'utf8');
const js=fs.readFileSync(path.join(dir,'app.js'),'utf8');
let passed=html.includes('My Todo App')&&js.includes('append(li)');
if(objective.includes('Complete a todo item'))passed=passed&&js.includes('classList.toggle');
process.stdout.write(JSON.stringify({type:'run_end',status:passed?'passed':'failed',summary:'TEST DOUBLE, no browser run: '+objective.slice(0,100)})+'\\n');
`);
    await chmod(fakeCursor,0o755);await chmod(fakeKane,0o755);
    server=spawn(process.execPath,['server/main.mjs'],{cwd:folder,env:{...process.env,PORT:String(port),KANEGUARD_CURSOR_BIN:fakeCursor,KANE_CLI_BIN:fakeKane,KG_TEST_PORT:String(port)},stdio:['ignore','pipe','pipe']});
    server.stdout.on('data',b=>stdio.push(String(b)));
    server.stderr.on('data',b=>stdio.push(String(b)));
    let ready=false;
    for(let i=0;i<75;i++){
      try {ready=(await fetch(`http://127.0.0.1:${port}/api/health`)).ok;if(ready)break;}catch{}
      await delay(90);
    }
    assert.ok(ready,`server unavailable: ${stdio.join('').slice(-1500)}`);
    const agents=await (await fetch(`http://127.0.0.1:${port}/api/agents`)).json();
    assert.deepEqual(agents.agents.map(a=>a.id),['cursor','antigravity','claude','codex']);
    assert.equal(agents.agents[0].installed,true);
    const submitted=await fetch(`http://127.0.0.1:${port}/api/projects`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({agentId:'cursor',prompt:'Build a small todo app with add and complete interactions'})});
    const receipt=await submitted.json();
    assert.equal(submitted.status,202,JSON.stringify(receipt));
    assert.match(receipt.project.id,/^app-/);
    const projectId=receipt.project.id;
    let completed=null;
    for(let i=0;i<250;i++){
      await delay(110);
      const result=await (await fetch(`http://127.0.0.1:${port}/api/runs`)).json();
      const run=result.find(x=>x.projectId===projectId);
      if(run&&run.status!=='running'){completed=run;break;}
    }
    assert.ok(completed,`run never completed: ${stdio.join('').slice(-2000)}`);
    assert.equal(completed.status,'passed',`run ${completed.status}: ${stdio.join('').slice(-2000)} ${completed.failure?.summary||''}`);
    assert.equal(completed.agentId,'cursor');
    assert.equal(completed.projectId,projectId);
    assert.equal(completed.previewUrl,`/${projectId}/`);
    assert.deepEqual(completed.tasks.map(t=>t.status),['verified','verified']);
    assert.ok(completed.verification.some(v=>v.verdict==='passed'));
    assert.equal(completed.reusedVerification.filter(v=>v.gate==='Final full suite').length,1);
    const preview=await fetch(`http://127.0.0.1:${port}/${projectId}/`);
    assert.equal(preview.status,200);
    assert.match(await preview.text(),/My Todo App/);
    const app=await fetch(`http://127.0.0.1:${port}/${projectId}/app.js`);
    assert.equal(app.status,200);
    assert.match(await app.text(),/classList.toggle/);
    const projects=await (await fetch(`http://127.0.0.1:${port}/api/projects`)).json();
    assert.equal(projects.find(p=>p.id===projectId)?.status,'passed');
    const appConfig=JSON.parse(await readFile(path.join(folder,'configs',projectId+'.json'),'utf8'));
    assert.deepEqual(appConfig.flows,[]);
    assert.equal(appConfig.kind,'playground');
    const evidence=await fetch(`http://127.0.0.1:${port}/api/evidence/${completed.id}/feature-plan.json`);
    assert.equal(evidence.status,200);
  }finally{
    if(server&&server.exitCode===null){server.kill('SIGTERM');await Promise.race([new Promise(r=>server.once('exit',r)),delay(1300)]);}
    await rm(folder,{recursive:true,force:true});
  }
});
