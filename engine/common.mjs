import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile, rename, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const RUNS = path.join(ROOT, 'runs');
export const now = () => new Date().toISOString();
export const shortId = () => `${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 7)}`;
export const relative = (file) => path.relative(ROOT, file).replaceAll('\\', '/');
export async function exists(file) { try { await access(file); return true; } catch { return false; } }
export async function configFor(name) {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error('Invalid app ID');
  const config = JSON.parse(await readFile(path.join(ROOT, 'configs', `${name}.json`), 'utf8'));
  if (config.id !== name || !Array.isArray(config.flows) || !Array.isArray(config.editablePaths)) throw new Error('Invalid config');
  return config;
}
export async function atomicJSON(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2));
  await rename(temp, file);
}
// ---- Stop button support -------------------------------------------------
// Every agent / Kane CLI process runs in its own process group (POSIX) so a
// stop or timeout kills the whole tree: the coding agent's helpers and the
// browser Kane launched, not just the top-level CLI.
const activeChildren = new Set();
let stopRequested = false;
export class StopError extends Error { constructor() { super('Stopped by user'); this.name = 'StopError'; this.stopped = true; } }
export const isStopRequested = () => stopRequested;
export function resetStop() { stopRequested = false; }
export function killProcessTree(child, signal = 'SIGTERM') {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    try { spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch { try { child.kill(); } catch {} }
    return;
  }
  try { process.kill(-child.pid, signal); } catch { try { child.kill(signal); } catch {} }
}
/** Stop the active workflow: no new agent/Kane process may start, and every
 * running one (with its children) is terminated. Returns how many were running. */
export function requestStop() {
  stopRequested = true;
  const running = [...activeChildren];
  for (const child of running) {
    killProcessTree(child, 'SIGTERM');
    setTimeout(() => killProcessTree(child, 'SIGKILL'), 2500).unref();
  }
  return running.length;
}
/** Used on server shutdown: detached groups would otherwise outlive Ctrl+C. */
export function killAllChildren() { for (const child of activeChildren) killProcessTree(child, 'SIGKILL'); }

export function execProcess(command, args, { cwd = ROOT, timeoutMs = 120000, onOutput, env = process.env } = {}) {
  if (stopRequested) return Promise.reject(new StopError());
  return new Promise((resolve) => {
    const started = Date.now();
    let stdout = '', stderr = '', timedOut = false, spawnError = null, settled = false;
    const child = spawn(command, args, { cwd, env, shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    activeChildren.add(child);
    const limit = 4_000_000;
    const consume = (kind, buf) => {
      const string = String(buf);
      if (kind === 'stdout' && stdout.length < limit) stdout += string.slice(0, limit - stdout.length);
      if (kind === 'stderr' && stderr.length < limit) stderr += string.slice(0, limit - stderr.length);
      onOutput?.(kind, string);
    };
    child.stdout?.on('data', (chunk) => consume('stdout', chunk));
    child.stderr?.on('data', (chunk) => consume('stderr', chunk));
    child.on('error', (err) => { spawnError = err.message; activeChildren.delete(child); });
    const timer = setTimeout(() => { timedOut = true; killProcessTree(child, 'SIGTERM'); setTimeout(() => killProcessTree(child, 'SIGKILL'), 1500).unref(); }, timeoutMs);
    timer.unref();
    child.on('close', (code, signal) => {
      activeChildren.delete(child);
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr, timedOut, spawnError, stopped: stopRequested, durationMs: Date.now() - started });
    });
  });
}
export function formatError(e) { return e instanceof Error ? e.message : String(e); }
