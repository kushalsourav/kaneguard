import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRunLogger, createLineReader, compactEvent, redactSecrets } from '../engine/live-logger.mjs';
import { parseAgentStream } from '../engine/agent.mjs';

test('live logger writes timestamped lines, protects common keys and flushes', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'kg-live-'));
  const stream = new PassThrough();
  let shown = '';
  stream.on('data', (chunk) => { shown += String(chunk); });
  try {
    const log = createRunLogger(dir, 'run-123', { stdout: stream });
    log.log('AGENT PROMPT', 'please fix total\nAuthorization: Bearer abcdef123456789');
    log.log('KANE', 'pass');
    await log.flush();
    const written = await readFile(path.join(dir, 'live.log'), 'utf8');
    assert.equal(shown, written);
    assert.match(written, /AGENT PROMPT.*please fix total/);
    assert.doesNotMatch(written, /abcdef123456789/);
    assert.match(written, /KANE.*pass/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('streaming NDJSON handles chunked events', () => {
  const lines = [];
  const feed = createLineReader((line) => lines.push(line));
  feed.write('{"event":"init"}\n{"event":"res');
  feed.write('ult","result":{"status":"SUCCESS"}}\n');
  feed.end();
  assert.equal(lines.length, 2);
  assert.match(compactEvent(JSON.parse(lines[1])), /SUCCESS/);
});

test('agent success requires terminal SUCCESS plus zero exit', () => {
  const json = '{"event":"init"}\n{"event":"result","result":{"status":"SUCCESS","response":"fixed source"}}';
  const context = { code: 0, stdout: json, stderr: '', timedOut: false };
  assert.equal(parseAgentStream(json, context).ok, true);
  assert.equal(parseAgentStream(json, { ...context, code: 1 }).ok, false);
  assert.equal(parseAgentStream('{"event":"init"}', context).ok, false);
  assert.equal(parseAgentStream('{"event":"result","result":{"status":"FAILED"}}', context).ok, false);
});

test('logger masks common secret formats', () => {
  const redacted = redactSecrets('api_key=abcdef access_token: xyz123 Bearer my-token ghp_abcefghijklmnopqrstuv');
  assert.doesNotMatch(redacted, /abcdef|xyz123|my-token|ghp_abcef/);
});
