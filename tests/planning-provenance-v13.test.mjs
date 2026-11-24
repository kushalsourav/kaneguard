import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {configFor} from '../engine/common.mjs';
import {planFeature} from '../engine/feature-agent.mjs';
import {promptArtifacts} from '../public/control/artifacts.mjs';
import {renderLoopHTML} from '../public/control/loop-view.mjs';

test('visible developer prompt contains ONLY the exact requested feature; auto source and CLI envelope remain separately auditable',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'kg-prompt-v13-'));
  try {
    const config=await configFor('cartlab');
    const request='Add a Quick View button in two tasks. Verify the modal before implementing the bag integration.';
    let invokedPrompt='';
    const runner=async(_exe,args)=>{
      invokedPrompt=args[args.indexOf('-p')+1];
      const output={featureTitle:'Two step Quick View',summary:'Implement a modal dialog then add a cart button and verify real user interaction for each task.',
        tasks:[{id:'task-1',title:'Implement Quick View modal',detail:'Add product Quick View with a close button and keyboard dismissal.',acceptanceIds:['check-1']},
          {id:'task-2',title:'Add modal bag action',detail:'Bind the Add to Bag action in Quick View to the existing cart totals.',dependsOn:['task-1'],acceptanceIds:['check-2']}],
        acceptance:[{id:'check-1',name:'Modal opens and closes',objective:`Navigate to ${config.url} and click Quick View for Arc Wireless Headphones. Verify that the product name, price and category display, then click Close and assert the dialog becomes hidden.`},
          {id:'check-2',name:'Bag totals update properly',objective:`Navigate to ${config.url} and click Quick View for Weekender Pack then click Add to Bag. Verify that cart count becomes 1 item and subtotal shows $64.00 as expected.`}]};
      return {stdout:JSON.stringify({event:'result',result:{status:'SUCCESS',response:JSON.stringify(output)}})+'\n',stderr:'',code:0,durationMs:5};
    };
    await planFeature(config,request,dir,()=>{},{runner});
    assert.equal(await readFile(path.join(dir,'feature-user-request.txt'),'utf8'),request);
    const source=await readFile(path.join(dir,'feature-source-context.txt'),'utf8');
    assert.match(source,/FILE public\/cartlab\/pricing\.mjs/);
    assert.ok(!request.includes('FILE public/cartlab/pricing.mjs'));
    assert.match(invokedPrompt,/Use the REAL APPLICATION SOURCE/);
    assert.ok(invokedPrompt.includes(source));
    assert.equal(await readFile(path.join(dir,'feature-planning-prompt.txt'),'utf8'),invokedPrompt);
    const artifacts=promptArtifacts({mode:'build',id:'demo',artifacts:{userRequest:'feature-user-request.txt',sourceContext:'feature-source-context.txt',plannerPrompt:'feature-planning-prompt.txt'}});
    assert.equal(artifacts[0].name,'feature-user-request.txt');
    assert.match(artifacts[0].label,/^Feature request$/);
    assert.match(artifacts.find((x)=>x.name==='feature-planning-prompt.txt').label,/Planner CLI input/);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('UI shows one plan heading and never mislabels an implementation-time Kane gate as unnecessary',()=>{
  const run={id:'demo',mode:'build',status:'running',featureTitle:'Two step Quick View',artifacts:{userRequest:'feature-user-request.txt'},
    tasks:[{id:'task-1',title:'Implement Quick View modal',status:'implementing',acceptanceIds:['check-1']}],
    generatedFlows:[{id:'check-1',name:'Check modal opens'}],taskExecutions:[{taskId:'task-1',status:'running'}],
    milestones:[{taskId:'task-1',title:'Implement Quick View modal',status:'implementing',checkIds:[]}],verification:[]};
  const html=renderLoopHTML(run);
  assert.equal((html.match(/<strong>Two step Quick View<\/strong>/g)||[]).length,1);
  assert.match(html,/1 browser check planned · after coding/);
  assert.doesNotMatch(html,/No browser gate needed/);
  assert.match(html,/Feature request/);
});


test('a resumed run never claims to be waiting for a new implementation',()=>{
  const run={id:'resume-demo',mode:'build',resumedFrom:'original-demo',status:'running',featureTitle:'Two step Quick View',artifacts:{userRequest:'feature-user-request.txt'},
    tasks:[{id:'task-1',title:'Implement Quick View modal',status:'candidate',acceptanceIds:['check-1']}],generatedFlows:[{id:'check-1',name:'Check modal opens'}],
    taskExecutions:[],milestones:[{id:'milestone-final',taskId:null,title:'Final feature and protected regression suite',status:'verifying',checkIds:['check-1']}],verification:[]};
  const html=renderLoopHTML(run);
  assert.match(html,/Saved implementation · no recoding/);
  assert.match(html,/Saved code checked in final suite/);
  assert.doesNotMatch(html,/Waiting for implementation/);
});
