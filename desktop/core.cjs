const fs = require('node:fs');
const path = require('node:path');

function serverOrigin(value) {
  const url = new URL(String(value || '').trim());
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('请填写完整的 HTTPS 小花园地址；本机开发可用 http://127.0.0.1:端口。');
  }
  return url.origin;
}
function allowedRequest(apiPath, method) {
  if (!['GET', 'POST', 'PATCH'].includes(method) || typeof apiPath !== 'string' || apiPath.includes('?') || apiPath.includes('#')) return false;
  if (method === 'GET') return ['/api/auth/state', '/api/state', '/api/garden', '/api/companion/status', '/api/companion/inbox'].includes(apiPath) || /^\/api\/garden\/archives\/[a-zA-Z0-9-]{1,80}$/.test(apiPath);
  if (method === 'POST') return ['/api/auth/login', '/api/auth/register', '/api/auth/logout', '/api/garden/invite', '/api/garden/join', '/api/garden/unlink', '/api/companion/capture', '/api/companion/inbox/read', '/api/companion/inbox/delivered'].includes(apiPath) || /^\/api\/projects\/[a-zA-Z0-9-]+\/(consent|notes|tasks)$/.test(apiPath);
  return apiPath === '/api/auth/me' || /^\/api\/projects\/[a-zA-Z0-9-]+(?:\/tasks\/[a-zA-Z0-9-]+)?$/.test(apiPath);
}
function writeJSON(filename, value) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const temp = filename + '.pending';
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(temp, filename);
}
function readJSON(filename, fallback) { try { return JSON.parse(fs.readFileSync(filename, 'utf8')); } catch { return fallback; } }
function settingsPatch(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('设置格式不正确。');
  const result = {};
  for (const key of Object.keys(value)) {
    if (['doNotDisturb', 'notifications', 'openAtLogin'].includes(key)) {
      if (typeof value[key] !== 'boolean') throw new Error('设置格式不正确。');
      result[key] = value[key];
    } else if (key === 'pet') {
      if (!['dog', 'cat', 'custom'].includes(value[key])) throw new Error('请选择一个小伙伴。');
      result[key] = value[key];
    } else if (key === 'customImage') {
      if (typeof value[key] !== 'string' || value[key].length > 3 * 1024 * 1024 || !/^data:image\/(png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/.test(value[key])) throw new Error('请选择有效的宠物图片。');
      result[key] = value[key];
    } else throw new Error('不支持这项设置。');
  }
  return result;
}

class GardenClient {
  constructor({ origin, loadSession = () => '', saveSession = () => {} }) {
    this.origin = serverOrigin(origin); this.cookie = loadSession() || ''; this.csrf = ''; this.saveSession = saveSession;
  }
  async request(apiPath, method = 'GET', body) {
    if (!allowedRequest(apiPath, method)) throw new Error('不支持这个小花园操作。');
    let response;
    try {
      response = await fetch(this.origin + apiPath, { method, redirect: 'error', signal: AbortSignal.timeout(apiPath.endsWith('/chat') ? 35000 : 15000),
        headers: { Accept: 'application/json', Origin: this.origin, ...(this.cookie ? { Cookie: this.cookie } : {}), ...(method !== 'GET' ? { 'Content-Type': 'application/json', 'X-CSRF-Token': this.csrf } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch { const error = new Error('暂时连不上小花园，想法会留在本机等待重试。'); error.offline = true; throw error; }
    const cookies = response.headers.getSetCookie();
    for (const line of cookies) if (line.startsWith('garden_session=')) {
      this.cookie = /Max-Age=0(?:;|$)/i.test(line) ? '' : line.split(';')[0]; this.saveSession(this.cookie);
    }
    const reader = response.body.getReader(); const chunks = []; let length = 0;
    try {
      while (true) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > 16 * 1024 * 1024) throw new Error('共同记录太多了，请先在网页里整理一下。'); chunks.push(value); }
    } finally { await reader.cancel().catch(() => {}); }
    let data;
    try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error('小花园暂时没有正常回应。'); }
    if (!response.ok) {
      const error = new Error(response.status === 404 && apiPath.startsWith('/api/companion/') ? '小花园服务还需要更新到支持桌宠的版本。你可以先使用体验空间。' : data.error || '暂时没能完成这个操作。'); error.status = response.status; throw error;
    }
    if (data.csrfToken) this.csrf = data.csrfToken;
    if (apiPath === '/api/auth/logout' || (apiPath === '/api/auth/state' && !data.user)) { this.cookie = ''; this.csrf = ''; this.saveSession(''); }
    // Session credentials are owned by the main process, never the renderer.
    const { csrfToken, ...safe } = data;
    return safe;
  }
  async events(signal, changed) {
    if (!this.cookie) return;
    const response = await fetch(this.origin + '/api/companion/events', { redirect: 'error', signal, headers: { Cookie: this.cookie, Origin: this.origin, Accept: 'text/event-stream' } });
    if (!response.ok || !response.headers.get('content-type')?.startsWith('text/event-stream')) { await response.body?.cancel(); throw new Error('EVENTS_UNAVAILABLE'); }
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
    try {
      while (!signal.aborted) {
        const { value, done } = await reader.read(); if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let at;
        while ((at = buffer.indexOf('\n\n')) >= 0) {
          const event = buffer.slice(0, at); buffer = buffer.slice(at + 2);
          if (/event: (changed|ready)/.test(event)) changed({type:'changed'});
          else if (/^event: release$/m.test(event)) {
            try { const data=JSON.parse(event.split('\n').find(line=>line.startsWith('data: '))?.slice(6)||'null'); if(typeof data?.version==='string')changed({type:'release',version:data.version}); } catch { /* malformed hint ignored */ }
          }
        }
        if (buffer.length > 65536) throw new Error('INVALID_EVENT');
      }
    } finally { await reader.cancel().catch(() => {}); }
  }
}
module.exports = { serverOrigin, allowedRequest, writeJSON, readJSON, settingsPatch, GardenClient };
