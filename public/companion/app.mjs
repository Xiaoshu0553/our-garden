import { renderAccountForm, renderPairing, copyInvitation, renderUnlinkConfirmation, renderArchiveLinks, renderArchive } from './accounts-ui.mjs';
import { createTransport } from './transport.mjs';

const content = document.getElementById('content');
const nav = document.getElementById('navigation');
const state = { info: {}, garden: null, invite: null, authMode: 'login', user: null, archives: [], archiveData: null, goalDraft: '', users: [], projects: [], inbox: [], unread: 0, page: 'talk', selected: null, draft: '', filter: 'all', search: '', queue: [], offline: false, busy: false, suggestion: '', error: '' };
let transport;
let refreshing = false;
let refreshAgain = false;
let flushing = false;
let toastTimer;
const stages = { idea: '想聊聊', exploring: '一起探索', active: '正在行动', completed: '一起完成', paused: '先放一放' };
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const shapes = {
  leaf: '<path d="M5 20 18 7M6 16C0 7 9 2 21 3c0 12-6 19-15 13Z"/>',
  sprout: '<path d="M12 21v-8M12 14C4 15 3 9 3 5c7-1 10 3 9 9ZM12 11c0-7 4-9 9-8 1 6-3 9-9 8Z"/>',
  chat: '<path d="M21 11a9 9 0 0 1-9 9H4l-2 2V11a9.5 9.5 0 0 1 19 0ZM7 10h10M7 14h6"/>',
  note: '<path d="M5 3h14v13l-5 5H5zM14 21v-5h5M8 8h8M8 12h5"/>',
  goal: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="m10 12 2 2 5-6"/>',
  settings: '<path d="m12 3 2 3 4-1 1 4 3 3-3 3-1 4-4-1-2 3-2-3-4 1-1-4-3-3 3-3 1-4 4 1Z"/><circle cx="12" cy="12" r="3"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  minus: '<path d="M5 12h14"/>',
  arrow: '<path d="M4 12h16m-5-5 5 5-5 5"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  back: '<path d="m14 5-7 7 7 7"/>',
  heart: '<path d="M20 5a5 5 0 0 0-8 1 5 5 0 0 0-8-1c-5 5 1 10 8 16 7-6 13-11 8-16Z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  sparkle: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/>',
  external: '<path d="M14 3h7v7m0-7L11 13M10 3H3v18h18v-7"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
};
function icon(name) { return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes[name] || shapes.leaf}</svg>`; }
function person(id) { return state.users.find(value => value.id === id) ?? { id, name: 'TA' }; }
function peer() { return state.users.find(value => value.id !== state.user?.id) ?? { name: 'TA' }; }
function avatar(id) { return `<span class="avatar ${id !== state.user?.id ? 'other' : ''}" aria-hidden="true">${escape(Array.from(person(id).name)[0])}</span>`; }
function petSource() { return state.info.pet === 'custom' && state.info.customImage ? state.info.customImage : `${state.info.pet === 'cat' ? 'cat' : 'dog'}.svg`; }
function date(value) { const d = new Date(value); return Number.isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d); }
function updateContents() {
  const update = state.info.update || {};
  const busy = ['checking', 'downloading'].includes(update.status);
  const available = Boolean(update.availableVersion);
  const labels = { idle: '可以检查是否有新版本。', checking: '正在检查更新…', current: '当前已是最新版本。', available: `新版本 ${update.availableVersion} 已准备好。`, downloading: `正在下载并校验… ${update.percent || 0}%`, ready: '安装包已校验，可以打开安装。', unsupported: '此系统暂未提供安装包。', error: update.error };
  return `<h2>软件更新</h2><p class="garden-account-help">当前版本 ${escape(state.info.version || update.currentVersion || '')}。收到提醒后，由你点击下载安装。</p><p class="update-status" role="status">${escape(labels[update.status] || labels.idle)}</p>${update.notes && available ? `<p class="update-notes">${escape(update.notes)}</p>` : ''}<div class="form-actions"><button type="button" class="btn soft tiny" data-action="update-check" ${busy ? 'disabled' : ''}>检查更新</button>${available ? `<button type="button" class="btn primary tiny" data-action="update-install" ${busy ? 'disabled' : ''}>${update.status === 'ready' ? '打开安装包' : '下载并安装'}</button>` : ''}</div>`;
}
function renderSoftwareUpdate() { return transport.desktop ? `<section class="settings-group" id="software-update">${updateContents()}</section>` : ''; }
function refreshUpdate() {
  const notice = document.getElementById('software-update-notice');
  const update = state.info.update || {};
  notice.hidden = !transport?.desktop || state.info.windowMode === 'quick' || !update.availableVersion || state.page === 'settings';
  notice.innerHTML = notice.hidden ? '' : `<button type="button" class="update-notice" data-action="update-settings">小花园 ${escape(update.availableVersion)} 已发布 <span>查看更新 →</span></button>`;
  const section = document.getElementById('software-update');
  if (section) section.innerHTML = updateContents();
}
function both(item) { return state.users.length === 2 && state.users.every(value => item.consents.includes(value.id)); }
function selected() { return state.projects.find(value => value.id === state.selected); }
function toast(message, error = false) {
  clearTimeout(toastTimer);
  const el = document.getElementById('toast'); el.textContent = message; el.classList.toggle('error', error); el.hidden = false;
  toastTimer = setTimeout(() => { el.hidden = true; }, error ? 6500 : 3500);
}
function storageKey() { return `garden-companion:${state.info.mode}:${state.info.serverUrl}:${state.user?.id || 'visitor'}${transport?.desktop ? `:${state.info.windowMode || 'main'}` : ''}`; }
function identityCacheKey() { return `garden-companion:${state.info.mode}:${state.info.serverUrl}:last-user`; }
function cacheIdentity() {
  if (!state.user) return;
  try { localStorage.setItem(identityCacheKey(), JSON.stringify({ user: state.user, users: state.users, garden: state.garden, projects: state.projects.slice(0, 80) })); } catch { /* Shared cache is optional; the outbox takes priority. */ }
}
function saveLocal() {
  try { localStorage.setItem(storageKey(), JSON.stringify({ draft: state.draft, goalDraft: state.goalDraft, queue: state.queue })); return true; }
  catch { toast('本机储存空间不足，先复制保存输入内容，再清理空间。', true); return false; }
}
function loadLocal() {
  let saved;
  try {
    const legacyKey = `garden-companion:${state.info.mode}:${state.info.serverUrl}:${state.user?.id || 'visitor'}`;
    saved = JSON.parse(localStorage.getItem(storageKey()) || (transport?.desktop ? localStorage.getItem(legacyKey) : '') || 'null');
  } catch { /* defaults */ }
  state.goalDraft = typeof saved?.goalDraft === 'string' ? saved.goalDraft.slice(0,4000) : '';
  state.draft = typeof saved?.draft === 'string' ? saved.draft.slice(0, 4000) : '';
  state.queue = Array.isArray(saved?.queue) ? saved.queue.filter(item => typeof item.text === 'string' && typeof item.clientId === 'string').slice(0, 100) : [];
}
function renderChrome() {
  document.body.classList.toggle('desktop-panel', Boolean(transport?.desktop));
  document.body.classList.toggle('quick-panel', state.info.windowMode === 'quick');
  document.title = state.info.windowMode === 'quick' ? '小花园 · 快捷记录' : '小花园 · 两个人的灵感小伙伴';
  document.getElementById('settings-button').innerHTML = icon('settings');
  document.getElementById('hide-button').innerHTML = icon('minus');
  const identity = document.getElementById('identity-button');
  identity.innerHTML = `<span class="pair-dot"></span>${state.user ? `${escape(state.user.name)} ${icon('heart')} ${escape(peer().name)}` : '我们的两人小花园'}${state.info.mode === 'demo' ? '<span> · 体验空间</span>' : ''}`;
  identity.setAttribute('aria-label', state.info.mode === 'demo' ? '切换体验中的人物' : '查看小花园连接设置');
  const connection = document.getElementById('connection-state');
  connection.classList.toggle('offline', state.offline);
  connection.innerHTML = `<span class="status-dot"></span>${state.offline ? '等待重新连接' : state.info.mode === 'demo' ? '仅保存在本机' : state.user ? '共享已连接' : '等你入住'}`;
  const incoming = state.inbox[0];
  document.getElementById('notice-area').innerHTML = state.user && incoming && !['settings', 'login'].includes(state.page) ? `<button type="button" class="notice" data-action="open" data-id="${escape(incoming.projectId)}">${icon('mail')}<span class="notice-copy"><strong>${escape(person(incoming.actorId).name)}${{ idea: '留了一个新念头', comment: '给你留了句话', consent: '回应了你们的想法', task: '更新了下一小步', update: '补充了共同记录' }[incoming.kind] || '留了一条新记录'}${state.unread > 1 ? ` · 还有 ${state.unread - 1} 条未读` : ''}</strong><small>${escape(incoming.title)}</small></span>${icon('chevron')}</button>` : '';
  document.getElementById('queue-area').innerHTML = state.queue.length ? `<div class="queue-note">${icon('clock')}<span>${state.queue.length} 条想法${state.offline ? '留在本机，联网后分享' : '等待发送'}</span><button type="button" data-action="queue">查看</button></div>` : '';
  nav.hidden = !state.user || ['settings', 'queue', 'archive', 'new-goal'].includes(state.page);
  nav.innerHTML = [['talk', 'note', '记想法'], ['ideas', 'note', '我们的想法'], ['goals', 'sprout', '共同目标']].map(([page, symbol, label]) => `<button type="button" class="nav-button ${state.page === page ? 'active' : ''}" data-action="page" data-page="${page}" ${state.page === page ? 'aria-current="page"' : ''}>${icon(symbol)}${label}${page === 'ideas' && state.unread ? `<span class="nav-counter">${state.unread > 99 ? '99+' : state.unread}</span>` : ''}</button>`).join('');
  const preview = document.getElementById('preview-pet-image'); preview.src = petSource();
  refreshUpdate();
}
function ideaRow(item) {
  const unread = state.inbox.some(value => value.projectId === item.id);
  return `<button type="button" class="idea-row" data-action="open" data-id="${escape(item.id)}"><span class="seed-mark">${icon(['exploring', 'active', 'completed'].includes(item.stage) ? 'sprout' : 'leaf')}</span><span class="idea-copy"><h3>${escape(item.title)}${unread ? '<span class="unread-dot" aria-label="未读"></span>' : ''}</h3><p>${escape(item.description)}</p><span class="idea-meta">${escape(person(item.authorId).name)}留下的<span>·</span><span class="stage ${escape(item.stage)}">${stages[item.stage]}</span></span></span>${icon('chevron')}</button>`;
}
function empty(title, copy, action = true) { return `<div class="empty">${icon('sprout')}<h2>${title}</h2><p>${copy}</p>${action ? `<button type="button" class="btn soft" data-action="page" data-page="talk">记一个小念头 ${icon('plus')}</button>` : ''}</div>`; }
function renderTalk() {
 const recent = [...state.projects].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).slice(0,2);
 return `<section class="hello"><p class="eyebrow">A LITTLE THOUGHT, FOR US</p><h1>刚刚想到什么，<br>都可以记下来。</h1><p>${state.users.length === 2 ? '好好记住，再轻轻带给' + escape(peer().name) + '。' : '先记在自己的小花园，连接伴侣后再一起分享。'}</p><img src="${escape(petSource())}" alt="你的小伙伴"></section><form id="compose-form" class="composer"><div class="compose-top"><strong class="mode-button active">记个想法</strong><span class="compose-hint">一句话，也是一颗种子</span></div><label class="sr-only" for="idea-input">想留给两个人的想法</label><textarea id="idea-input" name="text" maxlength="4000" placeholder="例如：周末想和你一起去海边，带上相机。">${escape(state.draft)}</textarea><div class="compose-footer"><span class="helper">${icon('leaf')}原话会被好好记住</span><button class="btn primary" type="submit">记录并分享 ${icon('arrow')}</button></div></form><div class="section-label"><h2>最近，留在这里的</h2><button type="button" class="text-link" data-action="page" data-page="ideas">看看全部 ${icon('chevron')}</button></div>${recent.length ? recent.map(ideaRow).join('') : empty('还没有种下念头','第一个念头，可以从很小很小的事开始。',false)}`;
}
function renderGoalProposal() {
 return `<button type="button" class="back" data-action="page" data-page="goals">返回共同目标</button><h1 class="settings-title">发起共同话题</h1><p class="settings-subtitle">先把想一起做的事提交给对方，双方确认后再开始行动。</p><form id="goal-proposal-form" class="goal-proposal-form"><label class="field" for="goal-proposal-input">我们想一起做什么<textarea id="goal-proposal-input" name="text" required maxlength="4000" rows="5" placeholder="例如：这个月一起读完一本书，每周分享一个喜欢的片段。">${escape(state.goalDraft)}</textarea></label><p class="error-text" data-error role="alert" hidden></p><div class="form-actions"><button type="submit" class="btn primary">提交共同话题 ${icon('arrow')}</button></div></form>`;
}
function filteredProjects() {
  return state.projects.filter(item => (state.page !== 'goals' || (['exploring', 'active', 'completed'].includes(item.stage) || Boolean(item.goal))) && (state.filter === 'all' || (item.authorId === state.user.id) === (state.filter === 'mine')) && (!state.search || `${item.title} ${item.description} ${item.goal}`.toLocaleLowerCase().includes(state.search.toLocaleLowerCase()))).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
function renderList() {
  const goals = state.page === 'goals';
  return `<div class="view-heading"><div><h1>${goals ? '一起，慢慢做到' : '我们的想法'}</h1><p>${goals ? '两个人都心动的事，在这里往前走。' : '那些一闪而过的念头，都好好留着。'}</p></div><button class="icon-button" type="button" data-action="${goals ? 'new-goal' : 'page'}" data-page="talk" aria-label="${goals ? '发起共同话题' : '记录新想法'}">${icon('plus')}</button></div><label class="sr-only" for="idea-search">搜索共同记录</label><input class="search" id="idea-search" placeholder="找找某一个念头…" value="${escape(state.search)}"><div class="filters" aria-label="按发起人筛选">${[['all', '全部'], ['mine', '我留下的'], ['theirs', `${peer().name}留下的`]].map(([value, label]) => `<button type="button" class="filter ${state.filter === value ? 'active' : ''}" data-action="filter" data-filter="${value}" aria-pressed="${state.filter === value}">${escape(label)}</button>`).join('')}</div><div id="idea-list">${renderListItems()}</div>`;
}
function renderListItems() { const items = filteredProjects(); return items.length ? items.map(ideaRow).join('') : empty(state.search ? '还没有找到这个念头' : state.page === 'goals' ? '等一件我们都想做的事' : '留给我们的空白页', state.page === 'goals' ? '在想法里，两个人都点「我想一起做」，它就会来到这里。' : '写下一句话，留给对方看看。'); }
function renderDetail(item) {
  const mine = item.consents.includes(state.user.id);
  const together = both(item);
  return `<button type="button" class="back" data-action="back">${icon('back')}回到${state.page === 'goals' ? '共同目标' : '我们的想法'}</button><div><span class="stage ${escape(item.stage)}">${stages[item.stage]}</span></div><h1 class="detail-title">${escape(item.title)}</h1><div class="detail-author">${avatar(item.authorId)}${escape(person(item.authorId).name)} 留下的<span>·</span>${date(item.createdAt)}</div><p class="original">${escape(item.capture?.originalText || item.description)}</p><div class="consent-box"><strong>${together ? '这件事，我们都想一起做。' : '要不要，一起试试看？'}</strong><div class="consent-people">${state.users.map(user => `<span class="consent-person ${item.consents.includes(user.id) ? 'yes' : ''}">${avatar(user.id)}${escape(user.name)} · ${item.consents.includes(user.id) ? '愿意一起' : '还在考虑'}</span>`).join('')}</div><button type="button" class="btn ${mine ? 'soft' : 'primary'} tiny" data-action="consent">${icon(mine ? 'check' : 'heart')}${mine ? '我已确认 · 撤回' : item.authorId === state.user.id ? '我想一起做' : '我也想一起做'}</button></div><section class="detail-section"><h2>${icon('sprout')}这次，想一起做到什么</h2>${together ? `<form id="goal-form"><label class="sr-only" for="goal-input">共同目标</label><textarea id="goal-input" class="search" name="goal" maxlength="4000" rows="3" placeholder="先约定一个小目标就好…">${escape(item.goal)}</textarea><div class="form-actions"><button type="submit" class="btn tiny soft">保存这个小目标</button></div></form><div class="goal-actions">${item.stage !== 'completed' ? `<button type="button" class="text-link" data-action="stage" data-stage="${item.stage === 'active' ? 'completed' : 'active'}">${icon(item.stage === 'active' ? 'check' : 'arrow')}${item.stage === 'active' ? '这个目标，我们完成了' : '开始一起行动'}</button>` : '<span class="muted-copy">这件一起做过的事，已经好好记下。</span>'}</div>` : `<p class="goal-copy">${escape(item.goal || '先听听彼此的想法。两个人都愿意后，再约定一个共同的小目标。')}</p>`}</section>${together || item.tasks.length ? `<section class="detail-section"><h2>${icon('check')}接下来，各做一小步</h2>${item.tasks.map(task => `<label class="task-row ${task.done ? 'done' : ''}"><input type="checkbox" data-task="${escape(task.id)}" ${task.done ? 'checked' : ''} aria-label="完成待办：${escape(task.text)}"><span>${escape(task.text)}</span><small>${task.assigneeId ? escape(person(task.assigneeId).name) : '待认领'}</small></label>`).join('')}${together ? `<form id="task-form" class="form-row task-add"><label class="sr-only" for="task-input">下一步</label><input id="task-input" name="text" maxlength="300" required placeholder="写一件具体的小事…"><label class="sr-only" for="task-assignee">由谁来做</label><select id="task-assignee" name="assigneeId">${state.users.map(user => `<option value="${escape(user.id)}" ${user.id === state.user.id ? 'selected' : ''}>${escape(user.name)}</option>`).join('')}<option value="">待认领</option></select><button class="btn tiny" type="submit" aria-label="添加下一步">${icon('plus')}</button></form>` : ''}</section>` : ''}<section class="detail-section"><h2>${icon('chat')}留句话，继续聊</h2>${item.notes.length ? item.notes.map(note => `<article class="note"><div class="note-head">${avatar(note.authorId)}${escape(person(note.authorId).name)}<time>${date(note.createdAt)}</time></div><p>${escape(note.text)}</p></article>`).join('') : '<p class="muted-copy">一句回应，就能让对方知道你接住了。</p>'}<form id="reply-form" class="reply-form"><label class="sr-only" for="reply-input">给对方的回应</label><textarea id="reply-input" name="text" required maxlength="8000" placeholder="说说你的想法，或补充一个小细节…"></textarea><div class="form-actions"><button class="btn primary tiny" type="submit">留给${escape(peer().name)} ${icon('arrow')}</button></div></form></section>${state.info.mode !== 'demo' ? `<div class="form-actions"><button type="button" class="text-link" data-action="garden">在小花园里展开 ${icon('external')}</button></div>` : ''}`;
}
function renderSettings() {
  return `<button type="button" class="back" data-action="page" data-page="talk">${icon('back')}回到小伙伴</button><h1 class="settings-title">我们的小伙伴</h1><p class="settings-subtitle">选一个喜欢的样子，陪我们一起记住。</p><div class="pet-options">${[['dog', '小狗 · 暖暖'], ['cat', '小猫 · 绵绵']].map(([pet, label]) => `<button type="button" class="pet-option ${state.info.pet === pet || (!state.info.pet && pet === 'dog') ? 'active' : ''}" data-action="pet" data-pet="${pet}" aria-pressed="${state.info.pet === pet}"><img src="${pet}.svg" alt="">${label}</button>`).join('')}</div><div class="custom-upload">${state.info.customImage ? `<img class="custom-preview" src="${escape(state.info.customImage)}" alt="自定义形象"><button type="button" class="btn tiny" data-action="pet" data-pet="custom">用我的形象</button>` : ''}<label class="btn tiny" for="custom-image">换成自己的形象</label><input id="custom-image" type="file" accept="image/png,image/jpeg,image/webp" hidden></div><p class="muted-copy">支持 PNG、JPG、WebP。透明背景的图片更像桌宠。<br>两边可以各选喜欢的样子，共享的记忆还是同一份。</p><div class="settings-group"><h2>安静地陪着你</h2><label class="setting-row"><span>免打扰<small>信封和未读会保留，关闭桌面弹窗</small></span><input type="checkbox" data-setting="doNotDisturb" ${state.info.doNotDisturb ? 'checked' : ''}></label>${transport.desktop ? `<label class="setting-row"><span>桌面通知<small>收到新记录时轻轻提醒，不自动展开面板</small></span><input type="checkbox" data-setting="notifications" ${state.info.notifications !== false ? 'checked' : ''}></label><label class="setting-row"><span>登录电脑时陪我出现</span><input type="checkbox" data-setting="openAtLogin" ${state.info.openAtLogin ? 'checked' : ''}></label><div class="setting-row"><span>随时打开输入面板</span><span class="shortcut">${escape(state.info.shortcut || '')}</span></div>` : ''}</div>${state.user && state.info.mode !== 'demo' ? `<section id="pairing-settings" class="garden-pairing">${renderPairing(state.garden, state.invite, state.queue.length)}</section>` : ''}<div class="settings-group"><h2>和谁，一起记住</h2>${state.info.mode === 'demo' ? `<p class="mode-status"><strong>正在体验空间里</strong><br>这是本机的双人演示。切换身份，看看对方怎样收到你的念头。</p><div class="identity-options">${state.users.map(user => `<button type="button" class="identity-option ${user.id === state.user?.id ? 'active' : ''}" data-action="identity" data-id="${escape(user.id)}">${avatar(user.id)}${escape(user.name)}的视角</button>`).join('')}</div><button type="button" class="text-link" data-action="peer-window">另开 TA 的体验窗口 ${icon('external')}</button>` : `<p class="mode-status"><strong>${state.user ? `${escape(state.user.name)}与${escape(peer().name)}` : '还没有登录'}</strong><br>${escape(state.info.serverUrl || location.origin)}</p>`}<form id="connect-form"><label class="field">你们的小花园地址<input type="url" name="serverUrl" required value="${escape(state.info.mode === 'connected' ? state.info.serverUrl : transport.desktop ? 'https://cyberhome.wuhuxiaoshu.com' : location.origin)}" placeholder="https://你们的小花园"></label><div class="form-actions"><button type="submit" class="btn soft tiny">连接我们的小花园 ${icon('arrow')}</button></div></form>${state.info.mode === 'connected' ? `<button type="button" class="danger-link" data-action="logout">退出当前账号</button><button type="button" class="text-link" data-action="demo">回体验空间看看</button>` : ''}</div>${renderArchiveLinks(state.archives)}<p class="foot-note">小花园桌宠 · 0.4 · 一点一点，也在一起向前</p>`;
}
function renderLogin() {
  const registering = state.authMode === 'register';
  return `<div class="login-hero ${registering ? 'register-hero' : ''}"><img src="${escape(petSource())}" alt="等待你的小伙伴"><h1>${registering ? '给我们，留一个小花园。' : '把小伙伴，带进我们的小家。'}</h1><p>${registering ? '各自注册，用邀请码找到彼此。' : '用自己的账号登录，继续记住一起想做的事。'}</p></div>${renderAccountForm(state.authMode, state.error)}<p class="muted-copy">${escape(state.info.serverUrl || location.origin)}</p><div class="form-actions"><button type="button" class="text-link" data-action="demo">先到体验空间看看</button><button type="button" class="text-link" data-action="settings">调整连接地址</button></div>`;
}
function renderQueue() { return `<button class="back" type="button" data-action="page" data-page="talk">${icon('back')}回到小伙伴</button><h1 class="settings-title">等着带给你的念头</h1><p class="settings-subtitle">这些原话保存在本机，还没有送到共享空间。</p>${state.queue.map((item, index) => `<div class="queue-item"><p>${escape(item.text)}</p><small>${escape(item.error || '重新连接后会自动分享。')}</small><div class="queue-actions"><button type="button" class="text-link" data-action="retry" data-index="${index}">重新发送</button><button type="button" class="text-link" data-action="restore-draft" data-index="${index}">移回输入框</button></div></div>`).join('') || empty('念头都已经送到了', '回到我们的想法，就能看到它们。', false)}`; }
function render() {
  renderChrome();
  if (state.info.windowMode === 'quick') {
    nav.hidden = true;
    if (!state.user) {
      content.innerHTML = `<div class="quick-welcome"><p>先让小伙伴，入住我们的小花园。</p><span>登录之后，随手写下的念头就能带给对方。</span><button type="button" class="btn primary" data-action="main">登录或注册 ${icon('arrow')}</button></div>`;
      transport.resizeQuick(210);
    } else if (state.page === 'queue') {
      content.innerHTML = renderQueue(); transport.resizeQuick(410);
    } else {
      content.innerHTML = renderTalk();
      transport.resizeQuick(state.queue.length ? 270 : 236);
    }
    return;
  }
  if (!state.user && state.page !== 'settings') { state.page = 'login'; content.innerHTML = renderLogin(); nav.hidden = true; return; }
  const item = selected();
  content.innerHTML = state.page === 'archive' && state.archiveData ? renderArchive(state.archiveData) : state.page === 'new-goal' ? renderGoalProposal() : state.page === 'settings' ? renderSettings() : state.page === 'queue' ? renderQueue() : item ? renderDetail(item) : state.page === 'talk' ? renderTalk() : renderList();
  if (state.page === 'settings' && transport.desktop) content.insertAdjacentHTML('beforeend', renderSoftwareUpdate());
}
function page(value) { state.page = value; state.selected = null; state.suggestion = ''; state.filter = 'all'; state.search = ''; render(); content.scrollTop = 0; }
async function openIdea(id) {
  if (!state.projects.some(item => item.id === id)) { await sync(); if (!state.projects.some(item => item.id === id)) return toast('这条想法已经不在了。', true); }
  if (!['ideas', 'goals'].includes(state.page)) state.page = 'ideas';
  state.selected = id; state.suggestion = ''; render(); content.scrollTop = 0;
  try { await transport.request('/api/companion/inbox/read', 'POST', { projectId: id }); state.inbox = state.inbox.filter(item => item.projectId !== id); state.unread = state.inbox.length; renderChrome(); } catch { /* Opening the record still works while offline; reading will be retried when reopened. */ }
}
function merge(item) { const at = state.projects.findIndex(value => value.id === item.id); if (at < 0) state.projects.unshift(item); else state.projects[at] = item; }
async function sync() {
  if (!state.user) return;
  if (refreshing) { refreshAgain = true; return; }
  refreshing = true;
  try {
    if (state.offline) {
      const auth = await transport.request('/api/auth/state');
      if (!auth.user) { const error = new Error('登录已过期。'); error.status = 401; throw error; }
      if (auth.user.id !== state.user.id) { state.user = auth.user; loadLocal(); }
    }
    const [data, inbox] = await Promise.all([transport.request('/api/state'), transport.request('/api/companion/inbox')]);
    const previousMembers = state.garden?.members.length;
    const previousGardenId = state.garden?.id;
    state.garden = data.garden || null;
    if (previousGardenId !== state.garden?.id) state.invite = null;
    if (state.page === 'settings' && previousMembers !== state.garden?.members.length) {
      const pairing = document.getElementById('pairing-settings');
      if (pairing) pairing.innerHTML = renderPairing(state.garden, state.invite, state.queue.length);
    }
    state.users = data.users; state.projects = data.projects; state.inbox = inbox.items; state.unread = inbox.unreadCount; state.archives = data.archives || []; state.offline = false;
    state.user = data.users.find(value => value.id === state.user.id) || state.user;
    cacheIdentity();
    renderChrome();
    // A live update never replaces the editor beneath the user's cursor.
    const editing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
    if (previousGardenId !== state.garden?.id && state.page === 'settings') render();
    else if (!editing && !state.busy && !['settings', 'queue'].includes(state.page)) render();
    if (!transport.desktop) {
      const fresh = inbox.items.filter(item => !item.deliveredAt).map(item => item.id);
      if (fresh.length) await transport.request('/api/companion/inbox/delivered', 'POST', { ids: fresh });
    }
  } catch (error) {
    state.offline = true; renderChrome();
    if (error.status === 401) { state.user = null; state.projects = []; state.inbox = []; state.unread = 0; state.error = '登录已过期，重新登录后待发送的想法还在。'; render(); }
    else if (error.status === 404) toast(error.message, true);
  } finally { refreshing = false; if (refreshAgain) { refreshAgain = false; queueMicrotask(() => sync()); } }
}
async function flushQueue() {
  if (flushing || !state.user || state.offline) return;
  flushing = true;
  const identity = storageKey();
  try {
    for (const queued of [...state.queue]) {
      if (queued.error || identity !== storageKey()) continue;
      try {
        const result = await transport.request('/api/companion/capture', 'POST', { text: queued.text, clientId: queued.clientId, kind: queued.kind || 'idea' });
        if (identity !== storageKey()) break;
        state.queue = state.queue.filter(item => item.clientId !== queued.clientId); merge(result.project); state.offline = false; saveLocal();
        toast(state.info.mode === 'demo' ? '原话收好了，切到 TA 的视角看看。' : `原话已收好，已留给${peer().name}。`);
      } catch (error) {
        if (identity !== storageKey()) break;
        if (error.offline || !error.status || error.status >= 500) state.offline = true;
        else queued.error = error.status === 401 ? '重新登录后再发送。' : error.message;
        saveLocal(); toast(error.message, true); break;
      }
    }
  } finally { flushing = false; renderChrome(); if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) render(); }
}
async function capture(text, kind = 'idea') {
  const value = text.trim();
  if (!value) return toast('先写下一句话吧。');
  if (state.queue.length >= 100) return toast('待发送的念头已经很多了，先连接小花园把它们送到。', true);
  const queued = { clientId: crypto.randomUUID(), text: value, kind, createdAt: new Date().toISOString() };
  state.queue.push(queued);
  if (!saveLocal()) { state.queue.pop(); return; }
  if (kind === 'goal') state.goalDraft = ''; else state.draft = ''; saveLocal(); state.page = kind === 'goal' ? 'goals' : 'talk'; state.selected = null; render();
  await flushQueue();
}
async function reinitialize() {
  state.info = await transport.info(); state.garden = null; state.invite = null; state.authMode = 'login'; state.user = null; state.users = []; state.projects = []; state.inbox = []; state.unread = 0; state.selected = null; state.error = ''; state.offline = false;
  state.queue = []; state.draft = ''; state.goalDraft = ''; state.archives = []; state.archiveData = null;
  try {
    const auth = await transport.request('/api/auth/state'); state.user = auth.user;
    state.garden = auth.garden || null;
    if (state.user) { loadLocal(); for (const item of state.queue) if (item.error === '重新登录后再发送。') delete item.error; state.page = 'talk'; await sync(); }
    else state.page = 'login';
  } catch (error) {
    state.page = 'login'; state.error = error.message; state.offline = true;
    if (error.offline || !error.status || error.status >= 500) {
      let cached;
      try { cached = JSON.parse(localStorage.getItem(identityCacheKey()) || 'null'); } catch { /* no previous identity */ }
      if (cached?.user?.id && Array.isArray(cached.users) && Array.isArray(cached.projects)) { state.user = cached.user; state.garden = cached.garden || null; state.users = cached.users; state.projects = cached.projects; state.page = 'talk'; loadLocal(); }
    }
  }
  render(); if (state.info.windowMode === 'quick') document.getElementById('idea-input')?.focus(); if (state.user) await flushQueue();
}
async function mutate(path, method, body) { const result = await transport.request(path, method, body); if (result.project) merge(result.project); render(); }
async function action(target) {
  const item = selected();
  switch (target.dataset.action) {
    case 'main': return transport.main();
    case 'update-settings': page('settings'); document.getElementById('software-update')?.scrollIntoView({block:'center'}); return;
    case 'update-check': state.info.update = await transport.update('check'); refreshUpdate(); return;
    case 'update-install': state.info.update = await transport.update('install'); refreshUpdate(); return;
    case 'new-goal': return page('new-goal');
    case 'unlink-open': document.getElementById('pairing-settings').innerHTML = renderUnlinkConfirmation(); return;
    case 'unlink-cancel': document.getElementById('pairing-settings').innerHTML = renderPairing(state.garden,state.invite,state.queue.length); return;
    case 'archive-open': { const result=await transport.request('/api/garden/archives/'+target.dataset.id);state.archiveData=result.archive;return page('archive'); }
    case 'archive-back': return page('settings');
    case 'auth-mode': state.authMode = target.dataset.mode === 'register' ? 'register' : 'login'; state.error = ''; render(); return;
    case 'create-invite': {
      const result = await transport.request('/api/garden/invite', 'POST', {}); state.invite = result.invite;
      const pairing = document.getElementById('pairing-settings'); if (pairing) pairing.innerHTML = renderPairing(state.garden, state.invite, state.queue.length);
      toast('邀请码准备好了，交给你的伴侣吧。'); return;
    }
    case 'copy-invite': toast(await copyInvitation(state.invite)); return;
    case 'page': return page(target.dataset.page);
    case 'settings': return page('settings');
    case 'open': return openIdea(target.dataset.id);
    case 'back': state.selected = null; state.suggestion = ''; render(); return;
    case 'queue': return page('queue');
    case 'filter': state.filter = target.dataset.filter; render(); return;
    case 'consent': if (item) await mutate(`/api/projects/${item.id}/consent`, 'POST', {}); return;
    case 'stage': if (item) await mutate(`/api/projects/${item.id}`, 'PATCH', { stage: target.dataset.stage }); return;
    case 'pet': state.info = await transport.settings({ pet: target.dataset.pet }); render(); return;
    case 'identity': if (flushing) return toast('等这个念头收好，再换个视角。'); state.info = await transport.identity(target.dataset.id); await reinitialize(); return;
    case 'peer-window': return transport.peer();
    case 'demo': await transport.configure({ mode: 'demo' }); await reinitialize(); return;
    case 'logout': await transport.request('/api/auth/logout', 'POST', {}); localStorage.removeItem(identityCacheKey()); state.garden = null; state.invite = null; state.authMode = 'login'; state.user = null; state.queue = []; state.draft = ''; state.goalDraft = ''; state.archives = []; state.archiveData = null; state.inbox = []; state.unread = 0; state.projects = []; state.page = 'login'; render(); return;
    case 'garden': return transport.garden(item?.id);
    case 'retry': { const queued = state.queue[Number(target.dataset.index)]; if (queued) { delete queued.error; saveLocal(); await sync(); await flushQueue(); } return; }
    case 'restore-draft': { const queued = state.queue[Number(target.dataset.index)]; if (!queued) return; const goal = queued.kind === 'goal'; if ((goal ? state.goalDraft : state.draft).trim()) return toast('输入框里还有另一个念头，先收好它再移回。'); state.queue.splice(Number(target.dataset.index), 1); if (goal) state.goalDraft = queued.text; else state.draft = queued.text; saveLocal(); page(goal ? 'new-goal' : 'talk'); return; }

  }
}
document.addEventListener('click', event => {
  const target = event.target.closest('[data-action]');
  if (!target || target.disabled) return;
  const old = target.disabled; target.disabled = true;
  Promise.resolve(action(target)).catch(error => toast(error.message, true)).finally(() => { if (target.isConnected) target.disabled = old; });
});
document.addEventListener('input', event => {
  if (event.target.id === 'idea-input') { state.draft = event.target.value; saveLocal(); }
  if (event.target.id === 'goal-proposal-input') { state.goalDraft = event.target.value; saveLocal(); }
  if (event.target.id === 'idea-search') { state.search = event.target.value; document.getElementById('idea-list').innerHTML = renderListItems(); }
});
document.addEventListener('change', async event => {
  try {
    if (event.target.dataset.setting) { state.info = await transport.settings({ [event.target.dataset.setting]: event.target.checked }); render(); }
    if (event.target.dataset.task) { const item = selected(); if (item) await mutate(`/api/projects/${item.id}/tasks/${event.target.dataset.task}`, 'PATCH', { done: event.target.checked }); }
    if (event.target.id === 'custom-image') {
      const file = event.target.files?.[0]; if (!file) return;
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) throw new Error('请选择不超过 2 MB 的 PNG、JPG 或 WebP 图片。');
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 320;
      const scale = Math.min(320 / bitmap.width, 320 / bitmap.height); const w = bitmap.width * scale, h = bitmap.height * scale;
      canvas.getContext('2d').drawImage(bitmap, (320 - w) / 2, (320 - h) / 2, w, h); bitmap.close();
      state.info = await transport.settings({ pet: 'custom', customImage: canvas.toDataURL('image/png') }); render(); toast('小伙伴换上了你选的样子。');
    }
  } catch (error) { toast(error.message, true); render(); }
});
document.addEventListener('submit', async event => {
  event.preventDefault(); const form = event.target; if (form.dataset.busy) return;
  form.dataset.busy = 'true'; const fields = Object.fromEntries(new FormData(form)); const submit = form.querySelector('button[type="submit"]'); if (submit) submit.disabled = true;
  try {
    if (form.id === 'compose-form') await capture(fields.text || '');
    if (form.id === 'goal-proposal-form') await capture(fields.text || '', 'goal');
    if (form.id === 'garden-unlink-form') {
      if (flushing || state.queue.length) throw new Error('请先送出待发送的想法，再解除绑定。');
      const auth=await transport.request('/api/garden/unlink','POST',{confirm:fields.confirm==='yes'});
      state.user=auth.user;state.garden=auth.garden;state.invite=null;state.page='talk';state.selected=null;
      await sync();render();toast('已解除绑定，过去的共同记录保存在设置中。');
    }
    if (['login-form', 'register-form'].includes(form.id)) {
      const registering = form.id === 'register-form';
      if (registering && fields.password !== fields.passwordConfirmation) throw new Error('两次密码不一致，请再检查一下。');
      const auth = await transport.request(registering ? '/api/auth/register' : '/api/auth/login', 'POST', fields);
      state.user = auth.user; state.garden = auth.garden; state.invite = null; state.authMode = 'login'; loadLocal();
      for (const item of state.queue) if (item.error === '重新登录后再发送。') delete item.error;
      state.page = registering && auth.garden?.canInvite ? 'settings' : 'talk'; state.error = '';
      await sync(); render(); await flushQueue();
      if (registering) toast(auth.garden?.canInvite ? '注册好了，生成邀请码，邀请伴侣一起入住吧。' : '注册好了，你们已经住进同一个小花园。');
    }
    if (form.id === 'garden-join-form') {
      if (flushing) throw new Error('等正在发送的念头收好，再加入伴侣。');
      if (state.queue.length && fields.shareExisting !== 'yes') throw new Error('请先确认将待发送的念头一起分享给伴侣。');
      const auth = await transport.request('/api/garden/join', 'POST', { code: fields.code, shareExisting: fields.shareExisting === 'yes' });
      state.user = auth.user; state.garden = auth.garden; state.invite = null; state.page = 'talk'; state.error = '';
      await sync(); render(); await flushQueue(); toast('连接好了，今后的念头一起记住。');
    }
    if (form.id === 'connect-form') { await transport.configure({ mode: 'connected', serverUrl: fields.serverUrl }); await reinitialize(); }
    const item = selected();
    if (item && form.id === 'reply-form') { await mutate(`/api/projects/${item.id}/notes`, 'POST', { kind: 'comment', text: fields.text }); toast('这句话，留给对方了。'); }
    if (item && form.id === 'goal-form') { await mutate(`/api/projects/${item.id}`, 'PATCH', { goal: fields.goal }); toast('我们的小目标，记下了。'); }
    if (item && form.id === 'task-form') await mutate(`/api/projects/${item.id}/tasks`, 'POST', fields);
  } catch (error) {
    const el = form.querySelector('[data-error]');
    if (el) { el.textContent = error.message; el.hidden = false; } else toast(error.message, true);
  }
  finally { delete form.dataset.busy; if (submit?.isConnected) submit.disabled = false; }
});
document.getElementById('settings-button').addEventListener('click', () => page(state.page === 'settings' ? 'talk' : 'settings'));
document.getElementById('hide-button').addEventListener('click', () => transport.hide());
document.getElementById('identity-button').addEventListener('click', () => page('settings'));
document.getElementById('preview-pet-button').addEventListener('click', () => { document.getElementById('companion').hidden = false; document.body.classList.remove('preview-collapsed'); document.getElementById('idea-input')?.focus(); });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') { if (state.selected) { state.selected = null; render(); } else transport.hide(); }
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && event.target.id === 'idea-input') { event.preventDefault(); document.getElementById('compose-form')?.requestSubmit(); }
});
transport = await createTransport(event => {
  if (event.type === 'changed') { sync().then(() => { if (state.offline === false) flushQueue(); }); }
  if (event.type === 'open-project' && event.data?.id) openIdea(event.data.id).catch(error => toast(error.message, true));
  if (event.type === 'focus-composer') { if (state.page !== 'talk' || state.selected) page('talk'); document.getElementById('idea-input')?.focus(); }
  if (event.type === 'settings-changed') { transport.info().then(info => { state.info = info; renderChrome(); }); }
  if (event.type === 'update-state') { state.info.update = event.data; refreshUpdate(); }
  if (event.type === 'show-updates') { page('settings'); document.getElementById('software-update')?.scrollIntoView({block:'center'}); }
  if (event.type === 'connection-changed' && event.data?.sourceId !== state.info.windowId) reinitialize();
});
await reinitialize();
window.addEventListener('online', () => sync().then(flushQueue));
setInterval(() => { if (state.user) sync().then(() => { if (!state.offline) flushQueue(); }); }, 15000);
