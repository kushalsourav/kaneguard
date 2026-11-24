/** Human disposition of a separate examiner's disputed Kane failure.
 * Approving a candidate is NOT passing it or replacing the sealed original.
 */
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {ROOT,RUNS,atomicJSON,now} from './common.mjs';
const runId=/^[a-zA-Z0-9-]{5,80}$/;
export async function decideTestDispute(id,index,decision,note,{root=ROOT}={}){
  if(!runId.test(id)||!Number.isSafeInteger(index)||index<0||index>200)
    throw new Error('Invalid dispute reference');
  if(!['approve_new_version','reject'].includes(decision)||typeof note!=='string'||note.trim().length<12||note.length>1000)
    throw new Error('Decision must include a reason (12–1000 characters)');
  const file=path.join(root,'runs',id,'record.json');
  let run;
  try{run=JSON.parse(await readFile(file,'utf8'));}catch{throw new Error('Original saved run not found; archived evidence is read-only');}
  if(run.id!==id||run.status==='running')throw new Error('Cannot review an active or mismatched run');
  const dispute=run.testDisputes?.[index];
  if(!dispute||dispute.decision!=='pending_human_review')throw new Error('Dispute is not pending review');
  if(decision==='approve_new_version' && (!dispute.proposedObjective||!dispute.proposedObjectiveHash))
    throw new Error('Examiner did not supply a valid candidate; cannot approve a test revision');
  dispute.decision=decision;dispute.decisionAt=now();dispute.decisionNote=note.trim();
  dispute.newObjectiveExecution='not_run';
  run.timeline=Array.isArray(run.timeline)?run.timeline:[];
  run.timeline.push({at:dispute.decisionAt,kind:'test_dispute_decision',
    title:decision==='approve_new_version'?'Proposed test revision approved for future verification':'Proposed test revision rejected',
    detail:`${note.trim()} Original Kane FAIL remains saved; no replacement test ran and no PASS was added.`});
  await atomicJSON(file,run);
  return {id,index,decision,originalVerdictUnchanged:true,newTestRan:false};
}
