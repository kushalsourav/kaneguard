/** Small, deterministic scheduling rules. Antigravity chooses the tasks and
 * checks; KaneGuard controls when they can be executed without inventing tests.
 */
export function orderedFeatureTasks(plan) {
  const tasks = plan.tasks || [];
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const visited = new Set(), visiting = new Set(), ordered = [];
  function visit(task) {
    if (visited.has(task.id)) return;
    if (visiting.has(task.id)) throw new Error('Feature task dependency cycle');
    visiting.add(task.id);
    for (const id of task.dependsOn || []) {
      if (!byId.has(id)) throw new Error(`Unknown feature task dependency: ${id}`);
      visit(byId.get(id));
    }
    visiting.delete(task.id);
    visited.add(task.id);
    ordered.push(task);
  }
  for (const task of tasks) visit(task);
  return ordered;
}

/** A check is eligible only after EVERY task claiming responsibility for it
 * is implemented. Never run a browser check against an unfinished dependency.
 */
export function readyMilestoneChecks(plan, implementedIds, alreadyCheckedIds = new Set()) {
  const implemented = new Set(implementedIds);
  const seen = new Set(alreadyCheckedIds);
  return (plan.acceptance || []).filter((check) =>
    !seen.has(check.id) && plan.tasks.some((task) => task.acceptanceIds.includes(check.id)) &&
    plan.tasks.every((task) => !task.acceptanceIds.includes(check.id) || implemented.has(task.id))
  );
}

/** Tasks are verified only after ALL of their own browser acceptance checks
 * have passed. A syntax check or successful agent response cannot verify one.
 */
export function verifiedTaskIds(plan, passedCheckIds) {
  const passing = new Set(passedCheckIds);
  return (plan.tasks || []).filter((task) => task.acceptanceIds.every((id) => passing.has(id))).map((task) => task.id);
}

export function milestoneLabel(readyChecks, task) {
  return `${task.title} · ${readyChecks.length} ready Kane check${readyChecks.length === 1 ? '' : 's'}`;
}
