import { pendingCheckPhase } from './live-task-state.mjs';

/** Evidence-backed UI for the *full* verification journey. Earlier FAILs and
 * repair steps are never replaced by the latest PASS, including after reload. */
const html = (value) => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const safeFile = (value) => typeof value === 'string' && /^[a-zA-Z0-9._-]+$/.test(value);
const time = (value) => {
  if (!value || !Number.isFinite(Date.parse(value))) return '';
  return new Date(value).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit',second:'2-digit'});
};
const failure = (verdict) => verdict === 'failed' || verdict === 'infrastructure_error' || verdict === 'precheck_failed';
const heading = (verdict) => verdict === 'passed'?'Kane PASS':verdict === 'failed'?'Kane FAIL':verdict === 'infrastructure_error'?'Kane infrastructure error':`Kane ${String(verdict||'unknown').toUpperCase()}`;
function linkTo(file, link, text) {
  return safeFile(file) ? `<a href="${html(link(file))}" target="_blank" rel="noopener">${html(text)}</a>` : '';
}
function proofLink(v, link) {
  const external = typeof v.evidenceUrl === 'string' && /^https:\/\//.test(v.evidenceUrl)
    ? `<a target="_blank" rel="noopener" href="${html(v.evidenceUrl)}">Browser evidence</a>` : '';
  return `<span class="journey-proof">${external}${linkTo(v.stdoutFile,link,'Kane transcript')}${linkTo(v.stderrFile,link,'CLI stderr')}</span>`;
}
function eventAt(run, result, index) {
  if (result.finishedAt) return result.finishedAt;
  const matches = (run.timeline || []).filter((event) =>
    event.title === `${result.flowName}: ${String(result.verdict).toUpperCase().replaceAll('_',' ')}`);
  return matches[index]?.at || '';
}
function journeyStep(type, title, body, links = '', stamp = '') {
  return `<div role="listitem" class="journey-event ${html(type)}"><div class="journey-event-head"><strong>${html(title)}</strong>${stamp?`<time>${html(stamp)}</time>`:''}</div>${body?`<p>${html(body)}</p>`:''}${links}</div>`;
}
export function flowAttempts(run, flowId, gate = null) {
  return (run.verification || []).filter((v) => v.flowId === flowId && (gate === null || v.gate === gate));
}
/** The latest result controls the badge, but every earlier result stays visible.
 * A diagnosis/repair is displayed only if genuinely saved in the run record. */
export function renderCheckJourney(run, results, link, { expanded = false, label = '' } = {}) {
  if (!results.length) return '';
  const failedCount = results.filter((v)=>failure(v.verdict)).length;
  const finalResult = results.at(-1);
  const gate = results[0].gate;
  const diagnoses = (run.plans || []).filter((p)=>p.gate===gate);
  const repairs = (run.repairs || []).filter((p)=>p.gate===gate);
  const steps = [];
  for (let i=0; i<results.length; i++) {
    const v=results[i];
    const globalMatches = (run.verification || []).filter((prior)=>prior.flowName===v.flowName && prior.verdict===v.verdict);
    const stamp = time(eventAt(run,v,globalMatches.indexOf(v)));
    const title = `${heading(v.verdict)} · Attempt ${i+1}` + (v.diagnosticRetry?' · unchanged-source recheck':v.infrastructureRetry?' · infrastructure retry':'') + (v.unavailableCapability?' · browser capability unavailable':'');
    steps.push(journeyStep(v.verdict === 'passed'?'passed':failure(v.verdict)?'failed':'neutral',title,
      v.summary || 'Kane did not include a summary',proofLink(v,link),stamp));
    if (v.verdict === 'failed' || v.verdict==='precheck_failed') {
      const gateFailures = (run.verification || []).filter((entry) => entry.gate === gate && (entry.verdict==='failed' || entry.verdict==='precheck_failed'));
      const diagnosis = diagnoses[gateFailures.indexOf(v)];
      if (diagnosis) {
        const explanation = diagnosis.plan?.diagnosis || diagnosis.summary || 'Diagnosis saved';
        const action = diagnosis.plan?.action;
        const links = `<span class="journey-proof">${linkTo(diagnosis.stdoutFile,link,'Diagnosis transcript')}${linkTo(diagnosis.planFile,link,'Diagnosis JSON')}</span>`;
        steps.push(journeyStep('diagnosis',`Agent diagnosis #${diagnosis.attempt}${action==='stop'?' · no app defect identified':''}`,explanation,links));
        const repair = repairs.find((r)=>r.attempt===diagnosis.attempt);
        if (repair) {
          const details = repair.changedFiles?.length ? `Updated ${repair.changedFiles.join(', ')}.` : String(repair.summary || 'Repair completed');
          const repairLinks = `<span class="journey-proof">${linkTo(repair.outFile,link,'Repair transcript')}${linkTo(`source-diff-${repair.attempt}.txt`,link,'Repair diff')}</span>`;
          steps.push(journeyStep('repair',`Agent repair #${repair.attempt}`,details,repairLinks));
        } else if (action==='stop') {
          steps.push(journeyStep('recheck','No code changed','Kane must independently recheck the original objective; the agent cannot award a PASS.'));
        }
      }
    }
  }
  // The saved browser FAIL is immutable. A running diagnosis or repair is a
  // separate, explicitly pending step (never a fabricated verification PASS).
  const pending = pendingCheckPhase(run,results);
  if (pending) steps.push(journeyStep('pending',pending.label,pending.detail));
  const shouldOpen = expanded || failedCount>0;
  const summary = label || results[0].flowName || 'Browser check';
  const end = finalResult.verdict==='passed' ? (failedCount?'PASS after retry':'PASS') : pending ? `${heading(finalResult.verdict)} · ${pending.label}` : finalResult.unavailableCapability?'INCONCLUSIVE · browser limitation':heading(finalResult.verdict);
  const identity=`${gate || ''}::${results[0].flowId || results[0].flowName}`;
  return `<details class="check-journey" data-journey-key="${html(identity)}" ${shouldOpen?'open':''}><summary><span class="journey-summary-title">${html(summary)}</span><span class="journey-summary-detail">${results.length} Kane run${results.length===1?'':'s'}${failedCount?` · ${failedCount} failed`:''} · ${end}</span></summary><div role="list" class="journey-steps">${steps.join('')}</div></details>`;
}

export function renderAllVerificationJourneys(run, link) {
  const grouped = new Map();
  for (const v of run.verification || []) {
    const key = `${v.gate || 'Unknown gate'}\0${v.flowId || v.flowName}`;
    if (!grouped.has(key)) grouped.set(key,[]);
    grouped.get(key).push(v);
  }
  const items = [...grouped.values()].map((results) => {
    const gate = results[0].gate || 'Browser verification';
    return `<section class="verification-journey"><div class="journey-gate">${html(gate)}</div>${renderCheckJourney(run,results,link)}</section>`;
  });
  for (const r of run.reusedVerification || []) {
    items.push(`<section class="verification-journey"><div class="journey-gate">${html(r.gate || 'Final full suite')}</div><div class="reused-proof"><strong>Reused original Kane PASS · ${html(r.flowName)}</strong><p>Previously passed on an identical source fingerprint. This is NOT a new browser run.</p><span class="journey-proof">${linkTo(r.stdoutFile,link,'Original Kane transcript')}</span></div></section>`);
  }
  if (run.currentFlow && run.status==='running') {
    items.push(`<div class="verify-row"><div class="verify-head"><strong>${html(run.currentFlow)}</strong><span class="verify-state">BROWSER RUNNING</span></div><p>Kane CLI is executing the current objective. Awaiting its terminal verdict.</p></div>`);
  }
  return items.join('') || '<div class="empty-pane">No Kane browser results yet. Coding completion is not verification.</div>';
}
