import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { RUNS, atomicJSON } from './common.mjs';
import {listArchivedReplays,getArchivedRun} from './replay-archive.mjs';
export async function persist(run) {
  const snapshot=structuredClone(run);
  await atomicJSON(path.join(RUNS, snapshot.id, 'record.json'), snapshot);
  // The Live loop view renders from saved run records, not separate exports.
}
export async function listRuns(limit = 60) {
  let dirs = [];
  try { dirs = (await readdir(RUNS, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort().reverse().slice(0, limit); }
  catch { /* A curated archived replay may still be available without runs/. */ }
  const result = await Promise.all(dirs.map(async (id) => {
    try { return JSON.parse(await readFile(path.join(RUNS, id, 'record.json'), 'utf8')); } catch { return getArchivedRun(id); }
  }));
  const merged=new Map(result.filter(Boolean).map(run=>[run.id,run]));
  for(const archived of await listArchivedReplays())if(!merged.has(archived.id))merged.set(archived.id,archived);
  return [...merged.values()].sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''))).slice(0,limit);
}
export async function getRun(id) {
  if (!/^[a-zA-Z0-9-]+$/.test(id)) return null;
  try { return JSON.parse(await readFile(path.join(RUNS, id, 'record.json'), 'utf8')); } catch { return getArchivedRun(id); }
}
