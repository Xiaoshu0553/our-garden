import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat, realpath } from 'node:fs/promises';
import { dirname, resolve, join, extname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { openDatabase, transaction } from './lib/db.mjs';
import { createCompanion } from './lib/companion.mjs';
import { createInvitation, gardenFor, joinGarden, registerAccount } from './lib/gardens.mjs';
import { archivesFor, archiveFor, unlinkGarden } from './lib/archives.mjs';
import { createDesktopReleases } from './lib/desktop-releases.mjs';
import {
  HttpError, RateLimiter, assertKeys, equalTokens, hashPassword, resourceUrl,
  reviewDate, secretToken, textField, tokenHash, validateName, validatePassword, verifyPassword,
} from './lib/security.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const stages = ['idea', 'exploring', 'active', 'completed', 'paused'];
const noteKinds = ['comment', 'decision', 'resource'];
const cookieName = 'garden_session';
const maximumBodyBytes = 64 * 1024;
const uuidPattern = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const projectRoute = new RegExp(`^/api/projects/(${uuidPattern})$`, 'i');
const consentRoute = new RegExp(`^/api/projects/(${uuidPattern})/consent$`, 'i');
const tasksRoute = new RegExp(`^/api/projects/(${uuidPattern})/tasks$`, 'i');
const taskRoute = new RegExp(`^/api/projects/(${uuidPattern})/tasks/(${uuidPattern})$`, 'i');
const notesRoute = new RegExp(`^/api/projects/(${uuidPattern})/notes$`, 'i');
const noteRoute = new RegExp(`^/api/projects/(${uuidPattern})/notes/(${uuidPattern})$`, 'i');

function environmentBoolean(value, fallback = false) {
  if (value === undefined || value === '') return fallback;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  throw new Error('COOKIE_SECURE 必须为 true 或 false。');
}

function configuredOrigin(value) {
  if (!value) return null;
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('PUBLIC_ORIGIN 必须是完整的网站来源，例如 https://garden.example.com。');
  }
  return url.origin;
}

function securityHeaders(response) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; media-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
}

function noCache(response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Pragma', 'no-cache');
  response.setHeader('Vary', 'Cookie');
}

function json(response, status, value) {
  if (response.destroyed) return;
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

async function parseRequestBody(request) {
  const length = Number(request.headers['content-length']);
  if (Number.isFinite(length) && length > maximumBodyBytes) {
    request.resume();
    throw new HttpError(413, '内容过长，请缩短后再保存。');
  }
  if (request.headers['content-encoding'] && request.headers['content-encoding'] !== 'identity') {
    request.resume();
    throw new HttpError(415, '不支持压缩的请求内容。');
  }
  return new Promise((fulfill, reject) => {
    let size = 0;
    const chunks = [];
    let settled = false;
    function fail(error) {
      if (settled) return;
      settled = true;
      chunks.length = 0;
      reject(error);
    }
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > maximumBodyBytes) return fail(new HttpError(413, '内容过长，请缩短后再保存。'));
      if (!settled) chunks.push(chunk);
    });
    request.on('error', () => fail(new HttpError(400, '请求传输中断，请重新尝试。')));
    request.on('aborted', () => fail(new HttpError(400, '请求传输中断，请重新尝试。')));
    request.on('end', () => {
      if (settled) return;
      settled = true;
      if (size === 0) return fulfill({});
      const contentType = String(request.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
      if (contentType !== 'application/json') return reject(new HttpError(415, '请使用 JSON 格式提交内容。'));
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
        fulfill(body);
      } catch { reject(new HttpError(400, '请求内容不是有效的 JSON 对象。')); }
    });
  });
}

export function createApp(options = {}) {
  const dataDir = resolve(options.dataDir ?? process.env.DATA_DIR ?? join(root, 'data'));
  const publicDir = resolve(options.publicDir ?? join(root, 'public'));
  const publicOrigin = configuredOrigin(options.publicOrigin ?? process.env.PUBLIC_ORIGIN);
  const cookieSecure = options.cookieSecure ?? environmentBoolean(process.env.COOKIE_SECURE, publicOrigin?.startsWith('https:') ?? false);
  const sessionTtlMs = options.sessionTtlMs ?? 14 * 24 * 60 * 60 * 1000;
  if (!Number.isSafeInteger(sessionTtlMs) || sessionTtlMs < 1000) throw new Error('sessionTtlMs 必须是不小于 1000 的整数。');
  const db = openDatabase(dataDir);
  const loginLimiter = new RateLimiter(options.loginRateLimit);
  const profileLimiter = new RateLimiter({ perAccount: 10, perIp: 20, global: 40 });
  const registrationLimiter = new RateLimiter(options.registrationRateLimit ?? { perAccount: 5, perIp: 10, global: 30 });
  const invitationLimiter = new RateLimiter({ perAccount: 10, perIp: 20, global: 60 });
  let passwordOperations = 0;
  let lastSessionCleanup = 0;

  async function passwordOperation(action) {
    if (passwordOperations >= 2) throw new HttpError(429, '正在验证账号，请稍后再试。');
    passwordOperations += 1;
    try { return await action(); } finally { passwordOperations -= 1; }
  }

  function getSession(request) {
    const now = Date.now();
    if (now - lastSessionCleanup > 60_000) {
      db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
      lastSessionCleanup = now;
    }
    const matches = String(request.headers.cookie ?? '').split(';').map((piece) => piece.trim()).filter((piece) => piece.startsWith(`${cookieName}=`));
    if (matches.length !== 1) return null;
    const token = matches[0].slice(cookieName.length + 1);
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const row = db.prepare(`SELECT sessions.token_hash, sessions.csrf_token, sessions.expires_at,
      users.id, users.name, garden_members.garden_id FROM sessions JOIN users ON users.id = sessions.user_id
      JOIN garden_members ON garden_members.user_id = users.id
      WHERE sessions.token_hash = ? AND sessions.expires_at > ?`).get(tokenHash(token), now);
    return row ?? null;
  }

  function authState(session) {
    const setupRequired = db.prepare('SELECT COUNT(*) AS count FROM users').get().count === 0;
    return {
      setupRequired,
      user: session ? { id: session.id, name: session.name } : null,
      registrationEnabled: true,
      ...(session ? { garden: gardenFor(db, session.id) } : {}),
      ...(session ? { csrfToken: session.csrf_token } : {}),
    };
  }

  function setCookie(response, token, ttlSeconds) {
    response.setHeader('Set-Cookie', `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${ttlSeconds}${cookieSecure ? '; Secure' : ''}`);
  }

  async function requestBody(request) {
    const before = getSession(request);
    const body = await parseRequestBody(request);
    if (before) {
      const after = getSession(request);
      if (!after || before.id !== after.id || before.garden_id !== after.garden_id || before.token_hash !== after.token_hash) {
        throw new HttpError(401, '账号或小花园已更新，请重新打开后再试。');
      }
    }
    return body;
  }

  function startSession(response, user) {
    const token = secretToken();
    const csrfToken = secretToken();
    const expiry = Date.now() + sessionTtlMs;
    db.prepare('INSERT INTO sessions (token_hash, user_id, csrf_token, expires_at) VALUES (?, ?, ?, ?)')
      .run(tokenHash(token), user.id, csrfToken, expiry);
    setCookie(response, token, Math.floor(sessionTtlMs / 1000));
    return { ...user, csrf_token: csrfToken, token_hash: tokenHash(token), expires_at: expiry };
  }

  function sameOrigin(request) {
    let expected = publicOrigin;
    if (!expected) {
      const host = request.headers.host;
      if (typeof host !== 'string' || /[\s/\\@?#]/.test(host)) throw new HttpError(403, '请求来源无效。');
      try { expected = new URL(`${cookieSecure || request.socket.encrypted ? 'https' : 'http'}://${host}`).origin; }
      catch { throw new HttpError(403, '请求来源无效。'); }
    }
    if (request.headers.origin !== expected || request.headers['sec-fetch-site'] === 'cross-site') {
      throw new HttpError(403, '请求来源无效，请在小家页面中操作。');
    }
  }

  function requireAuth(session) {
    if (!session) throw new HttpError(401, '请先登录你们的小家。');
    return session;
  }

  function requireMutation(request, session) {
    requireAuth(session);
    sameOrigin(request);
    if (!equalTokens(request.headers['x-csrf-token'], session.csrf_token)) {
      throw new HttpError(403, '页面验证已失效，请刷新页面后重试。');
    }
  }

  function users(gardenId) {
    return db.prepare('SELECT u.id, u.name FROM users u JOIN garden_members m ON m.user_id = u.id WHERE m.garden_id = ? ORDER BY u.created_at, u.id').all(gardenId).map(({ id, name }) => ({ id, name }));
  }

  function project(id, gardenId) {
    const row = db.prepare('SELECT * FROM projects WHERE id = ? AND garden_id = ?').get(id, gardenId);
    if (!row) throw new HttpError(404, '找不到这件一起想做的事。');
    return {
      id: row.id, title: row.title, description: row.description, stage: row.stage,
      authorId: row.author_id, goal: row.goal, nextReviewAt: row.next_review_at,
      createdAt: row.created_at, updatedAt: row.updated_at,
      ...(companion.captureData(id) ? { capture: companion.captureData(id) } : {}),
      consents: db.prepare('SELECT user_id FROM consents WHERE project_id = ? ORDER BY user_id').all(id).map((item) => item.user_id),
      tasks: db.prepare('SELECT id, text, assignee_id, done FROM tasks WHERE project_id = ? ORDER BY created_at, id').all(id)
        .map((item) => ({ id: item.id, text: item.text, assigneeId: item.assignee_id, done: Boolean(item.done) })),
      notes: db.prepare('SELECT id, kind, text, url, author_id, created_at FROM notes WHERE project_id = ? ORDER BY created_at, id').all(id)
        .map((item) => ({ id: item.id, kind: item.kind, text: item.text, ...(item.url ? { url: item.url } : {}), authorId: item.author_id, createdAt: item.created_at })),
    };
  }

  function bothConsented(id) {
    return db.prepare('SELECT COUNT(*) AS count FROM garden_members WHERE garden_id = (SELECT garden_id FROM projects WHERE id = ?)').get(id).count === 2
      && db.prepare('SELECT COUNT(*) AS count FROM consents WHERE project_id = ?').get(id).count === 2;
  }

  function touch(id) { db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), id); }

  function assignee(value, gardenId) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value !== 'string' || !db.prepare('SELECT user_id FROM garden_members WHERE user_id = ? AND garden_id = ?').get(value, gardenId)) {
      throw new HttpError(400, '只能选择你们两人中的一位作为负责人。');
    }
    return value;
  }

  const companion = createCompanion({ db, project, users, getSession, requireAuth, requireMutation, requestBody, json });
  const releases = createDesktopReleases({ filename: join(dataDir,'desktop-release.json'), changed: version => companion.release(version), pollMs: options.releasePollMs ?? 5000 });

  async function api(request, response, pathname) {
    noCache(response);
    const method = request.method;
    const session = getSession(request);
    if (pathname === '/api/desktop/release' && method === 'GET') return json(response, 200, { release: releases.current() });
    if (pathname === '/api/auth/state' && method === 'GET') return json(response, 200, authState(session));
    if (pathname.startsWith('/api/companion/')) return companion.handle(request, response, pathname, session);

    if (pathname === '/api/auth/register' && method === 'POST') {
      sameOrigin(request);
      if (session) throw new HttpError(409, '你已经登录了，创建其他账号前请先退出。');
      const body = await requestBody(request);
      assertKeys(body, ['name', 'password', 'passwordConfirmation', 'inviteCode']);
      const name = validateName(body.name);
      validatePassword(body.password);
      if (body.passwordConfirmation !== body.password) throw new HttpError(400, '两次密码不一致，请再检查一下。');
      registrationLimiter.consume(request.socket.remoteAddress ?? 'unknown', name);
      const user = await passwordOperation(() => registerAccount(db, { ...body, name }));
      const auth = authState(startSession(response, user));
      companion.changed(auth.garden.id);
      return json(response, 201, auth);
    }

    if (pathname === '/api/garden' && method === 'GET') {
      requireAuth(session);
      return json(response, 200, { garden: gardenFor(db, session.id) });
    }
    if (pathname === '/api/garden/unlink' && method === 'POST') {
      requireMutation(request, session);
      const body = await requestBody(request);
      assertKeys(body, ['confirm']);
      if (body.confirm !== true) throw new HttpError(400, '请先确认解除绑定及记录保留方式。');
      const result = unlinkGarden(db, session.id);
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(session.id);
      const auth = authState(startSession(response, { id: session.id, name: session.name }));
      companion.changed(result.previousGardenId);
      for (const id of result.gardenIds) companion.changed(id);
      return json(response, 200, auth);
    }
    const archiveMatch = pathname.match(/^\/api\/garden\/archives\/([a-zA-Z0-9-]{1,80})$/);
    if (archiveMatch && method === 'GET') {
      requireAuth(session);
      return json(response, 200, { archive: archiveFor(db, session.id, archiveMatch[1], project) });
    }
    if (pathname === '/api/garden/invite' && method === 'POST') {
      requireMutation(request, session);
      const body = await requestBody(request);
      assertKeys(body, [], { allowEmpty: true });
      invitationLimiter.consume(request.socket.remoteAddress ?? 'unknown', session.id);
      return json(response, 201, { invite: createInvitation(db, session.id) });
    }
    if (pathname === '/api/garden/join' && method === 'POST') {
      requireMutation(request, session);
      const body = await requestBody(request);
      assertKeys(body, ['code', 'shareExisting']);
      invitationLimiter.consume(request.socket.remoteAddress ?? 'unknown', session.id);
      const result = joinGarden(db, session.id, body);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(session.id);
      const auth = authState(startSession(response, session));
      companion.changed(result.previousGardenId);
      companion.changed(result.garden.id);
      return json(response, 200, auth);
    }

    if (pathname === '/api/auth/login' && method === 'POST') {
      sameOrigin(request);
      const body = await requestBody(request);
      assertKeys(body, ['name', 'password']);
      const name = validateName(body.name);
      if (typeof body.password !== 'string' || body.password.length > 256 || body.password.includes('\0')) throw new HttpError(400, '密码格式不正确。');
      loginLimiter.consume(request.socket.remoteAddress ?? 'unknown', name);
      const user = db.prepare('SELECT id, name, password_hash FROM users WHERE name = ? COLLATE NOCASE').get(name);
      const valid = await passwordOperation(() => verifyPassword(body.password, user?.password_hash));
      if (!valid || !user) throw new HttpError(401, '昵称或密码不正确。');
      const current = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id);
      if (current?.password_hash !== user.password_hash) throw new HttpError(401, '账号信息已更新，请重新登录。');
      if (session) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(session.token_hash);
      return json(response, 200, authState(startSession(response, user)));
    }

    if (pathname === '/api/auth/logout' && method === 'POST') {
      requireMutation(request, session);
      const body = await requestBody(request);
      assertKeys(body, [], { allowEmpty: true });
      db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(session.token_hash);
      setCookie(response, '', 0);
      return json(response, 200, { ok: true });
    }

    if (pathname === '/api/auth/me' && method === 'PATCH') {
      requireMutation(request, session);
      const body = await requestBody(request);
      assertKeys(body, ['name', 'currentPassword', 'newPassword']);
      if (body.name === undefined && body.newPassword === undefined) throw new HttpError(400, '请填写新昵称或新密码。');
      const name = body.name === undefined ? session.name : validateName(body.name);
      const nameTaken = db.prepare('SELECT id FROM users WHERE name = ? COLLATE NOCASE AND id != ?').get(name, session.id);
      if (nameTaken) throw new HttpError(409, '这个昵称已经有人使用了。');
      let passwordHash;
      if (body.newPassword !== undefined) {
        validatePassword(body.newPassword);
        if (typeof body.currentPassword !== 'string' || body.currentPassword.length > 256) throw new HttpError(400, '修改密码时请填写当前密码。');
        profileLimiter.consume(request.socket.remoteAddress ?? 'unknown', session.id);
        const current = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(session.id);
        passwordHash = await passwordOperation(async () => {
          if (!await verifyPassword(body.currentPassword, current.password_hash)) throw new HttpError(401, '当前密码不正确。');
          return hashPassword(body.newPassword);
        });
        if (!getSession(request)) throw new HttpError(401, '登录已失效，请重新登录。');
      }
      transaction(db, () => {
        if (passwordHash) {
          db.prepare('UPDATE users SET name = ?, password_hash = ? WHERE id = ?').run(name, passwordHash, session.id);
          db.prepare('DELETE FROM sessions WHERE user_id = ?').run(session.id);
        } else db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, session.id);
      });
      const updated = passwordHash ? startSession(response, { id: session.id, name }) : { ...session, name };
      return json(response, 200, authState(updated));
    }

    if (pathname === '/api/state' && method === 'GET') {
      requireAuth(session);
      const ids = db.prepare('SELECT id FROM projects WHERE garden_id = ? ORDER BY updated_at DESC, id').all(session.garden_id);
      return json(response, 200, { users: users(session.garden_id), garden: gardenFor(db, session.id), archives: archivesFor(db, session.id), projects: ids.map((item) => project(item.id, session.garden_id)) });
    }

    if (pathname === '/api/projects' && method === 'POST') {
      requireMutation(request, session);
      const body = await requestBody(request);
      assertKeys(body, ['title', 'description']);
      const title = textField(body.title, '标题', 120);
      const description = textField(body.description ?? '', '想法说明', 4000, { allowEmpty: true });
      if (db.prepare('SELECT COUNT(*) AS count FROM projects WHERE garden_id = ?').get(session.garden_id).count >= 500) throw new HttpError(400, '小家已保存 500 件想做的事，请先整理后再添加。');
      const id = randomUUID();
      const now = new Date().toISOString();
      transaction(db, () => {
        db.prepare('INSERT INTO projects (id, title, description, author_id, created_at, updated_at, garden_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(id, title, description, session.id, now, now, session.garden_id);
        companion.activity(session.id, id, 'idea');
      });
      return json(response, 201, { project: project(id, session.garden_id) });
    }

    let match;
    if ((match = pathname.match(projectRoute))) {
      requireAuth(session);
      const id = match[1];
      if (method === 'GET') return json(response, 200, { project: project(id, session.garden_id) });
      if (method === 'PATCH') {
        requireMutation(request, session);
        const body = await requestBody(request);
        assertKeys(body, ['title', 'description', 'stage', 'goal', 'nextReviewAt']);
        // Read current fields after the asynchronous request body. A slow upload
        // must not overwrite fields the other member saved in the meantime.
        const original = project(id, session.garden_id);
        const title = body.title === undefined ? original.title : textField(body.title, '标题', 120);
        const description = body.description === undefined ? original.description : textField(body.description, '想法说明', 4000, { allowEmpty: true });
        const goal = body.goal === undefined ? original.goal : textField(body.goal, '共同目标', 4000, { allowEmpty: true });
        const nextReviewAt = body.nextReviewAt === undefined ? original.nextReviewAt : reviewDate(body.nextReviewAt);
        const stage = body.stage === undefined ? original.stage : body.stage;
        if (!stages.includes(stage)) throw new HttpError(400, '请选择有效的项目阶段。');
        if (stage !== original.stage && ['exploring', 'active', 'completed'].includes(stage) && !bothConsented(id)) {
          throw new HttpError(409, '需要两个人都确认想一起做，才能进入这个阶段。');
        }
        transaction(db, () => {
          db.prepare('UPDATE projects SET title = ?, description = ?, stage = ?, goal = ?, next_review_at = ?, updated_at = ? WHERE id = ?')
            .run(title, description, stage, goal, nextReviewAt, new Date().toISOString(), id);
          companion.activity(session.id, id, 'update');
        });
        return json(response, 200, { project: project(id, session.garden_id) });
      }
      if (method === 'DELETE') {
        requireMutation(request, session);
        const body = await requestBody(request);
        assertKeys(body, [], { allowEmpty: true });
        if (project(id, session.garden_id).authorId !== session.id) throw new HttpError(403, '只有发起这件事的人可以删除它。');
        db.prepare('DELETE FROM projects WHERE id = ?').run(id);
        companion.changed(session.garden_id);
        return json(response, 200, { ok: true });
      }
      throw new HttpError(405, '这个接口不支持当前操作。');
    }

    if ((match = pathname.match(consentRoute)) && method === 'POST') {
      requireMutation(request, session);
      const id = match[1];
      const body = await requestBody(request);
      assertKeys(body, [], { allowEmpty: true });
      project(id, session.garden_id);
      transaction(db, () => {
        const consent = db.prepare('SELECT user_id FROM consents WHERE project_id = ? AND user_id = ?').get(id, session.id);
        if (consent) db.prepare('DELETE FROM consents WHERE project_id = ? AND user_id = ?').run(id, session.id);
        else db.prepare('INSERT INTO consents (project_id, user_id) VALUES (?, ?)').run(id, session.id);
        if (bothConsented(id)) db.prepare("UPDATE projects SET stage = 'exploring' WHERE id = ? AND stage = 'idea'").run(id);
        touch(id);
        companion.activity(session.id, id, 'consent');
      });
      return json(response, 200, { project: project(id, session.garden_id) });
    }

    if ((match = pathname.match(tasksRoute)) && method === 'POST') {
      requireMutation(request, session);
      const projectId = match[1];
      const body = await requestBody(request);
      assertKeys(body, ['text', 'assigneeId']);
      project(projectId, session.garden_id);
      const text = textField(body.text, '待办', 300);
      const assigneeId = assignee(body.assigneeId, session.garden_id);
      if (db.prepare('SELECT COUNT(*) AS count FROM tasks WHERE project_id = ?').get(projectId).count >= 200) throw new HttpError(400, '一件事最多保存 200 条待办，请先整理。');
      transaction(db, () => {
        db.prepare('INSERT INTO tasks (id, project_id, text, assignee_id, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(randomUUID(), projectId, text, assigneeId, new Date().toISOString());
        touch(projectId);
        companion.activity(session.id, projectId, 'task');
      });
      return json(response, 201, { project: project(projectId, session.garden_id) });
    }

    if ((match = pathname.match(taskRoute)) && ['PATCH', 'DELETE'].includes(method)) {
      requireMutation(request, session);
      const [, projectId, taskId] = match;
      const body = await requestBody(request);
      project(projectId, session.garden_id);
      const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND project_id = ?').get(taskId, projectId);
      if (!task) throw new HttpError(404, '找不到这条待办。');
      if (method === 'DELETE') {
        assertKeys(body, [], { allowEmpty: true });
        transaction(db, () => { db.prepare('DELETE FROM tasks WHERE id = ? AND project_id = ?').run(taskId, projectId); touch(projectId); companion.activity(session.id, projectId, 'task'); });
      } else {
        assertKeys(body, ['text', 'assigneeId', 'done']);
        const text = body.text === undefined ? task.text : textField(body.text, '待办', 300);
        const assigneeId = body.assigneeId === undefined ? task.assignee_id : assignee(body.assigneeId, session.garden_id);
        if (body.done !== undefined && typeof body.done !== 'boolean') throw new HttpError(400, '待办完成状态需为 true 或 false。');
        const done = body.done === undefined ? task.done : Number(body.done);
        transaction(db, () => {
          db.prepare('UPDATE tasks SET text = ?, assignee_id = ?, done = ? WHERE id = ? AND project_id = ?').run(text, assigneeId, done, taskId, projectId);
          touch(projectId);
          companion.activity(session.id, projectId, 'task');
        });
      }
      return json(response, 200, { project: project(projectId, session.garden_id) });
    }

    if ((match = pathname.match(notesRoute)) && method === 'POST') {
      requireMutation(request, session);
      const projectId = match[1];
      const body = await requestBody(request);
      assertKeys(body, ['kind', 'text', 'url']);
      project(projectId, session.garden_id);
      if (!noteKinds.includes(body.kind)) throw new HttpError(400, '请选择讨论、决定或资料作为记录类型。');
      const text = textField(body.text, '记录', 8000);
      const url = resourceUrl(body.url);
      if (db.prepare('SELECT COUNT(*) AS count FROM notes WHERE project_id = ?').get(projectId).count >= 1000) throw new HttpError(400, '一件事最多保存 1000 条记录，请先整理。');
      transaction(db, () => {
        db.prepare('INSERT INTO notes (id, project_id, kind, text, url, author_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(randomUUID(), projectId, body.kind, text, url, session.id, new Date().toISOString());
        touch(projectId);
        companion.activity(session.id, projectId, 'comment');
      });
      return json(response, 201, { project: project(projectId, session.garden_id) });
    }

    if ((match = pathname.match(noteRoute)) && method === 'DELETE') {
      requireMutation(request, session);
      const [, projectId, noteId] = match;
      const body = await requestBody(request);
      project(projectId, session.garden_id);
      const note = db.prepare('SELECT author_id FROM notes WHERE id = ? AND project_id = ?').get(noteId, projectId);
      if (!note) throw new HttpError(404, '找不到这条记录。');
      if (note.author_id !== session.id) throw new HttpError(403, '只能删除自己写下的记录。');
      assertKeys(body, [], { allowEmpty: true });
      transaction(db, () => { db.prepare('DELETE FROM notes WHERE id = ? AND project_id = ?').run(noteId, projectId); touch(projectId); companion.changed(session.garden_id); });
      return json(response, 200, { project: project(projectId, session.garden_id) });
    }

    if (pathname.startsWith('/api/')) {
      requireAuth(session);
      throw new HttpError(404, '找不到这个接口。');
    }
    throw new HttpError(404, '找不到这个接口。');
  }

  const mimeTypes = {
    '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif',
    '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
    '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.txt': 'text/plain; charset=utf-8',
  };

  async function staticFile(request, response, pathname) {
    if (!['GET', 'HEAD'].includes(request.method)) throw new HttpError(405, '这个地址不支持当前操作。');
    if (pathname.includes('\\') || pathname.includes('\0') || pathname.split('/').some((part) => part.startsWith('.'))) throw new HttpError(404, '找不到这个页面。');
    let filename = resolve(publicDir, `.${pathname}`);
    if (filename !== publicDir && !filename.startsWith(`${publicDir}${sep}`)) throw new HttpError(404, '找不到这个页面。');
    let info;
    try { info = await stat(filename); } catch { /* handled by the SPA fallback */ }
    if (info?.isDirectory()) {
      filename = join(filename, 'index.html');
      try { info = await stat(filename); } catch { info = null; }
    }
    if (!info?.isFile()) {
      if (request.method !== 'GET' || extname(pathname)) throw new HttpError(404, '找不到这个文件。');
      filename = join(publicDir, 'index.html');
      try { info = await stat(filename); } catch { throw new HttpError(404, '页面尚未准备好。'); }
    }
    const actualRoot = await realpath(publicDir);
    const actualFile = await realpath(filename);
    if (!actualFile.startsWith(`${actualRoot}${sep}`)) throw new HttpError(404, '找不到这个文件。');
    const contentType = mimeTypes[extname(filename).toLowerCase()];
    if (!contentType) throw new HttpError(404, '找不到这个文件。');
    response.writeHead(200, {
      'Content-Type': contentType, 'Content-Length': info.size,
      'Cache-Control': ['.html', '.js', '.mjs', '.css'].includes(extname(filename)) ? 'no-cache' : 'public, max-age=3600',
    });
    if (request.method === 'HEAD') return response.end();
    const stream = createReadStream(actualFile);
    stream.on('error', () => response.destroy());
    stream.pipe(response);
  }

  const server = createServer((request, response) => {
    securityHeaders(response);
    (async () => {
      let url;
      try { url = new URL(request.url, 'http://localhost'); } catch { throw new HttpError(400, '地址格式不正确。'); }
      let pathname;
      try { pathname = decodeURIComponent(url.pathname); } catch { throw new HttpError(400, '地址格式不正确。'); }
      if (pathname === '/healthz') {
        noCache(response);
        if (request.method !== 'GET') throw new HttpError(405, '这个接口只支持读取。');
        return json(response, 200, { ok: true });
      }
      if (pathname === '/api' || pathname.startsWith('/api/')) return api(request, response, pathname);
      return staticFile(request, response, pathname);
    })().catch((error) => {
      if (response.headersSent) return response.destroy();
      noCache(response);
      if (error instanceof HttpError) {
        if (error.status === 429) response.setHeader('Retry-After', '60');
        return json(response, error.status, { error: error.message });
      }
      // Do not expose queries, passwords, session tokens or file paths in responses/logs.
      console.error('小家请求处理失败。', error?.code ?? error?.name ?? 'Error');
      return json(response, 500, { error: '暂时没能保存，请稍后再试。' });
    });
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxRequestsPerSocket = 1000;
  server.db = db;
  server.garden = { dataDir, publicDir, publicOrigin, cookieSecure };
  const close = server.close.bind(server);
  server.close = (...args) => { releases.close(); companion.close(); return close(...args); };
  server.once('close', () => db.close());
  return server;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? '127.0.0.1';
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 必须是 1 到 65535 之间的整数。');
  const app = createApp();
  app.listen(port, host, () => console.log(`小家已启动：http://${host.includes(':') ? `[${host}]` : host}:${port}`));
  app.on('error', (error) => { console.error('小家启动失败：', error.code ?? error.name); process.exitCode = 1; });
  let shuttingDown = false;
  function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    app.close(() => { process.exitCode = 0; });
    const timer = setTimeout(() => { app.closeAllConnections(); }, 10_000);
    timer.unref();
  }
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
