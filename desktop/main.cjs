const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen, globalShortcut, Notification, safeStorage, shell, powerMonitor } = require('electron');
const { join, resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs');
const { serverOrigin, allowedRequest, writeJSON, readJSON, settingsPatch, GardenClient } = require('./core.cjs');

if (process.env.GARDEN_COMPANION_PROFILE) app.setPath('userData', resolve(process.env.GARDEN_COMPANION_PROFILE));
app.setName('小花园桌宠');
if (process.platform === 'win32') app.setAppUserModelId('com.ourlittlegarden.companion');
if (process.env.GARDEN_COMPANION_TEST === '1') {
  // Automated QA must fail on a main-process exception, rather than opening an
  // OS modal that blocks the run and interrupts the user's desktop.
  process.on('uncaughtException', error => { console.error('DESKTOP_QA_MAIN_ERROR', error.stack); app.exit(1); });
  process.on('unhandledRejection', error => { console.error('DESKTOP_QA_MAIN_REJECTION', error?.stack || error); app.exit(1); });
}
const hasLock = process.env.GARDEN_COMPANION_TEST === '1' || app.requestSingleInstanceLock();
if (!hasLock) app.quit();
let petWindow, primaryWindow, quickWindow, tray, demo, client;
let quitting = false;
let unreadCount = 0;
let settings;
let dataPath, assets;
let eventsController;
let eventsTimer;
let backgroundBusy = false;
let backgroundAgain = false;
let authenticated = false;
const panelUsers = new Map();
const windowModes = new Map();
const pendingNotices = new Set();
const shortcut = 'CommandOrControl+Shift+Space';
const defaults = { mode: 'connected', settingsVersion: 2, serverUrl: 'https://cyberhome.wuhuxiaoshu.com', pet: 'dog', doNotDisturb: false, notifications: true, openAtLogin: false, demoUserId: 'demo-tree' };
const info = sender => ({ ...settings, windowId: sender?.id, windowMode: windowModes.get(sender?.id) || 'main', demoUserId: panelUsers.get(sender?.id) || settings.demoUserId, platform: process.platform, shortcut: process.platform === 'darwin' ? '⌘ ⇧ Space' : 'Ctrl Shift Space' });
function saveSettings() { writeJSON(join(dataPath, 'settings.json'), settings); }
function broadcast(type, data) {
  for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send('garden:event', { type, data });
}
function petState() { return { pet: settings.pet, customImage: settings.customImage, unreadCount }; }
function updatePet() { if (petWindow && !petWindow.isDestroyed()) petWindow.webContents.send('garden:event', { type: 'pet-state', data: petState() }); }
async function restoreSession() {
  if (settings.mode !== 'connected' || authenticated || !client.cookie) return;
  try { const auth = await client.request('/api/auth/state'); authenticated = Boolean(auth.user); if (authenticated) startEvents(); } catch { /* Keep the remembered session for the next reconnect. */ }
}
function configureClient() {
  eventsController?.abort(); clearTimeout(eventsTimer); authenticated = false;
  const filename = join(dataPath, 'session.encrypted.json');
  client = new GardenClient({ origin: settings.serverUrl,
    loadSession() {
      const saved = readJSON(filename, null);
      if (!safeStorage.isEncryptionAvailable() || saved?.origin !== settings.serverUrl) return '';
      try { return safeStorage.decryptString(Buffer.from(saved.value, 'base64')); } catch { return ''; }
    },
    saveSession(value) {
      if (!value) { try { fs.unlinkSync(filename); } catch { /* already absent */ } return; }
      if (safeStorage.isEncryptionAvailable()) writeJSON(filename, { origin: settings.serverUrl, value: safeStorage.encryptString(value).toString('base64') });
    },
  });
}
function startEvents() {
  eventsController?.abort(); clearTimeout(eventsTimer);
  if (!authenticated || settings.mode !== 'connected' || quitting) return;
  const controller = new AbortController(); eventsController = controller;
  client.events(controller.signal, () => { broadcast('changed'); refreshBackground(); }).catch(() => {}).finally(() => {
    if (!controller.signal.aborted && !quitting && authenticated) eventsTimer = setTimeout(startEvents, 5000);
  });
}
async function requestFor(sender, path, method = 'GET', body) {
  if (!allowedRequest(path, method)) throw new Error('不支持这个小花园操作。');
  const result = settings.mode === 'demo' ? await demo.request(panelUsers.get(sender.id) || settings.demoUserId, path, method, body) : await client.request(path, method, body);
  if (settings.mode === 'connected' && ['/api/auth/state', '/api/auth/login', '/api/auth/register', '/api/auth/me', '/api/garden/join'].includes(path)) {
    authenticated = Boolean(result.user); if (authenticated) { startEvents(); refreshBackground(); }
  }
  if (path === '/api/auth/logout') { authenticated = false; eventsController?.abort(); clearTimeout(eventsTimer); unreadCount = 0; updatePet(); }
  if (['/api/auth/login', '/api/auth/register', '/api/auth/logout', '/api/auth/me', '/api/garden/join'].includes(path)) broadcast('connection-changed', { sourceId: sender.id });
  if (method !== 'GET' && !['/api/companion/inbox/delivered', '/api/companion/chat'].includes(path)) { broadcast('changed'); setImmediate(refreshBackground); }
  return result;
}
async function refreshBackground() {
  if (backgroundBusy) { backgroundAgain = true; return; }
  if (quitting || (settings.mode !== 'demo' && !authenticated)) return;
  backgroundBusy = true;
  try {
    const local = settings.mode === 'demo';
    const provider = local ? (path, method, body) => demo.request(settings.demoUserId, path, method, body) : (path, method, body) => client.request(path, method, body);
    const inbox = await provider('/api/companion/inbox');
    unreadCount = inbox.unreadCount; updatePet();
    if (tray) tray.setToolTip(`小花园桌宠${unreadCount ? ` · ${unreadCount} 条未读` : ' · 随手记个小念头'}`);
    const fresh = inbox.items.filter(item => !item.deliveredAt && !pendingNotices.has(`${settings.mode}:${item.id}`));
    if (fresh.length) {
      for (const item of fresh) pendingNotices.add(`${settings.mode}:${item.id}`);
      if (!settings.doNotDisturb && settings.notifications && Notification.isSupported()) {
        const notification = new Notification({ title: '小花园 · 对方留了新念头', body: fresh.length > 1 ? `有 ${fresh.length} 条新记录，等你有空时看看。` : '小伙伴替你收好了，等你有空时看看。', silent: true });
        notification.on('click', () => showPanel(fresh[0].projectId)); notification.show();
      }
      try { await provider('/api/companion/inbox/delivered', 'POST', { ids: fresh.map(item => item.id) }); }
      catch { for (const item of fresh) pendingNotices.delete(`${settings.mode}:${item.id}`); }
    }
  } catch { /* Realtime reconnect and the polling fallback will recover. */ }
  finally { backgroundBusy = false; if (backgroundAgain) { backgroundAgain = false; setImmediate(refreshBackground); } }
}
function secureWindow(window, filename) {
  const allowed = pathToFileURL(join(assets, filename)).href;
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (url.split('?')[0].split('#')[0] !== allowed) event.preventDefault(); });
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  window.loadFile(join(assets, filename));
}
function webPreferences() { return { preload: join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, spellcheck: false }; }
function panelPosition(extra = false) {
  const area = screen.getDisplayNearestPoint(petWindow?.getBounds() || screen.getCursorScreenPoint()).workArea;
  const width = Math.min(460, area.width - 24), height = Math.min(744, area.height - 32);
  return { width, height, x: Math.max(area.x + 12, area.x + area.width - width - (extra ? width + 38 : 32)), y: area.y + Math.max(16, area.height - height - 25) };
}
function createPanel(userId, extra = false) {
  const window = new BrowserWindow({ ...panelPosition(extra), frame: false, transparent: true, resizable: true, minWidth: 320, minHeight: 440, show: false, alwaysOnTop: true, skipTaskbar: true, title: '小花园 · 两个人的灵感小伙伴', backgroundColor: '#00000000', webPreferences: webPreferences() });
  const windowId = window.webContents.id;
  panelUsers.set(windowId, userId);
  windowModes.set(windowId, 'main');
  secureWindow(window, 'index.html');
  window.once('ready-to-show', () => window.show());
  window.on('close', event => { if (!quitting && !extra) { event.preventDefault(); window.hide(); } });
  window.on('closed', () => { panelUsers.delete(windowId); windowModes.delete(windowId); });
  return window;
}
function showPanel(projectId, composer = false) {
  if (quickWindow && !quickWindow.isDestroyed()) quickWindow.hide();
  if (!primaryWindow || primaryWindow.isDestroyed()) primaryWindow = createPanel(settings.demoUserId);
  primaryWindow.show(); primaryWindow.focus();
  const send = () => { if (projectId) primaryWindow.webContents.send('garden:event', { type: 'open-project', data: { id: projectId } }); else if (composer) primaryWindow.webContents.send('garden:event', { type: 'focus-composer' }); };
  if (primaryWindow.webContents.isLoading()) primaryWindow.webContents.once('did-finish-load', send); else send();
}
function quickBounds(height = 236) {
  const pet = petWindow.getBounds();
  const area = screen.getDisplayNearestPoint({ x: pet.x + pet.width / 2, y: pet.y + pet.height / 2 }).workArea;
  const width = Math.min(430, area.width - 24);
  height = Math.min(height, area.height - 24);
  const x = Math.max(area.x + 12, Math.min(area.x + area.width - width - 12, pet.x + pet.width - width));
  const above = pet.y - height + 20;
  const y = above >= area.y + 12 ? above : Math.min(area.y + area.height - height - 12, pet.y + pet.height - 12);
  return { x: Math.round(x), y: Math.round(Math.max(area.y + 12, y)), width, height };
}
function showQuick() {
  if (!quickWindow || quickWindow.isDestroyed()) {
    quickWindow = new BrowserWindow({ ...quickBounds(), frame: false, transparent: true, resizable: false, show: false, alwaysOnTop: true, skipTaskbar: true, title: '小花园 · 快捷记录', backgroundColor: '#00000000', webPreferences: webPreferences() });
    const windowId = quickWindow.webContents.id;
    panelUsers.set(windowId, settings.demoUserId); windowModes.set(windowId, 'quick');
    const current = quickWindow;
    current.on('blur', () => { if (!current.isDestroyed()) current.hide(); });
    current.on('close', event => { if (!quitting) { event.preventDefault(); current.hide(); } });
    current.on('closed', () => { panelUsers.delete(windowId); windowModes.delete(windowId); });
    secureWindow(current, 'index.html');
    current.once('ready-to-show', () => { current.show(); current.focus(); current.webContents.send('garden:event', { type: 'focus-composer' }); });
  } else {
    quickWindow.setBounds(quickBounds(quickWindow.getBounds().height));
    quickWindow.show(); quickWindow.focus(); quickWindow.webContents.send('garden:event', { type: 'focus-composer' });
  }
}
function togglePanel() { if (quickWindow && !quickWindow.isDestroyed() && quickWindow.isVisible()) quickWindow.hide(); else showQuick(); }
function menuTemplate() { return [
  { label: '记一个小念头', click: () => showQuick() },
  { label: '打开主界面', click: () => showPanel() },
  { label: '显示小伙伴', type: 'checkbox', checked: petWindow?.isVisible(), click: item => item.checked ? petWindow.showInactive() : petWindow.hide() },
  { label: '免打扰', type: 'checkbox', checked: settings.doNotDisturb, click: item => { settings.doNotDisturb = item.checked; saveSettings(); broadcast('settings-changed'); } },
  { type: 'separator' },
  { label: '退出小花园桌宠', click: () => { quitting = true; app.quit(); } },
]; }
function installIPC() {
  function handle(channel, action) {
    ipcMain.handle(channel, async (event, ...args) => {
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!window || (!panelUsers.has(event.sender.id) && window !== petWindow)) return { ok: false, message: '无效的窗口。' };
      try { return { ok: true, data: await action(event.sender, ...args) }; }
      catch (error) { return { ok: false, message: error.message || '暂时没能完成。', status: error.status, offline: error.offline }; }
    });
  }
  handle('garden:info', sender => info(sender));
  handle('garden:request', requestFor);
  handle('garden:settings', (_sender, value) => {
    const patch = settingsPatch(value);
    if (patch.openAtLogin !== undefined && process.env.GARDEN_COMPANION_TEST !== '1') {
      // A portable build extracts its executable to a temporary directory. The
      // login item must launch the durable portable file, rather than that copy.
      app.setLoginItemSettings({ openAtLogin: patch.openAtLogin, ...(process.platform === 'win32' ? { path: process.env.PORTABLE_EXECUTABLE_FILE || process.execPath } : {}) });
    }
    settings = { ...settings, ...patch }; saveSettings(); updatePet(); broadcast('settings-changed'); return info(_sender);
  });
  handle('garden:configure', (sender, value) => {
    if (!value || !['demo', 'connected'].includes(value.mode)) throw new Error('请选择连接方式。');
    if (value.mode === 'connected') settings.serverUrl = serverOrigin(value.serverUrl);
    settings.mode = value.mode; unreadCount = 0; pendingNotices.clear(); saveSettings(); configureClient(); updatePet();
    for (const window of BrowserWindow.getAllWindows()) if (window !== primaryWindow && window !== petWindow && window !== quickWindow) window.destroy();
    if (settings.mode === 'demo') refreshBackground();
    broadcast('connection-changed', { sourceId: sender.id });
    return info(sender);
  });
  handle('garden:identity', (sender, id) => {
    if (settings.mode !== 'demo' || !['demo-tree', 'demo-rain'].includes(id)) throw new Error('只能在体验空间切换人物。');
    panelUsers.set(sender.id, id); if (sender.id === primaryWindow?.webContents.id) { settings.demoUserId = id; if (quickWindow && !quickWindow.isDestroyed()) panelUsers.set(quickWindow.webContents.id, id); saveSettings(); refreshBackground(); broadcast('connection-changed', { sourceId: sender.id }); }
    return info(sender);
  });
  handle('garden:peer', sender => {
    if (settings.mode !== 'demo') throw new Error('正式空间请让对方在自己的电脑登录。');
    createPanel((panelUsers.get(sender.id) || settings.demoUserId) === 'demo-tree' ? 'demo-rain' : 'demo-tree', true);
    return { ok: true };
  });
  handle('garden:pet-ready', () => petState());
  handle('garden:open', async (_sender, id) => {
    if (settings.mode !== 'connected') return { ok: true };
    const url = new URL('/', settings.serverUrl); url.hash = 'ideas';
    if (typeof id === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(id)) url.searchParams.set('project', id);
    await shell.openExternal(url.href); return { ok: true };
  });
  ipcMain.on('garden:hide', event => { if (panelUsers.has(event.sender.id)) BrowserWindow.fromWebContents(event.sender)?.hide(); });
  ipcMain.on('garden:toggle', event => { if (event.sender === petWindow?.webContents) togglePanel(); });
  ipcMain.on('garden:main', (event, id) => { if (panelUsers.has(event.sender.id) || event.sender === petWindow?.webContents) showPanel(typeof id === 'string' ? id : undefined); });
  ipcMain.on('garden:quick-size', (event, height) => {
    if (event.sender !== quickWindow?.webContents || !Number.isFinite(height)) return;
    const next = Math.max(210, Math.min(540, Math.round(height)));
    if (Math.abs(quickWindow.getBounds().height - next) > 1) quickWindow.setBounds(quickBounds(next));
  });
  ipcMain.on('garden:pet-hit', (event, hit) => { if (event.sender === petWindow?.webContents) petWindow.setIgnoreMouseEvents(!hit, { forward: true }); });
  ipcMain.on('garden:move', (event, dx, dy) => {
    if (event.sender !== petWindow?.webContents || !Number.isFinite(dx) || !Number.isFinite(dy) || Math.abs(dx) > 2000 || Math.abs(dy) > 2000) return;
    const bounds = petWindow.getBounds();
    const area = screen.getDisplayNearestPoint({ x: bounds.x + dx, y: bounds.y + dy }).workArea;
    petWindow.setPosition(Math.round(Math.max(area.x, Math.min(area.x + area.width - bounds.width, bounds.x + dx))), Math.round(Math.max(area.y, Math.min(area.y + area.height - bounds.height, bounds.y + dy))));
  });
  ipcMain.on('garden:menu', event => { if (event.sender === petWindow?.webContents) Menu.buildFromTemplate(menuTemplate()).popup({ window: petWindow }); });
}

if (hasLock) app.whenReady().then(async () => {
  dataPath = app.getPath('userData'); assets = app.isPackaged ? join(process.resourcesPath, 'companion') : join(__dirname, '../public/companion');
  const storedSettings = readJSON(join(dataPath, 'settings.json'), {});
  settings = { ...defaults, ...storedSettings };
  if (storedSettings.settingsVersion !== 2) { settings.mode = 'connected'; settings.settingsVersion = 2; saveSettings(); }
  try { settings.serverUrl = serverOrigin(settings.serverUrl); } catch { settings.serverUrl = defaults.serverUrl; settings.mode = 'demo'; }
  const { createDemoStore } = await import(pathToFileURL(join(assets, 'demo.mjs')).href);
  demo = createDemoStore({ initialData: readJSON(join(dataPath, 'experience.json'), null), save: data => writeJSON(join(dataPath, 'experience.json'), data), changed: () => { broadcast('changed'); setImmediate(refreshBackground); } });
  configureClient(); installIPC();
  const area = screen.getPrimaryDisplay().workArea;
  petWindow = new BrowserWindow({ width: 176, height: 196, x: area.x + area.width - 192, y: area.y + area.height - 204, frame: false, transparent: true, resizable: false, show: false, alwaysOnTop: true, skipTaskbar: true, hasShadow: false, backgroundColor: '#00000000', webPreferences: webPreferences() });
  secureWindow(petWindow, 'pet.html'); petWindow.setIgnoreMouseEvents(true, { forward: true });
  if (process.platform === 'darwin') petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  petWindow.once('ready-to-show', () => petWindow.showInactive());
  // A native tray icon with no network/font dependency.
  const iconData = nativeImage.createFromPath(join(assets, 'tray.png')).resize({ width: 20, height: 20 });
  tray = new Tray(iconData);
  tray.setToolTip('小花园桌宠'); tray.setContextMenu(Menu.buildFromTemplate(menuTemplate())); tray.on('click', () => showQuick()); tray.on('double-click', () => showPanel()); tray.on('right-click', () => tray.setContextMenu(Menu.buildFromTemplate(menuTemplate())));
  const registered = globalShortcut.register(shortcut, () => showQuick());
  if (!registered) settings.shortcutUnavailable = true;
  powerMonitor.on('resume', () => { restoreSession().then(() => { broadcast('changed'); startEvents(); refreshBackground(); }); });
  const poll = setInterval(() => { restoreSession().then(() => refreshBackground()); broadcast('changed'); }, 12000); poll.unref();
  await restoreSession();
  await refreshBackground();
  if (process.platform === 'darwin') app.dock?.hide();
}).catch(error => { console.error('小伙伴启动失败：', error.code || error.name); app.quit(); });
app.on('second-instance', () => showQuick());
app.on('window-all-closed', () => { /* The tray owns the lifetime. */ });
app.on('before-quit', () => { quitting = true; eventsController?.abort(); clearTimeout(eventsTimer); if (app.isReady()) globalShortcut.unregisterAll(); if (tray && !tray.isDestroyed()) tray.destroy(); });
