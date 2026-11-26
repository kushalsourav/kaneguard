import {lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {ROOT, RUNS, atomicJSON} from './common.mjs';
import {trustReceiptHTML} from './receipt.mjs';
import {cinematicReplayHTML as replayHTML} from './cinematic-replay.mjs';
import {redactSecrets} from './live-logger.mjs';

const RUN_ID=/^[A-Za-z0-9-]{5,80}$/;
const EVIDENCE_FILE=/^(?!\.)(?!record\.json$)[A-Za-z0-9._-]+\.(?:txt|ndjson|log|json)$/;
const MAX_FILE_BYTES=6_000_000;
const MAX_ARCHIVE_BYTES=60_000_000;
const pending=new Map();

function archiveRoot(root){return path.join(root,'judge-replays');}
async function atomicText(file,content){
  const temp=`${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temp,content,'utf8');
  try{await rename(temp,file);}catch(error){await rm(temp,{force:true});throw error;}
}

/** On-disk replay lives inside the KaneGuard repository and is updated on each
 * saved workflow state. Exports are PRIVATE by default; publishing requires a
 * deliberate review because user prompts and logs may contain sensitive data.
 * Never follow symlinked evidence or traverse outside the recorded run folder.
 */
export async function exportRunReplay(run,{root=ROOT}={}){
  if(!run || !RUN_ID.test(run.id))throw new Error('Invalid replay run ID');
  const dest=path.join(archiveRoot(root),run.id),runDir=path.join(root,'runs',run.id);
  await mkdir(path.join(dest,'evidence'),{recursive:true});
  const files=[];const skipped=[];let bytes=0;
  let names=[];
  try{names=await readdir(runDir);}catch(error){if(error.code!=='ENOENT')throw error;}
  for(const name of names.sort()){
    if(!EVIDENCE_FILE.test(name))continue;
    const source=path.join(runDir,name),target=path.join(dest,'evidence',name);
    try{
      const info=await lstat(source);
      if(!info.isFile())continue;
      if(info.size>MAX_FILE_BYTES || bytes+info.size>MAX_ARCHIVE_BYTES){skipped.push({file:name,reason:'Size limit; inspect the original local run evidence'});continue;}
      bytes+=info.size;
      // Rewrite only changed evidence (or a missing target), keeping the archive
      // incremental during long coding-agent runs.
      let copy=true;
      try{
        const existing=await stat(target);
        copy=existing.size!==info.size || existing.mtimeMs<info.mtimeMs;
      }catch{}
      if(copy){const raw=await readFile(source,'utf8');await atomicText(target,redactSecrets(raw));}
      files.push(name);
    }catch(error){if(error.code!=='ENOENT')skipped.push({file:name,reason:'Unable to read this evidence file'});}
  }
  const safeRun=JSON.parse(redactSecrets(JSON.stringify(run)));
  await Promise.all([
    atomicText(path.join(dest,'index.html'),replayHTML(safeRun,{offline:true})),
    atomicText(path.join(dest,'receipt.html'),trustReceiptHTML(safeRun,{offline:true})),
    atomicJSON(path.join(dest,'record.json'),safeRun),
    atomicJSON(path.join(dest,'manifest.json'),{
      kind:'kaneguard-cinematic-replay',version:1,runId:run.id,projectId:run.projectId||null,
      status:run.status,generatedAt:new Date().toISOString(),files,skipped,
      privacy:'Local archive. Review prompts, artifacts, and all evidence for secrets before publishing.'
    })
  ]);
  return {runId:run.id,folder:dest,files:files.length,skipped:skipped.length};
}

/** Serialize updates for one run, without queuing unrelated runs behind it. */
export function queueReplayExport(run,{root=ROOT}={}){
  if(!run || !RUN_ID.test(run.id))return Promise.resolve(null);
  const key=`${root}:${run.id}`,snapshot=structuredClone(run);
  const chain=(pending.get(key)||Promise.resolve()).catch(()=>{}).then(()=>exportRunReplay(snapshot,{root}));
  pending.set(key,chain);
  void chain.finally(()=>{if(pending.get(key)===chain)pending.delete(key);}).catch(()=>{});
  return chain;
}

/** Backfill historical runs after startup, including runs created before v29. */
export async function backfillSavedReplays({root=ROOT}={}){
  let entries=[];try{entries=await readdir(path.join(root,'runs'),{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return {exported:0,failed:0};throw error;}
  let exported=0,failed=0;
  // Bounded batch avoids flooding the disk on repositories with long histories.
  const ids=entries.filter(e=>e.isDirectory()&&RUN_ID.test(e.name)).map(e=>e.name);
  for(let i=0;i<ids.length;i+=4){
    await Promise.all(ids.slice(i,i+4).map(async id=>{
      try{
        const run=JSON.parse(await readFile(path.join(root,'runs',id,'record.json'),'utf8'));
        if(run.id!==id){failed++;return;}
        await queueReplayExport(run,{root});exported++;
      }catch{failed++;}
    }));
  }
  return {exported,failed};
}

export async function deleteReplayArchive(id,{root=ROOT}={}){
  if(!RUN_ID.test(id))throw new Error('Invalid replay run ID');
  await rm(path.join(archiveRoot(root),id),{recursive:true,force:true});
}

/** Curated bundles can be committed without original runs or Kane credentials.
 * Only validated local records with matching manifest IDs are loaded. */
export async function getArchivedRun(id,{root=ROOT}={}){
  if(!RUN_ID.test(id))return null;
  const folder=path.join(archiveRoot(root),id);
  try{
    for(const filename of ['record.json','manifest.json']){
      const info=await lstat(path.join(folder,filename));if(!info.isFile())return null;
    }
    const [record,manifest]=await Promise.all([
      readFile(path.join(folder,'record.json'),'utf8').then(JSON.parse),
      readFile(path.join(folder,'manifest.json'),'utf8').then(JSON.parse)
    ]);
    if(record?.id!==id || manifest?.runId!==id || manifest?.kind!=='kaneguard-cinematic-replay')return null;
    return {...record,archivedOnly:true};
  }catch{return null;}
}
export async function listArchivedReplays({root=ROOT}={}){
  let entries=[];try{entries=await readdir(archiveRoot(root),{withFileTypes:true});}catch{return [];}
  const ids=entries.filter(e=>e.isDirectory()&&RUN_ID.test(e.name)).map(e=>e.name);
  const results=[];
  for(let i=0;i<ids.length;i+=8){
    const batch=await Promise.all(ids.slice(i,i+8).map(id=>getArchivedRun(id,{root})));
    results.push(...batch.filter(Boolean));
  }
  return results;
}
