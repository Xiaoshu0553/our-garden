import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { request as httpRequest } from 'node:http';
import { createApp } from '../server.mjs';
import { createAccount, resetAccount } from '../lib/accounts.mjs';

const alicePassword = 'River-walks-Together-2026!';
const bobPassword = 'Slow-Sundays-Garden-2026!';
const configuredOrigin = 'http://garden.test';

describe('双人空间真实 HTTP 流程与权限', { concurrency: false }, () => {
  let dataDir;
  let publicDir;
  let app;
  let baseUrl;
  let alice;
  let bob;
  let aliceAccount;
  let bobAccount;

  async function start() {
    app = createApp({ dataDir, publicDir, publicOrigin: configuredOrigin, cookieSecure: false });
    app.listen(0, '127.0.0.1');
    await once(app, 'listening');
    baseUrl = `http://127.0.0.1:${app.address().port}`;
  }

  async function stop() {
    if (!app?.listening) return;
    const closed = once(app, 'close');
    app.close();
    app.closeIdleConnections();
    await closed;
  }

  function client() {
    return {
      cookie: '',
      csrf: '',
      async request(path, { method = 'GET', body, origin = configuredOrigin, csrf = this.csrf, cookie = this.cookie, rawBody, headers = {} } = {}) {
        const requestHeaders = { ...headers };
        if (origin !== null) requestHeaders.Origin = origin;
        if (cookie) requestHeaders.Cookie = cookie;
        if (csrf) requestHeaders['X-CSRF-Token'] = csrf;
        if (body !== undefined || rawBody !== undefined) requestHeaders['Content-Type'] ??= 'application/json';
        const response = await fetch(`${baseUrl}${path}`, {
          method,
          headers: requestHeaders,
          ...(body !== undefined || rawBody !== undefined ? { body: rawBody ?? JSON.stringify(body) } : {}),
          redirect: 'manual',
        });
        const text = await response.text();
        let data;
        try { data = text ? JSON.parse(text) : null; } catch { data = text; }
        return { response, status: response.status, data, text };
      },
      async login(name, password) {
        const result = await this.request('/api/auth/login', { method: 'POST', body: { name, password } });
        assert.equal(result.status, 200, `登录应成功：${result.text}`);
        const setCookie = result.response.headers.getSetCookie();
        assert.ok(setCookie.length, '登录必须设置会话 cookie');
        this.cookie = setCookie.map((value) => value.split(';')[0]).join('; ');
        this.csrf = result.data.csrfToken;
        assert.ok(this.csrf, '已登录状态必须提供 CSRF 令牌');
        return result;
      },
    };
  }

  async function projectFor(person, title = '一起探索一个新计划') {
    const result = await person.request('/api/projects', { method: 'POST', body: { title, description: '先聊清楚，再决定下一步。' } });
    assert.ok(result.status >= 200 && result.status < 300, `创建想法应成功：${result.text}`);
    assert.ok(result.data.project?.id);
    return result.data.project;
  }

  async function mutate(person, path, body, method = 'POST') {
    const result = await person.request(path, { method, ...(body !== undefined ? { body } : {}) });
    assert.ok(result.status >= 200 && result.status < 300, `${method} ${path} 应成功：${result.text}`);
    return result.data;
  }

  async function delayedPatch(person, path, body) {
    const encoded = JSON.stringify(body);
    let finish;
    let rejectResponse;
    const result = new Promise((resolve, reject) => {
      rejectResponse = reject;
      const request = httpRequest(`${baseUrl}${path}`, {
        method: 'PATCH',
        headers: { Origin: configuredOrigin, Cookie: person.cookie, 'X-CSRF-Token': person.csrf, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(encoded) },
      }, response => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', chunk => { text += chunk; });
        response.on('end', () => resolve({ status: response.statusCode, data: JSON.parse(text), text }));
      });
      request.on('error', reject);
      request.setTimeout(5000, () => request.destroy(new Error('delayed test request timed out')));
      request.write(encoded.slice(0, 1));
      finish = () => request.end(encoded.slice(1));
    });
    // Let the server admit this request while its JSON body is still streaming.
    await new Promise(resolve => setTimeout(resolve, 35));
    return { finish, result, rejectResponse };
  }

  function assertClientError(result, allowed = [400, 401, 403, 404, 409, 413, 422]) {
    assert.ok(allowed.includes(result.status), `应安全拒绝而非成功或服务器异常：${result.status} ${result.text}`);
    assert.equal(typeof result.data.error, 'string');
    assert.ok(result.data.error.length > 0);
    assert.doesNotMatch(result.text, /at .*\.mjs:\d+|SQLITE_CONSTRAINT|password_hash/);
  }

  before(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'our-garden-integration-'));
    publicDir = join(dataDir, 'public');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(publicDir);
    await writeFile(join(publicDir, 'index.html'), '<!doctype html><title>Integration garden</title><main>Our garden</main>', 'utf8');
    await start();
    aliceAccount = await createAccount(app.db, { name: '小树', password: alicePassword });
    bobAccount = await createAccount(app.db, { name: '小叶', password: bobPassword });
    alice = client();
    bob = client();
    await alice.login('小树', alicePassword);
    await bob.login('小叶', bobPassword);
  });

  after(async () => {
    await stop();
    if (dataDir && dirname(dataDir) === tmpdir() && basename(dataDir).startsWith('our-garden-integration-')) {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  test('匿名访问无法读取项目或写入内容，健康检查不泄露数据', async () => {
    const visitor = client();
    const state = await visitor.request('/api/auth/state');
    assert.equal(state.status, 200);
    assert.equal(state.data.user, null);
    assert.equal(state.data.setupRequired, false);
    assert.equal((await visitor.request('/api/state')).status, 401);
    assert.equal((await visitor.request('/api/projects', { method: 'POST', body: { title: '匿名想法' } })).status, 401);
    const health = await visitor.request('/healthz');
    assert.equal(health.status, 200);
    assert.deepEqual(health.data, { ok: true });
  });

  test('固定两个账户，数据库与公共响应均不保留或泄露明文密码', async () => {
    await assert.rejects(createAccount(app.db, { name: '第三人', password: 'Third-Person-Is-Not-Allowed!' }));
    const rows = app.db.prepare('SELECT * FROM users').all();
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.equal(typeof row.password_hash, 'string');
      assert.ok(row.password_hash.length > 40);
      assert.notEqual(row.password_hash, alicePassword);
      assert.notEqual(row.password_hash, bobPassword);
      assert.ok(!Object.hasOwn(row, 'password'));
    }
    const state = await alice.request('/api/state');
    assert.equal(state.status, 200);
    assert.equal(state.data.users.length, 2);
    assert.doesNotMatch(state.text, /password|scrypt|password_hash/);
    assert.ok(!state.text.includes(alicePassword));
    assert.ok(!state.text.includes(bobPassword));
  });

  test('登录会话使用 HttpOnly 且 SameSite 严格，私有响应禁止缓存', async () => {
    const person = client();
    const login = await person.login('小树', alicePassword);
    assert.match(login.response.headers.get('set-cookie'), /HttpOnly/i);
    assert.match(login.response.headers.get('set-cookie'), /SameSite=Strict/i);
    const state = await person.request('/api/auth/state');
    assert.equal(state.data.user.id, aliceAccount.id);
    assert.equal(state.data.user.name, '小树');
    assert.equal(state.data.csrfToken, person.csrf);
    assert.match(state.response.headers.get('cache-control'), /no-store/i);
    assert.match((await person.request('/api/state')).response.headers.get('cache-control'), /no-store/i);
  });

  test('登录与后续写入拒绝跨站请求，并拒绝缺失或错误 CSRF 令牌', async () => {
    const visitor = client();
    const credentials = { name: '小树', password: alicePassword };
    assertClientError(await visitor.request('/api/auth/login', { method: 'POST', origin: 'https://evil.invalid', body: credentials }), [403]);
    assertClientError(await visitor.request('/api/auth/login', { method: 'POST', origin: null, body: credentials }), [403]);
    const body = { title: '不应该写入' };
    assertClientError(await alice.request('/api/projects', { method: 'POST', origin: 'https://evil.invalid', body }), [403]);
    assertClientError(await alice.request('/api/projects', { method: 'POST', csrf: '', body }), [403]);
    assertClientError(await alice.request('/api/projects', { method: 'POST', csrf: 'wrong-token', body }), [403]);
  });

  test('一人的想法对另一人可见，输入作为文本保留且 SQL 字符串不影响存储', async () => {
    const title = '<img src=x onerror=alert(1)> 一起做计划';
    const project = await projectFor(alice, title);
    const state = await bob.request('/api/state');
    const found = state.data.projects.find((item) => item.id === project.id);
    assert.ok(found);
    assert.equal(found.title, title);
    assert.equal(found.authorId, aliceAccount.id);
    assert.equal(found.stage, 'idea');
    const sqlText = "旅行'); DROP TABLE users; --";
    await projectFor(alice, sqlText);
    assert.equal(app.db.prepare('SELECT COUNT(*) AS total FROM users').get().total, 2);
  });

  test('双方同意后想法才能进入探索和行动，原来的讨论完整保留', async () => {
    const project = await projectFor(alice, '一起做跨境电商的第一轮调研');
    const path = `/api/projects/${project.id}`;
    const note = await mutate(bob, `${path}/notes`, { kind: 'comment', text: '我想先弄清楚双方能投入多少时间。' });
    assert.equal(note.project.notes.length, 1);
    let result = await alice.request(path, { method: 'PATCH', body: { stage: 'active' } });
    assertClientError(result, [400, 403, 409, 422]);
    const oneConsent = await mutate(alice, `${path}/consent`);
    assert.deepEqual(oneConsent.project.consents, [aliceAccount.id]);
    assert.equal(oneConsent.project.stage, 'idea');
    result = await alice.request(path, { method: 'PATCH', body: { stage: 'active' } });
    assertClientError(result, [400, 403, 409, 422]);
    const bothConsent = await mutate(bob, `${path}/consent`);
    assert.equal(bothConsent.project.consents.length, 2);
    assert.equal(bothConsent.project.stage, 'exploring');
    const updated = await mutate(alice, path, { stage: 'active', goal: '完成第一轮调研，一起决定是否尝试。', nextReviewAt: '2026-12-01' }, 'PATCH');
    assert.equal(updated.project.stage, 'active');
    assert.equal(updated.project.goal, '完成第一轮调研，一起决定是否尝试。');
    assert.ok(updated.project.nextReviewAt.startsWith('2026-12-01'));
    assert.equal(updated.project.notes[0].text, '我想先弄清楚双方能投入多少时间。');
  });

  test('撤回同意保留项目与已有内容，后续跨阶段推进仍需要双方确认', async () => {
    const project = await projectFor(alice, '可以慢慢商量的计划');
    const path = `/api/projects/${project.id}`;
    await mutate(alice, `${path}/consent`);
    await mutate(bob, `${path}/consent`);
    await mutate(alice, path, { stage: 'active', goal: '留下讨论过程' }, 'PATCH');
    const withdrawn = await mutate(bob, `${path}/consent`);
    assert.equal(withdrawn.project.stage, 'active');
    assert.equal(withdrawn.project.goal, '留下讨论过程');
    assert.deepEqual(withdrawn.project.consents, [aliceAccount.id]);
    await mutate(alice, path, { stage: 'active', description: '同阶段的日常编辑继续可用。' }, 'PATCH');
    assertClientError(await alice.request(path, { method: 'PATCH', body: { stage: 'completed' } }), [400, 403, 409, 422]);
    await mutate(bob, `${path}/consent`);
    const completed = await mutate(alice, path, { stage: 'completed' }, 'PATCH');
    assert.equal(completed.project.stage, 'completed');
  });

  test('共同待办可分工、完成、更正和删除，只能分给现有住户', async () => {
    const project = await projectFor(alice, '整理下一小步');
    const path = `/api/projects/${project.id}`;
    const created = await mutate(alice, `${path}/tasks`, { text: '整理官方平台资料', assigneeId: bobAccount.id });
    const task = created.project.tasks[0];
    assert.equal(task.text, '整理官方平台资料');
    assert.equal(task.assigneeId, bobAccount.id);
    assert.equal(task.done, false);
    const done = await mutate(bob, `${path}/tasks/${task.id}`, { done: true }, 'PATCH');
    assert.equal(done.project.tasks[0].done, true);
    const edited = await mutate(alice, `${path}/tasks/${task.id}`, { text: '整理官方平台资料与问题', assigneeId: null, done: false }, 'PATCH');
    assert.equal(edited.project.tasks[0].assigneeId, null);
    assert.equal(edited.project.tasks[0].done, false);
    assertClientError(await alice.request(`${path}/tasks`, { method: 'POST', body: { text: '非法指派', assigneeId: 'someone-else' } }), [400, 404, 422]);
    assertClientError(await alice.request(`${path}/tasks/${task.id}`, { method: 'PATCH', body: { assigneeId: 'someone-else' } }), [400, 404, 422]);
    assertClientError(await alice.request(`${path}/tasks/${task.id}`, { method: 'PATCH', body: { done: 'yes' } }), [400, 422]);
    const removed = await mutate(bob, `${path}/tasks/${task.id}`, undefined, 'DELETE');
    assert.equal(removed.project.tasks.length, 0);
  });

  test('两个人同时编辑不同字段时，较慢的请求保留对方已经保存的内容', async () => {
    const created = await projectFor(alice, '两个人同时推进的计划');
    const path = `/api/projects/${created.id}`;
    const slowProject = await delayedPatch(alice, path, { description: '甲补充的想法说明' });
    await mutate(bob, path, { goal: '乙刚刚保存的共同目标' }, 'PATCH');
    slowProject.finish();
    const updatedProject = await slowProject.result;
    assert.equal(updatedProject.status, 200, updatedProject.text);
    assert.equal(updatedProject.data.project.goal, '乙刚刚保存的共同目标');
    assert.equal(updatedProject.data.project.description, '甲补充的想法说明');
    const taskCreated = await mutate(alice, `${path}/tasks`, { text: '最初的待办' });
    const taskId = taskCreated.project.tasks[0].id;
    const slowTask = await delayedPatch(alice, `${path}/tasks/${taskId}`, { done: true });
    await mutate(bob, `${path}/tasks/${taskId}`, { text: '乙重新写清楚的待办', assigneeId: bobAccount.id }, 'PATCH');
    slowTask.finish();
    const updatedTask = await slowTask.result;
    assert.equal(updatedTask.status, 200, updatedTask.text);
    assert.equal(updatedTask.data.project.tasks[0].done, true);
    assert.equal(updatedTask.data.project.tasks[0].text, '乙重新写清楚的待办');
    assert.equal(updatedTask.data.project.tasks[0].assigneeId, bobAccount.id);
  });

  test('讨论、共同决定与资料链接可保存，留言仅能由本人删除', async () => {
    const project = await projectFor(alice, '保留商量过程');
    const path = `/api/projects/${project.id}`;
    const comment = await mutate(bob, `${path}/notes`, { kind: 'comment', text: '我周末可以先做资料整理。' });
    const commentId = comment.project.notes.at(-1).id;
    const decision = await mutate(alice, `${path}/notes`, { kind: 'decision', text: '这轮先整理问题和资料，再一起决定下一步。' });
    assert.equal(decision.project.notes.filter((item) => item.kind === 'decision').length, 1);
    const resource = await mutate(alice, `${path}/notes`, { kind: 'resource', text: '参考资料', url: 'https://example.com/guide?topic=research' });
    const saved = resource.project.notes.find((item) => item.kind === 'resource');
    assert.equal(saved.url, 'https://example.com/guide?topic=research');
    assertClientError(await alice.request(`${path}/notes/${commentId}`, { method: 'DELETE' }), [403]);
    const removed = await mutate(bob, `${path}/notes/${commentId}`, undefined, 'DELETE');
    assert.equal(removed.project.notes.some((item) => item.id === commentId), false);
  });

  test('资源链接拒绝脚本、嵌入数据与带账号密码的 URL', async () => {
    const project = await projectFor(alice, '验证资料链接');
    for (const url of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'file:///etc/passwd', 'https://user:pass@example.com/private']) {
      assertClientError(await alice.request(`/api/projects/${project.id}/notes`, { method: 'POST', body: { kind: 'resource', text: '不安全链接', url } }), [400, 422]);
    }
    assertClientError(await alice.request(`/api/projects/${project.id}/notes`, { method: 'POST', body: { kind: 'invalid-kind', text: '错误分类' } }), [400, 422]);
  });

  test('非法状态、空标题、错误日期与损坏 JSON 被拒绝，服务器继续可用', async () => {
    const project = await projectFor(alice, '输入验证');
    assertClientError(await alice.request('/api/projects', { method: 'POST', body: { title: '   ' } }), [400, 422]);
    assertClientError(await alice.request('/api/projects', { method: 'POST', body: { title: 7 } }), [400, 422]);
    assertClientError(await alice.request(`/api/projects/${project.id}`, { method: 'PATCH', body: { stage: 'not-a-stage' } }), [400, 422]);
    assertClientError(await alice.request(`/api/projects/${project.id}`, { method: 'PATCH', body: { nextReviewAt: 'not-a-date' } }), [400, 422]);
    assertClientError(await alice.request('/api/projects', { method: 'POST', rawBody: '{broken' }), [400, 422]);
    assertClientError(await alice.request('/api/projects', { method: 'POST', body: { title: 'x'.repeat(2_000_000) } }), [400, 413, 422]);
    assert.equal((await alice.request('/api/state')).status, 200);
  });

  test('任务和留言不能通过另一个项目的路径访问或删除', async () => {
    const first = await projectFor(alice, '项目甲');
    const second = await projectFor(alice, '项目乙');
    const taskResult = await mutate(alice, `/api/projects/${first.id}/tasks`, { text: '属于甲的任务' });
    const taskId = taskResult.project.tasks[0].id;
    const noteResult = await mutate(alice, `/api/projects/${first.id}/notes`, { kind: 'comment', text: '属于甲的讨论' });
    const noteId = noteResult.project.notes[0].id;
    assertClientError(await alice.request(`/api/projects/${second.id}/tasks/${taskId}`, { method: 'PATCH', body: { done: true } }), [404]);
    assertClientError(await alice.request(`/api/projects/${second.id}/tasks/${taskId}`, { method: 'DELETE' }), [404]);
    assertClientError(await alice.request(`/api/projects/${second.id}/notes/${noteId}`, { method: 'DELETE' }), [404]);
    const state = (await alice.request('/api/state')).data;
    assert.equal(state.projects.find((item) => item.id === first.id).tasks[0].done, false);
    assert.equal(state.projects.find((item) => item.id === first.id).notes.length, 1);
  });

  test('仅发起人能删除项目，删除后相关任务与留言一并清理', async () => {
    const project = await projectFor(alice, '之后要删除的想法');
    await mutate(bob, `/api/projects/${project.id}/tasks`, { text: '共享待办' });
    await mutate(bob, `/api/projects/${project.id}/notes`, { kind: 'comment', text: '共享讨论' });
    assertClientError(await bob.request(`/api/projects/${project.id}`, { method: 'DELETE' }), [403]);
    const removed = await mutate(alice, `/api/projects/${project.id}`, undefined, 'DELETE');
    assert.equal(removed.ok, true);
    assert.equal((await bob.request('/api/state')).data.projects.some((item) => item.id === project.id), false);
    assertClientError(await alice.request(`/api/projects/${project.id}`, { method: 'PATCH', body: { title: '不能恢复已删除项目' } }), [404]);
  });

  test('登出销毁会话，重用旧 cookie 也不能重新读取私有内容', async () => {
    const person = client();
    await person.login('小树', alicePassword);
    await mutate(person, '/api/auth/logout');
    assert.equal((await person.request('/api/state')).status, 401);
    assert.equal((await person.request('/api/auth/state')).data.user, null);
  });

  test('修改密码要求当前密码，并使旧密码不能再登录', async () => {
    const person = client();
    await person.login('小叶', bobPassword);
    const changedPassword = 'New-Slow-Sundays-Garden-2026!';
    assertClientError(await person.request('/api/auth/me', { method: 'PATCH', body: { currentPassword: 'incorrect-password', newPassword: changedPassword } }), [400, 401, 403]);
    assertClientError(await person.request('/api/auth/me', { method: 'PATCH', body: { currentPassword: bobPassword, newPassword: 'short' } }), [400, 422]);
    await mutate(person, '/api/auth/me', { currentPassword: bobPassword, newPassword: changedPassword }, 'PATCH');
    const visitor = client();
    assert.equal((await visitor.request('/api/auth/login', { method: 'POST', body: { name: '小叶', password: bobPassword } })).status, 401);
    await visitor.login('小叶', changedPassword);
    await resetAccount(app.db, { name: '小叶', password: bobPassword });
    await bob.login('小叶', bobPassword);
  });

  test('未知 API 返回 JSON 错误，不以首页 HTML 掩盖接口错误', async () => {
    const result = await alice.request('/api/does-not-exist');
    assertClientError(result, [404]);
    assert.match(result.response.headers.get('content-type'), /application\/json/i);
    const page = await client().request('/');
    assert.equal(page.status, 200);
    assert.match(page.response.headers.get('content-type'), /text\/html/i);
    assert.equal(page.response.headers.get('x-content-type-options'), 'nosniff');
    const traversal = await client().request('/%2e%2e%2fserver.mjs');
    assert.ok(!traversal.text.includes('createServer('), '静态服务不得读取 public 外的源文件');
  });

  test('连续错误登录会被限流，避免无限猜测密码', async () => {
    const visitor = client();
    let limited = false;
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const result = await visitor.request('/api/auth/login', { method: 'POST', body: { name: '不存在的住户', password: 'Wrong-Password-Repeated-2026!' } });
      if (result.status === 429) {
        limited = true;
        break;
      }
      assert.equal(result.status, 401);
    }
    assert.equal(limited, true);
  });

  test('关闭并重新启动应用后，账号、想法、同意、目标、分工和讨论仍存在', async () => {
    const project = await projectFor(alice, '重启后仍在的小计划');
    const path = `/api/projects/${project.id}`;
    await mutate(alice, `${path}/consent`);
    await mutate(bob, `${path}/consent`);
    await mutate(alice, path, { stage: 'active', goal: '可靠地保存我们的进展' }, 'PATCH');
    await mutate(bob, `${path}/tasks`, { text: '备份并验证恢复', assigneeId: bobAccount.id });
    await mutate(alice, `${path}/notes`, { kind: 'decision', text: '先保存好，再开始下一步。' });
    await stop();
    await start();
    alice = client();
    bob = client();
    await alice.login('小树', alicePassword);
    await bob.login('小叶', bobPassword);
    const state = (await bob.request('/api/state')).data;
    const saved = state.projects.find((item) => item.id === project.id);
    assert.ok(saved);
    assert.equal(saved.stage, 'active');
    assert.equal(saved.goal, '可靠地保存我们的进展');
    assert.equal(saved.consents.length, 2);
    assert.equal(saved.tasks[0].assigneeId, bobAccount.id);
    assert.equal(saved.notes[0].kind, 'decision');
    assert.equal(state.users.length, 2);
  });
});
