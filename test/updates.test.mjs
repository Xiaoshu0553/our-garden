import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import contract from '../lib/release-contract.cjs';
import updates from '../desktop/updates.cjs';
import core from '../desktop/core.cjs';
import { createApp } from '../server.mjs';

const bytes = Buffer.from('a verified installer fixture\n'.repeat(1000));
function manifest(version = '0.4.0') {
  return {schemaVersion:1, version, publishedAt:'2026-11-13T00:00:00.000Z', notes:'修复共同目标与解绑。', assets:Object.fromEntries(Object.entries(contract.assetSuffixes).map(([key,suffix])=>[key,{url:`${contract.source}/releases/download/v${version}/Garden-Companion-${version}-${suffix}`,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}]))};
}
async function directory(t, cleanup = true) {
  const path = await mkdtemp(join(tmpdir(),'garden-update-'));
  if (cleanup) t.after(async()=>{const inside=relative(resolve(tmpdir()),resolve(path));assert.ok(inside&&!inside.startsWith('..')&&!isAbsolute(inside));await rm(path,{recursive:true,force:true});});
  return path;
}
function updater(dir, fetcher, extras={}) {
  return new updates.DesktopUpdater({version:'0.3.0',platform:'win32',arch:'x64',directory:dir,origin:'https://garden.example',fetch:fetcher,...extras});
}
function chunked(body = bytes, status = 200) {
  return new Response(new ReadableStream({start(controller){controller.enqueue(body.subarray(0,7));controller.enqueue(body.subarray(7,100));controller.enqueue(body.subarray(100));controller.close();}}),{status,headers:{'Content-Length':String(body.length)}});
}

test('更新清单区分平台、严格检查版本和官方安装包来源',()=>{
  assert.equal(contract.compareVersions('0.10.0','0.9.9'),1);
  assert.equal(contract.compareVersions('1.0.0','1.0.0'),0);
  assert.equal(contract.targetKey('win32','x64',true),'win32-x64-portable');
  assert.equal(contract.targetKey('darwin','arm64'),'darwin-arm64');
  assert.equal(contract.targetKey('linux','x64'),null);
  for(const value of ['v1.0.0','01.0.0','1.0','1.0.0;cmd','1.0.0-beta.1'])assert.throws(()=>contract.versionParts(value));
  assert.equal(contract.validateRelease(manifest()).version,'0.4.0');
  for(const edit of [m=>m.command='run',m=>delete m.assets['darwin-x64'],m=>m.assets['win32-x64'].url='https://evil.example/setup.exe',m=>m.assets['win32-x64'].sha256='x'.repeat(64),m=>m.assets['win32-x64'].size=600*1024*1024]){
    const m=manifest();edit(m);assert.throws(()=>contract.validateRelease(m));
  }
});

test('检查与服务器提醒均不下载；点击后分块下载、核验并打开对应包',async t=>{
  const dir=await directory(t),calls=[],opened=[];
  const client=updater(dir,async (url,options)=>{calls.push(url);if(url.endsWith('/api/desktop/release'))return Response.json({release:manifest()});assert.equal(options.headers.Range,'bytes=0-');return chunked(bytes,206);},{portable:true,openInstaller:async(file,key)=>opened.push({file,key})});
  assert.equal((await client.check()).status,'available');assert.equal(calls.length,1);assert.deepEqual(opened,[]);
  assert.equal((await client.download()).status,'ready');assert.deepEqual(await readFile(client.file),bytes);assert.deepEqual(opened,[]);
  assert.equal((await Promise.all([client.install(),client.install()]))[0].opened,true);assert.equal(opened.length,1);assert.equal(opened[0].key,'win32-x64-portable');assert.match(opened[0].file,/-win-x64-portable\.exe$/);
  assert.equal(calls.length,2);
});

test('拒绝错误校验、截断、过长数据和不可信重定向，不打开安装程序',async t=>{
  const dir=await directory(t);
  for(const [name,reply] of [
    ['hash',()=>chunked(Buffer.alloc(bytes.length,1))],
    ['short',()=>new Response(bytes.subarray(0,10))],
    ['long',()=>new Response(Buffer.concat([bytes,Buffer.from('extra')]))],
    ['redirect',()=>new Response(null,{status:302,headers:{location:'https://evil.example/setup.exe'}})],
  ]){
    let opened=0;
    const client=updater(join(dir,name),async url=>url.endsWith('/api/desktop/release')?Response.json({release:manifest()}):reply(),{openInstaller:async()=>opened++});
    await client.check();assert.equal((await client.install()).status,'error',name);assert.equal(opened,0,name);assert.equal(client.file,null);
  }
});

test('安装前重新校验本地文件，当前版本不更新，异常清单不会执行',async t=>{
  const dir=await directory(t);let opened=0;
  const client=updater(dir,async url=>url.endsWith('/api/desktop/release')?Response.json({release:manifest()}):chunked(),{openInstaller:async()=>opened++});
  await client.check();await client.download();await writeFile(client.file,Buffer.alloc(bytes.length));assert.equal((await client.install()).status,'error');assert.equal(opened,0);
  for(const release of [null,manifest('0.2.0'),manifest('0.3.0')])assert.equal((await updater(dir,async()=>Response.json({release})).check()).status,'current');
  for(const reply of [()=>Response.json({release:{command:'run'}}),()=>new Response('x'.repeat(66000)),()=>{throw Error('offline');}])assert.equal((await updater(dir,reply).check()).status,'error');
});

test('更新发布接口可匿名读取，发布新版本经 SSE 提醒，不含私人记录',async t=>{
  const dir=await directory(t,false),server=createApp({dataDir:dir,cookieSecure:false,releasePollMs:20});server.listen(0,'127.0.0.1');await once(server,'listening');
  const origin=`http://127.0.0.1:${server.address().port}`,client=new core.GardenClient({origin});
  const controller=new AbortController();let events;
  t.after(async()=>{controller.abort();const closed=once(server,'close');server.close();server.closeAllConnections();await events?.catch(()=>{});await closed;const inside=relative(resolve(tmpdir()),resolve(dir));assert.ok(inside&&!inside.startsWith('..')&&!isAbsolute(inside));await rm(dir,{recursive:true,force:true});});
  assert.deepEqual(await (await fetch(origin+'/api/desktop/release')).json(),{release:null});
  await client.request('/api/auth/register','POST',{name:'更新测试',password:'Update-fixture-2026!',passwordConfirmation:'Update-fixture-2026!'});
  let notified,ready;
  const notification=new Promise(resolve=>notified=resolve),connected=new Promise(resolve=>ready=resolve);
  events=client.events(controller.signal,event=>{if(event.type==='changed')ready();if(event.type==='release')notified(event);});
  await Promise.race([connected,new Promise((_,reject)=>setTimeout(()=>reject(Error('SSE not ready')),3000).unref())]);
  await writeFile(join(dir,'desktop-release.json'),JSON.stringify(manifest()));
  const event=await Promise.race([notification,new Promise((_,reject)=>setTimeout(()=>reject(Error('release event missing')),3000).unref())]);
  assert.deepEqual(event,{type:'release',version:'0.4.0'});
  const response=await fetch(origin+'/api/desktop/release');assert.equal(response.status,200);assert.deepEqual(await response.json(),{release:manifest()});
  await writeFile(join(dir,'desktop-release.json'),'{}');assert.equal((await fetch(origin+'/api/desktop/release')).status,503);
});

test('发布工具原子写入，并拒绝降级或同版本替换安装包',async t=>{
  const dir=await directory(t),input=join(dir,'incoming.json'),destination=join(dir,'published');
  const publish=()=>spawnSync(process.execPath,['scripts/publish-update.mjs',input],{cwd:resolve(import.meta.dirname,'..'),env:{...process.env,DATA_DIR:destination},encoding:'utf8'});
  await writeFile(input,JSON.stringify(manifest()));assert.equal(publish().status,0);assert.equal(JSON.parse(await readFile(join(destination,'desktop-release.json'),'utf8')).version,'0.4.0');
  await writeFile(input,JSON.stringify(manifest('0.3.0')));assert.equal(publish().status,1);
  const changed=manifest();changed.assets['win32-x64'].size++;await writeFile(input,JSON.stringify(changed));assert.equal(publish().status,1);
});
