const fs=require('node:fs');
const fsp=require('node:fs/promises');
const path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');
let contract;try{contract=require('./release-contract.cjs');}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;contract=require('../lib/release-contract.cjs');}
const redirectHosts=new Set(['github.com','release-assets.githubusercontent.com','objects.githubusercontent.com','github-releases.githubusercontent.com']);
async function checksum(filename){const h=createHash('sha256');for await(const part of fs.createReadStream(filename))h.update(part);return h.digest('hex');}
async function jsonBody(response){let size=0;const parts=[];for await(const chunk of response.body){size+=chunk.length;if(size>64*1024)throw Error('oversize');parts.push(chunk);}return JSON.parse(Buffer.concat(parts).toString('utf8'));}
class DesktopUpdater{
 constructor({version,platform,arch,portable=false,directory,origin,fetch:fetcher=globalThis.fetch,onChange=()=>{},openInstaller=async()=>{}}){
  contract.versionParts(version);this.key=contract.targetKey(platform,arch,portable);this.directory=path.resolve(directory);this.origin=origin;this.fetch=fetcher;this.onChange=onChange;this.openFile=openInstaller;this.release=null;this.file=null;this.checking=null;this.downloading=null;this.installing=null;this.controller=null;this.closed=false;
  this.state={status:this.key?'idle':'unsupported',currentVersion:version,availableVersion:null,notes:'',percent:0,lastChecked:null,error:''};
 }
 snapshot(){return {...this.state};}
 change(patch){if(this.closed)return this.snapshot();Object.assign(this.state,patch);this.onChange(this.snapshot());return this.snapshot();}
 async check(){
  if(this.closed||!this.key||this.downloading)return this.snapshot();if(this.checking)return this.checking;
  this.checking=(async()=>{
   this.change({status:'checking',error:''});
   try{
    const origin=typeof this.origin==='function'?this.origin():this.origin;const url=new URL('/api/desktop/release',origin);
    if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)))throw Error('origin');
    const response=await this.fetch(url.href,{redirect:'error',headers:{Accept:'application/json'},signal:AbortSignal.timeout(15000)});if(!response.ok){await response.body?.cancel();throw Error('service');}
    const data=await jsonBody(response);const release=data.release===null?null:contract.validateRelease(data.release);
    if(!release||contract.compareVersions(release.version,this.state.currentVersion)<=0){this.release=null;this.file=null;return this.change({status:'current',availableVersion:null,notes:'',percent:0,lastChecked:new Date().toISOString()});}
    this.release=release;this.file=null;return this.change({status:'available',availableVersion:release.version,notes:release.notes,percent:0,lastChecked:new Date().toISOString()});
   }catch{return this.change({status:'error',error:'暂时无法检查更新，请稍后重试。',lastChecked:new Date().toISOString()});}
  })();try{return await this.checking;}finally{this.checking=null;}
 }
 async assetResponse(url,signal){
  for(let i=0;i<6;i++){
   const parsed=new URL(url);if(parsed.protocol!=='https:'||parsed.username||parsed.password||!redirectHosts.has(parsed.hostname)||parsed.port)throw Error('redirect');
   const response=await this.fetch(parsed.href,{redirect:'manual',signal});
   if([301,302,303,307,308].includes(response.status)){const location=response.headers.get('location');await response.body?.cancel();if(!location)throw Error('redirect');url=new URL(location,parsed).href;continue;}
   if(!response.ok||!response.body){await response.body?.cancel();throw Error('download');}return response;
  }throw Error('redirect');
 }
 async download(){
  if(this.closed)return this.snapshot();if(this.downloading)return this.downloading;if(this.checking)await this.checking;
  if(!this.release||!this.key)return this.change({status:'error',error:'请先检查是否有新版本。'});
  const release=this.release,asset=release.assets[this.key];
  this.downloading=(async()=>{
   const filename=path.join(this.directory,path.basename(new URL(asset.url).pathname));const temporary=path.join(this.directory,`download-${randomUUID()}.pending`);
   this.change({status:'downloading',percent:0,error:''});this.controller=new AbortController();
   try{
    await fsp.mkdir(this.directory,{recursive:true,mode:0o700});
    try{const info=await fsp.stat(filename);if(info.size===asset.size&&await checksum(filename)===asset.sha256){this.file=filename;return this.change({status:'ready',percent:100});}}catch{/* A missing previous download is normal. */}
    const response=await this.assetResponse(asset.url,AbortSignal.any([this.controller.signal,AbortSignal.timeout(15*60*1000)]));
    const declared=response.headers.get('content-length');if(declared!==null&&Number(declared)!==asset.size){await response.body.cancel();throw Error('size');}
    const file=await fsp.open(temporary,'wx',0o600);const hash=createHash('sha256');let total=0,lastPercent=-1;
    try{for await(const chunk of response.body){total+=chunk.length;if(total>asset.size)throw Error('size');hash.update(chunk);await file.writeFile(chunk);const percent=Math.floor(total*100/asset.size);if(percent!==lastPercent){lastPercent=percent;this.change({percent});}}}finally{await file.close();}
    if(total!==asset.size||hash.digest('hex')!==asset.sha256)throw Error('checksum');
    await fsp.rename(temporary,filename);this.file=filename;return this.change({status:'ready',percent:100,error:''});
   }catch{await fsp.unlink(temporary).catch(()=>{});this.file=null;return this.change({status:'error',percent:0,error:'更新包下载或校验失败，已停止安装。可以重新检查后重试。'});}
   finally{this.controller=null;}
  })();try{return await this.downloading;}finally{this.downloading=null;}
 }
 async install(){
  if(this.closed)return this.snapshot();if(this.installing)return this.installing;
  this.installing=(async()=>{
   if(this.state.status!=='ready')await this.download();if(this.closed||this.state.status!=='ready'||!this.file||!this.release)return this.snapshot();
   try{const asset=this.release.assets[this.key];if((await fsp.stat(this.file)).size!==asset.size||await checksum(this.file)!==asset.sha256)throw Error('tampered');if(this.closed)return this.snapshot();await this.openFile(this.file,this.key);return {...this.snapshot(),opened:true};}
   catch{return this.change({status:'error',error:'安装包未能打开或已发生变化，请重新检查更新。'});}
  })();try{return await this.installing;}finally{this.installing=null;}
 }
 close(){this.closed=true;this.controller?.abort();}
}
module.exports={DesktopUpdater,checksum};
