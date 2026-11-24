/** Presentation-only progress derived from actual per-check Kane verdicts.
 * This does NOT confer run-level certification and never modifies evidence. */
const terminal=new Set(['passed','failed','precheck_failed','infrastructure_error','verification_inconclusive']);

export function recordedCheckProgress(run) {
  const ids=new Set((run.generatedFlows||[]).map(flow=>flow.id).filter(Boolean));
  const latest=new Map();
  for(const attempt of run.verification||[]) {
    if(!attempt?.flowId?.startsWith('feature-')||!terminal.has(attempt.verdict))continue;
    const id=attempt.flowId.slice('feature-'.length);
    if(ids.has(id))latest.set(id,attempt);
  }
  const passes=[...latest.values()].filter(v=>v.verdict==='passed').length;
  const failures=[...latest.values()].filter(v=>['failed','precheck_failed'].includes(v.verdict)).length;
  return {total:ids.size,passed:passes,failed:failures,latest};
}

export function requirementProgressLabel(run,requirement,progress=recordedCheckProgress(run)) {
  if(requirement.status==='proven')return 'Fully certified';
  if(requirement.status==='unmapped')return 'Unmapped · no test evidence';
  if(requirement.status==='unsupported')return 'Unsupported browser check';
  const ids=(requirement.acceptanceIds||[]).filter(id=>(run.generatedFlows||[]).some(flow=>flow.id===id));
  if(!ids.length)return 'No mapped Kane checks';
  const passed=ids.filter(id=>progress.latest.get(id)?.verdict==='passed').length;
  const failed=ids.filter(id=>['failed','precheck_failed'].includes(progress.latest.get(id)?.verdict)).length;
  const running=run.status==='running'&&ids.some(id=>run.currentFlowId===`feature-${id}`);
  if(failed)return `${passed}/${ids.length} checks passed · Kane FAIL${run.status==='verification_inconclusive'?' (disputed)':''}`;
  if(passed===ids.length)return run.status==='running'
    ? 'Kane checks passed · final gate pending'
    : 'Kane checks passed · full suite incomplete';
  if(running)return `${passed}/${ids.length} passed · Kane testing`;
  if(run.status==='running')return `${passed}/${ids.length} passed · pending`;
  return `${passed}/${ids.length} passed · verification incomplete`;
}
