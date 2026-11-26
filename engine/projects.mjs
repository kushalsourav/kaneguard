import { mkdir, writeFile, readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { ROOT, atomicJSON, configFor } from './common.mjs';
import { validateAgent } from './adapters.mjs';
import { validateBuildInput } from './feature-agent.mjs';
import { listRuns } from './storage.mjs';

const configsDir = path.join(ROOT,'configs');
const publicDir = path.join(ROOT,'public');
const safeId = /^app-[a-z0-9-]{5,54}$/;
const htmlEscape = (v) => String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
export function projectTitle(prompt) {
  const text = String(prompt).replace(/^\s*(?:please\s+)?(?:make|build|create|generate|design)\s+(?:me\s+)?(?:a|an|the)\s+/i,'')
    .split(/[.!?\n]/)[0].replace(/\s+/g,' ').trim().slice(0,72);
  return text ? text[0].toUpperCase()+text.slice(1) : 'New app';
}
export async function createProject({prompt,agentId}, {port=Number(process.env.PORT||4173),root=ROOT} = {}) {
  validateAgent(agentId);
  const id = `app-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
  validateBuildInput(id,prompt);
  const dir = path.join(root,'public',id);
  const configFile = path.join(root,'configs',`${id}.json`);
  const label = projectTitle(prompt);
  const launchUrl = `/${id}/`;
  const config = {id,label,kind:'playground',description:'User-created local web project',
    url:`http://127.0.0.1:${port}${launchUrl}`,launchUrl,
    editablePaths:[`public/${id}/index.html`,`public/${id}/app.js`,`public/${id}/style.css`],
    watchPaths:[`public/${id}`],timeoutSeconds:120,maxRepairs:2,flows:[]};
  // Write a functional, obviously unverified initial page rather than presenting
  // an empty preview as an agent-built product.
  const initial = `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${htmlEscape(label)} · Building</title><link rel="stylesheet" href="./style.css"></head><body><main><div class="mark">✦</div><p class="eyebrow">KANEGUARD / NEW PROJECT</p><h1>${htmlEscape(label)}</h1><p>Your coding agent is creating this app. This preview is not verified yet.</p><a href="/control/">View the live build →</a></main></body></html>\n`;
  const style = 'body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f8fb;font:16px system-ui;color:#172333}main{max-width:600px;text-align:center;padding:40px}.eyebrow{letter-spacing:.18em;font-size:11px;color:#68778f}.mark{font-size:42px;color:#7364e8}h1{font-size:clamp(32px,5vw,56px);line-height:1.1}p{color:#66738a}a{display:inline-block;margin-top:18px;color:#6152bf;font-weight:600}';
  try {
    await mkdir(path.join(root,'public'),{recursive:true});
    await mkdir(path.join(root,'configs'),{recursive:true});
    await mkdir(dir,{recursive:false});
    await Promise.all([
      writeFile(path.join(dir,'index.html'),initial,{flag:'wx'}),
      writeFile(path.join(dir,'style.css'),style,{flag:'wx'}),
      writeFile(path.join(dir,'app.js'),'// Coding agent creates the requested app here.\n',{flag:'wx'})
    ]);
    await atomicJSON(configFile,config);
    return {id,label,agentId,launchUrl,url:config.url,createdAt:new Date().toISOString()};
  } catch (e) {
    await rm(dir,{recursive:true,force:true});
    await rm(configFile,{force:true});
    throw e;
  }
}
export async function listProjects() {
  const configs = await readdir(configsDir,{withFileTypes:true});
  const valid = configs.filter((d)=>d.isFile() && d.name.endsWith('.json') && safeId.test(d.name.slice(0,-5)));
  const configsRead = await Promise.all(valid.map(async (d)=> {
    try { const cfg=await configFor(d.name.slice(0,-5)); return ['playground','connected'].includes(cfg.kind) ? cfg : null; } catch { return null; }
  }));
  const runMap = new Map();
  for (const run of await listRuns(120)) if (run.projectId && !runMap.has(run.projectId)) runMap.set(run.projectId,run);
  const available=configsRead.filter(Boolean);
  const knownIds=new Set(available.map(cfg=>cfg.id));
  const archivedProjects=[];
  for(const run of await listRuns(10000)) {
    const id=run.projectId;
    if(!run.archivedOnly || !/^app-[a-z0-9-]{5,54}$/.test(id||'') || knownIds.has(id))continue;
    knownIds.add(id);
    archivedProjects.push({id,label:run.featureTitle||run.appLabel||'Archived project',kind:'archived',framework:'Saved run archive',projectDir:null,previewUrl:null,status:run.status,stage:run.stage||'saved',agentId:run.agentId||null,runId:run.id,createdAt:run.createdAt||null,archivedOnly:true});
  }
  return [...available.map((cfg)=>{
    const run=runMap.get(cfg.id);
    return {id:cfg.id,label:run?.featureTitle || cfg.label,kind:cfg.kind,framework:cfg.framework || null,projectDir:cfg.kind==='connected'?cfg.projectDir:null,previewUrl:cfg.launchUrl,
      status:run?.status || 'created',stoppedByUser:!!run?.stoppedByUser,stage:run?.stage || 'created',agentId:run?.agentId || cfg.agentId || null,
      runId:run?.id || null,createdAt:run?.createdAt || null,archivedOnly:!!run?.archivedOnly};
  }),...archivedProjects].sort((a,b)=> (b.createdAt || b.id).localeCompare(a.createdAt || a.id));
}
