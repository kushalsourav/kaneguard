import { icon, hydrateIcons } from '../assets/icons.mjs';
import { flowAttempts } from './verification-history.mjs';
import { liveTaskPhase } from './live-task-state.mjs';
import { taskCheckState, taskVerificationState } from './task-verification-state.mjs';
import {recordedCheckProgress,requirementProgressLabel} from './assurance-progress.mjs';
import {renderTrustAtelier} from './trust-atelier.mjs';

const $ = (id)=>document.getElementById(id);
const escape = (value)=>String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const agentNames = {cursor:'Cursor',antigravity:'Antigravity',claude:'Claude Code',codex:'Codex'};
const stopStatuses = new Set(['failed','agent_error','safety_error','infrastructure_error','verification_inconclusive','precheck_failed','interrupted']);
let stopping=false, view='create', selectedRunId=null, requestedProjectId=null, runs=[], projects=[], agents=[],busy=false, stream=null, streamedRunId=null, liveLines=[], refreshInFlight=false;
let currentRun=null, lastFrameUrl='', knownCompletedAt='', activePanel='activity';
let previewMode='app', selectedProjectRunId=null;
let sourcePollInFlight=false, previewVersionProject='', previewVersion='';
let runStreamRefreshTimer=null, runStreamRefreshInFlight=false;
let defaultAgentSelected=false;

function setPreviewEmpty(title='Your app will appear here', detail='Describe it, pick an agent. The agent builds; Kane proves it in a real browser.') {
  $('previewFrame').classList.add('hidden');
  $('atelierPanel').classList.add('hidden');
  document.querySelector('.preview-panel').classList.remove('atelier-active');
  $('previewEmpty').classList.remove('hidden');
  $('previewEmpty').querySelector('h2').textContent=title;
  $('previewEmpty').querySelector('p').textContent=detail;
  $('previewAddress').textContent='localhost / new-project';
  $('openPreview').textContent='↗ Open app';
  $('openPreview').href='#';$('openPreview').classList.add('disabled');$('openPreview').setAttribute('aria-disabled','true');
  $('reloadPreview').disabled=true;
  for(const id of ['showAtelier','showLiveApp']){$(id).disabled=true;$(id).setAttribute('aria-pressed','false');$(id).classList.remove('selected');}
  $('previewCaption').textContent='Local preview · Kane verification begins after coding';
  $('previewLiveStatus').textContent='LIVE RELOAD';
}
function setScreen(next) {
  view = ['create','projects','workbench'].includes(next) ? next : 'create';
  $('createView').classList.toggle('hidden',view!=='create');
  $('projectsView').classList.toggle('hidden',view!=='projects');
  $('workbenchView').classList.toggle('hidden',view!=='workbench');
  for(const button of document.querySelectorAll('.nav-link[data-screen]')) button.classList.toggle('active',button.dataset.screen===view);
  if(view==='create')setPreviewEmpty();
  if(view==='projects'){setPreviewEmpty('Choose a project','Select an existing build to open its live preview and Kane evidence.');renderProjects();}
  if(view==='workbench' && (!currentRun || currentRun.id!==selectedRunId))setPreviewEmpty('Preparing your workspace','Your new project is starting. The live preview will appear once its files are available.');
}
function selectPanel(next) {
  // v32.5: the sidebar is a single run panel; the raw log is a collapsible section.
  activePanel='activity';
  if(next==='logs'){$('logsPanel').open=true;renderLog();}
}
function issue(message){ $('notice').textContent=message;$('notice').classList.remove('hidden'); }
function clearIssue(){ $('notice').classList.add('hidden'); }
function updateCounter(){ $('promptCounter').textContent=`${$('createPrompt').value.length} / 1600`; }
// New app only builds static HTML/CSS/JS: say so as soon as a framework is mentioned.
const FRAMEWORK=/\b(next\.?js|nextjs|nest\.?js|nestjs|react|vue|angular|svelte|nuxt|remix|astro|vite|express|django|flask)\b/i;
function updateFrameworkHint(){
  const m=$('createPrompt').value.match(FRAMEWORK);
  $('frameworkHint').classList.toggle('hidden',!m);
  if(m)$('frameworkName').textContent=m[1].replace(/^next\.?js$/i,'Next.js').replace(/^nest\.?js$/i,'NestJS').replace(/^react$/i,'React').replace(/^vue$/i,'Vue');
}
let createMode='new';
function selectCreateMode(mode){
  createMode=mode==='existing'?'existing':'new';
  $('createForm').classList.toggle('hidden',createMode!=='new');
  $('connectForm').classList.toggle('hidden',createMode!=='existing');
  // Intentionally keep example idea cards hidden for every creation mode.
  for(const button of document.querySelectorAll('[data-create-mode]')){
    const selected=button.dataset.createMode===createMode;
    button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',String(selected));
  }
  if(createMode==='existing') $('connectFolder').focus();
}
function renderAgents(){
  for(const choice of document.querySelectorAll('.agent-tile')){
    const id=choice.querySelector('input').value;
    const entry=agents.find((item)=>item.id===id);
    const small=choice.querySelector('.agent-text small');
    if(entry) {
      choice.classList.toggle('unavailable',!entry.installed);
      choice.title=entry.installed?`${entry.label} CLI found: ${entry.command}`:`${entry.label} CLI not detected locally. Install it before building.`;
      small.textContent=entry.installed?'Installed locally':'CLI not installed';
    }
  }
  const installed=agents.filter(a=>a.installed);
  for(const name of ['agent','connectedAgent']) {
    const radios=[...document.querySelectorAll(`input[name="${name}"]`)];
    if(!defaultAgentSelected && installed.length) {
      const available=radios.find(r=>r.value===installed[0].id);
      if(available) available.checked=true;
    }
    radios.forEach(r=>{r.disabled=!!agents.length&&!agents.find(a=>a.id===r.value)?.installed;});
  }
  for(const id of ['examinerAgent','connectedExaminer']) {
    const element=$(id);
    if(!element)continue;
    const prior=element.value;
    element.innerHTML='<option value="">Same agent as builder</option>'+ (installed.length>1 ? installed.map(a=>`<option value="${escape(a.id)}">${escape(a.label)}</option>`).join('') : '');
    element.disabled=installed.length<2;
    if(installed.length>1&&installed.some(a=>a.id===prior))element.value=prior;
    element.closest('.assurance-controls').classList.toggle('one-agent',installed.length<2);
  }
  if(installed.length)defaultAgentSelected=true;
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

// Presentation-only path shortening: never changes what the server opens/edits.
function friendlyProjectPath(path){
  const normalized=String(path||'').replaceAll('\\','/');
  return normalized.replace(/^\/home\/[^/]+(?=\/|$)/,'~')
    .replace(/^\/Users\/[^/]+(?=\/|$)/,'~')
    .replace(/^\/mnt\/[a-z]\/Users\/[^/]+(?=\/|$)/i,'~')
    .replace(/^[a-z]:\/Users\/[^/]+(?=\/|$)/i,'~');
}
/** Projects with nothing selected: the same sketch preview as Create; the list on the left is the choice. */
function renderFeaturedRun(){
  setPreviewEmpty('Pick a project','Select an app on the left to see its Live loop: what the agent changed, every step Kane took in a real browser, and any bug it caught and fixed.');
  $('previewAddress').textContent='localhost';
  $('previewCaption').textContent='Select an app on the left';
  $('previewLiveStatus').textContent='';
}
function renderProjects(){
  const selected=runs.find(run=>run.id===selectedProjectRunId);
  if(selected){
    if(previewMode==='app')showAppInPreview(selected);
    else if(previewMode==='atelier')showAtelierInPreview(selected);
    else showAtelierInPreview(selected);
  } else {selectedProjectRunId=null;renderFeaturedRun();}
  // Running first, then passed, then inconclusive/interrupted, then failed builds (muted) at the bottom.
  const rank=(st)=>st==='running'?0:st==='passed'?1:['verification_inconclusive','interrupted','created'].includes(st)?2:3;
  const ordered=projects.map((p,i)=>({p,i})).sort((a,b)=>rank(a.p.status)-rank(b.p.status)||a.i-b.i).map(x=>x.p);
  const cards=ordered.map(project=>{
    const archived=project.kind==='archived'||project.archivedOnly;
    const description=project.kind==='archived'?'Saved archive · read-only'
      :project.kind==='connected' ? `${escape(project.framework||'Existing app')} · ${escape(friendlyProjectPath(project.projectDir))}`
      :`${escape(agentNames[project.agentId]||'Coding agent')} · ${escape(project.id)}`;
    const open=project.runId?`<button type="button" class="pc-primary" data-open-project-workflow="${escape(project.runId)}">${icon('eye')} View verification</button>`
      :'<span class="project-pending">No saved run yet</span>';
    const details=project.runId&&!archived?`<button type="button" data-open-run="${escape(project.runId)}" title="Open the build details">Details</button>`:'';
    const preview=!archived?`<a href="${escape(project.previewUrl)}" target="_blank" rel="noopener" title="Open the running app in a new tab">Open ${icon('arrow-up-right')}</a>`:'';
    const remove=project.kind==='archived'?'':`<button type="button" class="delete-action pc-icon" data-delete-project="${escape(project.id)}" aria-label="${project.kind==='connected'?'Disconnect project':'Delete project'} ${escape(project.label)}" title="${project.kind==='connected'?'Disconnect (original source and saved evidence remain)':'Delete app, code and saved runs'}">${icon(project.kind==='connected'?'unlink':'trash-2')}</button>`;
    // Compact card: icon · title + meta · status on one row, actions on a second row.
    return `<article class="project-card ${selectedProjectRunId===project.runId?'project-selected':''} ${rank(project.status)===3?'project-muted':''}"><button type="button" class="project-main-button" ${project.runId?`data-open-project-workflow="${escape(project.runId)}"`:'disabled'} aria-label="View saved workflow for ${escape(project.label)}"><span class="app-icon">${icon(project.kind==='connected'?'folder-code':'layout-template')}</span><span class="pc-text"><h3 title="${escape(project.label)}">${escape(project.label)}</h3><span class="pc-meta"><span class="status-pill ${statusClass(project.status)}">${escape((project.stoppedByUser?'stopped':statusLabel(project.status)))}</span><p>${description}</p></span></span></button><div class="project-card-actions">${open}${details}${preview}${remove}</div></article>`;
  }).join('');
  $('projectCards').innerHTML=cards || '<div class="no-projects">No projects yet. Create a new app or connect existing source.</div>';
  $('runCount').textContent=runs.length?`(${Math.min(runs.length,35)})`:'';
  $('runCards').innerHTML=runs.slice(0,35).map(run=>`<div class="run-item-wrap"><button type="button" class="run-item" data-open-project-workflow="${escape(run.id)}"><span class="run-left"><strong>${escape(run.featureTitle||run.appLabel||run.request||'Build')}</strong><small>${escape(agentNames[run.agentId]||'Coding agent')} · ${escape(dateLabel(run.createdAt))} · ${escape(run.id)}</small></span><span class="status-pill ${statusClass(run.status)}">${escape((run.stoppedByUser?'stopped':statusLabel(run.status)))}</span></button><button class="delete-action run-delete" type="button" data-delete-run="${escape(run.id)}" title="Delete this run and all its evidence" aria-label="Delete saved run ${escape(run.id)}">${icon('trash-2')}</button></div>`).join('') || '<div class="no-projects">Saved runs and saved build evidence will appear here.</div>';
}
function selectProjectWorkflow(id){
  const selected=runs.find(run=>run.id===id);
  if(!selected)return;
  selectedProjectRunId=id;previewMode='atelier';
  if(view!=='projects')setScreen('projects');
  renderProjects();
}
function updatePreviewModeButtons(){
  const chosen=view==='workbench'?currentRun:runs.find(run=>run.id===selectedProjectRunId);
  const ready=!!chosen;
  for(const [id,mode] of [['showAtelier','atelier'],['showLiveApp','app']]){
    const el=$(id);el.disabled=!ready || (mode==='app' && !!chosen?.archivedOnly);el.setAttribute('aria-pressed',String(previewMode===mode));el.classList.toggle('selected',previewMode===mode);
  }
}
// Saved Kane step traces, diffs, diagnoses and the full journey for the Live loop view.
const traceCache=new Map();let atelierRun=null,atelierRenderPending=false,lastAtelierHTML='',lastAtelierRunId='';
const traceKey=(run)=>`${run.verification?.length||0}-${run.repairs?.length||0}-${run.timeline?.length||0}-${run.status}-${run.stage||''}`;
async function ensureTrace(run){
  const cached=traceCache.get(run.id);
  // Finished runs never change: fetch once. Live runs refetch only when saved state changes.
  if(cached&&(cached.key===traceKey(run)||cached.loading))return;
  const key=traceKey(run);
  traceCache.set(run.id,{...cached,key,loading:true});
  try{
    const response=await fetch(`/api/runs/${encodeURIComponent(run.id)}/trace`,{cache:'no-store'});
    const data=response.ok?await response.json():null;
    traceCache.set(run.id,{key,data,loading:false});
  }catch{traceCache.set(run.id,{key,data:cached?.data||null,loading:false,failed:true});}
  if(previewMode==='atelier'&&atelierRun?.id===run.id){
    renderAtelier();
    // The run may have moved on (e.g. finished) while this request was in flight: fetch the newer state.
    if(traceKey(atelierRun)!==key)ensureTrace(atelierRun);
  }
}
function renderAtelier(){
  const run=atelierRun;if(!run)return;
  const cached=traceCache.get(run.id);
  const html=renderTrustAtelier(run,{lines:streamedRunId===run.id?liveLines:[],trace:cached?.data||null});
  // Only touch the DOM when something actually changed: no flicker, no replayed animations.
  if(html===lastAtelierHTML&&lastAtelierRunId===run.id)return;
  const same=lastAtelierRunId===run.id;
  const viewport=document.querySelector('.preview-viewport');const keep=same?viewport.scrollTop:0;
  // Each log pane keeps its own scroll; a pane that was at the bottom stays pinned to the newest line.
  const feeds=[...$('atelierPanel').querySelectorAll('.lp-feed')].map(el=>({top:el.scrollTop,pinned:el.scrollHeight-el.scrollTop-el.clientHeight<24}));
  $('atelierPanel').innerHTML=html;lastAtelierHTML=html;lastAtelierRunId=run.id;
  if(stopping)syncStopButtons();
  viewport.scrollTop=keep;
  // Live builds follow the newest line; saved runs open at the start of the story.
  $('atelierPanel').querySelectorAll('.lp-feed').forEach((el,i)=>{const f=same?feeds[i]:null;el.scrollTop=f?(f.pinned&&run.status==='running'?el.scrollHeight:f.top):(run.status==='running'?el.scrollHeight:0);});
}
function scheduleAtelierRender(id){
  if(atelierRenderPending||previewMode!=='atelier'||atelierRun?.id!==id)return;
  atelierRenderPending=true;
  requestAnimationFrame(()=>{atelierRenderPending=false;renderAtelier();});
}
function showAtelierInPreview(run){
  if(!run)return;
  if(previewMode!=='atelier'||atelierRun?.id!==run.id)lastAtelierHTML='';
  previewMode='atelier';
  atelierRun=run;
  if(run.status==='running')connectStream(run.id); // live lines in Projects view too, not only Build details
  renderAtelier();ensureTrace(run);
  $('atelierPanel').classList.remove('hidden');
  document.querySelector('.preview-panel').classList.add('atelier-active');
  $('previewFrame').classList.add('hidden');
  $('previewEmpty').classList.add('hidden');
  $('previewAddress').textContent=`atelier / ${run.id}`;
  $('previewLiveStatus').textContent=run.status==='running'?'LIVE':'SAVED RUN';
  $('previewCaption').textContent=run.status==='running'?'Live: agent actions and Kane browser steps as they stream in':'Saved run: Kane browser steps and agent changes from the raw output files';
  $('reloadPreview').disabled=false;
  $('openPreview').href=`/api/runs/${encodeURIComponent(run.id)}/receipt`;
  $('openPreview').textContent='↗ Trust Receipt';
  $('openPreview').classList.remove('disabled');$('openPreview').setAttribute('aria-disabled','false');
  updatePreviewModeButtons();
}
function showAppInPreview(run){
  if(!run)return;
  if(run.archivedOnly){showAtelierInPreview(run);return;}
  previewMode='app';
  $('atelierPanel').classList.add('hidden');
  document.querySelector('.preview-panel').classList.remove('atelier-active');
  const url=run.previewUrl||(run.appId?`/${run.appId}/`:'/cartlab/');
  const originUrl=new URL(url,window.location.origin);
  $('openPreview').href=originUrl.href;$('openPreview').classList.remove('disabled');$('openPreview').setAttribute('aria-disabled','false');
  $('openPreview').textContent='↗ Open app';
  $('reloadPreview').disabled=false;
  $('previewAddress').textContent=originUrl.host+originUrl.pathname;
  $('previewEmpty').classList.add('hidden');$('previewFrame').classList.remove('hidden');
  $('previewCaption').textContent=run.status==='passed'
    ? (run.verificationLimits?.length?'Desktop Kane checks passed; mobile-width layout not independently tested.':'Verified: saved Kane objectives passed on the recorded application source.')
    : 'Preview may contain unfinished code. Only authentic Kane evidence establishes a PASS.';
  if(lastFrameUrl!==originUrl.href){$('previewFrame').src=originUrl.href;lastFrameUrl=originUrl.href;knownCompletedAt='';previewVersionProject='';previewVersion='';}
  $('previewLiveStatus').textContent='LIVE RELOAD';
  updatePreviewModeButtons();
}

function selectRun(id){
  selectedRunId=id;requestedProjectId=null;previewMode='atelier';
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
  // Compact checklist: one line per task + its Kane checks. Full detail lives in the Live loop.
  const tasks=run.tasks || [];
  $('taskCount').textContent=`${tasks.length} task${tasks.length===1?'':'s'}`;
  if(!tasks.length){$('taskCards').innerHTML='<div class="empty-pane">Your coding agent is preparing a testable implementation plan.</div>';return;}
  // A check claimed by several tasks is run once, after the LAST of them: list it under that task only.
  const gateTaskOf=(checkId)=>{let last=-1;tasks.forEach((t,i)=>{if((t.acceptanceIds||[]).includes(checkId))last=i;});return last;};
  const taskMarkup=tasks.map((task,index)=>{
    const claimed=(run.generatedFlows || []).filter((flow)=>(task.acceptanceIds || []).includes(flow.id));
    const checks=claimed.filter((flow)=>gateTaskOf(flow.id)===index);
    const later=claimed.filter((flow)=>gateTaskOf(flow.id)!==index);
    const laterNote=later.length?`<p class="tc-later">Also needed for ${later.length} check${later.length===1?'':'s'} Kane runs after task ${[...new Set(later.map(f=>gateTaskOf(f.id)+1))].join(', ')}</p>`:'';
    const live=liveTaskPhase(run,task);
    const taskProof=taskVerificationState(run,task);
    const state=live?.label || taskProof.label;
    const tone=task.status==='verified'?'passed':/fail|error|inconclusive/i.test(String(task.status)+state)?'failed':live?'running':'';
    const checkRows=checks.map((check)=>{
      const checkId=`feature-${check.id}`;
      const attempts=flowAttempts(run,checkId);
      const st=taskCheckState(run,task,check);
      const priorFailed=attempts.some((v)=>v.verdict==='failed'||v.verdict==='precheck_failed');
      // Short status for the narrow sidebar; the full sentence stays in the tooltip.
      const others=(run.tasks||[]).map((t,i)=>({t,n:i+1})).filter(({t})=>t.id!==task.id&&(t.acceptanceIds||[]).includes(check.id)&&!['implemented','verified','candidate'].includes(t.status)).map(x=>x.n);
      const short=st.kind==='running'?'Testing now'
        :st.kind==='passed'?((run.testRevisions||[]).some(r=>r.checkId===check.id)?'PASS on fixed test (v2)'
          :priorFailed?((run.repairs||[]).some(r=>attempts.some(v=>(v.verdict==='failed'||v.verdict==='precheck_failed')&&v.gate===r.gate))?'PASS after repair':'PASS on retest')
          :'PASS')
        :st.kind==='failed'?(/diagnosing/.test(st.label)?'FAIL · diagnosing':/repairing/.test(st.label)?'FAIL · repairing':'FAIL')
        :st.kind==='waiting'?(others.length?`After task ${others.join(', ')}`:'Waiting for code')
        :st.kind==='unproven'?'Incomplete':'Queued';
      const kind=st.kind==='running'?'running':st.kind==='passed'?'passed':st.kind==='failed'?'failed':'pending';
      return `<li class="tc-check tc-${kind}" title="${escape(check.name)} — ${escape(st.label)}${st.shared?' (check shared by several tasks)':''}"><span class="tc-mark">${kind==='passed'?'✓':kind==='failed'?'✕':kind==='running'?'◉':'○'}</span><span class="tc-name">${escape(check.name)}</span><span class="tc-state">${escape(short)}</span></li>`;
    }).join('');
    return `<div class="tc-task tc-${tone}"><div class="tc-head"><span class="tc-num">${task.status==='verified'?'✓':index+1}</span><strong>${escape(task.title)}</strong><span class="tc-badge">${escape(state)}</span></div>${checkRows?`<ul class="tc-checks">${checkRows}</ul>`:''}${laterNote}</div>`;
  }).join('');
  replaceKeepingHistory('taskCards',taskMarkup);
}
function progressInfo(run){
  const stage=run.stage || 'planning', stop=run.status==='passed'||stopStatuses.has(run.status);
  if(run.status==='passed')return {title:'Your app passed its Kane checks', detail:run.verificationLimits?.length
    ? 'All executable Kane objectives passed. Mobile-width layout was not tested in this desktop browser session.'
    : 'All required browser objectives passed on the tested source.',pct:100};
  if(run.status==='interrupted')return {title:run.stoppedByUser?'Stopped by you':'Build interrupted',detail:run.interruptionReason || 'The server stopped before this run finished. Its source and previous Kane evidence are preserved.',pct:100};
  if(stop)return {title:run.status==='verification_inconclusive'?(run.failure?.unavailableCapability?'Browser test could not finish':'Verification disputed — review evidence'):'The workflow stopped',detail:run.timeline?.at(-1)?.detail || 'See the saved log for details.',pct:100};
  if(run.activeGate==='Final full suite')return {title:'Final evidence-backed verification',detail:run.currentFlow ? `Running Kane: ${run.currentFlow}` : 'Reusing exact-source PASS evidence where safe; rerunning checks that require it.',pct:88};
  if(stage==='planning')return {title:'Coding agent is preparing the plan',detail:'Creating sequential tasks and independent Kane browser objectives.',pct:12};
  if(stage==='implementing'){
    const active=run.tasks?.find((t)=>t.status==='implementing');
    const index=run.tasks?.findIndex((t)=>t.id===active?.id) ?? 0;
    return {title:`${agentNames[run.agentId] || 'Coding agent'} is writing code`,detail:active?.title || 'Implementing the next task.',pct:24+(Math.max(0,index)*26)};
  }
  if(stage==='verifying'||stage==='reverifying')return {title:stage==='reverifying'?'Kane is retesting after a repair':'Kane is testing in Chrome',detail:run.currentFlow ? `Now verifying: ${run.currentFlow}` : 'Starting the next real browser check.',pct:63};
  if(stage==='examining')return {title:'Independent examiner reviewing Kane evidence',detail:'Checking whether this is an application defect, a flawed test, or unresolved. No repair has started.',pct:70};
  if(stage==='diagnosing')return {title:'Agent investigating a Kane failure',detail:run.failure?.summary || 'Reading independent browser evidence and identifying the cause.',pct:71};
  if(stage==='repairing')return {title:'Agent repairing the application',detail:run.plans?.at(-1)?.plan?.diagnosis || 'Fixing the source before an independent Kane retest.',pct:75};
  if(stage==='final_verification')return {title:'Final evidence-backed verification',detail:run.currentFlow || 'Checking current-source evidence and protected regressions.',pct:88};
  return {title:'KaneGuard is working',detail:run.currentFlow || 'Preparing the next step.',pct:35};
}
function renderWorkbench(run){
  currentRun=run;
  const title=run.featureTitle || run.appLabel || 'Creating your app';
  $('runTitle').textContent=title;
  $('runSubtitle').textContent=`${agentNames[run.agentId] || 'Coding agent'}${run.examinerAgentId && run.examinerAgentId!==run.agentId?' · examiner '+(agentNames[run.examinerAgentId]||run.examinerAgentId):''} · ${run.planSummary || run.request || 'Preparing your project'}`.slice(0,220);
  $('runStatus').textContent=(run.stoppedByUser?'stopped':statusLabel(run.status)).toUpperCase();$('runStatus').className=`status-pill ${statusClass(run.status)}`;
  $('elapsed').textContent=elapsed(run);
  const info=progressInfo(run);$('currentAction').textContent=info.title;$('currentDetail').textContent=info.detail;$('progressBar').style.width=`${info.pct}%`;
  $('progressBar').classList.toggle('is-passed',run.status==='passed');
  $('stepSpinner').className=`step-spinner ${run.status==='passed'?'done':stopStatuses.has(run.status)?'failed':''}`;
  if(previewMode==='atelier'||previewMode==='workflow')showAtelierInPreview(run);
  else {showAppInPreview(run);void pollPreviewSource(run);}
  $('openLog').href=sourceLink(run,'live.log');
  const evidence=run.artifacts || {};
  for(const [id,key] of [['evidencePlan','featurePlan'],['evidenceDiff','sourceDiff'],['evidenceRequest','userRequest']]) {
    const file=evidence[key];const link=$(id);link.href=file?sourceLink(run,file):'#';link.style.opacity=file?'1':'.4';link.style.pointerEvents=file?'auto':'none';
  }
  const resume=['agent_error','failed','infrastructure_error','verification_inconclusive'].includes(run.status)&&!!run.artifacts?.featurePlan&&!!run.changedFiles?.length&&!busy;
  const approvedRevision=run.status==='verification_inconclusive'&&(run.testDisputes||[]).some(d=>d.decision==='approve_new_version'&&d.proposedObjective);
  const canContinue=(['interrupted','agent_error'].includes(run.status)||approvedRevision)&&!!run.artifacts?.featurePlan&&!busy&&!(run.tasks||[]).every(t=>t.status==='verified'||t.carriedOver);
  $('continueButton').lastChild.textContent=approvedRevision?' Continue with approved test':' Continue run';
  $('continueButton').classList.toggle('hidden',!canContinue);
  if(canContinue){const next=(run.tasks||[]).find(t=>t.status!=='verified'&&!t.carriedOver);$('continueButton').title=approvedRevision?'Seal your approved test as a new version, re-run Kane with it, then build the remaining tasks. The original FAIL stays on record.':`Carry on from ${next?.title||'the next task'}: same plan, same locked Kane checks. Tasks Kane already verified are kept and rechecked in the final suite.`;}
  $('resumeButton').classList.toggle('hidden',!resume||canContinue);
  $('stopButton').classList.toggle('hidden',run.status!=='running');
  if(run.status!=='running')stopping=false;
  syncStopButtons();
  $('deleteRunButton').disabled=run.status==='running';
  $('logsPanel').querySelector('.live-bubble')?.classList.toggle('hidden',run.status!=='running');
  const receipt=`/api/runs/${encodeURIComponent(run.id)}/receipt`;
  $('trustReceipt').href=receipt;
  $('kaneAssuranceSource').href=`/api/runs/${encodeURIComponent(run.id)}/assurance-source.md`;
  // Tasks + the Live loop already list every Kane check, so the panel no longer repeats
  // them. It only appears when there is something extra to act on: a Test Court review.
  const disputes=run.testDisputes||[],exams=run.examinerReviews||[];
  let review='';
  if(disputes.length||exams.length){
    const reviews=exams.map(r=>`<p>Examiner (${escape(r.reviewerAgentId)}): <strong>${escape(r.finding.replaceAll('_',' '))}</strong> · ${escape(r.rationale).slice(0,360)} ${r.transcriptFile?`<a href="${sourceLink(run,r.transcriptFile)}" target="_blank" rel="noopener">Review evidence</a>`:''}</p>`).join('');
    const open=disputes.map((d,i)=>`<div class="assurance-row" style="display:block"><strong>Test dispute ${i+1} · ${escape(d.decision.replaceAll('_',' '))}</strong><p>${escape(d.flowName)}</p>${d.proposedObjective?`<p>New candidate (NOT executed): ${escape(d.proposedObjective).slice(0,380)}</p>`:''}<p>Original SHA-256: ${escape(d.originalObjectiveHash)}${d.proposedObjectiveHash?' · Proposed: '+escape(d.proposedObjectiveHash):''}</p>${d.decision==='pending_human_review'&&run.status!=='running'?`<div class="verify-links">${d.proposedObjective?`<button type="button" data-review-dispute="${i}" data-review-decision="approve_new_version">Approve candidate</button>`:'<span>No proposed replacement objective</span>'}<button type="button" data-review-dispute="${i}" data-review-decision="reject">Reject proposal</button></div>`:''}<p>${escape(d.decisionNote||'The original FAIL remains; an examiner opinion does not establish a PASS.')}</p></div>`).join('');
    review=`<div class="assurance-review"><strong>Independent Test Court · ${exams.length} review(s)</strong>${reviews}${open}</div>`;
  }
  $('assuranceMatrix').innerHTML=review;
  $('reviewPanel').classList.toggle('hidden',!review);
  renderTaskRows(run);
  connectStream(run.id);
}
async function pollPreviewSource(run){
  if(previewMode!=='app' || sourcePollInFlight || !run?.appId || !/^app-[a-z0-9-]{5,54}$/.test(run.appId) || view!=='workbench')return;
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
  stream.addEventListener('snapshot',(evt)=>{try {liveLines=JSON.parse(evt.data).lines || [];renderLog();scheduleAtelierRender(id);}catch{}});
  stream.addEventListener('line',(evt)=>{try{liveLines.push(JSON.parse(evt.data).line);if(liveLines.length>8000)liveLines=liveLines.slice(-7000);renderLog();scheduleStreamRefresh(id);scheduleAtelierRender(id);}catch{}});
  stream.addEventListener('error',()=>{ /* Native EventSource retries; no invented terminal events. */ });
}
async function refresh(){
  if(refreshInFlight)return;
  refreshInFlight=true;
  let healthResponded=false;
  try {
    const [runResult,projectResult,healthResult]=await Promise.allSettled([
      fetch('/api/runs',{cache:'no-store'}),fetch('/api/projects',{cache:'no-store'}),fetch('/api/health',{cache:'no-store'})
    ]);
    if(healthResult.status!=='fulfilled' || !healthResult.value.ok)throw new Error('Engine health endpoint unavailable');
    const health=await healthResult.value.json();healthResponded=true;
    busy=!!health.busy;
    $('connection').classList.remove('offline');$('connection').classList.add('hidden');$('connection').innerHTML='';
    if(runResult.status!=='fulfilled'||projectResult.status!=='fulfilled'||!runResult.value.ok||!projectResult.value.ok)throw new Error('Run/project data unavailable');
    runs=await runResult.value.json();projects=await projectResult.value.json();
    const installedAgents=agents.filter(a=>a.installed);
    const missing=[];if(!health.kane?.installed)missing.push('Kane CLI');if(!installedAgents.length)missing.push('all coding agents');
    $('missingTools').textContent=missing.length?`Missing locally: ${missing.join(', ')}. Install and authenticate before running.`:'';
    $('missingTools').classList.toggle('hidden',!missing.length);
    $('createButton').disabled=busy || !installedAgents.length || health.kane?.installed===false;
    $('connectButton').disabled=busy || !installedAgents.length || health.kane?.installed===false;
    if(requestedProjectId) {
      const newRun=runs.find((item)=>item.projectId===requestedProjectId);
      if(newRun){selectedRunId=newRun.id;requestedProjectId=null;setScreen('workbench');}
    }
    // v32.10: page load / refresh always starts on Create with the sketch preview; a running build is one click away in Projects.
    const selected=runs.find((run)=>run.id===selectedRunId);
    if(selected && view==='workbench')renderWorkbench(selected);
    if(view==='projects')renderProjects();
  } catch {
    // A broken runs/projects endpoint is not proof that the engine is offline.
    $('connection').classList.remove('hidden');$('connection').classList.toggle('offline',!healthResponded);
    $('connection').innerHTML=healthResponded
      ? '<span class="connection-dot"></span> Engine online · data unavailable'
      : '<span class="connection-dot"></span> Engine offline';
  } finally{refreshInFlight=false;}
}
async function startBuild(evt){
  evt.preventDefault();if(busy)return;
  const prompt=$('createPrompt').value.trim(), agentId=document.querySelector('input[name="agent"]:checked')?.value || agents.find(a=>a.installed)?.id;
  clearIssue();if(prompt.length<8){issue('Describe the app in at least 8 characters.');return;}
  $('createButton').disabled=true;$('createButton').textContent='Creating your workspace…';
  try {
    const response=await fetch('/api/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt,agentId,examinerAgentId:$('examinerAgent').value||undefined,blindBuilder:$('blindBuilder').checked,sabotage:$('sabotage').checked})});
    const payload=await response.json();if(!response.ok)throw new Error(payload.error||'Unable to create project');
    requestedProjectId=payload.project.id;previewMode='atelier';selectedProjectRunId=null;
    selectedRunId=null;currentRun=null;lastFrameUrl='';knownCompletedAt='';previewVersionProject='';previewVersion='';
    $('createPrompt').value='';updateCounter();
    selectPanel('activity');setScreen('workbench');
    await refresh();
  } catch(error){issue(error.message);}finally{$('createButton').textContent='Create my app →';$('createButton').disabled=busy;}
}
async function connectProject(evt){
  evt.preventDefault();if(busy)return;
  const folder=$('connectFolder').value.trim(),prompt=$('connectPrompt').value.trim(),preview=$('connectPreview').value.trim();
  const agentId=document.querySelector('input[name="connectedAgent"]:checked')?.value || agents.find(a=>a.installed)?.id;
  const notice=$('connectNotice');notice.classList.add('hidden');
  if(!folder||prompt.length<8){notice.textContent='Provide a project folder and a concrete change request.';notice.classList.remove('hidden');return;}
  $('connectButton').disabled=true;$('connectButton').textContent='Inspecting local project…';
  const post=async(route,data)=>{
    const res=await fetch(route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
    const body=await res.json();if(!res.ok){const error=new Error(body.error||'Unable to connect project');error.project=body.project;throw error;}
    return body;
  };
  try {
    const details=await post('/api/connected/inspect',{folder});
    if(!window.confirm(`Connect ${details.label} (${details.framework})?\n\nFolder: ${details.path}\nStartup: ${preview?'Use running preview '+preview:`npm run ${details.script}`}\n\nThe selected coding agent will edit this existing project. KaneGuard will never delete its source. Continue?`))return;
    $('connectButton').textContent='Starting local preview…';
    const connected=await post('/api/connected',{folder,preview:preview||undefined,agentId});
    const projectId=connected.project.id;
    requestedProjectId=projectId;previewMode='atelier';selectedProjectRunId=null;
    $('connectButton').textContent='Starting agent and Kane…';
    await post('/api/build',{appId:projectId,prompt,agentId,examinerAgentId:$('connectedExaminer').value||undefined,blindBuilder:$('connectedBlindBuilder').checked});
    selectedRunId=null;currentRun=null;lastFrameUrl='';previewVersionProject='';previewVersion='';
    selectPanel('activity');setScreen('workbench');await refresh();
  } catch(error) {
    notice.textContent=error.message;notice.classList.remove('hidden');
    if(error.project) await refresh();
  } finally {$('connectButton').textContent='Connect & verify →';$('connectButton').disabled=busy;}
}
async function decideDisputeFromUI(index,decision){
  if(!currentRun||busy)return;
  const note=window.prompt(decision==='approve_new_version'
    ? 'Reason for accepting this NEW, still-unverified test candidate (original FAIL remains):'
    : 'Reason for rejecting the proposed test revision:');
  if(note==null)return;
  if(note.trim().length<12){alert('Provide at least 12 characters of review rationale.');return;}
  try{
    const response=await fetch(`/api/runs/${encodeURIComponent(currentRun.id)}/test-disputes/${index}/decision`,{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({decision,note})});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'Review failed');
    await refresh();
  }catch(error){alert(error.message);}
}
async function deleteProjectFromUI(id){
  if(busy){alert('A build or verification is active. Delete projects after it stops.');return;}
  const project=projects.find((p)=>p.id===id);
  const connected=project?.kind==='connected';
  if(!project || !window.confirm(connected
    ? `Disconnect "${project.label}"?\n\nYour original project files and saved Kane evidence will be preserved.`
    : `Permanently delete "${project.label}"?\n\nThis deletes generated source files and ALL associated Kane run evidence. This cannot be undone.`))return;
  try {
    const response=await fetch(`/api/projects/${encodeURIComponent(id)}`,{method:'DELETE'});
    const payload=await response.json();if(!response.ok)throw new Error(payload.error||'Delete failed');
    const deleted=new Set(payload.deletedRuns || []);
    if(connected && currentRun?.projectId===id){selectedRunId=null;currentRun=null;}
    if(deleted.has(selectedProjectRunId))selectedProjectRunId=null;
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
    if(selectedProjectRunId===id)selectedProjectRunId=null;
    if(selectedRunId===id){selectedRunId=null;currentRun=null;stream?.close();stream=null;streamedRunId=null;}
    setScreen('projects');await refresh();
  }catch(error){alert(error.message);}
}
function syncStopButtons(){
  document.querySelectorAll('[data-stop-run]').forEach(b=>{b.disabled=stopping;if(stopping)b.lastChild.textContent=' Stopping…';});
}
async function stopRun(){
  if(stopping)return;
  if(!confirm('Stop this run now?\n\nThe coding agent and Kane CLI will be terminated. Files the agent already changed are kept, and Kane results so far stay visible.'))return;
  stopping=true;syncStopButtons();
  try{
    const res=await fetch('/api/stop',{method:'POST'});
    const body=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error(body.error||'Could not stop the run');
  }catch(error){stopping=false;syncStopButtons();alert(error.message);return;}
  void refresh();
}
async function continueRun(){
  if(!currentRun||busy)return;const button=$('continueButton');button.disabled=true;
  try{
    const res=await fetch(`/api/runs/${encodeURIComponent(currentRun.id)}/continue`,{method:'POST'});
    const body=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error(body.error||'Could not continue this run');
    const from=currentRun.id;
    for(let i=0;i<10;i++){await refresh();const next=runs.find(r=>r.continuedFrom===from);if(next){previewMode='atelier';selectRun(next.id);break;}await new Promise(r=>setTimeout(r,400));}
  }catch(error){alert(error.message);}finally{button.disabled=false;}
}
async function resume(){if(!currentRun||busy)return;const button=$('resumeButton');button.disabled=true;try{
  const res=await fetch(`/api/runs/${encodeURIComponent(currentRun.id)}/resume`,{method:'POST'});
  const data=await res.json();if(!res.ok)throw new Error(data.error||'Unable to resume');
  selectedRunId=null;setScreen('projects');await refresh();
}catch(error){alert(error.message);}finally{button.disabled=false;}}

// v25: liquid workbench. Width is local UI preference; never part of a run.
const layoutRoot=document.querySelector('.studio-layout');
const divider=$('paneDivider');
const SIDEBAR_STORAGE='kaneguard.sidebar.width.v25';
let paneMode='split';
let paneWidth=358;
const layoutBounds=()=>({min:280,max:Math.max(280,layoutRoot.getBoundingClientRect().width-340)});
function updateDividerWidth(width,persist=true){
  const {min,max}=layoutBounds();
  paneWidth=Math.min(max,Math.max(min,Math.round(width)));
  layoutRoot.style.setProperty('--studio-sidebar-width',`${paneWidth}px`);
  divider.setAttribute('aria-valuemin',String(min));
  divider.setAttribute('aria-valuemax',String(max));
  divider.setAttribute('aria-valuenow',String(paneWidth));
  divider.setAttribute('aria-valuetext',`${paneWidth} pixels wide`);
  if(persist){try{localStorage.setItem(SIDEBAR_STORAGE,String(paneWidth));}catch{}}
}
function setPaneMode(next){
  paneMode=['split','details','preview'].includes(next)?next:'split';
  layoutRoot.classList.toggle('layout-left-max',paneMode==='details');
  layoutRoot.classList.toggle('layout-preview-max',paneMode==='preview');
  for(const [id,mode] of [['layoutDetails','details'],['layoutSplit','split'],['layoutPreview','preview']]){
    const button=$(id),selected=paneMode===mode;
    button.classList.toggle('active',selected);
    button.setAttribute('aria-pressed',String(selected));
  }
}
try{const remembered=Number(localStorage.getItem(SIDEBAR_STORAGE));if(Number.isFinite(remembered)&&remembered>0)paneWidth=remembered;}catch{}
updateDividerWidth(paneWidth,false);
$('layoutDetails').addEventListener('click',()=>setPaneMode(paneMode==='details'?'split':'details'));
$('layoutSplit').addEventListener('click',()=>setPaneMode('split'));
$('layoutPreview').addEventListener('click',()=>setPaneMode(paneMode==='preview'?'split':'preview'));
let resizing=false;
divider.addEventListener('pointerdown',(event)=>{
  if(event.button!==0 || window.matchMedia('(max-width: 700px)').matches)return;
  if(paneMode!=='split')setPaneMode('split');
  resizing=true;divider.setPointerCapture(event.pointerId);
  layoutRoot.classList.add('pane-is-resizing');
  event.preventDefault();
});
divider.addEventListener('pointermove',(event)=>{
  if(!resizing)return;
  updateDividerWidth(event.clientX-layoutRoot.getBoundingClientRect().left);
});
function endResize(){resizing=false;layoutRoot.classList.remove('pane-is-resizing');}
divider.addEventListener('pointerup',endResize);
divider.addEventListener('pointercancel',endResize);
divider.addEventListener('lostpointercapture',endResize);
divider.addEventListener('dblclick',()=>{setPaneMode('split');updateDividerWidth(358);});
divider.addEventListener('keydown',(event)=>{
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
  event.preventDefault();setPaneMode('split');
  const {min,max}=layoutBounds();
  updateDividerWidth(event.key==='Home'?min:event.key==='End'?max:paneWidth+(event.key==='ArrowLeft'?-1:1)*(event.shiftKey?60:20));
});
window.addEventListener('resize',()=>updateDividerWidth(paneWidth,false));

document.addEventListener('click',(event)=>{
  const review=event.target.closest('[data-review-dispute]');
  if(review){void decideDisputeFromUI(Number(review.dataset.reviewDispute),review.dataset.reviewDecision);return;}
  const delProject=event.target.closest('[data-delete-project]');if(delProject){void deleteProjectFromUI(delProject.dataset.deleteProject);return;}
  const delRun=event.target.closest('[data-delete-run]');if(delRun){void deleteRunFromUI(delRun.dataset.deleteRun);return;}
  const mode=event.target.closest('[data-create-mode]');if(mode){selectCreateMode(mode.dataset.createMode);return;}
  const nav=event.target.closest('[data-screen]');if(nav){setScreen(nav.dataset.screen);return;}
  const idea=event.target.closest('[data-idea]');if(idea){setScreen('create');$('createPrompt').value=idea.dataset.idea;updateCounter();$('createPrompt').focus();return;}
  
  const workflow=event.target.closest('[data-open-project-workflow]');if(workflow){selectProjectWorkflow(workflow.dataset.openProjectWorkflow);return;}
  const paneWorkflow=event.target.closest('[data-open-in-pane-workflow]');if(paneWorkflow){event.preventDefault();if(currentRun)showAtelierInPreview(currentRun);return;}
  const open=event.target.closest('[data-open-run]');if(open){selectRun(open.dataset.openRun);return;}
});
$('createForm').addEventListener('submit',startBuild);
$('connectForm').addEventListener('submit',connectProject);
$('createPrompt').addEventListener('input',updateFrameworkHint);
$('useExistingInstead').addEventListener('click',()=>selectCreateMode('existing'));
// ---- Folder picker for "Existing app": the local server lists folders (browsers can't expose real paths).
const FOLDER_STORAGE='kaneguard-last-folder';
let folderState=null;
async function loadFolder(target){
  $('folderList').innerHTML='<li class="fp-empty">Loading…</li>';
  try{
    const res=await fetch(`/api/fs/folders?path=${encodeURIComponent(target||'')}`,{cache:'no-store'});
    const data=await res.json();
    if(!res.ok)throw new Error(data.error||'Folder cannot be opened');
    folderState=data;renderFolder();
    try{localStorage.setItem(FOLDER_STORAGE,data.path);}catch{}
  }catch(error){$('folderList').innerHTML=`<li class="fp-empty">${escape(error.message)}</li>`;if(target)setTimeout(()=>loadFolder(''),900);}
}
function renderFolder(){
  const d=folderState;
  $('folderRoots').innerHTML=d.roots.map(r=>`<button type="button" class="fp-root ${d.path===r.path||d.path.startsWith(r.path+'/')?'active':''}" data-folder="${escape(r.path)}">${escape(r.label)}</button>`).join('');
  $('folderPath').textContent=friendlyProjectPath(d.path);$('folderPath').title=d.path;
  $('folderUp').disabled=!d.parent;$('folderUp').dataset.folder=d.parent||'';
  const projects=d.entries.filter(e=>e.isProject),others=d.entries.filter(e=>!e.isProject);
  const row=(e)=>`<li class="fp-item ${e.isProject?'is-project':''}"><button type="button" class="fp-open" data-folder="${escape(e.path)}">${icon(e.isProject?'folder-code':'folder')}<span>${escape(e.name)}</span>${e.isProject?'<em>package.json</em>':''}</button>${e.isProject?`<button type="button" class="fp-pick" data-pick="${escape(e.path)}">Use</button>`:''}</li>`;
  $('folderList').innerHTML=d.entries.length?[...projects,...others].map(row).join(''):'<li class="fp-empty">No folders here.</li>';
  const c=d.current;
  $('folderUse').disabled=!(c.isProject&&!c.problem);
  $('folderCurrent').innerHTML=c.isProject?(c.problem?`<b class="bad">Can't connect:</b> ${escape(c.problem)}`:`<b>${escape(c.label)}</b> · ${escape(c.framework)} · npm run ${escape(c.script)}`):'Open a folder that contains a <code>package.json</code>';
}
function chooseFolder(p){
  $('connectFolder').value=p;$('folderPicker').close();
  const c=folderState?.current;
  const hint=folderState?.path===p&&c?.label?`${c.label} · ${c.framework} · npm run ${c.script}`:'Selected — details are checked when you connect';
  $('folderDetected').textContent=hint;$('folderDetected').classList.remove('hidden');
}
$('browseFolder').addEventListener('click',()=>{
  let start=$('connectFolder').value.trim();
  if(!start){try{start=localStorage.getItem(FOLDER_STORAGE)||'';}catch{}}
  $('folderPicker').showModal();loadFolder(start);
});
$('folderPicker').addEventListener('click',(event)=>{
  if(event.target===$('folderPicker')){$('folderPicker').close();return;}
  const pick=event.target.closest('[data-pick]');
  if(pick){loadFolder(pick.dataset.pick).then(()=>{if(folderState?.current?.isProject&&!folderState.current.problem)chooseFolder(folderState.path);});return;}
  const open=event.target.closest('[data-folder]');
  if(open&&open.dataset.folder)loadFolder(open.dataset.folder);
});
$('folderUse').addEventListener('click',()=>{if(folderState)chooseFolder(folderState.path);});
for(const id of ['folderCancel','folderPickerClose'])$(id).addEventListener('click',()=>$('folderPicker').close());
$('connectFolder').addEventListener('input',()=>$('folderDetected').classList.add('hidden'));
$('createPrompt').addEventListener('input',updateCounter);
$('showAtelier').addEventListener('click',()=>{const r=view==='workbench'?currentRun:runs.find(x=>x.id===selectedProjectRunId);if(r)showAtelierInPreview(r);});
$('showLiveApp').addEventListener('click',()=>{const r=view==='workbench'?currentRun:runs.find(x=>x.id===selectedProjectRunId);if(r){previewMode='app';showAppInPreview(r);}});
$('reloadPreview').addEventListener('click',()=>{if(previewMode==='atelier'){const r=view==='workbench'?currentRun:runs.find(x=>x.id===selectedProjectRunId);if(r)showAtelierInPreview(r);return;}if($('previewFrame').classList.contains('hidden'))return;const frame=$('previewFrame');if(frame.src)frame.src=frame.src;});
$('resumeButton').addEventListener('click',resume);
$('continueButton').addEventListener('click',continueRun);
// Stop lives in the run panel and the Live loop header (re-rendered), so delegate.
document.addEventListener('click',(evt)=>{if(evt.target.closest?.('[data-stop-run]')){evt.preventDefault();void stopRun();}});
$('deleteRunButton').addEventListener('click',()=>{if(currentRun)deleteRunFromUI(currentRun.id);});
hydrateIcons();updateCounter();selectPanel('activity');setPreviewEmpty();
fetch('/api/agents').then((r)=>r.json()).then((data)=>{agents=data.agents||[];renderAgents();}).catch(()=>{});
refresh();setInterval(refresh,1600);setInterval(()=>{if(currentRun&&view==='workbench')$('elapsed').textContent=elapsed(currentRun);},1000);
