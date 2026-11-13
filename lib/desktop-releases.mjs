import { readFileSync, statSync, watchFile, unwatchFile } from 'node:fs';
import contract from './release-contract.cjs';
import { HttpError } from './security.mjs';
export function createDesktopReleases({filename,changed,pollMs=5000}) {
  let last=null;
  function current(){
    try{if(statSync(filename).size>64*1024)throw Error('oversize');return contract.validateRelease(JSON.parse(readFileSync(filename,'utf8')));}
    catch(error){if(error.code==='ENOENT')return null;throw new HttpError(503,'更新信息暂时不可用，请稍后检查。');}
  }
  function inspect(){try{const value=current();if(value&&value.version!==last){last=value.version;changed(value.version);}}catch{/* Invalid files are never advertised or executed. */}}
  try{last=current()?.version||null;}catch{/* Startup remains usable if the release file is malformed. */}
  watchFile(filename,{interval:pollMs,persistent:false},inspect);
  return {current,close(){unwatchFile(filename,inspect);}};
}
