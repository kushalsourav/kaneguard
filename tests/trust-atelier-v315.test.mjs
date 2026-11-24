import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {atelierModel,renderTrustAtelier} from '../public/control/trust-atelier.mjs';

const example=(overrides={})=>({
  id:'20261124-example',featureTitle:'BugBoard',agentId:'antigravity',examinerAgentId:'codex',
  stage:'verifying',status:'running',tasks:[{id:'task-1',status:'candidate'}],
  generatedFlows:[{id:'one',name:'Check the counter'},{id:'two',name:'Filtering and search'}],
  verification:[{flowId:'feature-one',verdict:'passed',stdoutFile:'kane-feature-check-1.ndjson'}],
  currentFlowId:'feature-two',currentFlow:'Filtering and search',examinerReviews:[],testDisputes:[],
  assurance:{proven:0,total:2},...overrides
});

test('Atelier shows named independent examiner and real in-progress browser check',()=>{
  const model=atelierModel(example());
  assert.equal(model.examiner.name,'Codex');
  assert.equal(model.examiner.independent,true);
  assert.equal(model.progress.passed,1);
  assert.equal(model.checks[0].verdict,'passed');
  assert.equal(model.checks[1].verdict,'running');
  assert.match(renderTrustAtelier(example()),/Kane verifying/);
});

test('Atelier cannot confer trust on incomplete or failed runs',()=>{
  for(const status of ['verification_inconclusive','agent_error','failed','interrupted']){
    const state=atelierModel(example({status,stage:'finished'}));
    assert.notEqual(state.gate.state,'Accepted on recorded checks');
  }
  assert.equal(atelierModel(example({status:'passed',stage:'finished'})).gate.state,'Accepted on recorded checks');
});

test('Atelier does not invent a separate examiner when builder and examiner are identical',()=>{
  const model=atelierModel(example({examinerAgentId:'antigravity'}));
  assert.equal(model.examiner.independent,false);
  assert.match(model.examiner.state,/Not independent/);
});

test('Atelier escapes user-controlled run data and rejects unsafe transcript paths',()=>{
  const markup=renderTrustAtelier(example({
    featureTitle:'<img src=x onerror=alert(1)>',
    generatedFlows:[{id:'one',name:'<script>evil</script>'}],
    verification:[{flowId:'feature-one',verdict:'passed',stdoutFile:'../../credentials.txt'}],
  }));
  assert.doesNotMatch(markup,/<script>|<img src=/);
  assert.match(markup,/&lt;script&gt;/);
  assert.doesNotMatch(markup,/credentials\.txt/);
});

test('Live loop UI retains App view, receipt and authenticated evidence links',async()=>{
  const html=await readFile(new URL('../public/control/index.html',import.meta.url),'utf8');
  const studio=await readFile(new URL('../public/control/studio.mjs',import.meta.url),'utf8');
  const css=await readFile(new URL('../public/assets/trust-atelier.css',import.meta.url),'utf8');
  assert.match(html,/id="showAtelier"/);
  assert.doesNotMatch(html,/id="showWorkflow"/);
  assert.match(html,/id="showLiveApp"/);
  assert.match(html,/id="atelierPanel"/);
  assert.match(studio,/function showAtelierInPreview/);
  assert.match(studio,/renderTrustAtelier\(run,/);
  assert.match(css,/prefers-reduced-motion/);
});
