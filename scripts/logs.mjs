#!/usr/bin/env node
// Live-tail the newest KaneGuard run. Ctrl+C to stop. No npm dependencies.
import { readdir, stat, open } from 'node:fs/promises';
import path from 'node:path';
import { RUNS } from '../engine/common.mjs';
let lastFile = '', lastSize = 0, reading = false;
console.log('Following KaneGuard live run logs (Ctrl+C to stop). Waiting for new runs…');
async function tick() {
  if (reading) return;
  reading = true;
  try {
    const dirs = (await readdir(RUNS, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort().reverse();
    for (const dir of dirs) {
      const file = path.join(RUNS, dir, 'live.log');
      let stats;
      try { stats = await stat(file); } catch { continue; }
      if (file !== lastFile) {
        lastFile = file;
        lastSize = Math.max(0, stats.size - 6000);
        console.log(`\n--- ${dir}: live.log ---`);
      }
      if (stats.size < lastSize) lastSize = 0;
      if (stats.size > lastSize) {
        const handle = await open(file, 'r');
        try {
          const length = Math.min(stats.size - lastSize, 1_000_000);
          const bytes = Buffer.alloc(length);
          const { bytesRead } = await handle.read(bytes, 0, length, lastSize);
          lastSize += bytesRead;
          process.stdout.write(bytes.subarray(0, bytesRead));
        } finally { await handle.close(); }
      }
      break;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('Log follow error:', error.message);
  } finally { reading = false; }
}
await tick();
setInterval(tick, 700);
