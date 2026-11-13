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
export function execProcess(command, args, { cwd = ROOT, timeoutMs = 120000, onOutput, env = process.env } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    let stdout = '', stderr = '', timedOut = false, spawnError = null, settled = false;
    const child = spawn(command, args, { cwd, env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const limit = 4_000_000;
    const consume = (kind, buf) => {
      const string = String(buf);
      if (kind === 'stdout' && stdout.length < limit) stdout += string.slice(0, limit - stdout.length);
      if (kind === 'stderr' && stderr.length < limit) stderr += string.slice(0, limit - stderr.length);
      onOutput?.(kind, string);
    };
    child.stdout?.on('data', (chunk) => consume('stdout', chunk));
    child.stderr?.on('data', (chunk) => consume('stderr', chunk));
    child.on('error', (err) => { spawnError = err.message; });
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); setTimeout(() => child.kill('SIGKILL'), 1500).unref(); }, timeoutMs);
    timer.unref();
    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr, timedOut, spawnError, durationMs: Date.now() - started });
    });
  });
}
export function formatError(e) { return e instanceof Error ? e.message : String(e); }
