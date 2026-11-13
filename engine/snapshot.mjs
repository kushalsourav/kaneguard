import { readdir, readFile, mkdir, writeFile, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { ROOT, relative, exists } from './common.mjs';

const trackedRoots = ['public', 'engine', 'server', 'configs', 'kane', 'tests', 'scripts', '.github'];
const trackedFiles = ['package.json', 'README.md', '.gitignore'];
async function walk(dir, found) {
  if (!(await exists(dir))) return;
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) await walk(full, found);
    else if (item.isFile()) found.push(full);
  }
}
export async function snapshot() {
  const files = trackedFiles.map((p) => path.join(ROOT, p));
  for (const name of trackedRoots) await walk(path.join(ROOT, name), files);
  const states = new Map();
  for (const file of files) if (await exists(file)) states.set(relative(file), await readFile(file));
  return states;
}
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
export async function reviewAndGuard(before, allowed) {
  const after = await snapshot();
  const all = new Set([...before.keys(), ...after.keys()]);
  const changed = [...all].filter((name) => sha(before.get(name) ?? Buffer.alloc(0)) !== sha(after.get(name) ?? Buffer.alloc(0)) || before.has(name) !== after.has(name));
  const unauthorized = changed.filter((name) => !allowed.includes(name));
  for (const name of unauthorized) {
    const file = path.join(ROOT, name);
    if (!before.has(name)) await unlink(file);
    else { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, before.get(name)); }
  }
  return { changed: changed.filter((p) => allowed.includes(p)), rejected: unauthorized };
}
export async function saveCheckpoint(before, dir) {
  const base = path.join(dir, 'checkpoint');
  for (const [name, bytes] of before) {
    const file = path.join(base, name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes);
  }
  return base;
}
export function summarizeDiff(before, after, changed) {
  let text = '';
  for (const file of changed) {
    const a = (before.get(file) ?? Buffer.alloc(0)).toString('utf8').split('\n');
    const b = (after.get(file) ?? Buffer.alloc(0)).toString('utf8').split('\n');
    text += `\n--- a/${file}\n+++ b/${file}\n`;
    // Compact change synopsis for dashboard; source snapshots remain available in checkpoint.
    let left = 0, right = 0;
    while (left < a.length || right < b.length) {
      if (a[left] === b[right]) { left++; right++; continue; }
      if (left < a.length) text += `- ${left + 1} ${a[left++]?.slice(0, 160)}\n`;
      if (right < b.length) text += `+ ${right + 1} ${b[right++]?.slice(0, 160)}\n`;
      if (text.length > 16000) return `${text.slice(0, 16000)}\n... truncated`;
    }
  }
  return text.trim();
}
