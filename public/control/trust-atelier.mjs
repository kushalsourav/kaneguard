/** Live loop view (formerly "Trust Atelier").
 * Shows what is happening inside the closed loop while it happens: which stage
 * is active, what the coding agent is touching, and every browser action Kane
 * reports. Read-only: built from the saved run, the live log stream and saved
 * Kane transcripts. It never asserts new proof or infers a PASS.
 */
import {recordedCheckProgress} from './assurance-progress.mjs';

const esc = (v) => String(v ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const names = {antigravity:'Antigravity',cursor:'Cursor',claude:'Claude Code',codex:'Codex'};
const stops = new Set(['failed','agent_error','safety_error','infrastructure_error','verification_inconclusive','precheck_failed','interrupted']);
const safeName = (v) => typeof v==='string' && /^[\w.\-]+$/.test(v) && !v.startsWith('.');
const httpsUrl = (u) => typeof u==='string' && /^https:\/\//.test(u) ? u : null;
const ACTION = {navigate:'Open',click:'Click',press_key:'Key',type:'Type',input:'Type',fill:'Type',scroll:'Scroll',assert:'Assert',analyze:'Look',wait:'Wait',select:'Select',hover:'Hover',extract:'Read',step:'Step'};
const AGENT_ICON = {edit:'✎',read:'◎',run:'$',browse:'◇',tool:'•',note:'“'};

function phase(run) {
  if(run.status==='passed')return {label:'Recorded PASS',tone:'passed',note:'Required checks passed on the recorded source. Review the Trust Receipt for scope and limitations.'};
  if(run.status==='verification_inconclusive')return {label:'Verification inconclusive',tone:'uncertain',note:'Conflicting or insufficient evidence. Original failed checks remain on record.'};
  if(run.status==='interrupted')return {label:'Interrupted',tone:'uncertain',note:'The workflow stopped before finishing. Earlier evidence remains available.'};
  if(stops.has(run.status))return {label:'Blocked — review evidence',tone:'failed',note:'The workflow did not earn an acceptance verdict.'};
  const p={planning:'Planning checks',implementing:'Builder editing source',verifying:'Kane verifying',reverifying:'Kane retesting',examining:'Examiner reviewing',diagnosing:'Investigating failure',repairing:'Builder repairing source',final_verification:'Final verification'};
  return {label:p[run.stage]||'Awaiting evidence',tone:'pending',note:run.currentFlow?`Current check: ${run.currentFlow}`:'No final trust decision has been issued.'};
}

/** Which loop station is active right now (only while the run is live). */
function activeStation(run){
  if(run.status!=='running')return null;
  const s=String(run.stage||'');
  if(s==='planning'||s==='created')return 'plan';
  if(s==='implementing')return 'build';
  if(['verifying','reverifying','final_verification'].includes(s))return 'kane';
  if(s==='diagnosing'||s==='examining')return 'diagnose';
  if(s==='repairing')return 'repair';
  return null;
}

export function atelierModel(run){
  const progress=recordedCheckProgress(run);
  const status=phase(run);
  const reviews=run.examinerReviews||[];
  const disputes=run.testDisputes||[];
  const tasks=run.tasks||[];
  const ver=Array.isArray(run.verification)?run.verification:[];
  const examsIndependent=!!run.examinerAgentId && run.examinerAgentId!==run.agentId;
  const examinerName=run.examinerAgentId ? (names[run.examinerAgentId]||run.examinerAgentId) : 'Not configured';
  const active=run.status==='running';
  const builderBusy=active&&['implementing','repairing','diagnosing'].includes(run.stage);
  const browserBusy=active&&['verifying','reverifying','final_verification'].includes(run.stage);
  const examinerBusy=active&&run.stage==='examining';
  const latest=progress.latest;
  const checks=(run.generatedFlows||[]).map((check)=>{
    const result=latest.get(check.id);
    const isCurrent=browserBusy && run.currentFlowId===`feature-${check.id}`;
    const verdict=isCurrent?'running':result?.verdict==='passed'?'passed':['failed','precheck_failed'].includes(result?.verdict)?'failed':result?.verdict==='verification_inconclusive'?'uncertain':'pending';
    return {id:check.id,name:check.name||check.id,verdict,evidence:result?.stdoutFile||null,testUrl:httpsUrl(result?.evidenceUrl),previousResult:isCurrent&&result?.verdict==='passed'};
  });
  const failures=ver.filter(v=>['failed','precheck_failed'].includes(v.verdict));
  const fixedIds=new Set(ver.filter((v,i)=>v.verdict==='failed'&&ver.slice(i+1).some(x=>x.flowId===v.flowId&&x.verdict==='passed')).map(v=>v.flowId));
  const repairs=Array.isArray(run.repairs)?run.repairs:[];
  const latestReview=reviews.at(-1)||null;
  const cert=run.assurance||null;
  const mapped=Number.isInteger(cert?.proven)&&Number.isInteger(cert?.total)?`${cert.proven}/${cert.total} mapped requirements certified`:'Requirement certification unavailable';
  const station=activeStation(run);
  const doneTasks=tasks.filter(t=>['implemented','verified','candidate'].includes(t.status)).length;
  const stations=[
    {key:'plan',name:'Plan',actor:names[run.examinerAgentId||run.agentId]||'Agent',count:tasks.length?`${tasks.length} tasks · ${(run.generatedFlows||[]).length} checks`:'—',done:tasks.length>0},
    {key:'build',name:'Build',actor:names[run.agentId]||'Coding agent',count:tasks.length?`${doneTasks}/${tasks.length} tasks coded`:'—',done:doneTasks>0},
    {key:'kane',name:'Kane test',actor:'Kane CLI · real Chrome',count:ver.length?`${ver.length} runs · ${failures.length} FAIL`:'—',done:ver.length>0,bad:failures.length>0},
    {key:'diagnose',name:'Diagnose',actor:names[run.examinerAgentId||run.agentId]||'Agent',count:repairs.length||failures.length?`${Math.max(repairs.length,0)} diagnosis${repairs.length===1?'':'es'}`:'only on FAIL',done:repairs.length>0,optional:true},
    {key:'repair',name:'Repair',actor:names[run.agentId]||'Coding agent',count:repairs.length?`${repairs.length} repair${repairs.length===1?'':'s'} · ${fixedIds.size} fixed`:'only on FAIL',done:repairs.length>0,optional:true},
    {key:'verdict',name:'Verdict',actor:'Kane evidence only',count:run.status==='running'?'pending':String(run.status||'').replaceAll('_',' '),done:run.status!=='running',tone:status.tone}
  ].map(s=>({...s,active:s.key===station}));
  return {title:run.featureTitle||run.appLabel||'Untitled project',id:run.id,status,progress,checks,mapped,stations,station,
    failures:failures.length,fixed:fixedIds.size,repairs:repairs.length,
    builder: {name:names[run.agentId]||run.agentId||'Coding agent',state:builderBusy?'Working':tasks.some(t=>['implemented','verified','candidate'].includes(t.status))?'Source recorded':'Waiting'},
    kane:{state:browserBusy?'Testing':progress.passed||progress.failed?'Evidence recorded':'Waiting'},
    examiner:{name:examinerName,independent:examsIndependent,state:examinerBusy?'Reviewing':reviews.length?`${reviews.length} recorded review${reviews.length===1?'':'s'}`:examsIndependent?'On call':'Not independent'},
    gate:{state:run.status==='passed'?'Accepted on recorded checks':stops.has(run.status)?'Acceptance withheld':'Awaiting evidence'},
    reviews:reviews.length,disputes:disputes.length,active,runStatus:run.status,
    examinerFinding:latestReview&&['application_defect','test_defect','uncertain'].includes(latestReview.finding)?latestReview.finding.replaceAll('_',' '):null,
    examinerRationale:latestReview&&typeof latestReview.rationale==='string'?latestReview.rationale.slice(0,330):null,
    examinerTranscript:safeName(latestReview?.transcriptFile)?latestReview.transcriptFile:null};
}

/** Parse "[ts] [run] [SOURCE] message" lines from the live stream. */
function parseLine(line){
  const m=String(line||'').match(/^\[([^\]]+)\] \[[^\]]+\] \[([^\]]+)\] (.*)$/);
  return m?{at:m[1],source:m[2],text:m[3]}:null;
}
const kaneStep=(t)=>{const m=t.match(/^step (\d+) ([✓✕…]) ([a-z_]+) — (.*)$/);return m?{step:+m[1],status:m[2]==='✕'?'failed':m[2]==='✓'?'done':'running',action:m[3],text:m[4]}:null;};
const agentAct=(t)=>{const m=t.match(/^▸ (edit|read|run|browse|tool|note) (.*)$/);return m?{kind:m[1],text:m[2]}:null;};

/** Live feeds from the stream: every agent action (with stage headers) and every Kane run with its steps. */
export function liveFeeds(lines=[]){
  const agent=[];const runs=[];let cur=null;
  const stage=/implementing task|planning|repair|diagnos|reviewing|examin|authored|creating task-by-task|task-\d+: agent finished|interrupted/i;
  for(const raw of lines){
    const l=parseLine(raw);if(!l)continue;
    if(l.source==='KANE'){
      const start=l.text.match(/^Starting (.+?) · browser timeout/);
      if(start){cur={flow:start[1],steps:[],result:null,live:true,summary:null};runs.push(cur);continue;}
      if(!cur)continue;
      const fin=l.text.match(/^Finished (.+?) · ([A-Z_]+) · \d+ms · (.*)$/);
      if(fin){cur.result=fin[2].toLowerCase();cur.live=false;cur.summary=cur.summary||fin[3];continue;}
      const end=l.text.match(/^run_end · ([a-z_]+) · (.*)$/);
      if(end){cur.summary=end[2];continue;}
      const st=kaneStep(l.text);if(st)cur.steps.push(st);
      continue;
    }
    // Agent sources include a task suffix, e.g. "BUILD task-1"; stderr is shown in Full log only.
    if(/^(AGENT|BUILD|PLAN|REPAIR|DIAGNOS)/.test(l.source)&&!/STDERR/.test(l.source)){
      const a=agentAct(l.text);
      if(a)agent.push(a);
      else if(stage.test(l.text)&&l.text.length<240)agent.push({kind:'stage',text:l.text});
    }
  }
  const last=runs.at(-1)||{flow:null,steps:[],result:null,live:false};
  return {agent:agent.slice(-600),runs,kane:last};
}

function stationRail(m){
  const glyph={plan:'◇',build:'✎',kane:'◉',diagnose:'⌕',repair:'⟲',verdict:'✓'};
  const items=m.stations.map(s=>`<li class="lp-st ${s.active?'is-active':''} ${s.done?'is-done':''} ${s.bad?'is-bad':''} ${s.optional?'is-optional':''} ${s.key==='verdict'?`tone-${esc(s.tone)}`:''}">
    <span class="lp-ico" aria-hidden="true">${glyph[s.key]}</span><strong>${esc(s.name)}</strong><small>${esc(s.actor)}</small><em>${esc(s.count)}</em>${s.active?'<span class="lp-now">NOW</span>':''}</li>`).join('<li class="lp-arrow" aria-hidden="true"></li>');
  return `<div class="lp-rail-wrap"><ol class="lp-rail" aria-label="Closed loop stages">${items}</ol>
    <div class="lp-return ${m.failures?'has-loop':''}" aria-hidden="true"><span>Kane FAIL → diagnose → repair → Kane retests the same objective</span></div></div>`;
}

const agentRow=(a)=>a.kind==='stage'
  ?`<li class="lp-a lp-a-stage">${esc(a.text)}</li>`
  :`<li class="lp-a lp-a-${esc(a.kind)}"><span class="lp-a-i">${AGENT_ICON[a.kind]||'•'}</span><span class="lp-a-k">${esc(a.kind)}</span><span class="lp-a-t" title="${esc(a.text)}">${esc(a.text)}</span></li>`;

function agentPane(m,feeds,trace){
  let rows='',source='idle',count=0;
  const savedCount=(trace?.agentSections||[]).reduce((n,sec)=>n+sec.actions.length,0);
  // Live log wins while running, and right after finishing until the saved files have caught up.
  const liveCount=feeds.agent.filter(a=>a.kind!=='stage').length;
  if(feeds.agent.length&&(m.active||liveCount>savedCount)){rows=feeds.agent.map(agentRow).join('');source=m.active?'live':'live log';count=feeds.agent.length;}
  else{
    const sections=trace?.agentSections?.length?trace.agentSections:trace?.agent?[trace.agent]:[];
    rows=sections.map(sec=>`<li class="lp-a lp-a-stage">${esc(sec.label)}</li>${sec.actions.map(agentRow).join('')}`).join('');
    count=sections.reduce((n,sec)=>n+sec.actions.length,0);if(count)source='saved run';
  }
  if(!rows)rows=`<li class="lp-empty">${m.active?'Waiting for the agent’s first action…':'No saved agent actions for this run.'}</li>`;
  const busy=m.active&&['build','diagnose','repair','plan'].includes(m.station);
  return `<section class="lp-pane"><header><span class="lp-dot ${busy?'on':''}"></span><strong>Coding agent</strong><small>${esc(m.builder.name)}${count?` · ${count} actions`:''}</small><span class="lp-tag">${busy?'LIVE':source}</span></header><ol class="lp-feed">${rows}</ol></section>`;
}

const kaneRow=(s)=>`<li class="lp-k lp-k-${esc(s.status)}"><span class="lp-k-n">${esc(s.step)}</span><span class="lp-k-a">${esc(ACTION[s.action]||s.action.replaceAll('_',' '))}</span><span class="lp-k-t">${esc(s.text)}</span><span class="lp-k-s">${s.status==='failed'?'✕':s.status==='done'?'✓':'…'}</span></li>`;
function kaneRunBlock(r,active){
  const verdict=r.result?`<span class="lp-verdict v-${esc(r.result)}">${esc(r.result.replaceAll('_',' ').toUpperCase())}</span>`:r.live&&active?'<span class="lp-verdict v-running">RUNNING</span>':'';
  return `<li class="lp-k-run ${r.result==='failed'?'is-failed':r.result==='passed'?'is-passed':''}"><span>${esc(r.flow||'Kane check')}</span>${verdict}</li>`
    +r.steps.map(kaneRow).join('')
    +(r.live&&active?'<li class="lp-k lp-k-pending"><span class="lp-k-n">…</span><span class="lp-k-a">Kane</span><span class="lp-k-t">deciding the next browser action</span><span></span></li>':'')
    +(r.summary?`<li class="lp-k-sum ${r.result==='failed'?'is-failed':''}">${esc(r.summary)}</li>`:'')
    +(r.why?`<li class="lp-k-why"><b>What Kane saw</b>${esc(r.why)}</li>`:'')
    +(r.testUrl?`<li class="lp-k-link"><a href="${esc(r.testUrl)}" target="_blank" rel="noopener">Open this run in TestMu Test Manager ↗</a></li>`:'');
}
function kanePane(m,feeds,trace,run){
  const savedRuns=(run.verification||[]).filter(v=>trace?.kane?.[v.stdoutFile]).length;
  let runs=feeds.runs.length&&(m.active||feeds.runs.length>savedRuns)?feeds.runs:[],source=runs.length?'live':'idle';
  if(!runs.length&&trace?.kane){
    runs=(run.verification||[]).filter(v=>trace.kane[v.stdoutFile]).map(v=>{const t=trace.kane[v.stdoutFile];
      return {flow:v.flowName||v.flowId,steps:t.steps||[],result:v.verdict,summary:t.oneLiner||v.summary||null,why:v.verdict==='failed'?t.reason:null,testUrl:httpsUrl(v.evidenceUrl)||t.testUrl||null};});
    if(runs.length)source='saved run';
  }
  const live=m.active&&runs.at(-1)?.live;
  const rows=runs.length?runs.map(r=>kaneRunBlock(r,m.active)).join(''):`<li class="lp-empty">${m.active?'Kane starts after the agent finishes coding a task.':'No saved Kane browser steps for this run.'}</li>`;
  const fails=runs.filter(r=>r.result==='failed').length;
  return `<section class="lp-pane lp-pane-kane"><header><span class="lp-dot ${live?'on':''}"></span><strong>Kane CLI</strong><small>${runs.length?`${runs.length} browser run${runs.length===1?'':'s'}${fails?` · ${fails} FAIL`:''}${live?` · now: ${esc(runs.at(-1).flow)}`:''}`:'real browser checks'}</small><span class="lp-tag">${live?'LIVE':source}</span></header><ol class="lp-feed lp-feed-kane">${rows}</ol></section>`;
}

function caughtCard(m,run,trace){
  const ver=run.verification||[];
  // Prefer a failure that is still unresolved, so a partial fix is never shown as the whole story.
  const lastIdx=(flow)=>ver.map(v=>v.flowId).lastIndexOf(flow);
  const unresolved=ver.findIndex(v=>v.verdict==='failed'&&ver[lastIdx(v.flowId)].verdict!=='passed');
  const i=unresolved>=0?unresolved:ver.findIndex(v=>v.verdict==='failed');
  if(i<0)return '';
  const fail=ver[i];const t=trace?.kane?.[fail.stdoutFile];
  const retest=ver.slice(i+1).find(x=>x.flowId===fail.flowId&&['passed','failed'].includes(x.verdict));
  const d=trace?.diagnoses?.[1];const diff=trace?.diffs?.['repair-1'];
  const step=(cls,label,body)=>`<li class="lp-c ${cls}"><b>${esc(label)}</b><span>${body}</span></li>`;
  return `<section class="lp-caught ${retest?.verdict==='passed'?'fixed':''}"><header><span class="lp-c-tag">${retest?.verdict==='passed'?'Caught & fixed':'Caught'}</span><strong>${esc(fail.flowName||fail.flowId)}</strong></header><ol>
    ${step('c-fail','Kane FAIL',esc(t?.oneLiner||fail.summary||'Kane reported a failure'))}
    ${d?step('c-diag','Agent diagnosis',esc(d.diagnosis.slice(0,260))+(d.diagnosis.length>260?'…':'')):''}
    ${diff?step('c-fix','Repair',`${diff.files.map(f=>`<code>${esc(f.path)}</code> <i class="a">+${f.added}</i> <i class="d">−${f.removed}</i>`).join(' · ')}`):m.repairs?step('c-fix','Repair',`${m.repairs} repair attempt${m.repairs===1?'':'s'} saved`):''}
    ${retest?step(retest.verdict==='passed'?'c-pass':'c-fail','Kane retest',retest.verdict==='passed'?'PASS on the same, unchanged objective':'Still failing'):step('c-wait','Kane retest','pending')}
  </ol></section>`;
}

/** HTML generated exclusively from sanitized saved run data and the live log stream. */
export function renderTrustAtelier(run,{lines=[],trace=null}={}){
  const m=atelierModel(run),id=encodeURIComponent(m.id);
  const feeds=liveFeeds(lines);
  const ck=m.checks.length?m.checks.map((check,i)=>{
    const text={passed:'PASS',failed:'FAIL',running:'Testing now',uncertain:'Inconclusive',pending:'Pending'}[check.verdict];
    const proof=check.evidence&&safeName(check.evidence)?`<a href="/api/evidence/${id}/${encodeURIComponent(check.evidence)}" target="_blank" rel="noopener">Transcript</a>`:'';
    const tm=check.testUrl?`<a href="${esc(check.testUrl)}" target="_blank" rel="noopener">Test Manager ↗</a>`:'';
    return `<li class="atelier-check"><span class="atelier-check-no">${String(i+1).padStart(2,'0')}</span><span class="atelier-check-title">${esc(check.name)}${check.previousResult?'<small>Previous PASS exists; a new run is in progress</small>':''}</span><span class="atelier-check-status ${check.verdict}">${text}</span><span class="atelier-check-links">${proof}${tm}</span></li>`;
  }).join(''):'<li class="atelier-empty">Browser checks will appear when the agent finishes planning.</li>';
  const percent=m.progress.total?Math.round((m.progress.passed/m.progress.total)*100):0;
  const examinerFinding=m.examinerFinding?`<div class="atelier-review"><span class="atelier-overline">EXAMINER'S RECORDED FINDING</span><strong>${esc(m.examinerFinding)}</strong><p>${esc(m.examinerRationale||'No supporting rationale saved.')}</p>${m.examinerTranscript?`<a href="/api/evidence/${id}/${encodeURIComponent(m.examinerTranscript)}" target="_blank" rel="noopener">Read examiner transcript ↗</a>`:''}</div>`:'';
  return `<div class="atelier lp ${m.active?'lp-live':''}" aria-label="Live loop: agent, Kane and verdict">
    <header class="lp-head"><div><span class="atelier-overline">KANEGUARD · LIVE LOOP · ${esc(m.id)}</span><h2>${esc(m.title)}</h2></div><span class="atelier-status ${m.status.tone} ${m.active?'is-live':''}">${m.active?'<i class="lp-pulse"></i>':''}${esc(m.status.label)}</span></header>
    ${stationRail(m)}
    <div class="lp-panes">${agentPane(m,feeds,trace)}${kanePane(m,feeds,trace,run)}</div>
    ${caughtCard(m,run,trace)}
    <section class="atelier-case" aria-label="Acceptance checks">
      <div class="atelier-progress-top"><span>Kane acceptance checks · latest verdict per check</span><strong>${m.progress.passed} / ${m.progress.total} checks</strong></div>
      <div class="atelier-progress-track" role="progressbar" aria-label="Checks with a saved PASS" aria-valuenow="${m.progress.passed}" aria-valuemin="0" aria-valuemax="${m.progress.total}"><span style="width:${percent}%"></span></div>
      ${examinerFinding}<ol class="atelier-checks">${ck}</ol>
      <p class="atelier-context">${esc(m.status.note)} · ${esc(m.gate.state)} · ${esc(m.mapped)} · Examiner: ${esc(m.examiner.name)} (${esc(m.examiner.state)}) · <a href="/api/runs/${id}/receipt" target="_blank" rel="noopener">Trust Receipt ↗</a></p>
    </section>
    <footer class="atelier-foot"><span>Browser steps are Kane’s own reported actions; agent actions come from its raw stream.</span><span>Only a real Kane PASS counts. Earlier failures stay on record.</span></footer>
  </div>`;
}
