import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';

export const objectiveHash = (objective) => createHash('sha256').update(String(objective),'utf8').digest('hex');
export function sealedObjectives(acceptance=[]) {
  return acceptance.map(({id,objective,name})=>({id,name,objective,sha256:objectiveHash(objective)}));
}
export async function saveObjectiveSeal(runDir, acceptance) {
  const sealed = sealedObjectives(acceptance);
  await writeFile(path.join(runDir,'objective-seal.json'),JSON.stringify({algorithm:'sha256',sealedAt:new Date().toISOString(),objectives:sealed},null,2));
  return sealed;
}
export async function assertObjectiveUnchanged(runDir, flow, originalSeals) {
  if (!flow.generated) return null;
  const original = originalSeals.find((o)=>o.id === flow.acceptanceId);
  if (!original || objectiveHash(flow.objective)!==original.sha256 || original.objective!==flow.objective) throw new Error(`Objective modified after planning: ${flow.acceptanceId}`);
  const saved=JSON.parse(await readFile(path.join(runDir,'objective-seal.json'),'utf8'));
  const entry=saved.objectives?.find((o)=>o.id===flow.acceptanceId);
  if (!entry || entry.sha256!==original.sha256 || entry.objective!==original.objective || objectiveHash(entry.objective)!==entry.sha256) throw new Error(`Saved objective seal changed: ${flow.acceptanceId}`);
  return original.sha256;
}

// This is *only* a user-request decomposition heuristic. A free-form request
// without distinct bullets is not magically transformed into fully measured requirements.
export function requestClauses(request) {
  const lines=String(request||'').split(/\r?\n/).map((line)=>line.trim())
    .filter((line)=>/^(?:[-*•]|\d+[.)])\s+\S/.test(line))
    .map((line)=>line.replace(/^(?:[-*•]|\d+[.)])\s+/,'').trim())
    .filter((line)=>line.length>=12 && !/^task\s*\d+/i.test(line));
  return [...new Set(lines)].slice(0,40);
}
export function buildRequirementMatrix(run) {
  const tasks=run.tasks||[], checks=run.generatedFlows||[];
  const requirements=run.requirements || [];
  const checksById=new Map(checks.map(c=>[c.id,c]));
  const checkAttempts=new Map();
  for(const v of run.verification||[]) if(v.generated && v.flowId?.startsWith('feature-')) {
    const id=v.flowId.slice('feature-'.length);
    if(!checkAttempts.has(id))checkAttempts.set(id,[]);
    checkAttempts.get(id).push(v);
  }
  const rows=requirements.map((r)=>{
    const ids=r.acceptanceIds || [];
    const meaningful=ids.length>0 && ids.every(id=>checksById.has(id));
    const last=ids.map(id=>checkAttempts.get(id)?.at(-1)).filter(Boolean);
    const verified=run.status==='passed' && meaningful && ids.every(id => {
      const attempts=checkAttempts.get(id)||[];
      const passed=attempts.at(-1)?.verdict==='passed';
      const reused=(run.reusedVerification||[]).some(e=>e.flowId===`feature-${id}` && e.verdict==='passed' && e.sourceFingerprint);
      return passed||reused;
    });
    let status=verified?'proven': last.some(v=>v.unavailableCapability)?'unsupported':last.some(v=>v.verdict==='failed')?'failed':'unproven';
    if(!meaningful)status='unmapped';
    const repaired=verified && ids.some(id=> (checkAttempts.get(id)||[]).some(v=>v.verdict==='failed'));
    return {...r,status,repaired,latestEvidence:last.map(v=>({checkId:v.flowId,verdict:v.verdict,stdoutFile:v.stdoutFile,evidenceUrl:v.evidenceUrl})),checkNames:ids.map(id=>checksById.get(id)?.name).filter(Boolean)};
  });
  return {total:rows.length,proven:rows.filter(r=>r.status==='proven').length,repaired:rows.filter(r=>r.repaired).length,
    unproven:rows.filter(r=>r.status!=='proven').length,unmapped:rows.filter(r=>r.status==='unmapped').length,
    source: run.requirementsSource||'not supplied',taskCount:tasks.length,checkCount:checks.length,requirements:rows};
}
