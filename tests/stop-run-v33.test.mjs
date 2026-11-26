import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execProcess, requestStop, resetStop, isStopRequested} from '../engine/common.mjs';

import {readFileSync} from 'node:fs';
// A killed process can linger as a zombie until its (re)parent reaps it; that is not running.
const alive=(pid)=>{try{process.kill(pid,0);}catch{return false;}try{return !/\) Z /.test(readFileSync(`/proc/${pid}/stat`,'utf8'));}catch{return true;}};

test('Stop kills the running process and its children, then refuses new processes',{skip:process.platform==='win32'},async()=>{
  resetStop();
  let childPid=null;
  // Stand-in for Kane CLI: a node process that launches a long-lived child (like a browser).
  // The grandchild is another node process (no reliance on a `sleep` binary); its pid is
  // printed with a marker so unrelated output (warnings, NODE_OPTIONS noise) can't confuse it.
  const script="const c=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});process.stdout.write('GRANDCHILD_PID='+c.pid+'\\n');setInterval(()=>{},1000)";
  let out='';
  const running=execProcess(process.execPath,['-e',script],{timeoutMs:30000,onOutput:(k,s)=>{if(k!=='stdout')return;out+=s;const m=out.match(/GRANDCHILD_PID=(\d+)/);if(m)childPid=Number(m[1]);}});
  for(let i=0;i<100&&!childPid;i++)await new Promise(r=>setTimeout(r,50));
  assert.ok(childPid&&alive(childPid),`child started (output was: ${JSON.stringify(out.slice(0,300))})`);
  assert.equal(requestStop(),1);
  const result=await running;
  assert.equal(result.stopped,true);
  await new Promise(r=>setTimeout(r,300));
  assert.equal(alive(childPid),false,'grandchild (browser stand-in) was killed too');
  assert.equal(isStopRequested(),true);
  await assert.rejects(execProcess(process.execPath,['-e','1']),/Stopped by user/);
  resetStop();
  const ok=await execProcess(process.execPath,['-e','console.log("ok")']);
  assert.equal(ok.stdout.trim(),'ok');
});

test('a stopped or unknown Kane verdict can never pass a gate',async()=>{
  const src=await readFile(new URL('../engine/feature.mjs',import.meta.url),'utf8');
  assert.match(src,/if \(result\.verdict !== 'passed'\) \{/);
  assert.match(src,/status:'interrupted',summary:'Stopped by you'/);
  const kane=await readFile(new URL('../engine/kane.mjs',import.meta.url),'utf8');
  assert.match(kane,/output\.stopped && parsed\.verdict !== 'passed'/);
});

test('stop endpoint is local-page only and the UI offers Stop while running',async()=>{
  const server=await readFile(new URL('../server/main.mjs',import.meta.url),'utf8');
  assert.match(server,/'\/api\/stop'/);
  assert.match(server,/Stop is only available to the local KaneGuard page/);
  assert.match(server,/killAllChildren\(\)/);
  const html=await readFile(new URL('../public/control/index.html',import.meta.url),'utf8');
  assert.match(html,/id="stopButton" data-stop-run/);
  const atelier=await readFile(new URL('../public/control/trust-atelier.mjs',import.meta.url),'utf8');
  assert.match(atelier,/run\.status==='running'\?`<button type="button" class="stop-run" data-stop-run/);
});
