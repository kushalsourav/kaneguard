/** Evidence-aware task labels. Shared Kane objectives are gated by *all*
 * responsible tasks, not just the task currently rendering the check. */
const isImplemented = (task) => ['candidate', 'verified'].includes(task?.status);
const isTerminal = (verdict) => ['passed','failed','precheck_failed','infrastructure_error','verification_inconclusive'].includes(verdict);

export function taskCheckState(run, task, check) {
  const owners=(run.tasks||[]).filter(t=>(t.acceptanceIds||[]).includes(check.id));
  const notReady=owners.filter(t=>!isImplemented(t));
  const evidence=(run.verification||[]).filter(v=>v.flowId===`feature-${check.id}` && isTerminal(v.verdict));
  const latest=evidence.at(-1);
  const active=run.status==='running' && run.currentFlowId===`feature-${check.id}` && ['verifying','reverifying','final_verification'].includes(run.stage);
  const shared=owners.length>1;
  if(active) return {label:run.stage==='reverifying'?'Kane retesting now':'Kane browser running',kind:'running',shared,latest};
  if(run.status==='running' && (run.stage==='diagnosing'||run.stage==='repairing') && run.failure?.flowId===`feature-${check.id}`)
    return {label:run.stage==='diagnosing'?'Kane FAIL · agent diagnosing':'Kane FAIL · agent repairing',kind:'failed',shared,latest};
  if(latest?.verdict==='passed') return {label:'Kane passed',kind:'passed',shared,latest};
  if(latest?.verdict==='failed'||latest?.verdict==='precheck_failed') return {label:'Kane reported failure',kind:'failed',shared,latest};
  if(latest?.verdict==='infrastructure_error'||latest?.verdict==='verification_inconclusive')
    return {label:'Kane verification incomplete',kind:'unproven',shared,latest};
  if(notReady.length) {
    const other=notReady.filter(t=>t.id!==task.id);
    const label=other.length ? `Waiting for ${other.map(t=>t.title || t.id).join(' & ')}` : 'Waiting for implementation';
    return {label,kind:'waiting',shared,latest};
  }
  return {label:'Kane queued',kind:'queued',shared,latest};
}

export function taskVerificationState(run,task) {
  if(task.status==='verified')return {label:'Kane verified',kind:'verified'};
  if(task.carriedOver&&run.status!=='passed')return {label:'Kept from stopped run · rechecked at the end',kind:'waiting'};
  if(run.status==='interrupted')return {label:run.stoppedByUser?'Stopped':'Interrupted',kind:'unproven'};
  const milestone=(run.milestones||[]).find(m=>m.taskId===task.id);
  const ids=task.acceptanceIds||[];
  const checks=(run.generatedFlows||[]).filter(f=>ids.includes(f.id));
  const states=checks.map(check=>taskCheckState(run,task,check));
  // On a stopped run the engine may mark every non-certified task inconclusive.
  // Retain the narrower truth: these specific Kane checks really did PASS.
  if(states.length && states.every(s=>s.kind==='passed'))return {
    label:run.status==='passed'?'Kane checks passed · full suite complete'
      :run.status==='running'?'Kane PASS recorded · final gate pending'
      :'Kane PASS recorded · full suite incomplete',kind:'passed'};
  if(states.some(s=>s.kind==='failed'))return {label:'Kane check failed',kind:'failed'};
  if(task.status==='unresolved')return {label:'Built · check unproven (evidence kept)',kind:'unproven'};
  if(milestone?.status==='verification_inconclusive'||task.status==='verification_inconclusive')return {label:'Verification incomplete',kind:'unproven'};
  if(milestone?.status==='failed')return {label:'Kane check failed',kind:'failed'};
  if(task.status==='implementing')return {label:'Agent coding task',kind:'coding'};
  if(!isImplemented(task))return {label:task.status==='planned'?'Planned':String(task.status||'Planned'),kind:'planned'};
  if(states.some(s=>s.kind==='running'))return {label:states.some(s=>s.kind==='running'&&s.shared)?'Kane testing shared check':'Kane browser testing',kind:'testing'};
  const pending=states.filter(s=>s.kind==='waiting');
  if(pending.length) {
    const blocker=pending[0].label;
    return {label:blocker,kind:'waiting'};
  }
  if(milestone?.status==='awaiting_dependencies')return {label:milestone.deferredReason || 'Awaiting shared Kane check',kind:'waiting'};
  if(milestone?.status==='verifying')return {label:'Kane queued',kind:'testing'};
  return {label:'Awaiting Kane',kind:'waiting'};
}
