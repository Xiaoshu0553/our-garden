import { readFile, writeFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import contract from '../lib/release-contract.cjs';
const directory=resolve(process.argv[2] || '.local/desktop-release');
const {version}=JSON.parse(await readFile(new URL('../desktop/package.json',import.meta.url),'utf8'));
contract.versionParts(version);
const notesFilename=`docs/releases/${version}.md`;
let markdown;
try{markdown=await readFile(new URL(`../${notesFilename}`,import.meta.url),'utf8');}
catch(error){if(error.code==='ENOENT')throw new Error(`Missing release notes for ${version}: ${notesFilename}`);throw error;}
// The updater displays escaped text rather than Markdown. Keep paragraphs and
// bullet lists readable, without carrying formatting syntax into the notice.
const notes=markdown.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n')
  .replace(/^\s{0,3}#{1,6}\s+/gm,'').replace(/^\s*```[^\n]*$/gm,'')
  .replace(/!\[([^\]]*)\]\([^\n)]+\)/g,'$1')
  .replace(/\[([^\]]+)\]\(([^\n)]+)\)/g,'$1 ($2)')
  .replace(/\*\*([^*\n]+)\*\*/g,'$1').replace(/__([^_\n]+)__/g,'$1')
  .replace(/`([^`\n]+)`/g,'$1').trim();
if(!notes)throw new Error(`Release notes are empty for ${version}: ${notesFilename}`);
if(notes.length>4000)throw new Error(`Release notes exceed 4000 characters for ${version}; shorten ${notesFilename}`);
const names=Object.entries(contract.assetSuffixes).map(([key,suffix])=>[key,`Garden-Companion-${version}-${suffix}`]);
const hash=async filename=>{const value=createHash('sha256');for await(const chunk of createReadStream(filename))value.update(chunk);return value.digest('hex');};
const assets={},sums=[];
for(const [key,name] of names){const filename=join(directory,name),info=await stat(filename);if(info.size<1024*1024)throw Error(`Installer too small: ${name}`);const digest=await hash(filename);assets[key]={url:`${contract.source}/releases/download/v${version}/${name}`,sha256:digest,size:info.size};sums.push(`${digest}  ${name}`);}
const nativeChecks=[];
for(const [platform,arch] of [['win32','x64'],['darwin','arm64'],['darwin','x64']]){const check=JSON.parse(await readFile(join(directory,`native-${platform}-${arch}.json`),'utf8'));if(check.desktopSmoke!=='passed'||check.version!==version||check.platform!==platform||check.arch!==arch)throw Error('Native check is missing or mismatched');nativeChecks.push(check);}
const source=`Garden-Companion-${version}-source.tar.gz`;sums.push(`${await hash(join(directory,source))}  ${source}`);
const release=contract.validateRelease({schemaVersion:1,version,publishedAt:new Date().toISOString(),notes,assets});
await writeFile(join(directory,'desktop-release.json'),JSON.stringify(release,null,2)+'\n');
await writeFile(join(directory,'SHA256SUMS.txt'),sums.join('\n')+'\n');
await writeFile(join(directory,`verification-${version}.json`),JSON.stringify({version,sourceCommit:process.env.GITHUB_SHA||null,nativeChecks,installerAssets:names.map(([,name])=>name),macSigning:'ad-hoc; no Developer ID or notarization'},null,2)+'\n');
console.log(JSON.stringify({version,assets:names.map(([,name])=>name),nativeChecks:nativeChecks.length}));
