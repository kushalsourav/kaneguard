/** Read-only presentation helpers for genuine run artifacts. */
const validName = (name) => typeof name === 'string' && /^[a-zA-Z0-9._-]+$/.test(name);

export function promptArtifacts(run) {
  if (!run || run.mode !== 'build') return [];
  const artifacts = run.artifacts || {};
  const options = [];
  const add = (label, name, advanced = false) => { if (validName(name) && !options.some((item) => item.name === name)) options.push({label, name, advanced}); };
  const title = run.featureTitle || run.appLabel || 'Feature';
  add('Feature request', artifacts.userRequest);
  // Preserved actual CLI input remains accessible, but the user request is
  // never confused with the internal automatic source/context envelope.
  add(`${title} · Antigravity plan`, artifacts.featurePlan || artifacts.featurePlanCandidate);
  add(`${title} · Antigravity planning transcript`, artifacts.plannerTrace);
  add(`${title} · corrected Kane plan`, artifacts.plannerCorrectionCandidate, true);
  add(`${title} · planning correction transcript`, artifacts.plannerCorrectionTrace, true);
  add('KaneGuard implementation handoff', artifacts.implementationHandoff, true);
  add('Legacy handoff', artifacts.implementationPrompt, true);
  add(`${title} · implementation transcript`, artifacts.implementationTrace);
  for (const step of run.taskExecutions || []) {
    const taskTitle = (run.tasks || []).find((task) => task.id === step.taskId)?.title || step.taskId;
    add(`${taskTitle} · KaneGuard coding handoff`, step.handoffFile, true);
    add(`${taskTitle} · Antigravity output`, step.outputFile);
    add(`${taskTitle} · CLI diagnostics`, step.stderrFile, true);
    add(`${taskTitle} · source changes`, step.diffFile);
  }
  for (const diagnosis of run.plans || []) {
    add(`Repair ${diagnosis.attempt} · evidence handoff`, diagnosis.requestFile, true);
    add(`Repair ${diagnosis.attempt} · diagnosis`, diagnosis.planFile);
    add(`Repair ${diagnosis.attempt} · investigation transcript`, diagnosis.stdoutFile);
  }
  for (const repair of run.repairs || []) {
    add(`Repair ${repair.attempt} · handoff`, repair.ticketFile, true);
    add(`Repair ${repair.attempt} · execution transcript`, repair.outFile);
  }
  add('Planner CLI input', artifacts.plannerPrompt, true);
  add('Planning correction input', artifacts.plannerCorrectionPrompt, true);
  add('Attached application source', artifacts.sourceContext, true);
  if (run.id) add('Technical event log', 'live.log', true);
  return options;
}

/** Handles an accepted plan, a pre-validation candidate, or a saved agent NDJSON transcript. */
export function extractAgentPlan(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const unwrap = (source) => String(source || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const asPlan = (value) => {
    const obj = typeof value === 'string' ? JSON.parse(unwrap(value)) : value;
    const plan = obj?.plan && typeof obj.plan === 'object' ? obj.plan : obj;
    return plan && Array.isArray(plan.tasks) && Array.isArray(plan.acceptance) ? plan : null;
  };
  try { const plan = asPlan(raw); if (plan) return plan; } catch {}
  for (const line of raw.split(/\r?\n/).reverse()) {
    try {
      const ev = JSON.parse(line);
      if (ev?.event !== 'result' && ev?.type !== 'result') continue;
      const response = ev.result?.response ?? ev.response ?? ev.result?.result;
      const plan = asPlan(response);
      if (plan) return plan;
    } catch {}
  }
  return null;
}
