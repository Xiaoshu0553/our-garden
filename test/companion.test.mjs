import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../server.mjs';
import { createAccount } from '../lib/accounts.mjs';
import core from '../desktop/core.cjs';

const password = 'Companion-test-only-2026!';
async function fixture(options = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'garden-companion-'));
  let server, origin;
  async function start() {
    server = createApp({ ...options, dataDir, cookieSecure: false });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    origin = `http://127.0.0.1:${server.address().port}`;
  }
  async function stop() { if (!server?.listening) return; const done = once(server, 'close'); server.close(); server.closeIdleConnections(); await done; }
  await start();
  const a = await createAccount(server.db, { name: '小树', password });
  const b = await createAccount(server.db, { name: '小雨', password });
  function client() { return new core.GardenClient({ origin }); }
  const alice = client(), bob = client();
  await alice.request('/api/auth/login', 'POST', { name: a.name, password });
  await bob.request('/api/auth/login', 'POST', { name: b.name, password });
  return { get server() { return server; }, get origin() { return origin; }, a, b, alice, bob, start, stop, async cleanup() { await stop(); await rm(dataDir, { recursive: true, force: true }); } };
}
async function eventually(action, timeout = 3000) {
  const until = Date.now() + timeout;
  while (true) { try { return await action(); } catch (error) { if (Date.now() >= until) throw error; await new Promise(resolve => setTimeout(resolve, 20)); } }
}

test('桌宠保存原话，重试幂等；未读只给另一人且必须打开后才算已读', async () => {
  const f = await fixture();
  try {
    const body = { clientId: 'capture-idempotent-001', text: '想和你做一期播客。\n<script>只是文字</script>，不要丢掉这句话。' };
    const { project } = await f.alice.request('/api/companion/capture', 'POST', body);
    assert.equal(project.description, body.text);
    assert.equal(project.capture.originalText, body.text);
    assert.equal(project.capture.aiState, 'original');
    const retried = await f.alice.request('/api/companion/capture', 'POST', body);
    assert.equal(retried.project.id, project.id); assert.equal(retried.duplicate, true);
    await assert.rejects(f.alice.request('/api/companion/capture', 'POST', { ...body, text: '同一标识不应覆盖原话' }), error => error.status === 409);
    assert.equal((await f.alice.request('/api/companion/inbox')).unreadCount, 0);
    let inbox = await f.bob.request('/api/companion/inbox');
    assert.equal(inbox.unreadCount, 1); assert.equal(inbox.items[0].projectId, project.id);
    // The sender cannot mark the recipient's notification delivered.
    await f.alice.request('/api/companion/inbox/delivered', 'POST', { ids: [inbox.items[0].id] });
    assert.equal((await f.bob.request('/api/companion/inbox')).items[0].deliveredAt, null);
    await f.bob.request('/api/companion/inbox/delivered', 'POST', { ids: [inbox.items[0].id] });
    inbox = await f.bob.request('/api/companion/inbox'); assert.ok(inbox.items[0].deliveredAt); assert.equal(inbox.unreadCount, 1);
    await f.bob.request('/api/companion/inbox/read', 'POST', { projectId: project.id });
    assert.equal((await f.bob.request('/api/companion/inbox')).unreadCount, 0);
    assert.equal((await f.bob.request('/api/state')).projects.find(item => item.id === project.id).capture.originalText, body.text);
  } finally { await f.cleanup(); }
});

test('另一端离线时保存通知；服务重启后可补收，已读不会重新出现', async () => {
  const f = await fixture();
  try {
    const { project } = await f.alice.request('/api/companion/capture', 'POST', { clientId: 'capture-offline-001', text: '周末一起去海边走走。' });
    const cookie = f.bob.cookie;
    await f.stop(); await f.start();
    const reconnect = new core.GardenClient({ origin: f.origin, loadSession: () => cookie });
    const auth = await reconnect.request('/api/auth/state'); assert.equal(auth.user.id, f.b.id);
    assert.equal((await reconnect.request('/api/companion/inbox')).unreadCount, 1);
    await reconnect.request('/api/companion/inbox/read', 'POST', { projectId: project.id });
    await f.stop(); await f.start();
    const again = new core.GardenClient({ origin: f.origin, loadSession: () => cookie }); await again.request('/api/auth/state');
    assert.equal((await again.request('/api/companion/inbox')).unreadCount, 0);
    assert.equal((await again.request('/api/state')).projects[0].description, '周末一起去海边走走。');
  } finally { await f.cleanup(); }
});

test('真实 SSE 在新想法到来时唤醒后台收件；网页创建、回应也进入桌宠收件箱', async () => {
  const f = await fixture(); const controller = new AbortController(); let changed = 0;
  try {
    const watching = f.bob.events(controller.signal, () => { changed += 1; }).catch(error => { if (!controller.signal.aborted) throw error; });
    await eventually(() => assert.ok(changed >= 1)); const initial = changed;
    const { project } = await f.alice.request('/api/companion/capture', 'POST', { clientId: 'capture-stream-001', text: '一起写一本小册子。' });
    await eventually(() => assert.ok(changed > initial));
    await f.alice.request(`/api/projects/${project.id}/notes`, 'POST', { kind: 'comment', text: '第一页从海边开始。' });
    await f.alice.request(`/api/projects/${project.id}/consent`, 'POST', {});
    const inbox = await f.bob.request('/api/companion/inbox');
    assert.deepEqual(inbox.items.map(item => item.kind), ['consent', 'comment', 'idea']);
    await assert.rejects(f.alice.request(`/api/projects/${project.id}`, 'PATCH', { stage: 'active' }), error => error.status === 409);
    await f.bob.request(`/api/projects/${project.id}/consent`, 'POST', {});
    const result = await f.alice.request(`/api/projects/${project.id}`, 'PATCH', { stage: 'active', goal: '先完成第一页' });
    assert.equal(result.project.stage, 'active');
    controller.abort(); await watching;
  } finally { controller.abort(); await f.cleanup(); }
});

test('已删除模型聊天接口，想法始终直接保存原话', async () => {
  const f = await fixture();
  try {
    const { project } = await f.alice.request('/api/companion/capture', 'POST', { clientId: 'capture-direct-001', text: '共同话题直接记录，不需要助手。' });
    assert.equal(project.capture.aiState, 'original');
    assert.equal(project.description, '共同话题直接记录，不需要助手。');
    const result = await fetch(f.origin + '/api/companion/chat', { method:'POST', headers:{Cookie:f.alice.cookie,Origin:f.origin,'Content-Type':'application/json','X-CSRF-Token':f.alice.csrf}, body:JSON.stringify({messages:[]}) });
    assert.equal(result.status,404);
  } finally { await f.cleanup(); }
});

test('桌面桥接拒绝任意 URL、危险来源与非白名单 API；桌宠接口保留原有登录和 CSRF 保护', async () => {
  for (const url of ['file:///C:/secret', 'http://example.com', 'https://user:pass@example.com', 'https://example.com/api', 'javascript:alert(1)']) assert.throws(() => core.serverOrigin(url));
  assert.equal(core.serverOrigin('http://127.0.0.1:3210'), 'http://127.0.0.1:3210');
  assert.equal(core.allowedRequest('https://example.com/api/state', 'GET'), false);
  assert.equal(core.allowedRequest('/api/state?secret=1', 'GET'), false);
  assert.equal(core.allowedRequest('/api/projects/id', 'DELETE'), false);
  const f = await fixture();
  try {
    const anonymous = await fetch(f.origin + '/api/companion/inbox'); assert.equal(anonymous.status, 401);
    const badCSRF = await fetch(f.origin + '/api/companion/capture', { method: 'POST', headers: { Cookie: f.alice.cookie, Origin: f.origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId: 'capture-invalid-001', text: '不应保存' }) });
    assert.equal(badCSRF.status, 403); assert.equal((await f.alice.request('/api/state')).projects.length, 0);
    assert.equal(core.allowedRequest('/api/companion/chat', 'POST'), false);
  } finally { await f.cleanup(); }
});
