import { icon, hydrateIcons } from '../assets/icons.mjs';

const $ = (id) => document.getElementById(id);
const escape = (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const safeEvidence = (value) => { try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : null; } catch { return null; } };
const failureKinds = new Set(['kane_fail', 'stopped', 'safety_reject', 'kane_infrastructure', 'agent_fail', 'precheck_fail']);
const passingKinds = new Set(['success', 'kane_pass', 'precheck_pass']);
const errorStatuses = new Set(['failed', 'agent_error', 'safety_error', 'infrastructure_error', 'precheck_failed']);
let selected = null;
let busy = false;
let refreshing = false;
let queueRequested = false;
let lastSeenRunId = null;

function statusBadge(status) {
  const tone = status === 'passed' ? 'pass' : status === 'running' ? 'running' : errorStatuses.has(status) ? 'fail' : 'info';
  const symbol = tone === 'pass' ? 'check-circle' : tone === 'fail' ? 'circle-alert' : tone === 'running' ? 'activity' : 'circle-dot';
  return `<span class="kg-badge kg-badge-${tone}">${icon(symbol)} ${escape(String(status ?? 'unknown').replaceAll('_', ' ').toUpperCase())}</span>`;
}
const emptyActivity = `<div class="kg-empty">${icon('activity')}<strong>All quiet</strong><span>Run a check to see its timeline.</span></div>`;

function timelineHTML(items = []) {
  if (!items.length) return emptyActivity;
  return items.slice(-30).reverse().map((event) => {
    const danger = failureKinds.has(event.kind);
    const positive = passingKinds.has(event.kind);
    const agent = event.kind === 'agent_start';
    const glyph = danger ? 'circle-alert' : positive ? 'check-circle' : agent ? 'bolt' : 'circle-dot';
    const tone = danger ? 'is-fail' : positive ? 'is-pass' : agent ? 'is-agent' : '';
    return `<div class="kg-event"><span class="kg-event-icon ${tone}">${icon(glyph)}</span><div class="kg-event-copy"><strong>${escape(event.title)}</strong><p>${escape(event.detail)}</p></div><time class="kg-event-time">${escape(event.at?.slice(11, 16) ?? '')}</time></div>`;
  }).join('');
}

function renderInspector(run) {
  $('detailBadge').innerHTML = statusBadge(run.status);
  $('detailEmpty').classList.add('hidden');
  $('detailContent').classList.remove('hidden');
  $('verificationResults').innerHTML = run.verification?.length ? run.verification.map((v) => {
    const url = safeEvidence(v.evidenceUrl);
    const evidence = url ? `<a target="_blank" rel="noopener noreferrer" href="${escape(url)}">Kane evidence ↗</a>` : '';
    const path = `/api/evidence/${encodeURIComponent(run.id)}/`;
    const raw = v.stdoutFile ? `<a target="_blank" rel="noopener noreferrer" href="${path}${encodeURIComponent(v.stdoutFile)}">NDJSON ↗</a>` : '';
    const stderr = v.stderrFile ? `<a target="_blank" rel="noopener noreferrer" href="${path}${encodeURIComponent(v.stderrFile)}">stderr ↗</a>` : '';
    const links = [evidence, raw, stderr].filter(Boolean).join('');
    return `<div class="kg-verify-result"><div class="kg-verify-result-top"><strong>${escape(v.flowName)}</strong>${statusBadge(v.verdict)}</div><p>${escape(v.summary)}</p>${links ? `<div class="kg-evidence-links">${links}</div>` : ''}</div>`;
  }).join('') : '<p class="kg-no-verification">Browser checks have not run or were blocked by precheck.</p>';
  $('diffView').textContent = run.lastDiff || 'No source changes recorded.';
}

function renderRunList(runs) {
  $('historyRows').innerHTML = runs.length ? runs.map((run) => {
    const time = run.createdAt ? new Date(run.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Unknown time';
    const attempts = run.repairs?.length || 0;
    return `<button class="kg-run${selected === run.id ? ' is-selected' : ''}" data-inspect="${escape(run.id)}" type="button" aria-label="Inspect ${escape(run.appLabel)} run ${escape(run.id)}"><span class="kg-run-main"><span class="kg-run-line"><strong>${escape(run.appLabel || run.appId)}</strong><span class="kg-run-id">${escape(run.id)}</span></span><span class="kg-run-meta">${escape(time)} · ${attempts} repair${attempts === 1 ? '' : 's'}</span></span><span>${statusBadge(run.status)} ${icon('chevron-right', 'kg-run-arrow')}</span></button>`;
  }).join('') : `<div class="kg-empty">${icon('history')}<strong>No runs yet</strong><span>Verify an app to create your first run.</span></div>`;
}

function renderActivity(run) {
  $('liveBadge').textContent = run ? (run.id === selected ? 'Selected run' : run.status === 'running' ? 'Running now' : 'Latest run') : 'No active run';
  $('liveActivity').innerHTML = run ? timelineHTML(run.timeline) : emptyActivity;
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
    for (const button of document.querySelectorAll('[data-run]')) button.disabled = busy;
    $('engineStatus').textContent = busy ? 'RUNNING' : 'IDLE';
    $('engineHint').textContent = busy ? 'KaneGuard is verifying an application' : 'Awaiting a verification run';
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
  try {
    const response = await fetch(`/api/runs/${encodeURIComponent(selected)}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('Unable to load run');
    const run = await response.json();
    renderInspector(run);
    renderActivity(run);
    for (const row of document.querySelectorAll('[data-inspect]')) row.classList.toggle('is-selected', row.dataset.inspect === selected);
  } catch { $('notice').textContent = 'Unable to load the selected run.'; $('notice').classList.remove('hidden'); }
});
for (const button of document.querySelectorAll('[data-run]')) button.addEventListener('click', async () => {
  if (busy) return;
  queueRequested = true;
  for (const b of document.querySelectorAll('[data-run]')) b.disabled = true;
  $('notice').classList.add('hidden');
  try {
    const response = await fetch('/api/verify', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({appId:button.dataset.run}) });
    if (!response.ok) throw Error((await response.json()).error || 'Failed to start verification');
    selected = null;
  } catch (error) {
    queueRequested = false;
    $('notice').textContent = `Could not start verification: ${error.message}`;
    $('notice').classList.remove('hidden');
  } finally { await refresh(); }
});

hydrateIcons();
refresh();
setInterval(refresh, 1500);
