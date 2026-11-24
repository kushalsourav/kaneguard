#!/usr/bin/env node
import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {RUNS,ROOT} from '../engine/common.mjs';
import {getRun} from '../engine/storage.mjs';
import {trustReceiptHTML,replayHTML} from '../engine/receipt.mjs';
import {redactSecrets} from '../engine/live-logger.mjs';
const id=process.argv[2], destination=process.argv[3];
if(!/^[\w-]{5,80}$/.test(id||'')){console.error('Usage: node scripts/export-replay.mjs RUN_ID [output-directory]');process.exit(1);}
const run=await getRun(id);
if(!run){console.error('Unknown run');process.exit(1);}
if(run.status==='running'){console.error('Run still active; export after completion');process.exit(1);}
const output=path.resolve(destination||path.join(ROOT,'judge-replays',id));
if(output===ROOT||output===RUNS||output.startsWith(RUNS+path.sep))throw new Error('Unsafe replay destination');
await mkdir(path.join(output,'evidence'),{recursive:true});
const dir=path.join(RUNS,id);
for(const f of await readdir(dir)) if(/^[\w.-]+$/.test(f) && !/^\./.test(f) && f!=='record.json') {
  // Share only plain-text provenance, never hidden files or credentials/configs.
  if(/\.(?:txt|ndjson|log|json)$/.test(f)) {
    const raw=await readFile(path.join(dir,f),'utf8');
    await writeFile(path.join(output,'evidence',f),redactSecrets(raw));
  }
}
await writeFile(path.join(output,'index.html'),replayHTML(run,{offline:true}));
await writeFile(path.join(output,'receipt.html'),trustReceiptHTML(run,{offline:true}));
await writeFile(path.join(output,'record.json'),redactSecrets(JSON.stringify(run,null,2)));
console.log(`Judge replay ready: ${path.join(output,'index.html')} (review for secrets before publishing)`);
