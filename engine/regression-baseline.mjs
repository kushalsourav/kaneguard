/** Persist genuinely verified browser objectives between builds of the SAME project.
 * These are regression candidates, not requirements coverage or Kane-native assurance.
 * A subsequent build MUST execute each candidate against its current source.
 */
import path from 'node:path';
import {readFile, mkdir} from 'node:fs/promises';
import {ROOT, atomicJSON} from './common.mjs';
import {objectiveHash} from './assurance.mjs';

const safeProjectId=/^[a-z0-9-]+$/;
const SHA=/^[a-f0-9]{64}$/;
const baselinesDir=(root)=>path.join(root,'regression-baselines');
const baselinePath=(root,id)=>{
  if(!safeProjectId.test(id))throw new Error('Unsafe project ID for regression baseline');
  return path.join(baselinesDir(root),`${id}.json`);
};
const originOf=(url)=>new URL(url).origin;
export function inspectRegressionEntry(entry,config){
  if(!entry || typeof entry.name!=='string' || !entry.name.trim() || entry.name.length>300 ||
    typeof entry.objective!=='string' || entry.objective.length<90 || entry.objective.length>1700 ||
    !SHA.test(entry.sha256||'') || objectiveHash(entry.objective)!==entry.sha256 ||
    !safeProjectId.test(entry.originRunId||'') || (entry.sourceFingerprint && !SHA.test(entry.sourceFingerprint))) throw new Error('Invalid or tampered regression baseline entry');
  const trustedOrigin=originOf(config.url);
  for(const hit of entry.objective.matchAll(/https?:\/\/[^\s)"']+/g)) {
    let target;try{target=new URL(hit[0]);}catch{throw new Error('Invalid URL in saved regression baseline');}
    if(target.origin!==trustedOrigin)throw new Error('Saved regression objective targets a different server; review and rebuild baseline');
  }
  return {id:`reg-${entry.sha256.slice(0,18)}`,name:entry.name,objective:entry.objective,
    generated:false,protectedRegression:true,originRunId:entry.originRunId,sha256:entry.sha256};
}
export async function loadRegressionBaseline(config,{root=ROOT}={}){
  let data;
  try{data=JSON.parse(await readFile(baselinePath(root,config.id),'utf8'));}
  catch(e){if(e.code==='ENOENT')return {entries:[],flows:[],revision:0};throw e;}
  if(data?.projectId!==config.id||data.version!==1||!Array.isArray(data.entries)||data.entries.length>128)
    throw new Error('Invalid saved regression baseline format');
  const flows=data.entries.map(entry=>inspectRegressionEntry(entry,config));
  if(new Set(flows.map(f=>f.id)).size!==flows.length)throw new Error('Duplicate regression baseline objectives');
  return {entries:data.entries,flows,revision:data.revision||1};
}
/** Only call AFTER the final suite passed. Historical run data is not automatically
 * promoted on install or import, because older results may be stale. */
export async function saveRegressionBaseline(config,run,{root=ROOT,maxEntries=48}={}){
  if(run.status!=='passed'||!Array.isArray(run.generatedFlows))throw new Error('Cannot promote unverified feature objectives');
  const previous=await loadRegressionBaseline(config,{root});
  const next=[...previous.entries];let added=0,skipped=0;
  const existing=new Set(next.map(v=>v.sha256));
  const verified=new Set((run.verification||[]).filter(v=>v.generated && v.verdict==='passed' && v.objectiveHashVerified).map(v=>v.flowId));
  const reused=new Set((run.reusedVerification||[]).filter(v=>v.gate==='Final full suite' && v.verdict==='passed' && v.sourceFingerprint).map(v=>v.flowId));
  for(const flow of run.generatedFlows){
    const hash=objectiveHash(flow.objective),id=`feature-${flow.id}`;
    if(existing.has(hash))continue;
    if(!verified.has(id)&&!reused.has(id))continue; // No real evidence: cannot promote.
    if(next.length>=maxEntries){skipped++;continue;}
    next.push({name:flow.name,objective:flow.objective,sha256:hash,originRunId:run.id,sourceFingerprint:run.verifiedSourceFingerprint||null,recordedAt:run.completedAt||new Date().toISOString()});
    existing.add(hash);added++;
  }
  await mkdir(baselinesDir(root),{recursive:true});
  await atomicJSON(baselinePath(root,config.id),{version:1,projectId:config.id,revision:previous.revision+1,entries:next});
  return {count:next.length,added,skipped,revision:previous.revision+1};
}

/** When the original supporting run is intentionally deleted, retire its
 * objectives rather than leaving a seemingly protected check with no proof. */
export async function removeRegressionProofForRun(projectId,runId,{root=ROOT}={}){
  if(!safeProjectId.test(projectId||'')||!safeProjectId.test(runId||''))return 0;
  const file=baselinePath(root,projectId);
  let data;try{data=JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')return 0;throw error;}
  if(data?.projectId!==projectId||data.version!==1||!Array.isArray(data.entries))throw new Error('Invalid regression baseline; refusing to delete supporting evidence');
  const retained=data.entries.filter(entry=>entry.originRunId!==runId);
  if(retained.length===data.entries.length)return 0;
  await atomicJSON(file,{...data,revision:Number(data.revision||0)+1,entries:retained});
  return data.entries.length-retained.length;
}
