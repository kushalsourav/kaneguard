import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { projectSourceVersion } from '../engine/project-source-version.mjs';
import { renderCheckJourney, renderAllVerificationJourneys, flowAttempts } from '../public/control/verification-history.mjs';

const app='app-demo-v18cafe';
const item={flowId:'feature-check-2',flowName:'Featured drinks filtering',gate:'After task-2: Featured drinks',taskId:'task-2'};
const run={
  verification:[
    {...item, verdict:'failed', summary:'Iced tab received click but left All selected; every drink stayed visible',stdoutFile:'kane-fail.ndjson',finishedAt:'2026-11-17T08:44:52Z'},
    {...item, verdict:'passed', summary:'Iced filter now hides Hot drinks; order count changes from zero to one',stdoutFile:'kane-pass.ndjson',finishedAt:'2026-11-17T08:50:06Z'}
  ],
  plans:[{attempt:1,gate:item.gate,plan:{action:'repair',diagnosis:'Filtering tabs have no event listeners and the order counter is not wired'},stdoutFile:'diagnosis-1-agent.ndjson',planFile:'diagnosis-1-plan.json'}],
  repairs:[{attempt:1,gate:item.gate,changedFiles:['public/app-demo-v18cafe/app.js'],outFile:'repair-1-agent.ndjson'}],
  reusedVerification:[],timeline:[]
};

test('source version detects CSS, HTML and JS edits before the agent completes a task',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'kaneguard-live-v18-'));
  const project=path.join(root,'public',app);
  try{
    await mkdir(project,{recursive:true});
    await mkdir(path.join(root,'configs'));
    await writeFile(path.join(root,'configs',`${app}.json`),JSON.stringify({id:app,kind:'playground'}));
    await writeFile(path.join(project,'index.html'),'<h1>Loading</h1>');
    await writeFile(path.join(project,'style.css'),'body{color:red}');
    await writeFile(path.join(project,'app.js'),'window.ok=true');
    const v1=await projectSourceVersion(app,{root});
    await writeFile(path.join(project,'index.html'),'<h1>Created</h1>');
    const v2=await projectSourceVersion(app,{root});
    assert.notEqual(v1.version,v2.version,'equal-length HTML rewrite must refresh preview');
    await writeFile(path.join(project,'app.js'),'window.ok=false');
    const v3=await projectSourceVersion(app,{root});
    assert.notEqual(v2.version,v3.version);
    await writeFile(path.join(project,'style.css'),'body{color:blue}');
    const v4=await projectSourceVersion(app,{root});
    assert.notEqual(v3.version,v4.version);
    await writeFile(path.join(project,'notes.md'),'no preview changes');
    assert.equal((await projectSourceVersion(app,{root})).version,v4.version);
    const secret=path.join(root,'secret.js');await writeFile(secret,'TOP SECRET');
    await symlink(secret,path.join(project,'out-of-project.js'));
    assert.equal((await projectSourceVersion(app,{root})).version,v4.version,'symlinks must never be read');
    await assert.rejects(projectSourceVersion('../secret',{root}),/Invalid project ID/);
    assert.equal(v1.files,3);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('a saved Kane FAIL remains visible after diagnosis, real repair and later Kane PASS',()=>{
  const out=renderCheckJourney(run,flowAttempts(run,item.flowId,item.gate),(file)=>`/api/evidence/run-123/${file}`);
  assert.match(out,/<details[^>]*open/,'a failure history should be expanded by default');
  const labels=['Kane FAIL','Iced tab received click','Agent diagnosis #1','Filtering tabs have no event listeners',
    'Agent repair #1','source-diff-1.txt','Kane PASS','Iced filter now hides Hot'];
  for(const label of labels)assert.ok(out.includes(label),`lost evidence: ${label}`);
  assert.ok(out.indexOf('Kane FAIL')<out.indexOf('Agent diagnosis #1'));
  assert.ok(out.indexOf('Agent diagnosis #1')<out.indexOf('Agent repair #1'));
  assert.ok(out.indexOf('Agent repair #1')<out.indexOf('Kane PASS'));
  assert.match(out,/kane-fail\.ndjson/);
  assert.match(out,/kane-pass\.ndjson/);
  // The browser renders event times in the viewer's locale/timezone.
  // Do not assume UTC or a particular clock (12h vs 24h).
  const stamps = [...out.matchAll(/<time>([^<]+)<\/time>/g)].map((match) => match[1]);
  assert.equal(stamps.length, 2, 'both Kane attempts must retain a visible timestamp');
  assert.ok(stamps.every(Boolean), 'neither timestamp may be empty');
  assert.notEqual(stamps[0], stamps[1], 'the failure and retry have different event times');
});

test('full Kane history keeps failed runs, infrastructure retries and reused PASS references without falsification',()=>{
  const variant=structuredClone(run);
  variant.verification.push({flowId:'portfolio-safety',flowName:'Portfolio safety',gate:'Final full suite',verdict:'infrastructure_error',summary:'Chrome did not start',stdoutFile:'infra.ndjson'});
  variant.reusedVerification.push({flowId:'feature-check-2',flowName:'Featured drinks filtering',gate:'Final full suite',stdoutFile:'kane-pass.ndjson',verdict:'passed',reused:true});
  const text=renderAllVerificationJourneys(variant,(name)=>`/api/evidence/safe-run/${name}`);
  for(const value of ['Kane FAIL','Agent diagnosis','Agent repair','Kane PASS','Kane infrastructure error','Chrome did not start','Reused original Kane PASS','NOT a new browser run'])assert.match(text,new RegExp(value));
  assert.equal((text.match(/Kane FAIL/g)||[]).length,1);
});

test('studio monitors exact source bytes, preserves expanded history, and never treats task completion as a browser PASS',async()=>{
  const [js,html,css,server]=await Promise.all([
    readFile(new URL('../public/control/studio.mjs',import.meta.url),'utf8'),
    readFile(new URL('../public/control/index.html',import.meta.url),'utf8'),
    readFile(new URL('../public/assets/create-studio.css',import.meta.url),'utf8'),
    readFile(new URL('../server/main.mjs',import.meta.url),'utf8')
  ]);
  assert.match(js,/pollPreviewSource\(run\)/);
  assert.match(js,/data\.version===previewVersion/);
  assert.match(js,/replaceKeepingHistory\('taskCards'/);
  assert.doesNotMatch(js,/replaceKeepingHistory\('verificationCards'/); // duplicate Kane panel removed (v32.5)
  assert.match(js,/frame\.src=frame\.src/);
  assert.match(html,/id="previewLiveStatus"/);
  assert.match(css,/\.journey-event\.failed/);
  assert.match(server,/projectSourceVersion/);
});
