/** Local UI project attachment. Only a reviewed, local folder is attached;
 * source ownership always stays with its original project. */
import { readFile, realpath, stat, readdir, mkdir, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { ROOT, atomicJSON } from './common.mjs';

const idPattern = /^app-[a-z0-9-]{5,54}$/;
const running = new Map();
const internalDirs = new Set(['.git','node_modules','.next','.nuxt','dist','build','coverage','.output']);
const forbiddenPathParts = /(^|\/)(?:\.ssh|\.aws|\.config|\.local|\.gnupg|\.npm|\.cache|\.git|node_modules)(\/|$)/;
const inside = (parent, candidate) => candidate.startsWith(parent + path.sep);
function expandHome(p,home=os.homedir()) { return p === '~' ? home : p.startsWith('~/') ? path.join(home,p.slice(2)) : p; }
function previewUrl(value) {
  if (!value) return null;
  let url;
  try { url = new URL(value); } catch { throw new Error('Preview must be a full http://localhost:PORT URL'); }
  if(url.protocol!=='http:' || !['localhost','127.0.0.1'].includes(url.hostname) || !url.port || url.username || url.password || url.hash || url.search)
    throw new Error('Existing app preview must be a local HTTP server with an explicit port');
  return `http://127.0.0.1:${url.port}${url.pathname}`;
}
export function editableFileKey(config, relative) { return `connected/${config.id}/${relative.split(path.sep).join('/')}`; }
export function sourceFileFor(config, virtual) {
  if (config.kind !== 'connected') return path.join(ROOT,virtual);
  const prefix = `connected/${config.id}/`;
  if (!virtual.startsWith(prefix)) throw new Error('File is outside connected project');
  const rel = virtual.slice(prefix.length);
  if (!rel || rel.split('/').some((s)=>!s || s==='..'||s==='.'||s.startsWith('.'))) throw new Error('Unsafe source path');
  const target=path.resolve(config.projectDir,rel);
  if (!inside(config.projectDir,target)) throw new Error('File escapes connected project');
  return target;
}
export function allowedScope(config) { return config.kind==='connected' ? `connected/${config.id}/**` : `public/${config.id}/**`; }
export function sourcePrefix(config) {return config.kind==='connected' ? `connected/${config.id}/` : `public/${config.id}/`;}
export async function inspectLocalProject(input,{home=os.homedir(),repoRoot=ROOT}={}) {
  if (typeof input!=='string' || !input.trim() || input.length>1000 || input.includes('\0')) throw new Error('Provide a local project folder path');
  const requested=path.resolve(expandHome(input.trim(),home));
  const resolved=await realpath(requested).catch(()=>{throw new Error('Project folder does not exist');});
  const h=await realpath(home);
  if (resolved===h || !inside(h,resolved)) throw new Error('Only projects beneath your WSL home directory may be connected');
  const rr=await realpath(repoRoot);
  if (resolved===rr || inside(rr,resolved) || inside(resolved,rr)) throw new Error('KaneGuard and its parent directories cannot be connected as application source');
  if (forbiddenPathParts.test(resolved)) throw new Error('Protected or dependency folders cannot be attached');
  const details=await stat(resolved);
  if(!details.isDirectory()) throw new Error('Expected a project directory');
  let pkg;
  try { pkg=JSON.parse(await readFile(path.join(resolved,'package.json'),'utf8')); }
  catch { throw new Error('Connect a Node UI project with a valid package.json'); }
  if (!pkg || typeof pkg!=='object' || !pkg.scripts || typeof pkg.scripts!=='object') throw new Error('Project must declare npm scripts');
  const deps={...(pkg.dependencies || {}),...(pkg.devDependencies || {})};
  const framework='next' in deps?'Next.js':'vite' in deps?'Vite': 'react-scripts' in deps?'Create React App': 'nuxt' in deps?'Nuxt': 'astro' in deps?'Astro': 'other';
  const command = typeof pkg.scripts.dev==='string' ? 'dev' : typeof pkg.scripts.start==='string' ? 'start' : null;
  if(!command) throw new Error('Project needs an npm dev or start script');
  if((await readdir(resolved)).filter(n=>!n.startsWith('.')).length < 2) throw new Error('Project folder does not contain enough application files');
  return {path:resolved,label: typeof pkg.name==='string'&&pkg.name.trim()?pkg.name.trim().slice(0,72):path.basename(resolved),
    framework,script:command,hasDependencies:(await stat(path.join(resolved,'node_modules')).catch(()=>null))?.isDirectory() || false,
    confirmation:'Connecting permits the selected coding CLI to edit the original project source. KaneGuard never deletes those source files.'};
}
async function availablePort() {
  const s=createServer();
  await new Promise((resolve,reject)=>{s.once('error',reject);s.listen(0,'127.0.0.1',resolve);});
  const p=s.address().port;
  await new Promise((resolve,reject)=>s.close(err=>err?reject(err):resolve()));
  return p;
}
export async function connectExistingProject({folder,preview,autoStart=true},{root=ROOT,home=os.homedir(),repoRoot=root}={}) {
  const inspected=await inspectLocalProject(folder,{home,repoRoot});
  const manual=previewUrl(preview);
  if (manual && Number(new URL(manual).port)===Number(process.env.PORT || 4173)) throw new Error('Preview must point to the existing app, not KaneGuard itself');
  if (!manual && !autoStart) throw new Error('Provide a running localhost preview URL or enable dev-server startup');
  const id=`app-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
  const port=manual ? Number(new URL(manual).port) : await availablePort();
  const url=manual || `http://127.0.0.1:${port}/`;
  const config={id,label:inspected.label,kind:'connected',description:`Attached ${inspected.framework} source · external folder retained`,
    projectDir:inspected.path, framework:inspected.framework, startScript:inspected.script,autoStart:!manual && !!autoStart,
    url,launchUrl:url, editablePaths:[],watchPaths:[],timeoutSeconds:150,maxRepairs:2,flows:[]};
  // Source edit paths are calculated from actual files at snapshot time. NEVER
  // add arbitrary external absolute paths to the editable allowlist.
  await mkdir(path.join(root,'configs'),{recursive:true});
  for(const entry of await readdir(path.join(root,'configs'))) {
    if(!idPattern.test(entry.replace(/\.json$/,'')) || !entry.endsWith('.json')) continue;
    try {
      const existing=JSON.parse(await readFile(path.join(root,'configs',entry),'utf8'));
      if(existing.kind==='connected' && existing.projectDir===inspected.path) throw new Error('Project already connected. Open it from Projects rather than attaching it twice.');
    } catch(error) { if(/already connected/.test(error.message)) throw error; }
  }
  await atomicJSON(path.join(root,'configs',`${id}.json`),config);
  return {id,label:config.label,kind:'connected',framework:config.framework,projectDir:config.projectDir,
    launchUrl:url,url,autoStart:config.autoStart,previewStatus:'not_started'};
}
export async function startConnectedPreview(config,{timeoutMs=18000}={}) {
  if(config.kind!=='connected' || !idPattern.test(config.id)) throw new Error('Not an attached project');
  if(!config.autoStart) return {status:'external',url:config.url};
  const prior=running.get(config.id);
  if(prior && prior.child.exitCode===null && !prior.child.killed) return {status:'running',url:config.url};
  // Never use shell=true or accept a user-provided command. npm runs ONLY the
  // npm script that was inspected and shown to the user during attachment.
  const url=new URL(config.url);
  const npmArgs=['run',config.startScript];
  if(config.framework==='Next.js') npmArgs.push('--','-p',url.port,'-H','127.0.0.1');
  if(config.framework==='Vite') npmArgs.push('--','--host','127.0.0.1','--port',url.port,'--strictPort');
  const child=spawn('npm',npmArgs,{cwd:config.projectDir,env:{...process.env,PORT:url.port,HOST:'127.0.0.1',BROWSER:'none'},
    shell:false,windowsHide:true,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});
  let output='',error='';
  const consume=(kind,data)=>{const v=String(data);if(kind==='out')output=(output+v).slice(-1200);else error=(error+v).slice(-1200);};
  child.stdout.on('data',b=>consume('out',b));child.stderr.on('data',b=>consume('err',b));
  child.on('error',e=>{error=e.message;});
  child.on('exit',()=>{if(running.get(config.id)?.child===child)running.delete(config.id);});
  running.set(config.id,{child,url:config.url});
  const expires=Date.now()+timeoutMs;
  while(Date.now()<expires) {
    if(child.exitCode!==null || child.signalCode || child.killed) break;
    try { const res=await fetch(config.url,{signal:AbortSignal.timeout(750)});if(res.ok) return {status:'running',url:config.url}; }
    catch {}
    await new Promise(r=>setTimeout(r,220));
  }
  await stopConnectedPreview(config.id);
  throw new Error(`Project dev server did not become ready: ${(error || output || 'check npm dependencies and your dev script').slice(-430)}`);
}
export async function stopConnectedPreview(id) {
  const item=running.get(id);running.delete(id);
  if(!item)return false;
  const pid=item.child.pid;
  if(pid && process.platform!=='win32') {try{process.kill(-pid,'SIGTERM');}catch{item.child.kill('SIGTERM');}}
  else item.child.kill('SIGTERM');
  return true;
}
export async function stopAllConnectedPreviews() {await Promise.all([...running.keys()].map(stopConnectedPreview));}
export async function disconnectExistingProject(id,{root=ROOT}={}) {
  if(!idPattern.test(id))throw new Error('Invalid attached project ID');
  const cfg=JSON.parse(await readFile(path.join(root,'configs',`${id}.json`),'utf8'));
  if(cfg.kind!=='connected') throw new Error('Not an attached project');
  await stopConnectedPreview(id);
  // Remove only KaneGuard's connection metadata. Existing source and historical
  // Kane results are deliberately preserved until separately deleted.
  await rm(path.join(root,'configs',`${id}.json`));
  return {disconnectedProject:id,sourcePreserved:true};
}
export function validateLocalPreview(input) { return previewUrl(input); }
