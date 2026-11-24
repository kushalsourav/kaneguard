import test from 'node:test';
import assert from 'node:assert/strict';
import {buildFeaturePlanRequest} from '../engine/feature-agent.mjs';
import {pendingMilestoneDependencies,readyMilestoneChecks} from '../engine/milestones.mjs';
import {taskVerificationState} from '../public/control/task-verification-state.mjs';
import {renderAllVerificationJourneys} from '../public/control/verification-history.mjs';
import {renderLoopHTML} from '../public/control/loop-view.mjs';

const plan = {
  tasks:[
    {id:'task-storage',title:'Storage loader',acceptanceIds:['storage-integrated']},
    {id:'task-create',title:'Create issues',acceptanceIds:['create-issue','storage-integrated']},
    {id:'task-delete',title:'Delete issues',acceptanceIds:['delete-issue']}
  ],
  acceptance:[
    {id:'storage-integrated',name:'Load persisted issue'},
    {id:'create-issue',name:'Create issue'},
    {id:'delete-issue',name:'Delete issue'}
  ]
};

test('v31.4 planner requests individual runnable Kane checks as soon as possible',()=>{
  const prompt=buildFeaturePlanRequest({kind:'playground',url:'http://127.0.0.1:4173/app-xyz/',id:'app-xyz'},'Build an issue tracker','<main></main>');
  assert.match(prompt,/EACH task that produces independently observable behavior/);
  assert.match(prompt,/no future task/);
  assert.match(prompt,/valid to defer its browser gate/);
  assert.match(prompt,/NEVER claim a browser check is ready before/);
});

test('v31.4 task scheduling runs available browser tests and explains deferred ones',()=>{
  const ready=readyMilestoneChecks(plan,new Set(['task-storage','task-create']),new Set());
  assert.deepEqual(ready.map(v=>v.id),['storage-integrated','create-issue']);
  const initiallyBlocked=pendingMilestoneDependencies(plan,'task-storage',new Set(['task-storage']));
  assert.deepEqual(initiallyBlocked,[{checkId:'storage-integrated',checkName:'Load persisted issue',blockedBy:['task-create']}]);
  assert.deepEqual(pendingMilestoneDependencies(plan,'task-delete',new Set(['task-storage','task-create','task-delete']),new Set(['storage-integrated','create-issue'])),
    [{checkId:'delete-issue',checkName:'Delete issue',blockedBy:[]}]);
  const run={status:'running',stage:'implementing',tasks:[
    {id:'task-storage',title:'Storage loader',status:'candidate',acceptanceIds:['storage-integrated']},
    {id:'task-create',title:'Create issues',status:'planned',acceptanceIds:['create-issue','storage-integrated']}
  ],generatedFlows:plan.acceptance,verification:[],milestones:[{taskId:'task-storage',status:'awaiting_dependencies',deferredReason:'Waiting for task-create to complete shared Kane checks'}]};
  assert.match(taskVerificationState(run,run.tasks[0]).label,/Waiting for Create issues/);
});

test('v31.4 UI distinguishes exact-objective reused protected regression from executed browser run',()=>{
  const regression={gate:'Final full suite',flowId:'reg-abc',flowName:'Protected counter baseline',verdict:'passed',reused:true,
    reuseReason:'identical-objective-and-source',sourceFingerprint:'0'.repeat(64),originalFlowId:'feature-check-1',stdoutFile:'actual-kane.ndjson'};
  const run={id:'run-x',status:'passed',mode:'build',featureTitle:'Counter App',
    generatedFlows:[{id:'check-1',name:'Test increment'}],finalChecksTotal:2,
    tasks:[{id:'task-1',title:'Increment',status:'verified',acceptanceIds:['check-1']}],
    milestones:[{id:'milestone-final',status:'passed'}],
    verification:[{gate:'Final full suite',flowId:'feature-check-1',generated:true,verdict:'passed',flowName:'Test increment'}],
    reusedVerification:[regression]};
  const html=renderAllVerificationJourneys(run,f=>'/evidence/'+f);
  assert.match(html,/The exact same objective already passed on identical application source bytes/);
  assert.match(html,/actual-kane.ndjson/);
  assert.match(html,/This is NOT a new browser run/);
  const loop=renderLoopHTML(run);
  assert.match(loop,/Protected regressions/);
  assert.match(loop,/Protected counter baseline/);
  assert.match(loop,/2 of 2 objectives verified/);
  assert.match(loop,/Feature validation evidence \(1 new, 0 reused\)/);
});
