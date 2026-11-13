const $ = (id) => document.getElementById(id);
let selected = null, busy = false;
const escape = (s) => String(s ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const statusBadge = (status) => { const tone = status === 'passed' ? 'pass' : status === 'running' ? 'running' : ['failed', 'agent_error', 'safety_error', 'infrastructure_error'].includes(status) ? 'fail' : 'info'; return `<span class="pill badge-${tone}"><span class="dot"></span>${escape(String(status).replaceAll('_', ' ').toUpperCase())}</span>`; };
function timelineHTML(items) {
  return items.slice().reverse().slice(0, 13).map((event) => `<div class="activity-item"><div class="activity-icon ${['kane_fail', 'stopped', 'safety_reject', 'kane_infrastructure', 'agent_fail', 'precheck_fail'].includes(event.kind) ? 'fail' : ''}">${['kane_fail', 'stopped', 'safety_reject'].includes(event.kind) ? '!' : ['success', 'kane_pass', 'precheck_pass'].includes(event.kind) ? '✓' : '↗'}</div><div class="activity-copy"><strong>${escape(event.title)}</strong><p>${escape(event.detail)}</p></div><span class="activity-time">${escape(event.at?.slice(11, 19))}</span></div>`).join('');
}
function showDetails(run) {
  selected = run.id;
  $('detailBadge').outerHTML = `<span id="detailBadge">${statusBadge(run.status)}</span>`;
  $('detailEmpty').classList.add('hidden'); $('detailContent').classList.remove('hidden');
  $('verificationResults').innerHTML = run.verification.length ? run.verification.map((v) => `<div class="verify-mini"><div style="display:flex;justify-content:space-between;gap:9px"><strong>${escape(v.flowName)}</strong>${statusBadge(v.verdict)}</div><small>${escape(v.summary)}</small><div class="tiny" style="margin-top:7px">${v.evidenceUrl ? `<a target="_blank" rel="noopener noreferrer" class="link-evidence" href="${escape(v.evidenceUrl)}">Kane evidence ↗</a> · ` : ''}<a target="_blank" class="link-evidence" href="/api/evidence/${encodeURIComponent(run.id)}/${encodeURIComponent(v.stdoutFile)}">Raw NDJSON</a> · <a target="_blank" class="link-evidence" href="/api/evidence/${encodeURIComponent(run.id)}/${encodeURIComponent(v.stderrFile)}">stderr</a></div></div>`).join('') : '<p class="muted tiny">Browser verification did not run yet or was blocked by precheck.</p>';
  $('diffView').textContent = run.lastDiff || 'No source code changed in this run.';
  $('detailTimeline').innerHTML = timelineHTML(run.timeline);
}
async function refresh() {
  try {
    const [runs, health] = await Promise.all([fetch('/api/runs').then((r) => r.json()), fetch('/api/health').then((r) => r.json())]);
    busy = health.busy;
    for (const button of document.querySelectorAll('[data-run]')) button.disabled = busy;
    $('engineStatus').textContent = busy ? 'RUNNING' : 'IDLE';
    $('engineHint').textContent = busy ? 'KaneGuard is verifying a target' : 'Ready for a verification run';
    $('totalRuns').textContent = runs.length;
    $('passRuns').textContent = runs.filter((r) => r.status === 'passed').length;
    $('totalRepairs').textContent = runs.reduce((s, r) => s + r.repairs.length, 0);
    $('runCountCaption').textContent = `${runs.length} recorded run${runs.length === 1 ? '' : 's'}`;
    const active = runs.find((r) => r.status === 'running') || runs[0];
    $('liveBadge').innerHTML = active?.status === 'running' ? '<span class="dot" style="color:#b9fa72"></span> In progress' : '● Latest run';
    $('liveActivity').innerHTML = active ? timelineHTML(active.timeline) : '<div class="empty"><span class="huge">↺</span>Awaiting a real verification run.<br/>Select an app to see its event timeline.</div>';
    $('historyRows').innerHTML = runs.length ? runs.map((r) => `<tr><td class="mono">${escape(r.id)}</td><td><strong>${escape(r.appLabel)}</strong></td><td>${escape(new Date(r.createdAt).toLocaleString())}</td><td>${r.repairs.length} / ${r.maxRepairs}</td><td>${statusBadge(r.status)}</td><td><button data-inspect="${escape(r.id)}">Inspect →</button></td></tr>`).join('') : '<tr><td colspan="6" class="empty">No runs saved yet. Choose an app above to begin.</td></tr>';
    const match = runs.find((r) => r.id === selected) || active;
    if (match) showDetails(match);
  } catch (e) { $('engineHint').textContent = 'Unable to fetch engine state'; }
}
$('historyRows').addEventListener('click', async (e) => { const button = e.target.closest('[data-inspect]'); if (!button) return; const response = await fetch(`/api/runs/${encodeURIComponent(button.dataset.inspect)}`); if (!response.ok) return; showDetails(await response.json()); $('runDetail').scrollIntoView({ behavior: 'smooth' }); });
for (const button of document.querySelectorAll('[data-run]')) button.addEventListener('click', async () => {
  if (busy) return;
  button.disabled = true;
  try { const response = await fetch('/api/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ appId: button.dataset.run }) }); if (!response.ok) throw Error((await response.json()).error); selected = null; setTimeout(refresh, 300); }
  catch (e) { alert(`Could not start verification: ${e.message}`); }
  finally { setTimeout(refresh, 900); }
});
refresh(); setInterval(refresh, 1400);
