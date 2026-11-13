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
  if (members.length === 2) return `<h2>我们已经连接好了</h2>${people}<p class="garden-account-help">想法、共同目标和新消息，都只在你们两人之间同步。</p>`;
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
