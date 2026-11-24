import { appendFile } from 'node:fs/promises';
import path from 'node:path';
import { emitRunEvent } from './live-events.mjs';
import { kaneStepFromEvent, formatKaneStep, agentActionFromEvent, formatAgentAction } from './kane-trace.mjs';

/** Human-readable logging. Never print full environment variables or known credential formats. */
export function redactSecrets(value) {
  return String(value)
    .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{12,}|github_pat_[A-Za-z0-9_]{12,}|AIza[A-Za-z0-9_-]{20,})\b/g, '[REDACTED_KEY]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|secret|authorization)\s*[=:]\s*["']?)([^\s,"'}]+)/gi, '$1[REDACTED]');
}

export function createRunLogger(runDir, runId, { stdout = process.stdout } = {}) {
  const target = path.join(runDir, 'live.log');
  let chain = Promise.resolve();
  const log = (source, message) => {
    const msg = redactSecrets(message);
    for (const text of msg.split(/\r?\n/)) {
      if (!text.trim()) continue;
      const line = `[${new Date().toISOString()}] [${runId}] [${source}] ${text.slice(0, 1300).replace(/[\r\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')}\n`;
      stdout.write(line);
      emitRunEvent(runId, line.trimEnd());
      chain = chain.then(() => appendFile(target, line)).catch((error) => {
        process.stderr.write(`[KaneGuard] live log write failed: ${error.message}\n`);
      });
    }
  };
  return { log, file: target, flush: () => chain };
}

/** Convert arbitrary Buffer chunk boundaries to complete NDJSON / stderr lines. */
export function createLineReader(onLine) {
  let tail = '';
  return {
    write(chunk) {
      tail += String(chunk);
      const lines = tail.split(/\r?\n/);
      tail = lines.pop() ?? '';
      for (const line of lines) onLine(line);
      // Guard against a command emitting a long unbroken line.
      if (tail.length > 100_000) { onLine(tail.slice(0, 100_000)); tail = ''; }
    },
    end() { if (tail.trim()) onLine(tail); tail = ''; }
  };
}

export function compactEvent(event) {
  if (!event || typeof event !== 'object') return null;
  // Kane browser actions (click, assert, press_key…) arrive without a `type`.
  const kaneStep = kaneStepFromEvent(event);
  if (kaneStep) return kaneStep.status === 'running' ? null : formatKaneStep(kaneStep);
  // Coding-agent tool actions: what the agent is editing, reading or running.
  const action = agentActionFromEvent(event);
  if (action) return formatAgentAction(action);
  const type = event.type ?? event.event;
  if (!type) return null;
  if (type === 'step_update') return null; // bookkeeping turns without a visible action
  if (type === 'item.started' || type === 'item.completed' || type === 'assistant' || type === 'tool_call') return null;
  if (type === 'run_end' || type === 'result') {
    const result = event.result && typeof event.result === 'object' ? event.result : event;
    return `${type} · ${result.status ?? result.subtype ?? 'finished'} · ${String(result.summary ?? result.reason ?? result.response ?? '').slice(0, 320)}`;
  }
  const interesting = new Set(['run_start', 'step_start', 'step_end', 'run_error', 'error', 'init', 'tool_use', 'tool_result', 'test_start', 'test_end']);
  if (!interesting.has(type)) return null;
  return [type, event.status, event.message, event.name].filter(Boolean).join(' · ').slice(0, 390);
}
