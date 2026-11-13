const source = 'https://github.com/Xiaoshu0553/our-garden';
const assetSuffixes = { 'win32-x64': 'win-x64-setup.exe', 'win32-x64-portable': 'win-x64-portable.exe', 'darwin-arm64': 'mac-arm64.dmg', 'darwin-x64': 'mac-x64.dmg' };
function versionParts(value) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/.test(value)) throw new Error('版本号无效。');
  return value.split('.').map(Number);
}
function compareVersions(a,b) { const x=versionParts(a),y=versionParts(b);for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]>y[i]?1:-1;return 0; }
function keys(value, allowed) { if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!allowed.includes(k)))throw new Error('更新信息格式不正确。'); }
function validateRelease(value) {
  keys(value,['schemaVersion','version','publishedAt','notes','assets']);
  if(value.schemaVersion!==1)throw new Error('更新信息版本不受支持。');versionParts(value.version);
  if(typeof value.publishedAt!=='string'||!Number.isFinite(Date.parse(value.publishedAt)))throw new Error('更新时间无效。');
  if(typeof value.notes!=='string'||value.notes.length>4000)throw new Error('更新说明无效。');
  keys(value.assets,Object.keys(assetSuffixes));const assets={};
  for(const [key,suffix] of Object.entries(assetSuffixes)){
    const item=value.assets[key];keys(item,['url','sha256','size']);
    const expected=`${source}/releases/download/v${value.version}/Garden-Companion-${value.version}-${suffix}`;
    if(item.url!==expected)throw new Error('更新包来源不受信任。');
    if(typeof item.sha256!=='string'||!/^[0-9a-f]{64}$/i.test(item.sha256))throw new Error('更新包校验信息无效。');
    if(!Number.isSafeInteger(item.size)||item.size<1||item.size>512*1024*1024)throw new Error('更新包大小无效。');
    assets[key]={url:item.url,sha256:item.sha256.toLowerCase(),size:item.size};
  }
  return {schemaVersion:1,version:value.version,publishedAt:new Date(value.publishedAt).toISOString(),notes:value.notes,assets};
}
function targetKey(platform,arch,portable=false) { return platform==='win32'&&arch==='x64'?(portable?'win32-x64-portable':'win32-x64'):(platform==='darwin'&&['arm64','x64'].includes(arch)?`darwin-${arch}`:null); }
module.exports={source,assetSuffixes,versionParts,compareVersions,validateRelease,targetKey};
