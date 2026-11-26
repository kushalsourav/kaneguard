import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT, RUNS, now, shortId, configFor, execProcess, formatError , isStopRequested } from './common.mjs';
import { persist, getRun } from './storage.mjs';
import { reserveEngine, precheck } from './orchestrator.mjs';
import { runKane, isKaneAutomationMisstep } from './kane.mjs';
import { planRepair, runAgent } from './agent.mjs';
import { planFeature, implementFeatureTask, validateBuildInput, parseFeaturePlan , validateKaneObjective } from './feature-agent.mjs';
import { orderedFeatureTasks, readyMilestoneChecks, verifiedTaskIds, pendingMilestoneDependencies } from './milestones.mjs';
import { snapshot, saveCheckpoint, reviewAndGuard, summarizeDiff, isPermittedSourceChange } from './snapshot.mjs';
import { createRunLogger } from './live-logger.mjs';
import { validateAgent, agentInfo } from './adapters.mjs';
import { allowedScope, sourcePrefix, sourceFileFor } from './connected-projects.mjs';
import {objectiveHash,sealedObjectives,saveObjectiveSeal,assertObjectiveUnchanged,buildRequirementMatrix,requestClauses} from './assurance.mjs';
import {runSabotageCheck} from './sabotage.mjs';
import {loadRegressionBaseline, saveRegressionBaseline} from './regression-baseline.mjs';
import {reviewKaneFailure} from './test-court.mjs';

const editableScope = (appId,config) => config ? allowedScope(config) : `public/${appId}/**`;
/** A prior genuine Kane PASS may be reused only while the complete editable
 * application source is byte-for-byte identical. Tests/configs and evidence
 * are deliberately not part of the application fingerprint. */
export function appSourceFingerprint(appId, snapshotMap, config) {
  const hash = createHash('sha256');
  const files = [...snapshotMap.keys()].filter((name) =>
    isPermittedSourceChange(name, [editableScope(appId,config)])).sort();
  for (const name of files) {
    hash.update(name); hash.update('\0'); hash.update(snapshotMap.get(name)); hash.update('\0');
  }
  return hash.digest('hex');
}

export function featureEditableFiles(config, snapshotMap) {
  const prefix = sourcePrefix(config);
  return [...new Set([
    ...config.editablePaths,
    ...[...snapshotMap.keys()].filter((f) => f.startsWith(prefix) && isPermittedSourceChange(f, [editableScope(config.id,config)]))
  ])];
}

/** Keep browser tests independent: the output of one Antigravity task is never
 * a PASS. Only a real Kane run_end PASSED event can verify an acceptance check.
 * Repair attempts share a single bounded budget across all milestones.
 */
function markRunStopped(run, logger) {
  if (run.stoppedByUser) return;
  run.stoppedByUser = true;
  run.interruptionReason = 'You stopped this run. The coding agent and Kane CLI were terminated; files the agent already changed are kept, and earlier Kane results stay visible.';
  run.timeline.push({at:now(),kind:'stopped',title:'Stopped by you',detail:'Coding agent and Kane CLI processes were terminated.'});
  logger?.log('STOP','Run stopped by user · coding agent and Kane CLI terminated');
}

export async function buildFeature(appId, requestedFeature, onUpdate = () => {}, { resumedFrom = null, resumedPlan = null, continuation = null, agentId = 'antigravity', examinerAgentId = null, blindBuilder = false, sabotage = false } = {}) {
  const input = validateBuildInput(appId, requestedFeature);
  validateAgent(agentId);
  if (examinerAgentId) validateAgent(examinerAgentId);
  if (typeof blindBuilder !== 'boolean' || typeof sabotage !== 'boolean') throw new Error('Invalid assurance options');
  const examinerId = examinerAgentId || agentId;
  const releaseEngine = reserveEngine();
  let logger, run, writes = Promise.resolve();
  try {
    const config = {...await configFor(input.appId), agentId, blindBuilder};
    const priorRegression = await loadRegressionBaseline(config);
    const agentName = agentInfo(agentId).label;
    const runDir = path.join(RUNS, shortId());
    await mkdir(runDir, { recursive:true });
    logger = createRunLogger(runDir, path.basename(runDir));
    run = {
      id:path.basename(runDir), mode:'build', workflowVersion:31, agentId, examinerAgentId:examinerId, blindBuilder, sabotageRequested:sabotage, projectId:['playground','connected'].includes(config.kind) ? config.id : null, previewUrl:config.launchUrl,
      appId:input.appId, appLabel:config.label, request:input.prompt,
      featureTitle:null, status:'running', stage:resumedPlan ? (continuation ? 'implementing' : 'verifying') : 'planning', resumedFrom, continuedFrom:continuation ? resumedFrom : null,
      createdAt:now(), completedAt:null, currentFlow:null, iteration:0, maxRepairs:config.maxRepairs,
      timeline:[], tasks:[], generatedFlows:[], verification:[], plans:[], repairs:[],
      taskExecutions:[], milestones:[], checkedFeatureIds:[], reusedVerification:[],
      changedFiles:[], lastDiff:'', failure:null, objectiveSeals:[], requirements:[], requirementsSource:'not supplied', artifacts:{},
      examinerReviews:[],testDisputes:[],regressionProtection:{carriedFromPreviousRuns:priorRegression.flows.length,previousRevision:priorRegression.revision,checkedThisRun:0,addedAfterPass:0}
    };
    // Keep the developer-authored request as the canonical visible prompt,
    // including during recovery-only runs that bypass Antigravity planning.
    await writeFile(path.join(runDir, 'feature-user-request.txt'), input.prompt);
    run.artifacts.userRequest = 'feature-user-request.txt';
    const sync = () => {
      run.assurance = buildRequirementMatrix(run);
      writes = writes.then(() => persist(run));
      return writes.then(() => onUpdate(structuredClone(run)));
    };
    const log = async (kind, title, detail = '') => {
      run.timeline.push({at:now(),kind,title,detail});
      logger.log('WORKFLOW', `${title}${detail ? ` — ${detail}` : ''}`);
      await sync();
    };
    const complete = async (status, summary) => {
      // A user stop wins over whatever the half-finished step reported.
      if (isStopRequested()) { status = 'interrupted'; summary = 'Stopped by you before the run finished. Files already changed are kept.'; markRunStopped(run, logger); }
      run.status = status;
      run.stage = 'finished';
      run.completedAt = now();
      run.activeGate = null; run.currentFlow = null; run.currentFlowId = null;
      if (status !== 'passed') for (const t of run.tasks) if (t.status !== 'verified' && t.status !== 'unresolved')
        t.status = status === 'verification_inconclusive' && t.status !== 'planned' ? 'verification_inconclusive' : 'blocked';
      if(status==='passed') {
        try {
          const result=await saveRegressionBaseline(config,run);
          Object.assign(run.regressionProtection,{checkedThisRun:priorRegression.flows.length,addedAfterPass:result.added,
            currentProtectedChecks:result.count,overflow:result.skipped,revision:result.revision});
          logger.log('REGRESSION',`Persisted ${result.added} genuinely Kane-verified objectives as future regression checks; ${result.count} total`);
        } catch(error) {
          // The completed Kane browser proof remains true, but cross-run
          // baseline persistence failed and MUST be disclosed explicitly.
          run.regressionProtection.error=formatError(error);
          logger.log('REGRESSION ERROR',`Future regression registration failed: ${formatError(error)}`);
        }
      }
      logger.log('VERDICT', `${status.toUpperCase()} · ${summary}`);
      await log(status === 'passed' ? 'success' : 'stopped', status === 'passed' ? 'Feature shipped and Kane-verified' : 'Feature workflow stopped', summary);
      return run;
    };
    logger.log('ENGINE', `Builder ${agentInfo(agentId).label} · examiner ${agentInfo(examinerId).label} · developer feature request for ${config.label}: ${input.prompt}`);
    await log('start', `Developer requested feature for ${config.label}`, input.prompt);
    const baseline = await snapshot({config});
    await saveCheckpoint(baseline, runDir);
    await log('checkpoint', 'Created recoverable source checkpoint', 'Before any agent actions');

    let plan;
    if (resumedPlan) {
      plan = parseFeaturePlan(JSON.stringify(resumedPlan));
      run.featureTitle = plan.featureTitle;
      run.planSummary = plan.summary;
      run.tasks = plan.tasks.map((t) => ({...t, status:continuation ? 'planned' : 'candidate'}));
      run.generatedFlows = plan.acceptance;
      await writeFile(path.join(runDir,'feature-plan.json'), JSON.stringify({agentGenerated:true,resumedFrom,...plan},null,2));
      run.artifacts.featurePlan = 'feature-plan.json';
      if (continuation?.testRevisions?.length) {
        run.testRevisions = continuation.testRevisions;
        for (const r of continuation.testRevisions)
          await log('test_revision',`Human-approved test revision sealed · ${r.checkName}`,
            `v1 ${r.fromHash.slice(0,12)}… → v2 ${r.toHash.slice(0,12)}… · approved: ${String(r.approvalNote||'').slice(0,200)} · The original Kane FAIL stays on record in ${r.sourceRunId}.`);
      }
      if (continuation) {
        const todo = plan.tasks.filter((t)=>!continuation.verified.has(t.id)&&!continuation.coded.has(t.id)).length;
        await log('continue', `Continuing stopped run ${resumedFrom} with the same plan and locked Kane checks`,
          `${continuation.verified.size} task(s) already Kane-verified (rechecked in the final suite), ${continuation.coded.size} coded but untested (Kane runs now), ${todo} still to build`);
      } else await log('resume', `Resuming saved ${agentName} plan from ${resumedFrom}`, `No implementation or planning rerun; checking ${plan.acceptance.length} original Kane objectives on existing code`);
    } else {
      const beforePlanning = await snapshot({config});
      Object.assign(run.artifacts, {
        userRequest:'feature-user-request.txt', sourceContext:'feature-source-context.txt',
        plannerPrompt:'feature-planning-prompt.txt', plannerTrace:'feature-plan-agent.ndjson',
        plannerStderr:'feature-plan-agent.stderr.log', featurePlanCandidate:'feature-plan-candidate.json'
      });
      await log('agent_plan_start',`${agentInfo(examinerId).label} creating task-by-task implementation plan`,'Defining dependencies and independent Kane acceptance checks');
      let planning, planningError = null;
      try { planning = await planFeature({...config,agentId:examinerId},input.prompt,runDir,logger.log); }
      catch (error) { planningError = error; }
      const planningGuard = await reviewAndGuard(beforePlanning,[],{config});
      if (planningGuard.rejected.length) return await complete('safety_error',`Planning changed source; reverted: ${planningGuard.rejected.join(', ')}`);
      if (planningError) return await complete('agent_error',`Could not generate valid agent plan: ${formatError(planningError)}`);
      plan = planning.plan;
      if (planning.corrected) Object.assign(run.artifacts,{
        plannerCorrectionPrompt:'feature-plan-revision-prompt.txt',plannerCorrectionTrace:'feature-plan-revision-agent.ndjson',
        plannerCorrectionCandidate:'feature-plan-revision-candidate.json'
      });
      run.featureTitle = plan.featureTitle;
      run.planSummary = plan.summary;
      run.tasks = plan.tasks.map((t) => ({...t,status:'planned'}));
      run.generatedFlows = plan.acceptance;
      run.artifacts.featurePlan = planning.planFile;
      await log('agent_plan',`${agentInfo(examinerId).label} authored ${plan.tasks.length} tasks and ${plan.acceptance.length} browser checks`,plan.summary);
      for (const task of plan.tasks) await log('task_created',`Task: ${task.title}`,task.detail);
      for (const check of plan.acceptance) await log('test_created',`Kane objective: ${check.name}`,check.objective);
    }

    // Objective seal is saved before any implementation turn; it is rechecked
    // against the originally frozen objective and the disk seal before EVERY CLI
    // invocation, including retries and final suites.
    run.objectiveSeals = await saveObjectiveSeal(runDir,plan.acceptance);
    run.artifacts.objectiveSeal = 'objective-seal.json';
    const bulletRequirements=requestClauses(input.prompt);
    const mapped=plan.requirements||[];
    const missing=bulletRequirements.filter(text=>!mapped.some(r=>r.text.toLowerCase()===text.toLowerCase()));
    run.requirements = [...mapped,...missing.map((text,i)=>({id:`req-missing-${i+1}`,text,taskIds:[],acceptanceIds:[]}))];
    run.requirementsSource = mapped.length ? (missing.length?'agent-mapped plus unmapped request clauses':'agent-mapped request requirements') : bulletRequirements.length ? 'unmapped user bullet points' : 'not supplied';
    if (!plan.requirements?.length) await log('requirement_gap','No validated first-class requirement mapping','Legacy-style agent plan; the studio will NOT claim complete requirement coverage.');
    else await log('requirements_mapped',`${run.requirements.length} requirements mapped to tasks and Kane checks`,'Unmapped or unsupported checks remain unproven.');

    // Scope transparency: a desktop Kane PASS does not establish a 375px mobile
    // layout PASS. Retain this note even if every executable desktop check passes.
    run.verificationLimits = /\b(?:mobile|responsive|viewport|tablet|375\s*px)\b/i.test(
      `${input.prompt} ${plan.tasks.map((task)=>task.detail).join(' ')}`)
      ? ['Mobile-width responsive layout was not independently tested by desktop Kane CLI.'] : [];
    await sync();

    const allOrderedTasks = orderedFeatureTasks(plan);
    let repairCount = 0, diagnosisCount = 0, verificationRound = 0, previousDiff = '';
    const implementedIds = new Set();
    const passedMilestoneIds = new Set();
    // Checks that passed before a user Stop. They count as "done" for task ordering
    // only; they are never shown as passed here until the final suite re-runs them.
    const carriedCheckIds = new Set();
    // Checks that could not be proven (disputed, or still failing after repairs). The build
    // carries on without them; they stay unproven and their evidence is kept.
    const unresolvedChecks = new Map();
    const settledCheckIds = () => new Set([...passedMilestoneIds,...carriedCheckIds,...unresolvedChecks.keys()]);
    // Browser results here are authentic passed run_end records, never AI opinions.
    // Keep genuine evidence for the duration of the run, indexed by the exact
    // objective AND complete application source bytes. A later source edit can
    // never reuse an earlier PASS unless the entire source fingerprint matches.
    const passedBrowserProof = new Map();
    const proofKey = (flow, fingerprint) => `${createHash('sha256').update(flow.objective, 'utf8').digest('hex')}:${fingerprint}`;
    const protectedFeatureFlows = plan.acceptance.map((f) => Object.freeze({...f,id:`feature-${f.id}`,generated:true,acceptanceId:f.id}));
    const protectedRegressionFlows = [
      ...config.flows.map((f) => Object.freeze({...f,generated:false})),
      ...priorRegression.flows.map((f) => Object.freeze({...f}))
    ].filter((flow,index,array)=>array.findIndex(other=>other.objective===flow.objective)===index);
    run.regressionProtection.checkedThisRun=protectedRegressionFlows.length;

    const recordDiff = async (diff, files) => {
      run.changedFiles = [...new Set([...run.changedFiles,...files])];
      if (diff) run.lastDiff = `${run.lastDiff}${run.lastDiff ? '\n\n' : ''}${diff}`.slice(-30000);
      await writeFile(path.join(runDir,'feature-source-diff.txt'),run.lastDiff);
      run.artifacts.sourceDiff = 'feature-source-diff.txt';
    };
    const updateVerifiedTasks = () => {
      const verified = new Set(verifiedTaskIds(plan,passedMilestoneIds));
      for (const t of run.tasks) if (implementedIds.has(t.id)) t.status = verified.has(t.id) ? 'verified' : (t.acceptanceIds||[]).some((id)=>unresolvedChecks.has(id)) ? 'unresolved' : 'candidate';
      // Early non-UI tasks can only be verified by a later browser-capable
      // milestone. Preserve that provenance instead of leaving them WAITING.
      for (const gate of run.milestones)
        if (gate.status === 'awaiting_dependencies' && verified.has(gate.taskId)) gate.status = 'verified_later';
      run.checkedFeatureIds = [...passedMilestoneIds];
    };

    // Used for both intermediate Kane milestones and the immutable final suite.
    // Returns a factual error result rather than turning a failed check into PASS.
    // One automatic test revision per check, only when Kane, the examiner and the
    // diagnosis all say the APP is right and the CHECK is wrong (see below).
    const revisedChecks = new Set();
    async function reviseDisputedCheck(flows, flow, dispute, gateLabel) {
      const candidate = {id:flow.acceptanceId,name:flow.name,objective:String(dispute.proposedObjective||'')};
      try { validateKaneObjective(candidate); }
      catch (error) { await log('test_revision_refused',`Revised check rejected · ${flow.name}`,formatError(error)); return false; }
      const origin = new URL(config.url).origin;
      for (const hit of candidate.objective.matchAll(/https?:\/\/[^\s)"']+/g)) {
        let dest; try { dest = new URL(hit[0]); } catch { dest = null; }
        if (!dest || dest.origin !== origin) { await log('test_revision_refused',`Revised check rejected · ${flow.name}`,'It points outside this app'); return false; }
      }
      const before = run.objectiveSeals.find((o)=>o.id===flow.acceptanceId);
      const check = plan.acceptance.find((c)=>c.id===flow.acceptanceId);
      if (!before || !check) return false;
      check.objective = candidate.objective;
      const resealed = sealedObjectives(plan.acceptance);
      run.objectiveSeals = resealed.map((o)=>o.id===flow.acceptanceId?{...o,version:(before.version||1)+1,previousSha256:before.sha256}:(run.objectiveSeals.find((x)=>x.id===o.id)||o));
      await saveObjectiveSeal(runDir,plan.acceptance);
      const next = Object.freeze({...flow,objective:candidate.objective});
      for (const list of [flows,protectedFeatureFlows]) { const i = list.findIndex((f)=>f.id===flow.id); if (i>=0) list[i]=next; }
      revisedChecks.add(flow.acceptanceId);
      const revision = {checkId:flow.acceptanceId,checkName:flow.name,fromHash:before.sha256,toHash:objectiveHash(candidate.objective),
        auto:true,at:now(),gate:gateLabel,reason:'Kane failed twice on unchanged source, the examiner classified the check as a test defect, and the diagnosis found no app change that satisfies it without contradicting the request.'};
      (run.testRevisions ||= []).push(revision);
      await writeFile(path.join(runDir,`test-revision-${flow.acceptanceId}.json`),JSON.stringify({...revision,previousObjective:dispute.originalObjective,objective:candidate.objective,examinerRationale:dispute.rationale,diagnosis:dispute.diagnosis||null},null,2));
      Object.assign(dispute,{decision:'auto_revised',decisionAt:now(),
        decisionNote:`Test fixed automatically and sealed as v${(before.version||1)+1}: Kane, the examiner and the diagnosis all found the app correct and the check self-contradictory. The v1 FAIL stays on record; only a real Kane PASS on the new version counts.`});
      await log('test_revision',`Test fixed and re-sealed as v${(before.version||1)+1} · ${flow.name}`,
        `v1 ${before.sha256.slice(0,12)}… → v2 ${revision.toHash.slice(0,12)}… · Original FAIL kept. Kane now runs the corrected check.`);
      return true;
    }
    async function verifyGateAndContinue(flows, gateLabel, gateTaskId = null) {
      let pending = flows.filter((f)=>!unresolvedChecks.has(f.acceptanceId||f.id));
      let last = {ok:true,passed:[]};
      while (pending.length) {
        last = await verifyGate(pending,gateLabel,gateTaskId);
        if (last.ok) return {...last,unresolved:[...unresolvedChecks.values()].filter((u)=>u.gate===gateLabel)};
        if (!['verification_inconclusive','failed'].includes(last.status) || isStopRequested()) return last;
        const bad = pending.find((f)=>f.id===run.failure?.flowId);
        if (!bad) return last;
        unresolvedChecks.set(bad.acceptanceId||bad.id,{checkId:bad.acceptanceId||bad.id,flowId:bad.id,name:bad.name,status:last.status,summary:last.summary,gate:gateLabel,taskId:gateTaskId});
        run.unresolvedChecks = [...unresolvedChecks.values()];
        await log('check_unresolved',`Kane check left unproven · ${bad.name}`,
          `${last.summary} Continuing with the rest of the build; this check stays unproven and all its Kane evidence is kept.`);
        run.failure = null; await sync();
        pending = pending.filter((f)=>f!==bad);
      }
      return {ok:true,passed:[],unresolved:[...unresolvedChecks.values()].filter((u)=>u.gate===gateLabel)};
    }
    async function verifyGate(flows, gateLabel, gateTaskId = null) {
      let gateRetests = 0;
      // A PASS in this gate remains valid while the underlying application source
      // is unchanged. Do not repeat six browser sessions after a no-code review.
      const passedOnCurrentSource = new Set();
      const disputedRetried = new Set();
      let sourceFingerprint = null;
      while (true) {
        const wave = verificationRound++;
        run.iteration = repairCount;
        run.stage = gateRetests ? 'reverifying' : 'verifying';
        let focus = null;
        run.currentFlow = null;
        run.currentFlowId = null;
        run.activeGate = gateLabel;
        const preflight = await precheck(config);
        if (preflight.ok) {
          // Check generated source files too, not only the original editablePaths.
          const appSnapshot = await snapshot({config});
          sourceFingerprint = appSourceFingerprint(config.id, appSnapshot,config);
          for (const file of (config.kind==='connected' ? [] : featureEditableFiles(config,appSnapshot).filter((f) => /\.(?:mjs|cjs|js)$/.test(f)))) {
            const syntax = await execProcess(process.execPath,['--check',sourceFileFor(config,file)],{timeoutMs:12000});
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
          const deferredTask = gateTaskId && run.tasks.find((t)=>t.id===gateTaskId);
          const blockers = deferredTask ? pendingMilestoneDependencies(plan,deferredTask.id,implementedIds,passedMilestoneIds) : [];
          const description = blockers.length
            ? `Browser checks deferred until dependent task(s) are implemented: ${[...new Set(blockers.flatMap(b=>b.blockedBy))].join(', ')}. Syntax alone does not verify this task.`
            : 'No independently runnable browser objective is available at this milestone; the task remains unverified.';
          await log('task_syntax',`${gateLabel}: syntax precheck passed`,description);
          return {ok:true,passed:[]};
        } else {
          await log('milestone_start',`Kane gate · ${gateLabel}`,`${flows.length} required browser objectives; only unchanged-source feature passes can reuse authentic evidence · wave ${wave+1}`);
          const passed = [];
          for (const flow of flows) {
            if (flow.generated) await assertObjectiveUnchanged(runDir,flow,run.objectiveSeals);
            if (passedOnCurrentSource.has(flow.id)) { passed.push(flow); continue; }
            // Incremental final gate: a protected regression identical to a
            // previously executed feature objective does not need a SECOND
            // browser session on the same application bytes. Also reuse a
            // milestone PASS if no source changed since that PASS. Distinct
            // objectives and any changed source ALWAYS run Kane for real.
            const previousProof = gateLabel === 'Final full suite'
              ? passedBrowserProof.get(proofKey(flow,sourceFingerprint)) : null;
            if (previousProof) {
              // The fingerprint is checked again at reuse time to avoid
              // accepting evidence when a file changes while Kane is running.
              const stillCurrent = appSourceFingerprint(config.id, await snapshot({config}), config);
              if (stillCurrent !== sourceFingerprint) return {ok:false,status:'infrastructure_error',
                summary:'Application source changed while reusing a Kane result; evidence is not valid for current code'};
              const duplicate = previousProof.flowId !== flow.id;
              const reused = {flowId:flow.id,flowName:flow.name,gate:gateLabel,
                fromGate:previousProof.gate,originalFlowId:previousProof.flowId,
                evidenceUrl:previousProof.evidenceUrl,stdoutFile:previousProof.stdoutFile,
                sourceFingerprint,objectiveHash:proofKey(flow,sourceFingerprint).split(':')[0],
                reuseReason:duplicate?'identical-objective-and-source':'unchanged-source',
                verdict:'passed',reused:true};
              if (!run.reusedVerification.some((r)=>r.gate===gateLabel && r.flowId===flow.id)) {
                run.reusedVerification.push(reused);
                await log('kane_reused',`${duplicate?'Exact-objective regression':'Unchanged-source'} Kane evidence · ${flow.name}`,
                  duplicate ? 'The exact sealed objective already passed in a real Kane browser run on identical application bytes; referencing that transcript, not inventing a second run.'
                    : 'Previously passed in a real Kane browser run; the complete application source fingerprint is identical.');
              }
              passed.push(flow);
              passedOnCurrentSource.add(flow.id);
              continue;
            }
            run.currentFlow = flow.name;
            run.currentFlowId = flow.id;
            await sync();
            const notify = (event) => { run.timeline.push(event); void sync().catch(() => {}); };
            // Infrastructure trouble is not a product defect. Retry the SAME
            // locked objective once, using distinct filenames and fresh browser
            // evidence. Never tell the coding agent to repair an infrastructure error.
            let result;
            for (let infraRetry = 0; infraRetry <= 1; infraRetry++) {
              const invocation = infraRetry ? verificationRound++ : wave;
              if (flow.generated) {
                const hash=await assertObjectiveUnchanged(runDir,flow,run.objectiveSeals);
                await log('objective_unchanged',`Objective unchanged ✔ · ${flow.name}`,`SHA-256 ${hash} · unchanged since agent planning`);
              }
              result = await runKane(config,flow,runDir,invocation,notify,logger.log);
              run.verification.push({...result,generated:flow.generated,objective:flow.objective,
                objectiveHash:flow.generated ? run.objectiveSeals.find(o=>o.id===flow.acceptanceId)?.sha256 : null,objectiveHashVerified:!!flow.generated,
                gate:gateLabel,taskId:gateTaskId,infrastructureRetry:infraRetry});
              await sync();
              // Kane explicitly reported that an objective requires a browser
              // capability unavailable in this session. Re-running the same
              // command cannot verify mobile behavior. Preserve the real FAIL
              // and stop as INCONCLUSIVE, never as an invented PASS or app bug.
              if (result.verdict === 'failed' && result.unavailableCapability) {
                run.failure = {...result,objective:flow.objective};
                await log('kane_capability_unavailable',`Kane browser capability unavailable · ${flow.name}`,result.summary);
                return {ok:false,status:'verification_inconclusive',
                  summary:`Browser capability unavailable for ${flow.name}: ${result.unavailableCapability.explanation} Kane's failed run and its original evidence remain saved. No application defect is established.`};
              }
              if (result.verdict !== 'infrastructure_error' || !result.retryableInfrastructure || infraRetry === 1) break;
              await log('kane_retry',`Kane retrying ${flow.name}`,`Infrastructure interruption; original browser check and evidence are preserved`);
            }
            // Kane can fail by missing a browser step, not by discovering a
            // product defect. Only its structured run_end automation verdict
            // can trigger this special case; keep the initial FAIL as evidence.
            // Re-run the *same* sealed objective once, with no source edits.
            if (isKaneAutomationMisstep(result)) {
              const sourceBeforeRetry=appSourceFingerprint(config.id,await snapshot({config}),config);
              if (sourceBeforeRetry!==sourceFingerprint) return {ok:false,status:'infrastructure_error',
                summary:'Application source changed after Kane automation misstep; cannot safely retry'};
              await log('kane_agent_misstep_retry',`Retrying Kane browser-agent misstep · ${flow.name}`,
                'Kane omitted a required browser action. Original failed evidence retained; retrying unchanged sealed objective once, with no coding-agent repair.');
              if(flow.generated) { const hash=await assertObjectiveUnchanged(runDir,flow,run.objectiveSeals);
                await log('objective_unchanged',`Objective unchanged ✔ · browser misstep recheck ${flow.name}`,`SHA-256 ${hash}`); }
              const retry=await runKane(config,flow,runDir,verificationRound++,notify,logger.log);
              run.verification.push({...retry,generated:flow.generated,objective:flow.objective,
                objectiveHash:flow.generated ? run.objectiveSeals.find(o=>o.id===flow.acceptanceId)?.sha256 : null,
                objectiveHashVerified:!!flow.generated,gate:gateLabel,taskId:gateTaskId,automationMisstepRetry:true});
              await sync();
              const sourceAfterRetry=appSourceFingerprint(config.id,await snapshot({config}),config);
              if(sourceAfterRetry!==sourceFingerprint) return {ok:false,status:'infrastructure_error',
                summary:'Application source changed during Kane automation-misstep retry; the result cannot be trusted'};
              if(isKaneAutomationMisstep(retry)) {
                run.failure={...retry,objective:flow.objective};
                await log('kane_automation_inconclusive',`Repeated browser-agent misstep · ${flow.name}`,
                  'Two authentic Kane failures preserved; no source defect established and no application repair attempted.');
                return {ok:false,status:'verification_inconclusive',
                  summary:`Kane repeated a browser automation misstep for ${flow.name}. Original sealed objective failed twice; no application defect was established. Review both saved browser runs. No application source was repaired.`};
              }
              if(retry.verdict==='failed' && retry.unavailableCapability){
                run.failure={...retry,objective:flow.objective};
                await log('kane_capability_unavailable',`Kane browser capability unavailable · ${flow.name}`,retry.summary);
                return {ok:false,status:'verification_inconclusive',
                  summary:`Browser capability unavailable during Kane automation retry for ${flow.name}: ${retry.unavailableCapability.explanation} Both authentic browser results are retained.`};
              }
              result=retry;
            }
            run.currentFlow = null;
            run.currentFlowId = null;
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
            // Fail closed: only an explicit Kane PASS can pass a gate. A user stop
            // (or any verdict we don't recognise) never counts as verified.
            if (result.verdict !== 'passed') {
              if (result.verdict === 'stopped' || isStopRequested()) return {ok:false,status:'interrupted',summary:'Stopped by you'};
              run.failure = result;
              return {ok:false,status:'infrastructure_error',summary:`Kane returned an unrecognised verdict (${result.verdict}); it is not treated as a PASS`};
            }
            passed.push(flow);
            passedOnCurrentSource.add(flow.id);
            // Reuse is safe only if an independently recomputed fingerprint
            // still matches the source that Kane actually tested.
            const sourceAfter = appSourceFingerprint(config.id, await snapshot({config}),config);
            if (sourceAfter !== sourceFingerprint) {
              return {ok:false,status:'infrastructure_error',summary:'Application source changed during Kane verification; the PASS cannot be reused or trusted'};
            }
            passedBrowserProof.set(proofKey(flow,sourceFingerprint), {...result,flowId:flow.id,gate:gateLabel,fingerprint:sourceFingerprint});
            await log('kane_pass',`Kane passed ${flow.generated ? 'agent-authored feature' : 'protected regression'} check`,flow.name);
          }
          if (!focus) {
            run.failure = null;
            const reusedCount = run.reusedVerification.filter((entry)=>entry.gate===gateLabel).length;
            await log('milestone_pass',`Kane gate passed · ${gateLabel}`,
              `${passed.length - reusedCount} new authentic Kane browser runs passed${reusedCount ? `; ${reusedCount} prior authentic Kane PASSes reused on identical source` : ''}`);
            return {ok:true,passed};
          }
        }

        if (repairCount >= config.maxRepairs) return {ok:false,status:'failed',summary:`Exhausted ${config.maxRepairs} total autonomous repairs. Last failure: ${focus.summary}`};
        // An examiner distinct from the builder challenges the failure BEFORE
        // any source-changing repair. Never silently accept a test rewrite.
        if (focus.verdict==='failed' && examinerId!==agentId) {
          run.stage='examining';
          await log('examiner_start',`${agentInfo(examinerId).label} independently examining Kane FAIL`,
            `Builder ${agentName} cannot author this classification; original objective stays sealed`);
          const beforeExaminer=await snapshot({config});
          const reviewerConfig={...config,agentId:examinerId,editablePaths:featureEditableFiles(config,beforeExaminer)};
          let review,reviewError;
          try{review=await reviewKaneFailure(reviewerConfig,focus,runDir,run.examinerReviews.length+1,logger.log);}
          catch(error){reviewError=error;}
          const examinerGuard=await reviewAndGuard(beforeExaminer,[],{config});
          if(examinerGuard.rejected.length)return {ok:false,status:'safety_error',
            summary:`Read-only examiner modified protected source; reverted: ${examinerGuard.rejected.join(', ')}`};
          if(reviewError){
            // No opinion from the examiner is not a reason to stop: diagnose anyway.
            await log('examiner_unavailable',`${agentInfo(examinerId).label} could not classify the Kane FAIL`,
              `${formatError(reviewError).slice(0,500)} · Continuing to diagnosis without an examiner opinion.`);
          } else {
          const entry={...review,flowId:focus.flowId,flowName:focus.flowName,
            gate:gateLabel,originalObjective:focus.objective,originalStdoutFile:focus.stdoutFile,
            originalEvidenceUrl:focus.evidenceUrl||null};
          run.examinerReviews.push(entry);
          await log('examiner_finding',`Examiner finding: ${review.finding.replaceAll('_',' ')}`,
            review.rationale.slice(0,700));
          if(review.finding!=='application_defect'){
            // The locked check is the spec. Before asking a human, let the diagnosis
            // decide whether the app can meet it WITHOUT contradicting the request
            // (e.g. stricter validation). Only an impossible or contradictory check
            // stops for human review. The check itself is never edited here.
            run.testDisputes.push({...entry,decision:'pending_human_review',decisionAt:null,decisionNote:null,autoDiagnosis:true});
            focus = {...focus,examinerFinding:{finding:review.finding,rationale:review.rationale},disputeIndex:run.testDisputes.length-1};
            await log('test_dispute',`Examiner questions the check · ${focus.flowName}`,
              `Examiner classification: ${review.finding}. Diagnosing whether the app can meet the locked check without contradicting the request; the check itself is not changed.`);
          }
          }
        }
        // Diagnose failures without assuming a code defect. A diagnosis is not
        // itself a repair and must not consume the source-edit repair budget.
        const attempt = ++diagnosisCount;
        run.stage = 'diagnosing';
        const activeTask = gateTaskId && run.tasks.find((t) => t.id === gateTaskId);
        if (activeTask) activeTask.status = 'repairing';
        await log('agent_plan_start',`${agentInfo(examinerId).label} reviewing Kane failure · diagnosis ${attempt}`,`Gate: ${gateLabel}; source evidence and unchanged acceptance objective will be passed to agent`);
        const beforeDiagnosis = await snapshot({config});
        const repairConfig = {...config,editablePaths:featureEditableFiles(config,beforeDiagnosis)};
        // The examiner plans (read-only) and the builder codes, when they differ.
        const diagnosisConfig = {...repairConfig,agentId:examinerId};
        const diagnoserName = agentInfo(examinerId).label;
        let investigation, diagnosisError;
        try { investigation = await planRepair(diagnosisConfig,{...focus,userRequest:input.prompt},runDir,attempt,previousDiff,logger.log); }
        catch (error) { diagnosisError = error; }
        const diagnosisGuard = await reviewAndGuard(beforeDiagnosis,[],{config});
        if (investigation) run.plans.push({attempt,gate:gateLabel,...investigation});
        await sync();
        if (diagnosisGuard.rejected.length) return {ok:false,status:'safety_error',summary:`Read-only diagnosis edited files; reverted: ${diagnosisGuard.rejected.join(', ')}`};
        if (diagnosisError || !investigation?.ok || !['repair','stop'].includes(investigation?.plan?.action)) {
          // A broken diagnosis is not an app verdict. Treat it as "no fix found":
          // Kane re-runs the same check once, and the build carries on either way.
          const why = diagnosisError ? formatError(diagnosisError) : (investigation?.summary || 'no usable diagnosis was returned');
          await log('diagnosis_unavailable',`${diagnoserName} diagnosis could not be completed`,`${String(why).slice(0,500)} · Re-running the same Kane check instead of repairing.`);
          investigation = {ok:true,plan:{action:'stop',diagnosis:`Diagnosis could not be completed (${String(why).slice(0,300)}); no repair attempted.`}};
        }
        if (investigation.plan?.action === 'stop') {
          // A legitimate "no code bug" diagnosis is NOT an agent error, and an
          // agent's opinion cannot override Kane's actual failed run_end. Retry
          // the exact same browser objective ONCE on unchanged source, keeping
          // both Kane evidence records. Only a new real Kane PASS can continue.
          await log('diagnosis_stop',`${diagnoserName} found no safe app repair for ${focus.flowName}`,investigation.plan.diagnosis.slice(0,650));
          // The app looks correct, so the FAIL may be a Kane slip (e.g. a flaky step).
          // Fall through to ONE re-run of the same locked check on unchanged source;
          // only if Kane fails again does the dispute go to the Test Court.
          if (focus.examinerFinding && run.testDisputes[focus.disputeIndex])
            run.testDisputes[focus.disputeIndex].diagnosis = investigation.plan.diagnosis.slice(0,1200);
          if (disputedRetried.has(focus.flowId)) return {ok:false,status:'verification_inconclusive',
            summary:`Kane still reported failure for ${focus.flowName}; ${agentName} found no evidence-backed code repair. Review the Kane and diagnosis evidence.`};
          disputedRetried.add(focus.flowId);
          const retryFlow = flows.find((flow) => flow.id === focus.flowId);
          if (!retryFlow) return {ok:false,status:'verification_inconclusive',summary:'Kane failure has no matching saved browser objective'};
          await log('kane_disputed_retry',`Rechecking disputed Kane result · ${retryFlow.name}`,'Source unchanged; requires another authentic Kane PASS, never an agent-declared pass');
          const notify = (event) => { run.timeline.push(event); void sync().catch(() => {}); };
          if (retryFlow.generated) await assertObjectiveUnchanged(runDir,retryFlow,run.objectiveSeals);
          if (retryFlow.generated) {const hash=await assertObjectiveUnchanged(runDir,retryFlow,run.objectiveSeals);
            await log('objective_unchanged',`Objective unchanged ✔ · disputed recheck ${retryFlow.name}`,`SHA-256 ${hash}`);}
          const retried = await runKane(config,retryFlow,runDir,verificationRound++,notify,logger.log);
          run.verification.push({...retried,generated:retryFlow.generated,objective:retryFlow.objective,objectiveHash:retryFlow.generated ? run.objectiveSeals.find(o=>o.id===retryFlow.acceptanceId)?.sha256 : null,objectiveHashVerified:!!retryFlow.generated,
            gate:gateLabel,taskId:gateTaskId,diagnosticRetry:true,diagnosisAttempt:attempt});
          run.currentFlow = null;
          await sync();
          if (retried.verdict === 'failed' && retried.unavailableCapability) {
            run.failure = {...retried,objective:retryFlow.objective};
            await log('kane_capability_unavailable',`Kane browser capability unavailable · ${retryFlow.name}`,retried.summary);
            return {ok:false,status:'verification_inconclusive',summary:`Browser capability unavailable for ${retryFlow.name}: ${retried.unavailableCapability.explanation} Original and retry evidence remain saved.`};
          }
          if (retried.verdict === 'infrastructure_error') return {ok:false,status:'infrastructure_error',summary:`Kane could not complete disputed-result recheck: ${retried.summary}`};
          if (retried.verdict !== 'passed' && focus.examinerFinding && retryFlow.generated && !revisedChecks.has(retryFlow.acceptanceId)) {
            const dispute = run.testDisputes[focus.disputeIndex];
            if (dispute?.finding==='test_defect' && dispute.proposedObjective && await reviseDisputedCheck(flows,retryFlow,dispute,gateLabel)) {
              run.failure = null; await sync(); gateRetests++;
              continue;
            }
          }
          if (retried.verdict !== 'passed') return {ok:false,status:'verification_inconclusive',
            summary:focus.examinerFinding
              ? `${retryFlow.name}: Kane failed again on a re-run, the examiner disputes the check, and ${diagnoserName} found no app change that meets it without contradicting the request. Review the test dispute.`
              : `Kane reported failure again for ${retryFlow.name}; no verified application defect was identified. The run is NOT passed. Check both browser evidence records.`};
          if (focus.examinerFinding && run.testDisputes[focus.disputeIndex]) Object.assign(run.testDisputes[focus.disputeIndex],{
            decision:'resolved_by_recheck',decisionAt:now(),
            decisionNote:'The app was unchanged and Kane passed the same locked check on a re-run, so the earlier FAIL was not an app defect. Both Kane runs stay on record.'});
          passedOnCurrentSource.add(retryFlow.id);
          const sourceAfterRetry = appSourceFingerprint(config.id, await snapshot({config}),config);
          if (sourceAfterRetry !== sourceFingerprint) return {ok:false,status:'infrastructure_error',
            summary:'Application source changed during disputed Kane verification'};
          passedBrowserProof.set(proofKey(retryFlow,sourceFingerprint),{...retried,flowId:retryFlow.id,gate:gateLabel,fingerprint:sourceFingerprint});
          run.failure = null;
          gateRetests++;
          await log('kane_recovered',`Kane passed the unchanged objective on independent recheck · ${retryFlow.name}`,'The previous failed run remains in the evidence; no code repair occurred');
          continue;
        }
        repairCount++;
        run.iteration = repairCount;
        if (focus.examinerFinding && run.testDisputes[focus.disputeIndex]) Object.assign(run.testDisputes[focus.disputeIndex],{
          decision:'resolved_by_repair',decisionAt:now(),
          decisionNote:`${diagnoserName} found the app can meet the locked check without contradicting the request; ${agentName} repairs the app and Kane re-tests the same check.`});
        await log('agent_plan',`${diagnoserName} authored repair instructions #${attempt}`,investigation.plan.diagnosis);
        run.stage = 'repairing';
        // Persist this transition BEFORE the agent spends minutes editing,
        // so Activity and Kane history show an active repair immediately.
        await log('repair_start',`${agentName} coding repair #${attempt}`,
          `Real Kane FAIL preserved; editing source before independent browser retest`);
        const beforeRepair = await snapshot({config});
        let repair, repairError;
        try { repair = await runAgent(repairConfig,investigation.plan,runDir,attempt,logger.log); }
        catch (error) { repairError = error; }
        const repairGuard = await reviewAndGuard(beforeRepair,[editableScope(config.id,config)],{config});
        const afterRepair = await snapshot({config});
        const diff = summarizeDiff(beforeRepair,afterRepair,repairGuard.changed);
        await writeFile(path.join(runDir,`source-diff-${attempt}.txt`),diff);
        await recordDiff(diff,repairGuard.changed);
        if (repair) run.repairs.push({attempt,gate:gateLabel,...repair,changedFiles:repairGuard.changed,rejectedFiles:repairGuard.rejected,diff});
        await sync();
        if (repairGuard.rejected.length) return {ok:false,status:'safety_error',summary:`Repair edited protected files; reverted: ${repairGuard.rejected.join(', ')}`};
        if (repairError || !repairGuard.changed.length || (!repair?.ok && !repair?.recoverableTimeout)) {
          // The repair didn't produce a usable change. Keep the Kane FAIL as evidence,
          // leave this check unproven, and let the build carry on.
          const why = repairError ? formatError(repairError) : !repairGuard.changed.length ? 'the agent made no source edits' : (repair?.summary || 'the repair did not complete');
          await log('repair_unusable',`${agentName} repair #${attempt} did not produce a usable fix`,String(why).slice(0,500));
          if (activeTask) activeTask.status = 'candidate';
          return {ok:false,status:'failed',summary:`${focus.flowName}: Kane FAIL kept; ${agentName}'s repair did not produce a usable fix (${String(why).slice(0,200)}).`};
        }
        if (repair.recoverableTimeout && !repair.ok) await log('agent_partial',`Repair #${attempt} timed out after source changes`,'Candidate only; next Kane run decides whether it is fixed');
        previousDiff = diff;
        passedOnCurrentSource.clear(); // Source edited: earlier passes must be revalidated.
        // Retain prior evidence; fingerprint matching prevents stale reuse.
        run.reusedVerification = run.reusedVerification.filter((r) => r.gate !== gateLabel);
        gateRetests++;
        if (activeTask) activeTask.status = 'candidate';
        await log('recheck',`Kane retesting after repair #${attempt}`,`Re-running ${flows.length} check(s) in gate ${gateLabel}`);
        // Rerun ALL checks in this gate on the modified code, including ones that
        // passed before the failing check. The full suite is run again at the end.
      }
    }

    if (!resumedPlan || continuation) {
      for (const task of allOrderedTasks) {
        const activeTask = run.tasks.find((t) => t.id === task.id);
        const milestone = {id:`milestone-${task.id}`,taskId:task.id,title:task.title,
          checkIds:[],status:'implementing',startedAt:now(),completedAt:null};
        run.milestones.push(milestone);
        const carried = !!continuation?.verified.has(task.id), alreadyCoded = !!continuation?.coded.has(task.id);
        if (carried || alreadyCoded) {
          await log('task_carried', carried ? `${task.id} already verified before the stop: ${task.title}` : `${task.id} already coded before the stop: ${task.title}`,
            carried ? 'Already passed Kane before the stop; not rebuilt. Its checks run again in the final suite.' : 'Coding finished before the stop; going straight to its Kane check.');
        }
        if (!carried && !alreadyCoded) {
        activeTask.status = 'implementing';
        run.stage = 'implementing';
        await log('task_start',`${agentName} implementing task ${implementedIds.size+1}/${plan.tasks.length}: ${task.title}`,`Dependencies: ${(task.dependsOn || []).join(', ') || 'none'}`);
        // Publish the real task handoff filename immediately so the frontend
        // can inspect the task-specific prompt during live execution.
        const prefix = `feature-task-${task.id}`;
        const taskRecord = {taskId:task.id,status:'running',handoffFile:`${prefix}-handoff.txt`,outputFile:`${prefix}-agent.ndjson`,stderrFile:`${prefix}-agent.stderr.log`,diffFile:`${prefix}-diff.txt`};
        run.taskExecutions.push(taskRecord);
        await sync();
        const beforeTask = await snapshot({config});
        let execution, executionError;
        const completedTasks = allOrderedTasks.filter((t) => implementedIds.has(t.id)).map((t) => ({id:t.id,title:t.title}));
        try { execution = await implementFeatureTask(config,input.prompt,plan,task,completedTasks,runDir,logger.log); }
        catch (error) { executionError = error; }
        const taskGuard = await reviewAndGuard(beforeTask,[editableScope(config.id,config)],{config});
        const afterTask = await snapshot({config});
        const diff = summarizeDiff(beforeTask,afterTask,taskGuard.changed);
        await writeFile(path.join(runDir,`${prefix}-diff.txt`),diff);
        await recordDiff(diff,taskGuard.changed);
        Object.assign(taskRecord,{...execution, status: execution?.ok ? 'completed' : execution?.recoverableTimeout ? 'interrupted' : 'failed',
          changedFiles:taskGuard.changed,rejectedFiles:taskGuard.rejected});
        if (executionError) taskRecord.error = formatError(executionError);
        await sync();
        if (taskGuard.rejected.length) return await complete('safety_error',`Task ${task.id} modified protected files; reverted: ${taskGuard.rejected.join(', ')}`);
        if (executionError) return await complete('agent_error',`Task ${task.id}: ${formatError(executionError)}`);
        if (!execution.ok && (!execution.recoverableTimeout || !taskGuard.changed.length)) {
          const missingEdits = execution.recoverableTimeout && !taskGuard.changed.length;
          return await complete('agent_error', `Task ${task.id}: ${execution.summary}${missingEdits ? '. No permitted application source changes were detected, so Kane was not run. Inspect the agent transcript and retry with a narrower task or an adjusted KANEGUARD_TASK_TIMEOUT_MS.' : ''}`);
        }
        if (execution.recoverableTimeout) {
          run.implementationInterrupted = true;
          await log('agent_partial',`Task ${task.id} interrupted with real source edits`,'Candidate only; Kane will verify the functionality before any PASS');
        } else {
          await log('task_implemented',`${agentName} completed implementation of ${task.id}`,`${taskGuard.changed.length} app file(s) changed. Awaiting Kane evidence.`);
        }
        previousDiff = diff || previousDiff;
        }
        // Prior source proofs remain auditable, but are never reused unless
        // the complete current source fingerprint matches their own.
        implementedIds.add(task.id);
        run.codedTaskIds = [...implementedIds];
        activeTask.status = 'candidate';
        if (carried) activeTask.carriedOver = true;
        const ready = readyMilestoneChecks(plan,implementedIds,settledCheckIds());
        if (carried) {
          for (const check of ready) carriedCheckIds.add(check.id);
          Object.assign(milestone,{status:'carried_over',checkIds:ready.map((c)=>c.id),completedAt:now(),
            deferredReason:'Passed Kane before the stop · re-run in the final suite'});
          await sync();
          continue;
        }
        milestone.checkIds = ready.map((check) => check.id);
        milestone.status = ready.length ? 'verifying' : 'awaiting_dependencies';
        milestone.pendingChecks = ready.length ? [] : pendingMilestoneDependencies(plan,task.id,implementedIds,settledCheckIds());
        milestone.deferredReason = ready.length ? null : milestone.pendingChecks.length
          ? `Waiting for ${[...new Set(milestone.pendingChecks.flatMap(item=>item.blockedBy))].join(', ')} to complete shared Kane checks`
          : 'No independent browser check mapped to this task';
        await sync();
        const gate = await verifyGateAndContinue(ready.map((check) => protectedFeatureFlows.find((flow) => flow.acceptanceId === check.id)),`After ${task.id}: ${task.title}`,task.id);
        if (gate.ok && gate.unresolved?.length) {
          for (const check of gate.passed) if (check.acceptanceId) passedMilestoneIds.add(check.acceptanceId);
          Object.assign(milestone,{status:'unresolved',completedAt:now(),unresolvedChecks:gate.unresolved.map((u)=>u.checkId)});
          for (const t of run.tasks) if ((t.acceptanceIds||[]).some((id)=>unresolvedChecks.has(id))) t.status = 'unresolved';
          updateVerifiedTasks();
          await sync();
          continue;
        }
        if (!gate.ok) { milestone.status = ['verification_inconclusive','interrupted'].includes(gate.status) ? gate.status : 'failed'; milestone.completedAt = now(); await sync(); return await complete(gate.status,gate.summary); }
        for (const check of gate.passed) if (check.acceptanceId) passedMilestoneIds.add(check.acceptanceId);
        milestone.status = ready.length ? 'passed' : 'awaiting_dependencies';
        milestone.completedAt = now();
        updateVerifiedTasks();
        await sync();
      }
      if (settledCheckIds().size !== plan.acceptance.length) return await complete('agent_error','Not every agent-generated browser objective became eligible for a milestone');
    }

    // Even though milestone checks passed earlier, later tasks or repairs can
    // regress them. This final locked suite must pass on the CURRENT source.
    const finalMilestone = {id:'milestone-final',taskId:null,title:'Final feature and protected regression suite',
      checkIds:plan.acceptance.map((check) => check.id),status:'verifying',startedAt:now(),completedAt:null};
    run.finalChecksTotal = protectedFeatureFlows.length + protectedRegressionFlows.length;
    run.milestones.push(finalMilestone);
    run.stage = 'final_verification';
    await log('final_suite','Kane running final protected browser suite',
      `${plan.acceptance.length} agent-authored checks + ${protectedRegressionFlows.length} protected regressions. A prior genuine PASS may be reused only for the exact same objective on the exact same complete application source.`);
    const final = await verifyGateAndContinue([...protectedFeatureFlows,...protectedRegressionFlows],'Final full suite');
    if (!final.ok) { finalMilestone.status = ['verification_inconclusive','interrupted'].includes(final.status) ? final.status : 'failed'; finalMilestone.completedAt = now(); await sync(); return await complete(final.status,final.summary); }
    if (unresolvedChecks.size) {
      // The whole build ran to the end. Tell the full story; never call it passed.
      const open = [...unresolvedChecks.values()];
      for (const t of run.tasks) t.status = (t.acceptanceIds||[]).some((id)=>unresolvedChecks.has(id)) ? 'unresolved' : 'verified';
      for (const gate of run.milestones) if (['awaiting_dependencies','carried_over'].includes(gate.status)) gate.status = 'verified_later';
      for (const check of plan.acceptance) if (!unresolvedChecks.has(check.id)) passedMilestoneIds.add(check.id);
      run.checkedFeatureIds = [...passedMilestoneIds];
      run.unresolvedChecks = open;
      Object.assign(finalMilestone,{status:'unresolved',completedAt:now(),unresolvedChecks:open.map((u)=>u.checkId)});
      run.failure = null;
      await sync();
      const proven = plan.acceptance.length - open.filter((u)=>plan.acceptance.some((c)=>c.id===u.checkId)).length;
      const story = open.map((u)=>`${u.name}: ${u.summary}`).join(' | ');
      return await complete(open.some((u)=>u.status==='failed') ? 'failed' : 'verification_inconclusive',
        `Built all ${run.tasks.length} tasks. Kane proved ${proven}/${plan.acceptance.length} checks on the final app; ${open.length} left unproven with full evidence — ${story}`.slice(0,2400));
    }
    for (const task of run.tasks) task.status = 'verified';
    for (const gate of run.milestones) if (['awaiting_dependencies','carried_over'].includes(gate.status)) gate.status = 'verified_later';
    for (const check of plan.acceptance) passedMilestoneIds.add(check.id);
    run.checkedFeatureIds = [...passedMilestoneIds];
    run.failure = null;
    run.verifiedSourceFingerprint=appSourceFingerprint(config.id,await snapshot({config}),config);
    finalMilestone.status = 'passed'; finalMilestone.completedAt = now();
    await sync();
    if(sabotage) {
      run.stage='negative_control';
      await log('sabotage_start','Optional clone-only negative control','A real Kane FAIL on the mutated clone is required; never edit the original.');
      run.sabotage = await runSabotageCheck({config,run,plan,runDir,examinerId,log,liveLog:logger.log});
      await log('sabotage_done',`Negative control: ${run.sabotage.status}`,run.sabotage.summary);
    }
    const reuseCount = run.reusedVerification.filter((r)=>r.gate==='Final full suite').length;
    return await complete('passed',`${plan.acceptance.length} agent-authored feature checks verified; ${protectedRegressionFlows.length} protected regressions covered by real Kane evidence on the current source (${reuseCount} exact-source/identical-objective references in final gate). ${repairCount} autonomous repair(s).`);
  } catch (error) {
    if (run) {
      run.stage = 'finished'; run.completedAt = now();
      if (isStopRequested() || error?.stopped) { run.status = 'interrupted'; markRunStopped(run, logger); }
      else {
        run.status = 'infrastructure_error';
        run.timeline.push({at:now(),kind:'stopped',title:'Unexpected workflow error',detail:formatError(error)});
        logger?.log('ERROR',formatError(error));
      }
      run.activeGate = null; run.currentFlow = null; run.currentFlowId = null;
      for (const t of run.tasks||[]) if (t.status !== 'verified') t.status = 'blocked';
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
  if (!prior || prior.mode !== 'build' || !['agent_error','failed','infrastructure_error','verification_inconclusive'].includes(prior.status) ||
      !prior.artifacts?.featurePlan || !Array.isArray(prior.changedFiles) || !prior.changedFiles.length) {
    throw new Error('Only a stopped feature build with saved plan and source changes can be reverified');
  }
  // v31.1: Generated apps (including BugBoard) and connected apps must be
  // resumable too. Their source already exists and their original plan is
  // re-validated below; never rerun the planner or silently rewrite checks.
  validateBuildInput(prior.appId,prior.request);
  if (!/^[a-zA-Z0-9._-]+$/.test(prior.artifacts.featurePlan)) throw new Error('Unsafe plan evidence filename');
  const saved = JSON.parse(await readFile(path.join(RUNS,prior.id,prior.artifacts.featurePlan),'utf8'));
  const plan = parseFeaturePlan(JSON.stringify(saved));
  const config = await configFor(prior.appId);
  if(!['cartlab','coinpulse'].includes(prior.appId) && !['playground','connected'].includes(config.kind))
    throw new Error('Unsupported app type for saved-run recovery');
  if(!featureEditableFiles(config,await snapshot({config})).length)
    throw new Error('Saved application source is no longer available for recovery');
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
  return buildFeature(prior.appId,prior.request,onUpdate,{resumedFrom:prior.id,resumedPlan:plan,agentId:prior.agentId || 'antigravity',examinerAgentId:prior.examinerAgentId||prior.agentId||'antigravity',blindBuilder:!!prior.blindBuilder});
}

/** Continue a run the user stopped (or that was cut off): same plan, same locked
 * Kane checks. Kane-verified tasks are kept (and re-run in the final suite),
 * coded-but-untested tasks go straight to Kane, everything else is built. */
export async function inspectContinuableFeature(sourceRunId) {
  const prior = await getRun(sourceRunId);
  const approved = (prior?.testDisputes||[]).filter((d)=>d.decision==='approve_new_version'&&d.proposedObjective);
  const continuable = ['interrupted','agent_error'].includes(prior?.status) || (prior?.status==='verification_inconclusive' && approved.length);
  if (!prior || prior.mode !== 'build' || !continuable || !prior.artifacts?.featurePlan)
    throw new Error('Only a stopped build with a plan, or a disputed build with a human-approved test revision, can be continued');
  if (!/^[a-zA-Z0-9._-]+$/.test(prior.artifacts.featurePlan)) throw new Error('Unsafe plan evidence filename');
  validateBuildInput(prior.appId,prior.request);
  const config = await configFor(prior.appId);
  if (!['playground','connected'].includes(config.kind)) throw new Error('Only generated or connected apps can be continued');
  const plan = parseFeaturePlan(await readFile(path.join(RUNS,prior.id,prior.artifacts.featurePlan),'utf8'));
  // A human-approved test revision replaces exactly one disputed check. Both
  // fingerprints must match what the human reviewed; the new wording is sealed
  // as its own version and every step is logged.
  const testRevisions = [];
  // Checks KaneGuard already fixed and re-sealed in the earlier run carry forward as-is.
  for (const r of prior.testRevisions||[]) {
    if (!r.auto || !/^[a-zA-Z0-9_-]+$/.test(r.checkId)) continue;
    const saved = JSON.parse(await readFile(path.join(RUNS,prior.id,`test-revision-${r.checkId}.json`),'utf8'));
    const check = plan.acceptance.find((c)=>c.id===r.checkId);
    if (!check || objectiveHash(saved.objective)!==r.toHash) throw new Error(`Saved test revision for ${r.checkId} does not match its fingerprint`);
    check.objective = saved.objective;
    testRevisions.push({...r,carriedFrom:prior.id});
  }
  for (const dispute of approved) {
    const checkId = String(dispute.flowId||'').replace(/^feature-/,'');
    const check = plan.acceptance.find((c)=>c.id===checkId);
    if (!check) throw new Error(`Approved revision targets an unknown check (${dispute.flowId})`);
    if (dispute.originalObjectiveHash && objectiveHash(check.objective)!==dispute.originalObjectiveHash)
      throw new Error(`Saved objective for ${check.name} no longer matches the disputed fingerprint`);
    if (dispute.proposedObjectiveHash && objectiveHash(dispute.proposedObjective)!==dispute.proposedObjectiveHash)
      throw new Error(`Approved objective for ${check.name} does not match its reviewed fingerprint`);
    testRevisions.push({checkId,checkName:check.name,fromHash:objectiveHash(check.objective),toHash:objectiveHash(dispute.proposedObjective),
      approvedAt:dispute.decisionAt,approvalNote:dispute.decisionNote,examiner:dispute.reviewerAgentId||null,sourceRunId:prior.id});
    check.objective = dispute.proposedObjective;
  }
  const trustedOrigin = new URL(config.url).origin;
  for (const flow of plan.acceptance) for (const hit of flow.objective.matchAll(/https?:\/\/[^\s)"']+/g)) {
    let dest; try { dest = new URL(hit[0]); } catch { throw new Error('Saved browser objective has invalid URL'); }
    if (dest.origin !== trustedOrigin) throw new Error('Saved browser objective targets an external origin');
  }
  const ids = new Set(plan.tasks.map((t)=>t.id));
  const verified = new Set((prior.tasks||[]).filter((t)=>ids.has(t.id)&&(t.status==='verified'||t.carriedOver)).map((t)=>t.id));
  const codedList = Array.isArray(prior.codedTaskIds) ? prior.codedTaskIds
    : (prior.taskExecutions||[]).filter((e)=>e.status==='completed'||(e.status==='interrupted'&&e.changedFiles?.length)).map((e)=>e.taskId);
  const coded = new Set(codedList.filter((id)=>ids.has(id)&&!verified.has(id)));
  // A revised check must run again: any task that owns one is re-tested, never carried as verified.
  for (const r of testRevisions) for (const t of plan.tasks) if ((t.acceptanceIds||[]).includes(r.checkId) && verified.delete(t.id)) coded.add(t.id);
  if (verified.size === plan.tasks.length) throw new Error('Every task was already verified; use Recheck with Kane instead');
  return {prior,plan,continuation:{verified,coded,testRevisions}};
}
export async function continueFeatureRun(sourceRunId,onUpdate = () => {}) {
  const {prior,plan,continuation} = await inspectContinuableFeature(sourceRunId);
  return buildFeature(prior.appId,prior.request,onUpdate,{resumedFrom:prior.id,resumedPlan:plan,continuation,
    agentId:prior.agentId || 'antigravity',examinerAgentId:prior.examinerAgentId||prior.agentId||'antigravity',blindBuilder:!!prior.blindBuilder});
}
