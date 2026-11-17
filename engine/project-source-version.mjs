import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT } from './common.mjs';
import { connectedSnapshot } from './snapshot.mjs';

const safeProject = /^app-[a-z0-9-]{5,54}$/;
const sourceFile = /\.(?:html?|css|m?js|json|svg|png|jpe?g|gif|webp|ico|woff2?)$/i;
const skipDir = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'coverage']);

/** Hash the actual source bytes, rather than relying on the coding agent's
 * terminal message or low-resolution file mtimes. Only registered, isolated
 * playground projects can be inspected. No generated code is executed here. */
export async function projectSourceVersion(projectId, { root = ROOT } = {}) {
  if (!safeProject.test(projectId)) throw new Error('Invalid project ID');
  const cfg = JSON.parse(await readFile(path.join(root, 'configs', `${projectId}.json`), 'utf8'));
  if (cfg.id !== projectId || !['playground','connected'].includes(cfg.kind)) throw new Error('Not a supported project');
  if (cfg.kind === 'connected') {
    const sha=createHash('sha256');
    const files=await connectedSnapshot(cfg);
    for(const [filename,bytes] of [...files].sort((a,b)=>a[0].localeCompare(b[0]))) {
      if(filename.endsWith('/package.json')) continue;
      sha.update(filename);sha.update('\0');sha.update(bytes);sha.update('\0');
    }
    return {version:sha.digest('hex').slice(0,24),files:files.size,kind:'connected'};
  }
  const projectDir = path.join(root, 'public', projectId);
  const sha = createHash('sha256');
  let count = 0;
  async function collect(dir, relative = '', depth = 0) {
    if (depth > 5) return;
    const entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name.startsWith('.') || skipDir.has(entry.name)) continue;
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await collect(path.join(dir, entry.name), name, depth + 1);
      } else if (entry.isFile() && sourceFile.test(entry.name)) {
        if (++count > 250) throw new Error('Too many app source files');
        const filePath = path.join(dir, entry.name);
        if ((await stat(filePath)).size > 5_000_000) throw new Error('Source file too large for preview monitoring');
        const data = await readFile(filePath);
        sha.update(name);sha.update('\0');sha.update(data);sha.update('\0');
      }
      // Never follow symlinks outside the project workspace.
    }
  }
  await collect(projectDir);
  return { version: sha.digest('hex').slice(0, 24), files: count };
}
