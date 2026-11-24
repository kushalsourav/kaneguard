import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildDiagnosisRequest, parseDiagnosisResponse, buildExecutionPrompt, planRepair, runAgent } from '../engine/agent.mjs';

const config = { id: 'cartlab', label: 'CartLab', maxRepairs: 3, editablePaths: ['public/cartlab/pricing.mjs', 'public/cartlab/app.mjs'] };
const failure = { verdict: 'failed', summary: 'Cart total is $110.42 rather than $100.12', objective: 'SAVE10 should apply 10% discount', runEnd: { type:'run_end', status:'failed' }, stdoutFile:'kane-coupon-total-0.ndjson' };
const diagnosis = {
  action:'repair', confidence:'high', diagnosis:'Pricing function applies 20% discount; expected 10% based on inspected code.',
  targetFiles:['public/cartlab/pricing.mjs'],
  repairPrompt:'Inspect public/cartlab/pricing.mjs and correct the SAVE10 discount percentage to ten percent rather than twenty percent while preserving the tax calculation and shipping rule. Run syntax checks, do not touch any acceptance tests, and explain the change.'
};
const fakeResult = (response) => ({ code:0, timedOut:false, stdout:`{"event":"init"}\n${JSON.stringify({event:'result',result:{status:'SUCCESS',response}})}`, stderr:'', durationMs:12 });

test('investigation request includes evidence but never pre-decides the fix', () => {
  const prompt = buildDiagnosisRequest(config, failure, 1, 'prior diff');
  assert.match(prompt, /Cart total is \$110\.42/);
  assert.match(prompt, /prior diff/);
  assert.match(prompt, /kane-coupon-total-0.ndjson/);
  assert.match(prompt, /Generate a specific, original repair instruction/);
  assert.doesNotMatch(prompt, /correct the SAVE10 discount percentage to ten percent/);
});

test('agent-authored diagnosis parses and restricts files', () => {
  assert.deepEqual(parseDiagnosisResponse(JSON.stringify(diagnosis), config.editablePaths), diagnosis);
  assert.throws(() => parseDiagnosisResponse(JSON.stringify({...diagnosis, targetFiles:['engine/kane.mjs']}), config.editablePaths), /allowlist/);
  assert.throws(() => parseDiagnosisResponse(JSON.stringify({...diagnosis, confidence:'low'}), config.editablePaths), /confidence low/);
  assert.throws(() => parseDiagnosisResponse('Invalid json', config.editablePaths), /valid JSON/);
  assert.equal(parseDiagnosisResponse(JSON.stringify({action:'stop', diagnosis:'Infrastructure error', confidence:'low',reason:'No browser evidence'}), config.editablePaths).action, 'stop');
});

test('investigation and repair call the coding agent twice with an agent-authored prompt and save evidence', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'kg-agentic-'));
  const calls = [];
  const runner = async (bin, args) => {
    calls.push({bin,args});
    return fakeResult(calls.length === 1 ? JSON.stringify(diagnosis) : 'Applied the diagnosed fix');
  };
  try {
    const p = await planRepair(config, failure, dir, 1, '', () => {}, {runner});
    assert.equal(p.ok, true);
    assert.deepEqual(p.plan, diagnosis);
    const result = await runAgent(config, p.plan, dir, 1, () => {}, {runner});
    assert.equal(result.ok, true);
    assert.equal(calls.length, 2);
    assert.match(calls[0].args.join(' '), /INVESTIGATION AGENT/);
    assert.match(calls[1].args.join(' '), /correct the SAVE10 discount percentage to ten percent/);
    assert.match(await readFile(path.join(dir, 'diagnosis-1-plan.json'), 'utf8'), /modelAuthored/);
    assert.match(await readFile(path.join(dir, 'repair-ticket-1.txt'), 'utf8'), /BEGIN AGENT-AUTHORED/);
  } finally { await rm(dir, {recursive:true, force:true}); }
});

test('investigation rejects a successful CLI response containing no usable plan', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'kg-agentic-'));
  try {
    const runner = async () => fakeResult('I think the app is broken, fixed it!');
    const result = await planRepair(config, failure, dir, 1, '', () => {}, {runner});
    assert.equal(result.ok, false);
    assert.match(result.summary, /valid JSON/);
  } finally { await rm(dir, {recursive:true, force:true}); }
});

test('execution prompt keeps editable allowlist even when agent plan is specific', () => {
  const prompt = buildExecutionPrompt(config, diagnosis, 1);
  assert.match(prompt, /public\/cartlab\/app.mjs/);
  assert.match(prompt, /Never falsify a PASS/);
  assert.match(prompt, /correct the SAVE10 discount percentage/);
});
