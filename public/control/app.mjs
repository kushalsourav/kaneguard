import { icon, hydrateIcons } from '../assets/icons.mjs';
import { promptArtifacts, extractAgentPlan } from './artifacts.mjs';
import { renderLoopHTML } from './loop-view.mjs';

const $ = (id) => document.getElementById(id);
const htmlCache = new WeakMap();
function setHTMLIfChanged(element, html) {
  if (htmlCache.get(element) !== html || (!element.hasChildNodes() && html)) {
    element.innerHTML = html;
    htmlCache.set(element,html);
  }
}
const escape = (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const safeEvidence = (value) => { try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : null; } catch { return null; } };
const errorStatuses = new Set(['failed', 'agent_error', 'safety_error', 'infrastructure_error', 'precheck_failed']);
let selected = null;
let busy = false;
let refreshing = false;
let queueRequested = false;
let lastSeenRunId = null;
let evidenceTab = 'results';
let renderedRun = null;
let promptRunId = null;
let promptOptionsSignature = '';
let displayedPromptKey = '';
let previousLoopHTML = '';
let previousLoopRunId = null;
const parsedPlanCache = new Map();
const pendingPlanLoads = new Set();
const artifactCache = new Map();
const artifactLink = (runId, file) => `/api/evidence/${encodeURIComponent(runId)}/${encodeURIComponent(file)}`;
async function getArtifact(runId, file) {
  const key = `${runId}/${file}`;
  if (!artifactCache.has(key)) artifactCache.set(key, fetch(artifactLink(runId, file), {cache:'no-store'}).then((r) => { if (!r.ok) throw new Error(`Artifact unavailable (${r.status})`); return r.text(); }).catch((error) => { artifactCache.delete(key); throw error; }));
  return artifactCache.get(key);
}


function statusBadge(status) {
  const tone = status === 'passed' ? 'pass' : status === 'running' ? 'running' : errorStatuses.has(status) ? 'fail' : 'info';
  const symbol = tone === 'pass' ? 'check-circle' : tone === 'fail' ? 'circle-alert' : tone === 'running' ? 'activity' : 'circle-dot';
  return `<span class="kg-badge kg-badge-${tone}">${icon(symbol)} ${escape(String(status ?? 'unknown').replaceAll('_', ' ').toUpperCase())}</span>`;
}
function selectEvidenceTab(name) {
  const next = ['results', 'plan', 'prompts', 'diff'].includes(name) ? name : 'results';
  const changed = evidenceTab !== next;
  evidenceTab = next;
  for (const button of document.querySelectorAll('[data-evidence-tab]')) {
    const active = button.dataset.evidenceTab === evidenceTab;
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
  }
  for (const section of document.querySelectorAll('[data-evidence-panel]')) {
    section.classList.toggle('hidden', section.dataset.evidencePanel !== evidenceTab);
  }
  if (changed && evidenceTab === 'prompts' && renderedRun) void showPromptText(renderedRun);
}

function planHTML(plan, accepted, reason = '') {
  const tasks = (plan.tasks || []).map((task) => `<div class="kg-detail-item"><div class="kg-detail-title">${icon('list-todo')} ${escape(task.title)}</div><p>${escape(task.detail)}</p><small>${escape((task.dependsOn?.length ? 'Depends on ' + task.dependsOn.join(', ') + ' · ' : '') + (task.acceptanceIds || []).join(' · '))}</small></div>`).join('');
  const flows = (plan.acceptance || []).map((flow) => `<div class="kg-detail-item"><div class="kg-detail-title">${icon('shield-check')} ${escape(flow.name)}</div><p>${escape(flow.objective)}</p></div>`).join('');
  // The workflow itself is displayed exactly once in Activity. This optional
  // inspector contains the underlying details, not another status dashboard.
  return `${reason ? `<p class="kg-plan-error">${escape(reason)}</p>` : ''}<p class="kg-plan-summary">${escape(plan.summary || 'No summary')}</p><details class="kg-loop-disclosure"><summary>Implementation details · ${plan.tasks?.length || 0} tasks</summary>${tasks}</details><details class="kg-loop-disclosure"><summary>Original Kane objectives · ${plan.acceptance?.length || 0} checks</summary>${flows}</details>`;
}

function renderPlanDetails(run) {
  const target = $('planDetails');
  if (run.mode !== 'build') { target.textContent = 'No agent-authored plan for this verification-only run.'; return; }
  if ((run.tasks || []).length && (run.generatedFlows || []).length) {
    setHTMLIfChanged(target,planHTML({tasks:run.tasks, acceptance:run.generatedFlows, summary:run.planSummary}, true));
    return;
  }
  const evidence = run.artifacts || {};
  const artifact = evidence.featurePlanCandidate || evidence.plannerTrace;
  if (!artifact) { target.textContent = 'Waiting for Antigravity to return the feature plan…'; return; }
  const id = run.id;
  // Retain old v8 failed runs: recover the genuine plan from saved Antigravity NDJSON.
  const key = `${id}/${artifact}`;
  const display = (plan) => {
    const stopped = [...(run.timeline || [])].reverse().find((item) => item.kind === 'stopped');
    setHTMLIfChanged(target,plan ? planHTML(plan, false, stopped?.detail || 'Plan has not passed validation.') : '<p>Saved plan unavailable; inspect the original agent transcript under Raw artifacts.</p>');
  };
  if (parsedPlanCache.has(key)) { display(parsedPlanCache.get(key)); return; }
  target.textContent = 'Reading saved agent plan…';
  if (pendingPlanLoads.has(key)) return;
  pendingPlanLoads.add(key);
  getArtifact(id, artifact).then((text) => {
    const plan = extractAgentPlan(text);
    parsedPlanCache.set(key, plan);
    if (selected === id && !(renderedRun?.tasks || []).length) display(plan);
  }).catch((err) => { if (selected === id) target.textContent = `Could not load saved plan: ${err.message}`; })
    .finally(() => pendingPlanLoads.delete(key));
}

function renderPromptOptions(run) {
  const options = promptArtifacts(run);
  const select = $('promptChoice');
  const signature = `${run.id}|${options.map((o) => `${o.label}:${o.name}`).join('|')}`;
  if (signature === promptOptionsSignature) return;
  const previous = promptRunId === run.id ? select.value : '';
  select.innerHTML = options.length ? options.map((o) => `<option value="${escape(o.name)}">${escape(o.label)}</option>`).join('') : '<option value="">No agent artifacts yet</option>';
  select.value = options.some((o) => o.name === previous) ? previous : (options[0]?.name || '');
  select.disabled = !options.length;
  promptRunId = run.id;
  promptOptionsSignature = signature;
  displayedPromptKey = '';
  if (evidenceTab === 'prompts') void showPromptText(run);
}
async function showPromptText(run) {
  const file = $('promptChoice').value;
  const id = run.id;
  const body = $('promptText');
  const link = $('promptOpen');
  const key = `${id}/${file}`;
  if (displayedPromptKey === key) return;
  displayedPromptKey = key;
  link.classList.toggle('hidden', !file);
  if (!file) { body.textContent = 'No prompts or transcripts have been recorded yet. Repair prompts only appear after Kane finds a failure.'; return; }
  link.href = artifactLink(id, file);
  body.textContent = 'Loading saved agent artifact…';
  try {
    const content = await getArtifact(id, file);
    if (selected !== id || $('promptChoice').value !== file) return;
    body.textContent = content.slice(0, 120000) + (content.length > 120000 ? '\n… (display truncated; open original artifact for full text)' : '');
  } catch (error) { if (selected === id) { displayedPromptKey = ''; body.textContent = error.message; } }
}

function renderInspector(run) {
  renderedRun = run;
  $('evidenceTabs').classList.remove('hidden');
  selectEvidenceTab(evidenceTab);
  renderPlanDetails(run);
  renderPromptOptions(run);
  $('detailBadge').innerHTML = statusBadge(run.status);
  const featureEvidence = $('featureEvidence');
  if (run.mode === 'build') {
    const canResume = ['agent_error', 'failed', 'infrastructure_error'].includes(run.status) && !!run.artifacts?.featurePlan && !!run.changedFiles?.length && !busy;
    const parent = run.resumedFrom ? `<p class="kg-resume-origin">Reusing saved code from <code>${escape(run.resumedFrom)}</code></p>` : '';
    const resume = canResume ? `<button type="button" class="kg-resume" data-resume-run="${escape(run.id)}">${icon('refresh-cw')} Retry verification of saved code</button>` : '';
    // No second copy of the plan, tasks or check list in Evidence.
    featureEvidence.classList.toggle('hidden',!parent&&!resume);
    setHTMLIfChanged(featureEvidence,`${parent}${resume}`);
  } else { featureEvidence.classList.add('hidden'); featureEvidence.innerHTML = ''; }
  $('detailEmpty').classList.add('hidden');
  $('detailContent').classList.remove('hidden');
  if (run.mode === 'build') {
    const latest = new Map();
    for (const v of run.verification || []) latest.set(`${v.gate}/${v.flowId}`,v);
    const checked = [...latest.values()];
    const passed = checked.filter((v)=>v.verdict === 'passed').length;
    setHTMLIfChanged($('verificationResults'),`<p class="kg-outcome-line">${checked.length ? `${passed} of ${checked.length} unique Kane gate checks passed.` : 'No browser results yet.'} The evidence for each task is linked directly in Activity.</p>`);
  } else {
    $('verificationResults').innerHTML = run.verification?.length ? run.verification.map((v) => {
      const url = safeEvidence(v.evidenceUrl);
      const evidence = url ? `<a target="_blank" rel="noopener noreferrer" href="${escape(url)}">Kane evidence</a>` : '';
      const path = `/api/evidence/${encodeURIComponent(run.id)}/`;
      const raw = v.stdoutFile ? `<a target="_blank" rel="noopener noreferrer" href="${path}${encodeURIComponent(v.stdoutFile)}">Transcript</a>` : '';
      return `<div class="kg-verify-result"><div class="kg-verify-result-top"><strong>${escape(v.flowName)}</strong>${statusBadge(v.verdict)}</div><p>${escape(v.summary)}</p><div class="kg-evidence-links">${[evidence,raw].filter(Boolean).join(' · ')}</div></div>`;
    }).join('') : '<p class="kg-no-verification">No completed browser checks yet.</p>';
  }
  $('diffView').textContent = run.lastDiff || 'No source changes recorded.';
  const path = `/api/evidence/${encodeURIComponent(run.id)}/`;
  const links = [`<a target="_blank" rel="noopener noreferrer" href="${path}live.log">Live terminal log ↗</a>`];
  for (const plan of run.plans || []) {
    if (plan.planFile) links.push(`<a target="_blank" rel="noopener noreferrer" href="${path}${encodeURIComponent(plan.planFile)}">AI diagnosis #${escape(plan.attempt)} ↗</a>`);
    if (plan.requestFile) links.push(`<a target="_blank" rel="noopener noreferrer" href="${path}${encodeURIComponent(plan.requestFile)}">Diagnosis input #${escape(plan.attempt)} ↗</a>`);
    if (plan.stdoutFile) links.push(`<a target="_blank" rel="noopener noreferrer" href="${path}${encodeURIComponent(plan.stdoutFile)}">Planner trace #${escape(plan.attempt)} ↗</a>`);
  }
  for (const repair of run.repairs || []) {
    if (repair.ticketFile) links.push(`<a target="_blank" rel="noopener noreferrer" href="${path}${encodeURIComponent(repair.ticketFile)}">Agent prompt #${escape(repair.attempt)} ↗</a>`);
    if (repair.outFile) links.push(`<a target="_blank" rel="noopener noreferrer" href="${path}${encodeURIComponent(repair.outFile)}">Agent output #${escape(repair.attempt)} ↗</a>`);
  }
  $('agentLogLinks').innerHTML = links.join(' · ');
}

function renderRunList(runs) {
  const historyHTML = runs.length ? runs.map((run) => {
    const time = run.createdAt ? new Date(run.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Unknown time';
    const attempts = run.repairs?.length || 0;
    return `<button class="kg-run${selected === run.id ? ' is-selected' : ''}" data-inspect="${escape(run.id)}" type="button" aria-label="Inspect ${escape(run.appLabel)} run ${escape(run.id)}"><span class="kg-run-main"><span class="kg-run-line"><strong>${escape(run.appLabel || run.appId)}</strong>${run.mode === 'build' ? '<span class="kg-mode-marker">AI BUILD</span>' : ''}<span class="kg-run-id">${escape(run.id)}</span></span><span class="kg-run-meta">${escape(run.mode === 'build' ? (run.featureTitle || run.request) + ' · ' : '')}${escape(time)} · ${attempts} repair${attempts === 1 ? '' : 's'}</span></span><span>${statusBadge(run.status)} ${icon('chevron-right', 'kg-run-arrow')}</span></button>`;
  }).join('') : `<div class="kg-empty">${icon('history')}<strong>No runs yet</strong><span>Build a feature to create your first run.</span></div>`;
  setHTMLIfChanged($('historyRows'),historyHTML);
}

function renderActivity(run) {
  $('liveBadge').textContent = run ? (run.status === 'running' ? 'Running' : run.status.replaceAll('_',' ')) : 'No run';
  const html = renderLoopHTML(run);
  // Only change DOM when the meaningful loop changes. Avoid continuous duplicate
  // renders during the 1.5-second API poll, especially while reading evidence.
  if (previousLoopHTML !== html || previousLoopRunId !== (run?.id || null)) {
    $('liveActivity').innerHTML = html;
    previousLoopHTML = html; previousLoopRunId = run?.id || null;
  }
}

async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    const [runsResponse, healthResponse] = await Promise.all([fetch('/api/runs', { cache: 'no-store' }), fetch('/api/health', { cache: 'no-store' })]);
    if (!runsResponse.ok || !healthResponse.ok) throw new Error('Unable to read run status');
    const [runs, health] = await Promise.all([runsResponse.json(), healthResponse.json()]);
    // Polling must not kick users back to the top of a long history or evidence trace.
    const scrollOffsets = Object.fromEntries(['historyRows', 'liveActivity', 'detailContent'].map((id) => [id, $(id).scrollTop]));
    if (queueRequested && (health.busy || runs.some((run) => run.status === 'running') || (runs[0]?.id && runs[0].id !== lastSeenRunId))) queueRequested = false;
    busy = !!health.busy || queueRequested;
    lastSeenRunId = runs[0]?.id ?? null;
    $('buildButton').disabled = busy;
    $('buildApp').disabled = busy;
    $('featurePrompt').disabled = busy;
    $('engineStatus').textContent = busy ? 'RUNNING' : 'IDLE';
    $('engineHint').textContent = busy ? 'KaneGuard is running an agent or Kane browser flow' : 'Awaiting a run';
    $('totalRuns').textContent = runs.length;
    $('passRuns').textContent = runs.filter((run) => run.status === 'passed').length;
    $('totalRepairs').textContent = runs.reduce((sum, run) => sum + (run.repairs?.length || 0), 0);
    $('runCountCaption').textContent = `${runs.length} run${runs.length === 1 ? '' : 's'}`;
    const active = runs.find((run) => run.status === 'running') || runs[0];
    const inspected = runs.find((run) => run.id === selected) || active;
    if (inspected) {
      selected = inspected.id;
      renderInspector(inspected);
      renderActivity(inspected);
    } else {
      selected = null;
      $('evidenceTabs').classList.add('hidden');
      renderedRun = null;
      $('detailBadge').textContent = 'NO RUN';
      $('detailEmpty').classList.remove('hidden');
      $('detailContent').classList.add('hidden');
      renderActivity(null);
    }
    renderRunList(runs);
    for (const [id, top] of Object.entries(scrollOffsets)) $(id).scrollTop = top;
  } catch {
    $('engineHint').textContent = 'Unable to connect to the local engine';
    $('liveBadge').textContent = 'Disconnected';
  } finally { refreshing = false; }
}

$('historyRows').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-inspect]');
  if (!button) return;
  selected = button.dataset.inspect;
  evidenceTab = 'results';
  try {
    const response = await fetch(`/api/runs/${encodeURIComponent(selected)}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('Unable to load run');
    const run = await response.json();
    renderInspector(run);
    renderActivity(run);
    for (const row of document.querySelectorAll('[data-inspect]')) row.classList.toggle('is-selected', row.dataset.inspect === selected);
  } catch { $('notice').textContent = 'Unable to load the selected run.'; $('notice').classList.remove('hidden'); }
});
$('featureEvidence').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-resume-run]');
  if (!button || busy || queueRequested) return;
  queueRequested = true;
  button.disabled = true;
  $('notice').classList.add('hidden');
  try {
    const response = await fetch(`/api/runs/${encodeURIComponent(button.dataset.resumeRun)}/resume`, {method:'POST'});
    if (!response.ok) throw new Error((await response.json()).error || 'Unable to resume');
    selected = null;
    evidenceTab = 'results';
  } catch (error) {
    queueRequested = false;
    $('notice').textContent = `Could not resume Kane checks: ${error.message}`;
    $('notice').classList.remove('hidden');
  } finally { await refresh(); }
});
$('featureBuildForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy || queueRequested) return;
  const appId = $('buildApp').value;
  const prompt = $('featurePrompt').value.trim();
  if (prompt.length < 8 || prompt.length > 600) return;
  queueRequested = true;
  $('buildButton').disabled = true;
  $('notice').classList.add('hidden');
  try {
    const response = await fetch('/api/build', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({appId, prompt}) });
    if (!response.ok) throw new Error((await response.json()).error || 'Feature build not accepted');
    selected = null;
    evidenceTab = 'results';
    $('featurePrompt').value = '';
  } catch (error) {
    queueRequested = false;
    $('notice').textContent = `Could not start agent build: ${error.message}`;
    $('notice').classList.remove('hidden');
  } finally { await refresh(); }
});

$('evidenceTabs').addEventListener('click', (event) => {
  const button = event.target.closest('[data-evidence-tab]');
  if (!button) return;
  selectEvidenceTab(button.dataset.evidenceTab);
  $('detailContent').scrollTop = 0;
});
$('promptChoice').addEventListener('change', () => { displayedPromptKey = ''; if (renderedRun) void showPromptText(renderedRun); });
hydrateIcons();
refresh();
setInterval(refresh, 1500);
