// Verify that help is a sandboxed application window, without opening a browser.
// This uses an isolated local demo profile and never contacts production accounts.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { _electron } = require(process.env.GARDEN_PLAYWRIGHT_PATH || 'playwright');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const output = join(root, '.local/desktop-qa');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(join(output, 'embedded-guide-'));
await writeFile(join(profile, 'settings.json'), JSON.stringify({ mode: 'demo', settingsVersion: 2, notifications: false }));
const executablePath = process.env.GARDEN_ELECTRON_EXECUTABLE || join(root, 'desktop/node_modules/electron/dist', process.platform === 'win32' ? 'electron.exe' : process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron');
const env = { ...process.env, GARDEN_COMPANION_TEST: '1', GARDEN_COMPANION_PROFILE: profile };
delete env.ELECTRON_RUN_AS_NODE;
const application = await _electron.launch({ executablePath, args: process.env.GARDEN_PACKAGED === '1' ? [] : [join(root, 'desktop')], env });
const errors = [];
application.on('window', page => page.on('pageerror', error => errors.push(error.message)));
application.process().stderr.on('data', data => { if (data.toString().includes('DESKTOP_QA_MAIN_')) errors.push(data.toString()); });

async function eventually(check, timeout = 12000) {
  const deadline = Date.now() + timeout;
  while (true) {
    try { return await check(); }
    catch (error) { if (Date.now() >= deadline) throw error; await new Promise(resolve => setTimeout(resolve, 100)); }
  }
}
const isGuide = page => page.url().split('#')[0].endsWith('/guide.html');
async function guidePage() {
  return eventually(async () => {
    const guides = application.windows().filter(isGuide);
    assert.equal(guides.length, 1, '使用教程应在唯一的应用内窗口打开');
    await guides[0].waitForLoadState('load');
    return guides[0];
  });
}
async function windowInfo() {
  return application.evaluate(({ BrowserWindow }) => {
    const guide = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().split('#')[0].endsWith('/guide.html'));
    if (!guide) return null;
    const preferences = guide.webContents.getLastWebPreferences();
    return { id: guide.id, visible: guide.isVisible(), title: guide.getTitle(), preferences: { nodeIntegration: preferences.nodeIntegration, contextIsolation: preferences.contextIsolation, sandbox: preferences.sandbox, preload: preferences.preload || null } };
  });
}

try {
  const pet = await eventually(() => { const page = application.windows().find(page => page.url().endsWith('/pet.html')); assert.ok(page); return page; });
  await pet.waitForLoadState('load');
  assert.equal(application.windows().filter(isGuide).length, 0, '普通启动不应自动打开教程');
  // A regression to shell.openPath/openExternal must not launch an external app
  // even while the test is checking the failure.
  await application.evaluate(({ shell }) => {
    globalThis.gardenGuideExternalOpens = [];
    shell.openExternal = async target => { globalThis.gardenGuideExternalOpens.push({ method: 'openExternal', target }); };
    shell.openPath = async target => { globalThis.gardenGuideExternalOpens.push({ method: 'openPath', target }); return 'Blocked by isolated guide QA'; };
  });
  const opened = await pet.evaluate(() => window.gardenDesktop.openGuide());
  assert.equal(opened.opened, true);
  const guide = await guidePage();
  await guide.locator('h1').filter({ hasText: '小伙伴的使用教程' }).waitFor();
  assert.equal(await guide.locator('h1').innerText(), '小伙伴的使用教程');
  await eventually(async () => assert.equal((await windowInfo())?.visible, true));
  const native = await windowInfo();
  assert.match(native.title, /使用教程/);
  assert.deepEqual(native.preferences, { nodeIntegration: false, contextIsolation: true, sandbox: true, preload: null });
  assert.deepEqual(await guide.evaluate(() => ({ node: typeof require, process: typeof process, bridge: typeof window.gardenDesktop })), { node: 'undefined', process: 'undefined', bridge: 'undefined' });
  console.log('PASS: the guide opens inside a sandboxed native app window without Node or the desktop preload.');

  const images = await guide.evaluate(async () => {
    const images = [...document.images];
    for (const image of images) image.loading = 'eager';
    return Promise.all(images.map(async image => {
      try { await image.decode(); return { src: image.getAttribute('src'), loaded: image.complete && image.naturalWidth > 0, width: image.naturalWidth }; }
      catch { return { src: image.getAttribute('src'), loaded: false, width: image.naturalWidth }; }
    }));
  });
  assert.ok(images.length >= 3, '教程应包含随包提供的插图和操作截图');
  assert.ok(images.every(image => image.loaded), '教程有未能加载的本地图片：' + JSON.stringify(images));
  const screenshot = join(profile, 'embedded-guide.png');
  await guide.screenshot({ path: screenshot });
  console.log('PASS: every guide image decodes from the bundled local resources.');

  const anchors = await guide.locator('a[href^="#"]').evaluateAll(links => [...new Set(links.map(link => link.getAttribute('href')))]);
  assert.ok(anchors.length >= 5, '教程目录应提供页面内导航');
  for (const hash of anchors) {
    const id = decodeURIComponent(hash.slice(1));
    assert.ok(await guide.evaluate(id => Boolean(document.getElementById(id)), id), '缺少目录目标：' + hash);
    await guide.locator(`a[href="${hash}"]`).first().click();
    await eventually(async () => assert.equal(await guide.evaluate(() => location.hash), hash));
    assert.ok(await guide.evaluate(id => { const rect = document.getElementById(id).getBoundingClientRect(); return rect.bottom > 0 && rect.top < innerHeight; }, id), '目录目标没有进入窗口可见区域：' + hash);
  }
  console.log('PASS: every internal navigation anchor stays in the guide window and reaches its section.');

  await pet.evaluate(() => window.gardenDesktop.openGuide());
  await guidePage();
  assert.equal((await windowInfo()).id, native.id, '再次打开教程应复用现有窗口');
  assert.equal(application.windows().filter(isGuide).length, 1);
  console.log('PASS: reopening help reuses one guide window.');

  // Close the native window as its title-bar button does. Closing the CDP page
  // can close the debugging transport itself in some packaged Electron builds.
  await application.evaluate(({BrowserWindow},id)=>BrowserWindow.fromId(id).close(),native.id);
  await eventually(() => assert.equal(application.windows().filter(isGuide).length, 0));
  await application.evaluate(({ app }, root) => app.emit('second-instance', {}, ['--guide'], root), root);
  const reopened = await guidePage();
  await reopened.locator('h1').filter({ hasText: '小伙伴的使用教程' }).waitFor();
  assert.notEqual((await windowInfo()).id, native.id, '关闭教程后应能重新创建窗口');
  assert.deepEqual(await application.evaluate(() => globalThis.gardenGuideExternalOpens), [], '打开教程和页面内导航不应启动外部浏览器');
  assert.deepEqual(errors, []);
  console.log('PASS: relaunching with --guide recreates a closed embedded guide without opening a browser.');

  const report = { result: 'passed', profile, screenshot, native, images, anchors, reopened: await windowInfo(), errors };
  await writeFile(join(profile, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally { await application.close(); }
