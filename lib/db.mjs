import { mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function openDatabase(dataDir) {
  const directory = resolve(dataDir);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(join(directory, 'garden.sqlite'));
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      csrf_token TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      stage TEXT NOT NULL DEFAULT 'idea' CHECK(stage IN ('idea','exploring','active','completed','paused')),
      author_id TEXT NOT NULL REFERENCES users(id),
      goal TEXT NOT NULL DEFAULT '',
      next_review_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS consents (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY(project_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      assignee_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      done INTEGER NOT NULL DEFAULT 0 CHECK(done IN (0,1)),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS tasks_project ON tasks(project_id);
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK(kind IN ('comment','decision','resource')),
      text TEXT NOT NULL,
      url TEXT,
      author_id TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS notes_project ON notes(project_id);
    CREATE TABLE IF NOT EXISTS companion_captures (
      project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
      author_id TEXT NOT NULL REFERENCES users(id),
      client_id TEXT NOT NULL,
      original_text TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      ai_state TEXT NOT NULL DEFAULT 'original' CHECK(ai_state IN ('original','pending','ready','failed')),
      UNIQUE(author_id, client_id)
    );
    CREATE TABLE IF NOT EXISTS companion_inbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      actor_id TEXT NOT NULL REFERENCES users(id),
      recipient_id TEXT NOT NULL REFERENCES users(id),
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      delivered_at TEXT,
      read_at TEXT
    );
    CREATE INDEX IF NOT EXISTS companion_inbox_recipient ON companion_inbox(recipient_id, read_at, id);
  `);
  // Upgrade the original shared two-person database without changing account
  // IDs, password hashes, sessions or project IDs. Membership is separate so
  // existing backups and the account administration command remain compatible.
  transaction(db, () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS gardens (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL
      );
      INSERT OR IGNORE INTO gardens (id, created_at) VALUES ('legacy', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
      CREATE TABLE IF NOT EXISTS garden_members (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        garden_id TEXT NOT NULL REFERENCES gardens(id)
      );
      CREATE INDEX IF NOT EXISTS garden_members_garden ON garden_members(garden_id);
      CREATE TABLE IF NOT EXISTS garden_invites (
        garden_id TEXT PRIMARY KEY REFERENCES gardens(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        created_by TEXT NOT NULL REFERENCES users(id),
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS garden_archives (
        garden_id TEXT NOT NULL REFERENCES gardens(id),
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        participants TEXT NOT NULL,
        archived_at TEXT NOT NULL,
        PRIMARY KEY(garden_id,user_id)
      );
      DROP TRIGGER IF EXISTS maximum_two_users;
      CREATE TRIGGER IF NOT EXISTS maximum_two_garden_members
        BEFORE INSERT ON garden_members WHEN (SELECT COUNT(*) FROM garden_members WHERE garden_id = NEW.garden_id) >= 2
        BEGIN SELECT RAISE(ABORT, 'maximum_two_garden_members'); END;
      CREATE TRIGGER IF NOT EXISTS maximum_two_garden_members_update
        BEFORE UPDATE OF garden_id ON garden_members WHEN NEW.garden_id != OLD.garden_id
          AND (SELECT COUNT(*) FROM garden_members WHERE garden_id = NEW.garden_id) >= 2
        BEGIN SELECT RAISE(ABORT, 'maximum_two_garden_members'); END;
    `);
    if (!db.prepare('PRAGMA table_info(projects)').all().some(column => column.name === 'garden_id')) {
      // SQLite cannot add a REFERENCES column with a non-null default to a
      // populated table. Equivalent guards below preserve existing records.
      db.exec("ALTER TABLE projects ADD COLUMN garden_id TEXT NOT NULL DEFAULT 'legacy'");
      db.exec("INSERT OR IGNORE INTO garden_members (user_id, garden_id) SELECT id, 'legacy' FROM users");
    }
    db.exec('CREATE INDEX IF NOT EXISTS projects_garden ON projects(garden_id, updated_at)');
    if (!db.prepare('PRAGMA table_info(companion_captures)').all().some(column => column.name === 'kind')) {
      db.exec("ALTER TABLE companion_captures ADD COLUMN kind TEXT NOT NULL DEFAULT 'idea' CHECK(kind IN ('idea','goal'))");
    }
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS project_garden_exists_insert BEFORE INSERT ON projects
        WHEN NOT EXISTS (SELECT 1 FROM gardens WHERE id = NEW.garden_id)
        BEGIN SELECT RAISE(ABORT, 'project_garden_missing'); END;
      CREATE TRIGGER IF NOT EXISTS project_garden_exists_update BEFORE UPDATE OF garden_id ON projects
        WHEN NOT EXISTS (SELECT 1 FROM gardens WHERE id = NEW.garden_id)
        BEGIN SELECT RAISE(ABORT, 'project_garden_missing'); END;
      CREATE TRIGGER IF NOT EXISTS garden_has_projects BEFORE DELETE ON gardens
        WHEN EXISTS (SELECT 1 FROM projects WHERE garden_id = OLD.id)
        BEGIN SELECT RAISE(ABORT, 'garden_has_projects'); END;
    `);
  });
  return db;
}

export function transaction(db, action) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = action();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
