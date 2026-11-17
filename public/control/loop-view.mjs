/** One presentation of the actual execution loop. No verdict is inferred from
 * Antigravity's words or the presence of a file; only Kane CLI results count. */
const esc = (value) => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const safeFile = (value) => typeof value === 'string' && /^[a-zA-Z0-9._-]+$/.test(value);
const safeEvidence = (value) => { try { const url = new URL(value); return url.protocol === 'https:' ? url.href : ''; } catch { return ''; } };
const evidenceLink = (run, label, file) => safeFile(file)
  ? `<a href="/api/evidence/${encodeURIComponent(run.id)}/${encodeURIComponent(file)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>` : '';
const externalLink = (label, url) => safeEvidence(url) ? `<a target="_blank" rel="noopener noreferrer" href="${esc(safeEvidence(url))}">${esc(label)}</a>` : '';
const links = (items) => items.filter(Boolean).join('<span class="kg-proof-dot">·</span>');
const labels = {verified:'Verified',passed:'Passed',verified_later:'Verified',implementing:'Coding',candidate:'Code ready',
  verifying:'Kane testing',awaiting_dependencies:'Waiting on dependencies',repairing:'Repairing',blocked:'Stopped',failed:'Failed',
  infrastructure_error:'Infrastructure issue',verification_inconclusive:'Needs review',agent_error:'Agent error',running:'Running',
  planned:'Queued',queued:'Queued'};
const tone = (status) => ['verified','passed','verified_later'].includes(status) ? 'pass'
  : ['blocked','failed','infrastructure_error','verification_inconclusive','agent_error','safety_error'].includes(status) ? 'fail'
  : ['implementing','verifying','repairing','running'].includes(status) ? 'active' : 'waiting';
const elapsed = (milliseconds) => {
  if (!Number.isFinite(milliseconds) || milliseconds < 1000) return '';
  const seconds = Math.floor(milliseconds / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};
const badge = (status, custom) => `<span class="kg-loop-state kg-loop-${tone(status)}">${esc(custom || labels[status] || String(status || 'Queued').replaceAll('_',' '))}</span>`;
const step = (num,title,status,body,extra='') => `<section class="kg-loop-step ${extra}"><div class="kg-loop-step-header"><span class="kg-loop-count">${esc(num)}</span><strong>${esc(title)}</strong>${badge(status)}</div>${body ? `<div class="kg-loop-step-body">${body}</div>` : ''}</section>`;
const proof = (content) => content ? `<div class="kg-loop-proof">${content}</div>` : '';

function currentAction(run) {
  if (run.status !== 'running') return {who:'OUTCOME',title:run.status === 'passed' ? 'All required Kane checks verified' : 'Workflow stopped — inspect the failed step',note:run.status === 'passed' ? 'See the evidence attached to each task below.' : 'No PASS is awarded for incomplete checks.'};
  if (run.currentFlow) return {who:'KANE CLI · BROWSER RUN',title:run.currentFlow,
    note:run.activeGate === 'Final full suite' ? 'Final source · protected regression and outstanding feature checks' : 'Testing the current task before the next task can start'};
  if (run.stage === 'diagnosing') return {who:'ANTIGRAVITY · DIAGNOSIS',title:'Investigating Kane failure',note:'Reviewing the actual browser evidence before deciding whether code needs repair'};
  if (run.stage === 'repairing') return {who:'ANTIGRAVITY · REPAIR',title:'Editing the source to fix a verified failure',note:'Kane will retest the unchanged objective after the code repair'};
  if (run.resumedFrom && run.status==='running') return {who:'KANE CLI · SAVED SOURCE',title:'Verifying existing code',note:'No feature planning or implementation rerun'};
  const currentTask = (run.tasks || []).find((task) => task.status === 'implementing');
  if (currentTask) return {who:'ANTIGRAVITY · CODING',title:currentTask.title,note:'Changes must pass an independent Kane browser gate'};
  if (run.activeGate) return {who:'KANE CLI · PREPARING',title:run.activeGate === 'Final full suite' ? 'Preparing final verification' : 'Preparing browser verification',note:'Starting the next authentic browser check'};
  return {who:'ANTIGRAVITY · PLANNING',title:'Building the implementation plan',note:'Reading source and defining tasks, dependencies and Kane objectives'};
}
function checkHTML(run, result, {reused=false, compact=true}={}) {
  const status = result.verdict;
  const name = result.flowName || result.flowId || 'Browser check';
  const attachments = links([externalLink('Browser evidence',result.evidenceUrl),evidenceLink(run,'Kane transcript',result.stdoutFile),
    status === 'infrastructure_error' ? evidenceLink(run,'CLI error',result.stderrFile) : '']);
  const info = status === 'failed' || status === 'infrastructure_error' ? `<p class="kg-loop-detail">${esc(result.summary || 'Check did not pass')}</p>` : (!compact && result.summary ? `<p class="kg-loop-detail">${esc(result.summary)}</p>` : '');
  return `<div class="kg-loop-check"><span class="kg-loop-check-name">${esc(name)}</span>${badge(status,reused ? 'Prior PASS · unchanged source' : '')}${!reused && elapsed(result.durationMs) ? `<small class="kg-check-duration">${esc(elapsed(result.durationMs))}</small>` : ''}${proof(attachments)}${info}</div>`;
}
function queuedCheck(name,running=false) {
  return `<div class="kg-loop-check kg-loop-check-waiting${running ? ' kg-check-running' : ''}"><span class="kg-loop-check-name">${esc(name)}</span>${badge(running?'running':'queued',running?'Browser running':'Queued')}</div>`;
}
function planStep(run) {
  const count = (run.tasks || []).length;
  const artifacts = run.artifacts || {};
  const attachments = links([evidenceLink(run,'Feature request',artifacts.userRequest),evidenceLink(run,'Generated plan',artifacts.featurePlan),
    evidenceLink(run,'Agent transcript',artifacts.plannerTrace)]);
  return step('P','Antigravity plan',count?'passed':'running',
    `<span class="kg-loop-note">${count ? `${count} agent-authored tasks · ${(run.generatedFlows || []).length} browser objectives` : 'Planning from the application source'}</span>${proof(attachments)}`,'kg-loop-plan');
}
function linkedCheckIds(run,task,gate) {
  if (gate?.checkIds?.length) return gate.checkIds;
  const linked = task.acceptanceIds || [];
  // An acceptance check shared with a future task cannot be gate-tested early.
  return linked.filter((id) => !(run.tasks || []).some((other)=>other.id!==task.id &&
    (other.acceptanceIds || []).includes(id) &&
    !['verified','candidate'].includes(other.status) &&
    (run.tasks || []).indexOf(other) > (run.tasks || []).indexOf(task)));
}
function taskStep(run, task, index) {
  const gate = (run.milestones || []).find((m)=>m.taskId===task.id);
  const execution = (run.taskExecutions || []).find((t)=>t.taskId===task.id);
  const gateName = `After ${task.id}: ${task.title}`;
  const all = (run.verification || []).filter((result)=>result.gate===gateName);
  const latest = new Map(); for (const result of all) latest.set(result.flowId,result);
  const checks = [...latest.values()];
  const former = all.filter((check)=>latest.get(check.flowId)!==check);
  const names = new Map((run.generatedFlows || []).map((flow)=>[flow.id,flow.name]));
  const expected = linkedCheckIds(run,task,gate);
  const seen = new Set(checks.map((check)=>check.flowId));
  const queued = expected.filter((id)=>!seen.has(`feature-${id}`)).map((id)=>queuedCheck(names.get(id)||id,
    run.activeGate===gateName && run.currentFlowId===`feature-${id}`)).join('');
  const isActiveGate = run.status==='running' && run.activeGate===gateName;
  const status = gate?.status==='failed' ? (checks.at(-1)?.verdict || 'failed') : isActiveGate ? 'verifying' : task.status || 'planned';
  const codeLabel = run.resumedFrom && !execution ? 'Saved implementation · no recoding' :
    execution?.status==='interrupted' ? 'Interrupted · checked using real Kane' : execution?.status==='failed' ? 'Agent execution failed' :
    execution?.status==='completed' ? 'Code completed' : task.status==='verified' ? 'Implementation verified by Kane' : execution?.status==='running' || task.status==='implementing' ? 'Writing application code' : 'Waiting for previous task';
  const agentProof = links([evidenceLink(run,'Coding transcript',execution?.outputFile),
    evidenceLink(run,'Task handoff',execution?.handoffFile),evidenceLink(run,'Source diff',execution?.diffFile)]);
  let kaneLabel;
  if (run.resumedFrom && !execution) kaneLabel='Saved code checked in final suite';
  else if (isActiveGate && run.currentFlowId) kaneLabel=`Browser checking ${checks.length+1} of ${Math.max(expected.length,1)}`;
  else if (isActiveGate) kaneLabel='Preparing Kane browser checks';
  else if (gate?.status==='awaiting_dependencies') kaneLabel='Waiting for dependent implementation';
  else if (gate?.status==='verified_later') kaneLabel='Verified by dependent Kane checks';
  else if (gate?.status==='passed' || task.status==='verified') kaneLabel=`${checks.filter((x)=>x.verdict==='passed').length} browser check${checks.length===1?'':'s'} passed`;
  else if (execution?.status==='completed' || execution?.status==='interrupted') kaneLabel='Next: Kane browser verification';
  else kaneLabel=expected.length ? `${expected.length} browser check${expected.length===1?'':'s'} planned · after coding` : 'Waiting for linked browser checks';
  const review = (run.plans || []).filter((item)=>item.gate===gateName).map((item)=>{
    const repair = (run.repairs || []).find((r)=>r.attempt===item.attempt);
    return `<div class="kg-loop-repair"><strong>${item.plan?.action==='stop'?'Agent review · no source edit':`Antigravity repair ${item.attempt}`}</strong>${proof(links([
      evidenceLink(run,'Diagnosis',item.planFile),evidenceLink(run,'Repair transcript',repair?.outFile)]))}</div>`;
  }).join('');
  const retried = former.length ? `<details class="kg-loop-disclosure"><summary>${former.length} prior browser attempt${former.length===1?'':'s'}</summary>${former.map((check)=>checkHTML(run,check)).join('')}</details>` : '';
  const agentDuration = execution?.status==='completed' ? elapsed(execution.durationMs) : '';
  const body = `<div class="kg-loop-phase"><span>Antigravity</span><b>${esc(codeLabel)}${agentDuration ? ` · ${agentDuration}` : ''}</b></div>${proof(agentProof)}`+
    `<div class="kg-loop-phase"><span>Kane CLI</span><b>${esc(kaneLabel)}</b></div>`+
    checks.map((check)=>checkHTML(run,check)).join('')+queued+retried+review;
  return step(index+1,task.title,status,body,isActiveGate?'kg-loop-step-active':'');
}
function finalStep(run) {
  const gate = (run.milestones || []).find((m)=>m.id==='milestone-final');
  const all = (run.verification || []).filter((check)=>check.gate==='Final full suite');
  const latest = new Map(); for (const check of all) latest.set(check.flowId,check);
  const finalChecks = [...latest.values()];
  const reused = (run.reusedVerification || []).filter((check)=>check.gate==='Final full suite');
  const newFeature = finalChecks.filter((check)=>check.generated);
  const regressions = finalChecks.filter((check)=>check.generated===false || (!check.flowId?.startsWith('feature-') && check.generated==null));
  const passed = finalChecks.filter((x)=>x.verdict==='passed').length + reused.length;
  const expectedTotal = run.finalChecksTotal || (run.generatedFlows || []).length + 3;
  const status = gate?.status || (run.status==='passed'?'passed':run.status!=='running'?run.status:'planned');
  const checksSummary = gate ? `${passed} of ${expectedTotal} objectives verified` : 'Runs after all task gates pass';
  let body = `<span class="kg-loop-note">${esc(checksSummary)}</span>`;
  if (reused.length) body+=`<p class="kg-loop-reuse">${reused.length} feature PASS${reused.length===1?'':'es'} reused from earlier Kane runs on identical source; no new browser session or invented evidence.</p>`;
  if (newFeature.length || reused.length) body+=`<details class="kg-loop-disclosure"><summary>Feature validation evidence (${newFeature.length} new, ${reused.length} reused)</summary>`+
    newFeature.map((check)=>checkHTML(run,check)).join('')+reused.map((check)=>checkHTML(run,check,{reused:true})).join('')+'</details>';
  if (regressions.length) body+=`<div class="kg-loop-subhead">Protected regressions</div>${regressions.map((check)=>checkHTML(run,check)).join('')}`;
  if (run.status==='running' && run.activeGate==='Final full suite' && run.currentFlow && !finalChecks.some((x)=>x.flowId===run.currentFlowId))
    body+=queuedCheck(run.currentFlow,true);
  const reviews=(run.plans || []).filter((item)=>item.gate==='Final full suite').map((item)=>{
    const repair=(run.repairs || []).find((r)=>r.attempt===item.attempt);
    return `<div class="kg-loop-repair"><strong>${item.plan?.action==='stop'?'Antigravity review · no code change':`Antigravity repair ${item.attempt}`}</strong>${proof(links([evidenceLink(run,'Diagnosis',item.planFile),evidenceLink(run,'Repair transcript',repair?.outFile)]))}</div>`;
  }).join('');
  body += reviews;
  return step('✓','Final Kane verification',status,body,run.activeGate==='Final full suite' && run.status==='running'?'kg-loop-step-active':'');
}
export function renderLoopHTML(run) {
  if (!run) return '<p class="kg-loop-empty">Start a build to see Antigravity coding and Kane browser checks.</p>';
  if (run.mode!=='build') {
    const latest=new Map(); for(const item of run.verification||[]) latest.set(item.flowId,item);
    return `<div class="kg-loop"><div class="kg-loop-heading"><strong>${esc(run.appLabel||run.appId)} · Kane verification</strong>${badge(run.status)}</div>${[...latest.values()].map((item)=>checkHTML(run,item)).join('')||'<p>Waiting for Kane results…</p>'}</div>`;
  }
  const focus=currentAction(run);
  const done=(run.tasks||[]).filter((task)=>task.status==='verified').length;
  const total=(run.tasks||[]).length;
  const progress=total?Math.round(done/total*100):0;
  const main=`<div class="kg-loop"><div class="kg-loop-heading"><strong>${esc(run.featureTitle||run.appLabel||'Feature build')}</strong>${badge(run.status)}</div>`+
    `<div class="kg-current-focus"><div class="kg-focus-eyebrow">${esc(focus.who)}</div><strong>${esc(focus.title)}</strong><p>${esc(focus.note)}</p></div>`+
    (total?`<div class="kg-work-progress"><span>${done} / ${total} tasks verified</span><div class="kg-progress-track"><span style="width:${progress}%"></span></div></div>`:'')+
    planStep(run)+(run.tasks||[]).map((task,i)=>taskStep(run,task,i)).join('')+(total?finalStep(run):'');
  if(run.status==='running') return main+'</div>';
  const stop=[...(run.timeline||[])].reverse().find((entry)=>entry.kind==='stopped')?.detail||'Review browser evidence';
  const text=run.status==='passed'?'':String(run.failure?.summary||stop).slice(0,360);
  const outcome=`<div class="kg-loop-outcome kg-loop-outcome-${tone(run.status)}"><b>${run.status==='passed'?'Verified with Kane':'Run stopped'}</b>${text?`<span>${esc(text)}</span>`:''}${evidenceLink(run,'Technical log','live.log')}</div>`;
  return main+outcome+'</div>';
}
