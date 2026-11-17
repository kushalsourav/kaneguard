import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,cp,chmod} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {ROOT} from '../engine/common.mjs';
import {inspectLocalProject,connectExistingProject,disconnectExistingProject,startConnectedPreview,stopConnectedPreview,allowedScope} from '../engine/connected-projects.mjs';
import {connectedSnapshot,snapshot,reviewAndGuard,isPermittedSourceChange} from '../engine/snapshot.mjs';
import {projectSourceVersion} from '../engine/project-source-version.mjs';
import {agentWorkspace} from '../engine/adapters.mjs';

async function port(){const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const value=server.address().port;await new Promise(r=>server.close(r));return value;}
async function fixture(base) {
  const folder=path.join(base,'projects','sample-ui');
  await mkdir(path.join(folder,'app'),{recursive:true});
  await writeFile(path.join(folder,'package.json'),JSON.stringify({name:'sample-next-ui',scripts:{dev:'node mock-server.cjs'},dependencies:{next:'16.0.0'}}));
  await writeFile(path.join(folder,'app','page.tsx'),'export default function Page(){return <h1>Original application</h1>}\n');
  await writeFile(path.join(folder,'mock-server.cjs'),`require('node:http').createServer((_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<h1>Actual existing app preview</h1>')}).listen(Number(process.env.PORT),'127.0.0.1');`);
  await writeFile(path.join(folder,'.env.local'),'SUPER_SECRET=should_not_enter_evidence');
  await mkdir(path.join(folder,'node_modules'),{recursive:true});
  await writeFile(path.join(folder,'node_modules','hidden.js'),'private');
  return folder;
}

test('attached Next.js project: inspect, code scope, local preview, disconnect never deletes source', {timeout:24000},async()=>{
  const home=await mkdtemp(path.join(os.tmpdir(),'kg-v22-home-'));
  const root=path.join(home,'kaneguard');await mkdir(root);
  const folder=await fixture(home);
  let conn;
  try {
    const inspected=await inspectLocalProject(folder,{home,repoRoot:root});
    assert.equal(inspected.framework,'Next.js');assert.equal(inspected.script,'dev');
    await assert.rejects(inspectLocalProject(home,{home,repoRoot:root}),/beneath/);
    await assert.rejects(inspectLocalProject(root,{home,repoRoot:root}),/KaneGuard/);
    await assert.rejects(inspectLocalProject(path.join(folder,'node_modules'),{home,repoRoot:root}),/package.json|Protected|dependency/i);
    conn=await connectExistingProject({folder},{root,home,repoRoot:root});
    assert.equal(conn.kind,'connected');
    const cfg=JSON.parse(await readFile(path.join(root,'configs',conn.id+'.json'),'utf8'));
    assert.equal(agentWorkspace(cfg),folder);
    assert.equal(allowedScope(cfg),`connected/${conn.id}/**`);
    const snap=await connectedSnapshot(cfg);
    assert.ok(snap.has(`connected/${conn.id}/app/page.tsx`));
    assert.ok(![...snap.keys()].some(key=>key.includes('node_modules')||key.includes('.env')));
    assert.equal(isPermittedSourceChange(`connected/${conn.id}/app/page.tsx`,[allowedScope(cfg)]),true);
    assert.equal(isPermittedSourceChange(`connected/${conn.id}/package.json`,[allowedScope(cfg)]),false);
    const started=await startConnectedPreview(cfg,{timeoutMs:7000});
    assert.equal(started.status,'running');
    assert.match(await (await fetch(cfg.url)).text(),/Actual existing app preview/);
    const first=await projectSourceVersion(conn.id,{root});
    await writeFile(path.join(folder,'app','page.tsx'),'export default function Page(){return <h1>Changed by agent</h1>}\n');
    const second=await projectSourceVersion(conn.id,{root});
    assert.notEqual(first.version,second.version);
    // Disallowed modification is actually reverted without deleting the project.
    const before=await snapshot({config:cfg});
    await writeFile(path.join(folder,'package.json'),'{}');
    await writeFile(path.join(folder,'app','new.tsx'),'export const added = true;\n');
    const review=await reviewAndGuard(before,[allowedScope(cfg)],{config:cfg});
    assert.ok(review.rejected.some(key=>key.endsWith('/package.json')));
    assert.ok(review.changed.some(key=>key.endsWith('/app/new.tsx')));
    assert.equal(JSON.parse(await readFile(path.join(folder,'package.json'),'utf8')).name,'sample-next-ui');
    const disconnected=await disconnectExistingProject(conn.id,{root});
    assert.equal(disconnected.sourcePreserved,true);
    assert.match(await readFile(path.join(folder,'app','page.tsx'),'utf8'),/Changed by agent/);
    await assert.rejects(readFile(path.join(root,'configs',conn.id+'.json')),/ENOENT/);
  } finally {
    if(conn)await stopConnectedPreview(conn.id);
    await rm(home,{recursive:true,force:true});
  }
});

test('HTTP: attached Next-style project runs genuine controller sequence with controlled CLI doubles', {timeout:60000},async()=>{
  const home=await mkdtemp(path.join(os.tmpdir(),'kg-v22-http-'));
  const root=path.join(home,'kaneguard'),folder=await fixture(home);
  const serverPort=await port();
  let server;const log=[];
  try {
    for(const dir of ['engine','server','public','configs'])await cp(path.join(ROOT,dir),path.join(root,dir),{recursive:true});
    await cp(path.join(ROOT,'package.json'),path.join(root,'package.json'));
    const bin=path.join(home,'fake-bin');await mkdir(bin);
    const fakeCursor=path.join(bin,'agent.cjs');const fakeKane=path.join(bin,'kane.cjs');
    await writeFile(fakeCursor,`#!/usr/bin/env node
const fs=require('node:fs'), path=require('node:path');
const args=process.argv.slice(2), prompt=args[args.indexOf('-p')+1]||'';
const source=path.join(process.cwd(),'app','page.tsx');
const url=prompt.includes('App start URL: ') ? prompt.split('App start URL: ')[1].split(';')[0].split('\\n')[0].trim() : process.env.KG_EXPECTED_URL;
const success=(result)=>process.stdout.write(JSON.stringify({type:'result',subtype:'success',is_error:false,result})+'\\n');
if(prompt.includes('PLAN a real feature for an existing web app')) {
 success(JSON.stringify({featureTitle:'Connected UI Improvement',summary:'Improve the existing Next UI through two linked tasks',tasks:[
 {id:'task-1',title:'Add welcome banner to existing Next page',detail:'Preserve the Next route and add a welcome headline to the application page.',dependsOn:[],acceptanceIds:['check-1']},
 {id:'task-2',title:'Make new status visible',detail:'Update existing page with a clear status description while preserving existing text.',dependsOn:['task-1'],acceptanceIds:['check-2']}],
 acceptance:[{id:'check-1',name:'Welcome banner',objective:'Navigate to '+url+' and observe the new Welcome section showing a visible heading.'},
 {id:'check-2',name:'Status message',objective:'Navigate to '+url+' and verify the page contains both Welcome and Connected status details.'}]}));
} else if(prompt.includes('CURRENT TASK task-1')) {
 fs.writeFileSync(source,'export default function Page(){return <h1>Welcome Connected UI</h1>}\\n');success('Updated existing Next route');
} else if(prompt.includes('CURRENT TASK task-2')) {
 fs.writeFileSync(source,'export default function Page(){return <><h1>Welcome Connected UI</h1><p>Connected status</p></>}\\n');success('Added status to Next route');
} else {console.error('Unexpected prompt');process.exit(1)}
`);
    await writeFile(fakeKane,`#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(process.env.KG_EXISTING_PROJECT,'app','page.tsx'),'utf8');
const args=process.argv.slice(2),objective=args[1]||'';
const passed=source.includes('Welcome Connected UI') && (!objective.includes('Status message')||source.includes('Connected status'));
process.stdout.write(JSON.stringify({type:'run_end',status:passed?'passed':'failed',summary:'TEST DOUBLE only, no real Chrome: verified source corresponding to '+objective.slice(0,60)})+'\\n');
`);
    await chmod(fakeCursor,0o755);await chmod(fakeKane,0o755);
    // Existing preview is a real HTTP service, served by npm run dev (mock app, not a real Next compiler).
    const env={...process.env,HOME:home,PORT:String(serverPort),KANEGUARD_CURSOR_BIN:fakeCursor,KANE_CLI_BIN:fakeKane,
      KG_EXISTING_PROJECT:folder,KG_EXPECTED_URL:'http://127.0.0.1:UNSET/'};
    server=spawn(process.execPath,['server/main.mjs'],{cwd:root,env,stdio:['ignore','pipe','pipe']});
    server.stdout.on('data',b=>log.push(String(b)));server.stderr.on('data',b=>log.push(String(b)));
    let ready=false;for(let i=0;i<100;i++){try{ready=(await fetch(`http://127.0.0.1:${serverPort}/api/health`)).ok;if(ready)break;}catch{}await delay(90);}
    assert.ok(ready,'server not ready: '+log.join('').slice(-1200));
    const post=async(route,data)=>{
      const r=await fetch(`http://127.0.0.1:${serverPort}${route}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
      return {status:r.status,body:await r.json()};
    };
    const inspect=await post('/api/connected/inspect',{folder});
    assert.equal(inspect.status,200,JSON.stringify(inspect.body));
    assert.equal(inspect.body.framework,'Next.js');
    const attach=await post('/api/connected',{folder,agentId:'cursor'});
    assert.equal(attach.status,201,JSON.stringify(attach.body));
    const id=attach.body.project.id;
    const source=await (await fetch(`http://127.0.0.1:${serverPort}/api/projects/${id}/source-version`)).json();
    assert.match(source.version,/^[a-f0-9]{24}$/);
    const projectCfg=JSON.parse(await readFile(path.join(root,'configs',id+'.json'),'utf8'));
    // Tell the controlled planner exactly which HTTP preview the real Kane call will use.
    // source of truth remains config.url (no hardcoded next port).
    await writeFile(path.join(root,'configs',id+'.json'),JSON.stringify(projectCfg));
    const cliEnvUrl=projectCfg.url;
    // The controlled planner reads the actual preview URL in its provided context.
    const start=await post('/api/build',{appId:id,prompt:'Improve the connected UI with welcome and status',agentId:'cursor'});
    assert.equal(start.status,202,JSON.stringify(start.body));
    let final;
    for(let i=0;i<270;i++){await delay(110);const result=await (await fetch(`http://127.0.0.1:${serverPort}/api/runs`)).json();const r=result.find(x=>x.projectId===id);if(r&&r.status!=='running'){final=r;break;}}
    assert.ok(final,'run never completed: '+log.join('').slice(-1400));
    assert.equal(final.status,'passed',JSON.stringify({failure:final.failure,stage:final.stage,log:log.join('').slice(-1000)}));
    assert.deepEqual(final.tasks.map(t=>t.status),['verified','verified']);
    assert.equal(final.projectId,id);
    assert.equal(final.previewUrl,cliEnvUrl);
    const content=await readFile(path.join(folder,'app','page.tsx'),'utf8');
    assert.match(content,/Connected status/);
    const projects=await (await fetch(`http://127.0.0.1:${serverPort}/api/projects`)).json();
    assert.equal(projects.find(x=>x.id===id)?.kind,'connected');
    assert.ok(final.verification.filter(v=>v.verdict==='passed').length>=2);
    const disconnect=await fetch(`http://127.0.0.1:${serverPort}/api/projects/${id}`,{method:'DELETE'});
    assert.equal(disconnect.status,200);
    assert.equal((await disconnect.json()).sourcePreserved,true);
    assert.match(await readFile(path.join(folder,'app','page.tsx'),'utf8'),/Connected status/);
    const saved=await (await fetch(`http://127.0.0.1:${serverPort}/api/runs/${final.id}`)).json();
    assert.equal(saved.id,final.id,'disconnect preserves run evidence');
  } finally {
    if(server&&server.exitCode===null){server.kill('SIGTERM');await Promise.race([new Promise(r=>server.once('exit',r)),delay(1600)]);}
    await rm(home,{recursive:true,force:true});
  }
});
