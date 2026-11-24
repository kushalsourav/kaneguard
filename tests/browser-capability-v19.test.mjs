import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {unsupportedDesktopBrowserAction,detectKaneCapabilityBlock} from '../engine/kane-capabilities.mjs';
import {buildFeaturePlanRequest,parseFeaturePlan,planFeature} from '../engine/feature-agent.mjs';
import {runKane} from '../engine/kane.mjs';
import {renderCheckJourney} from '../public/control/verification-history.mjs';

const url='http://127.0.0.1:4173/cartlab/';
const objective=`Navigate to ${url} and click Pricing. Verify the Pricing heading is visible. Resize the viewport to mobile width (375px) and verify the cards stack without horizontal overflow.`;
const mobileFailure='The first two checks passed, but the remaining check requires a 375px-wide browser window. The automation interface has no way to change the window size, so the mobile layout could not be tested.';
const config={id:'cartlab',label:'CartLab',url,agentId:'antigravity',editablePaths:['public/cartlab/index.html'],kind:'playground'};
const originalPlan={
  featureTitle:'Responsive demo',
  summary:'Build a responsive landing page and independently verify its working navigation and pricing controls.',
  tasks:[
    {id:'task-a',title:'Create responsive layout',detail:'Create the responsive hero, feature cards and mobile CSS media queries.',acceptanceIds:['check-a']},
    {id:'task-b',title:'Add pricing interactions',detail:'Implement pricing controls with desktop interactions and preserve the mobile CSS layout.',dependsOn:['task-a'],acceptanceIds:['check-b']}
  ],
  acceptance:[
    {id:'check-a',name:'Hero navigation',objective:`Navigate to ${url} and click the Features link. Verify the heading and feature cards are visible and the page has a navigation bar.`},
    {id:'check-b',name:'Mobile and pricing',objective}
  ]
};
const correctedPlan={...originalPlan,acceptance:[originalPlan.acceptance[0],{
  ...originalPlan.acceptance[1],objective:`Navigate to ${url} and click the Pricing link. Verify the pricing cards are visible. Click the Yearly toggle and verify that the displayed prices change from monthly to yearly values.`
}]};
const fakeOutput=(plan)=>({code:0,timedOut:false,spawnError:null,stdout:JSON.stringify({event:'result',result:{status:'SUCCESS',response:JSON.stringify(plan)}})+'\n',stderr:'',durationMs:3});

test('planner rejects viewport resize only, not responsive implementation requirements',()=>{
  const prompt=buildFeaturePlanRequest(config,'Build a responsive landing page at mobile width');
  assert.match(prompt,/BROWSER CAPABILITY LIMIT/);
  assert.match(prompt,/Still IMPLEMENT responsive\/mobile CSS/);
  assert.ok(unsupportedDesktopBrowserAction(objective));
  assert.ok(unsupportedDesktopBrowserAction(`Open ${url}. Set the browser window size to 375px and verify the layout.`));
  assert.equal(unsupportedDesktopBrowserAction(`Open ${url}. Click Pricing and verify that the hero and cards are visible.`),null);
  assert.throws(()=>parseFeaturePlan(JSON.stringify(originalPlan)),/unsupported desktop browser action/);
  assert.deepEqual(parseFeaturePlan(JSON.stringify(correctedPlan)),correctedPlan);
});

test('one agent-owned plan correction keeps implementation tasks and records both plans',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'kg-cap-plan-v19-'));
  let calls=0;
  try {
    const done=await planFeature(config,'Build a responsive landing page',root,()=>{},
      {runner:async()=>fakeOutput(++calls===1?originalPlan:correctedPlan)});
    assert.equal(calls,2);
    assert.equal(done.corrected,true);
    assert.deepEqual(done.plan,correctedPlan);
    assert.match(await readFile(path.join(root,'feature-plan-candidate.json'),'utf8'),/375px/);
    assert.match(await readFile(path.join(root,'feature-plan-revision-prompt.txt'),'utf8'),/cannot perform/);
    assert.match(await readFile(path.join(root,'feature-plan-revision-candidate.json'),'utf8'),/pricing cards/);
    assert.match(await readFile(path.join(root,'feature-plan.json'),'utf8'),/pricing cards/);
    assert.deepEqual(done.plan.tasks,originalPlan.tasks,'mobile CSS task requirements preserved');
  } finally {await rm(root,{recursive:true,force:true});}
});

test('planner refuses a purported correction that secretly drops implementation requirements',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'kg-cap-plan-reject-v19-'));
  let calls=0;
  const weakened={...correctedPlan,tasks:correctedPlan.tasks.map((t)=>({...t,detail:t.detail.replace('mobile CSS','desktop')}))};
  try {
    await assert.rejects(planFeature(config,'Build a responsive landing page',root,()=>{},
      {runner:async()=>fakeOutput(++calls===1?originalPlan:weakened)}),/changed implementation tasks/);
    assert.equal(calls,2);
  } finally {await rm(root,{recursive:true,force:true});}
});

test('Kane viewport capability failure is distinct from a real responsive layout defect',async()=>{
  assert.equal(detectKaneCapabilityBlock(objective,mobileFailure)?.code,'desktop_viewport_resize');
  assert.equal(detectKaneCapabilityBlock(objective,'The test required checking the page at 375px wide, but the browser tools provided to the run could not change the window size.')?.code,'desktop_viewport_resize');
  assert.equal(detectKaneCapabilityBlock(objective,'The page overflows horizontally at 375px; navigation elements are clipped.'),null);
  assert.equal(detectKaneCapabilityBlock(correctedPlan.acceptance[1].objective,mobileFailure),null);
  const root=await mkdtemp(path.join(os.tmpdir(),'kg-cap-kane-v19-'));
  try {
    let calls=0;
    const result=await runKane(config,{id:'mobile',name:'Mobile view',objective},root,0,()=>{},()=>{},
      {runner:async()=>{calls++;return {code:1,timedOut:false,spawnError:null,stdout:JSON.stringify({type:'run_end',status:'failed',summary:mobileFailure})+'\n',stderr:'',durationMs:200};}});
    assert.equal(calls,1);
    assert.equal(result.verdict,'failed');
    assert.equal(result.unavailableCapability.code,'desktop_viewport_resize');
    assert.equal((await readFile(path.join(root,result.stdoutFile),'utf8')).includes(mobileFailure),true);
    const ui=renderCheckJourney({verification:[{...result,gate:'After task-b: pricing'}],plans:[],repairs:[]},[{...result,gate:'After task-b: pricing'}],(file)=>`/api/evidence/demo/${file}`);
    assert.match(ui,/Kane FAIL/);
    assert.match(ui,/INCONCLUSIVE · browser limitation/);
    assert.match(ui,/browser capability unavailable/);
    assert.match(ui,/Kane transcript/);
  }finally{await rm(root,{recursive:true,force:true});}
});

// Isolated end-to-end stubbed CLI test. This test never launches a real Kane
// browser: it proves that the production state machine does NOT repeatedly
// invoke a known-unachievable objective or invent a PASS.
test('integration: unsupported Kane browser operation remains inconclusive after one attempt', {timeout:45000}, async()=>{
  const {cp,writeFile,chmod,mkdir}=await import('node:fs/promises');
  const {spawn}=await import('node:child_process');
  const {createServer}=await import('node:net');
  const {setTimeout:delay}=await import('node:timers/promises');
  const {ROOT}=await import('../engine/common.mjs');
  const scratch=await mkdtemp(path.join(os.tmpdir(),'kg-cap-e2e-v19-'));
  const portServer=createServer();
  await new Promise((resolve)=>portServer.listen(0,'127.0.0.1',resolve));
  const port=portServer.address().port;
  await new Promise((resolve)=>portServer.close(resolve));
  let server;
  const logs=[];
  try {
    for(const folder of ['engine','server','configs','public']) await cp(path.join(ROOT,folder),path.join(scratch,folder),{recursive:true});
    await cp(path.join(ROOT,'package.json'),path.join(scratch,'package.json'));
    const configPath=path.join(scratch,'configs','cartlab.json');
    const projectConfig=JSON.parse(await readFile(configPath,'utf8'));
    projectConfig.url=`http://127.0.0.1:${port}/cartlab/`;
    projectConfig.flows=[{id:'unsupported-mobile',name:'Mobile responsive layout at 375px',objective:`Navigate to http://127.0.0.1:${port}/cartlab/. Click the shop control and verify the catalog is visible. Resize the viewport to mobile width (375px) and verify there is no horizontal overflow.`}];
    await writeFile(configPath,JSON.stringify(projectConfig));
    const cli=path.join(scratch,'fake-clis');await mkdir(cli);
    const coder=path.join(cli,'agy.mjs'),kane=path.join(cli,'kane.mjs');
    await writeFile(coder,`#!/usr/bin/env node
import fs from 'node:fs';
const args=process.argv.slice(2),prompt=args[args.indexOf('-p')+1]||'';
const send=(value)=>process.stdout.write(JSON.stringify({event:'result',result:{status:'SUCCESS',response:typeof value==='string'?value:JSON.stringify(value)}})+'\\n');
const url='http://127.0.0.1:'+process.env.KG_TEST_PORT+'/cartlab/';
if(prompt.includes('PLAN a real feature')) send({featureTitle:'Safe feature',summary:'Create two independently browser-tested application tasks without unsupported browser instructions.',tasks:[{id:'task-a',title:'First task',detail:'Add a simple first task and preserve application safety.',acceptanceIds:['check-a']},{id:'task-b',title:'Second task',detail:'Add a second task with verified navigation functionality and responsive mobile CSS.',dependsOn:['task-a'],acceptanceIds:['check-b']}],acceptance:[{id:'check-a',name:'First check',objective:'Navigate to '+url+' and click a product. Verify that the first product text is present and the cart button is visible.'},{id:'check-b',name:'Second check',objective:'Navigate to '+url+' and click the cart button. Verify that the cart section is visible and its quantity remains correct.'}]});
else if(prompt.includes('CURRENT TASK task-a')) {fs.writeFileSync('public/cartlab/demo-v19-a.mjs','export const a=1;\\n');send('First edit done');}
else if(prompt.includes('CURRENT TASK task-b')) {fs.writeFileSync('public/cartlab/demo-v19-b.mjs','export const b=2;\\n');send('Second edit done');}
else {process.stderr.write('Unexpected diagnosis or repair call');process.exit(36);}
`);
    await writeFile(kane,`#!/usr/bin/env node
const obj=process.argv[3]||'';
const mobile=obj.includes('Resize the viewport');
process.stdout.write(JSON.stringify({type:'run_end',status:mobile?'failed':'passed',summary:mobile?'The browser automation interface has no way to change the window size to 375px. The mobile viewport could not be tested.':'TEST DOUBLE: browser flow passed'})+'\\n');
process.exit(mobile?1:0);
`);
    await chmod(coder,0o755);await chmod(kane,0o755);
    server=spawn(process.execPath,['server/main.mjs'],{
      cwd:scratch,env:{...process.env,PORT:String(port),KANEGUARD_AGENT_BIN:coder,KANE_CLI_BIN:kane,KG_TEST_PORT:String(port)},stdio:['ignore','pipe','pipe']
    });
    server.stdout.on('data',(c)=>logs.push(String(c)));
    server.stderr.on('data',(c)=>logs.push(String(c)));
    let ready=false;
    for(let n=0;n<90;n++) {
      try {ready=(await fetch(`http://127.0.0.1:${port}/api/health`)).ok;if(ready)break;}catch{}
      await delay(90);
    }
    assert.equal(ready,true,logs.join('').slice(-1400));
    const request=await fetch(`http://127.0.0.1:${port}/api/build`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({appId:'cartlab',prompt:'Create two simple browser-verifiable tasks'})});
    assert.equal(request.status,202);
    let ended;
    for(let n=0;n<300;n++) {
      const rows=await (await fetch(`http://127.0.0.1:${port}/api/runs`)).json();
      if(rows[0]?.status && rows[0].status!=='running') {
        ended=await(await fetch(`http://127.0.0.1:${port}/api/runs/${rows[0].id}`)).json();break;
      }
      await delay(75);
    }
    assert.ok(ended,`No run completed: ${logs.join('').slice(-1300)}`);
    assert.equal(ended.status,'verification_inconclusive');
    assert.equal(ended.verificationLimits?.length,1,'mobile CSS remains unverified by desktop Kane');
    assert.equal(ended.repairs.length,0);
    assert.equal(ended.plans.length,0,'no futile agent diagnosis on confirmed automation limitation');
    const checks=ended.verification.filter((v)=>v.flowId==='unsupported-mobile');
    assert.equal(checks.length,1,'no duplicate Kane execution on known unsupported viewport resize');
    assert.equal(checks[0].verdict,'failed','do not invent a Kane PASS');
    assert.equal(checks[0].unavailableCapability?.code,'desktop_viewport_resize');
    assert.match(ended.timeline.at(-1).detail,/NOT verified|not proven|No application defect/i);
    assert.ok(ended.timeline.some((v)=>v.kind==='kane_capability_unavailable'));
    assert.ok(ended.changedFiles.some((f)=>f.endsWith('demo-v19-b.mjs')),'preserve coded app source');
  } finally {
    if(server){server.kill('SIGTERM');await delay(80);if(server.exitCode===null)server.kill('SIGKILL');}
    await rm(scratch,{recursive:true,force:true});
  }
});
