import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {AGENTS,agentCommand,decodeAgent,validateAgent,invokeAgent,agentAvailability} from '../engine/adapters.mjs';
import {createProject,projectTitle} from '../engine/projects.mjs';

const jsonl=(...items)=>items.map((x)=>JSON.stringify(x)).join('\n')+'\n';
const ok={code:0,timedOut:false,spawnError:null,stderr:'',durationMs:1};
const failed={...ok,code:2};

test('four distinct actual headless adapters have scoped commands and no dangerous permission bypass',()=>{
  assert.deepEqual(AGENTS.map((a)=>a.id),['cursor','antigravity','claude','codex']);
  const projectDir='/tmp/app-test';
  for(const agent of AGENTS){
    const spec=agentCommand(agent.id,'Build the app',{projectDir});
    assert.equal(spec.cwd,projectDir);
    assert.ok(spec.args.includes('Build the app'));
    assert.ok(spec.args.includes('stream-json')||spec.args.includes('--json'));
    assert.ok(!spec.args.includes('--dangerously-skip-permissions'));
    assert.ok(!spec.args.includes('danger-full-access'));
  }
  assert.ok(agentCommand('codex','x',{projectDir}).args.includes('workspace-write'));
  assert.ok(agentCommand('claude','x',{projectDir}).args.includes('acceptEdits'));
  assert.throws(()=>validateAgent('not-a-real-agent'),/Choose/);
});

test('provider-specific terminal success is required and outputs are extracted',()=>{
  const fixtures={
    antigravity:jsonl({event:'init'}, {event:'result',result:{status:'SUCCESS',response:'Agent plan JSON'}}),
    cursor:jsonl({type:'assistant',message:{content:[{type:'text',text:'Agent plan JSON'}]}},{type:'result',subtype:'success',is_error:false,result:'Agent plan JSON'}),
    claude:jsonl({type:'assistant',message:{content:[{type:'text',text:'Agent plan JSON'}]}},{type:'result',subtype:'success',is_error:false,result:'Agent plan JSON'}),
    codex:jsonl({type:'item.completed',item:{type:'agent_message',text:'Agent plan JSON'}},{type:'turn.completed',usage:{}})
  };
  for(const [agentId,data] of Object.entries(fixtures)){
    const decoded=decodeAgent(agentId,data,ok);
    assert.equal(decoded.ok,true,agentId);
    assert.equal(decoded.response,'Agent plan JSON',agentId);
    assert.equal(decodeAgent(agentId,data,failed).ok,false,agentId);
    assert.equal(decodeAgent(agentId,data.split('\n')[0],ok).ok,false,`${agentId} missing terminal`);
  }
  assert.equal(decodeAgent('cursor',jsonl({type:'result',subtype:'success',is_error:true,result:'Not allowed'}),ok).ok,false);
  assert.equal(decodeAgent('cursor',jsonl({type:'result',subtype:'partial',is_error:false,result:'Partial'}),ok).ok,false);
  assert.equal(decodeAgent('codex',jsonl({type:'turn.failed'}),ok).ok,false);
  assert.equal(decodeAgent('claude',jsonl({type:'result',subtype:'error_max_turns',is_error:true}),ok).ok,false);
});

test('all adapters use a runnable injection point and stream actual vendor events',async()=>{
  const wanted={antigravity:jsonl({event:'result',result:{status:'SUCCESS',response:'finished'}}),cursor:jsonl({type:'result',subtype:'success',is_error:false,result:'finished'}),claude:jsonl({type:'result',subtype:'success',result:'finished'}),codex:jsonl({type:'item.completed',item:{type:'agent_message',text:'finished'}},{type:'turn.completed'})};
  for(const agentId of Object.keys(wanted)){
    let called=false;const events=[];
    const runner=async (_command,_args,opts)=>{called=true;opts.onOutput('stdout',wanted[agentId]);return {...ok,stdout:wanted[agentId]};};
    const result=await invokeAgent({id:'cartlab',agentId},'Read-only planning','PLAN',(...args)=>events.push(args),{runner});
    assert.equal(result.decoded.ok,true,agentId);assert.equal(called,true,agentId);
  }
});

test('new project is isolated, previews locally, and keeps prompt-only request intact',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'kaneguard-project-test-'));
  try{
    const prompt='Build a tiny Snake game with keyboard movement and restart.';
    const p=await createProject({prompt,agentId:'codex'},{root,port:4173});
    assert.match(p.id,/^app-[a-z0-9-]+$/);
    assert.equal(p.launchUrl,`/${p.id}/`);
    const html=await readFile(path.join(root,'public',p.id,'index.html'),'utf8');
    const config=JSON.parse(await readFile(path.join(root,'configs',`${p.id}.json`),'utf8'));
    assert.equal(config.kind,'playground');
    assert.equal(config.flows.length,0);
    assert.equal(config.url,`http://127.0.0.1:4173/${p.id}/`);
    assert.ok(html.includes('not verified yet'));
    assert.ok(config.editablePaths.every((f)=>f.startsWith(`public/${p.id}/`)));
    assert.equal(projectTitle('Create a weather widget'),'Weather widget');
    await assert.rejects(createProject({prompt:'x',agentId:'codex'},{root}),/8–1600/);
    await assert.rejects(createProject({prompt,agentId:'shell'},{root}),/Choose/);
  } finally {await rm(root,{recursive:true,force:true});}
});

test('agent discovery lists all options, even when binaries are not installed',async()=>{
  const tools=await agentAvailability({PATH:'/this/does/not/exist'});
  assert.equal(tools.length,4);
  assert.ok(tools.every((a)=>a.installed===false));
});

test('Cursor trusts only the chosen app folder and never auto-approves tools',()=>{
  const dir='/home/u/projects/my-app';
  const trusted=agentCommand('cursor','x',{projectDir:dir,trustWorkspace:true});
  assert.deepEqual(trusted.args.slice(-3),['--trust','--workspace',dir]);
  for(const flag of ['--force','-f','--yolo','--approve-mcps']) assert.ok(!trusted.args.includes(flag),flag);
  assert.ok(!agentCommand('cursor','x',{projectDir:dir}).args.includes('--trust'),'KaneGuard repo itself is never auto-trusted');
});

test('Cursor workspace-trust refusal becomes a clear next step',()=>{
  const d=decodeAgent('cursor','',{code:1,stderr:'⚠ Workspace Trust Required\n  Do you trust the contents of this directory?'});
  assert.equal(d.ok,false);
  assert.equal(d.status,'workspace_trust_required');
  assert.match(d.summary,/run `agent`, choose Trust, then click Continue run/);
});
