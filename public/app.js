import { renderAccountForm, renderPairing, copyInvitation } from './companion/accounts-ui.mjs';
const app = document.getElementById('app');
const projectDialog = document.getElementById('project-dialog');
const editorDialog = document.getElementById('editor-dialog');
const profileDialog = document.getElementById('profile-dialog');
const toastElement = document.getElementById('toast');
const stages = { idea: '想聊聊', exploring: '一起探索', active: '正在行动', completed: '一起完成', paused: '先放一放' };
const pages = { home: ['小院', 'home'], ideas: ['灵感墙', 'note'], projects: ['一起推进', 'sprout'], memories: ['回忆书架', 'book'] };
const noteLabels = { comment: '讨论', resource: '资料', decision: '决定' };
const state = { user: null, garden: null, invite: null, authMode: 'login', csrfToken: '', setupRequired: false, demo: false, users: [], projects: [], page: 'home', filter: 'all', search: '', projectId: null, noteKind: 'comment', offline: false };
let toastTimer;
let confirmAction;
let refreshPending = false;

function escape(value = '') {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}
function icon(name, extra = '') {
  const shapes = {
    home: '<path d="m3 10 9-7 9 7v11h-6v-7H9v7H3z"/>',
    note: '<path d="M5 3h14v13l-5 5H5zM14 21v-5h5M8 8h8M8 12h6"/>',
    sprout: '<path d="M12 21v-9M12 15C4 15 3 10 3 6c7-1 10 3 9 9ZM12 11c0-6 4-9 9-8 1 6-3 9-9 8Z"/>',
    book: '<path d="M12 5C8 2 4 3 2 4v16c4-2 7-1 10 1 3-2 6-3 10-1V4c-4-2-7-1-10 1v16"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="10.5" cy="10.5" r="7.5"/><path d="m16 16 5 5"/>',
    arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
    chevron: '<path d="m9 5 7 7-7 7"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    edit: '<path d="m15 4 5 5M4 20l5-1L21 7a3.5 3.5 0 0 0-5-5L4 14z"/>',
    trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
    comment: '<path d="M21 11a9 9 0 0 1-9 9H4l-2 2V11a9.5 9.5 0 0 1 19 0Z"/><path d="M7 10h10M7 14h7"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    link: '<path d="m10 13 4-4m-6 6-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m4 2 2-2a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" transform="translate(1 0)"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 11h18"/>',
    settings: '<path d="m12 3 2 3 4-1 1 4 3 3-3 3-1 4-4-1-2 3-2-3-4 1-1-4-3-3 3-3 1-4 4 1z"/><circle cx="12" cy="12" r="3"/>',
    heart: '<path d="M20 5a5 5 0 0 0-8 1 5 5 0 0 0-8-1c-5 5 1 10 8 16 7-6 13-11 8-16Z"/>',
    logout: '<path d="M9 3H3v18h6M9 12h12m-5-5 5 5-5 5"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
    leaf: '<path d="M4 20 17 7M5 16C-1 7 8 2 21 3c0 13-6 20-15 13"/>',
    people: '<circle cx="8" cy="7" r="3"/><path d="M2 21v-4a6 6 0 0 1 12 0v4M17 4a3 3 0 0 1 0 6m1 5a5 5 0 0 1 4 5"/>',
  };
  return `<svg class="icon ${escape(extra)}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes[name] ?? shapes.leaf}</svg>`;
}
function brand() {
  return '<a class="brand" href="#home" aria-label="两人小院首页"><img class="brand-mark" src="/favicon.svg" alt=""><div><div class="brand-name">两人小院</div><div class="eyebrow">OUR LITTLE GARDEN</div></div></a>';
}
function user(id) { return state.users.find(item => item.id === id) ?? { id, name: '住户' }; }
function avatar(id, extra = '') {
  const person = user(id);
  return `<span class="avatar ${id !== state.user?.id ? 'other' : ''} ${extra}" aria-hidden="true">${escape(Array.from(person.name)[0] || '家')}</span>`;
}
function prettyDate(value, full = false) {
  if (!value) return '还没约定';
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  if (!Number.isFinite(date.getTime())) return '还没约定';
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', ...(full ? { year: 'numeric' } : {}) }).format(date);
}
function dayValue(value) { return value ? String(value).slice(0, 10) : ''; }
function safeUrl(value) {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''; } catch { return ''; }
}
function toast(message, error = false) {
  clearTimeout(toastTimer);
  toastElement.textContent = message;
  toastElement.classList.toggle('error', error);
  toastElement.hidden = false;
  toastTimer = setTimeout(() => { toastElement.hidden = true; }, error ? 6000 : 3500);
}
function closeDialogs() {
  for (const dialog of [profileDialog, editorDialog, projectDialog]) if (dialog.open) dialog.close();
}
function showDialog(dialog) { if (!dialog.open) dialog.showModal(); }
function errorIn(form, message) {
  const target = form.querySelector('[data-error]');
  if (target) { target.textContent = message; target.hidden = !message; }
  else toast(message, true);
}
async function busy(form, action) {
  if (form.dataset.busy) return;
  form.dataset.busy = 'true';
  const buttons = [...form.querySelectorAll('button[type="submit"]')];
  buttons.forEach(button => { button.disabled = true; });
  errorIn(form, '');
  try { await action(); }
  catch (error) { errorIn(form, error.message || '暂时没能保存，请稍后重试。'); }
  finally { delete form.dataset.busy; buttons.forEach(button => { button.disabled = false; }); }
}
async function api(path, method = 'GET', body) {
  if (state.demo) return demoRequest(path, method, body);
  let response;
  try {
    response = await fetch(path, { method, credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(20000), headers: { ...(method !== 'GET' ? { 'Content-Type': 'application/json', 'X-CSRF-Token': state.csrfToken } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  } catch { throw new Error('暂时连不上小院，你填写的内容还在，请稍后再试。'); }
  let result;
  try { result = await response.json(); } catch { throw new Error('小院暂时没有正常回应，请稍后再试。'); }
  if (!response.ok) {
    if (response.status === 401 && !['/api/auth/login', '/api/auth/register', '/api/auth/me'].includes(path)) {
      state.user = null; state.csrfToken = ''; state.projects = []; state.users = [];
      closeDialogs(); renderLogin();
    }
    const error = new Error(result.error || '这次操作没能完成，请重试。');
    error.status = response.status;
    throw error;
  }
  return result;
}
async function loadState() {
  const data = await api('/api/state');
  state.users = data.users; state.garden = data.garden || null;
  state.projects = data.projects;
  const updated = data.users.find(item => item.id === state.user?.id);
  if (updated) state.user = updated;
  state.offline = false;
}
function applyProject(project) {
  const index = state.projects.findIndex(item => item.id === project.id);
  if (index === -1) state.projects.unshift(project);
  else state.projects[index] = project;
  state.projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  renderShell();
  if (projectDialog.open && state.projectId === project.id) renderProject();
}
async function mutateProject(path, method, body) {
  const result = await api(path, method, body);
  if (result.project) applyProject(result.project);
  return result;
}
function renderLogin(message = '') {
  const registering = state.authMode === 'register';
  document.title = registering ? '两人小院 · 注册我们的小花园' : '两人小院 · 回到我们的小家';
  app.innerHTML = `<main class="login-page"><section class="login-picture">${brand()}<img src="/garden.svg" alt="柔和绿树环绕着一座小屋，门前有花盆与信箱"><h1>有些想法，<br>想和你一起慢慢实现。</h1><p>各自注册，用邀请码找到彼此，<br>在两个人的小院里，慢慢把念头变成日常。</p></section><section><div class="login-panel"><span class="eyebrow">WELCOME HOME</span><h2>${registering ? '一起，种下一个开始。' : '回来啦。'}</h2><p>${registering ? '给自己创建账号，也给伴侣留一个位置。' : '用你的昵称和密码，打开小院的门。'}</p>${renderAccountForm(state.authMode, message)}<div class="login-divider">或先逛一逛</div><button class="btn demo" type="button" data-action="demo">${icon('leaf')} 看看示例小院</button><div class="login-footnote">两个住户 · 一处小院 · 很多一起想做的事</div></div></section></main>`;
}
function matches(project) {
  const query = state.search.trim().toLocaleLowerCase();
  return !query || `${project.title} ${project.description} ${project.goal}`.toLocaleLowerCase().includes(query);
}
function pageProjects() {
  let result = state.projects.filter(matches);
  if (state.page === 'projects') result = result.filter(project => ['exploring', 'active'].includes(project.stage));
  if (state.page === 'memories') result = result.filter(project => ['completed', 'paused'].includes(project.stage));
  if (state.page === 'home') result = result.filter(project => !['completed', 'paused'].includes(project.stage));
  if (state.filter !== 'all') result = result.filter(project => project.stage === state.filter);
  return result;
}
function projectCard(project) {
  const done = project.tasks.filter(task => task.done).length;
  return `<article class="idea-card"><div class="card-meta"><span class="stage ${escape(project.stage)}">${stages[project.stage]}</span><time class="card-date" datetime="${escape(project.createdAt)}">${prettyDate(project.createdAt)}</time></div><button type="button" class="card-title" data-action="open" data-id="${escape(project.id)}">${escape(project.title)}</button><p class="card-description">${escape(project.description || '这个念头刚刚种下，等我们慢慢聊。')}</p><div class="card-footer"><span class="author">${avatar(project.authorId)} ${escape(user(project.authorId).name)}</span><div class="card-stats"><span class="stat" aria-label="${project.notes.length} 条记录">${icon('comment')}${project.notes.length}</span>${project.tasks.length ? `<span class="stat" aria-label="完成 ${done} / ${project.tasks.length} 项待办">${icon('check')}${done}/${project.tasks.length}</span>` : `<span class="stat" aria-label="${project.consents.length} 人愿意一起做">${icon('people')}${project.consents.length}/2</span>`}</div></div></article>`;
}
function emptyState() {
  if (state.search || state.filter !== 'all') return '<div class="no-match">这里还没有符合条件的想法。换个关键词或阶段看看吧。</div>';
  const messages = {
    home: ['第一颗想法，等你来种下', '无论是一起做个小生意，还是重新布置一个角落，都可以从一句“我想……”开始。'],
    ideas: ['所有一起想做的事，都从这里开始', '写下一句话，留给对方看看。慢慢聊，也慢慢找到你们都想走的方向。'],
    projects: ['一起推进的事，会在这里发芽', '两个人都在想法卡里点下“想一起做”，这件事就会来到这里。'],
    memories: ['给走过的路，留一个位置', '完成的计划和暂时放下的念头，都会在这里好好保存。'],
  };
  const [title, copy] = messages[state.page];
  return `<div class="empty-state">${icon(state.page === 'memories' ? 'book' : 'sprout')}<h3>${title}</h3><p>${copy}</p>${['home', 'ideas'].includes(state.page) ? '<button class="btn soft" type="button" data-action="create">种下第一个想法</button>' : '<button class="btn soft" type="button" data-page="ideas">去灵感墙看看</button>'}</div>`;
}
function nextSteps() {
  const pending = state.projects.filter(project => ['exploring', 'active'].includes(project.stage)).flatMap(project => project.tasks.filter(task => !task.done).map(task => ({ project, task }))).sort((a, b) => Number(b.task.assigneeId === state.user.id) - Number(a.task.assigneeId === state.user.id)).slice(0, 5);
  return `<section class="next-section"><div class="section-head"><div class="section-title">${icon('sprout')}<h2>接下来的一小步</h2><span>${pending.length ? '一点一点，也在向前' : '不用着急，慢慢来'}</span></div><button type="button" class="text-link" data-page="projects">一起推进 ${icon('arrow')}</button></div>${pending.length ? `<div class="next-list">${pending.map(({ project, task }) => `<div class="next-row"><input class="task-check" type="checkbox" aria-label="完成待办：${escape(task.text)}" data-task-check="${escape(task.id)}" data-project="${escape(project.id)}"><div class="next-copy"><p>${escape(task.text)}</p><button type="button" data-action="open" data-id="${escape(project.id)}">${escape(project.title)}</button></div>${task.assigneeId ? `<span title="${escape(user(task.assigneeId).name)}">${avatar(task.assigneeId)}</span>` : '<span class="small muted">待认领</span>'}</div>`).join('')}</div>` : '<p class="goal-placeholder">把想法聊清楚后，试着约定一个小目标，再写下各自能做的一件小事。</p>'}</section>`;
}
function content() {
  const copy = {
    ideas: ['灵感墙', '把“我们要不要试试”，留在这里。每一个念头都值得被好好听见。'],
    projects: ['一起推进', '记住为什么出发，也看看今天各自能迈出哪一小步。'],
    memories: ['回忆书架', '一起做过的、认真想过的，都算我们生活里的收获。'],
  };
  let result = state.page === 'home'
    ? `<section class="hero"><div class="hero-copy"><p class="eyebrow">A LITTLE PLACE FOR OUR BIG IDEAS</p><h1>把想做的事，<br>慢慢变成我们做过的事。</h1><p class="hero-text">一起分享新念头，商量下一步。<br>日子很长，我们的小院也在慢慢生长。</p><div class="hero-pair">${icon('heart')}<span>${state.users.length === 2 ? `${escape(state.users[0].name)} 和 ${escape(state.users[1].name)}的小小天地` : '给另一个住户，留一个位置'}</span></div></div><img class="hero-art" src="/garden.svg" alt="庭院里的手绘小屋，信箱等着新想法"></section>`
    : `<section class="page-heading"><p class="eyebrow">${state.page === 'ideas' ? 'SEEDS OF SOMETHING GOOD' : state.page === 'projects' ? 'ONE LITTLE STEP AT A TIME' : 'THINGS WE DID TOGETHER'}</p><h1>${copy[state.page][0]}</h1><p>${copy[state.page][1]}</p></section>`;
  const list = pageProjects();
  const availableFilters = state.page === 'projects' ? ['all', 'exploring', 'active'] : state.page === 'memories' ? ['all', 'completed', 'paused'] : ['all', 'idea', 'exploring', 'active'];
  result += `<section><div class="section-head"><div class="section-title">${icon(state.page === 'memories' ? 'book' : 'note')}<h2>${state.page === 'home' ? '最近种下的想法' : '我们的想法'}</h2><span>${list.length} 件</span></div>${state.page === 'home' ? `<button class="text-link" type="button" data-page="ideas">看看全部 ${icon('arrow')}</button>` : `<button class="text-link" type="button" data-action="create">${icon('plus')} 记一个新念头</button>`}</div>${state.page !== 'home' ? `<div class="search-inline"><input name="search" type="search" aria-label="搜索我们的想法" placeholder="找找某个想法……" value="${escape(state.search)}"></div><div class="filters" aria-label="按阶段查看">${availableFilters.map(filter => `<button type="button" class="filter ${state.filter === filter ? 'active' : ''}" data-filter="${filter}" aria-pressed="${state.filter === filter}">${filter === 'all' ? '全部' : stages[filter]}</button>`).join('')}</div>` : ''}<div class="project-grid">${list.length ? list.slice(0, state.page === 'home' ? 5 : 500).map(projectCard).join('') : emptyState()}${list.length && ['home', 'ideas'].includes(state.page) ? `<button class="add-card" type="button" data-action="create">${icon('plus')}<span>种下一个新想法</span><small>一句话，也是一颗种子。</small></button>` : ''}</div></section>`;
  if (state.page === 'home') result += nextSteps();
  return result + `<footer class="page-footer">${icon('leaf')}小事一起做，日子慢慢过。</footer>`;
}
function renderShell() {
  if (!state.user) return renderLogin();
  document.title = `${pages[state.page][0]} · 两人小院`;
  const focusedSearch = document.activeElement?.name === 'search';
  const selection = focusedSearch ? document.activeElement.selectionStart : null;
  const counts = { home: '', ideas: state.projects.length, projects: state.projects.filter(item => ['exploring', 'active'].includes(item.stage)).length, memories: state.projects.filter(item => ['completed', 'paused'].includes(item.stage)).length };
  app.innerHTML = `<div class="shell"><aside class="sidebar">${brand()}<p class="sidebar-note">给彼此留一个念头，<br>也给未来留一点期待。</p><nav class="main-nav" aria-label="小院导航">${Object.entries(pages).map(([page, [label, symbol]]) => `<button type="button" class="nav-item ${state.page === page ? 'active' : ''}" data-page="${page}" ${state.page === page ? 'aria-current="page"' : ''}>${icon(symbol)}<span>${label}</span><span class="nav-count">${counts[page]}</span></button>`).join('')}</nav><div class="sidebar-bottom"><div class="pair-presence">${state.users.map(person => avatar(person.id)).join('')}<span class="presence-text">${state.users.length === 2 ? '我们的两人小院' : '等另一个住户回来'}</span></div><button class="profile-button" type="button" data-action="profile">${avatar(state.user.id)}<span>${escape(state.user.name)}</span>${icon('settings')}</button><p class="sidebar-caption">A GARDEN, JUST FOR TWO.</p></div></aside><main class="workspace"><header class="topbar"><div class="breadcrumb">我们的小院 ${icon('chevron')}<strong>${pages[state.page][0]}</strong></div><div class="mobile-brand"><img src="/favicon.svg" alt=""><span>两人小院</span></div><div class="topbar-actions"><label class="search-box">${icon('search')}<input type="search" name="search" aria-label="搜索我们的想法" placeholder="找找某个想法……" value="${escape(state.search)}"></label><button type="button" class="btn primary" data-action="create">${icon('plus')} 种下一个想法</button><button class="icon-button mobile-profile" type="button" data-action="profile" aria-label="我的设置">${icon('settings')}</button></div></header>${state.demo ? '<div class="demo-strip"><span>示例小院 · 这里的修改只保留在当前页面</span><div><button type="button" data-action="demo-switch">切换住户</button> <button type="button" data-action="exit-demo">回到登录</button></div></div>' : ''}${state.offline ? '<p class="connection-status" role="status">暂时无法同步，已显示上次读取的内容。网络恢复后会自动重试。</p>' : ''}<div id="page-content">${content()}</div></main></div>`;
  if (focusedSearch) {
    const inputs = [...app.querySelectorAll('[name="search"]')];
    const input = inputs.find(item => item.getBoundingClientRect().width > 0);
    input?.focus();
    if (selection !== null) { try { input?.setSelectionRange(selection, selection); } catch { /* search fields may not support text selection */ } }
  }
}
function setPage(page) {
  if (!pages[page]) return;
  state.page = page; state.filter = 'all'; state.search = '';
  history.replaceState(null, '', `#${page}`);
  renderShell(); window.scrollTo({ top: 0, behavior: 'instant' });
}
function taskRows(project) {
  return project.tasks.map(task => `<div class="task-row"><input class="task-check" type="checkbox" ${task.done ? 'checked' : ''} aria-label="完成待办：${escape(task.text)}" data-task-check="${escape(task.id)}" data-project="${escape(project.id)}"><span class="task-text ${task.done ? 'done' : ''}">${escape(task.text)}</span><span class="task-assignee">${task.assigneeId ? escape(user(task.assigneeId).name) : '待认领'}</span><button type="button" class="icon-button" data-action="edit-task" data-id="${escape(task.id)}" aria-label="编辑待办：${escape(task.text)}">${icon('edit')}</button><button type="button" class="icon-button" data-action="delete-task" data-id="${escape(task.id)}" aria-label="删除待办：${escape(task.text)}">${icon('trash')}</button></div>`).join('');
}
function assigneeOptions(selected = null) {
  return `<option value="">先不分工</option>${state.users.map(person => `<option value="${escape(person.id)}" ${person.id === selected ? 'selected' : ''}>${escape(person.name)}</option>`).join('')}`;
}
function captureDrafts(dialog) {
  const drafts = new Map();
  dialog.querySelectorAll('form input[name], form textarea[name], form select[name]').forEach(field => drafts.set(`${field.form?.dataset.form}:${field.name}`, field.value));
  const focused = dialog.contains(document.activeElement) && document.activeElement.name ? { name: document.activeElement.name, form: document.activeElement.form?.dataset.form, start: document.activeElement.selectionStart, end: document.activeElement.selectionEnd } : null;
  return { drafts, focused, scroll: dialog.scrollTop };
}
function restoreDrafts(dialog, snapshot) {
  if (!snapshot) return;
  dialog.querySelectorAll('form input[name], form textarea[name], form select[name]').forEach(field => {
    const key = `${field.form?.dataset.form}:${field.name}`;
    if (snapshot.drafts.has(key)) field.value = snapshot.drafts.get(key);
    if (snapshot.focused?.name === field.name && snapshot.focused.form === field.form?.dataset.form) {
      field.focus({ preventScroll: true });
      try { field.setSelectionRange(snapshot.focused.start, snapshot.focused.end); } catch { /* select/date controls have no text range */ }
    }
  });
  dialog.scrollTop = snapshot.scroll;
}
function noteList(project) {
  const notes = project.notes.filter(note => note.kind === state.noteKind);
  if (!notes.length) return `<p class="notes-empty">${{ comment: '先留一句话吧。一个问题、一个补充，都能让想法更清楚。', resource: '把值得一起看的资料放在这里，链接和阅读笔记都可以。', decision: '聊定的事记下来，下次回来就知道为什么选择这条路。' }[state.noteKind]}</p>`;
  return notes.map(note => `<article class="note"><div class="note-head">${avatar(note.authorId)}<span>${escape(user(note.authorId).name)}</span><time datetime="${escape(note.createdAt)}">${prettyDate(note.createdAt)}</time>${note.authorId === state.user.id ? `<button type="button" class="icon-button" data-action="delete-note" data-id="${escape(note.id)}" aria-label="删除我的这条${noteLabels[note.kind]}">${icon('trash')}</button>` : ''}</div><p class="note-text">${escape(note.text)}</p>${safeUrl(note.url) ? `<a class="note-link" href="${escape(safeUrl(note.url))}" target="_blank" rel="noopener noreferrer">${icon('link')}<span>${escape(new URL(note.url).hostname)} · 打开资料</span>${icon('arrow')}</a>` : ''}</article>`).join('');
}
function renderProject(preserveDrafts = true) {
  const project = state.projects.find(item => item.id === state.projectId);
  if (!project) { if (projectDialog.open) projectDialog.close(); return; }
  const snapshot = preserveDrafts && projectDialog.open ? captureDrafts(projectDialog) : null;
  const myConsent = project.consents.includes(state.user.id);
  const both = state.users.length === 2 && state.users.every(person => project.consents.includes(person.id));
  const done = project.tasks.filter(task => task.done).length;
  projectDialog.innerHTML = `<div class="dialog-top"><span class="eyebrow">OUR THOUGHTS, GROWING TOGETHER</span><div class="dialog-top-actions"><button class="icon-button" type="button" data-action="edit-project" aria-label="编辑这个想法">${icon('edit')}</button><button class="icon-button" type="button" data-close="project-dialog" aria-label="关闭项目">${icon('close')}</button></div></div><div class="detail-body"><div class="detail-heading"><h2>${escape(project.title)}</h2><span class="stage ${escape(project.stage)}">${stages[project.stage]}</span></div><p class="detail-description">${escape(project.description || '这个想法还在发芽，欢迎一起补充。')}</p><div class="detail-author">${avatar(project.authorId)}${escape(user(project.authorId).name)} 种下的想法<span>·</span>${prettyDate(project.createdAt, true)}</div><div class="consent-bar"><div class="consent-copy"><strong>${both ? '这件事，我们都想一起做。' : '要不要一起试试？慢慢想也没关系。'}</strong><span>${state.users.map(person => `${escape(person.name)}：${project.consents.includes(person.id) ? '愿意一起做' : '还在考虑'}`).join('　·　')}${state.users.length < 2 ? '　·　另一个住户还没入住' : ''}</span></div><button type="button" class="btn ${myConsent ? '' : 'primary'} compact" data-action="consent">${myConsent ? icon('check') + ' 我已确认 · 撤回' : icon('sprout') + ' 我想一起做'}</button></div><div class="detail-columns"><div><section class="detail-section"><h3>${icon('sprout')}这次想一起做到什么<button type="button" class="text-link" data-action="edit-project">${icon('edit')} 编辑</button></h3>${project.goal ? `<p class="goal-box">${escape(project.goal)}</p>` : '<p class="goal-placeholder">先约定一个小目标吧，例如：完成一轮调研，再一起决定要不要开始。</p>'}</section><section class="detail-section"><h3>${icon('check')}接下来，各做一小步</h3><div class="task-list">${taskRows(project)}</div>${!project.tasks.length ? '<p class="goal-placeholder">把大想法拆小一点，下一步就更容易开始。</p>' : ''}<form class="task-form" data-form="task"><input name="text" aria-label="新的待办" placeholder="写下一件具体的小事……" maxlength="300" required><select name="assigneeId" aria-label="这件事由谁来做">${assigneeOptions()}</select><button class="btn soft" type="submit" aria-label="添加待办">${icon('plus')}</button><p class="form-error" data-error role="alert" hidden></p></form></section><section class="detail-section"><div class="notes-tabs" role="tablist" aria-label="项目记录">${Object.entries(noteLabels).map(([kind, label]) => `<button class="notes-tab ${kind === state.noteKind ? 'active' : ''}" type="button" role="tab" id="notes-tab-${kind}" aria-selected="${kind === state.noteKind}" aria-controls="notes-panel" data-note-kind="${kind}">${label} ${project.notes.filter(note => note.kind === kind).length || ''}</button>`).join('')}</div><div id="notes-panel" role="tabpanel" aria-labelledby="notes-tab-${state.noteKind}">${noteList(project)}</div><form class="note-form" data-form="note"><label class="sr-only" for="note-text">${noteLabels[state.noteKind]}内容</label><textarea id="note-text" name="text" placeholder="${{ comment: '说说你的想法，或者问对方一个问题……', resource: '这份资料讲了什么？哪些地方值得一起看看？', decision: '我们决定了什么？为什么这样选？' }[state.noteKind]}" maxlength="8000" required></textarea>${state.noteKind === 'resource' ? '<label class="sr-only" for="resource-url">资料链接（选填）</label><input id="resource-url" name="url" type="url" placeholder="资料链接，https://……（选填）" maxlength="2048">' : ''}<p class="form-error" data-error role="alert" hidden></p><div class="note-form-footer"><span>${state.noteKind === 'decision' ? '留下你们聊定的结果和原因。' : '一句话，也可以让对方更了解你的想法。'}</span><button class="btn primary compact" type="submit">${state.noteKind === 'comment' ? '留句话' : state.noteKind === 'resource' ? '收好资料' : '记下决定'} ${icon('arrow')}</button></div></form></section></div><aside class="detail-sidebar"><section class="detail-section"><p class="side-label">这件事的阶段</p><label class="sr-only" for="stage-select">项目阶段</label><select class="stage-select" id="stage-select" data-stage-select>${Object.entries(stages).map(([stage, label]) => `<option value="${stage}" ${project.stage === stage ? 'selected' : ''} ${!both && ['exploring', 'active', 'completed'].includes(stage) && project.stage !== stage ? 'disabled' : ''}>${label}</option>`).join('')}</select><p class="stage-hint">${both ? '想法和计划，都可以随着了解慢慢调整。' : '两个人都确认后，就能一起探索、行动或完成。已有记录都会保留。'}</p></section><section class="detail-section"><p class="side-label">一起迈出的小步</p><div class="mini-progress"><span>已完成</span><span>${done} / ${project.tasks.length}</span></div><div class="progress-track" role="progressbar" aria-label="待办完成进度" aria-valuenow="${done}" aria-valuemin="0" aria-valuemax="${Math.max(1, project.tasks.length)}"><div class="progress-fill" style="width:${project.tasks.length ? Math.round(done / project.tasks.length * 100) : 0}%"></div></div><p class="progress-note">每一小步，都算数。</p></section><section class="detail-section review-section"><p class="side-label">下次一起聊聊</p><p class="small">${prettyDate(project.nextReviewAt, true)}</p><button class="text-link" type="button" data-action="edit-project">${icon('calendar')} ${project.nextReviewAt ? '调整日期' : '约个日子'}</button></section></aside></div><div class="detail-controls"><button class="btn quiet compact" type="button" data-action="export-project">${icon('download')} 留一份记录</button>${project.authorId === state.user.id ? `<button class="btn quiet compact danger" type="button" data-action="delete-project">${icon('trash')} 删除这个想法</button>` : ''}</div></div>`;
  restoreDrafts(projectDialog, snapshot);
}
function openProject(id) {
  if (!state.projects.some(project => project.id === id)) return;
  state.projectId = id; state.noteKind = 'comment';
  renderProject(false); showDialog(projectDialog);
}

function openLinkedProject() {
  const id = new URLSearchParams(location.search).get('project');
  if (id && state.projects.some(project => project.id === id)) openProject(id);
}
function editorHeader(title, copy) {
  return `<div class="dialog-top"><span class="eyebrow">A SMALL SEED, A SHARED FUTURE</span><button class="icon-button" type="button" data-close="editor-dialog" aria-label="关闭编辑">${icon('close')}</button></div><div class="editor-body"><h2>${title}</h2><p>${copy}</p>`;
}
function openEditor(project = null) {
  editorDialog.innerHTML = `${editorHeader(project ? '把想法聊得更清楚' : '种下一个新想法', project ? '共同目标和下一步，都可以慢慢调整。' : '先写下一句话就好，剩下的等我们一起聊。')}<form data-form="${project ? 'project-edit' : 'project-create'}"><label class="field">我们想一起做什么<input name="title" placeholder="例如：一起探索跨境电商" maxlength="120" value="${escape(project?.title || '')}" required></label><label class="field">为什么想做？有什么初步想法？<textarea name="description" placeholder="让对方看见这个念头背后的你……" maxlength="4000">${escape(project?.description || '')}</textarea></label>${project ? `<label class="field">这次的小目标<textarea name="goal" placeholder="例如：完成一轮调研，再一起决定是否开始。" maxlength="4000">${escape(project.goal)}</textarea></label><label class="field">下次一起聊聊的日期（选填）<input name="nextReviewAt" type="date" value="${escape(dayValue(project.nextReviewAt))}"><small>这是你们约定的日期，会显示在项目里。</small></label>` : ''}<p class="form-error" data-error role="alert" hidden></p><div class="editor-actions"><button class="btn quiet" type="button" data-close="editor-dialog">再想想</button><button class="btn primary" type="submit">${project ? '保存想法' : '种下这颗想法'} ${icon('leaf')}</button></div></form></div>`;
  showDialog(editorDialog);
}
function openTaskEditor(task) {
  editorDialog.innerHTML = `${editorHeader('把下一步写具体', '一件小事，选好负责人，就能慢慢开始。')}<form data-form="task-edit" data-id="${escape(task.id)}"><label class="field">这一步做什么<input name="text" maxlength="300" value="${escape(task.text)}" required></label><label class="field">谁来推进<select name="assigneeId">${assigneeOptions(task.assigneeId)}</select></label><p class="form-error" data-error role="alert" hidden></p><div class="editor-actions"><button class="btn quiet" type="button" data-close="editor-dialog">取消</button><button class="btn primary" type="submit">保存这一小步</button></div></form></div>`;
  showDialog(editorDialog);
}
function confirm(title, copy, action) {
  confirmAction = action;
  editorDialog.innerHTML = `${editorHeader(escape(title), escape(copy))}<form data-form="confirm"><p class="form-error" data-error role="alert" hidden></p><div class="editor-actions"><button class="btn quiet" type="button" data-close="editor-dialog">留下它</button><button class="btn danger" type="submit">确认删除</button></div></form></div>`;
  showDialog(editorDialog);
}
function renderProfile() {
  profileDialog.innerHTML = `<div class="dialog-top"><span class="eyebrow">YOUR LITTLE CORNER</span><button class="icon-button" type="button" data-close="profile-dialog" aria-label="关闭我的设置">${icon('close')}</button></div><div class="editor-body"><h2>你的小小角落</h2><p>${state.demo ? '这里的修改只影响当前示例，回到登录后就会清空。' : '给自己换个昵称，也可以更新小院的登录密码。'}</p><form data-form="profile"><label class="field">小院里的名字<input name="name" maxlength="40" value="${escape(state.user.name)}" autocomplete="username" required></label>${!state.demo ? '<div class="profile-divider"></div><label class="field">当前密码<input name="currentPassword" type="password" autocomplete="current-password" maxlength="256" placeholder="修改密码时填写"></label><label class="field">新密码<input name="newPassword" type="password" autocomplete="new-password" minlength="12" maxlength="256" placeholder="至少 12 个字符，留空就保持原密码"></label><label class="field">再确认一次新密码<input name="passwordConfirmation" type="password" autocomplete="new-password" minlength="12" maxlength="256" placeholder="再输入一次新密码"></label>' : ''}<p class="form-error" data-error role="alert" hidden></p><div class="editor-actions"><button class="btn primary" type="submit">保存设置 ${icon('check')}</button></div></form>${!state.demo ? `<section id="pairing-settings" class="garden-pairing">${renderPairing(state.garden, state.invite)}</section>` : ''}<div class="profile-divider"></div><div class="profile-tools"><button class="btn quiet compact" type="button" data-action="export-all">${icon('download')} 导出我们的记录</button><button class="btn quiet compact" type="button" data-action="logout">${icon('logout')} ${state.demo ? '回到登录' : '退出小院'}</button></div></div>`;
  showDialog(profileDialog);
}
function download(data, filename) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('已经给这份记录留好副本。');
}
function sampleState() {
  const now = new Date().toISOString();
  const earlier = new Date(Date.now() - 86400000 * 2).toISOString();
  const users = [{ id: 'demo-me', name: '小禾' }, { id: 'demo-partner', name: '阿树' }];
  return { users, projects: [
    { id: 'demo-business', title: '一起探索跨境电商', description: '想把这个念头认真聊一聊。先收集问题和资料，再一起决定是否尝试，走多快都可以商量。', stage: 'exploring', authorId: users[0].id, goal: '完成第一轮调研，一起决定是否迈出下一步。', nextReviewAt: null, createdAt: earlier, updatedAt: now, consents: users.map(person => person.id), tasks: [{ id: 'demo-task-1', text: '列出我们最想弄清楚的三个问题', assigneeId: users[0].id, done: true }, { id: 'demo-task-2', text: '整理候选产品方向和参考资料', assigneeId: users[1].id, done: false }, { id: 'demo-task-3', text: '一起聊聊能投入的时间与分工', assigneeId: null, done: false }], notes: [{ id: 'demo-note-1', kind: 'comment', text: '我们先把各自感兴趣的方向写下来吧，看看有没有交集。', authorId: users[1].id, createdAt: earlier }, { id: 'demo-note-2', kind: 'decision', text: '先做一轮共同调研，把问题和资料放在一起，再商量要不要继续。', authorId: users[0].id, createdAt: now }] },
    { id: 'demo-weekend', title: '每个月，留一个周末做点新鲜事', description: '可以学做一道菜，也可以去一个没去过的地方。先各自提几个想法，挑一个都心动的。', stage: 'idea', authorId: users[1].id, goal: '', nextReviewAt: null, createdAt: earlier, updatedAt: earlier, consents: [users[1].id], tasks: [], notes: [] },
  ] };
}
function enterDemo() {
  Object.assign(state, sampleState(), { demo: true, user: { id: 'demo-me', name: '小禾' }, page: 'home', filter: 'all', search: '', offline: false });
  renderShell();
}
async function exitDemo() {
  closeDialogs();
  Object.assign(state, { demo: false, user: null, users: [], projects: [], csrfToken: '', page: 'home', search: '' });
  await initialize();
}
async function demoRequest(path, method, body = {}) {
  if (method === 'GET' && path === '/api/state') return { users: structuredClone(state.users), projects: structuredClone(state.projects) };
  if (path === '/api/auth/me') {
    const name = String(body.name || '').trim();
    if (!name || name.length > 40) throw new Error('昵称需为 1 到 40 个字符。');
    if (state.users.some(person => person.id !== state.user.id && person.name === name)) throw new Error('这个昵称已经有人使用了。');
    state.users.find(person => person.id === state.user.id).name = name;
    return { user: { ...state.user, name }, csrfToken: '', setupRequired: false };
  }
  if (path === '/api/projects' && method === 'POST') {
    const title = String(body.title || '').trim();
    if (!title || title.length > 120) throw new Error('标题需为 1 到 120 个字符。');
    const project = { id: crypto.randomUUID(), title, description: String(body.description || '').trim(), goal: '', stage: 'idea', authorId: state.user.id, nextReviewAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), consents: [], tasks: [], notes: [] };
    return { project };
  }
  const parts = path.split('/').filter(Boolean);
  const original = state.projects.find(project => project.id === parts[2]);
  if (!original) throw new Error('找不到这个想法。');
  const project = structuredClone(original);
  if (parts.length === 3) {
    if (method === 'DELETE') { if (project.authorId !== state.user.id) throw new Error('只有发起人可以删除。'); return { ok: true }; }
    if (['exploring', 'active', 'completed'].includes(body.stage) && body.stage !== project.stage && project.consents.length !== 2) throw new Error('需要两个人都确认想一起做，才能进入这个阶段。');
    Object.assign(project, body);
  } else if (parts[3] === 'consent') {
    if (project.consents.includes(state.user.id)) project.consents = project.consents.filter(id => id !== state.user.id);
    else project.consents.push(state.user.id);
    if (project.consents.length === 2 && project.stage === 'idea') project.stage = 'exploring';
  } else if (parts[3] === 'tasks') {
    if (method === 'POST') project.tasks.push({ id: crypto.randomUUID(), text: String(body.text).trim(), assigneeId: body.assigneeId || null, done: false });
    else if (method === 'PATCH') Object.assign(project.tasks.find(task => task.id === parts[4]), body);
    else project.tasks = project.tasks.filter(task => task.id !== parts[4]);
  } else if (parts[3] === 'notes') {
    if (method === 'POST') {
      if (body.url && !safeUrl(body.url)) throw new Error('资料链接需为完整的 http 或 https 地址。');
      project.notes.push({ id: crypto.randomUUID(), ...body, authorId: state.user.id, createdAt: new Date().toISOString() });
    } else {
      const note = project.notes.find(item => item.id === parts[4]);
      if (note?.authorId !== state.user.id) throw new Error('只能删除自己写下的记录。');
      project.notes = project.notes.filter(item => item.id !== parts[4]);
    }
  }
  project.updatedAt = new Date().toISOString();
  return { project };
}

document.addEventListener('click', async event => {
  const target = event.target.closest('button, a.brand');
  if (!target) return;
  if (target.matches('a.brand')) { event.preventDefault(); if (state.user) setPage('home'); return; }
  if (target.dataset.close) { document.getElementById(target.dataset.close)?.close(); return; }
  if (target.dataset.page) { setPage(target.dataset.page); return; }
  if (target.dataset.filter) { state.filter = target.dataset.filter; renderShell(); return; }
  if (target.dataset.noteKind) { state.noteKind = target.dataset.noteKind; renderProject(false); return; }
  const action = target.dataset.action;
  if (!action) return;
  const project = state.projects.find(item => item.id === state.projectId);
  try {
    switch (action) {
      case 'auth-mode': state.authMode = target.dataset.mode === 'register' ? 'register' : 'login'; renderLogin(); break;
      case 'create-invite': {
        target.disabled = true; const result = await api('/api/garden/invite', 'POST', {}); state.invite = result.invite;
        const pairing = document.getElementById('pairing-settings'); if (pairing) pairing.innerHTML = renderPairing(state.garden, state.invite);
        toast('邀请码准备好了，交给你的伴侣吧。'); break;
      }
      case 'copy-invite': toast(await copyInvitation(state.invite)); break;
      case 'demo': enterDemo(); break;
      case 'exit-demo': await exitDemo(); break;
      case 'demo-switch': state.user = state.users.find(person => person.id !== state.user.id); renderShell(); if (projectDialog.open) renderProject(); toast(`现在以 ${state.user.name} 的身份逛示例小院。`); break;
      case 'create': openEditor(); break;
      case 'open': openProject(target.dataset.id); break;
      case 'edit-project': if (project) openEditor(project); break;
      case 'profile': renderProfile(); break;
      case 'consent': target.disabled = true; await mutateProject(`/api/projects/${project.id}/consent`, 'POST', {}); toast('你的想法已经留给对方了。'); break;
      case 'edit-task': openTaskEditor(project.tasks.find(task => task.id === target.dataset.id)); break;
      case 'delete-task': target.disabled = true; await mutateProject(`/api/projects/${project.id}/tasks/${target.dataset.id}`, 'DELETE', {}); toast('已移除这条待办。'); break;
      case 'delete-note': confirm('删除这条记录？', '删除后，这条记录会从你们的小院移除。', async () => { await mutateProject(`/api/projects/${project.id}/notes/${target.dataset.id}`, 'DELETE', {}); toast('已删除这条记录。'); }); break;
      case 'delete-project': confirm('删除整个想法？', '这张想法卡，以及它的讨论、资料和待办，都会一并删除。', async () => { await api(`/api/projects/${project.id}`, 'DELETE', {}); state.projects = state.projects.filter(item => item.id !== project.id); projectDialog.close(); renderShell(); toast('已删除这个想法。'); }); break;
      case 'export-project': download({ exportedAt: new Date().toISOString(), users: state.users, project }, 'our-garden-project.json'); break;
      case 'export-all': download({ exportedAt: new Date().toISOString(), users: state.users, projects: state.projects }, 'our-garden-records.json'); break;
      case 'logout': if (state.demo) await exitDemo(); else { await api('/api/auth/logout', 'POST', {}); state.user = null; state.garden = null; state.invite = null; state.authMode = 'login'; state.projects = []; state.users = []; state.csrfToken = ''; closeDialogs(); renderLogin(); } break;
    }
  } catch (error) { toast(error.message, true); target.disabled = false; }
});
document.addEventListener('input', event => {
  if (event.target.name === 'search') { state.search = event.target.value; if (!event.isComposing) renderShell(); }
});
document.addEventListener('compositionend', event => {
  if (event.target.name === 'search') { state.search = event.target.value; renderShell(); }
});
document.addEventListener('keydown', event => {
  const current = event.target.closest('[data-note-kind]');
  if (!current || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const kinds = Object.keys(noteLabels);
  const currentIndex = kinds.indexOf(current.dataset.noteKind);
  const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? kinds.length - 1 : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + kinds.length) % kinds.length;
  state.noteKind = kinds[nextIndex];
  renderProject(false);
  projectDialog.querySelector(`[data-note-kind="${state.noteKind}"]`)?.focus();
});
document.addEventListener('change', async event => {
  const target = event.target;
  if (target.dataset.taskCheck) {
    target.disabled = true;
    try { await mutateProject(`/api/projects/${target.dataset.project}/tasks/${target.dataset.taskCheck}`, 'PATCH', { done: target.checked }); }
    catch (error) { target.checked = !target.checked; target.disabled = false; toast(error.message, true); }
  }
  if (target.hasAttribute('data-stage-select')) {
    const project = state.projects.find(item => item.id === state.projectId);
    target.disabled = true;
    try { await mutateProject(`/api/projects/${project.id}`, 'PATCH', { stage: target.value }); toast('已经收好这次进展。'); }
    catch (error) { target.value = project.stage; target.disabled = false; toast(error.message, true); }
  }
});
document.addEventListener('submit', event => {
  const form = event.target;
  const kind = form.dataset.form;
  if (!kind) return;
  event.preventDefault();
  const values = Object.fromEntries(new FormData(form));
  const projectId = state.projectId;
  busy(form, async () => {
    switch (kind) {
      case 'register':
      case 'login': {
        if (kind === 'register' && values.password !== values.passwordConfirmation) throw new Error('两次密码不一致，请再检查一下。');
        const auth = await api(kind === 'register' ? '/api/auth/register' : '/api/auth/login', 'POST', values);
        state.invite = null; state.authMode = 'login';
        Object.assign(state, auth, { demo: false, page: 'home', filter: 'all', search: '' });
        await loadState(); renderShell(); openLinkedProject(); if (kind === 'register' && state.garden?.canInvite) renderProfile(); break;
      }
      case 'garden-join': {
        const auth = await api('/api/garden/join', 'POST', { code: values.code, shareExisting: values.shareExisting === 'yes' });
        Object.assign(state, auth); state.invite = null; await loadState(); profileDialog.close(); renderShell(); toast('连接好了，今后的念头一起记住。'); break;
      }
      case 'project-create': {
        const result = await mutateProject('/api/projects', 'POST', { title: values.title, description: values.description });
        editorDialog.close(); openProject(result.project.id); toast('新想法已经种下，等对方来看看。'); break;
      }
      case 'project-edit': await mutateProject(`/api/projects/${projectId}`, 'PATCH', { title: values.title, description: values.description, goal: values.goal, nextReviewAt: values.nextReviewAt || null }); editorDialog.close(); toast('已经收好你们的想法。'); break;
      case 'task': {
        const result = await api(`/api/projects/${projectId}/tasks`, 'POST', { text: values.text, assigneeId: values.assigneeId || null });
        form.reset(); applyProject(result.project); toast('下一小步，记好了。'); break;
      }
      case 'task-edit': await mutateProject(`/api/projects/${projectId}/tasks/${form.dataset.id}`, 'PATCH', { text: values.text, assigneeId: values.assigneeId || null }); editorDialog.close(); toast('已更新这一小步。'); break;
      case 'note': {
        const result = await api(`/api/projects/${projectId}/notes`, 'POST', { kind: state.noteKind, text: values.text, ...(values.url ? { url: values.url } : {}) });
        form.reset(); applyProject(result.project); toast('已经好好收下这句话。'); break;
      }
      case 'profile': {
        if (values.newPassword !== values.passwordConfirmation) throw new Error('两次新密码不一致，请再核对一下。');
        const auth = await api('/api/auth/me', 'PATCH', { name: values.name, ...(values.newPassword ? { currentPassword: values.currentPassword, newPassword: values.newPassword } : {}) });
        Object.assign(state, auth); await loadState(); profileDialog.close(); renderShell(); if (projectDialog.open) renderProject(); toast('你的小小角落，更新好了。'); break;
      }
      case 'confirm': if (confirmAction) { await confirmAction(); confirmAction = null; editorDialog.close(); } break;
    }
  });
});
projectDialog.addEventListener('close', () => { state.projectId = null; projectDialog.innerHTML = ''; });
for (const dialog of [projectDialog, editorDialog, profileDialog]) {
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });
}
window.addEventListener('hashchange', () => {
  const page = location.hash.slice(1);
  if (state.user && pages[page] && state.page !== page) setPage(page);
});
window.addEventListener('online', () => refresh());
async function refresh() {
  if (!state.user || state.demo || refreshPending || document.hidden || [projectDialog, editorDialog, profileDialog].some(dialog => dialog.open) || ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
  refreshPending = true;
  try { await loadState(); renderShell(); }
  catch (error) { if (state.user) { state.offline = true; renderShell(); } }
  finally { refreshPending = false; }
}
setInterval(refresh, 15000);
async function initialize() {
  try {
    Object.assign(state, await api('/api/auth/state'));
    if (state.user) { state.page = pages[location.hash.slice(1)] ? location.hash.slice(1) : 'home'; await loadState(); renderShell(); openLinkedProject(); }
    else renderLogin();
  } catch (error) { renderLogin(error.message); }
}
initialize();
