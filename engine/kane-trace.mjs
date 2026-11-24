/** Turns raw, saved Kane CLI and coding-agent output into readable, structured
 * traces for the UI. Pure parsing only: nothing here creates or upgrades a
 * verdict. A Kane step is shown exactly as Kane reported it.
 */
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const clip = (v, n = 240) => { const s = String(v ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
const base = (p) => String(p || '').split(/[\\/]/).filter(Boolean).pop() || '';
const safeFile = (v) => typeof v === 'string' && /^[A-Za-z0-9._-]+$/.test(v) && !v.startsWith('.');

/** Kane's agent-mode step lines look like {step, status, remark} with no `type`.
 * "running" placeholders ("Step 4") carry no information and are skipped. */
export function kaneStepFromEvent(event) {
  if (!event || typeof event !== 'object' || event.type || !Number.isFinite(Number(event.step))) return null;
  const status = String(event.status || '').toLowerCase();
  const remark = String(event.remark || '').trim();
  if (!remark || /^step\s+\d+$/i.test(remark)) return null;
  const m = remark.match(/^([a-z][a-z_]{1,24}):\s*([\s\S]*)$/);
  const action = m ? m[1] : 'step';
  const text = (m ? m[2] : remark).replace(/^PRIMARY:\s*/, '');
  return { step: Number(event.step), status: status === 'failed' ? 'failed' : status === 'done' ? 'done' : 'running',
    action, text: clip(text, 260), at: event.ts || null };
}

export function formatKaneStep(step) {
  const mark = step.status === 'failed' ? '✕' : step.status === 'done' ? '✓' : '…';
  return `step ${step.step} ${mark} ${step.action} — ${step.text}`;
}

/** Inverse of formatKaneStep, used by the browser UI to read the live stream. */
export function parseKaneStepLine(text) {
  const m = String(text || '').match(/^step (\d+) ([✓✕…]) ([a-z_]+) — (.*)$/);
  if (!m) return null;
  return { step: Number(m[1]), status: m[2] === '✕' ? 'failed' : m[2] === '✓' ? 'done' : 'running', action: m[3], text: m[4] };
}

/** One readable line per coding-agent tool action, across the four adapters'
 * stream formats (Antigravity step_update, Codex items, Claude/Cursor stream-json). */
export function agentActionFromEvent(event) {
  if (!event || typeof event !== 'object') return null;
  // Antigravity
  const su = event.step_update;
  if (event.event === 'step_update' && su) {
    if (su.step_type === 'tool' && su.state === 'ACTIVE') {
      const p = su.tool_info?.parameters || {};
      return toolAction(su.tool_name || su.tool_info?.name, p);
    }
    return null; // text_delta arrives in tiny streaming fragments; not useful as an action
  }
  // Codex
  if (event.item && (event.type === 'item.started' || event.type === 'item.completed')) {
    const it = event.item;
    if (it.type === 'command_execution' && event.type === 'item.started') return { kind: 'run', text: clip(String(it.command || '').replace(/^\/bin\/(?:ba)?sh -lc\s*/, '').replace(/^"|"$/g, ''), 140) };
    if (it.type === 'file_change' && event.type === 'item.completed') {
      const files = (it.changes || []).map((c) => base(c.path)).filter(Boolean);
      return { kind: 'edit', text: files.join(', ') || 'source files' };
    }
    if (it.type === 'agent_message' && event.type === 'item.completed') return { kind: 'note', text: clip(it.text, 200) };
    return null;
  }
  // Claude Code stream-json
  if (event.type === 'assistant' && Array.isArray(event.message?.content)) {
    for (const part of event.message.content) {
      if (part.type === 'tool_use') return toolAction(part.name, part.input || {});
    }
    const text = event.message.content.find((p) => p.type === 'text')?.text;
    return text ? { kind: 'note', text: clip(text, 200) } : null;
  }
  // Cursor stream-json
  if (event.type === 'tool_call' && event.subtype === 'started' && event.tool_call) {
    const [name, call] = Object.entries(event.tool_call)[0] || [];
    return toolAction(String(name || '').replace(/ToolCall$/, ''), call?.args || {});
  }
  return null;
}

function toolAction(name, p) {
  const n = String(name || '').toLowerCase();
  const file = base(p.TargetFile || p.AbsolutePath || p.Path || p.file_path || p.path || p.filePath || p.target_file || p.File || '');
  if (/update_steps|todo|task_list/.test(n)) return null;
  if (/write|edit|replace|create|sed_file|multi_replace|str_replace|notebook_edit|^delete/.test(n)) return { kind: 'edit', text: file || n };
  if (/view|read|grep|find|list|search|glob|ls/.test(n)) return { kind: 'read', text: file || clip(p.Query || p.pattern || p.SearchPath || n, 80) };
  if (/command|bash|shell|terminal|run/.test(n)) return { kind: 'run', text: clip(p.CommandLine || p.command || p.cmd || n, 140) };
  if (/browser|screenshot|open_browser/.test(n)) return { kind: 'browse', text: clip(n.replaceAll('_', ' '), 60) };
  return { kind: 'tool', text: clip(n.replaceAll('_', ' '), 60) };
}

export function formatAgentAction(action) { return `▸ ${action.kind} ${action.text}`; }
export function parseAgentActionLine(text) {
  const m = String(text || '').match(/^▸ (edit|read|run|browse|tool|note) (.*)$/);
  return m ? { kind: m[1], text: m[2] } : null;
}

/** Structured view of one saved Kane NDJSON transcript. */
export function parseKaneTrace(ndjson) {
  const steps = []; let end = null; let objective = null;
  for (const line of String(ndjson || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    let e; try { e = JSON.parse(line); } catch { continue; }
    if (e.type === 'run_end') end = e;
    if (e.type === 'bifurcation' && Array.isArray(e.flows)) objective = clip(e.flows[0], 600);
    const s = kaneStepFromEvent(e);
    if (s) {
      // Kane emits running then done/failed for the same step; keep the final state.
      const prior = steps.findIndex((x) => x.step === s.step);
      if (prior >= 0) steps[prior] = s; else steps.push(s);
    }
  }
  const status = String(end?.status || '').toLowerCase() || null;
  return {
    status, steps,
    oneLiner: end?.one_liner ? clip(end.one_liner, 260) : null,
    reason: end?.reason && end.reason !== 'Objective completed' ? clip(end.reason, 400) : null,
    summary: end?.summary ? clip(end.summary, 900) : null,
    durationSec: Number.isFinite(Number(end?.duration)) ? Number(end.duration) : null,
    testUrl: typeof end?.test_url === 'string' && end.test_url.startsWith('https://') ? end.test_url : null,
    verdictFamily: end?.verdict?.family || null,
    objective
  };
}

/** Unified diff → per-file line counts plus a short excerpt of the change. */
export function diffStat(text, { excerptLines = 26 } = {}) {
  const files = []; let cur = null; const excerpt = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    if (line.startsWith('+++ ')) { cur = { path: base(line.slice(4).replace(/^b\//, '')), added: 0, removed: 0 }; if (cur.path && cur.path !== 'null') files.push(cur); continue; }
    if (line.startsWith('--- ') || line.startsWith('diff ') || line.startsWith('index ')) continue;
    if (!cur) continue;
    if (line.startsWith('@@')) { if (excerpt.length < excerptLines) excerpt.push({ kind: 'hunk', text: clip(line, 90) }); continue; }
    if (line.startsWith('+')) { cur.added++; if (excerpt.length < excerptLines) excerpt.push({ kind: 'add', text: line.slice(1, 160) }); }
    else if (line.startsWith('-')) { cur.removed++; if (excerpt.length < excerptLines) excerpt.push({ kind: 'del', text: line.slice(1, 160) }); }
  }
  return { files, added: files.reduce((a, f) => a + f.added, 0), removed: files.reduce((a, f) => a + f.removed, 0), excerpt };
}

async function readMaybe(dir, file, max = 600_000) {
  if (!safeFile(file)) return null;
  try { const t = await readFile(path.join(dir, file), 'utf8'); return t.length > max ? t.slice(0, max) : t; } catch { return null; }
}

/** Load every saved trace a run view needs. Missing files are simply absent. */
export async function loadRunTraces(runDir, run) {
  const kane = {}; const diffs = {}; const diagnoses = {};
  for (const v of Array.isArray(run?.verification) ? run.verification : []) {
    if (!safeFile(v.stdoutFile) || kane[v.stdoutFile]) continue;
    const t = await readMaybe(runDir, v.stdoutFile);
    if (t != null) kane[v.stdoutFile] = parseKaneTrace(t);
  }
  for (const task of Array.isArray(run?.tasks) ? run.tasks : []) {
    if (!/^[\w-]{1,60}$/.test(String(task.id || ''))) continue;
    const t = await readMaybe(runDir, `feature-task-${task.id}-diff.txt`);
    if (t) diffs[task.id] = diffStat(t);
  }
  const repairs = Array.isArray(run?.repairs) ? run.repairs : [];
  for (let i = 1; i <= Math.max(repairs.length, 0) + 1 && i <= 12; i++) {
    const d = await readMaybe(runDir, `source-diff-${i}.txt`);
    if (d) diffs[`repair-${i}`] = diffStat(d);
    const plan = await readMaybe(runDir, `diagnosis-${i}-plan.json`, 60_000);
    if (plan) { try { const p = JSON.parse(plan); diagnoses[i] = { diagnosis: clip(p.diagnosis, 900), confidence: p.confidence || null, targetFiles: (p.targetFiles || []).map(base).slice(0, 8) }; } catch { /* malformed plan stays unshown */ } }
  }
  // Every coding-agent session (plan, each task, each diagnosis and repair) in the order it ran.
  const files = [['Plan', 'feature-plan-agent.ndjson'], ['Plan revision', 'feature-plan-revision-agent.ndjson']];
  for (const t of Array.isArray(run?.tasks) ? run.tasks : []) if (/^[\w-]{1,60}$/.test(String(t.id || ''))) files.push([`${t.id}: ${clip(t.title || '', 70)}`, `feature-task-${t.id}-agent.ndjson`]);
  for (let i = 1; i <= Math.min(repairs.length + 1, 12); i++) files.push([`Diagnosis #${i}`, `diagnosis-${i}-agent.ndjson`], [`Repair #${i}`, `agent-${i}.ndjson`]);
  const agentSections = [];
  for (const [label, file] of files) {
    const t = await readMaybe(runDir, file);
    if (!t) continue;
    let at = 0; try { at = (await stat(path.join(runDir, file))).mtimeMs; } catch { /* keep plan order */ }
    const actions = [];
    for (const line of t.split(/\r?\n/)) {
      let e; try { e = JSON.parse(line); } catch { continue; }
      const a = agentActionFromEvent(e);
      if (a) actions.push(a);
      const final = e.event === 'result' ? e.result?.response : e.type === 'result' && typeof e.result === 'string' ? e.result : null;
      if (final) {
        const text = String(final).trim();
        // A planner returns its plan as JSON: show a readable line, not the raw object.
        const note = /^(```|\{)/.test(text) ? 'Returned the structured plan (tasks + Kane objectives)' : clip(text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\*\*|`/g, ''), 320);
        actions.push({ kind: 'note', text: note });
      }
    }
    if (actions.length) agentSections.push({ label, file, at, actions: actions.slice(-300) });
  }
  agentSections.sort((x, y) => x.at - y.at);
  const agent = [...agentSections].reverse().find((x) => x.actions.some((a) => a.kind === 'edit')) || agentSections.at(-1) || null;
  return { kane, diffs, diagnoses, agent, agentSections };
}
