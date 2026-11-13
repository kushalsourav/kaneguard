import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { RUNS, atomicJSON } from './common.mjs';
export async function persist(run) {
  await atomicJSON(path.join(RUNS, run.id, 'record.json'), run);
}
export async function listRuns(limit = 60) {
  let dirs = [];
  try { dirs = (await readdir(RUNS, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort().reverse().slice(0, limit); }
  catch { return []; }
  const result = await Promise.all(dirs.map(async (id) => {
    try { return JSON.parse(await readFile(path.join(RUNS, id, 'record.json'), 'utf8')); } catch { return null; }
  }));
  return result.filter(Boolean).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export async function getRun(id) {
  if (!/^[a-zA-Z0-9-]+$/.test(id)) return null;
  try { return JSON.parse(await readFile(path.join(RUNS, id, 'record.json'), 'utf8')); } catch { return null; }
}
