import { randomUUID } from 'node:crypto';
import { hashPassword, validateName, HttpError } from './security.mjs';
import { transaction } from './db.mjs';

export async function createAccount(db, { name: input, password }) {
  const name = validateName(input);
  if (db.prepare('SELECT COUNT(*) AS count FROM users').get().count >= 2) throw new HttpError(409, '这个小家最多只能拥有两位成员。');
  if (db.prepare('SELECT id FROM users WHERE name = ? COLLATE NOCASE').get(name)) throw new HttpError(409, '这个昵称已经有人使用了。');
  const passwordHash = await hashPassword(password);
  const user = { id: randomUUID(), name };
  return transaction(db, () => {
    if (db.prepare('SELECT COUNT(*) AS count FROM users').get().count >= 2) throw new HttpError(409, '这个小家最多只能拥有两位成员。');
    db.prepare('INSERT INTO users (id, name, password_hash, created_at) VALUES (?, ?, ?, ?)').run(user.id, name, passwordHash, new Date().toISOString());
    return user;
  });
}

export async function resetAccount(db, { name: input, password }) {
  const name = validateName(input);
  const user = db.prepare('SELECT id, name FROM users WHERE name = ? COLLATE NOCASE').get(name);
  if (!user) throw new HttpError(404, '找不到这个成员，请检查昵称。');
  const passwordHash = await hashPassword(password);
  transaction(db, () => {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, user.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
  });
  return { id: user.id, name: user.name };
}
