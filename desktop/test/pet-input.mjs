// A screenshot overlay can take pointer capture without delivering pointerup.
// Exercise the real captured pointer in an isolated demo profile only.
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
const profile = await mkdtemp(join(output, 'pet-input-'));
await writeFile(join(profile, 'settings.json'), JSON.stringify({ mode: 'demo', settingsVersion: 2, notifications: false }));
const executablePath = process.env.GARDEN_ELECTRON_EXECUTABLE || join(root, 'desktop/node_modules/electron/dist', process.platform === 'win32' ? 'electron.exe' : process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron');
const env = { ...process.env, GARDEN_COMPANION_TEST: '1', GARDEN_COMPANION_PROFILE: profile };
delete env.ELECTRON_RUN_AS_NODE;
const application = await _electron.launch({ executablePath, args: process.env.GARDEN_PACKAGED === '1' ? [] : [join(root, 'desktop')], env });
const errors = [];
application.on('window', page => page.on('pageerror', error => errors.push(error.message)));
application.process().stderr.on('data', data => { if (data.toString().includes('DESKTOP_QA_MAIN_')) errors.push(data.toString()); });

async function eventually(check) {
  const deadline = Date.now() + 12000;
  while (true) {
    try { return await check(); }
    catch (error) { if (Date.now() >= deadline) throw error; await new Promise(resolve => setTimeout(resolve, 100)); }
  }
}
async function actions() { return application.evaluate(() => globalThis.petInputActions); }
async function bounds() { return application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.getTitle() === '小花园桌宠').getBounds()); }

try {
  const pet = await eventually(() => { const page = application.windows().find(page => page.url().endsWith('/pet.html')); assert.ok(page); return page; });
  await pet.waitForLoadState('load');
  await pet.locator('#pet-image').evaluate(image => image.decode());
  pet.on('pageerror', error => errors.push(error.message));
  // Record renderer intents instead of opening/focusing a panel during input QA.
  // Keep the real move handler so an accidental drag changes native bounds.
  await application.evaluate(({ ipcMain }) => {
    globalThis.petInputActions = { quick: 0, main: 0, moves: [] };
    ipcMain.removeAllListeners('garden:toggle');
    ipcMain.removeAllListeners('garden:main');
    ipcMain.on('garden:toggle', () => globalThis.petInputActions.quick++);
    ipcMain.on('garden:main', () => globalThis.petInputActions.main++);
    ipcMain.on('garden:move', (_event, dx, dy) => globalThis.petInputActions.moves.push({ dx, dy }));
  });
  await pet.evaluate(() => document.getElementById('pet-hit').addEventListener('pointerdown', event => {
    window.petInputPointer = { id: event.pointerId, x: event.screenX, y: event.screenY };
  }));
  async function down() {
    const box = await pet.locator('#pet-hit').boundingBox();
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await pet.mouse.move(point.x, point.y);
    await pet.mouse.down();
    assert.equal(await pet.evaluate(() => document.getElementById('pet-hit').hasPointerCapture(window.petInputPointer.id)), true, 'a real press should capture its pointer');
    return point;
  }
  async function unpressedMove({ mismatched = false } = {}) {
    await pet.evaluate(mismatched => {
      const pointer = window.petInputPointer;
      document.getElementById('pet-hit').dispatchEvent(new PointerEvent('pointermove', {
        pointerId: pointer.id + (mismatched ? 1 : 0), pointerType: 'mouse', bubbles: true,
        screenX: pointer.x - 100, screenY: pointer.y - 80, buttons: mismatched ? 1 : 0,
      }));
    }, mismatched);
  }
  async function staysCancelled(label, interrupt) {
    const before = await actions();
    const position = await bounds();
    const point = await down();
    await interrupt(point);
    await unpressedMove();
    await pet.mouse.up();
    // Native input already queued by an overlay may arrive after cancellation.
    await pet.locator('#pet-hit').dispatchEvent('click', { detail: 1 });
    await pet.locator('#pet-hit').dispatchEvent('dblclick', { detail: 2 });
    await pet.waitForTimeout(450);
    assert.deepEqual(await actions(), before, `${label}: interruption must not move the pet or open a late panel`);
    assert.deepEqual(await bounds(), position, `${label}: native bounds should remain unchanged`);
    console.log(`PASS: ${label} cancels dragging and suppresses the interrupted click.`);
  }

  await staysCancelled('lost pointer capture', async point => {
    await pet.evaluate(() => document.getElementById('pet-hit').releasePointerCapture(window.petInputPointer.id));
    // Chromium dispatches pending lostpointercapture before the next native move.
    await pet.mouse.move(point.x + 1, point.y);
    assert.equal(await pet.evaluate(() => document.getElementById('pet-hit').hasPointerCapture(window.petInputPointer.id)), false);
  });
  await staysCancelled('window blur', () => pet.evaluate(() => window.dispatchEvent(new Event('blur'))));
  await staysCancelled('released mouse button', () => unpressedMove());
  await staysCancelled('different pointer', () => unpressedMove({ mismatched: true }));
  await staysCancelled('hidden document', () => pet.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    try { document.dispatchEvent(new Event('visibilitychange')); }
    finally { delete document.hidden; }
  }));

  const beforePending = await actions();
  await down(); await pet.mouse.up();
  await pet.evaluate(() => window.dispatchEvent(new Event('blur')));
  await pet.waitForTimeout(450);
  assert.deepEqual(await actions(), beforePending, 'a screenshot interruption must clear an already pending single click');
  console.log('PASS: blur clears an already scheduled single-click action.');

  const beforeClick = await actions();
  await down(); await pet.mouse.up();
  await pet.waitForTimeout(450);
  assert.equal((await actions()).quick, beforeClick.quick + 1, 'the next ordinary click should still open quick capture');
  const beforeDouble = await actions();
  await pet.locator('#pet-hit').dblclick();
  await pet.waitForTimeout(450);
  assert.equal((await actions()).main, beforeDouble.main + 1, 'double-click should open the main view once');
  assert.equal((await actions()).quick, beforeDouble.quick, 'double-click should not also open quick capture');
  console.log('PASS: ordinary single and double clicks still dispatch the correct actions.');

  const beforeDrag = await actions();
  const point = await down();
  await pet.mouse.move(point.x - 16, point.y - 12);
  await pet.mouse.up();
  await pet.waitForTimeout(450);
  const afterDrag = await actions();
  assert.ok(afterDrag.moves.length > beforeDrag.moves.length, 'a held pointer should still move the native pet');
  assert.equal(afterDrag.quick, beforeDrag.quick, 'a normal drag must suppress its trailing click');
  assert.equal(afterDrag.main, beforeDrag.main);
  console.log('PASS: a normal drag still moves the pet without opening a panel.');
  assert.deepEqual(errors, []);
  await writeFile(join(profile, 'report.json'), JSON.stringify({ result: 'passed', profile, actions: afterDrag, errors }, null, 2));
  console.log(JSON.stringify({ result: 'passed', profile }));
} finally { await application.close(); }
