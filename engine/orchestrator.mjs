import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, RUNS, now, shortId, configFor, execProcess, formatError } from './common.mjs';
import { persist } from './storage.mjs';
import { runKane } from './kane.mjs';
import { planRepair, runAgent } from './agent.mjs';
import { snapshot, saveCheckpoint, reviewAndGuard, summarizeDiff } from './snapshot.mjs';
import { sourceFileFor } from './connected-projects.mjs';
import { createRunLogger } from './live-logger.mjs';

let inProgress = false;
export const isBusy = () => inProgress;
export function reserveEngine() {
  if (inProgress) throw new Error('Another KaneGuard run is active. Only one autonomous workflow may run at once.');
  inProgress = true;
  return () => { inProgress = false; };
}
export async function precheck(config) {
  for (const p of config.editablePaths.filter((p) => /\.m?js$/.test(p))) {
    const result = await execProcess(process.execPath, ['--check', sourceFileFor(config,p)], { timeoutMs: 10000 });
    if (result.code !== 0) return { ok: false, summary: `${p}: ${result.stderr || result.spawnError || 'syntax error'}`.slice(0, 1400) };
  }
  try {
    const result = await fetch(config.url, { signal: AbortSignal.timeout(3500) });
    if (!result.ok) return { ok: false, infrastructure: true, summary: `Web server returned ${result.status} at ${config.url}` };
    return { ok: true };
  } catch (e) { return { ok: false, infrastructure: true, summary: `Web server unreachable at ${config.url}: ${formatError(e)}` }; }
}

export async function verifyApp(appId, onUpdate = () => {}) {
  const releaseEngine = reserveEngine();
  let run;
  let logger;
  try {
    const config = await configFor(appId);
    const runDir = path.join(RUNS, shortId());
    await mkdir(runDir, { recursive: true });
    logger = createRunLogger(runDir, path.basename(runDir));
    logger.log('ENGINE', `Starting ${config.label} · ${config.flows.length} browser flows · max ${config.maxRepairs} repair attempts`);
    run = {
      id: path.basename(runDir), appId, appLabel: config.label, status: 'running',
      createdAt: now(), completedAt: null, currentFlow: null, iteration: 0,
      maxRepairs: config.maxRepairs, timeline: [], verification: [], plans: [], repairs: [],
      changedFiles: [], lastDiff: '', failure: null
    };
    let persistQueue = Promise.resolve();
    const queuePersist = () => { persistQueue = persistQueue.then(() => persist(run)); return persistQueue; };
    const sync = async () => { await queuePersist(); onUpdate(structuredClone(run)); };
    const log = async (kind, title, detail = '') => {
      run.timeline.push({ at: now(), kind, title, detail });
      logger.log('ENGINE', `${title}${detail ? ` — ${detail}` : ''}`);
      await sync();
    };
    const final = async (status, summary) => {
      logger.log('VERDICT', `${status.toUpperCase()} · ${summary}`);
      run.status = status;
      run.completedAt = now();
      await log(status === 'passed' ? 'success' : 'stopped', status === 'passed' ? (run.repairs.length ? 'Verified, repaired and resolved' : 'Browser verification passed') : 'Verification stopped', summary);
      return run;
    };
    await log('start', `Started ${config.label} verification`, `${config.flows.length} critical browser objectives · up to ${config.maxRepairs} repair attempts`);
    const baseline = await snapshot();
    await saveCheckpoint(baseline, runDir);
    await log('checkpoint', 'Safe checkpoint captured', 'Tracked source files snapshotted before agent access');
    let priorDiff = '';
    let focus = null;
    for (let iteration = 0; iteration <= config.maxRepairs; iteration++) {
      run.iteration = iteration;
      const check = await precheck(config);
      if (!check.ok) {
        if (check.infrastructure) {
          run.failure = { verdict: 'infrastructure_error', summary: check.summary };
          return await final('infrastructure_error', check.summary);
        }
        focus = { verdict: 'precheck_failed', summary: check.summary, objective: 'Application modules must pass Node syntax checking before browser validation' };
        await log('precheck_fail', 'JavaScript precheck failed', check.summary);
      } else {
        await log('precheck_pass', 'Application precheck passed', `Running accessible at ${config.url}`);
        focus = null;
        for (const flow of config.flows) {
          run.currentFlow = flow.name;
          await sync();
          const eventUpdate = (evt) => { run.timeline.push(evt); void queuePersist().catch(() => {}); };
          const result = await runKane(config, flow, runDir, iteration, eventUpdate, logger.log);
          run.verification.push(result);
          run.currentFlow = null;
          await sync();
          if (result.verdict === 'infrastructure_error') {
            run.failure = result;
            return await final('infrastructure_error', `Kane CLI did not complete a valid browser run: ${result.summary}`);
          }
          if (result.verdict === 'failed') {
            focus = { ...result, objective: flow.objective };
            run.failure = focus;
            break;
          }
        }
        if (!focus) {
          run.failure = null;
          return await final('passed', `All ${config.flows.length} critical browser flows passed authentic Kane verification.`);
        }
      }
      if (iteration >= config.maxRepairs) return await final('failed', `Exhausted ${config.maxRepairs} repair attempts. Latest failure: ${focus.summary}`);
      run.iteration = iteration + 1;
      const attempt = iteration + 1;
      await log('agent_plan_start', `Antigravity investigating failure · attempt ${attempt}`, 'Agent reads Kane evidence and authors its own repair plan; no prewritten fix prompt');
      const beforePlan = await snapshot();
      const investigation = await planRepair(config, focus, runDir, attempt, priorDiff, logger.log);
      // The investigation stage is strictly read-only. Revert all monitored edits,
      // including otherwise-allowlisted app code, if the planner violated that contract.
      const planGuard = await reviewAndGuard(beforePlan, []);
      run.plans.push({ attempt, ...investigation, plan: investigation.plan ?? null });
      await sync();
      if (planGuard.rejected.length) {
        await log('safety_reject', 'Investigation stage made forbidden edits; rolled back', planGuard.rejected.join(', '));
        return await final('safety_error', 'Read-only agent investigation modified files. Changes were reverted and run stopped.');
      }
      if (!investigation.ok) {
        await log('agent_fail', 'Autonomous diagnosis failed', investigation.summary);
        return await final('agent_error', `Investigation agent did not produce a safe plan: ${investigation.summary}`);
      }
      if (investigation.plan.action !== 'repair') {
        await log('agent_stop', 'Investigation agent declined unsafe repair', investigation.plan.reason);
        return await final('agent_error', `Agent chose not to repair: ${investigation.plan.reason}`);
      }
      await log('agent_plan', 'Antigravity authored its own repair instructions', `${investigation.plan.diagnosis} · proposed: ${investigation.plan.targetFiles.join(', ')}`.slice(0, 1300));
      await log('agent_start', `Antigravity executing plan · attempt ${attempt}`, 'Using its own recorded diagnosis and repair instructions');
      const before = await snapshot();
      const agent = await runAgent(config, investigation.plan, runDir, attempt, logger.log);
      const guard = await reviewAndGuard(before, config.editablePaths);
      const after = await snapshot();
      const diff = summarizeDiff(before, after, guard.changed);
      const repair = { attempt: iteration + 1, ...agent, changedFiles: guard.changed, rejectedFiles: guard.rejected, diff };
      run.repairs.push(repair);
      run.changedFiles = [...new Set([...run.changedFiles, ...guard.changed])];
      run.lastDiff = diff;
      await writeFile(path.join(runDir, `source-diff-${iteration + 1}.txt`), diff);
      if (guard.rejected.length) {
        await log('safety_reject', 'Unauthorized edits rolled back', guard.rejected.join(', '));
        return await final('safety_error', 'The repair agent edited protected files. Unauthorized changes were reverted; verification halted.');
      }
      if (!agent.ok) {
        await log('agent_fail', 'Agent could not complete repair', agent.summary);
        return await final('agent_error', `Antigravity failed: ${agent.summary}`);
      }
      if (!guard.changed.length) {
        await log('agent_fail', 'No application code changed', 'Agent reported success but did not edit an allowlisted source file');
        return await final('agent_error', 'Agent produced no source modification; cannot claim to have repaired a regression.');
      }
      priorDiff = diff;
      await log('agent_fix', `Code patched · ${guard.changed.length} file(s)`, `${guard.changed.join(', ')} · ${agent.summary}`.slice(0, 1300));
      await log('recheck', 'Re-verifying with Kane CLI', 'Browser tests rerun against actual modified source; the critical suite remains unchanged');
    }
    return await final('failed', 'Retry budget exceeded');
  } catch (error) {
    if (run) {
      run.status = 'infrastructure_error';
      run.completedAt = now();
      run.timeline.push({ at: now(), kind: 'stopped', title: 'Unexpected engine error', detail: formatError(error) });
      logger?.log('ERROR', formatError(error));
      await persist(run);
      onUpdate(structuredClone(run));
      return run;
    }
    throw error;
  } finally { await logger?.flush(); releaseEngine(); }
}
