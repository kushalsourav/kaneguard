import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, configFor } from '../engine/common.mjs';
import { listRuns, getRun } from '../engine/storage.mjs';
import { verifyApp, isBusy } from '../engine/orchestrator.mjs';
import { buildFeature, resumeFeatureRun, inspectResumableFeature } from '../engine/feature.mjs';
import { validateBuildInput } from '../engine/feature-agent.mjs';
import { subscribeRunEvents, recentRunLog } from '../engine/live-events.mjs';
import { agentAvailability, validateAgent } from '../engine/adapters.mjs';
import { createProject, listProjects } from '../engine/projects.mjs';
import { projectSourceVersion } from '../engine/project-source-version.mjs';
import { reconcileAbandonedRuns, deleteSavedRun, deleteGeneratedProject } from '../engine/project-management.mjs';

const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC = path.join(ROOT, 'public');
let pendingVerify = false;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png', '.webp':'image/webp', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.gif':'image/gif', '.txt':'text/plain; charset=utf-8' };
const sendJSON = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(data)); };
const badRequest = (res, status, message) => sendJSON(res, status, { error: message });
async function readJSONBody(req,maxLength=4000) {
  let body='';
  for await (const chunk of req) {body+=chunk; if(body.length>maxLength) throw new Error('Request too large');}
  try {return JSON.parse(body || '{}');} catch {throw new Error('Invalid JSON body');}
}

async function staticFile(url, res) {
  const p = url.pathname === '/' ? '/control/' : url.pathname;
  const normalized = path.posix.normalize(decodeURIComponent(p));
  const file = path.resolve(PUBLIC, `.${normalized.endsWith('/') ? `${normalized}index.html` : normalized}`);
  if (!file.startsWith(`${PUBLIC}${path.sep}`)) return badRequest(res, 403, 'Forbidden');
  let info;
  try { info = await stat(file); } catch { return badRequest(res, 404, 'Not found'); }
  if (!info.isFile()) return badRequest(res, 404, 'Not found');
  const projectPreview = /^\/app-[a-z0-9-]+\//.test(normalized);
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', ...(projectPreview ? { 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'" } : {}) });
  createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${HOST}:${PORT}`);
    if (url.pathname === '/api/health') return sendJSON(res, 200, { ok: true, busy: isBusy() || pendingVerify, service: 'KaneGuard', time: new Date().toISOString() });
    if (url.pathname === '/api/agents' && req.method === 'GET') return sendJSON(res,200,{agents:await agentAvailability()});
    if (url.pathname === '/api/projects' && req.method === 'GET') return sendJSON(res,200,await listProjects());
    const deleteProjectRoute=url.pathname.match(/^\/api\/projects\/(app-[a-z0-9-]{5,54})$/);
    if (deleteProjectRoute && req.method==='DELETE') {
      if(isBusy() || pendingVerify) return badRequest(res,409,'Cannot delete a project while a workflow is active');
      try {return sendJSON(res,200,await deleteGeneratedProject(deleteProjectRoute[1]));}
      catch(error) {return badRequest(res,/not found/i.test(error.message)?404:400,error.message);}
    }
    const deleteRunRoute=url.pathname.match(/^\/api\/runs\/([a-zA-Z0-9-]{5,80})$/);
    if (deleteRunRoute && req.method==='DELETE') {
      if(isBusy() || pendingVerify) return badRequest(res,409,'Cannot delete evidence while a workflow is active');
      try {return sendJSON(res,200,await deleteSavedRun(deleteRunRoute[1]));}
      catch(error) {return badRequest(res,/not found/i.test(error.message)?404:400,error.message);}
    }
    // Lightweight source fingerprint for live iframe reload. This is independent
    // of Kane verification and never changes the recorded acceptance verdict.
    const sourceRoute = url.pathname.match(/^\/api\/projects\/(app-[a-z0-9-]{5,54})\/source-version$/);
    if (sourceRoute && req.method === 'GET') {
      try { return sendJSON(res, 200, await projectSourceVersion(sourceRoute[1])); }
      catch { return badRequest(res, 404, 'Project source unavailable'); }
    }

    if (url.pathname === '/api/projects' && req.method === 'POST') {
      if (isBusy() || pendingVerify) return badRequest(res,409,'A KaneGuard workflow is already active');
      let parsed, agentId;
      try {parsed=await readJSONBody(req,4000);agentId=validateAgent(parsed.agentId);}
      catch(error) {return badRequest(res,400,error.message);}
      const available = await agentAvailability();
      const selectedAgent=available.find((a)=>a.id===agentId);
      if (!selectedAgent.installed) return badRequest(res,422,`${selectedAgent.label} CLI is not installed in the server WSL environment (${selectedAgent.command}). Install and authenticate it before starting a project.`);
      pendingVerify = true;
      let project;
      try { project = await createProject({prompt:parsed.prompt,agentId},{port:PORT}); }
      catch(error) {pendingVerify=false;return badRequest(res,400,error.message);}
      setImmediate(()=>{
        buildFeature(project.id,parsed.prompt,()=>{},{agentId}).catch((error)=>console.error('Project build failed:',error)).finally(()=>{pendingVerify=false;});
      });
      return sendJSON(res,202,{accepted:true,project,mode:'project',message:'Project workspace created; coding agent and Kane verification queued'});
    }
    if (url.pathname === '/api/configs') return sendJSON(res, 200, await Promise.all(['cartlab', 'coinpulse'].map(configFor)));
    if (url.pathname === '/api/runs' && req.method === 'GET') return sendJSON(res, 200, await listRuns());
    // Stream the exact redacted live.log lines as they arrive, without waiting for
    // the next persisted run-history refresh. Also replay recent lines on reload.
    const liveRoute = url.pathname.match(/^\/api\/runs\/([a-zA-Z0-9-]{5,80})\/events$/);
    if (liveRoute && req.method === 'GET') {
      const id = liveRoute[1];
      if (!await getRun(id)) return badRequest(res, 404, 'Run not found');
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
        'X-Content-Type-Options': 'nosniff'
      });
      res.flushHeaders?.();
      res.write(': KaneGuard live stream\n\n');
      let connected = true;
      const send = (type, data) => {
        if (!connected || res.destroyed) return;
        if (!res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`)) {
          // Avoid unbounded memory if a remote client stops reading.
          connected = false;
          res.end();
        }
      };
      const pending = [];
      let replaying = true;
      const unsubscribe = subscribeRunEvents(id, (line) => {
        if (replaying) pending.push(line);
        else send('line', { line });
      });
      try {
        const lines = await recentRunLog(id);
        send('snapshot', { lines });
        // Events emitted during disk replay might already exist in the snapshot.
        const known = new Set(lines);
        replaying = false;
        for (const line of pending) if (!known.has(line)) send('line', { line });
      } catch (error) { send('error_message', { message: 'Unable to replay live log' }); }
      const ping = setInterval(() => {
        if (connected && !res.destroyed) res.write(': heartbeat\n\n');
      }, 12000);
      const cleanup = () => { connected = false; clearInterval(ping); unsubscribe(); };
      req.on('close', cleanup);
      res.on('close', cleanup);
      return;
    }
    if (url.pathname.startsWith('/api/runs/') && req.method === 'GET') {
      const id = url.pathname.split('/')[3];
      const run = await getRun(id);
      return run ? sendJSON(res, 200, run) : badRequest(res, 404, 'Run not found');
    }
    if (url.pathname === '/api/build' && req.method === 'POST') {
      if (isBusy() || pendingVerify) return badRequest(res, 409, 'A KaneGuard workflow is already active');
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 3500) return badRequest(res, 413, 'Request too large'); }
      let parsed;
      try { parsed = JSON.parse(body || '{}'); } catch { return badRequest(res, 400, 'Invalid JSON'); }
      let input, agentId;
      try { input = validateBuildInput(parsed.appId, parsed.prompt);agentId=validateAgent(parsed.agentId || 'antigravity'); } catch (error) { return badRequest(res, 400, error.message); }
      pendingVerify = true;
      console.log(`[KaneGuard] AI feature build requested for ${input.appId}: ${input.prompt}`);
      setImmediate(() => {
        buildFeature(input.appId, input.prompt,()=>{},{agentId}).catch((e) => console.error('Feature build failed:', e)).finally(() => { pendingVerify = false; });
      });
      return sendJSON(res, 202, { accepted:true, mode:'build', appId:input.appId, message:'Agent-first feature workflow queued' });
    }
    const resumeRoute = url.pathname.match(/^\/api\/runs\/([a-zA-Z0-9-]{5,80})\/resume$/);
    if (resumeRoute && req.method === 'POST') {
      if (isBusy() || pendingVerify) return badRequest(res, 409, 'A KaneGuard workflow is already active');
      const prior = await getRun(resumeRoute[1]);
      if (!prior || prior.mode !== 'build' || !['agent_error','failed','infrastructure_error','verification_inconclusive'].includes(prior.status) ||
          !prior.artifacts?.featurePlan || !prior.changedFiles?.length) {
        return badRequest(res, 400, 'Only stopped feature builds with saved plans and source changes can resume');
      }
      try { await inspectResumableFeature(prior.id); }
      catch (error) { return badRequest(res, 400, error.message); }
      pendingVerify = true;
      setImmediate(() => {
        resumeFeatureRun(prior.id).catch((e) => console.error('Resume verification failed:',e)).finally(() => { pendingVerify = false; });
      });
      return sendJSON(res, 202, { accepted:true, mode:'build-resume', resumedFrom:prior.id, message:'Reverification queued using original agent-authored objectives' });
    }
    if (url.pathname === '/api/verify' && req.method === 'POST') {
      if (isBusy() || pendingVerify) return badRequest(res, 409, 'A verification run is already active');
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 4000) return badRequest(res, 413, 'Body too large'); }
      let parsed;
      try { parsed = JSON.parse(body || '{}'); } catch { return badRequest(res, 400, 'Invalid JSON'); }
      if (!['cartlab', 'coinpulse'].includes(parsed.appId)) return badRequest(res, 400, 'Unknown app');
      // Return immediately; the dashboard polls the persisted run history for live progress.
      pendingVerify = true;
      console.log(`[KaneGuard] Dashboard requested ${parsed.appId} verification; output will stream below.`);
      setImmediate(() => { verifyApp(parsed.appId).catch((e) => console.error('Verification failed:', e)).finally(() => { pendingVerify = false; }); });
      return sendJSON(res, 202, { accepted: true, appId: parsed.appId, message: 'Verification has been queued' });
    }
    if (url.pathname.startsWith('/api/evidence/') && req.method === 'GET') {
      const fragments = url.pathname.split('/').filter(Boolean);
      if (fragments.length !== 4 || !/^[a-zA-Z0-9-]+$/.test(fragments[2]) || !/^[a-zA-Z0-9._-]+$/.test(fragments[3])) return badRequest(res, 400, 'Invalid evidence path');
      const file = path.join(ROOT, 'runs', fragments[2], fragments[3]);
      try {
        const result = await readFile(file);
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': 'inline', 'X-Content-Type-Options': 'nosniff' });
        return res.end(result);
      } catch { return badRequest(res, 404, 'Evidence not found'); }
    }
    if (req.method === 'GET') return await staticFile(url, res);
    badRequest(res, 405, 'Method not allowed');
  } catch (error) { console.error(error); badRequest(res, 500, 'Internal server error'); }
});
server.listen(PORT, HOST, async () => {
  // Reconcile only after this process owns the listening port, so a duplicate
  // server invocation never marks another live process's work as interrupted.
  try {
    const abandoned=await reconcileAbandonedRuns();
    if(abandoned.length) console.log(`[KaneGuard] Marked ${abandoned.length} previously running build(s) as interrupted; existing evidence kept.`);
  } catch(error) { console.error('[KaneGuard] Unable to reconcile interrupted builds:',error); }
  console.log(`\n  ◆ KaneGuard ready: http://${HOST}:${PORT}/\n  ↳ CartLab  http://${HOST}:${PORT}/cartlab/\n  ↳ CoinPulse http://${HOST}:${PORT}/coinpulse/\n`);
});
