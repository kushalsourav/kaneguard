import {isKaneAutomationMisstep} from '../engine/kane.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseKaneNDJSON } from '../engine/kane.mjs';
import { buildDiagnosisRequest } from '../engine/agent.mjs';
import { configFor } from '../engine/common.mjs';

test('Kane parser only accepts a real passed run_end with a successful exit', () => {
  const ndjson = ['{"type":"stream_start"}', '{"step":2,"status":"done"}', '{"type":"run_end","status":"passed","summary":"Checkout verified"}'].join('\n');
  const run = parseKaneNDJSON(ndjson, { code: 0 });
  assert.equal(run.verdict, 'passed');
  assert.equal(run.eventCount, 3);
  assert.equal(parseKaneNDJSON(ndjson, { code: 2 }).verdict, 'infrastructure_error');
});
test('Kane parser differentiates objective failures from infrastructure problems', () => {
  const bad = '{"type":"run_end","status":"failed","reason":"Total is incorrect"}';
  assert.equal(parseKaneNDJSON(bad, { code: 1 }).verdict, 'failed');
  assert.equal(parseKaneNDJSON('bad json\n{"type":"stream_start"}', { code: 2 }).verdict, 'infrastructure_error');
  assert.equal(parseKaneNDJSON('{"type":"run_end","status":"passed"}', { code: 0, timedOut: true }).verdict, 'infrastructure_error');
});
test('diagnosis input passes immutable Kane evidence and file boundaries, not a canned fix', async () => {
  const config = await configFor('cartlab');
  const ticket = buildDiagnosisRequest(config, { verdict: 'failed', objective: config.flows[0].objective, summary: 'Observed wrong total' }, 1);
  assert.match(ticket, /kaneSummary.*Observed wrong total/);
  assert.match(ticket, /READ-ONLY/);
  assert.match(ticket, /public\/cartlab\/pricing\.mjs/);
  assert.match(ticket, /\$100\.12/);
});

test('v31.1 identifies only Kane structured automation missteps for a sealed-objective retry',()=>{
  const failure={verdict:'failed',runEnd:{type:'run_end',status:'failed',verdict:{family:'automation_bug',category:'agent_misstep',confirmed:false}}};
  assert.equal(isKaneAutomationMisstep(failure),true);
  assert.equal(isKaneAutomationMisstep({...failure,verdict:'infrastructure_error'}),false);
  assert.equal(isKaneAutomationMisstep({...failure,runEnd:{...failure.runEnd,verdict:{family:'application_bug',category:'functionality'}}}),false);
  assert.equal(isKaneAutomationMisstep({...failure,runEnd:{...failure.runEnd,verdict:undefined}}),false);
});
