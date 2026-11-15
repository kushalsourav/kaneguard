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

const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC = path.join(ROOT, 'public');
let pendingVerify = false;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png' };
const sendJSON = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(data)); };
const badRequest = (res, status, message) => sendJSON(res, status, { error: message });

async function staticFile(url, res) {
  const p = url.pathname === '/' ? '/control/' : url.pathname;
  const normalized = path.posix.normalize(decodeURIComponent(p));
  const file = path.resolve(PUBLIC, `.${normalized.endsWith('/') ? `${normalized}index.html` : normalized}`);
  if (!file.startsWith(`${PUBLIC}${path.sep}`)) return badRequest(res, 403, 'Forbidden');
  let info;
  try { info = await stat(file); } catch { return badRequest(res, 404, 'Not found'); }
  if (!info.isFile()) return badRequest(res, 404, 'Not found');
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
  createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${HOST}:${PORT}`);
    if (url.pathname === '/api/health') return sendJSON(res, 200, { ok: true, busy: isBusy() || pendingVerify, service: 'KaneGuard', time: new Date().toISOString() });
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
      let input;
      try { input = validateBuildInput(parsed.appId, parsed.prompt); } catch (error) { return badRequest(res, 400, error.message); }
      pendingVerify = true;
      console.log(`[KaneGuard] AI feature build requested for ${input.appId}: ${input.prompt}`);
      setImmediate(() => {
        buildFeature(input.appId, input.prompt).catch((e) => console.error('Feature build failed:', e)).finally(() => { pendingVerify = false; });
      });
      return sendJSON(res, 202, { accepted:true, mode:'build', appId:input.appId, message:'Agent-first feature workflow queued' });
    }
    const resumeRoute = url.pathname.match(/^\/api\/runs\/([a-zA-Z0-9-]{5,80})\/resume$/);
    if (resumeRoute && req.method === 'POST') {
      if (isBusy() || pendingVerify) return badRequest(res, 409, 'A KaneGuard workflow is already active');
      const prior = await getRun(resumeRoute[1]);
      if (!prior || prior.mode !== 'build' || !['agent_error','failed','infrastructure_error'].includes(prior.status) ||
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
server.listen(PORT, HOST, () => console.log(`\n  ◆ KaneGuard ready: http://${HOST}:${PORT}/\n  ↳ CartLab  http://${HOST}:${PORT}/cartlab/\n  ↳ CoinPulse http://${HOST}:${PORT}/coinpulse/\n`));
