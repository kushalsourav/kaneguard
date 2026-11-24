import { readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, atomicJSON } from './common.mjs';
import {deleteReplayArchive,getArchivedRun} from './replay-archive.mjs';

const PROJECT_ID = /^app-[a-z0-9-]{5,54}$/;
const RUN_ID = /^[a-zA-Z0-9-]{5,80}$/;

async function savedRuns(root) {
  let folders;
  try { folders = await readdir(path.join(root, 'runs'), { withFileTypes:true }); }
  catch (error) { if (error.code==='ENOENT') return []; throw error; }
  const entries = await Promise.all(folders.filter((e)=>e.isDirectory() && RUN_ID.test(e.name)).map(async (entry)=>{
    try {
      const record=JSON.parse(await readFile(path.join(root, 'runs', entry.name, 'record.json'), 'utf8'));
      return record?.id===entry.name ? record : null;
    } catch { return null; }
  }));
  return entries.filter(Boolean);
}

/** Only after the new server has acquired the listening port: a leftover
 * 'running' record cannot still be owned by that previous process. Never
 * claim success or remove browser evidence just to clear a stale spinner. */
export async function reconcileAbandonedRuns({root=ROOT, at=new Date().toISOString()}={}) {
  const affected=[];
  for (const run of await savedRuns(root)) {
    if (run.status!=='running') continue;
    run.status='interrupted';
    run.stage='finished';
    run.completedAt=at;
    run.activeGate=null;
    run.currentFlow=null;
    run.currentFlowId=null;
    run.interruptionReason='The previous KaneGuard server stopped before recording a terminal verdict.';
    run.timeline=Array.isArray(run.timeline)?run.timeline:[];
    run.timeline.push({at,kind:'interrupted',title:'Run interrupted by server restart',detail:'Existing source, browser results and evidence are preserved. This run was not verified.'});
    for (const task of run.tasks || []) if (task.status==='implementing' || task.status==='candidate') task.status='interrupted';
    await atomicJSON(path.join(root,'runs',run.id,'record.json'),run);
    affected.push(run.id);
  }
  return affected;
}

/** Delete one saved run and every evidence artifact under its run directory.
 * This does not delete the generated project. Caller must ensure idle engine. */
export async function deleteSavedRun(id,{root=ROOT}={}) {
  if (!RUN_ID.test(id)) throw new Error('Invalid run ID');
  const run=(await savedRuns(root)).find((r)=>r.id===id);
  if (!run){
    const archived=await getArchivedRun(id,{root});
    if(!archived)throw new Error('Build record not found');
    await deleteReplayArchive(id,{root});
    return {deletedRun:id,projectId:archived.projectId||null};
  }
  // A deleted evidence run can no longer back a protected regression claim.
  const {removeRegressionProofForRun}=await import('./regression-baseline.mjs');
  await removeRegressionProofForRun(run.appId,id,{root});
  await rm(path.join(root,'runs',id),{recursive:true,force:true});
  await deleteReplayArchive(id,{root});
  return {deletedRun:id,projectId:run.projectId || null};
}

/** Destructively delete ONLY an existing generated app, its config, and ALL
 * associated saved runs/evidence. Never delete CartLab, CoinPulse or engine
 * files. Caller must ensure no workflow is active before invoking. */
export async function deleteGeneratedProject(id,{root=ROOT}={}) {
  if (!PROJECT_ID.test(id)) throw new Error('Only generated projects can be deleted');
  const configPath=path.join(root,'configs',`${id}.json`);
  let config;
  try { config=JSON.parse(await readFile(configPath,'utf8')); }
  catch (error) { if(error.code==='ENOENT') throw new Error('Project not found'); throw new Error('Invalid project configuration'); }
  if(config.id!==id || config.kind!=='playground') throw new Error('Only generated projects can be deleted');
  const associated=(await savedRuns(root)).filter((r)=>r.projectId===id || r.appId===id);
  // Never follow paths from untrusted config or user input. Locations are
  // constructed exclusively from validated ids and known root directories.
  await rm(path.join(root,'public',id),{recursive:true,force:true});
  await rm(configPath,{force:true});
  await rm(path.join(root,'regression-baselines',`${id}.json`),{force:true});
  for(const run of associated){
    await rm(path.join(root,'runs',run.id),{recursive:true,force:true});
    await deleteReplayArchive(run.id,{root});
  }
  return {deletedProject:id,deletedRuns:associated.map((r)=>r.id)};
}
