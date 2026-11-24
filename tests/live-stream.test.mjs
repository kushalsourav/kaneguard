import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { createRunLogger } from '../engine/live-logger.mjs';
import { subscribeRunEvents, recentRunLog } from '../engine/live-events.mjs';
import { headlessPermissionProblem, readFeatureSourceContext } from '../engine/feature-agent.mjs';
import { ROOT, RUNS, configFor } from '../engine/common.mjs';

test('live logger fan-out emits redacted lines immediately and unsubscribe works', async () => {
  const id = 'test-stream-unit';
  const dir = path.join(RUNS, id);
  await mkdir(dir, { recursive:true });
  const events = [];
  const stop = subscribeRunEvents(id, (line) => events.push(line));
  try {
    const logger = createRunLogger(dir, id, { stdout: new PassThrough() });
    logger.log('PLAN', 'step tool DONE Bearer veryprivate123');
    assert.equal(events.length, 1, 'events must fire before the disk append completes');
    assert.match(events[0], /step tool DONE/);
    assert.doesNotMatch(events[0], /veryprivate123/);
    await logger.flush();
    assert.deepEqual(await recentRunLog(id), events);
    stop();
    logger.log('BUILD', 'next event');
    assert.equal(events.length, 1);
    await logger.flush();
  } finally { stop(); await rm(dir, {recursive:true, force:true}); }
});

test('planner reads application source directly and reports denied headless tools', async () => {
  const cfg = await configFor('cartlab');
  const source = await readFeatureSourceContext(cfg);
  assert.match(source,/FILE public\/cartlab\/app\.mjs/);
  assert.match(source,/FILE public\/cartlab\/pricing\.mjs/);
  const reason = headlessPermissionProblem('jetski: no output produced — a tool required the "command" permission that headless mode cannot prompt for, so it was auto-denied');
  assert.match(reason, /permissions\.allow/);
  assert.match(reason, /dangerously-skip-permissions/);
  assert.equal(headlessPermissionProblem('harmless update available'),null);
});

test('SSE endpoint replays a real saved log, not a mocked browser result', { timeout: 9000 }, async () => {
  const id = 'sse-test-49367';
  const port = 43006;
  const dir = path.join(RUNS, id);
  const server = spawn(process.execPath, [path.join(ROOT,'server/main.mjs')], { cwd: ROOT, env: {...process.env, PORT:String(port)} });
  await mkdir(dir,{recursive:true});
  await writeFile(path.join(dir,'record.json'), JSON.stringify({id,appId:'cartlab',createdAt:new Date().toISOString(),status:'running'}));
  await writeFile(path.join(dir,'live.log'), '[2026-11-15T07:00:56Z] [sse-test-49367] [PLAN] Real agent log sample\n');
  const controller = new AbortController();
  let reader;
  try {
    let up=false;
    for(let i=0;i<40;i++) {
      try { if((await fetch(`http://127.0.0.1:${port}/api/health`)).ok){up=true;break;} } catch {}
      await delay(90);
    }
    assert.ok(up);
    const notFound = await fetch(`http://127.0.0.1:${port}/api/runs/not-a-run/events`);
    assert.equal(notFound.status,404);
    const response = await fetch(`http://127.0.0.1:${port}/api/runs/${id}/events`,{signal:controller.signal});
    assert.equal(response.status,200);
    assert.match(response.headers.get('content-type'),/text\/event-stream/);
    reader = response.body.getReader();
    let buffer='';
    for(let i=0;i<6 && !buffer.includes('event: snapshot');i++) {
      const {value,done}=await reader.read();
      if(done) break;
      buffer+=new TextDecoder().decode(value);
    }
    assert.match(buffer,/event: snapshot/);
    assert.match(buffer,/Real agent log sample/);
  } finally {
    controller.abort();
    reader?.cancel().catch(()=>{});
    server.kill('SIGTERM');
    await rm(dir,{recursive:true,force:true});
  }
});
