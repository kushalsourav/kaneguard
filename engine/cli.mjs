#!/usr/bin/env node
import { watch } from 'node:fs';
import { configFor, execProcess, ROOT } from './common.mjs';
import { verifyApp, isBusy } from './orchestrator.mjs';
import { listRuns, getRun } from './storage.mjs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const [action = 'help', appId = 'cartlab'] = process.argv.slice(2);
const say = (...args) => console.log(...args);
async function waitForServer(url) {
  for (let i = 0; i < 35; i++) {
    try { if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return true; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
}
async function withServer(config, run) {
  let external = false;
  try { external = (await fetch(config.url, { signal: AbortSignal.timeout(700) })).ok; } catch {}
  let server;
  if (!external) {
    const { spawn } = await import('node:child_process');
    server = spawn(process.execPath, [path.join(ROOT, 'server', 'main.mjs')], { cwd: ROOT, stdio: 'ignore' });
    if (!(await waitForServer(config.url))) { server.kill(); throw new Error(`Could not start local server: ${config.url}`); }
  }
  try { await run(); }
  finally { server?.kill('SIGTERM'); }
}
async function doRun(config) {
  const record = await verifyApp(config.id);
  say(`\nVerdict: ${record.status.toUpperCase()} · ${record.id}`);
  say(`Evidence files: runs/${record.id}/`);
  if (record.status !== 'passed') process.exitCode = 1;
}
async function main() {
  if (action === 'help') {
    say('KaneGuard — authentic browser verification + autonomous repair');
    say('  npm start                  Launch web apps + control center (live verification logs)');
    say('  npm run logs              Follow latest verification log in another terminal');
    say('  node engine/cli.mjs run cartlab|coinpulse');
    say('  node engine/cli.mjs watch cartlab|coinpulse');
    say('  node engine/cli.mjs replay <run-id>  # new authentic rerun');
    say('  node engine/cli.mjs history');
    say('  node engine/cli.mjs doctor');
    return;
  }
  if (action === 'doctor') {
    say(`Node: ${process.version}`);
    for (const [name, bin, args] of [['Kane CLI', process.env.KANE_CLI_BIN || 'kane-cli', ['--version']], ['Antigravity', process.env.KANEGUARD_AGENT_BIN || 'agy', ['--help']]]) {
      const r = await execProcess(bin, args, { timeoutMs: 7000 });
      say(`${name}: ${r.spawnError ? `MISSING (${r.spawnError})` : r.code === 0 ? `installed (${(r.stdout || r.stderr).trim().slice(0, 90)})` : `unavailable (exit ${r.code})`}`);
    }
    say('Authenticate separately: kane-cli login  |  agy');
    return;
  }
  if (action === 'history') {
    const runs = await listRuns();
    if (!runs.length) say('No verification history yet.');
    for (const r of runs) say(`${r.createdAt}  ${r.appLabel.padEnd(10)}  ${r.status.padEnd(22)}  ${r.id}`);
    return;
  }
  if (action === 'replay') {
    const previous = await getRun(appId);
    if (!previous) throw new Error('Prior run not found');
    const target = await configFor(previous.appId);
    say(`Re-verifying ${target.label} from prior run ${previous.id}; generating fresh browser evidence.`);
    await withServer(target, async () => doRun(target));
    return;
  }
  if (!['run', 'watch'].includes(action)) throw new Error(`Unknown command: ${action}`);
  const config = await configFor(appId);
  await withServer(config, async () => {
    if (action === 'run') return await doRun(config);
    say(`Watching ${config.watchPaths.join(', ')}; all edits trigger authentic Kane browser checks. Ctrl-C to stop.`);
    let timeout;
    for (const p of config.watchPaths) watch(path.join(ROOT, p), { recursive: true }, () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        if (isBusy()) { say('Change observed during active repair; avoiding recursive loop.'); return; }
        doRun(config).catch((e) => console.error(e));
      }, 900);
    });
    await new Promise(() => {});
  });
}
main().catch((error) => { console.error(`KaneGuard error: ${error.message}`); process.exitCode = 1; });
