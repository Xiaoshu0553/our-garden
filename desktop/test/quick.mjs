import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { _electron } = require(process.env.GARDEN_PLAYWRIGHT_PATH || 'playwright');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const out = join(root, '.local/desktop-qa'); await mkdir(out, { recursive: true });
const profile = await mkdtemp(join(out, 'quick-'));
await writeFile(join(profile, 'settings.json'), JSON.stringify({ mode: 'demo', settingsVersion: 2, notifications: false }));
const app = await _electron.launch({ executablePath: process.env.GARDEN_ELECTRON_EXECUTABLE || join(root, 'desktop/node_modules/electron/dist/electron.exe'), args: process.env.GARDEN_PACKAGED === '1' ? [] : [join(root, 'desktop')], env: { ...process.env, GARDEN_COMPANION_TEST: '1', GARDEN_COMPANION_PROFILE: profile } });
const errors = [];
app.on('window', page => { page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message)); });
app.process().stderr.on('data', chunk => { if (chunk.toString().includes('DESKTOP_QA_MAIN_')) errors.push(chunk.toString()); });
async function eventually(action) { for (let i = 0; i < 100; i++) { try { return await action(); } catch (error) { if (i === 99) throw error; await new Promise(resolve => setTimeout(resolve, 100)); } } }
async function getPanel(mode) {
  return eventually(async () => {
    for (const page of app.windows().filter(page => page.url().endsWith('/index.html'))) {
      const info = await page.evaluate(() => window.gardenDesktop.info());
      if (info.windowMode === mode) return page;
    }
    throw new Error(`Waiting for ${mode} window`);
  });
}
async function windowState() { return app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(w => ({ title: w.getTitle(), visible: w.isVisible(), bounds: w.getBounds() }))); }
try {
  const pet = await eventually(() => { const page = app.windows().find(page => page.url().endsWith('/pet.html')); assert.ok(page); return page; });
  await pet.locator('#pet-hit').waitFor();
  assert.equal(app.windows().filter(page => page.url().endsWith('/index.html')).length, 0);
  await pet.locator('#pet-hit').click();
  const quick = await getPanel('quick'); await quick.locator('#idea-input').waitFor();
  assert.equal(await quick.locator('.topbar').isVisible(), false); assert.equal(await quick.locator('.hello').isVisible(), false); assert.equal(await quick.locator('.bottom-nav').isVisible(), false);
  assert.equal((await windowState()).filter(w => w.title === '小花园 · 两个人的灵感小伙伴').length, 0);
  const qBounds = (await windowState()).find(w => w.title === '小花园 · 快捷记录').bounds;
  assert.ok(qBounds.width <= 440 && qBounds.height <= 275);
  await quick.locator('#idea-input').fill('只在快捷面板里，先留一个小念头。');
  await quick.screenshot({ path: join(out, 'quick-popup.png') });
  await pet.locator('#pet-hit').dblclick();
  const main = await getPanel('main'); await main.locator('#idea-input').waitFor();
  await eventually(async () => assert.equal((await windowState()).find(w => w.title === '小花园 · 快捷记录').visible, false));
  await main.locator('#idea-input').fill('主界面的草稿也要好好保留。');
  await pet.locator('#pet-hit').click();
  await quick.locator('#idea-input').waitFor();
  assert.equal(await quick.locator('#idea-input').inputValue(), '只在快捷面板里，先留一个小念头。');
  await quick.locator('#compose-form button[type=submit]').click();
  await eventually(async () => {
    const data = await main.evaluate(() => window.gardenDesktop.request('/api/state'));
    assert.equal(data.projects.filter(p => p.description === '只在快捷面板里，先留一个小念头。').length, 1);
  });
  await pet.locator('#pet-hit').dblclick();
  assert.equal(await main.locator('#idea-input').inputValue(), '主界面的草稿也要好好保留。');
  await pet.locator('#pet-hit').click();
  await quick.locator('[data-mode=chat]').click(); await quick.locator('#idea-input').fill('帮我想一个很小的下一步。');
  await quick.locator('#compose-form button[type=submit]').click(); await quick.locator('.chat-message:not(.mine)').waitFor();
  assert.ok((await windowState()).find(w => w.title === '小花园 · 快捷记录').bounds.height >= 400);
  await app.evaluate(({ Menu }) => { globalThis.gardenOriginalPopup = Menu.prototype.popup; Menu.prototype.popup = function () { globalThis.gardenTestMenu = this; }; });
  await pet.locator('#pet-hit').dispatchEvent('contextmenu');
  await eventually(async () => assert.ok((await app.evaluate(() => globalThis.gardenTestMenu?.items.map(item => item.label))).includes('打开主界面')));
  await app.evaluate(() => globalThis.gardenTestMenu.items.find(item => item.label === '打开主界面').click());
  await eventually(async () => assert.equal((await windowState()).find(w => w.title === '小花园 · 快捷记录').visible, false));
  await app.evaluate(({ Menu }) => { Menu.prototype.popup = globalThis.gardenOriginalPopup; });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: 'PASS: pet-only startup, single-click quick capture, double-click main, right-click main entry, separate drafts, quick share, and chat resize', screenshot: join(out, 'quick-popup.png') }));
} finally { await app.close(); }
