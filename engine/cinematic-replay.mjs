import {buildRequirementMatrix} from './assurance.mjs';

const h=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const goodFile=value=>typeof value==='string'&&/^(?!\.)(?!record\.json$)[A-Za-z0-9._-]+\.(?:txt|ndjson|log|json)$/.test(value);
const plain=value=>String(value??'').slice(0,6000);
const category=(kind)=>{
  if(kind==='proof')return 'proof';
  if(/(?:kane_fail|precheck_fail|failure|error)/.test(kind))return 'failed';
  if(/(?:repair|diagnos|investigat)/.test(kind))return 'repair';
  if(/(?:kane_pass|milestone_pass|success|kane_recovered)/.test(kind))return 'passed';
  if(/(?:kane|verify|recheck|test|objective)/.test(kind))return 'kane';
  if(/(?:task|implement|agent_partial)/.test(kind))return 'build';
  if(/(?:plan|requirement|start|checkpoint)/.test(kind))return 'plan';
  return 'event';
};

/** Archived journey uses only saved timestamps and Kane results. Nothing here
 * is a synthetic browser run, and old failures are never rewritten as PASS. */
export function cinematicReplayHTML(run,{offline=false}={}){
  const matrix=buildRequirementMatrix(run);
  const evidenceUrl=(f)=>goodFile(f)?(offline?`./evidence/${encodeURIComponent(f)}`:`/api/evidence/${encodeURIComponent(run.id)}/${encodeURIComponent(f)}`):null;
  const savedEvents=(Array.isArray(run.timeline)?run.timeline:[]).map((event,i)=>({
    id:`event-${i}`,title:plain(event.title||'Recorded workflow activity'),
    detail:plain(event.detail),at:event.at||'',kind:String(event.kind||'event'),
    category:category(String(event.kind||'event')),source:'Saved workflow event',links:[],index:i
  }));
  const savedProof=(Array.isArray(run.verification)?run.verification:[]).map((check,i)=>{
    const verdict=String(check.verdict||'unknown').toLowerCase();
    const links=[];
    for(const [file,label] of [[check.stdoutFile,'Kane transcript'],[check.stderrFile,'Kane stderr']]){
      const url=evidenceUrl(file);if(url)links.push({label,url});
    }
    return {id:`proof-${i}`,title:plain(check.flowName||check.flowId||`Browser objective ${i+1}`),
      detail:plain(check.summary||'No Kane summary was recorded.'),at:check.finishedAt||check.startedAt||'',
      kind:'proof',category:verdict==='passed'?'passed':verdict==='failed'?'failed':'kane',
      source:`Independent Kane result ${i+1} · ${verdict.toUpperCase().replaceAll('_',' ')}`,
      verdict:verdict.toUpperCase().replaceAll('_',' '),gate:plain(check.gate||''),
      hashVerified:!!check.objectiveHashVerified,reused:!!check.reused,links,index:savedEvents.length+i};
  });
  // Started/finished timestamps come from the original Kane run. Events with
  // missing timestamps remain in saved order instead of inventing a time.
  const ordered=[...savedEvents,...savedProof].sort((a,b)=>{
    const ta=Date.parse(a.at),tb=Date.parse(b.at);
    if(Number.isFinite(ta)&&Number.isFinite(tb))return ta-tb||a.index-b.index;
    return Number.isFinite(ta)?-1:Number.isFinite(tb)?1:a.index-b.index;
  });
  if(!ordered.length)ordered.push({id:'empty',title:'Waiting for recorded activity',detail:'This run has no saved timeline or Kane checks yet.',at:'',kind:'event',category:'event',source:'No evidence recorded',links:[]});
  const receipt=offline?'./receipt.html':`/api/runs/${encodeURIComponent(run.id)}/receipt`;
  const data=JSON.stringify({steps:ordered}).replaceAll('<','\\u003c').replaceAll('>','\\u003e').replaceAll('&','\\u0026');
  const status=String(run.status||'unknown').replaceAll('_',' ');
  const final=run.status==='passed'?'passed':run.status==='running'?'running':'stopped';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0b1321"><title>Cinematic Replay · ${h(run.featureTitle||run.appLabel||run.id)}</title>
<style>
:root{color-scheme:dark;--bg:#0b1321;--surface:#152235;--surface2:#1b2a41;--line:#34445b;--text:#eef4ff;--muted:#a4b4cb;--accent:#9bafff;--green:#58dfa8;--red:#ff9292;--amber:#ffd184}*{box-sizing:border-box}body{margin:0;background:radial-gradient(ellipse at 85% 0%,#1c2e4f 0%,#0b1321 47%);color:var(--text);font:14px/1.55 system-ui,-apple-system,sans-serif}button,select{font:inherit}button{cursor:pointer}button:focus-visible,a:focus-visible,input:focus-visible{outline:3px solid #a5b5ff;outline-offset:3px}a{color:#c2ccff}main{max-width:1280px;margin:auto;padding:28px clamp(15px,3vw,38px) 38px}.topline{display:flex;align-items:center;gap:10px;justify-content:space-between;flex-wrap:wrap}.eyebrow{color:var(--accent);font-size:11px;letter-spacing:.15em;font-weight:800;text-transform:uppercase}.tag{border:1px solid #4e5a6c;border-radius:30px;padding:5px 12px;font-size:11px;font-weight:700;color:#d0d9ea}.tag.passed{border-color:#235e4f;background:#133d32;color:var(--green)}.tag.stopped{border-color:#745052;background:#40272d;color:var(--red)}.tag.running{border-color:#796341;color:#ffd184}h1{font-size:clamp(27px,4vw,44px);line-height:1.14;letter-spacing:-.04em;margin:16px 0 10px;overflow-wrap:anywhere}.sub{color:var(--muted);margin:0 0 20px}.stats{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:22px}.stat{border:1px solid #35465e;background:#162338;border-radius:10px;padding:11px 14px;min-width:125px}.stat strong{display:block;font-size:21px;line-height:1.2}.stat span{font-size:11px;color:var(--muted)}.cinema{border:1px solid #38506e;border-radius:18px;overflow:hidden;background:#111d2e;box-shadow:0 32px 74px #0006}.cinema-top{padding:13px 17px;display:flex;align-items:center;justify-content:space-between;gap:10px;background:#1a2940;border-bottom:1px solid #30435a}.cinema-top span{color:var(--muted);font-size:12px}.cinema-main{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(255px,.75fr);min-height:365px}.stage{padding:clamp(23px,4vw,50px);display:flex;flex-direction:column;justify-content:space-between;min-width:0;gap:26px;background:radial-gradient(circle at 15% 15%,#253c5d 0,#131f31 65%)}.step-label{font-size:12px;font-weight:800;color:#b2c4ff;letter-spacing:.09em;text-transform:uppercase}.step-label.failed{color:var(--red)}.step-label.passed{color:var(--green)}.step-label.repair{color:var(--amber)}.step-title{font-size:clamp(23px,3vw,39px);line-height:1.2;letter-spacing:-.035em;max-width:660px;margin:20px 0 13px;overflow-wrap:anywhere}.step-detail{font-size:clamp(13px,1.4vw,16px);color:#d4e0f0;white-space:pre-wrap;overflow-wrap:anywhere;max-height:190px;overflow:auto}.stage-bottom{display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between}.timestamp{font-size:12px;color:#b1bfd5}.evidence{display:flex;flex-wrap:wrap;gap:8px}.evidence a{border:1px solid #566c85;border-radius:7px;padding:7px 10px;background:#1e3049;text-decoration:none;font-size:12px}.chapters{min-width:0;background:#172438;border-left:1px solid #34455e;padding:15px;max-height:565px;overflow:auto}.chapter-title{margin:0 0 12px;font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.12em}.chapter-list{display:flex;flex-direction:column;gap:6px}.chapter{border:1px solid transparent;border-radius:9px;padding:10px 11px;text-align:left;color:#cfdaeb;background:transparent;width:100%;display:grid;grid-template-columns:30px minmax(0,1fr);gap:10px}.chapter:hover{background:#253753}.chapter.active{border-color:#60719a;background:#2a3d5d;color:white}.chapter-num{color:#91a5c1;font-size:11px}.chapter strong{font-size:12px;font-weight:650;line-height:1.35;overflow-wrap:anywhere}.chapter small{display:block;font-size:10px;color:#9db1cb;margin-top:4px}.chapter.failed strong{color:#ffafaf}.chapter.passed strong{color:#8aefc5}.controls{padding:17px 20px 20px;background:#152235;border-top:1px solid #34465e}.track{width:100%;accent-color:#a8b7ff;cursor:pointer}.buttons{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:12px}.buttons button,.buttons select{color:var(--text);background:#273a55;border:1px solid #485b75;border-radius:8px;padding:9px 14px;min-height:38px}.buttons button:hover{background:#344a69}.buttons button.primary{background:#647de1;border-color:#93a5ff;color:white;font-weight:800}.buttons button:disabled{opacity:.45;cursor:not-allowed}.counter{margin-left:auto;color:var(--muted);font-size:12px;white-space:nowrap}.disclosure{display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin-top:18px}.note{color:#b5c1d5;font-size:12px;flex:1}.disclosure a{white-space:nowrap}.below{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:22px}.panel{background:#142136;border:1px solid #30415b;border-radius:12px;padding:16px}.panel h2{font-size:15px;margin:0 0 12px}.check{border-top:1px solid #314259;padding:10px 0;display:flex;gap:10px;align-items:start;justify-content:space-between}.check:first-of-type{border-top:0}.check b{font-size:12px}.check span{font-size:11px;color:var(--muted)}.check .fail{color:var(--red)}.check .pass{color:var(--green)}.check a{font-size:11px;white-space:nowrap}.request{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;color:#c4d0e0;max-height:180px;overflow:auto}footer{padding:24px 0;color:var(--muted);font-size:11px}@media(max-width:780px){.cinema-main{grid-template-columns:1fr}.stage{min-height:300px}.chapters{border-left:0;border-top:1px solid #34455e;max-height:180px}.chapter-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(185px,1fr))}.below{grid-template-columns:1fr}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;animation:none!important}}
</style></head><body><main><div class="topline"><span class="eyebrow">KaneGuard / Cinematic Replay</span><span class="tag ${h(final)}">${h(status)}</span></div><h1>${h(run.featureTitle||run.appLabel||'Application development journey')}</h1><p class="sub">${h(run.id)} · ${h(run.createdAt||'No recorded start time')} · ${offline?'Offline replay bundle':'Local saved run'}</p><div class="stats"><div class="stat"><strong>${matrix.taskCount}</strong><span>Agent tasks</span></div><div class="stat"><strong>${matrix.checkCount}</strong><span>Kane objectives</span></div><div class="stat"><strong>${matrix.proven}/${matrix.total}</strong><span>Requirements proven</span></div><div class="stat"><strong>${matrix.repaired}</strong><span>Requirements repaired</span></div><div class="stat"><strong>${matrix.unproven}</strong><span>Not proven</span></div></div>
<section class="cinema" aria-label="Interactive replay of saved evidence"><div class="cinema-top"><strong>Evidence journey</strong><span>READ-ONLY · SAVED EVENTS · NOT A LIVE TEST</span></div><div class="cinema-main"><div class="stage" aria-live="polite" aria-atomic="true"><div><div id="stepLabel" class="step-label">Saved event</div><h2 class="step-title" id="stepTitle">Loading saved events</h2><p class="step-detail" id="stepDetail"></p></div><div class="stage-bottom"><span id="stepTime" class="timestamp"></span><div id="stepEvidence" class="evidence"></div></div></div><aside class="chapters"><h3 class="chapter-title">Recorded chapters</h3><div class="chapter-list" id="chapters"></div></aside></div><div class="controls"><label for="scrub" class="step-label">Journey progress</label><input id="scrub" class="track" type="range" min="0" max="${ordered.length-1}" value="0" step="1" aria-label="Replay chapter"><div class="buttons"><button type="button" id="previous" aria-label="Previous chapter">◀ Previous</button><button type="button" id="play" class="primary" aria-label="Play saved chapters">▶ Play</button><button type="button" id="next" aria-label="Next chapter">Next ▶</button><label for="speed">Speed</label><select id="speed" aria-label="Playback speed"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option></select><span class="counter" id="counter"></span></div></div></section>
<div class="disclosure"><span class="note">This presentation uses stored run records and real browser evidence only. It does not recreate or simulate Kane browser actions. Historical failures remain visible.</span><a href="${h(receipt)}" target="_blank" rel="noopener">View Trust Receipt &amp; requirement matrix</a></div><div class="below"><section class="panel"><h2>Original developer request</h2><div class="request">${h(run.request||'No saved request.')}</div></section><section class="panel"><h2>Saved Kane verification results (${savedProof.length})</h2>${savedProof.length?savedProof.map(v=>`<div class="check"><div><b>${h(v.title)}</b><div><span class="${v.category==='passed'?'pass':v.category==='failed'?'fail':''}">${h(v.verdict)}</span> <span>${h(v.gate)}</span></div></div><div>${v.links.map(link=>`<a href="${h(link.url)}" target="_blank" rel="noopener">${h(link.label)}</a>`).join(' ')}</div></div>`).join(''):'<p class="note">No Kane browser verdict has been saved yet.</p>'}</section></div><footer>Generated from saved KaneGuard run evidence. Replay snapshots are archival presentations; they do not grant verification status.</footer></main>
<script id="replayData" type="application/json">${data}</script><script>
(()=>{
'use strict';
const steps=JSON.parse(document.getElementById('replayData').textContent).steps;
const get=id=>document.getElementById(id);
const chapterList=get('chapters'),range=get('scrub'),playButton=get('play'),speed=get('speed');
let current=0,playing=false,timer=null;
function stop(){playing=false;if(timer!==null){clearTimeout(timer);timer=null;}playButton.textContent='▶ Play';playButton.setAttribute('aria-label','Play saved chapters');}
function schedule(){if(!playing)return;timer=setTimeout(()=>{if(current>=steps.length-1){stop();return;}show(current+1);schedule();},Math.round(3200/Number(speed.value||1)));}
function show(index){current=Math.max(0,Math.min(steps.length-1,Number(index)||0));const step=steps[current];
get('stepTitle').textContent=step.title;get('stepDetail').textContent=step.detail||'No additional detail was saved.';
get('stepLabel').textContent=step.source;get('stepLabel').className='step-label '+step.category;
get('stepTime').textContent=step.at?new Date(step.at).toLocaleString():'Time not saved';
get('stepEvidence').replaceChildren();for(const link of (step.links||[])){const a=document.createElement('a');a.href=link.url;a.textContent=link.label;a.target='_blank';a.rel='noopener noreferrer';get('stepEvidence').append(a);}
range.value=String(current);get('counter').textContent=(current+1)+' / '+steps.length;
get('previous').disabled=current===0;get('next').disabled=current===steps.length-1;
for(const el of chapterList.children){const active=Number(el.dataset.index)===current;el.classList.toggle('active',active);if(active){el.setAttribute('aria-current','step');}else{el.removeAttribute('aria-current');}}
}
steps.forEach((step,i)=>{const button=document.createElement('button');button.type='button';button.className='chapter '+step.category;button.dataset.index=String(i);
const num=document.createElement('span');num.className='chapter-num';num.textContent=String(i+1).padStart(2,'0');
const box=document.createElement('span'),title=document.createElement('strong'),label=document.createElement('small');title.textContent=step.title;label.textContent=step.verdict||step.source;
box.append(title,label);button.append(num,box);button.addEventListener('click',()=>{stop();show(i);});chapterList.append(button);});
get('previous').addEventListener('click',()=>{stop();show(current-1);});get('next').addEventListener('click',()=>{stop();show(current+1);});
range.addEventListener('input',()=>{stop();show(Number(range.value));});
playButton.addEventListener('click',()=>{if(playing){stop();return;}if(current>=steps.length-1)show(0);playing=true;playButton.textContent='Ⅱ Pause';playButton.setAttribute('aria-label','Pause playback');schedule();});
speed.addEventListener('change',()=>{if(playing){clearTimeout(timer);schedule();}});
document.addEventListener('keydown',event=>{if(['INPUT','TEXTAREA','SELECT','BUTTON'].includes(document.activeElement?.tagName))return;if(event.key==='ArrowRight'){stop();show(current+1);}if(event.key==='ArrowLeft'){stop();show(current-1);}if(event.key===' '){event.preventDefault();playButton.click();}});
show(0);
})();
</script></body></html>`;
}
