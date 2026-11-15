/** A single, evidence-backed view of a KaneGuard run. No raw terminal fragments,
 * synthetic PASS labels, guessed task titles, or duplicated plan/trace renders.
 * All task/check names originate in the saved Antigravity plan or Kane results.
 */
const esc = (v) => String(v ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const fileOK = (v) => typeof v === 'string' && /^[a-zA-Z0-9._-]+$/.test(v);
const directUrl = (url) => {
  try { const x = new URL(url); return x.protocol === 'https:' ? x.href : null; } catch { return null; }
};
const artifactUrl = (run, file) => `/api/evidence/${encodeURIComponent(run.id)}/${encodeURIComponent(file)}`;
const link = (run, title, file) => fileOK(file) ? `<a href="${artifactUrl(run,file)}" target="_blank" rel="noopener noreferrer">${esc(title)}</a>` : '';
const statusText = (status) => ({verified:'Verified',passed:'Passed',verified_later:'Verified later',implementing:'Coding',candidate:'Awaiting Kane',verifying:'Kane testing',awaiting_dependencies:'Waiting for dependent UI',repairing:'Repairing',blocked:'Stopped',failed:'Failed',infrastructure_error:'Infrastructure issue',running:'Running',planned:'Queued'}[status] || String(status || 'Queued').replaceAll('_',' '));
const statusClass = (status) => ['verified','passed','verified_later'].includes(status) ? 'pass' : ['failed','blocked','infrastructure_error','agent_error','safety_error'].includes(status) ? 'fail' : ['implementing','verifying','repairing','running'].includes(status) ? 'active' : 'waiting';
const state = (status) => `<span class="kg-loop-state kg-loop-${statusClass(status)}">${esc(statusText(status))}</span>`;

function checkHTML(run, check, {compact=false} = {}) {
  const proof = directUrl(check.evidenceUrl);
  const pieces = [proof ? `<a href="${esc(proof)}" target="_blank" rel="noopener noreferrer">Kane evidence</a>` : '',
    link(run,'Kane transcript',check.stdoutFile),
    check.verdict === 'infrastructure_error' ? link(run,'CLI error log',check.stderrFile) : ''].filter(Boolean).join(' · ');
  const description = check.verdict === 'infrastructure_error'
    ? esc(check.summary || 'Kane could not complete this run. No application PASS was awarded.')
    : compact ? '' : esc(check.summary || '');
  return `<div class="kg-loop-check"><span class="kg-loop-check-name">${esc(check.flowName || check.flowId)}</span>${state(check.verdict)}${pieces ? `<div class="kg-loop-proof">${pieces}</div>` : ''}${description ? `<p class="kg-loop-detail">${description}</p>` : ''}</div>`;
}
function awaitingCheckHTML(name) {
  return `<div class="kg-loop-check kg-loop-check-waiting"><span class="kg-loop-check-name">${esc(name)}</span>${state('planned')}</div>`;
}
function step(run, {number,title,status,body='',className=''}) {
  return `<section class="kg-loop-step ${className}"><div class="kg-loop-step-header"><span class="kg-loop-count">${esc(number)}</span><strong>${esc(title)}</strong>${state(status)}</div>${body ? `<div class="kg-loop-step-body">${body}</div>` : ''}</section>`;
}
function planStep(run) {
  const hasPlan = (run.tasks || []).length > 0;
  const title = hasPlan ? (run.featureTitle || run.request || 'Feature plan') : 'Antigravity creating the plan';
  const artifacts = run.artifacts || {};
  const proof = [link(run,'Agent-generated plan',artifacts.featurePlan),link(run,'Planning transcript',artifacts.plannerTrace)].filter(Boolean).join(' · ');
  return step(run,{number:'P',title,status:hasPlan ? 'passed' : 'running',className:'kg-loop-plan',
    body:`<span class="kg-loop-note">Antigravity · ${hasPlan ? `${run.tasks.length} tasks, ${(run.generatedFlows || []).length} browser checks` : 'Reading application source'}</span>${proof ? `<div class="kg-loop-proof">${proof}</div>` : ''}`});
}
function taskStep(run,task,i) {
  const gate = (run.milestones || []).find((m)=>m.taskId === task.id);
  const execution = (run.taskExecutions || []).find((m)=>m.taskId === task.id);
  const resultGate = gate ? `After ${task.id}: ${task.title}` : '';
  const checked = (run.verification || []).filter((v)=>v.gate === resultGate);
  const byFlow = new Map();
  for (const check of checked) byFlow.set(check.flowId,check);
  const checks = [...byFlow.values()];
  const retries = checked.filter((check)=> check.verdict === 'infrastructure_error' && byFlow.get(check.flowId) !== check);
  const retryEvidence = retries.length ? `<details class="kg-loop-disclosure"><summary>${retries.length} earlier Kane infrastructure attempt${retries.length === 1 ? '' : 's'}</summary>${retries.map((check)=>checkHTML(run,check,{compact:true})).join('')}</details>` : '';
  const pendingIDs = gate?.checkIds || [];
  const plannedNames = new Map((run.generatedFlows || []).map((f)=>[`feature-${f.id}`,f.name]));
  const seen = new Set(checks.map((x)=>x.flowId));
  const pending = pendingIDs.filter((id)=>!seen.has(`feature-${id}`)).map((id)=>awaitingCheckHTML(plannedNames.get(`feature-${id}`) || id)).join('');
  const agentProof = [
    link(run,'Coding transcript', execution?.outputFile),
    link(run,'Task handoff', execution?.handoffFile),
    link(run,'Source changes', execution?.diffFile)
  ].filter(Boolean).join(' · ');
  const coded = execution?.status === 'completed' || execution?.status === 'interrupted';
  const status = gate?.status === 'failed' ? (checks.at(-1)?.verdict || 'failed') : gate?.status === 'verifying' ? 'verifying'
    : task.status || 'planned';
  const checkLabel = !gate ? 'Waiting for implementation' :
    gate.status === 'awaiting_dependencies' ? 'Kane checks activate after dependent UI is ready' :
    !checks.length && !pending ? 'No browser gate needed for this standalone code step' : '';
  const repairs = (run.plans || []).filter((p)=>p.gate === resultGate).map((diagnosis)=>{
    const executionRecord = (run.repairs || []).find((r)=>r.attempt === diagnosis.attempt);
    return `<div class="kg-loop-repair"><span>Antigravity repair #${esc(diagnosis.attempt)}</span><div class="kg-loop-proof">${[link(run,'Diagnosis',diagnosis.planFile),link(run,'Repair trace',executionRecord?.outFile),link(run,'Source diff',executionRecord?.diffFile)].filter(Boolean).join(' · ')}</div></div>`;
  }).join('');
  return step(run,{number:i+1,title:task.title,status,body:
    `<div class="kg-loop-actor"><b>Antigravity</b><span>${esc(execution?.status === 'running' || task.status === 'implementing' ? 'Implementing this task' : coded ? 'Code completed' : execution?.status === 'failed' ? 'Coding failed' : 'Waiting')}</span></div>`+
    (agentProof ? `<div class="kg-loop-proof">${agentProof}</div>` : '')+
    `<div class="kg-loop-actor"><b>Kane CLI</b><span>${esc(checkLabel || (checks.length ? `${checks.length} browser check${checks.length===1?'':'s'} completed` : 'Waiting for code'))}</span></div>`+
    checks.map((x)=>checkHTML(run,x,{compact:true})).join('')+pending+retryEvidence+repairs});
}
function finalStep(run) {
  const milestone = (run.milestones || []).find((m)=>m.taskId == null && m.id === 'milestone-final');
  const finals = (run.verification || []).filter((v)=>v.gate === 'Final full suite');
  const last = new Map();
  for (const item of finals) last.set(item.flowId,item);
  const checks = [...last.values()];
  const passed = checks.filter((v)=>v.verdict==='passed').length;
  const status = milestone?.status || (run.status==='passed' ? 'passed' : run.status !== 'running' ? run.status : 'planned');
  let body = `<span class="kg-loop-note">${checks.length ? `${passed}/${checks.length} completed browser checks passed` : 'Full feature and protected regression suite runs after the task gates'}</span>`;
  if (checks.length) body += `<details class="kg-loop-disclosure" ${statusClass(status)==='fail'?'open':''}><summary>Final Kane results and evidence (${checks.length})</summary>${checks.map((v)=>checkHTML(run,v,{compact:true})).join('')}</details>`;
  const repairs = (run.plans || []).filter((p)=>p.gate==='Final full suite').map((diagnosis)=>{
    const executed=(run.repairs || []).find((r)=>r.attempt===diagnosis.attempt);
    return `<div class="kg-loop-repair">Antigravity repair #${esc(diagnosis.attempt)}<div class="kg-loop-proof">${[link(run,'Diagnosis',diagnosis.planFile),link(run,'Repair transcript',executed?.outFile)].filter(Boolean).join(' · ')}</div></div>`;
  }).join('');
  body += repairs;
  return step(run,{number:'✓',title:'Final Kane verification',status,body});
}

/** Generates a complete single-loop view, not a task listing plus an event-log duplicate. */
export function renderLoopHTML(run) {
  if (!run) return '<p class="kg-loop-empty">Start a build to see the implementation and verification loop.</p>';
  if (run.mode !== 'build') {
    const latest = new Map();
    for (const result of run.verification || []) latest.set(result.flowId,result);
    return `<div class="kg-loop"><div class="kg-loop-heading"><strong>${esc(run.appLabel || run.appId)} · Kane verification</strong>${state(run.status)}</div>${[...latest.values()].map((v)=>checkHTML(run,v)).join('') || '<p class="kg-loop-empty">Waiting for Kane browser checks…</p>'}</div>`;
  }
  const work = (run.tasks || []).map((task,i)=>taskStep(run,task,i)).join('');
  let outcome = '';
  if (run.status !== 'running') {
    const original = run.failure?.summary || [...(run.timeline || [])].reverse().find((x)=>x.kind==='stopped')?.detail || 'The run stopped before full verification';
    const err = run.status !== 'passed' ? (run.status==='infrastructure_error' ? `Kane infrastructure interrupted verification; no application failure or PASS was inferred. ${original.slice(0,150)}` : original.slice(0,320)) : '';
    outcome = `<div class="kg-loop-outcome kg-loop-outcome-${statusClass(run.status)}"><b>${run.status==='passed'?'Feature verified by Kane':'Run stopped'}</b>${err?`<span>${esc(err)}</span>`:''}${link(run,'Full technical log','live.log')}</div>`;
  }
  return `<div class="kg-loop"><div class="kg-loop-heading"><strong>${esc(run.featureTitle || run.appLabel || 'Feature build')}</strong>${state(run.status)}</div>${planStep(run)}${work}${run.tasks?.length ? finalStep(run) : ''}${outcome}</div>`;
}
