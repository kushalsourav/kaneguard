import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execProcess, now } from './common.mjs';
import { createLineReader, compactEvent } from './live-logger.mjs';
import { detectKaneCapabilityBlock } from './kane-capabilities.mjs';

/** Kane's --timeout is an in-browser execution budget, not a wall-clock limit
 * for startup, remote Chrome, evidence upload and CLI shutdown. The watchdog
 * must leave sufficient grace to receive an actual terminal process result.
 */
export function kaneProcessTimeoutMs(timeoutSeconds = 120) {
  const seconds = Number.isFinite(Number(timeoutSeconds)) ? Math.max(30, Number(timeoutSeconds)) : 120;
  return Math.min(20 * 60_000, Math.max(5 * 60_000, seconds * 1000 + 180_000));
}

export function parseKaneNDJSON(data, processResult = {}) {
  const lines = String(data || '').split(/\r?\n/).filter(Boolean);
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
  const reported = String(last?.summary || last?.reason || '').trim();
  let summary = reported || (status === 'failed' ? 'Kane reported an objective failure' : 'Kane did not produce a final result');
  if (verdict === 'infrastructure_error') {
    const cause = processResult.timedOut
      ? 'Kane CLI exceeded the process watchdog'
      : processResult.spawnError
        ? `Kane CLI could not start: ${processResult.spawnError}`
        : !last
          ? 'Kane CLI exited without a final run_end event'
          : `Kane CLI finished with exit code ${processResult.code ?? 'null'}${processResult.signal ? ` (signal ${processResult.signal})` : ''}`;
    summary = `${cause}. ${status === 'passed' ? 'The browser reported PASS, but the interrupted/nonzero process cannot count as verified. ' : ''}${reported && status !== 'passed' ? reported : ''}`.trim();
  }
  return { verdict, status: status || null, summary, reportedSummary: reported || null,
    final: last, events, malformed, eventCount: events.length };
}

/** Trust only Kane's structured terminal verdict for a browser-agent misstep;
 * a failed assertion or an examiner's opinion alone is not sufficient.
 */
export function isKaneAutomationMisstep(result) {
  const verdict=result?.runEnd?.verdict;
  return result?.verdict==='failed' && result.runEnd?.status==='failed' &&
    verdict?.family==='automation_bug' && verdict?.category==='agent_misstep';
}

export async function runKane(config, flow, runDir, iteration, notify = () => {}, liveLog = () => {}, { runner = execProcess } = {}) {
  const browserTimeout = config.timeoutSeconds || 120;
  // KANEGUARD_KANE_HEADED=1 shows the real Chrome window Kane drives (useful
  // when recording a demo). Default stays headless.
  const headed = /^(1|true|yes)$/i.test(String(process.env.KANEGUARD_KANE_HEADED || ''));
  const args = ['run', flow.objective, '--url', config.url, '--agent', ...(headed ? [] : ['--headless']), '--timeout', String(browserTimeout), '--final-validation', 'on'];
  const startedAt = now();
  notify({ at: startedAt, kind: 'kane_start', title: `Kane verifying · ${flow.name}`, detail: `Attempt ${iteration + 1} · real browser run` });
  liveLog('KANE', `Starting ${flow.name} · browser timeout ${browserTimeout}s`);
  const ndjson = createLineReader((line) => {
    try { const message = compactEvent(JSON.parse(line)); if (message) liveLog('KANE', message); }
    catch { /* Raw unstructured data is preserved in the evidence file. */ }
  });
  const stderr = createLineReader((line) => { if (line.trim()) liveLog('KANE STDERR', line.slice(0, 500)); });
  const output = await runner(process.env.KANE_CLI_BIN || 'kane-cli', args, {
    timeoutMs: kaneProcessTimeoutMs(browserTimeout),
    onOutput(kind, chunk) { (kind === 'stdout' ? ndjson : stderr).write(chunk); }
  });
  ndjson.end(); stderr.end();
  const prefix = path.join(runDir, `kane-${flow.id}-${iteration}`);
  await Promise.all([writeFile(`${prefix}.ndjson`, output.stdout || ''), writeFile(`${prefix}.stderr.log`, output.stderr || '')]);
  const parsed = parseKaneNDJSON(output.stdout, output);
  const evidenceHint = String(output.stderr || '').match(/evidence:\s*view locally[^\r\n]*/i)?.[0] ?? null;
  const unavailableCapability = parsed.verdict === 'failed'
    ? detectKaneCapabilityBlock(flow.objective, parsed.summary) : null;
  const result = {
    unavailableCapability,
    flowId: flow.id, flowName: flow.name, iteration, verdict: parsed.verdict, startedAt, finishedAt:now(),
    summary: parsed.summary, reportedSummary:parsed.reportedSummary,
    exitCode: output.code, timedOut: output.timedOut,
    retryableInfrastructure: parsed.verdict === 'infrastructure_error' && !output.spawnError &&
      (Boolean(output.timedOut) || (parsed.status === 'passed' && output.code !== 0)),
    evidenceUrl: typeof parsed.final?.test_url === 'string' && parsed.final.test_url.startsWith('https://') ? parsed.final.test_url : null,
    evidenceHint, events: parsed.eventCount, runEnd: parsed.final,
    stdoutFile: path.basename(`${prefix}.ndjson`), stderrFile: path.basename(`${prefix}.stderr.log`),
    durationMs: output.durationMs
  };
  liveLog('KANE', `Finished ${flow.name} · ${parsed.verdict.toUpperCase()} · ${output.durationMs}ms · ${String(parsed.summary).slice(0, 350)}`);
  notify({ at: now(), kind: parsed.verdict === 'passed' ? 'kane_pass' : parsed.verdict === 'failed' ? 'kane_fail' : 'kane_infrastructure', title: `${flow.name}: ${parsed.verdict.toUpperCase().replaceAll('_', ' ')}`, detail: parsed.summary });
  return result;
}
