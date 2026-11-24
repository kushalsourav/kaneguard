import { open, stat } from 'node:fs/promises';
import path from 'node:path';
import { RUNS } from './common.mjs';

// Server-local fan-out. The immutable disk log remains the source of truth.
const listeners = new Map();
export function subscribeRunEvents(runId, callback) {
  let group = listeners.get(runId);
  if (!group) listeners.set(runId, group = new Set());
  group.add(callback);
  return () => {
    group.delete(callback);
    if (!group.size) listeners.delete(runId);
  };
}
export function emitRunEvent(runId, line) {
  for (const callback of listeners.get(runId) || []) {
    try { callback(line); } catch { /* an individual disconnected client cannot stop a run */ }
  }
}

/** Replay only the last few KB to avoid reading unbounded agent logs into memory. */
export async function recentRunLog(runId, { maxBytes = 48000, maxLines = 90 } = {}) {
  if (!/^[a-zA-Z0-9-]{5,80}$/.test(runId)) throw new Error('Invalid run ID');
  const filePath = path.join(RUNS, runId, 'live.log');
  let file;
  try {
    const info = await stat(filePath);
    const count = Math.min(maxBytes, info.size);
    if (!count) return [];
    file = await open(filePath, 'r');
    const buffer = Buffer.alloc(count);
    const { bytesRead } = await file.read(buffer, 0, count, info.size - count);
    const content = buffer.subarray(0, bytesRead).toString('utf8');
    // If truncated at the start, skip a partial line.
    const lines = content.split(/\r?\n/);
    if (info.size > count) lines.shift();
    return lines.filter(Boolean).slice(-maxLines);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  } finally { await file?.close(); }
}
