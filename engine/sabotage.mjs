import {cp,rm,writeFile,readFile,readdir,lstat} from 'node:fs/promises';
import path from 'node:path';
import {ROOT} from './common.mjs';
import {snapshot,reviewAndGuard,isPermittedSourceChange} from './snapshot.mjs';
import {invokeAgent} from './adapters.mjs';
import {runKane} from './kane.mjs';
import {objectiveHash} from './assurance.mjs';

/** Opt-in negative control. It is NOT a replacement for final app verification.
 * Works ONLY for an isolated generated app. All examiner edits outside the clone
 * are reverted using the existing project safety guard; the clone is removed.
 * The URL in the *same behavioral objective* must be rewritten to point at the
 * clone, so the adapted objective gets a separate hash and is disclosed as such.
 */
export async function runSabotageCheck({config,run,plan,runDir,examinerId,log=async()=>{},liveLog=()=>{}}) {
  if(config.kind!=='playground') return {status:'unproven',summary:'Negative control limited to generated apps. Connected source was not touched.'};
  const target=plan.acceptance[0];
  if(!target) return {status:'unproven',summary:'No original browser objective available.'};
  const cloneId=`app-negative-${run.id.toLowerCase().replace(/[^a-z0-9-]/g,'').slice(0,25)}`;
  const src=path.join(ROOT,'public',config.id), dst=path.join(ROOT,'public',cloneId);
  const cloneUrl=new URL(config.url);cloneUrl.pathname=`/${cloneId}/`;
  const adaptedObjective=target.objective.replaceAll(config.url,cloneUrl.toString());
  const destinations=[...adaptedObjective.matchAll(/https?:\/\/[^\s)\"']+/g)].map(match=>match[0]);
  if((adaptedObjective===target.objective && destinations.length) || adaptedObjective.includes(config.id) || destinations.some(value=>{try{return !new URL(value).pathname.startsWith(`/${cloneId}/`);}catch{return true;}}))
    return {status:'unproven',summary:'Some navigation targets cannot be safely redirected to the isolated clone. Original app was not tested or modified.'};
  const report={status:'unproven',summary:'Negative control did not produce usable evidence.',checkId:target.id,
    originalObjectiveHash:objectiveHash(target.objective),adaptedObjectiveHash:objectiveHash(adaptedObjective),
    adaptedUrl:cloneUrl.toString(),urlRewritten:adaptedObjective!==target.objective};
  try {
    // Reject symlinks before copying. A generated app is ordinarily three files.
    let totalFiles=0,totalBytes=0;
    async function safeTree(dir,depth=0) {
      if(depth>6)throw new Error('Source tree too deep for isolated negative control');
      for(const name of await readdir(dir)) {
        if(name.startsWith('.') || ['node_modules','tests','runs'].includes(name))throw new Error('Unsafe generated app content for mutation');
        const entry=await lstat(path.join(dir,name));
        if(entry.isSymbolicLink() || (!entry.isFile()&&!entry.isDirectory()))throw new Error('Generated app contains unsupported file types');
        if(entry.isDirectory())await safeTree(path.join(dir,name),depth+1);
        if(entry.isFile()) {totalFiles++;totalBytes+=entry.size;}
        if(entry.isFile()&&(entry.size>2_000_000||totalFiles>150||totalBytes>10_000_000))throw new Error('Generated source is too large for cloning');
      }
    }
    await safeTree(src);
    await cp(src,dst,{recursive:true,errorOnExist:true,force:false});
    const before=await snapshot({config});
    const cloneConfig={...config,id:cloneId,url:cloneUrl.toString(),agentId:examinerId,editablePaths:[],watchPaths:[`public/${cloneId}`]};
    // Baseline must pass on the unmodified clone before a negative-control
    // failure can be attributed to the examiner's targeted mutation.
    const cloneFlow={...target,id:`negative-baseline-${target.id}`,objective:adaptedObjective};
    const baseline=await runKane(cloneConfig,cloneFlow,runDir,0,()=>{},liveLog);
    report.baselineVerdict=baseline.verdict;
    report.baselineStdoutFile=baseline.stdoutFile;
    if(baseline.verdict!=='passed') {
      report.summary=`Unmodified clone did not pass Kane (${baseline.verdict}); negative control was not attempted and cannot count as proof.`;
      return report;
    }
    const prompt=`NEGATIVE CONTROL / MUTATION ONLY. This is a disposable CLONE, NOT the user's original project. You are the examiner. Work only in your CURRENT DIRECTORY public/${cloneId}. Introduce exactly ONE small and targeted app-behavior defect that should make the following browser objective fail, while keeping the page running. Do not modify anything outside this cloned folder. Do not touch tests, engine, run evidence, credentials, dependencies, configs or the source project. Do not run npm, Kane CLI or shell commands. Your target original check is (data): ${JSON.stringify(target.name)}; objective: ${JSON.stringify(adaptedObjective)}. Explain exactly what you altered.`;
    await writeFile(path.join(runDir,'negative-control-instruction.txt'),prompt);
    const output=await invokeAgent(cloneConfig,prompt,'NEGATIVE CONTROL',liveLog,{timeoutMs:3*60_000});
    await writeFile(path.join(runDir,'negative-control-agent.ndjson'),output.stdout||'');
    await writeFile(path.join(runDir,'negative-control-agent.stderr.log'),output.stderr||'');
    const guard=await reviewAndGuard(before,[`public/${cloneId}/**`],{config});
    const sourceEdits=guard.changed.filter(f=>isPermittedSourceChange(f,[`public/${cloneId}/**`]));
    if(guard.rejected.length) {
      report.summary=`Examiner edited protected files; all non-clone changes reverted (${guard.rejected.join(', ').slice(0,350)}). No trust verdict.`;
      return report;
    }
    if(!output.decoded.ok || !sourceEdits.length) {
      report.summary='Examiner did not complete a verified clone-only source mutation; no negative check executed.';
      return report;
    }
    report.mutatedFiles=sourceEdits;
    // Only the clone is the URL under test. An adapted objective is honestly
    // fingerprinted separately: it is never represented as byte-identical.
    const flow={...target,id:`negative-${target.id}`,objective:adaptedObjective};
    const result=await runKane(cloneConfig,flow,runDir,0,()=>{},liveLog);
    report.verdict=result.verdict;report.stdoutFile=result.stdoutFile;report.stderrFile=result.stderrFile;
    report.status=result.verdict==='failed'&&!result.unavailableCapability?'proven':result.verdict==='passed'?'weak':'unproven';
    report.summary=report.status==='proven'?'Kane independently detected failure after an examiner mutation in a disposable clone. The target URL was adapted and separately hashed; original app was never the negative-control target.':
      report.status==='weak'?'Kane passed despite the changed clone; the check may be insensitive to this mutation.':'Kane did not produce a conclusive behavioral negative-control verdict.';
    return report;
  } catch(error) {
    report.summary=`Negative control inconclusive: ${String(error.message||error).slice(0,380)}`;
    return report;
  } finally {
    await rm(dst,{recursive:true,force:true}).catch(()=>{});
  }
}
