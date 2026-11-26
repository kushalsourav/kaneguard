import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {browseFolders} from '../engine/connected-projects.mjs';

test('folder picker lists only visible, non-dependency folders and marks Node projects',async()=>{
  const home=await mkdtemp(path.join(os.tmpdir(),'kg-home-'));
  await mkdir(path.join(home,'code','shop','src'),{recursive:true});
  await writeFile(path.join(home,'code','shop','package.json'),JSON.stringify({name:'shop',scripts:{dev:'vite'},devDependencies:{vite:'5'}}));
  await writeFile(path.join(home,'code','shop','index.html'),'<!doctype html>');
  await mkdir(path.join(home,'code','notes'));await mkdir(path.join(home,'code','node_modules'));await mkdir(path.join(home,'.ssh'));
  const top=await browseFolders('',{home,repoRoot:path.join(home,'elsewhere','kaneguard')});
  assert.deepEqual(top.entries.map(e=>e.name),['code']);
  assert.equal(top.parent,null);
  const code=await browseFolders(path.join(home,'code'),{home});
  assert.deepEqual(code.entries.map(e=>[e.name,e.isProject]),[['notes',false],['shop',true]]);
  const shop=await browseFolders(path.join(home,'code','shop'),{home});
  assert.equal(shop.current.isProject,true);assert.equal(shop.current.framework,'Vite');
});

test('folder picker refuses credentials, system and out-of-scope folders',async()=>{
  const home=await mkdtemp(path.join(os.tmpdir(),'kg-home-'));await mkdir(path.join(home,'.ssh'));
  await assert.rejects(()=>browseFolders(path.join(home,'.ssh'),{home}),/cannot be browsed/);
  await assert.rejects(()=>browseFolders('/etc',{home}),/home folder/);
  await assert.rejects(()=>browseFolders(os.tmpdir(),{home}),/home folder/); // outside home: paste instead
  await assert.rejects(()=>browseFolders(path.join(home,'missing'),{home}),/not found/);
});

test('picker starts next to KaneGuard when KaneGuard lives inside home',async()=>{
  const home=await mkdtemp(path.join(os.tmpdir(),'kg-home-'));
  await mkdir(path.join(home,'hackathons','kaneguard','kaneguard'),{recursive:true});await mkdir(path.join(home,'hackathons','kaneguard','novo'));
  const r=await browseFolders('',{home,repoRoot:path.join(home,'hackathons','kaneguard','kaneguard')});
  assert.equal(r.path,path.join(await (await import('node:fs/promises')).realpath(home),'hackathons','kaneguard'));
  assert.ok(r.roots.some(x=>x.label==='Next to KaneGuard'));
});
