const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

export function renderAccountForm(mode = 'login', error = '') {
  const registering = mode === 'register';
  return `<div class="garden-auth-tabs" aria-label="账号入口"><button type="button" class="garden-auth-tab ${!registering ? 'active' : ''}" data-action="auth-mode" data-mode="login" aria-pressed="${!registering}">登录</button><button type="button" class="garden-auth-tab ${registering ? 'active' : ''}" data-action="auth-mode" data-mode="register" aria-pressed="${registering}">注册新账号</button></div>
    <form id="${registering ? 'register' : 'login'}-form" data-form="${registering ? 'register' : 'login'}" class="login-form">
      <label class="field">登录昵称<input name="name" autocomplete="username" maxlength="40" required placeholder="小花园里独一份的名字"></label>
      <label class="field">密码<input name="password" type="password" autocomplete="${registering ? 'new-password' : 'current-password'}" ${registering ? 'minlength="12"' : ''} maxlength="256" required placeholder="${registering ? '至少 12 个字符' : '你的登录密码'}"></label>
      ${registering ? '<label class="field">确认密码<input name="passwordConfirmation" type="password" autocomplete="new-password" minlength="12" maxlength="256" required placeholder="再输入一次密码"></label><label class="field">伴侣的邀请码（选填）<input name="inviteCode" autocomplete="off" maxlength="80" spellcheck="false" placeholder="有邀请码，就一起入住"></label><p class="garden-account-help">不填邀请码会创建自己的小花园，注册后再邀请伴侣。每个小花园只住两个人。</p>' : ''}
      <p id="login-error" class="error-text form-error" data-error role="alert" ${error ? '' : 'hidden'}>${escape(error)}</p>
      <button type="submit" class="btn primary garden-auth-submit">${registering ? '注册并入住小花园' : '登录我们的小花园'} <span aria-hidden="true">→</span></button>
    </form>`;
}

export function renderPairing(garden, invite, pendingCount = 0) {
  if (!garden) return '';
  const members = garden.members || [];
  const people = `<div class="garden-members">${members.map(member => `<span class="garden-member"><span aria-hidden="true">${escape(Array.from(member.name)[0])}</span>${escape(member.name)}</span>`).join('<span aria-hidden="true">♡</span>')}</div>`;
  if (members.length === 2) return `<h2>我们已经连接好了</h2>${people}<p class="garden-account-help">想法、共同目标和新消息，都只在你们两人之间同步。</p><button type="button" class="danger-link" data-action="unlink-open">解除伴侣绑定</button>`;
  const existing = (garden.projectCount || 0) + pendingCount;
  return `<h2>邀请伴侣，一起入住</h2>${people}<p class="garden-account-help">把邀请码发给伴侣，TA 可以在注册时填写，也可以登录后在这里加入。加入后，TA 能看到这个小花园已有的记录。</p>
    ${invite ? `<label class="field">伴侣邀请码<div class="garden-code-row"><input id="garden-invite-code" value="${escape(invite.code)}" readonly aria-label="伴侣邀请码"><button type="button" class="btn soft tiny" data-action="copy-invite">复制</button></div></label><p class="garden-account-help">有效至 ${escape(new Date(invite.expiresAt).toLocaleString('zh-CN', { hour12: false }))}，只能使用一次。</p>` : ''}
    <button type="button" class="btn soft tiny" data-action="create-invite">${invite ? '重新生成邀请码' : '生成伴侣邀请码'}</button>
    <p class="garden-account-help">邀请码只交给伴侣。重新生成后，旧邀请码立即失效。</p>
    <div class="garden-join-divider"></div><h3>已经收到 TA 的邀请码？</h3>
    <form id="garden-join-form" data-form="garden-join" class="garden-join-form"><label class="field">输入伴侣的邀请码<input name="code" autocomplete="off" maxlength="80" required spellcheck="false" placeholder="粘贴 TA 发来的邀请码"></label>
      ${existing ? `<label class="garden-share-consent"><input name="shareExisting" type="checkbox" value="yes" required><span>我同意把当前的 ${existing} 条记录（含待发送）一起带过去，分享给伴侣。</span></label>` : '<p class="garden-account-help">加入后，你们就能一起查看和记录想法。</p>'}
      <p class="form-error error-text" data-error role="alert" hidden></p><button type="submit" class="btn primary tiny">加入 TA 的小花园 <span aria-hidden="true">→</span></button>
    </form>`;
}

export async function copyInvitation(invite) {
  if (!invite?.code) throw new Error('请先生成一个邀请码。');
  try { await navigator.clipboard.writeText(invite.code); return '邀请码已复制，交给你的伴侣吧。'; }
  catch {
    const input = document.getElementById('garden-invite-code'); input?.focus(); input?.select();
    return '邀请码已选中，按 Ctrl+C（Mac 为 ⌘C）复制。';
  }
}

export function renderUnlinkConfirmation() {
  return `<h2>解除伴侣绑定</h2><p class="garden-account-help">解绑后，两个人会各自回到独立的小花园。新的想法和目标不再互相可见；过去的共同记录会保留为双方各自可查看的只读历史，不会交给以后连接的伴侣。</p><form id="garden-unlink-form" data-form="garden-unlink"><label class="garden-share-consent"><input type="checkbox" name="confirm" value="yes" required><span>我已了解记录保留方式，确认解除当前绑定。</span></label><p class="form-error error-text" data-error role="alert" hidden></p><div class="form-actions"><button type="button" class="btn soft tiny" data-action="unlink-cancel">暂不解绑</button><button type="submit" class="btn tiny danger-link">确认解绑</button></div></form>`;
}

export function renderArchiveLinks(archives = []) {
  return archives.length ? `<section class="garden-pairing"><h2>过去的共同记录</h2>${archives.map(item => `<button type="button" class="text-link archive-link" data-action="archive-open" data-id="${escape(item.id)}">${escape(item.participants.map(p => p.name).join(' 与 '))} · ${item.projectCount} 条记录</button>`).join('')}</section>` : '';
}

export function renderArchive(archive) {
  const names = new Map(archive.participants.map(p => [p.id, p.name]));
  const person = id => escape(names.get(id) || '当时的成员');
  return `<button type="button" class="back" data-action="archive-back">返回设置</button><h1 class="settings-title">过去的共同记录</h1><p class="garden-account-help">${escape(archive.participants.map(p => p.name).join(' 与 '))} · 已于 ${escape(new Date(archive.archivedAt).toLocaleDateString('zh-CN'))} 归档。这些记录仅当时的两个人可查看，内容保持只读。</p>${archive.projects.length ? archive.projects.map(item => `<details class="archive-record"><summary>${escape(item.title)}</summary><p class="garden-account-help">${person(item.authorId)} 留下的</p><p class="original">${escape(item.capture?.originalText || item.description)}</p>${item.goal ? `<h3>当时的共同目标</h3><p class="original">${escape(item.goal)}</p>` : ''}${item.tasks.map(task => `<p>${task.done ? '☑' : '☐'} ${escape(task.text)} · ${task.assigneeId ? person(task.assigneeId) : '未分工'}</p>`).join('')}${item.notes.map(note => `<article class="note"><small>${person(note.authorId)} · ${escape(new Date(note.createdAt).toLocaleDateString('zh-CN'))}</small><p>${escape(note.text)}</p></article>`).join('')}</details>`).join('') : '<p class="garden-account-help">当时还没有留下共同记录。</p>'}`;
}
