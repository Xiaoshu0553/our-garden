import { randomUUID } from 'node:crypto';
import { transaction } from './db.mjs';
import { gardenFor } from './gardens.mjs';
import { HttpError } from './security.mjs';

export function archivesFor(db, userId) {
  return db.prepare(`SELECT a.garden_id, a.participants, a.archived_at,
    (SELECT COUNT(*) FROM projects p WHERE p.garden_id=a.garden_id) AS project_count
    FROM garden_archives a WHERE a.user_id=? ORDER BY a.archived_at DESC, a.garden_id`).all(userId)
    .map(row => ({ id: row.garden_id, participants: JSON.parse(row.participants), archivedAt: row.archived_at, projectCount: row.project_count }));
}

export function archiveFor(db, userId, gardenId, project) {
  const archive = archivesFor(db, userId).find(item => item.id === gardenId);
  if (!archive) throw new HttpError(404, '找不到这份过去的共同记录。');
  return { ...archive, readOnly: true, projects: db.prepare('SELECT id FROM projects WHERE garden_id=? ORDER BY updated_at DESC,id').all(gardenId).map(row => project(row.id, gardenId)) };
}

export function unlinkGarden(db, userId) {
  return transaction(db, () => {
    const current = gardenFor(db, userId);
    if (current.members.length !== 2) throw new HttpError(409, '当前没有需要解除的伴侣绑定。');
    const now = new Date().toISOString();
    const participants = JSON.stringify(current.members);
    const newGardens = [];
    for (const member of current.members) {
      db.prepare('INSERT INTO garden_archives (garden_id,user_id,participants,archived_at) VALUES (?,?,?,?)').run(current.id, member.id, participants, now);
      const id = randomUUID();
      db.prepare('INSERT INTO gardens (id,created_at) VALUES (?,?)').run(id, now);
      db.prepare('UPDATE garden_members SET garden_id=? WHERE user_id=?').run(id, member.id);
      newGardens.push(id);
    }
    db.prepare('DELETE FROM garden_invites WHERE garden_id=?').run(current.id);
    db.prepare(`UPDATE companion_inbox SET read_at=COALESCE(read_at,?),delivered_at=COALESCE(delivered_at,?)
      WHERE project_id IN (SELECT id FROM projects WHERE garden_id=?)`).run(now, now, current.id);
    return { previousGardenId: current.id, gardenIds: newGardens };
  });
}
