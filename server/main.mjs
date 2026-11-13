import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, configFor } from '../engine/common.mjs';
import { listRuns, getRun } from '../engine/storage.mjs';
import { verifyApp, isBusy } from '../engine/orchestrator.mjs';

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
    if (url.pathname === '/api/health') return sendJSON(res, 200, { ok: true, busy: isBusy(), service: 'KaneGuard', time: new Date().toISOString() });
    if (url.pathname === '/api/configs') return sendJSON(res, 200, await Promise.all(['cartlab', 'coinpulse'].map(configFor)));
    if (url.pathname === '/api/runs' && req.method === 'GET') return sendJSON(res, 200, await listRuns());
    if (url.pathname.startsWith('/api/runs/') && req.method === 'GET') {
      const id = url.pathname.split('/')[3];
      const run = await getRun(id);
      return run ? sendJSON(res, 200, run) : badRequest(res, 404, 'Run not found');
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
