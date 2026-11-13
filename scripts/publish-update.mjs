import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { randomUUID } from 'node:crypto';
import contract from '../lib/release-contract.cjs';
const input=process.argv[2];
try{
 if(!input||process.argv.length!==3)throw Error('用法：DATA_DIR=私有数据目录 node scripts/publish-update.mjs desktop-release.json');
 const raw=await readFile(resolve(input),'utf8');if(Buffer.byteLength(raw)>64*1024)throw Error('更新信息过长。');const release=contract.validateRelease(JSON.parse(raw));
 const directory=resolve(process.env.DATA_DIR||'data');await mkdir(directory,{recursive:true,mode:0o700});const destination=join(directory,'desktop-release.json');
 let previous;try{previous=contract.validateRelease(JSON.parse(await readFile(destination,'utf8')));}catch(error){if(error.code!=='ENOENT')throw error;}
 if(previous&&contract.compareVersions(release.version,previous.version)<0)throw Error('不能发布比当前更旧的版本。');
 if(previous&&release.version===previous.version&&JSON.stringify(previous.assets)!==JSON.stringify(release.assets))throw Error('同一版本的安装包不能替换，请使用新版本号。');
 const temporary=join(directory,`desktop-release-${randomUUID()}.pending`);
 try{await writeFile(temporary,JSON.stringify(release,null,2)+'\n',{mode:0o600,flag:'wx'});await rename(temporary,destination);}catch(error){await unlink(temporary).catch(()=>{});throw error;}
 console.log(JSON.stringify({publishedVersion:release.version,notify:'已发布，在线桌宠会收到更新提示。'}));
}catch(error){console.error(error.message);process.exitCode=1;}
