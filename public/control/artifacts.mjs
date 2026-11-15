/** Read-only presentation helpers for genuine run artifacts. */
const validName = (name) => typeof name === 'string' && /^[a-zA-Z0-9._-]+$/.test(name);

export function promptArtifacts(run) {
  if (!run || run.mode !== 'build') return [];
  const artifacts = run.artifacts || {};
  const options = [];
  const add = (label, name) => { if (validName(name) && !options.some((item) => item.name === name)) options.push({label, name}); };
  add('KaneGuard → Antigravity · planning instructions', artifacts.plannerPrompt);
  add('Antigravity → feature plan and Kane objectives', artifacts.featurePlan || artifacts.featurePlanCandidate);
  add('Antigravity → original planning transcript', artifacts.plannerTrace);
  add('KaneGuard → Antigravity · task handoff', artifacts.implementationHandoff);
  add('Legacy build handoff (v9)', artifacts.implementationPrompt);
  add('Antigravity → actual implementation tool trace', artifacts.implementationTrace);
  for (const step of run.taskExecutions || []) {
    const taskTitle = (run.tasks || []).find((task) => task.id === step.taskId)?.title || step.taskId;
    add(`${taskTitle} · KaneGuard coding handoff`, step.handoffFile);
    add(`${taskTitle} · Antigravity output`, step.outputFile);
    add(`${taskTitle} · CLI diagnostics`, step.stderrFile);
    add(`${taskTitle} · source changes`, step.diffFile);
  }
  for (const diagnosis of run.plans || []) {
    add(`Repair #${diagnosis.attempt} · KaneGuard failure evidence handoff`, diagnosis.requestFile);
    add(`Repair #${diagnosis.attempt} · Antigravity-authored diagnosis and repair prompt`, diagnosis.planFile);
    add(`Repair #${diagnosis.attempt} · investigation transcript`, diagnosis.stdoutFile);
  }
  for (const repair of run.repairs || []) {
    add(`Repair #${repair.attempt} · KaneGuard repair execution handoff`, repair.ticketFile);
    add(`Repair #${repair.attempt} · execution transcript`, repair.outFile);
  }
  if (run.id) add('Full technical event log', 'live.log');
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
