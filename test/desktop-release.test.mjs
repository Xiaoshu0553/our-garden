import assert from 'node:assert/strict';
import test from 'node:test';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import contract from '../lib/release-contract.cjs';

async function fixture(t, version) {
  const directory=await mkdtemp(join(tmpdir(),'garden-desktop-release-'));
  t.after(async()=>{const inside=relative(resolve(tmpdir()),resolve(directory));assert.ok(inside&&!inside.startsWith('..')&&!isAbsolute(inside));await rm(directory,{recursive:true,force:true});});
  for(const name of ['scripts','lib','desktop','docs/releases','artifacts'])await mkdir(join(directory,name),{recursive:true});
  await copyFile(new URL('../scripts/desktop-release.mjs',import.meta.url),join(directory,'scripts/desktop-release.mjs'));
  await copyFile(new URL('../lib/release-contract.cjs',import.meta.url),join(directory,'lib/release-contract.cjs'));
  await writeFile(join(directory,'desktop/package.json'),JSON.stringify({version}));
  return {directory,notes:join(directory,`docs/releases/${version}.md`),output:join(directory,'artifacts'),run(){return spawnSync(process.execPath,['scripts/desktop-release.mjs','artifacts'],{cwd:directory,encoding:'utf8'});}};
}

test('安装包更新清单使用当前版本的发布说明，并把格式转换为可直接显示的文本',async t=>{
  const version='9.8.7',f=await fixture(t,version);
  const markdown=`# ${version} 更新说明\n\n修复**隐藏宠物**后无法找回的问题。\n\n- 新增 \`使用教程\`。\n- 查看 [发布页](https://example.test/releases)。\n`;
  await writeFile(f.notes,markdown);
  for(const suffix of Object.values(contract.assetSuffixes))await writeFile(join(f.output,`Garden-Companion-${version}-${suffix}`),Buffer.alloc(1024*1024,1));
  for(const [platform,arch]of[['win32','x64'],['darwin','arm64'],['darwin','x64']])await writeFile(join(f.output,`native-${platform}-${arch}.json`),JSON.stringify({desktopSmoke:'passed',version,platform,arch}));
  const source=Buffer.from('source package fixture');await writeFile(join(f.output,`Garden-Companion-${version}-source.tar.gz`),source);
  const result=f.run();assert.equal(result.status,0,result.stderr);
  const release=JSON.parse(await readFile(join(f.output,'desktop-release.json'),'utf8'));
  assert.equal(release.version,version);
  assert.equal(release.notes,`${version} 更新说明\n\n修复隐藏宠物后无法找回的问题。\n\n- 新增 使用教程。\n- 查看 发布页 (https://example.test/releases)。`);
  assert.ok(!release.notes.includes('删除 AI 聊天'),'不得复用旧版硬编码说明');
  assert.equal(Object.keys(contract.validateRelease(release).assets).length,4);
  const sums=await readFile(join(f.output,'SHA256SUMS.txt'),'utf8');
  assert.ok(sums.includes(createHash('sha256').update(source).digest('hex')+`  Garden-Companion-${version}-source.tar.gz`));
});

test('缺少当前版本的发布说明时明确失败，不回退到其他版本也不生成清单',async t=>{
  const f=await fixture(t,'9.8.8');
  await writeFile(join(f.directory,'docs/releases/9.8.7.md'),'旧版说明不能用于新版本。');
  const result=f.run();assert.notEqual(result.status,0);
  assert.match(result.stderr,/Missing release notes for 9\.8\.8: docs\/releases\/9\.8\.8\.md/);
  await assert.rejects(readFile(join(f.output,'desktop-release.json')),error=>error.code==='ENOENT');
});

test('空说明和超过更新协议上限的说明在处理安装包前被拒绝',async t=>{
  const f=await fixture(t,'9.8.9');
  for(const [content,message]of[[' \n\t\n',/Release notes are empty for 9\.8\.9/],['新'.repeat(4001),/Release notes exceed 4000 characters for 9\.8\.9/]]){
    await writeFile(f.notes,content);const result=f.run();assert.notEqual(result.status,0);assert.match(result.stderr,message);
    await assert.rejects(readFile(join(f.output,'desktop-release.json')),error=>error.code==='ENOENT');
  }
});
