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

/** Plain-language view of one requirement for the sidebar: a tone, a short label
 * and the Kane checks that cover it with their latest verdicts. Same rules as
 * requirementProgressLabel; only the wording is friendlier. */
export function requirementView(run,requirement,progress=recordedCheckProgress(run)){
  const flows=run.generatedFlows||[];
  const ids=(requirement.acceptanceIds||[]).filter(id=>flows.some(f=>f.id===id));
  const failedBefore=(id)=>(run.verification||[]).some(v=>v.flowId===`feature-${id}`&&['failed','precheck_failed'].includes(v.verdict));
  const checks=ids.map(id=>{
    const latest=progress.latest.get(id)?.verdict;
    const running=run.status==='running'&&run.currentFlowId===`feature-${id}`;
    const verdict=running?'testing':latest==='passed'?'passed':['failed','precheck_failed'].includes(latest)?'failed':latest==='verification_inconclusive'||latest==='infrastructure_error'?'inconclusive':'waiting';
    return {id,name:flows.find(f=>f.id===id)?.name||id,verdict,fixed:verdict==='passed'&&failedBefore(id)};
  });
  if(requirement.status==='proven')return {tone:'proven',label:checks.some(c=>c.fixed)?'Fixed & proven':'Proven',checks};
  if(requirement.status==='unsupported')return {tone:'uncovered',label:'Can’t be tested in a browser',checks};
  if(requirement.status==='unmapped'||!ids.length)return {tone:'uncovered',label:'No Kane check',checks};
  if(checks.some(c=>c.verdict==='failed'))return {tone:'failed',label:run.status==='running'?'Kane FAIL · being fixed':'Kane FAIL',checks};
  if(checks.some(c=>c.verdict==='testing'))return {tone:'testing',label:'Kane testing now',checks};
  if(checks.every(c=>c.verdict==='passed'))return {tone:'passing',label:run.status==='running'?'Passed · final check pending':'Passed · final run incomplete',checks};
  if(checks.some(c=>c.verdict==='inconclusive'))return {tone:'failed',label:'Inconclusive',checks};
  const n=checks.filter(c=>c.verdict==='passed').length;
  return {tone:'waiting',label:n?`${n} of ${checks.length} checks passed`:run.status==='running'?'Waiting for Kane':'Not tested',checks};
}
