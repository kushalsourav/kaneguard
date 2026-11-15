import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, RUNS, now, shortId, configFor, execProcess, formatError } from './common.mjs';
import { persist, getRun } from './storage.mjs';
import { reserveEngine, precheck } from './orchestrator.mjs';
import { runKane } from './kane.mjs';
import { planRepair, runAgent } from './agent.mjs';
import { planFeature, implementFeatureTask, validateBuildInput, parseFeaturePlan } from './feature-agent.mjs';
import { orderedFeatureTasks, readyMilestoneChecks, verifiedTaskIds } from './milestones.mjs';
import { snapshot, saveCheckpoint, reviewAndGuard, summarizeDiff, isPermittedSourceChange } from './snapshot.mjs';
import { createRunLogger } from './live-logger.mjs';

const editableScope = (appId) => `public/${appId}/**`;
export function featureEditableFiles(config, snapshotMap) {
  const prefix = `public/${config.id}/`;
  return [...new Set([
    ...config.editablePaths,
    ...[...snapshotMap.keys()].filter((f) => f.startsWith(prefix) && isPermittedSourceChange(f, [editableScope(config.id)]))
  ])];
}

/** Keep browser tests independent: the output of one Antigravity task is never
 * a PASS. Only a real Kane run_end PASSED event can verify an acceptance check.
 * Repair attempts share a single bounded budget across all milestones.
 */
export async function buildFeature(appId, requestedFeature, onUpdate = () => {}, { resumedFrom = null, resumedPlan = null } = {}) {
  const input = validateBuildInput(appId, requestedFeature);
  const releaseEngine = reserveEngine();
  let logger, run, writes = Promise.resolve();
  try {
    const config = await configFor(input.appId);
    const runDir = path.join(RUNS, shortId());
    await mkdir(runDir, { recursive:true });
    logger = createRunLogger(runDir, path.basename(runDir));
    run = {
      id:path.basename(runDir), mode:'build', workflowVersion:11,
      appId:input.appId, appLabel:config.label, request:input.prompt,
      featureTitle:null, status:'running', stage:resumedPlan ? 'verifying' : 'planning', resumedFrom,
      createdAt:now(), completedAt:null, currentFlow:null, iteration:0, maxRepairs:config.maxRepairs,
      timeline:[], tasks:[], generatedFlows:[], verification:[], plans:[], repairs:[],
      taskExecutions:[], milestones:[], checkedFeatureIds:[],
      changedFiles:[], lastDiff:'', failure:null, artifacts:{}
    };
    const sync = () => {
      writes = writes.then(() => persist(run));
      return writes.then(() => onUpdate(structuredClone(run)));
    };
    const log = async (kind, title, detail = '') => {
      run.timeline.push({at:now(),kind,title,detail});
      logger.log('WORKFLOW', `${title}${detail ? ` — ${detail}` : ''}`);
      await sync();
    };
    const complete = async (status, summary) => {
      run.status = status;
      run.stage = 'finished';
      run.completedAt = now();
      if (status !== 'passed') for (const t of run.tasks) if (t.status !== 'verified') t.status = 'blocked';
      logger.log('VERDICT', `${status.toUpperCase()} · ${summary}`);
      await log(status === 'passed' ? 'success' : 'stopped', status === 'passed' ? 'Feature shipped and Kane-verified' : 'Feature workflow stopped', summary);
      return run;
    };
    logger.log('ENGINE', `Developer feature request for ${config.label}: ${input.prompt}`);
    await log('start', `Developer requested feature for ${config.label}`, input.prompt);
    const baseline = await snapshot();
    await saveCheckpoint(baseline, runDir);
    await log('checkpoint', 'Created recoverable source checkpoint', 'Before any agent actions');

    let plan;
    if (resumedPlan) {
      plan = parseFeaturePlan(JSON.stringify(resumedPlan));
      run.featureTitle = plan.featureTitle;
      run.planSummary = plan.summary;
      run.tasks = plan.tasks.map((t) => ({...t, status:'candidate'}));
      run.generatedFlows = plan.acceptance;
      await writeFile(path.join(runDir,'feature-plan.json'), JSON.stringify({agentGenerated:true,resumedFrom,...plan},null,2));
      run.artifacts.featurePlan = 'feature-plan.json';
      await log('resume', `Resuming saved Antigravity plan from ${resumedFrom}`, `No implementation or planning rerun; checking ${plan.acceptance.length} original Kane objectives on existing code`);
    } else {
      const beforePlanning = await snapshot();
      Object.assign(run.artifacts, {
        plannerPrompt:'feature-planning-prompt.txt', plannerTrace:'feature-plan-agent.ndjson',
        plannerStderr:'feature-plan-agent.stderr.log', featurePlanCandidate:'feature-plan-candidate.json'
      });
      await log('agent_plan_start','Antigravity creating task-by-task implementation plan','Defining dependencies and independent Kane acceptance checks');
      let planning, planningError = null;
      try { planning = await planFeature(config,input.prompt,runDir,logger.log); }
      catch (error) { planningError = error; }
      const planningGuard = await reviewAndGuard(beforePlanning,[]);
      if (planningGuard.rejected.length) return await complete('safety_error',`Planning changed source; reverted: ${planningGuard.rejected.join(', ')}`);
      if (planningError) return await complete('agent_error',`Could not generate valid agent plan: ${formatError(planningError)}`);
      plan = planning.plan;
      run.featureTitle = plan.featureTitle;
      run.planSummary = plan.summary;
      run.tasks = plan.tasks.map((t) => ({...t,status:'planned'}));
      run.generatedFlows = plan.acceptance;
      run.artifacts.featurePlan = planning.planFile;
      await log('agent_plan',`Antigravity authored ${plan.tasks.length} tasks and ${plan.acceptance.length} browser checks`,plan.summary);
      for (const task of plan.tasks) await log('task_created',`Task: ${task.title}`,task.detail);
      for (const check of plan.acceptance) await log('test_created',`Kane objective: ${check.name}`,check.objective);
    }

    const allOrderedTasks = orderedFeatureTasks(plan);
    let repairCount = 0, verificationRound = 0, previousDiff = '';
    const implementedIds = new Set();
    const passedMilestoneIds = new Set();
    const protectedFeatureFlows = plan.acceptance.map((f) => Object.freeze({...f,id:`feature-${f.id}`,generated:true,acceptanceId:f.id}));
    const protectedRegressionFlows = config.flows.map((f) => Object.freeze({...f,generated:false}));

    const recordDiff = async (diff, files) => {
      run.changedFiles = [...new Set([...run.changedFiles,...files])];
      if (diff) run.lastDiff = `${run.lastDiff}${run.lastDiff ? '\n\n' : ''}${diff}`.slice(-30000);
      await writeFile(path.join(runDir,'feature-source-diff.txt'),run.lastDiff);
      run.artifacts.sourceDiff = 'feature-source-diff.txt';
    };
    const updateVerifiedTasks = () => {
      const verified = new Set(verifiedTaskIds(plan,passedMilestoneIds));
      for (const t of run.tasks) if (implementedIds.has(t.id)) t.status = verified.has(t.id) ? 'verified' : 'candidate';
      // Early non-UI tasks can only be verified by a later browser-capable
      // milestone. Preserve that provenance instead of leaving them WAITING.
      for (const gate of run.milestones)
        if (gate.status === 'awaiting_dependencies' && verified.has(gate.taskId)) gate.status = 'verified_later';
      run.checkedFeatureIds = [...passedMilestoneIds];
    };

    // Used for both intermediate Kane milestones and the immutable final suite.
    // Returns a factual error result rather than turning a failed check into PASS.
    async function verifyGate(flows, gateLabel, gateTaskId = null) {
      let gateRetests = 0;
      while (true) {
        const wave = verificationRound++;
        run.iteration = repairCount;
        run.stage = gateRetests ? 'reverifying' : 'verifying';
        let focus = null;
        const preflight = await precheck(config);
        if (preflight.ok) {
          // Check generated source files too, not only the original editablePaths.
          const appSnapshot = await snapshot();
          for (const file of featureEditableFiles(config,appSnapshot).filter((f) => /\.(?:mjs|js)$/.test(f))) {
            const syntax = await execProcess(process.execPath,['--check',path.join(ROOT,file)],{timeoutMs:12000});
            if (syntax.code !== 0) {
              preflight.ok = false;
              preflight.summary = `${file}: ${syntax.stderr || syntax.spawnError || 'syntax error'}`.slice(0,1500);
              break;
            }
          }
        }
        if (!preflight.ok) {
          if (preflight.infrastructure) return {ok:false,status:'infrastructure_error',summary:preflight.summary};
          focus = {verdict:'precheck_failed',summary:preflight.summary,objective:'Changed JavaScript modules must compile before browser validation'};
          run.failure = focus;
          await log('precheck_fail',`${gateLabel}: source precheck failed`,preflight.summary);
        } else if (flows.length === 0) {
          // A non-UI task may be valid without a browser-facing acceptance check yet.
          // It remains CANDIDATE, never verified by syntax alone.
          await log('task_syntax',`${gateLabel}: syntax precheck passed`,'Kane gate deferred until dependent functionality exists');
          return {ok:true,passed:[]};
        } else {
          await log('milestone_start',`Kane gate · ${gateLabel}`,`${flows.length} real browser check(s); wave ${wave+1}`);
          const passed = [];
          for (const flow of flows) {
            run.currentFlow = flow.name;
            await sync();
            const notify = (event) => { run.timeline.push(event); void sync().catch(() => {}); };
            // Infrastructure trouble is not a product defect. Retry the SAME
            // locked objective once, using distinct filenames and fresh browser
            // evidence. Never tell the coding agent to repair an infrastructure error.
            let result;
            for (let infraRetry = 0; infraRetry <= 1; infraRetry++) {
              const invocation = infraRetry ? verificationRound++ : wave;
              result = await runKane(config,flow,runDir,invocation,notify,logger.log);
              run.verification.push({...result,generated:flow.generated,objective:flow.objective,
                gate:gateLabel,taskId:gateTaskId,infrastructureRetry:infraRetry});
              await sync();
              if (result.verdict !== 'infrastructure_error' || !result.retryableInfrastructure || infraRetry === 1) break;
              await log('kane_retry',`Kane retrying ${flow.name}`,`Infrastructure interruption; original browser check and evidence are preserved`);
            }
            run.currentFlow = null;
            await sync();
            if (result.verdict === 'infrastructure_error') {
              run.failure = result;
              return {ok:false,status:'infrastructure_error',summary:`Kane infrastructure was unavailable after retry: ${result.summary}`};
            }
            if (result.verdict === 'failed') {
              focus = {...result,objective:flow.objective};
              run.failure = focus;
              await log('kane_fail',`Kane found failure in ${gateLabel}`,flow.name);
              break;
            }
            passed.push(flow);
            await log('kane_pass',`Kane passed ${flow.generated ? 'agent-authored feature' : 'protected regression'} check`,flow.name);
          }
          if (!focus) {
            run.failure = null;
            await log('milestone_pass',`Kane gate passed · ${gateLabel}`,`${passed.length} authentic browser runs passed`);
            return {ok:true,passed};
          }
        }

        if (repairCount >= config.maxRepairs) return {ok:false,status:'failed',summary:`Exhausted ${config.maxRepairs} total autonomous repairs. Last failure: ${focus.summary}`};
        const attempt = ++repairCount;
        run.iteration = attempt;
        run.stage = 'repairing';
        const activeTask = gateTaskId && run.tasks.find((t) => t.id === gateTaskId);
        if (activeTask) activeTask.status = 'repairing';
        await log('agent_plan_start',`Antigravity diagnosing failure · repair ${attempt}/${config.maxRepairs}`,`Gate: ${gateLabel}; source evidence and unchanged acceptance objective will be passed to agent`);
        const beforeDiagnosis = await snapshot();
        const repairConfig = {...config,editablePaths:featureEditableFiles(config,beforeDiagnosis)};
        let investigation, diagnosisError;
        try { investigation = await planRepair(repairConfig,focus,runDir,attempt,previousDiff,logger.log); }
        catch (error) { diagnosisError = error; }
        const diagnosisGuard = await reviewAndGuard(beforeDiagnosis,[]);
        if (investigation) run.plans.push({attempt,gate:gateLabel,...investigation});
        await sync();
        if (diagnosisGuard.rejected.length) return {ok:false,status:'safety_error',summary:`Read-only diagnosis edited files; reverted: ${diagnosisGuard.rejected.join(', ')}`};
        if (diagnosisError) return {ok:false,status:'agent_error',summary:`Diagnosis failed: ${formatError(diagnosisError)}`};
        if (!investigation.ok || investigation.plan?.action !== 'repair') return {ok:false,status:'agent_error',summary:investigation.summary || investigation.plan?.reason || 'Antigravity declined repair'};
        await log('agent_plan',`Antigravity authored repair instructions #${attempt}`,investigation.plan.diagnosis);
        const beforeRepair = await snapshot();
        let repair, repairError;
        try { repair = await runAgent(repairConfig,investigation.plan,runDir,attempt,logger.log); }
        catch (error) { repairError = error; }
        const repairGuard = await reviewAndGuard(beforeRepair,[editableScope(config.id)]);
        const afterRepair = await snapshot();
        const diff = summarizeDiff(beforeRepair,afterRepair,repairGuard.changed);
        await writeFile(path.join(runDir,`source-diff-${attempt}.txt`),diff);
        await recordDiff(diff,repairGuard.changed);
        if (repair) run.repairs.push({attempt,gate:gateLabel,...repair,changedFiles:repairGuard.changed,rejectedFiles:repairGuard.rejected,diff});
        await sync();
        if (repairGuard.rejected.length) return {ok:false,status:'safety_error',summary:`Repair edited protected files; reverted: ${repairGuard.rejected.join(', ')}`};
        if (repairError) return {ok:false,status:'agent_error',summary:`Repair execution failed: ${formatError(repairError)}`};
        if (!repairGuard.changed.length || (!repair.ok && !repair.recoverableTimeout)) return {ok:false,status:'agent_error',summary:`Agent repair failed or made no source edits: ${repair.summary}`};
        if (repair.recoverableTimeout && !repair.ok) await log('agent_partial',`Repair #${attempt} timed out after source changes`,'Candidate only; next Kane run decides whether it is fixed');
        previousDiff = diff;
        gateRetests++;
        if (activeTask) activeTask.status = 'candidate';
        await log('recheck',`Kane retesting after repair #${attempt}`,`Re-running ${flows.length} check(s) in gate ${gateLabel}`);
        // Rerun ALL checks in this gate on the modified code, including ones that
        // passed before the failing check. The full suite is run again at the end.
      }
    }

    if (!resumedPlan) {
      for (const task of allOrderedTasks) {
        const activeTask = run.tasks.find((t) => t.id === task.id);
        const milestone = {id:`milestone-${task.id}`,taskId:task.id,title:task.title,
          checkIds:[],status:'implementing',startedAt:now(),completedAt:null};
        run.milestones.push(milestone);
        activeTask.status = 'implementing';
        run.stage = 'implementing';
        await log('task_start',`Antigravity implementing task ${implementedIds.size+1}/${plan.tasks.length}: ${task.title}`,`Dependencies: ${(task.dependsOn || []).join(', ') || 'none'}`);
        // Publish the real task handoff filename immediately so the frontend
        // can inspect the task-specific prompt during live execution.
        const prefix = `feature-task-${task.id}`;
        const taskRecord = {taskId:task.id,status:'running',handoffFile:`${prefix}-handoff.txt`,outputFile:`${prefix}-agent.ndjson`,stderrFile:`${prefix}-agent.stderr.log`,diffFile:`${prefix}-diff.txt`};
        run.taskExecutions.push(taskRecord);
        await sync();
        const beforeTask = await snapshot();
        let execution, executionError;
        const completedTasks = allOrderedTasks.filter((t) => implementedIds.has(t.id)).map((t) => ({id:t.id,title:t.title}));
        try { execution = await implementFeatureTask(config,input.prompt,plan,task,completedTasks,runDir,logger.log); }
        catch (error) { executionError = error; }
        const taskGuard = await reviewAndGuard(beforeTask,[editableScope(config.id)]);
        const afterTask = await snapshot();
        const diff = summarizeDiff(beforeTask,afterTask,taskGuard.changed);
        await writeFile(path.join(runDir,`${prefix}-diff.txt`),diff);
        await recordDiff(diff,taskGuard.changed);
        Object.assign(taskRecord,{...execution, status: execution?.ok ? 'completed' : execution?.recoverableTimeout ? 'interrupted' : 'failed',
          changedFiles:taskGuard.changed,rejectedFiles:taskGuard.rejected});
        if (executionError) taskRecord.error = formatError(executionError);
        await sync();
        if (taskGuard.rejected.length) return await complete('safety_error',`Task ${task.id} modified protected files; reverted: ${taskGuard.rejected.join(', ')}`);
        if (executionError) return await complete('agent_error',`Task ${task.id}: ${formatError(executionError)}`);
        if (!execution.ok && (!execution.recoverableTimeout || !taskGuard.changed.length)) return await complete('agent_error',`Task ${task.id}: ${execution.summary}`);
        if (execution.recoverableTimeout) {
          run.implementationInterrupted = true;
          await log('agent_partial',`Task ${task.id} interrupted with real source edits`,'Candidate only; Kane will verify the functionality before any PASS');
        } else {
          await log('task_implemented',`Antigravity completed implementation of ${task.id}`,`${taskGuard.changed.length} app file(s) changed. Awaiting Kane evidence.`);
        }
        previousDiff = diff || previousDiff;
        implementedIds.add(task.id);
        activeTask.status = 'candidate';
        const ready = readyMilestoneChecks(plan,implementedIds,passedMilestoneIds);
        milestone.checkIds = ready.map((check) => check.id);
        milestone.status = ready.length ? 'verifying' : 'awaiting_dependencies';
        await sync();
        const gate = await verifyGate(ready.map((check) => protectedFeatureFlows.find((flow) => flow.acceptanceId === check.id)),`After ${task.id}: ${task.title}`,task.id);
        if (!gate.ok) { milestone.status = 'failed'; milestone.completedAt = now(); await sync(); return await complete(gate.status,gate.summary); }
        for (const check of gate.passed) if (check.acceptanceId) passedMilestoneIds.add(check.acceptanceId);
        milestone.status = ready.length ? 'passed' : 'awaiting_dependencies';
        milestone.completedAt = now();
        updateVerifiedTasks();
        await sync();
      }
      if (passedMilestoneIds.size !== plan.acceptance.length) return await complete('agent_error','Not every agent-generated browser objective became eligible for a milestone');
    }

    // Even though milestone checks passed earlier, later tasks or repairs can
    // regress them. This final locked suite must pass on the CURRENT source.
    const finalMilestone = {id:'milestone-final',taskId:null,title:'Final feature and protected regression suite',
      checkIds:plan.acceptance.map((check) => check.id),status:'verifying',startedAt:now(),completedAt:null};
    run.milestones.push(finalMilestone);
    run.stage = 'final_verification';
    await log('final_suite','Kane running final protected browser suite',`${plan.acceptance.length} agent-authored checks + ${config.flows.length} existing regressions; all on final source`);
    const final = await verifyGate([...protectedFeatureFlows,...protectedRegressionFlows],'Final full suite');
    if (!final.ok) { finalMilestone.status = 'failed'; finalMilestone.completedAt = now(); await sync(); return await complete(final.status,final.summary); }
    for (const task of run.tasks) task.status = 'verified';
    for (const gate of run.milestones) if (gate.status === 'awaiting_dependencies') gate.status = 'verified_later';
    for (const check of plan.acceptance) passedMilestoneIds.add(check.id);
    run.checkedFeatureIds = [...passedMilestoneIds];
    run.failure = null;
    finalMilestone.status = 'passed'; finalMilestone.completedAt = now();
    await sync();
    return await complete('passed',`${plan.acceptance.length} Antigravity-authored feature checks and ${config.flows.length} protected regressions passed in real Kane browser runs; ${repairCount} autonomous repair(s).`);
  } catch (error) {
    if (run) {
      run.status = 'infrastructure_error'; run.stage = 'finished'; run.completedAt = now();
      run.timeline.push({at:now(),kind:'stopped',title:'Unexpected workflow error',detail:formatError(error)});
      logger?.log('ERROR',formatError(error));
      await persist(run); onUpdate(structuredClone(run));
      return run;
    }
    throw error;
  } finally {
    try { await writes; await logger?.flush(); } finally { releaseEngine(); }
  }
}

/** Keep the v10 recovery behavior: verify existing source with locked, saved
 * objectives. Never re-run the planner/implementer for these older runs. */
export async function inspectResumableFeature(sourceRunId) {
  const prior = await getRun(sourceRunId);
  if (!prior || prior.mode !== 'build' || !['agent_error','failed','infrastructure_error'].includes(prior.status) ||
      !prior.artifacts?.featurePlan || !Array.isArray(prior.changedFiles) || !prior.changedFiles.length) {
    throw new Error('Only a stopped feature build with saved plan and source changes can be reverified');
  }
  if (!['cartlab','coinpulse'].includes(prior.appId)) throw new Error('Unsupported app');
  if (!/^[a-zA-Z0-9._-]+$/.test(prior.artifacts.featurePlan)) throw new Error('Unsafe plan evidence filename');
  const saved = JSON.parse(await readFile(path.join(RUNS,prior.id,prior.artifacts.featurePlan),'utf8'));
  const plan = parseFeaturePlan(JSON.stringify(saved));
  const config = await configFor(prior.appId);
  const trustedOrigin = new URL(config.url).origin;
  for (const flow of plan.acceptance) for (const hit of flow.objective.matchAll(/https?:\/\/[^\s)"']+/g)) {
    let dest;
    try { dest = new URL(hit[0]); } catch { throw new Error('Saved browser objective has invalid URL'); }
    if (dest.origin !== trustedOrigin) throw new Error('Saved browser objective targets an external origin');
  }
  return {prior,plan};
}
export async function resumeFeatureRun(sourceRunId,onUpdate = () => {}) {
  const {prior,plan} = await inspectResumableFeature(sourceRunId);
  return buildFeature(prior.appId,prior.request,onUpdate,{resumedFrom:prior.id,resumedPlan:plan});
}
