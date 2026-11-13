import { randomBytes, randomUUID } from 'node:crypto';
import { transaction } from './db.mjs';
import { hashPassword, HttpError, tokenHash, validateName } from './security.mjs';

export function gardenFor(db, userId) {
  const membership = db.prepare('SELECT garden_id FROM garden_members WHERE user_id = ?').get(userId);
  if (!membership) throw new HttpError(401, '账号暂未连接小花园，请重新登录。');
  const members = db.prepare('SELECT u.id, u.name FROM users u JOIN garden_members m ON m.user_id = u.id WHERE m.garden_id = ? ORDER BY u.created_at, u.id').all(membership.garden_id).map(row => ({ ...row }));
  const projectCount = db.prepare('SELECT COUNT(*) AS count FROM projects WHERE garden_id = ?').get(membership.garden_id).count;
  return { id: membership.garden_id, members, projectCount, canInvite: members.length === 1, canJoin: members.length === 1 };
}

function invitation(db, value) {
  if (typeof value !== 'string' || value.length > 80) throw new HttpError(400, '邀请码无效或已过期，请让伴侣重新生成。');
  const code = value.replace(/[\s-]/g, '').toUpperCase();
  if (!/^[A-F0-9]{32}$/.test(code)) throw new HttpError(400, '邀请码无效或已过期，请让伴侣重新生成。');
  const invite = db.prepare('SELECT garden_id, created_by FROM garden_invites WHERE token_hash = ? AND expires_at > ?').get(tokenHash(code), Date.now());
  if (!invite) throw new HttpError(400, '邀请码无效或已过期，请让伴侣重新生成。');
  if (db.prepare('SELECT COUNT(*) AS count FROM garden_members WHERE garden_id = ?').get(invite.garden_id).count !== 1) throw new HttpError(409, '这个小花园已经住满两个人。');
  return invite;
}

export async function registerAccount(db, { name: input, password, inviteCode }) {
  const name = validateName(input);
  if (db.prepare('SELECT id FROM users WHERE name = ? COLLATE NOCASE').get(name)) throw new HttpError(409, '这个登录昵称已经有人使用，请换一个。');
  const joining = typeof inviteCode === 'string' && inviteCode.trim() !== '';
  if (inviteCode !== undefined && typeof inviteCode !== 'string') throw new HttpError(400, '邀请码格式不正确。');
  if (joining) invitation(db, inviteCode);
  const passwordHash = await hashPassword(password);
  return transaction(db, () => {
    if (db.prepare('SELECT id FROM users WHERE name = ? COLLATE NOCASE').get(name)) throw new HttpError(409, '这个登录昵称已经有人使用，请换一个。');
    const invite = joining ? invitation(db, inviteCode) : null;
    const gardenId = invite?.garden_id || randomUUID();
    const user = { id: randomUUID(), name };
    const now = new Date().toISOString();
    if (!invite) db.prepare('INSERT INTO gardens (id, created_at) VALUES (?, ?)').run(gardenId, now);
    db.prepare('INSERT INTO users (id, name, password_hash, created_at) VALUES (?, ?, ?, ?)').run(user.id, name, passwordHash, now);
    db.prepare('INSERT INTO garden_members (user_id, garden_id) VALUES (?, ?)').run(user.id, gardenId);
    if (invite) db.prepare('DELETE FROM garden_invites WHERE garden_id = ?').run(gardenId);
    return user;
  });
}

export function createInvitation(db, userId) {
  return transaction(db, () => {
    const garden = gardenFor(db, userId);
    if (!garden.canInvite) throw new HttpError(409, '你们已经连接好了，每个小花园只住两个人。');
    const raw = randomBytes(16).toString('hex').toUpperCase();
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
    db.prepare('INSERT INTO garden_invites (garden_id, token_hash, created_by, expires_at) VALUES (?, ?, ?, ?) ON CONFLICT(garden_id) DO UPDATE SET token_hash = excluded.token_hash, created_by = excluded.created_by, expires_at = excluded.expires_at')
      .run(garden.id, tokenHash(raw), userId, expiresAt);
    return { code: raw.match(/.{8}/g).join('-'), expiresAt: new Date(expiresAt).toISOString() };
  });
}

export function joinGarden(db, userId, { code, shareExisting = false }) {
  if (typeof shareExisting !== 'boolean') throw new HttpError(400, '请选择是否一起分享已有记录。');
  return transaction(db, () => {
    const current = gardenFor(db, userId);
    if (!current.canJoin) throw new HttpError(409, '你已经和伴侣连接好了，不能加入另一个小花园。');
    const target = invitation(db, code);
    if (target.garden_id === current.id) throw new HttpError(400, '这是你自己的邀请码，请交给伴侣使用。');
    if (current.projectCount && !shareExisting) throw new HttpError(409, '加入后，当前小花园的记录也会分享给伴侣。请先勾选确认。');
    const targetCount = db.prepare('SELECT COUNT(*) AS count FROM projects WHERE garden_id = ?').get(target.garden_id).count;
    if (targetCount + current.projectCount > 500) throw new HttpError(409, '两个小花园合计超过 500 条记录，请先整理后再加入。');
    db.prepare('UPDATE garden_members SET garden_id = ? WHERE user_id = ?').run(target.garden_id, userId);
    db.prepare('UPDATE projects SET garden_id = ? WHERE garden_id = ?').run(target.garden_id, current.id);
    db.prepare('DELETE FROM garden_invites WHERE garden_id IN (?, ?)').run(current.id, target.garden_id);
    if (current.id !== 'legacy') db.prepare('DELETE FROM gardens WHERE id = ?').run(current.id);
    return { previousGardenId: current.id, garden: gardenFor(db, userId) };
  });
}
