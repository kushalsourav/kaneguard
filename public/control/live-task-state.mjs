/** UI labels come from persisted engine stages and the saved gate, never from
 * agent claims. A failed Kane check stays failed while diagnosis/repair runs. */
export function liveTaskPhase(run, task) {
  if (!run || run.status !== 'running' || !task) return null;
  const activeGate = typeof run.activeGate === 'string' && run.activeGate.startsWith(`After ${task.id}:`);
  if (run.stage === 'implementing' && task.status === 'implementing')
    return { key:'coding', label:'Agent coding task', detail:'Source edits are underway. Kane has not verified this task yet.' };
  if (!activeGate) return null;
  if (run.stage === 'diagnosing')
    return { key:'diagnosing', label:'Agent investigating Kane failure', detail:run.failure?.summary || 'Reviewing the saved browser failure and source files.' };
  if (run.stage === 'repairing')
    return { key:'repairing', label:'Agent coding repair', detail:run.plans?.at(-1)?.plan?.diagnosis || 'Implementing a fix from Kane evidence; retest has not passed yet.' };
  if (run.stage === 'reverifying')
    return { key:'retesting', label:'Kane retesting after repair', detail:'The previous failed attempt is preserved. Waiting for a new browser verdict.' };
  if (run.stage === 'verifying' && task.status !== 'verified')
    return { key:'testing', label:'Kane testing', detail:'Browser checks are running.' };
  return null;
}

/** A pending phase belongs only to the actual failing/browser check. Never
 * imply that a FAIL has been repaired before Kane records a new PASS. */
export function pendingCheckPhase(run, attempts) {
  if (!attempts?.length || run?.status !== 'running' || run.activeGate !== attempts[0].gate) return null;
  const last = attempts.at(-1);
  const failed = attempts.some((v)=>v.verdict === 'failed' || v.verdict === 'precheck_failed');
  if (!failed) return null;
  const isFocus = run.failure?.flowId === last.flowId;
  if (run.stage === 'diagnosing' && isFocus)
    return { key:'diagnosing', label:'Agent diagnosis in progress', detail:'The coding agent is examining Kane evidence; no code repair has been accepted yet.' };
  if (run.stage === 'repairing' && isFocus)
    return { key:'repairing', label:'Agent coding repair now', detail:'The coding agent is editing the source. The earlier Kane FAIL remains valid until retested.' };
  if (run.stage === 'reverifying' && (run.currentFlowId === last.flowId || (!run.currentFlowId && isFocus)))
    return { key:'retesting', label:'Kane retest in progress', detail:'A fresh Chrome browser run is required before the outcome can change.' };
  return null;
}
