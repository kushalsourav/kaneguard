import test from 'node:test';
import assert from 'node:assert/strict';
import {appSourceFingerprint} from '../engine/feature.mjs';
import {renderLoopHTML} from '../public/control/loop-view.mjs';
import {promptArtifacts} from '../public/control/artifacts.mjs';

test('same source bytes produce identical fingerprint regardless of map order',()=>{
  const initial = new Map([
    ['public/coinpulse/index.html',Buffer.from('<main>Watchlist</main>')],
    ['public/coinpulse/app.mjs',Buffer.from('export const watch = true;')],
    ['public/cartlab/app.mjs',Buffer.from('export const unrelated = true;')],
    ['public/coinpulse/tests/danger.test.mjs',Buffer.from('ignored')]
  ]);
  const reordered = new Map([...initial].reverse());
  assert.equal(appSourceFingerprint('coinpulse',initial),appSourceFingerprint('coinpulse',reordered));
  reordered.set('public/cartlab/app.mjs',Buffer.from('changed unrelated app'));
  assert.equal(appSourceFingerprint('coinpulse',initial),appSourceFingerprint('coinpulse',reordered));
  reordered.set('public/coinpulse/app.mjs',Buffer.from('changed watchlist code'));
  assert.notEqual(appSourceFingerprint('coinpulse',initial),appSourceFingerprint('coinpulse',reordered));
  reordered.set('public/coinpulse/new.mjs',Buffer.from('new file'));
  assert.notEqual(appSourceFingerprint('coinpulse',initial),appSourceFingerprint('coinpulse',reordered));
});

test('active Kane check is visible as running, never waiting for source',()=>{
  const run={id:'a',mode:'build',status:'running',appId:'coinpulse',featureTitle:'CoinPulse Watchlist',
    stage:'verifying',activeGate:'After task-1: Watchlist controls',currentFlow:'Toggle favorites',currentFlowId:'feature-check-1',
    tasks:[{id:'task-1',title:'Watchlist controls',status:'candidate',acceptanceIds:['check-1']}],
    generatedFlows:[{id:'check-1',name:'Toggle favorites'}],
    taskExecutions:[{taskId:'task-1',status:'completed',outputFile:'coding.ndjson'}],
    milestones:[{taskId:'task-1',title:'Watchlist controls',status:'verifying',checkIds:['check-1']}],verification:[]};
  const html=renderLoopHTML(run);
  assert.match(html,/KANE CLI · BROWSER RUN/);
  assert.match(html,/Browser checking 1 of 1/);
  assert.match(html,/Browser running/);
  assert.doesNotMatch(html,/Waiting for code/);
  assert.equal((html.match(/<strong>CoinPulse Watchlist<\/strong>/g)||[]).length,1);
});

test('final results separate real Kane executions from reused unchanged-source evidence',()=>{
  const run={id:'b',mode:'build',status:'passed',appId:'coinpulse',featureTitle:'Watchlist',
    tasks:[{id:'task-1',title:'Watchlist',status:'verified',acceptanceIds:['check-1']}],
    generatedFlows:[{id:'check-1',name:'Favorites test'}],
    milestones:[{id:'milestone-final',taskId:null,status:'passed'}],finalChecksTotal:4,
    verification:[{flowId:'feature-check-1',flowName:'Favorites test',generated:true,gate:'After task-1: Watchlist',
      verdict:'passed',evidenceUrl:'https://example.com/original'},
      {flowId:'portfolio-math',flowName:'Portfolio math',generated:false,gate:'Final full suite',
      verdict:'passed',evidenceUrl:'https://example.com/regression'}],
    reusedVerification:[{flowId:'feature-check-1',flowName:'Favorites test',gate:'Final full suite',
      reused:true,verdict:'passed',evidenceUrl:'https://example.com/original'}]};
  const html=renderLoopHTML(run);
  assert.match(html,/1 Kane check covered by real same-source evidence/);
  assert.match(html,/0 new, 1 reused/);
  assert.match(html,/Prior PASS · unchanged source/);
  assert.match(html,/Protected regressions/);
  assert.match(html,/Portfolio math/);
  assert.match(html,/https:\/\/example.com\/original/);
});

test('prompt selector labels use feature title and groups technical artifacts',()=>{
  const choices=promptArtifacts({id:'b',mode:'build',featureTitle:'CoinPulse Watchlist',
    artifacts:{userRequest:'request.txt',featurePlan:'plan.json',plannerTrace:'agent.ndjson',plannerPrompt:'full.txt'}});
  assert.equal(choices[0].label,'Feature request');
  assert.ok(choices.some((choice)=>choice.label==='CoinPulse Watchlist · Antigravity plan'));
  assert.ok(choices.some((choice)=>choice.name==='full.txt'&&choice.advanced));
});
