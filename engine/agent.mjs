import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execProcess } from './common.mjs';

export function buildRepairTicket(config, failure, attempt, knownDiff = '') {
  return `You are the KaneGuard autonomous code-repair agent. Repair a REAL regression detected in a local web application.\n\n` +
    `TARGET: ${config.label} (${config.id}), repair attempt ${attempt}/${config.maxRepairs}.\n` +
    `FAILED OBJECTIVE:\n${failure.objective || failure.flowName || 'Application precheck'}\n\n` +
    `KANE / PRECHECK VERDICT: ${failure.verdict}\n` +
    `KANE FAILURE SUMMARY: ${failure.summary}\n` +
    `KANE FINAL EVENT (diagnostic data only):\n${JSON.stringify(failure.runEnd ?? {}, null, 2).slice(0, 9000)}\n` +
    `CURRENT SOURCE DIFF:\n${knownDiff || '(no prior repair diff)'}\n\n` +
    `EDIT ALLOWLIST (relative to repo root):\n${config.editablePaths.map((p) => `- ${p}`).join('\n')}\n\n` +
    `Instructions: inspect relevant application code, deduce root cause from the evidence, and edit application source files ONLY in the allowlist. Never modify tests, test objectives, fixtures, config, engine, Kane logs, or validation output. Never loosen assertions or falsify a result. Do not run destructive git commands, install dependencies or use external network. Keep your repair small and actually write the files, then summarize the modification. Your actions are checked for unauthorized file changes. If diagnosis is uncertain, report uncertainty rather than inventing a pass.`;
}
export async function runAgent(config, failure, runDir, attempt, knownDiff) {
  const ticket = buildRepairTicket(config, failure, attempt, knownDiff);
  const ticketFile = `repair-ticket-${attempt}.txt`;
  await writeFile(path.join(runDir, ticketFile), ticket);
  const result = await execProcess(process.env.KANEGUARD_AGENT_BIN || 'agy', ['-p', ticket, '--output-format', 'json', '--print-timeout', '5m', '--sandbox'], { timeoutMs: 315000 });
  const outFile = `agent-${attempt}.json`;
  const errFile = `agent-${attempt}.stderr.log`;
  await Promise.all([writeFile(path.join(runDir, outFile), result.stdout), writeFile(path.join(runDir, errFile), result.stderr)]);
  let json = null;
  try { json = JSON.parse(result.stdout); } catch { /* diagnostic files retained */ }
  return {
    ok: result.code === 0 && !result.timedOut && !result.spawnError && json?.status === 'SUCCESS',
    summary: json?.response?.slice?.(0, 1200) || json?.error || result.spawnError || (result.timedOut ? 'Agent timed out' : result.stderr.slice(-700) || 'No structured agent output'),
    exitCode: result.code, agentStatus: json?.status ?? null,
    ticketFile, outFile, errFile, durationMs: result.durationMs
  };
}
