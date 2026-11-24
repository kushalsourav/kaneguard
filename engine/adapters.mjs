import { existsSync } from 'node:fs';
import path from 'node:path';
import { execProcess, ROOT } from './common.mjs';
import { parseAgentStream } from './agent.mjs';
import { createLineReader, compactEvent } from './live-logger.mjs';
import { agentActionFromEvent, formatAgentAction } from './kane-trace.mjs';

export const AGENTS = Object.freeze([
  {id:'cursor', label:'Cursor', commands:['agent','cursor-agent'], env:'KANEGUARD_CURSOR_BIN'},
  {id:'antigravity', label:'Antigravity', commands:['agy'], env:'KANEGUARD_ANTIGRAVITY_BIN'},
  {id:'claude', label:'Claude Code', commands:['claude'], env:'KANEGUARD_CLAUDE_BIN'},
  {id:'codex', label:'Codex', commands:['codex'], env:'KANEGUARD_CODEX_BIN'}
]);
export function agentInfo(id) { return AGENTS.find((a) => a.id === id) ?? null; }
export function validateAgent(id) {
  if (!agentInfo(id)) throw new Error('Choose Cursor, Antigravity, Claude Code, or Codex');
  return id;
}

function installedBinary(file, env = process.env) {
  if (!file || file.includes('\0')) return false;
  if (file.includes('/') || file.includes('\\')) return existsSync(file);
  const extensions = process.platform === 'win32' ? ['', '.exe', '.cmd'] : [''];
  return (env.PATH || '').split(path.delimiter).some((folder) =>
    extensions.some((extension) => existsSync(path.join(folder, file + extension))));
}
export function resolveAgentBinary(id, env = process.env) {
  const agent = agentInfo(validateAgent(id));
  if (id === 'antigravity' && env.KANEGUARD_AGENT_BIN) return env.KANEGUARD_AGENT_BIN;
  if (env[agent.env]) return env[agent.env];
  return agent.commands.find((name) => installedBinary(name, env)) || agent.commands[0];
}
export function agentCommand(id, prompt, {projectDir = ROOT} = {}) {
  validateAgent(id);
  const command = resolveAgentBinary(id);
  switch (id) {
    case 'cursor': return {command, args:['-p',prompt,'--output-format','stream-json'], cwd:projectDir};
    case 'antigravity': return {command, args:['-p',prompt,'--output-format','stream-json','--print-timeout','0s','--sandbox'],cwd:projectDir};
    case 'claude': return {command, args:['-p',prompt,'--output-format','stream-json','--verbose','--permission-mode','acceptEdits','--disallowedTools','Bash'], cwd:projectDir};
    case 'codex': return {command, args:['exec','--json','--sandbox','workspace-write','--skip-git-repo-check','-C',projectDir,prompt],cwd:projectDir};
  }
}
/** All adapters are headless, preserve their raw JSONL trace, and report failure
 * unless the vendor terminal success event and process exit agree. */
export function decodeAgent(id, data, result) {
  if (id === 'antigravity') return parseAgentStream(data,result);
  const events = [];
  for (const line of String(data || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { events.push(JSON.parse(line)); } catch {}
  }
  const last = (condition) => events.findLast(condition);
  let succeeded = false, response = '', status = '';
  if (id === 'codex') {
    const terminal = last((e)=>e?.type==='turn.completed'||e?.type==='turn.failed');
    succeeded = terminal?.type==='turn.completed'; status = terminal?.type || 'missing_terminal';
    const item = last((e)=>e?.type==='item.completed'&&e?.item?.type==='agent_message');
    response = String(item?.item?.text || '');
  } else if (id === 'claude') {
    const terminal = last((e)=>e?.type==='result');
    succeeded = !!terminal && terminal.is_error !== true && terminal.subtype === 'success';
    status = terminal?.subtype || 'missing_terminal';
    response = String(terminal?.result || '');
    if (!response) {
      const assistant = last((e)=>e?.type==='assistant');
      response = (assistant?.message?.content || []).filter((part)=>part.type==='text').map((part)=>part.text).join('\n');
    }
  } else if (id === 'cursor') {
    const terminal = last((e)=>e?.type==='result');
    succeeded = !!terminal && terminal.is_error === false && terminal.subtype === 'success';
    status = terminal?.subtype || 'missing_terminal';
    response = typeof terminal?.result === 'string' ? terminal.result :
      typeof terminal?.message === 'string' ? terminal.message : '';
    if (!response) {
      const assistants = events.filter((e)=>e?.type==='assistant');
      response = assistants.flatMap((e) => e?.message?.content || []).filter((c)=>c?.type==='text').map((c)=>c.text).join('\n');
    }
  }
  const ok = succeeded && result.code === 0 && !result.spawnError && !result.timedOut;
  return {ok, response, status, events:events.length,
    summary:response.slice(0,1200) || result.spawnError || (result.timedOut ? 'Agent reached watchdog timeout' : String(result.stderr || '').slice(-700) || `${id} did not complete successfully`)};
}

export function agentStream(id, liveLog, stage) {
  const stdout = createLineReader((line) => {
    try {
      const event = JSON.parse(line);
      // One readable line per real tool action (edit/read/run/note), for every adapter.
      const action = agentActionFromEvent(event);
      if (action) { liveLog(stage, formatAgentAction(action)); return; }
      if (id === 'antigravity') {
        const summary = compactEvent(event);
        if (summary && !(event?.step_update?.step_type==='agent_response' && event?.step_update?.state==='ACTIVE')) liveLog(stage,summary);
      } else if (id === 'codex') {
        if (event.type==='item.started'||event.type==='item.completed') {
          const item = event.item || {};
          if (['command_execution','file_change','agent_message'].includes(item.type))
            liveLog(stage, `${item.type.replaceAll('_',' ')} · ${event.type.endsWith('completed') ? 'done' : 'active'}${item.command ? ` · ${String(item.command).slice(0,130)}` : ''}`);
        } else if (event.type === 'turn.completed') liveLog(stage, 'Codex turn completed');
      } else if (id === 'claude') {
        if (event.type==='assistant') {
          const tools=(event.message?.content || []).filter((c)=>c.type==='tool_use').map((c)=>c.name).slice(0,3);
          if (tools.length) liveLog(stage, `Claude tool · ${tools.join(', ')}`);
        } else if (event.type==='result') liveLog(stage, `Claude finished · ${event.subtype || 'result'}`);
      } else if (id === 'cursor') {
        if (event.type==='tool_call') liveLog(stage, `Cursor tool · ${event.subtype || 'working'}`);
        else if (event.type==='result') liveLog(stage, 'Cursor finished agent turn');
      }
    } catch { if (line.trim()) liveLog(stage,String(line).slice(0,150)); }
  });
  const stderr = createLineReader((line) => { if (line.trim()) liveLog(`${stage} STDERR`,line.slice(0,300)); });
  return {onOutput(kind,chunk) { (kind==='stdout' ? stdout : stderr).write(chunk); }, end(){stdout.end();stderr.end();}};
}
export function agentWorkspace(config) { return config?.kind==='connected' ? config.projectDir : config?.kind==='playground' ? path.join(ROOT,'public',config.id) : ROOT; }
export async function invokeAgent(config,prompt,stage,log, {runner=execProcess,timeoutMs=8*60_000} = {}) {
  const id= config.agentId || 'antigravity';
  const spec=agentCommand(id,prompt,{projectDir:agentWorkspace(config)});
  const stream=agentStream(id,log,stage);
  const result=await runner(spec.command,spec.args,{cwd:spec.cwd,timeoutMs,onOutput:stream.onOutput});
  stream.end();
  return {...result,decoded:decodeAgent(id,result.stdout,result)};
}
export async function agentAvailability(env=process.env) {
  return AGENTS.map((a)=>({id:a.id,label:a.label, installed:installedBinary(resolveAgentBinary(a.id,env),env), command:resolveAgentBinary(a.id,env)}));
}
