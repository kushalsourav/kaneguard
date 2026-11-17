import { readdir, readFile, mkdir, writeFile, unlink, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { ROOT, relative, exists } from './common.mjs';
import { sourceFileFor, sourcePrefix } from './connected-projects.mjs';

const trackedRoots = ['public', 'engine', 'server', 'configs', 'kane', 'tests', 'scripts', '.github'];
const trackedFiles = ['package.json', 'README.md', '.gitignore'];
async function walk(dir, found) {
  if (!(await exists(dir))) return;
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) await walk(full, found);
    else if (item.isFile()) found.push(full);
  }
}
const externalSkip = new Set(['node_modules','.git','.next','.nuxt','.output','.cache','dist','build','coverage','fixtures']);
const externalSafeExt = /\.(?:html|css|scss|sass|less|js|mjs|cjs|jsx|ts|tsx|vue|svelte|astro|svg|json|md|yaml|yml)$/i;
/** Connected projects retain source in place. Snapshot only bounded, readable
 * source paths and package.json as a protected file. Never traverse links or
 * copy .env, node_modules, .git or build outputs into evidence. */
export async function connectedSnapshot(config) {
  if(config?.kind!=='connected') return new Map();
  const files=new Map();
  const prefix=sourcePrefix(config);
  let totalBytes=0;
  async function walk(dir,rel='',depth=0) {
    if(depth>9 || files.size>1200 || totalBytes>32_000_000) throw new Error('Connected project exceeds safe source-snapshot limits');
    for(const ent of await readdir(dir,{withFileTypes:true})) {
      const name=rel?`${rel}/${ent.name}`:ent.name;
      if(ent.name.startsWith('.') || externalSkip.has(ent.name)) continue;
      const filename=path.join(dir,ent.name);
      if(ent.isSymbolicLink()) { files.set(prefix+name,Buffer.from('SYMLINK:protected'));continue; }
      if(ent.isDirectory()) {await walk(filename,name,depth+1);continue;}
      if(!ent.isFile() || !(externalSafeExt.test(ent.name) || name==='package.json')) continue;
      const bytes=await readFile(filename);
      totalBytes+=bytes.length;
      if(bytes.length>2_000_000) throw new Error('Connected source file too large');
      files.set(prefix+name,bytes);
    }
  }
  await walk(config.projectDir);
  return files;
}
export async function snapshot({config} = {}) {
  const files = trackedFiles.map((p) => path.join(ROOT, p));
  for (const name of trackedRoots) await walk(path.join(ROOT, name), files);
  const states = new Map();
  for (const file of files) if (await exists(file)) states.set(relative(file), await readFile(file));
  for(const [name,bytes] of await connectedSnapshot(config)) states.set(name,bytes);
  return states;
}
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
export function isPermittedSourceChange(name, allowed) {
  if (allowed.includes(name)) return true;
  return allowed.some((entry) => {
    if (!entry.endsWith('/**')) return false;
    const prefix = entry.slice(0, -2);
    if (!name.startsWith(prefix)) return false;
    const segments = name.slice(prefix.length).split('/');
    if (segments.some((part) => !part || part.startsWith('.') || ['fixtures','tests','__tests__','node_modules','runs'].includes(part))) return false;
    if (/\.(?:test|spec)\./i.test(name)) return false;
    return /\.(?:html|css|scss|sass|less|mjs|cjs|js|jsx|ts|tsx|vue|svelte|astro|svg)$/i.test(name);
  });
}
export async function reviewAndGuard(before, allowed, {config} = {}) {
  const after = await snapshot({config});
  const all = new Set([...before.keys(), ...after.keys()]);
  const changed = [...all].filter((name) => sha(before.get(name) ?? Buffer.alloc(0)) !== sha(after.get(name) ?? Buffer.alloc(0)) || before.has(name) !== after.has(name));
  const isAllowed = (name) => isPermittedSourceChange(name, allowed);
  const unauthorized = changed.filter((name) => !isAllowed(name));
  for (const name of unauthorized) {
    const file = config?.kind==='connected' && name.startsWith(sourcePrefix(config))
      ? sourceFileFor(config,name) : path.join(ROOT,name);
    const existing=await lstat(file).catch(()=>null);
    if (existing?.isSymbolicLink()) await unlink(file);
    if (!before.has(name)) {if(existing && !existing.isSymbolicLink()) await unlink(file);}
    else if (!String(before.get(name)).startsWith('SYMLINK:protected')) {
      await mkdir(path.dirname(file), {recursive:true}); await writeFile(file,before.get(name));
    }
  }
  return { changed: changed.filter(isAllowed), rejected: unauthorized };
}
export async function saveCheckpoint(before, dir) {
  const base = path.join(dir, 'checkpoint');
  for (const [name, bytes] of before) {
    const file = path.join(base, name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes);
  }
  return base;
}
/** A real, context-aware unified diff rather than treating each line shift as an edit. */
export function summarizeDiff(before, after, changed) {
  const output = [];
  for (const file of changed) {
    const lines = (buffer) => {
      const raw = buffer.toString('utf8');
      return raw ? raw.replace(/\n$/, '').split('\n') : [];
    };
    const a = before.has(file) ? lines(before.get(file)) : [];
    const b = after.has(file) ? lines(after.get(file)) : [];
    // De-duplicate large common prefixes/suffixes before calculating the LCS.
    let prefix = 0;
    while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
    let suffix = 0;
    while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - suffix - 1] === b[b.length - suffix - 1]) suffix++;
    const left = a.slice(prefix, a.length - suffix), right = b.slice(prefix, b.length - suffix);
    if (!left.length && !right.length) continue;
    const ops = a.slice(0, prefix).map((text) => [' ',text]);
    if (left.length * right.length <= 800_000) {
      const dp = Array.from({length:left.length+1},()=>new Uint32Array(right.length+1));
      for (let i=left.length-1;i>=0;i--) for(let j=right.length-1;j>=0;j--)
        dp[i][j] = left[i]===right[j] ? dp[i+1][j+1]+1 : Math.max(dp[i+1][j],dp[i][j+1]);
      let i=0,j=0;
      while(i<left.length || j<right.length) {
        if (i<left.length && j<right.length && left[i]===right[j]) {ops.push([' ',left[i]]);i++;j++;}
        else if (i<left.length && (j===right.length || dp[i+1][j]>=dp[i][j+1])) ops.push(['-',left[i++]]);
        else ops.push(['+',right[j++]]);
      }
    } else {
      // For very large replace-all edits show the exact lines, within the
      // output size limit, without allocating quadratic memory.
      ops.push(...left.map((text)=>['-',text]), ...right.map((text)=>['+',text]));
    }
    ops.push(...a.slice(a.length-suffix).map((text)=>[' ',text]));
    const edits = [];
    for (let i=0;i<ops.length;i++) if (ops[i][0]!==' ') edits.push(i);
    if (!edits.length) continue;
    output.push(before.has(file) ? `--- a/${file}` : '--- /dev/null', after.has(file) ? `+++ b/${file}` : '+++ /dev/null');
    const context=2;
    let k=0;
    while(k<edits.length) {
      let first=edits[k], last=first;
      while(k+1<edits.length && edits[k+1] - last <= context*2+1) last=edits[++k];
      const start=Math.max(0,first-context), end=Math.min(ops.length,last+context+1);
      let oldStart=1,newStart=1;
      for(let i=0;i<start;i++) { if(ops[i][0]!=='+') oldStart++; if(ops[i][0]!=='-') newStart++; }
      const hunk=ops.slice(start,end);
      output.push(`@@ -${oldStart},${hunk.filter((x)=>x[0]!=='+').length} +${newStart},${hunk.filter((x)=>x[0]!=='-').length} @@`);
      for(const [tag,text] of hunk) output.push(`${tag}${text}`);
      k++;
    }
    output.push('');
    if (output.join('\n').length > 20_000) return output.join('\n').slice(0,20_000)+'\n... diff truncated; full source available in repository';
  }
  return output.join('\n').trimEnd();
}
