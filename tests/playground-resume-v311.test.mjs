import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,cp,rm} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import os from 'node:os';
import path from 'node:path';
import {ROOT} from '../engine/common.mjs';

test('v31.1 stopped generated apps can resume their original saved plan without weakening origin security',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'kg-v311-playground-resume-'));
  const id='app-v311-resume',runId='20261123105459-v311x';
  try{
    await cp(path.join(ROOT,'engine'),path.join(root,'engine'),{recursive:true});
    for(const folder of ['configs','runs',`runs/${runId}`,`public/${id}`])
      await mkdir(path.join(root,folder),{recursive:true});
    await writeFile(path.join(root,'package.json'),JSON.stringify({type:'module'}));
    await writeFile(path.join(root,`public/${id}/index.html`),'<h1>Test app, not real Kane proof</h1>');
    const url=`http://127.0.0.1:4173/${id}/`;
    const config={id,label:'Resume test',kind:'playground',url,editablePaths:[`public/${id}/index.html`],watchPaths:[`public/${id}`],flows:[],maxRepairs:2};
    await writeFile(path.join(root,'configs',`${id}.json`),JSON.stringify(config));
    const plan={featureTitle:'Saved demo project',summary:'Create and verify two separate browser flows on an existing generated app.',
      tasks:[{id:'task-1',title:'First interaction',detail:'Implement a visible dashboard action in the generated app.',acceptanceIds:['check-1']},
        {id:'task-2',title:'Second interaction',detail:'Implement a separate searchable list in the generated app.',dependsOn:['task-1'],acceptanceIds:['check-2']}],
      acceptance:[{id:'check-1',name:'First check',objective:`Navigate to ${url} and click the demo button. Verify the browser displays the expected first result after the action, and the title remains visible.`},
        {id:'check-2',name:'Second check',objective:`Navigate to ${url} and enter an issue title in search. Verify the page displays only the matching result after filtering, and clear search to show all results.`}]};
    const planFile=path.join(root,'runs',runId,'feature-plan.json');
    await writeFile(planFile,JSON.stringify(plan));
    const prior={id:runId,mode:'build',status:'verification_inconclusive',appId:id,
      request:'Build a generated demo app with two interactive features',artifacts:{featurePlan:'feature-plan.json'},changedFiles:[`public/${id}/index.html`]};
    await writeFile(path.join(root,'runs',runId,'record.json'),JSON.stringify(prior));
    const {inspectResumableFeature}=await import(pathToFileURL(path.join(root,'engine','feature.mjs')).href);
    const ready=await inspectResumableFeature(runId);
    assert.equal(ready.prior.appId,id);
    assert.deepEqual(ready.plan.acceptance.map(x=>x.objective),plan.acceptance.map(x=>x.objective));
    const original=await readFile(planFile,'utf8');
    assert.deepEqual(JSON.parse(original),plan,'Recovery inspection must never change the saved plan');
    const tampered={...plan,acceptance:[{...plan.acceptance[0],objective:plan.acceptance[0].objective.replace('127.0.0.1:4173','127.0.0.1:9999')},plan.acceptance[1]]};
    await writeFile(planFile,JSON.stringify(tampered));
    await assert.rejects(inspectResumableFeature(runId),/external origin/);
  }finally{await rm(root,{recursive:true,force:true});}
});
