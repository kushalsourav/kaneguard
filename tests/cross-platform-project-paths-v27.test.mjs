import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {resolveProjectFolderInput,projectPathDisplay} from '../engine/local-project-path.mjs';
import {inspectLocalProject,connectExistingProject,disconnectExistingProject} from '../engine/connected-projects.mjs';

async function makeApp(folder) {
  await mkdir(folder,{recursive:true});
  await writeFile(path.join(folder,'package.json'),JSON.stringify({name:'attached-demo',scripts:{dev:'vite --host 127.0.0.1'},dependencies:{vite:'6.0.0'}}));
  await writeFile(path.join(folder,'index.html'),'<h1>Not an empty folder</h1>');
}

test('folder input interprets host-native, copied Windows, WSL and macOS-style paths without an OS selector',()=>{
  const home='/home/tester';
  assert.equal(resolveProjectFolderInput(' ~/projects/demo ',{home,platform:'linux'}),'/home/tester/projects/demo');
  assert.equal(resolveProjectFolderInput('"C:\\Users\\Jane Doe\\Projects\\Shop"',{platform:'linux',windowsMountRoot:'/mnt'}),'/mnt/c/Users/Jane Doe/Projects/Shop');
  assert.equal(resolveProjectFolderInput('D:/Work/My UI',{platform:'linux',windowsMountRoot:'/mnt'}),'/mnt/d/Work/My UI');
  assert.equal(resolveProjectFolderInput('D://Work////My UI',{platform:'linux',windowsMountRoot:'/mnt'}),'/mnt/d/Work/My UI');
  assert.equal(resolveProjectFolderInput('D:\\\\Work\\My UI',{platform:'linux',windowsMountRoot:'/mnt'}),'/mnt/d/Work/My UI');
  assert.equal(resolveProjectFolderInput(' /mnt/d/work/shop ',{platform:'linux'}),'/mnt/d/work/shop');
  assert.equal(resolveProjectFolderInput('file:///Users/demo/projects/shop',{platform:'darwin'}),'/Users/demo/projects/shop');
  assert.equal(resolveProjectFolderInput('/Users/demo/projects/shop',{platform:'darwin'}),'/Users/demo/projects/shop');
  assert.equal(resolveProjectFolderInput('D:/Work/My UI',{platform:'win32'}), 'D:\\Work\\My UI');
  assert.equal(resolveProjectFolderInput('/mnt/d/Work/My UI',{platform:'win32'}),'D:\\Work\\My UI');
  assert.equal(resolveProjectFolderInput('~\\projects\\shop',{platform:'win32',home:'C:\\Users\\Jane'}),'C:\\Users\\Jane\\projects\\shop');
  assert.equal(resolveProjectFolderInput('\\\\wsl.localhost\\Ubuntu\\home\\tester\\projects\\shop',{platform:'linux',wslDistro:'Ubuntu'}),'/home/tester/projects/shop');
  assert.throws(()=>resolveProjectFolderInput('\\\\wsl.localhost\\Other\\home\\tester\\shop',{platform:'linux',wslDistro:'Ubuntu'}),/not available/);
  assert.throws(()=>resolveProjectFolderInput('C:work\\shop',{platform:'linux'}),/absolute/);
  assert.throws(()=>resolveProjectFolderInput('file://remote-server/share/shop',{platform:'linux'}),/Only folders/);
  assert.throws(()=>resolveProjectFolderInput('C:\\Work\\Shop',{platform:'darwin'}),/not available/);
});

test('inspection and connection accept a trusted project outside the home folder and a mounted Windows path',async()=>{
  const base=await mkdtemp(path.join(os.tmpdir(),'kg-v27-path-'));
  const home=path.join(base,'user-home'),root=path.join(home,'kaneguard'),mount=path.join(base,'mnt');
  const outside=path.join(base,'other-drive','frontend'),mounted=path.join(mount,'d','work','store');
  let connected;
  try {
    await mkdir(root,{recursive:true});await makeApp(outside);await makeApp(mounted);
    const inspected=await inspectLocalProject(outside,{home,repoRoot:root});
    assert.equal(inspected.path,outside);assert.equal(inspected.framework,'Vite');
    const windows=await inspectLocalProject('D:\\work\\store',{home,repoRoot:root,windowsMountRoot:mount});
    assert.equal(windows.path,mounted);
    connected=await connectExistingProject({folder:'"D:\\work\\store"'},{root,home,repoRoot:root,windowsMountRoot:mount});
    assert.equal(connected.projectDir,mounted);
    const saved=JSON.parse(await readFile(path.join(root,'configs',`${connected.id}.json`),'utf8'));
    assert.equal(saved.projectDir,mounted);
    await disconnectExistingProject(connected.id,{root});connected=null;
    assert.match(await readFile(path.join(mounted,'index.html'),'utf8'),/Not an empty folder/);
  } finally {
    if(connected)await disconnectExistingProject(connected.id,{root});
    await rm(base,{recursive:true,force:true});
  }
});

test('arbitrary folders remain protected: never attach KaneGuard ancestors, hidden secrets or dependency folders',async()=>{
  const base=await mkdtemp(path.join(os.tmpdir(),'kg-v27-safety-'));
  const home=path.join(base,'home'),root=path.join(home,'kaneguard');
  try {
    await mkdir(root,{recursive:true});await makeApp(path.join(base,'safe-ui'));
    await makeApp(path.join(base,'.ssh','hidden-ui'));
    await makeApp(path.join(base,'node_modules','hidden-ui'));
    await makeApp(path.join(root,'bad-ui'));
    await makeApp(home);
    await symlink(path.join(base,'.ssh','hidden-ui'),path.join(base,'secret-link'));
    for(const folder of [home,root,base,path.join(root,'bad-ui'),path.join(base,'.ssh','hidden-ui'),path.join(base,'node_modules','hidden-ui'),path.join(base,'secret-link')]) {
      await assert.rejects(inspectLocalProject(folder,{home,repoRoot:root}),/home, disk, or filesystem root|parent directories|Protected or dependency/);
    }
    await assert.rejects(inspectLocalProject('/',{home,repoRoot:root}),/home, disk, or filesystem root/);
    await assert.rejects(inspectLocalProject('Z:\\missing\\repo',{home,repoRoot:root}),/not accessible/);
  } finally {await rm(base,{recursive:true,force:true});}
});

test('stored display names shorten native home directories without altering filesystem paths',()=>{
  assert.equal(projectPathDisplay('/Users/alex/projects/shop','/Users/alex'),'~/projects/shop');
  assert.equal(projectPathDisplay('/home/tester/projects/shop','/home/tester'),'~/projects/shop');
  assert.equal(projectPathDisplay('/mnt/d/Users/alex/projects/shop','/home/tester'),'~/projects/shop');
  assert.equal(projectPathDisplay('C:\\Users\\Alex\\projects\\shop','/home/tester'),'~/projects/shop');
});

test('the connection form is platform-neutral and shows no path-format selector',async()=>{
  const html=await readFile(new URL('../public/control/index.html',import.meta.url),'utf8');
  const js=await readFile(new URL('../public/control/studio.mjs',import.meta.url),'utf8');
  assert.match(html,/<label for="connectFolder" class="composer-label">Existing app folder<\/label>/);
  assert.match(html,/id="connectFolder"[^>]+placeholder="Choose or paste a project folder"/);
  assert.match(html,/id="browseFolder"/); // v32.13 folder picker (pasting still works)
  assert.doesNotMatch(html,/Existing app folder in WSL|Choose operating system|Select your OS/);
  assert.doesNotMatch(js,/Missing in WSL|server WSL/);
  assert.match(js,/function friendlyProjectPath\(/);
});
