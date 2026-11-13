import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execProcess, now } from './common.mjs';

export function parseKaneNDJSON(data, processResult = {}) {
  const lines = data.split(/\r?\n/).filter(Boolean);
  const events = [], malformed = [];
  for (const line of lines) {
    try { events.push(JSON.parse(line)); }
    catch { malformed.push(line.slice(0, 400)); }
  }
  const last = [...events].reverse().find((e) => e?.type === 'run_end') ?? null;
  const status = String(last?.status ?? '').toLowerCase();
  let verdict = 'infrastructure_error';
  if (!processResult.timedOut && !processResult.spawnError && last) {
    if (status === 'passed' && processResult.code === 0) verdict = 'passed';
    else if (status === 'failed') verdict = 'failed';
  }
  const summary = last?.summary || last?.reason || (processResult.timedOut ? 'Kane CLI timed out' : processResult.spawnError ? processResult.spawnError : !last ? 'No final run_end event: cannot infer a pass' : `Unexpected Kane status ${status} / exit ${processResult.code}`);
  return { verdict, status: status || null, summary, final: last, events, malformed, eventCount: events.length };
}

export async function runKane(config, flow, runDir, iteration, notify = () => {}) {
  const args = ['run', flow.objective, '--url', config.url, '--agent', '--headless', '--timeout', String(config.timeoutSeconds || 120), '--final-validation', 'on'];
  notify({ at: now(), kind: 'kane_start', title: `Kane verifying · ${flow.name}`, detail: `Attempt ${iteration + 1} · real browser run` });
  const output = await execProcess(process.env.KANE_CLI_BIN || 'kane-cli', args, { timeoutMs: (config.timeoutSeconds || 120) * 1000 + 15000 });
  const prefix = path.join(runDir, `kane-${flow.id}-${iteration}`);
  await Promise.all([writeFile(`${prefix}.ndjson`, output.stdout), writeFile(`${prefix}.stderr.log`, output.stderr)]);
  const parsed = parseKaneNDJSON(output.stdout, output);
  const evidenceHint = output.stderr.match(/evidence:\s*view locally[^\r\n]*/i)?.[0] ?? null;
  const result = {
    flowId: flow.id, flowName: flow.name, iteration, verdict: parsed.verdict,
    summary: parsed.summary, exitCode: output.code, timedOut: output.timedOut,
    evidenceUrl: typeof parsed.final?.test_url === 'string' && parsed.final.test_url.startsWith('https://') ? parsed.final.test_url : null,
    evidenceHint, events: parsed.eventCount, runEnd: parsed.final,
    stdoutFile: path.basename(`${prefix}.ndjson`), stderrFile: path.basename(`${prefix}.stderr.log`),
    durationMs: output.durationMs
  };
  notify({ at: now(), kind: parsed.verdict === 'passed' ? 'kane_pass' : parsed.verdict === 'failed' ? 'kane_fail' : 'kane_infrastructure', title: `${flow.name}: ${parsed.verdict.toUpperCase().replaceAll('_', ' ')}`, detail: parsed.summary });
  return result;
}
