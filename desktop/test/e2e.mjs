import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { createApp } from '../../server.mjs';
import { createAccount } from '../../lib/accounts.mjs';
import contract from '../../lib/release-contract.cjs';

// Supply a Playwright package directory with GARDEN_PLAYWRIGHT_PATH, or install
// Playwright in your development environment. No browser download is required.
const require = createRequire(import.meta.url);
const { _electron } = require(process.env.GARDEN_PLAYWRIGHT_PATH || 'playwright');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const output = join(root, '.local', 'desktop-qa');
await mkdir(output, { recursive: true });
const run = await mkdtemp(join(output, 'run-'));
const executablePath = process.env.GARDEN_ELECTRON_EXECUTABLE || join(root, 'desktop/node_modules/electron/dist', process.platform === 'win32' ? 'electron.exe' : process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron');
const errors = [];
const activeApps = new Set();
let server, port;

async function eventually(action, timeout = 15000) {
  const end = Date.now() + timeout;
  while (true) { try { return await action(); } catch (error) { if (Date.now() > end) throw error; await new Promise(resolve => setTimeout(resolve, 100)); } }
}
async function launch(profile) {
  const env = { ...process.env, GARDEN_COMPANION_TEST: '1', GARDEN_COMPANION_PROFILE: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath, args: process.env.GARDEN_PACKAGED === '1' ? [] : [join(root, 'desktop')], env });
  activeApps.add(app);
  app.process().stderr.on('data', chunk => { const text = chunk.toString(); if (text.includes('DESKTOP_QA_MAIN_')) { errors.push(text); console.error(text); } });
  app.on('window', page => page.on('pageerror', error => errors.push(error.message)));
  const pet = await eventually(() => { const page = app.windows().find(page => page.url().endsWith('/pet.html')); assert.ok(page); return page; });
  await pet.locator('#pet-hit').waitFor();
  assert.equal(app.windows().filter(page => page.url().endsWith('/index.html')).length, 0, 'startup shows only the pet');
  await pet.locator('#pet-hit').dblclick();
  const panel = await eventually(() => { const page = app.windows().find(page => page.url().endsWith('/index.html')); assert.ok(page); return page; });
  await panel.waitForSelector('#content', { timeout: 15000 });
  panel.setDefaultTimeout(12000);
  return { app, panel };
}
async function closeApp(app) {
  let timer;
  try { await Promise.race([app.close(), new Promise((_, reject) => { timer = setTimeout(() => { app.process().kill(); reject(new Error('Desktop shutdown timed out')); }, 15000); })]); }
  finally { clearTimeout(timer); activeApps.delete(app); }
}
async function start() {
  server = createApp({ dataDir: join(run, 'service'), cookieSecure: false, releasePollMs: 100 });
  server.listen(port || 0, '127.0.0.1'); await once(server, 'listening'); port = server.address().port;
}
async function stop() { if (!server?.listening) return; const closed = once(server, 'close'); server.close(); server.closeIdleConnections(); await closed; }
async function login(panel, name) {
  await panel.locator('#login-form').waitFor();
  await panel.locator('[name=name]').fill(name); await panel.locator('[name=password]').fill('Desktop-QA-only-2026!');
  await panel.locator('#login-form button[type=submit]').click(); await panel.locator('#idea-input').waitFor();
}
async function openRecord(panel, title) { await panel.locator('.nav-button[data-page=ideas]').click(); await panel.locator('.idea-row').filter({ hasText: title }).first().click(); await panel.locator('.detail-title').filter({ hasText: title }).waitFor(); }

try {
  // The packaged experience is functional with no server or model credential.
  const experienceProfile = join(run, 'experience');
  await mkdir(experienceProfile, { recursive: true });
  await writeFile(join(experienceProfile, 'settings.json'), JSON.stringify({ mode: 'demo', settingsVersion: 2, notifications: false }));
  const experience = await launch(experienceProfile);
  await experience.panel.locator('#idea-input').waitFor();
  await experience.panel.locator('#settings-button').click();
  await experience.panel.locator('[data-action=pet][data-pet=cat]').click();
  await experience.panel.locator('[data-action=peer-window]').click();
  const peerPanel = await eventually(() => { const page = experience.app.windows().find(page => page !== experience.panel && page.url().endsWith('/index.html')); assert.ok(page); return page; });
  await peerPanel.locator('#idea-input').waitFor();
  await experience.panel.locator('[data-action=page][data-page=talk]').first().click();
  const demoText = '我们来画一本属于两个人的旅行地图。';
  await experience.panel.locator('#idea-input').fill(demoText); await experience.panel.locator('#compose-form button[type=submit]').click();
  await peerPanel.locator('.notice').filter({ hasText: '我们来画一本属于两个人的旅行地图' }).waitFor();
  await peerPanel.locator('.notice').click(); await peerPanel.locator('.original').filter({ hasText: demoText }).waitFor();
  await peerPanel.screenshot({ path: join(output, 'experience-received.png') });
  const pet = experience.app.windows().find(page => page.url().endsWith('/pet.html'));
  assert.match(await pet.locator('#pet-image').getAttribute('src'), /cat\.svg$/);
  await closeApp(experience.app);
  console.log('PASS: self-contained demo, two perspectives, cat skin, native pet.');

  await start();
  await createAccount(server.db, { name: '小树', password: 'Desktop-QA-only-2026!' });
  await createAccount(server.db, { name: '小雨', password: 'Desktop-QA-only-2026!' });
  const origin = `http://127.0.0.1:${port}`;
  const profileA = join(run, 'alice'), profileB = join(run, 'bob');
  for (const profile of [profileA, profileB]) { await mkdir(profile, { recursive: true }); await writeFile(join(profile, 'settings.json'), JSON.stringify({ mode: 'connected', settingsVersion: 2, serverUrl: origin, notifications: false, doNotDisturb: true })); }
  const a = await launch(profileA), b = await launch(profileB);
  console.log('CHECK: real clients launched.');
  await login(a.panel, '小树'); await login(b.panel, '小雨');
  console.log('CHECK: real clients logged in.');
  const original = '一起给我们的旅行画一本地图。\n先从最喜欢的那次海边旅行开始。';
  const title = '一起给我们的旅行画一本地图';
  await a.panel.locator('#idea-input').fill(original); await a.panel.locator('#compose-form button[type=submit]').click();
  await b.panel.locator('.notice').filter({ hasText: title }).waitFor();
  await b.panel.locator('.notice').click();
  assert.equal(await b.panel.locator('.original').innerText(), original);
  await b.panel.locator('[data-action=consent]').click();
  await openRecord(a.panel, title); await a.panel.locator('[data-action=consent]').click();
  await a.panel.locator('#goal-input').fill('先做一页海边旅行的小地图'); await a.panel.locator('#goal-form button[type=submit]').click();
  await a.panel.locator('#task-input').fill('各自挑出三张最喜欢的照片'); await a.panel.locator('#task-form button[type=submit]').click();
  await eventually(() => assert.equal(server.db.prepare('SELECT goal FROM projects WHERE title = ?').get(title)?.goal, '先做一页海边旅行的小地图'));
  await b.panel.locator('#reply-input').fill('我来找那张车票，你来挑照片吧。'); await b.panel.locator('#reply-form button[type=submit]').click();
  await a.panel.locator('.note').filter({ hasText: '我来找那张车票' }).waitFor();
  await a.panel.locator('[data-action=back]').click(); await a.panel.locator('[data-action=page][data-page=goals]').click();
  await a.panel.locator('.idea-row h3').filter({ hasText: title }).waitFor();
  await a.panel.screenshot({ path: join(output, 'shared-goals.png') });
  await openRecord(b.panel, title); await b.panel.screenshot({ path: join(output, 'shared-record.png') });
  console.log('PASS: two independent real accounts, SSE delivery, original text, mutual consent, goal, task, reply.');

  // A closed recipient catches up from persistent server records after relaunch.
  await closeApp(b.app);
  await a.panel.locator('.nav-button[data-page=talk]').click();
  await a.panel.locator('#idea-input').fill('下个月，一起试着做一道新菜。'); await a.panel.locator('#compose-form button[type=submit]').click();
  const b2 = await launch(profileB); await b2.panel.locator('#idea-input').waitFor();
  await b2.panel.locator('.notice').filter({ hasText: '下个月，一起试着做一道新菜' }).waitFor();
  const encrypted = await readFile(join(profileB, 'session.encrypted.json'), 'utf8'); assert.ok(!encrypted.includes('garden_session='));
  await closeApp(b2.app);
  console.log('PASS: encrypted remembered session and delivery after recipient restart.');

  // A cold offline reload keeps the known identity and local pending ideas.
  await stop();
  await a.panel.locator('#idea-input').fill('断网时也记住：周末一起去看日落。'); await a.panel.locator('#compose-form button[type=submit]').click();
  await a.panel.locator('.queue-note').waitFor();
  await a.panel.reload(); await a.panel.locator('#idea-input').waitFor(); await a.panel.locator('.queue-note').waitFor();
  await start();
  await a.panel.evaluate(() => window.dispatchEvent(new Event('online')));
  await eventually(() => assert.equal(server.db.prepare("SELECT COUNT(*) AS count FROM projects WHERE description LIKE '断网时也记住：%'").get().count, 1));
  await eventually(async () => assert.equal(await a.panel.locator('.queue-note').count(), 0));
  assert.equal(server.db.prepare('SELECT COUNT(*) AS count FROM projects').get().count, 3);
  await a.panel.locator('.nav-button[data-page=talk]').click(); await a.panel.screenshot({ path: join(output, 'companion-home.png') });
  console.log('PASS: offline queue survives renderer restart, resends after reconnect, and creates exactly one record.');

  const b3 = await launch(profileB); await b3.panel.locator('#idea-input').waitFor();
  assert.equal(await a.panel.getByRole('button', {name:'聊一聊',exact:true}).count(),0);
  await a.panel.locator('.nav-button[data-page=goals]').click();
  await a.panel.getByRole('button',{name:'发起共同话题',exact:true}).click();
  const proposal='这个月一起读完一本书，每周分享一个片段。';
  await a.panel.locator('#goal-proposal-input').fill(proposal);
  await a.panel.getByRole('button',{name:'提交共同话题'}).click();
  await a.panel.locator('.idea-row').filter({hasText:'这个月一起读完一本书'}).waitFor();
  await b3.panel.locator('.nav-button[data-page=goals]').click();
  await b3.panel.locator('.idea-row').filter({hasText:'这个月一起读完一本书'}).click();
  await b3.panel.locator('[data-action=consent]').click();
  await b3.panel.locator('#goal-input').waitFor();
  assert.equal(await b3.panel.locator('#goal-input').inputValue(),proposal);
  console.log('PASS: main-window common-topic submit is clickable, pending proposal is visible, peer can confirm.');

  // The server announcement checks metadata; it must leave an active draft intact.
  await a.panel.locator('.nav-button[data-page=talk]').click();
  await a.panel.locator('#idea-input').fill('更新提醒到来时，这份草稿仍在。');
  const version='0.4.2';
  await writeFile(join(run,'service/desktop-release.json'),JSON.stringify({schemaVersion:1,version,publishedAt:new Date().toISOString(),notes:'测试服务器更新提醒。',assets:Object.fromEntries(Object.entries(contract.assetSuffixes).map(([key,suffix])=>[key,{url:`${contract.source}/releases/download/v${version}/Garden-Companion-${version}-${suffix}`,sha256:'a'.repeat(64),size:100}]))}));
  await a.panel.locator('.update-notice').waitFor();
  assert.equal(await a.panel.locator('#idea-input').inputValue(),'更新提醒到来时，这份草稿仍在。');
  assert.equal((await a.panel.evaluate(()=>window.gardenDesktop.update('status'))).status,'available');
  await a.panel.locator('.update-notice').click();
  await a.panel.locator('#software-update').waitFor();
  assert.match(await a.panel.locator('#software-update').innerText(),/0\.4\.2/);
  console.log('PASS: server software update notification preserves drafts and waits for user download.');

  await a.panel.getByRole('button',{name:'解除伴侣绑定',exact:true}).click();
  await a.panel.locator('#garden-unlink-form [name=confirm]').check();
  await a.panel.getByRole('button',{name:'确认解绑',exact:true}).click();
  await a.panel.locator('#idea-input').waitFor();
  await eventually(async()=>assert.equal((await b3.panel.evaluate(()=>window.gardenDesktop.request('/api/state'))).garden.members.length,1));
  await a.panel.locator('#settings-button').click();
  await a.panel.locator('[data-action=archive-open]').click();
  await a.panel.locator('.archive-record summary').filter({hasText:'这个月一起读完一本书'}).click();
  assert.match(await a.panel.locator('.archive-record[open]').innerText(),/每周分享一个片段/);
  assert.equal(await a.panel.locator('.archive-record textarea,.archive-record input').count(),0);
  await b3.panel.locator('#settings-button').click();
  await b3.panel.locator('[data-action=archive-open]').click();
  await b3.panel.locator('.archive-record summary').filter({hasText:'这个月一起读完一本书'}).waitFor();
  console.log('PASS: unlink button works, both members become independent, both retain read-only history.');
  await closeApp(b3.app);await closeApp(a.app);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: 'all desktop flows passed', screenshots: output, run, pageErrors: errors }));
} catch (error) {
  let index = 0;
  for (const app of activeApps) for (const panel of app.windows().filter(page => page.url().endsWith('/index.html'))) {
    await panel.screenshot({ path: join(output, `failure-${index++}.png`) }).catch(() => {});
    console.error('FAILED_PANEL', (await panel.locator('body').innerText().catch(() => '')).slice(-2200));
  }
  throw error;
} finally {
  for (const app of activeApps) await app.close().catch(() => {});
  await stop();
}
