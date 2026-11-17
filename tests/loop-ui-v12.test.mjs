import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, mkdtemp, rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {renderLoopHTML} from '../public/control/loop-view.mjs';
import {promptArtifacts} from '../public/control/artifacts.mjs';
import {kaneProcessTimeoutMs, runKane, parseKaneNDJSON} from '../engine/kane.mjs';

const example = {
  id:'demo-run',mode:'build',appId:'cartlab',appLabel:'CartLab',status:'running',featureTitle:'Live product search',
  artifacts:{featurePlan:'feature-plan.json',plannerTrace:'feature-plan-agent.ndjson'},
  tasks:[{id:'task-1',title:'Create search field',status:'verified',acceptanceIds:['check-1']},
    {id:'task-2',title:'Add sorting',status:'implementing',dependsOn:['task-1'],acceptanceIds:['check-2']}],
  generatedFlows:[{id:'check-1',name:'Search updates results'}, {id:'check-2',name:'Sort by price'}],
  taskExecutions:[{taskId:'task-1',status:'completed',outputFile:'feature-task-task-1-agent.ndjson',handoffFile:'feature-task-task-1-handoff.txt',diffFile:'feature-task-task-1-diff.txt'}],
  milestones:[{taskId:'task-1',title:'Create search field',status:'passed',checkIds:['check-1']},
    {taskId:'task-2',title:'Add sorting',status:'implementing',checkIds:[]}],
  verification:[{flowId:'feature-check-1',flowName:'Search updates results',verdict:'passed',gate:'After task-1: Create search field',taskId:'task-1',
    stdoutFile:'kane-feature-check-1-0.ndjson',evidenceUrl:'https://test.example/evidence-1'}],
  timeline:[{kind:'agent_plan',title:'Antigravity authored 2 tasks'},{kind:'task_created',title:'Task: Create search field'}, {kind:'kane_pass',title:'Search updates results: PASSED'}]
};

test('only one task card per task; attach its Kane and Antigravity proof directly',()=>{
  const rendered=renderLoopHTML(example);
  assert.equal((rendered.match(/kg-loop-step-header/g)||[]).length,4); // plan, task 1, task 2, final
  assert.equal((rendered.match(/Search updates results/g)||[]).length,1);
  assert.match(rendered,/Browser evidence/);
  assert.match(rendered,/test\.example\/evidence-1/);
  assert.match(rendered,/feature-task-task-1-agent.ndjson/);
  assert.match(rendered,/Create search field/);
  assert.match(rendered,/Add sorting/);
  assert.doesNotMatch(rendered,/Antigravity authored 2 tasks/); // no raw timeline replay
  assert.doesNotMatch(rendered,/step tool.*DONE/);
});

test('infrastructure failures remain visible with proof and cannot masquerade as a successful gate',()=>{
  const run=structuredClone(example);
  run.status='infrastructure_error';
  run.tasks[1].status='blocked';
  run.milestones[1].status='failed';
  run.verification.push({flowId:'feature-check-2',flowName:'Sort by price',verdict:'infrastructure_error',
    gate:'After task-2: Add sorting',taskId:'task-2',stdoutFile:'kane-feature-check-2-2.ndjson',stderrFile:'kane-feature-check-2-2.stderr.log',
    summary:'Kane CLI reached process watchdog'});
  const rendered=renderLoopHTML(run);
  assert.match(rendered,/Infrastructure issue/);
  assert.match(rendered,/CLI error/);
  assert.match(rendered,/kane-feature-check-2-2.stderr.log/);
  assert.match(rendered,/Run stopped/);
  assert.doesNotMatch(rendered,/Feature verified by Kane/);
});

test('saved generated task titles label artifacts automatically',()=>{
  const options=promptArtifacts(example);
  assert.ok(options.some((o)=>o.label.includes('Create search field')&&o.name.endsWith('agent.ndjson')));
  assert.ok(!options.some((o)=>o.label.includes('Task task-1 ·')));
});

test('Kane process watchdog includes real Chrome startup and evidence-upload grace',()=>{
  assert.ok(kaneProcessTimeoutMs(120)>=300000);
  assert.ok(kaneProcessTimeoutMs(120)>170000);
  assert.equal(parseKaneNDJSON('{"type":"run_end","status":"passed","summary":"Clicked the button"}',{code:31}).verdict,'infrastructure_error');
  assert.match(parseKaneNDJSON('{"type":"run_end","status":"passed","summary":"Clicked the button"}',{code:31}).summary,/not count as verified/);
});

test('Kane runner uses extended grace but still requires a successful process exit',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'kg-v12-kane-'));
  try{
    let grace;
    const runner=async (_bin,_args,opts)=>{grace=opts.timeoutMs;return {stdout:'{"type":"run_end","status":"passed","summary":"done"}\n',stderr:'',code:0,timedOut:false,durationMs:175000};};
    const result=await runKane({url:'http://127.0.0.1:4173/cartlab/',timeoutSeconds:120},
      {id:'real-id',name:'Real-flow-shaped test',objective:'Go to CartLab and verify the search'},dir,0,()=>{},()=>{},{runner});
    assert.equal(grace,kaneProcessTimeoutMs(120));
    assert.equal(result.verdict,'passed');
    assert.equal((await readFile(path.join(dir,'kane-real-id-0.ndjson'),'utf8')).includes('run_end'),true);
  }finally{await rm(dir,{recursive:true,force:true});}
});
