import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { ROOT } from '../engine/common.mjs';

test('one-command local server exposes both real apps, control center and API', { timeout: 12000 }, async () => {
  const port = 43001;
  const server = spawn(process.execPath, [path.join(ROOT, 'server/main.mjs')], { cwd: ROOT, env: { ...process.env, PORT: String(port) } });
  try {
    let healthy = false;
    for (let i = 0; i < 25; i++) {
      try { healthy = (await fetch(`http://127.0.0.1:${port}/api/health`)).ok; if (healthy) break; }
      catch { await delay(120); }
    }
    assert.ok(healthy, 'server must start');
    for (const route of ['/cartlab/', '/coinpulse/', '/control/']) {
      const r = await fetch(`http://127.0.0.1:${port}${route}`);
      assert.equal(r.status, 200, route);
      assert.match(await r.text(), /<html/);
    }
    const configs = await (await fetch(`http://127.0.0.1:${port}/api/configs`)).json();
    assert.equal(configs.length, 2);
    const pathTraversal = await fetch(`http://127.0.0.1:${port}/%2e%2e/%2e%2e/package.json`);
    assert.notEqual(pathTraversal.status, 200);
  } finally { server.kill('SIGTERM'); }
});
