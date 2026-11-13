// Shared by the packaged desktop and the browser preview. This is explicitly a
// local experience space, never an authentication path in the production server.
export const demoUsers = [{ id: 'demo-tree', name: '小树' }, { id: 'demo-rain', name: '小雨' }];

export function seedDemo() {
  const now = new Date().toISOString();
  const make = (id, title, description, authorId, extra = {}) => ({ id, title, description, authorId, stage: 'idea', goal: '', nextReviewAt: null, consents: [], tasks: [], notes: [], createdAt: now, updatedAt: now, ...extra });
  return {
    version: 1, nextId: 2,
    projects: [
      make('demo-podcast', '一起录一期，关于我们的播客', '刚刚想到，要不要一起录一期播客？聊聊我们是怎么认识的，还有异地的时候那些好笑的小事。先随便聊聊，不用准备得很完美。', 'demo-rain'),
      make('demo-weekend', '把这个周末，留给一件新鲜事', '想和你去一个没去过的地方。不用很远，带上相机，慢慢走一走就好。', 'demo-tree'),
      make('demo-goal', '一起做一本小小的旅行手帐', '把我们一起去过的地方、车票和照片，慢慢装进一本小册子里。', 'demo-tree', {
        stage: 'exploring', consents: demoUsers.map(user => user.id), goal: '先选出最想记下来的三次旅行，做出第一页。',
        tasks: [{ id: 'demo-task-1', text: '各自选出三张喜欢的照片', assigneeId: 'demo-tree', done: false }, { id: 'demo-task-2', text: '找一个我们都喜欢的手帐风格', assigneeId: 'demo-rain', done: true }],
        notes: [{ id: 'demo-note-1', authorId: 'demo-rain', kind: 'comment', text: '第一站就从海边那次开始吧，我还留着那张车票。', createdAt: now }],
      }),
    ],
    captures: {},
    inbox: [{ id: 1, projectId: 'demo-podcast', actorId: 'demo-rain', recipientId: 'demo-tree', kind: 'idea', title: '一起录一期，关于我们的播客', createdAt: now, deliveredAt: null, readAt: null }],
  };
}

export function createDemoStore({ initialData, save = () => {}, changed = () => {} } = {}) {
  let data = initialData?.version === 1 ? structuredClone(initialData) : seedDemo();
  const fail = (message, status = 400) => { const error = new Error(message); error.status = status; throw error; };
  const text = (value, limit) => {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > limit) fail(`请填写 1 到 ${limit} 个字符。`);
    return value.trim();
  };
  const commit = () => { save(structuredClone(data)); changed(); };
  const person = id => demoUsers.find(user => user.id === id) ?? demoUsers[0];
  const find = id => data.projects.find(item => item.id === id) ?? fail('这条想法已经不在了。', 404);
  const both = item => demoUsers.every(user => item.consents.includes(user.id));
  function activity(userId, item, kind) {
    data.inbox.push({ id: data.nextId++, projectId: item.id, actorId: userId, recipientId: demoUsers.find(user => user.id !== userId).id, kind, title: item.title, createdAt: new Date().toISOString(), deliveredAt: null, readAt: null });
    item.updatedAt = new Date().toISOString();
  }
  return {
    snapshot: () => structuredClone(data),
    replace(value) { if (value?.version === 1) data = structuredClone(value); },
    async request(userId, path, method = 'GET', body = {}) {
      userId = person(userId).id;
      if (path === '/api/auth/state' || path === '/api/auth/login') return { user: person(userId), csrfToken: 'local-experience', setupRequired: false };
      if (path === '/api/auth/logout') return { ok: true };
      if (path === '/api/state') return structuredClone({ users: demoUsers, projects: data.projects });
      if (path === '/api/companion/status') return { ai: { configured: false } };
      if (path === '/api/companion/inbox') {
        const items = data.inbox.filter(item => item.recipientId === userId && !item.readAt).sort((a, b) => b.id - a.id);
        return structuredClone({ unreadCount: items.length, items: items.slice(0, 200) });
      }
      if (path === '/api/companion/inbox/delivered' && method === 'POST') {
        for (const item of data.inbox) if (item.recipientId === userId && body.ids?.includes(item.id) && !item.deliveredAt) item.deliveredAt = new Date().toISOString();
        save(structuredClone(data)); return { ok: true };
      }
      if (path === '/api/companion/inbox/read' && method === 'POST') {
        for (const item of data.inbox) if (item.recipientId === userId && item.projectId === body.projectId && !item.readAt) item.deliveredAt = item.readAt = new Date().toISOString();
        commit(); return { ok: true };
      }
      if (path === '/api/companion/chat' && method === 'POST') return { generated: false, reply: '这里是本机体验空间，还没有连接整理助手。你可以先点「记录并分享」，再切到 TA 的视角，看看这个念头是怎样被接住的。' };
      if (path === '/api/companion/capture' && method === 'POST') {
        const original = text(body.text, 4000);
        if (typeof body.clientId !== 'string' || !/^[a-zA-Z0-9_-]{12,80}$/.test(body.clientId)) fail('记录标识无效。');
        const key = `${userId}:${body.clientId}`;
        if (data.captures[key]) {
          const previous = find(data.captures[key]);
          if (previous.capture.originalText !== original) fail('记录标识已使用。', 409);
          return { project: structuredClone(previous), duplicate: true };
        }
        if (data.projects.length >= 500) fail('体验空间已有 500 个想法，请先整理。');
        const now = new Date().toISOString();
        const item = { id: crypto.randomUUID(), title: original.split(/[\r\n。！？!?]/u).find(line => line.trim())?.trim().slice(0, 60) || original.slice(0, 60), description: original, authorId: userId, stage: 'idea', goal: '', consents: [], tasks: [], notes: [], createdAt: now, updatedAt: now, nextReviewAt: null, capture: { originalText: original, summary: '', aiState: 'original' } };
        data.projects.unshift(item); data.captures[key] = item.id;
        activity(userId, item, 'idea'); commit();
        return { project: structuredClone(item), duplicate: false };
      }
      const parts = path.split('/').filter(Boolean);
      if (parts[0] === 'api' && parts[1] === 'projects' && parts[2]) {
        const item = find(parts[2]);
        if (parts.length === 3 && method === 'PATCH') {
          if (body.stage && ['exploring', 'active', 'completed'].includes(body.stage) && !both(item)) fail('等两个人都愿意，再一起往前走。', 409);
          if (body.goal !== undefined) item.goal = typeof body.goal === 'string' ? body.goal.trim().slice(0, 4000) : fail('目标格式不正确。');
          if (body.stage && ['idea', 'exploring', 'active', 'completed', 'paused'].includes(body.stage)) item.stage = body.stage;
          activity(userId, item, 'update');
        } else if (parts[3] === 'consent' && method === 'POST') {
          item.consents = item.consents.includes(userId) ? item.consents.filter(id => id !== userId) : [...item.consents, userId];
          if (both(item) && item.stage === 'idea') item.stage = 'exploring';
          activity(userId, item, 'consent');
        } else if (parts[3] === 'notes' && method === 'POST') {
          if (item.notes.length >= 1000) fail('这件事的记录已经很多了，先整理一下吧。');
          item.notes.push({ id: crypto.randomUUID(), kind: 'comment', text: text(body.text, 8000), authorId: userId, createdAt: new Date().toISOString() });
          activity(userId, item, 'comment');
        } else if (parts[3] === 'tasks' && method === 'POST') {
          if (item.tasks.length >= 200) fail('下一步已经很多了，先完成一些吧。');
          if (body.assigneeId && !demoUsers.some(user => user.id === body.assigneeId)) fail('请选择你们中的一位。');
          item.tasks.push({ id: crypto.randomUUID(), text: text(body.text, 300), done: false, assigneeId: body.assigneeId || null });
          activity(userId, item, 'task');
        } else if (parts[3] === 'tasks' && parts[4] && method === 'PATCH') {
          const task = item.tasks.find(value => value.id === parts[4]);
          if (!task) fail('找不到这条待办。', 404);
          if (typeof body.done !== 'boolean') fail('完成状态无效。');
          task.done = body.done; activity(userId, item, 'task');
        } else fail('体验空间暂不支持这个操作。', 404);
        commit(); return { project: structuredClone(item) };
      }
      fail('找不到这个入口。', 404);
    },
  };
}
