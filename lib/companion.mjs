import { randomUUID } from 'node:crypto';
import { HttpError, assertKeys, textField } from './security.mjs';
import { transaction } from './db.mjs';
import { createCompanionAI } from './companion-ai.mjs';

export function createCompanion({ db, project, users, getSession, requireAuth, requireMutation, requestBody, json, aiOptions }) {
  const ai = createCompanionAI(aiOptions);
  const streams = new Set();
  const pending = new Map();
  let closed = false;

  function changed(gardenId) {
    for (const stream of streams) {
      const live = getSession(stream.request);
      if (!live || live.garden_id !== stream.gardenId) { stream.response.end(); continue; }
      if (gardenId === stream.gardenId && !stream.response.destroyed) stream.response.write('event: changed\ndata: {}\n\n');
    }
  }

  function activity(actorId, projectId, kind) {
    const gardenId = db.prepare('SELECT garden_id FROM garden_members WHERE user_id = ?').get(actorId)?.garden_id;
    const item = project(projectId, gardenId);
    const now = new Date().toISOString();
    const insert = db.prepare('INSERT INTO companion_inbox (project_id, actor_id, recipient_id, kind, title, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    for (const person of users(gardenId)) if (person.id !== actorId) insert.run(projectId, actorId, person.id, kind, item.title, now);
    changed(gardenId);
  }

  function captureData(id) {
    const row = db.prepare('SELECT original_text, summary, ai_state FROM companion_captures WHERE project_id = ?').get(id);
    return row ? { originalText: row.original_text, summary: row.summary, aiState: row.ai_state } : null;
  }

  function organize(id, text, initialTitle) {
    if (!ai.configured || closed || pending.has(id)) return;
    const controller = new AbortController();
    pending.set(id, controller);
    Promise.resolve().then(() => ai.organize(text, controller.signal)).then(result => {
      if (closed) return;
      transaction(db, () => {
        const current = db.prepare('SELECT title FROM projects WHERE id = ?').get(id);
        if (!current) return;
        // Never overwrite the original text or a title that a person has changed.
        db.prepare("UPDATE companion_captures SET summary = ?, ai_state = 'ready' WHERE project_id = ?").run(result.summary, id);
        if (current.title === initialTitle) db.prepare('UPDATE projects SET title = ? WHERE id = ?').run(result.title, id);
      });
      changed(db.prepare('SELECT garden_id FROM projects WHERE id = ?').get(id)?.garden_id);
    }).catch(() => {
      if (!closed) {
        db.prepare("UPDATE companion_captures SET ai_state = 'failed' WHERE project_id = ? AND ai_state = 'pending'").run(id);
        changed(db.prepare('SELECT garden_id FROM projects WHERE id = ?').get(id)?.garden_id);
      }
    }).finally(() => pending.delete(id));
  }

  async function handle(request, response, pathname, session) {
    requireAuth(session);
    const method = request.method;
    if (pathname === '/api/companion/status' && method === 'GET') return json(response, 200, { ai: { configured: ai.configured } });
    if (pathname === '/api/companion/inbox' && method === 'GET') {
      const count = db.prepare('SELECT COUNT(*) AS count FROM companion_inbox WHERE recipient_id = ? AND read_at IS NULL').get(session.id).count;
      const rows = db.prepare('SELECT * FROM companion_inbox WHERE recipient_id = ? AND read_at IS NULL ORDER BY id DESC LIMIT 200').all(session.id);
      return json(response, 200, { unreadCount: count, items: rows.map(row => ({
        id: row.id, projectId: row.project_id, actorId: row.actor_id, kind: row.kind, title: row.title,
        createdAt: row.created_at, deliveredAt: row.delivered_at, readAt: row.read_at,
      })) });
    }
    if (pathname === '/api/companion/events' && method === 'GET') {
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      response.write('retry: 3000\nevent: ready\ndata: {}\n\n');
      const stream = { response, request, gardenId: session.garden_id };
      streams.add(stream);
      const heartbeat = setInterval(() => {
        const live = getSession(request);
        if (closed || !live || live.garden_id !== stream.gardenId) return response.end();
        response.write(': keep-alive\n\n');
      }, 15000);
      heartbeat.unref();
      response.once('close', () => { streams.delete(stream); clearInterval(heartbeat); });
      return;
    }
    if (pathname === '/api/companion/capture' && method === 'POST') {
      requireMutation(request, session);
      const body = await requestBody(request);
      assertKeys(body, ['text', 'clientId']);
      const text = textField(body.text, '想法', 4000);
      const clientId = textField(body.clientId, '记录标识', 80);
      if (!/^[a-zA-Z0-9_-]{12,80}$/.test(clientId)) throw new HttpError(400, '记录标识无效，请重新记录。');
      const previous = db.prepare('SELECT project_id, original_text FROM companion_captures WHERE author_id = ? AND client_id = ?').get(session.id, clientId);
      if (previous) {
        if (previous.original_text !== text) throw new HttpError(409, '这条记录的标识已使用，请重新发送。');
        return json(response, 200, { project: project(previous.project_id, session.garden_id), duplicate: true });
      }
      if (db.prepare('SELECT COUNT(*) AS count FROM projects WHERE garden_id = ?').get(session.garden_id).count >= 500) throw new HttpError(400, '小院已有 500 个想法，请先整理。');
      const id = randomUUID();
      const now = new Date().toISOString();
      const title = text.split(/[\r\n。！？!?]/u).find(line => line.trim())?.trim().slice(0, 60) || text.slice(0, 60);
      transaction(db, () => {
        db.prepare('INSERT INTO projects (id, title, description, author_id, created_at, updated_at, garden_id) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, title, text, session.id, now, now, session.garden_id);
        db.prepare('INSERT INTO companion_captures (project_id, author_id, client_id, original_text, ai_state) VALUES (?, ?, ?, ?, ?)').run(id, session.id, clientId, text, ai.configured ? 'pending' : 'original');
        activity(session.id, id, 'idea');
      });
      json(response, 201, { project: project(id, session.garden_id), duplicate: false });
      organize(id, text, title);
      return;
    }
    if (pathname === '/api/companion/inbox/delivered' && method === 'POST') {
      requireMutation(request, session);
      const body = await requestBody(request);
      assertKeys(body, ['ids']);
      if (!Array.isArray(body.ids) || body.ids.length > 200 || body.ids.some(id => !Number.isSafeInteger(id) || id < 1)) throw new HttpError(400, '收件标识无效。');
      const update = db.prepare('UPDATE companion_inbox SET delivered_at = COALESCE(delivered_at, ?) WHERE id = ? AND recipient_id = ?');
      transaction(db, () => { for (const id of new Set(body.ids)) update.run(new Date().toISOString(), id, session.id); });
      return json(response, 200, { ok: true });
    }
    if (pathname === '/api/companion/inbox/read' && method === 'POST') {
      requireMutation(request, session);
      const body = await requestBody(request);
      assertKeys(body, ['projectId']);
      const projectId = textField(body.projectId, '想法标识', 80);
      project(projectId, session.garden_id);
      const now = new Date().toISOString();
      db.prepare('UPDATE companion_inbox SET delivered_at = COALESCE(delivered_at, ?), read_at = ? WHERE project_id = ? AND recipient_id = ? AND read_at IS NULL').run(now, now, projectId, session.id);
      changed(session.garden_id);
      return json(response, 200, { ok: true });
    }
    if (pathname === '/api/companion/chat' && method === 'POST') {
      requireMutation(request, session);
      const body = await requestBody(request);
      assertKeys(body, ['messages', 'projectId']);
      if (!Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 12) throw new HttpError(400, '请提供最近 1 到 12 条对话。');
      const messages = body.messages.map(message => {
        assertKeys(message, ['role', 'content']);
        if (!['user', 'assistant'].includes(message.role)) throw new HttpError(400, '对话角色无效。');
        return { role: message.role, content: textField(message.content, '对话', 4000) };
      });
      const context = body.projectId ? project(textField(body.projectId, '想法标识', 80), session.garden_id) : db.prepare('SELECT title, goal FROM projects WHERE garden_id = ? ORDER BY updated_at DESC LIMIT 12').all(session.garden_id);
      if (!ai.configured) return json(response, 200, { generated: false, reply: '整理助手还没有连接。你可以直接点「记录并分享」，我会先把原话好好收进小花园。' });
      if (pending.has(`chat:${session.id}`)) throw new HttpError(429, '上一条还在回复，稍等一下。');
      const controller = new AbortController();
      pending.set(`chat:${session.id}`, controller);
      try {
        const reply = await ai.chat(messages, context, controller.signal);
        const live = !closed && getSession(request);
        if (live && live.garden_id === session.garden_id) return json(response, 200, { reply, generated: true });
        if (!closed) throw new HttpError(401, '登录已失效，请重新登录。');
      } catch (error) {
        if (error instanceof HttpError) throw error;
        if (!closed) throw new HttpError(503, '整理助手暂时没有回应，输入内容还在，你仍可以记录并分享。');
      } finally { pending.delete(`chat:${session.id}`); }
      return;
    }
    throw new HttpError(404, '找不到这个桌宠接口。');
  }

  // A stopped server cannot resume an interrupted provider call; the original survives.
  db.prepare("UPDATE companion_captures SET ai_state = 'failed' WHERE ai_state = 'pending'").run();
  return {
    handle, activity, changed, captureData,
    close() {
      closed = true;
      for (const controller of pending.values()) controller.abort();
      for (const { response } of streams) response.end();
    },
  };
}
