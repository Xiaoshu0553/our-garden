import { createDemoStore, demoUsers } from './demo.mjs';

export async function createTransport(onChange) {
  const desktop = window.gardenDesktop;
  if (desktop) {
    desktop.onEvent(event => onChange(event));
    return {
      desktop: true,
      info: () => desktop.info(),
      update: action => desktop.update(action),
      request: (path, method = 'GET', body) => desktop.request(path, method, body),
      settings: value => desktop.settings(value),
      configure: value => desktop.configure(value),
      identity: id => desktop.identity(id),
      peer: () => desktop.openPeer(),
      hide: () => desktop.hidePanel(),
      garden: id => desktop.openGarden(id),
      main: id => desktop.openMain(id),
      resizeQuick: height => desktop.resizeQuick(height),
    };
  }
  const params = new URLSearchParams(location.search);
  const configKey = 'garden-companion-preview-settings';
  const storeKey = 'garden-companion-experience-v1';
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(configKey) || '{}'); } catch { /* defaults */ }
  let mode = params.get('demo') === '1' ? 'demo' : 'connected';
  let userId = params.get('person') === 'rain' ? demoUsers[1].id : (sessionStorage.getItem('companion-person') || demoUsers[0].id);
  let csrf = '';
  let initialData;
  try { initialData = JSON.parse(localStorage.getItem(storeKey) || 'null'); } catch { /* defaults */ }
  const demo = createDemoStore({ initialData, save: data => localStorage.setItem(storeKey, JSON.stringify(data)), changed: () => onChange({ type: 'changed' }) });
  window.addEventListener('storage', event => {
    if (event.key === storeKey && event.newValue) {
      try { demo.replace(JSON.parse(event.newValue)); onChange({ type: 'changed' }); } catch { /* invalid stored data */ }
    }
  });
  let events;
  function startEvents() {
    events?.close();
    if (mode !== 'connected') return;
    events = new EventSource('/api/companion/events');
    events.addEventListener('changed', () => onChange({ type: 'changed' }));
  }
  const transport = {
    desktop: false,
    async info() { return { ...saved, mode, serverUrl: location.origin, demoUserId: userId, shortcut: '', platform: 'browser' }; },
    async request(path, method = 'GET', body) {
      if (mode === 'demo') return demo.request(userId, path, method, body);
      let response;
      try {
        response = await fetch(path, { method, credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(15000), headers: { ...(method !== 'GET' ? { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
      } catch { const error = new Error('暂时连不上小花园，想法会留在本机等待重试。'); error.offline = true; throw error; }
      let data;
      try { data = await response.json(); } catch { throw new Error('小花园暂时没有正常回应。'); }
      if (!response.ok) { const error = new Error(response.status === 404 && path.startsWith('/api/companion/') ? '小花园服务还需要更新到支持桌宠的版本。' : data.error || '暂时没能完成，请稍后再试。'); error.status = response.status; throw error; }
      if (data.csrfToken) csrf = data.csrfToken;
      if (path === '/api/auth/logout') { csrf = ''; events?.close(); }
      if (['/api/auth/state', '/api/auth/login', '/api/auth/register', '/api/auth/me', '/api/garden/join', '/api/garden/unlink'].includes(path) && data.user) startEvents();
      return data;
    },
    async settings(value) { saved = { ...saved, ...value }; localStorage.setItem(configKey, JSON.stringify(saved)); return transport.info(); },
    async configure(value) {
      mode = value.mode === 'demo' ? 'demo' : 'connected';
      if (mode === 'connected' && value.serverUrl && new URL(value.serverUrl).origin !== location.origin) throw new Error('网页版请从你们的小花园地址打开；桌面版可以在这里连接其他地址。');
      startEvents(); return transport.info();
    },
    async identity(id) { userId = demoUsers.some(user => user.id === id) ? id : demoUsers[0].id; sessionStorage.setItem('companion-person', userId); return transport.info(); },
    async peer() { window.open(`?demo=1&person=${userId === demoUsers[0].id ? 'rain' : 'tree'}`, '_blank', 'noopener'); },
    hide() { document.getElementById('companion').hidden = true; document.body.classList.add('preview-collapsed'); },
    garden(id) { if (mode === 'demo') return; window.open(`/${id ? `?project=${encodeURIComponent(id)}` : ''}#ideas`, '_blank', 'noopener'); },
    main() { document.getElementById('companion').hidden = false; },
    resizeQuick() {},
  };
  return transport;
}
