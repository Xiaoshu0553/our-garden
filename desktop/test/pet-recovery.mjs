// Regression for a running-but-hidden pet, disconnected monitors and relaunch.
// All state belongs to an isolated demo profile; production accounts are unused.
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
const profile = await mkdtemp(join(output, 'pet-recovery-'));
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
async function snapshot() {
  return application.evaluate(({ BrowserWindow, screen }) => ({
    windows: BrowserWindow.getAllWindows().map(window => ({ title: window.getTitle(), visible: window.isVisible(), minimized: window.isMinimized(), bounds: window.getBounds() })),
    workAreas: screen.getAllDisplays().map(display => display.workArea),
    cursorWorkArea: screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea,
  }));
}
const contains = (area, bounds) => bounds.x >= area.x && bounds.y >= area.y && bounds.x + bounds.width <= area.x + area.width && bounds.y + bounds.height <= area.y + area.height;
async function recovered({ cursorDisplay = false } = {}) {
  return eventually(async () => {
    const state = await snapshot();
    const pet = state.windows.find(window => window.title === '小花园桌宠');
    assert.ok(pet?.visible, '找回操作应重新显示宠物');
    assert.equal(pet.minimized, false);
    assert.ok((cursorDisplay ? [state.cursorWorkArea] : state.workAreas).some(area => contains(area, pet.bounds)), '宠物应完整位于可见显示器的工作区内');
    assert.equal(state.windows.filter(window => window.title !== '小花园桌宠' && window.visible).length, 0, '找回宠物不应自动弹出快捷卡片或主界面');
    return state;
  });
}
async function losePet(hide) {
  await application.evaluate(({ BrowserWindow }, hide) => {
    const pet = BrowserWindow.getAllWindows().find(window => window.getTitle() === '小花园桌宠');
    pet.setPosition(100000, 100000);
    if (hide) pet.hide();
  }, hide);
}

try {
  const pet = await eventually(() => { const page = application.windows().find(page => page.url().endsWith('/pet.html')); assert.ok(page); return page; });
  await pet.waitForLoadState('load');
  await eventually(async () => assert.ok(await pet.locator('#pet-image').evaluate(image => image.complete && image.naturalWidth > 0)));
  await recovered();
  console.log('PASS: startup displays a rendered pet without opening a panel.');

  await losePet(true);
  await application.evaluate(({ app }, root) => app.emit('second-instance', {}, [], root), root);
  const relaunch = await recovered({ cursorDisplay: true });
  console.log('PASS: relaunch restores a hidden, off-screen pet on the current display without opening a panel.');

  await application.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows().find(window=>window.getTitle()==='小花园桌宠').close());
  await eventually(async()=>assert.equal((await snapshot()).windows.find(window=>window.title==='小花园桌宠')?.visible,false));
  await application.evaluate(({app},root)=>app.emit('second-instance',{},[],root),root);
  await recovered({cursorDisplay:true});
  console.log('PASS: closing the pet keeps it recoverable from the running app.');

  await losePet(false);
  await application.evaluate(({ screen }) => screen.emit('display-metrics-changed', {}, screen.getPrimaryDisplay(), ['bounds', 'workArea']));
  const displayChange = await recovered();
  console.log('PASS: display changes return an off-screen visible pet to a display work area.');

  await losePet(true);
  await application.evaluate(({ Menu }) => {
    globalThis.gardenRecoveryOriginalPopup = Menu.prototype.popup;
    Menu.prototype.popup = function () { globalThis.gardenRecoveryMenu = this; };
  });
  await pet.evaluate(() => window.gardenDesktop.petMenu());
  await eventually(async () => assert.ok(await application.evaluate(() => globalThis.gardenRecoveryMenu?.items.some(item => item.label === '找回小伙伴')), '菜单应提供找回小伙伴入口'));
  await application.evaluate(() => globalThis.gardenRecoveryMenu.items.find(item => item.label === '找回小伙伴').click());
  const menuRecovery = await recovered({ cursorDisplay: true });
  await application.evaluate(({ Menu }) => { Menu.prototype.popup = globalThis.gardenRecoveryOriginalPopup; });
  console.log('PASS: the recovery menu restores and repositions the pet.');

  // A real external monitor may lie left/above the primary screen. Substitute
  // only this fixture's cursor accessor, without moving the user's mouse.
  const negativeArea = await application.evaluate(({ screen }) => {
    const display = screen.getAllDisplays().find(display => display.workArea.x < 0 || display.workArea.y < 0);
    if (!display) return null;
    globalThis.gardenRecoveryOriginalCursor = screen.getCursorScreenPoint;
    const area = display.workArea;
    screen.getCursorScreenPoint = () => ({ x: area.x + Math.floor(area.width / 2), y: area.y + Math.floor(area.height / 2) });
    return area;
  });
  let negativeDisplayRecovery = null;
  try {
    if (negativeArea) {
      await losePet(true);
      await application.evaluate(({ app }, root) => app.emit('second-instance', {}, [], root), root);
      negativeDisplayRecovery = await recovered({ cursorDisplay: true });
      const bounds = negativeDisplayRecovery.windows.find(window => window.title === '小花园桌宠').bounds;
      const expectedX = negativeArea.x + Math.max(0, negativeArea.width - Math.min(176, negativeArea.width) - 16);
      const expectedY = negativeArea.y + Math.max(0, negativeArea.height - Math.min(196, negativeArea.height) - 8);
      // Different per-monitor DPI settings may round a native edge by one DIP.
      assert.ok(Math.abs(bounds.x - expectedX) <= 2 && Math.abs(bounds.y - expectedY) <= 2, '负坐标显示器的右下角位置应按该显示器的工作区计算');
      console.log('PASS: recovery on a negative-coordinate external display honors that monitor work area and DPI.');
    }
  } finally {
    if (negativeArea) await application.evaluate(({ screen }) => { screen.getCursorScreenPoint = globalThis.gardenRecoveryOriginalCursor; });
  }

  const screenshot = join(profile, 'pet-recovered.png');
  await pet.screenshot({ path: screenshot });
  const guidePath = process.env.GARDEN_PACKAGED === '1' ? join(await application.evaluate(() => process.resourcesPath), 'help/使用教程.html') : join(root,'docs/使用教程.html');
  const guide = await application.evaluate(async ({BrowserWindow},filename) => {
    const window = new BrowserWindow({show:false,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});
    try {
      await window.loadFile(filename);
      return await window.webContents.executeJavaScript(`(async()=>{const images=[...document.images];for(const image of images)image.loading='eager';await Promise.all(images.map(image=>image.decode()));return {title:document.title,images:images.length,allImagesRendered:images.every(image=>image.naturalWidth>0),brokenAnchors:[...document.querySelectorAll('a[href^="#"]')].filter(a=>!document.getElementById(a.hash.slice(1))).length}})()`);
    } finally { window.destroy(); }
  },guidePath);
  assert.ok(guide.title.includes('使用教程'));assert.ok(guide.images>=3);assert.equal(guide.allImagesRendered,true);assert.equal(guide.brokenAnchors,0);
  console.log('PASS: the bundled offline guide loads with images and working navigation.');
  assert.deepEqual(errors, []);
  const report = { result: 'passed', profile, screenshot, relaunch, displayChange, menuRecovery, negativeDisplayRecovery, guide, errors };
  await writeFile(join(profile, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally { await application.close(); }
