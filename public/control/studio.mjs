import { icon, hydrateIcons } from '../assets/icons.mjs';
import { flowAttempts, renderCheckJourney, renderAllVerificationJourneys } from './verification-history.mjs';
import { liveTaskPhase } from './live-task-state.mjs';

const $ = (id)=>document.getElementById(id);
const escape = (value)=>String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const agentNames = {cursor:'Cursor',antigravity:'Antigravity',claude:'Claude Code',codex:'Codex'};
const stopStatuses = new Set(['failed','agent_error','safety_error','infrastructure_error','verification_inconclusive','precheck_failed','interrupted']);
let view='create', selectedRunId=null, requestedProjectId=null, runs=[], projects=[], agents=[],busy=false, stream=null, streamedRunId=null, liveLines=[], refreshInFlight=false;
let currentRun=null, lastFrameUrl='', knownCompletedAt='', activePanel='activity';
let sourcePollInFlight=false, previewVersionProject='', previewVersion='';
let runStreamRefreshTimer=null, runStreamRefreshInFlight=false;

function setPreviewEmpty(title='Your app will appear here', detail='Create a project to see a real live preview, as the agent builds it.') {
  $('previewFrame').classList.add('hidden');
  $('previewEmpty').classList.remove('hidden');
  $('previewEmpty').querySelector('h2').textContent=title;
  $('previewEmpty').querySelector('p').textContent=detail;
  $('previewAddress').textContent='localhost / new-project';
  $('openPreview').href='#';$('openPreview').classList.add('disabled');$('openPreview').setAttribute('aria-disabled','true');
  $('reloadPreview').disabled=true;
  $('previewCaption').textContent='Local preview · Kane verification begins after coding';
  $('previewLiveStatus').textContent='LIVE RELOAD';
}
function setScreen(next) {
  view = ['create','projects','workbench'].includes(next) ? next : 'create';
  $('createView').classList.toggle('hidden',view!=='create');
  $('projectsView').classList.toggle('hidden',view!=='projects');
  $('workbenchView').classList.toggle('hidden',view!=='workbench');
  for(const button of document.querySelectorAll('.nav-link[data-screen]')) button.classList.toggle('active',button.dataset.screen===view);
  if(view==='projects')renderProjects();
  if(view==='create')setPreviewEmpty();
  if(view==='projects')setPreviewEmpty('Choose a project','Select an existing build to open its live preview and Kane evidence.');
  if(view==='workbench' && (!currentRun || currentRun.id!==selectedRunId))setPreviewEmpty('Preparing your workspace','Your new project is starting. The live preview will appear once its files are available.');
}
function selectPanel(next) {
  activePanel=['activity','verification','logs'].includes(next)?next:'activity';
  for(const button of document.querySelectorAll('.side-tab[data-panel]')) {
    const on=button.dataset.panel===activePanel;
    button.classList.toggle('active',on);button.setAttribute('aria-selected',String(on));
  }
  for(const [name,id] of [['activity','activityPanel'],['verification','verificationPanel'],['logs','logsPanel']])$(id).classList.toggle('hidden',name!==activePanel);
  if(activePanel==='logs')renderLog();
}
function issue(message){ $('notice').textContent=message;$('notice').classList.remove('hidden'); }
function clearIssue(){ $('notice').classList.add('hidden'); }
function updateCounter(){ $('promptCounter').textContent=`${$('createPrompt').value.length} / 1600`; }
function renderAgents(){
  for(const choice of document.querySelectorAll('.agent-tile')){
    const id=choice.querySelector('input').value;
    const entry=agents.find((item)=>item.id===id);
    const small=choice.querySelector('.agent-text small');
    if(entry) {
      choice.classList.toggle('unavailable',!entry.installed);
      choice.title=entry.installed?`${entry.label} CLI found: ${entry.command}`:`${entry.label} CLI not detected in server WSL. You can still select it, but installation is required to build.`;
      small.textContent=entry.installed?'Installed locally':'CLI not installed';
    }
  }
}
function statusClass(status){return status==='passed'?'passed':stopStatuses.has(status)?'failed':'';}
function statusLabel(status){return String(status || 'pending').replaceAll('_',' ');}
function elapsed(run){
  const a=Date.parse(run?.createdAt || ''), b=run?.completedAt?Date.parse(run.completedAt):Date.now();
  if(!Number.isFinite(a))return '00:00';
  const seconds=Math.max(0,Math.floor((b-a)/1000));
  return `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
}
function dateLabel(value){try{return new Date(value).toLocaleDateString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});}catch{return ''}}

function renderProjects(){
  const cards=projects.map((project)=>`<article class="project-card"><div class="project-card-top"><span class="app-icon">${icon('layout-template')}</span><span class="status-pill ${statusClass(project.status)}">${escape(statusLabel(project.status))}</span></div><h3>${escape(project.label)}</h3><p>${escape(agentNames[project.agentId] || 'Coding agent')} · ${escape(project.id)}</p><div class="project-card-actions">${project.runId?`<button type="button" data-open-run="${escape(project.runId)}">View build</button>`:''}<a href="${escape(project.previewUrl)}" target="_blank" rel="noopener">Open app ${icon('arrow-up-right')}</a><button type="button" class="delete-action" data-delete-project="${escape(project.id)}" aria-label="Delete project ${escape(project.label)} and all saved evidence" title="Delete app, code and ALL saved runs">${icon('trash-2')} Delete project</button></div></article>`).join('');
  $('projectCards').innerHTML=cards || '<div class="no-projects">No custom apps yet. Describe an idea to create your first one.</div>';
  $('runCards').innerHTML=runs.slice(0,35).map((run)=>`<div class="run-item-wrap"><button type="button" class="run-item" data-open-run="${escape(run.id)}"><span class="run-left"><strong>${escape(run.featureTitle || run.appLabel || run.request || 'Build')}</strong><small>${escape(agentNames[run.agentId] || 'Antigravity')} · ${escape(dateLabel(run.createdAt))} · ${escape(run.id)}</small></span><span class="status-pill ${statusClass(run.status)}">${escape(statusLabel(run.status))}</span></button><button class="delete-action run-delete" type="button" data-delete-run="${escape(run.id)}" title="Delete this run and all its evidence" aria-label="Delete saved run ${escape(run.id)}">${icon('trash-2')}</button></div>`).join('') || '<div class="no-projects">Build history will appear here.</div>';
}
function selectRun(id){
  selectedRunId=id;requestedProjectId=null;
  setScreen('workbench');
  const selected=runs.find((run)=>run.id===id);
  if(selected) renderWorkbench(selected);
}
function sourceLink(run,filename){return `/api/evidence/${encodeURIComponent(run.id)}/${encodeURIComponent(filename)}`;}
/** Rebuild only the data-driven cards, remembering any check histories the
 * viewer has manually expanded or collapsed during the live polling cycle. */
function replaceKeepingHistory(id, markup){
  const root=$(id);
  const states=new Map([...root.querySelectorAll('details.check-journey[data-journey-key]')]
    .map((el)=>[el.dataset.journeyKey,el.open]));
  root.innerHTML=markup;
  for(const detail of root.querySelectorAll('details.check-journey[data-journey-key]')) {
    if(states.has(detail.dataset.journeyKey))detail.open=states.get(detail.dataset.journeyKey);
  }
}
function renderTaskRows(run){
  const tasks=run.tasks || [], milestones=run.milestones || [], verifications=run.verification || [];
  $('taskCount').textContent=`${tasks.length} task${tasks.length===1?'':'s'}`;
  if(!tasks.length){$('taskCards').innerHTML='<div class="empty-pane">Your coding agent is preparing a testable implementation plan.</div>';return;}
  const taskMarkup=tasks.map((task,index)=>{
    const milestone=milestones.find((m)=>m.taskId===task.id),checks=(run.generatedFlows || []).filter((flow)=>(task.acceptanceIds || []).includes(flow.id));
    const executed=run.taskExecutions?.find((e)=>e.taskId===task.id);
    const live=liveTaskPhase(run,task);
    const status=task.status==='verified'?'verified':milestone?.status==='verification_inconclusive'||task.status==='verification_inconclusive'?'verification_inconclusive':milestone?.status==='failed'?'failed':milestone?.status==='verifying'||milestone?.status==='passed'?'verifying':task.status;
    const state=live?.label || (task.status==='verified'?'Kane verified':run.status==='interrupted'?'Interrupted':status==='verification_inconclusive'?'Verification incomplete':milestone?.status==='verifying'?'Kane testing':task.status==='implementing'?'Coding now':task.status==='candidate'?'Awaiting Kane':statusLabel(status));
    const liveDetails=live && live.key!=='testing' ? `<div class="task-live task-live-${escape(live.key)}" role="status"><strong>${escape(live.label)}</strong><p>${escape(live.detail).slice(0,420)}</p></div>` : '';
    const checkRows=checks.map((check)=>{
      const checkId=`feature-${check.id}`;
      const attempts=flowAttempts(run,checkId).filter((v)=>v.taskId===task.id || (!v.taskId && v.gate?.startsWith(`After ${task.id}:`)));
      const completed=attempts.at(-1) || [...verifications].reverse().find((v)=>v.flowId===checkId);
      const checking=run.currentFlowId===checkId && run.status==='running';
      const tone=checking?'':completed?.verdict==='passed'?'passed':completed?.verdict==='failed'?'failed':'';
      const priorFailed=attempts.some((v)=>v.verdict==='failed');
      const label=checking?'Kane browser running':live?.key==='diagnosing'&&completed?.verdict==='failed'?'Kane failed · agent diagnosing':live?.key==='repairing'&&completed?.verdict==='failed'?'Kane failed · agent repairing':live?.key==='retesting'&&completed?.verdict==='failed'?'Kane failed · retest running':completed?.verdict==='passed'?(priorFailed?'Kane passed after repair / retry':'Kane passed'):completed?.verdict==='failed'?(completed?.unavailableCapability?'Kane could not perform viewport check':'Kane reported failure'):milestone?.status==='verifying'?'Kane queued':'Kane planned';
      const journey=attempts.length>1 || priorFailed ? renderCheckJourney(run,attempts,(file)=>sourceLink(run,file),{label:'Verification journey'}) : '';
      const originalEvidence=attempts.length===1 && !journey && completed?.stdoutFile ? `<div class="journey-proof inline-proof"><a href="${sourceLink(run,completed.stdoutFile)}" target="_blank" rel="noopener">Kane transcript</a></div>` : '';
      return `<div class="check-mini ${tone}">${icon(completed?.verdict==='passed'?'check-circle':checking?'activity':'circle-dot')}<span>${escape(check.name)} · ${label}</span></div>${journey}${originalEvidence}`;
    }).join('');
    const evidence=executed?.outputFile?`<div class="verify-links" style="margin-top:10px"><a href="${sourceLink(run,executed.outputFile)}" target="_blank" rel="noopener">Agent transcript</a>${executed.diffFile?`<a href="${sourceLink(run,executed.diffFile)}" target="_blank" rel="noopener">Task diff</a>`:''}</div>`:'';
    return `<div class="task-row ${task.status==='verified'?'verified':''}"><div class="task-number">${task.status==='verified'?icon('check'):index+1}</div><div class="task-body"><div><strong>${escape(task.title)}</strong><span class="task-state ${task.status==='verified'?'verified':''}">${escape(state)}</span></div><p>${escape(task.detail).slice(0,300)}</p>${liveDetails}${checkRows}${evidence}</div></div>`;
  }).join('');
  replaceKeepingHistory('taskCards',taskMarkup);
}
function renderVerifications(run){
  const checks=run.verification || [], reused=run.reusedVerification || [];
  const failed=checks.filter((v)=>v.verdict==='failed').length;
  $('verificationCount').textContent=`${checks.length} run${checks.length===1?'':'s'}${failed?`, ${failed} failed attempt${failed===1?'':'s'} kept`:''}${reused.length?`, ${reused.length} reused`:''}`;
  // Never truncate the historical attempts: a later PASS must not erase a FAIL.
  replaceKeepingHistory('verificationCards',renderAllVerificationJourneys(run,(file)=>sourceLink(run,file)));
}
function progressInfo(run){
  const stage=run.stage || 'planning', stop=run.status==='passed'||stopStatuses.has(run.status);
  if(run.status==='passed')return {title:'Your app passed its Kane checks', detail:run.verificationLimits?.length
    ? 'All executable Kane objectives passed. Mobile-width layout was not tested in this desktop browser session.'
    : 'All required browser objectives passed on the tested source.',pct:100};
  if(run.status==='interrupted')return {title:'Build interrupted',detail:run.interruptionReason || 'The server stopped before this run finished. Its source and previous Kane evidence are preserved.',pct:100};
  if(stop)return {title:run.status==='verification_inconclusive'?(run.failure?.unavailableCapability?'Browser test could not finish':'Verification disputed — review evidence'):'The workflow stopped',detail:run.timeline?.at(-1)?.detail || 'See the saved log for details.',pct:100};
  if(run.activeGate==='Final full suite')return {title:'Kane is running final verification',detail:run.currentFlow || 'Rechecking features and protected regressions.',pct:88};
  if(stage==='planning')return {title:'Coding agent is preparing the plan',detail:'Creating sequential tasks and independent Kane browser objectives.',pct:12};
  if(stage==='implementing'){
    const active=run.tasks?.find((t)=>t.status==='implementing');
    const index=run.tasks?.findIndex((t)=>t.id===active?.id) ?? 0;
    return {title:`${agentNames[run.agentId] || 'Coding agent'} is writing code`,detail:active?.title || 'Implementing the next task.',pct:24+(Math.max(0,index)*26)};
  }
  if(stage==='verifying'||stage==='reverifying')return {title:stage==='reverifying'?'Kane is retesting after a repair':'Kane is testing in Chrome',detail:run.currentFlow ? `Now verifying: ${run.currentFlow}` : 'Starting the next real browser check.',pct:63};
  if(stage==='diagnosing')return {title:'Agent investigating a Kane failure',detail:run.failure?.summary || 'Reading independent browser evidence and identifying the cause.',pct:71};
  if(stage==='repairing')return {title:'Agent repairing the application',detail:run.plans?.at(-1)?.plan?.diagnosis || 'Fixing the source before an independent Kane retest.',pct:75};
  if(stage==='final_verification')return {title:'Kane is running final verification',detail:run.currentFlow || 'Rechecking features and protected regressions.',pct:88};
  return {title:'KaneGuard is working',detail:run.currentFlow || 'Preparing the next step.',pct:35};
}
function renderWorkbench(run){
  currentRun=run;
  const title=run.featureTitle || run.appLabel || 'Creating your app';
  $('runTitle').textContent=title;
  $('runSubtitle').textContent=`${agentNames[run.agentId] || 'Coding agent'} · ${run.planSummary || run.request || 'Preparing your project'}`.slice(0,220);
  $('runStatus').textContent=statusLabel(run.status).toUpperCase();$('runStatus').className=`status-pill ${statusClass(run.status)}`;
  $('elapsed').textContent=elapsed(run);
  const info=progressInfo(run);$('currentAction').textContent=info.title;$('currentDetail').textContent=info.detail;$('progressBar').style.width=`${info.pct}%`;
  $('stepSpinner').className=`step-spinner ${run.status==='passed'?'done':stopStatuses.has(run.status)?'failed':''}`;
  const url=run.previewUrl || (run.appId?`/${run.appId}/`:'/cartlab/');
  const originUrl=new URL(url,window.location.origin);
  $('openPreview').href=originUrl.href;$('openPreview').classList.remove('disabled');$('openPreview').setAttribute('aria-disabled','false');
  $('reloadPreview').disabled=false;
  $('previewAddress').textContent=originUrl.host + originUrl.pathname;
  $('previewEmpty').classList.add('hidden');$('previewFrame').classList.remove('hidden');
  $('previewCaption').textContent=run.status==='passed'
    ? (run.verificationLimits?.length?'Desktop Kane checks passed; mobile-width layout not independently tested.':'Verified: the saved Kane browser objectives have passed on the recorded application source.')
    : 'Preview is local and may contain unfinished code. Only authentic Kane evidence establishes a PASS.';
  // The preview only changes when the URL or actual project source changes.
  // Avoid the old task-completion reload: it missed mid-task edits and reset
  // visitors' in-progress interactions even if no source file changed.
  if(lastFrameUrl!==originUrl.href) {
    $('previewFrame').src=originUrl.href;
    lastFrameUrl=originUrl.href;
    knownCompletedAt='';previewVersionProject='';previewVersion='';
    $('previewLiveStatus').textContent='LIVE RELOAD';
  }
  void pollPreviewSource(run);
  $('openLog').href=sourceLink(run,'live.log');
  const evidence=run.artifacts || {};
  for(const [id,key] of [['evidencePlan','featurePlan'],['evidenceDiff','sourceDiff'],['evidenceRequest','userRequest']]) {
    const file=evidence[key];const link=$(id);link.href=file?sourceLink(run,file):'#';link.style.opacity=file?'1':'.4';link.style.pointerEvents=file?'auto':'none';
  }
  const resume=['agent_error','failed','infrastructure_error','verification_inconclusive'].includes(run.status)&&!!run.artifacts?.featurePlan&&!!run.changedFiles?.length&&!busy;
  $('resumeButton').classList.toggle('hidden',!resume);
  renderTaskRows(run);renderVerifications(run);
  connectStream(run.id);
}
async function pollPreviewSource(run){
  if(sourcePollInFlight || !run?.appId || !/^app-[a-z0-9-]{5,54}$/.test(run.appId) || view!=='workbench')return;
  sourcePollInFlight=true;
  const appId=run.appId;
  try {
    const response=await fetch(`/api/projects/${encodeURIComponent(appId)}/source-version`,{cache:'no-store'});
    if(!response.ok)return;
    const data=await response.json();
    if(typeof data.version!=='string')return;
    // Results from an older project must never reload the newly selected app.
    if(view!=='workbench' || selectedRunId!==run.id || lastFrameUrl!==new URL(run.previewUrl || `/${appId}/`,window.location.origin).href)return;
    if(previewVersionProject!==appId){previewVersionProject=appId;previewVersion=data.version;knownCompletedAt=data.version;return;}
    if(data.version===previewVersion)return;
    previewVersion=data.version;knownCompletedAt=data.version;
    const frame=$('previewFrame');
    if(!frame.classList.contains('hidden') && frame.src){
      // The iframe is sandboxed; reloading via src keeps this local and safe.
      frame.src=frame.src;
      $('previewLiveStatus').textContent='UPDATED';
    }
  } catch { /* Preview is still usable if monitoring is unavailable. */ }
  finally {sourcePollInFlight=false;}
}
function renderLog(){
  const box=$('logLines'), closeToBottom=box.scrollHeight-box.scrollTop-box.clientHeight<90;
  box.innerHTML=liveLines.slice(-150).map((line)=>{
    const category=/\[KANE(?: STDERR)?\]/.test(line)?'kane':/\[(?:BUILD|PLAN|AGENT)/.test(line)?'agent':/\b(?:ERROR|FAILED|denied|interrupted)\b/i.test(line)?'error':'';
    const ts=line.match(/^\[([^\]]+)\]/)?.[1];
    const display=ts?line.slice(ts.length+2).trim():line;
    return `<span class="terminal-line ${category}">${ts?`<span class="time">${escape(ts.slice(11,19))}</span>`:''}${escape(display)}</span>`;
  }).join('') || '<span class="terminal-line muted">Waiting for event stream…</span>';
  if(closeToBottom)box.scrollTop=box.scrollHeight;
}
function scheduleStreamRefresh(id){
  // Engine logs are immediate, while saved state is refreshed at a bounded
  // rate. Do not fetch once per streaming CLI token or switch workspaces.
  if(runStreamRefreshTimer || runStreamRefreshInFlight || id!==selectedRunId || view!=='workbench')return;
  runStreamRefreshTimer=setTimeout(async()=>{
    runStreamRefreshTimer=null;
    if(runStreamRefreshInFlight || id!==selectedRunId || view!=='workbench')return;
    runStreamRefreshInFlight=true;
    try{
      const response=await fetch(`/api/runs/${encodeURIComponent(id)}`,{cache:'no-store'});
      if(!response.ok)return;
      const latest=await response.json();
      if(id!==selectedRunId || view!=='workbench')return;
      const i=runs.findIndex((run)=>run.id===id);
      if(i>=0)runs[i]=latest;else runs.unshift(latest);
      renderWorkbench(latest);
    }catch{ /* The regular poll will retry if the run endpoint is unavailable. */ }
    finally{runStreamRefreshInFlight=false;}
  },350);
}
function connectStream(id){
  if(streamedRunId===id)return;
  stream?.close();stream=null;streamedRunId=id;liveLines=[];renderLog();
  if(runStreamRefreshTimer){clearTimeout(runStreamRefreshTimer);runStreamRefreshTimer=null;}
  if(!('EventSource' in window))return;
  stream=new EventSource(`/api/runs/${encodeURIComponent(id)}/events`);
  stream.addEventListener('snapshot',(evt)=>{try {liveLines=JSON.parse(evt.data).lines || [];renderLog();}catch{}});
  stream.addEventListener('line',(evt)=>{try{liveLines.push(JSON.parse(evt.data).line);if(liveLines.length>200)liveLines=liveLines.slice(-180);renderLog();scheduleStreamRefresh(id);}catch{}});
  stream.addEventListener('error',()=>{ /* Native EventSource retries; no invented terminal events. */ });
}
async function refresh(){
  if(refreshInFlight)return;
  refreshInFlight=true;
  try {
    const [r,p,h]=await Promise.all([fetch('/api/runs',{cache:'no-store'}),fetch('/api/projects',{cache:'no-store'}),fetch('/api/health',{cache:'no-store'})]);
    if(!r.ok||!p.ok||!h.ok)throw new Error('KaneGuard API unavailable');
    runs=await r.json();projects=await p.json();const health=await h.json();
    busy=!!health.busy;
    $('connection').classList.remove('offline');$('connection').innerHTML='<span class="connection-dot"></span> Local engine online';
    $('createButton').disabled=busy;
    if(requestedProjectId) {
      const newRun=runs.find((item)=>item.projectId===requestedProjectId);
      if(newRun){selectedRunId=newRun.id;requestedProjectId=null;setScreen('workbench');}
    }
    if(!selectedRunId && runs.some((run)=>run.status==='running') && view==='create' && !requestedProjectId){
      selectedRunId=runs.find((run)=>run.status==='running').id;setScreen('workbench');
    }
    const selected=runs.find((run)=>run.id===selectedRunId);
    if(selected && view==='workbench')renderWorkbench(selected);
    if(view==='projects')renderProjects();
  } catch {
    $('connection').classList.add('offline');$('connection').innerHTML='<span class="connection-dot"></span> Engine offline';
  } finally{refreshInFlight=false;}
}
async function startBuild(evt){
  evt.preventDefault();if(busy)return;
  const prompt=$('createPrompt').value.trim(), agentId=document.querySelector('input[name="agent"]:checked')?.value || 'cursor';
  clearIssue();if(prompt.length<8){issue('Describe the app in at least 8 characters.');return;}
  $('createButton').disabled=true;$('createButton').textContent='Creating your workspace…';
  try {
    const response=await fetch('/api/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt,agentId})});
    const payload=await response.json();if(!response.ok)throw new Error(payload.error||'Unable to create project');
    requestedProjectId=payload.project.id;
    selectedRunId=null;currentRun=null;lastFrameUrl='';knownCompletedAt='';previewVersionProject='';previewVersion='';
    $('createPrompt').value='';updateCounter();
    selectPanel('activity');setScreen('workbench');
    await refresh();
  } catch(error){issue(error.message);}finally{$('createButton').textContent='Create my app →';$('createButton').disabled=busy;}
}
async function deleteProjectFromUI(id){
  if(busy){alert('A build or verification is active. Delete projects after it stops.');return;}
  const project=projects.find((p)=>p.id===id);
  if(!project || !window.confirm(`Permanently delete "${project.label}"?\n\nThis deletes the generated source files, project configuration, and ALL associated Kane run evidence. This cannot be undone.`))return;
  try {
    const response=await fetch(`/api/projects/${encodeURIComponent(id)}`,{method:'DELETE'});
    const payload=await response.json();if(!response.ok)throw new Error(payload.error||'Delete failed');
    const deleted=new Set(payload.deletedRuns || []);
    if(deleted.has(selectedRunId) || currentRun?.appId===id){selectedRunId=null;currentRun=null;lastFrameUrl='';previewVersionProject='';previewVersion='';stream?.close();stream=null;streamedRunId=null;}
    setScreen('projects');await refresh();
  }catch(error){alert(error.message);}
}
async function deleteRunFromUI(id){
  if(busy){alert('A build or verification is active. Delete saved runs after it stops.');return;}
  if(!window.confirm(`Permanently delete run ${id} and all its saved evidence?\n\nThe application files will be kept. This cannot be undone.`))return;
  try {
    const response=await fetch(`/api/runs/${encodeURIComponent(id)}`,{method:'DELETE'});
    const payload=await response.json();if(!response.ok)throw new Error(payload.error||'Delete failed');
    if(selectedRunId===id){selectedRunId=null;currentRun=null;stream?.close();stream=null;streamedRunId=null;}
    setScreen('projects');await refresh();
  }catch(error){alert(error.message);}
}
async function resume(){if(!currentRun||busy)return;const button=$('resumeButton');button.disabled=true;try{
  const res=await fetch(`/api/runs/${encodeURIComponent(currentRun.id)}/resume`,{method:'POST'});
  const data=await res.json();if(!res.ok)throw new Error(data.error||'Unable to resume');
  selectedRunId=null;setScreen('projects');await refresh();
}catch(error){alert(error.message);}finally{button.disabled=false;}}

document.addEventListener('click',(event)=>{
  const delProject=event.target.closest('[data-delete-project]');if(delProject){void deleteProjectFromUI(delProject.dataset.deleteProject);return;}
  const delRun=event.target.closest('[data-delete-run]');if(delRun){void deleteRunFromUI(delRun.dataset.deleteRun);return;}
  const nav=event.target.closest('[data-screen]');if(nav){setScreen(nav.dataset.screen);return;}
  const idea=event.target.closest('[data-idea]');if(idea){setScreen('create');$('createPrompt').value=idea.dataset.idea;updateCounter();$('createPrompt').focus();return;}
  const panel=event.target.closest('[data-panel]');if(panel){selectPanel(panel.dataset.panel);return;}
  const open=event.target.closest('[data-open-run]');if(open){selectRun(open.dataset.openRun);return;}
});
$('createForm').addEventListener('submit',startBuild);
$('createPrompt').addEventListener('input',updateCounter);
$('reloadPreview').addEventListener('click',()=>{if($('previewFrame').classList.contains('hidden'))return;const frame=$('previewFrame');if(frame.src)frame.src=frame.src;});
$('resumeButton').addEventListener('click',resume);
hydrateIcons();updateCounter();selectPanel('activity');setPreviewEmpty();
fetch('/api/agents').then((r)=>r.json()).then((data)=>{agents=data.agents||[];renderAgents();}).catch(()=>{});
refresh();setInterval(refresh,1600);setInterval(()=>{if(currentRun&&view==='workbench')$('elapsed').textContent=elapsed(currentRun);},1000);
