import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../lib/db.mjs';
import { createBackup } from '../scripts/backup.mjs';

const restoreScript = fileURLToPath(new URL('../deploy/restore.mjs', import.meta.url));
const temporaryRoot = resolve(tmpdir());

async function fixture(t) {
  const directory = await mkdtemp(join(temporaryRoot, 'our-garden-backup-'));
  const dataDir = join(directory, 'data');
  const context = {
    directory,
    dataDir,
    backupDir: join(dataDir, 'backups'),
    database: openDatabase(dataDir),
    close() {
      if (this.database) {
        this.database.close();
        this.database = null;
      }
    },
    note(id, text) {
      this.database.prepare(`
        INSERT INTO notes (id, project_id, kind, text, author_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, 'shared-project', 'comment', text, 'member-one', new Date().toISOString());
    },
  };
  t.after(async () => {
    context.close();
    // Delete only the directory created by this test, inside the known temp root.
    const absolute = resolve(directory);
    const inside = relative(temporaryRoot, absolute);
    assert.ok(inside && !inside.startsWith('..') && !isAbsolute(inside));
    assert.ok(basename(absolute).startsWith('our-garden-backup-'));
    await rm(absolute, { recursive: true, force: true });
  });
  const now = new Date().toISOString();
  context.database.prepare('INSERT INTO users VALUES (?, ?, ?, ?)')
    .run('member-one', '备份测试成员', 'synthetic-hash-not-a-credential', now);
  context.database.prepare(`
    INSERT INTO projects (id, title, author_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run('shared-project', '一起保存下来的计划', 'member-one', now, now);
  context.database.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?)')
    .run('synthetic-session-hash', 'member-one', 'synthetic-csrf', Date.now() + 60_000);
  return context;
}

function inspectDatabase(filename, inspect) {
  const database = new DatabaseSync(filename, { readOnly: true });
  try {
    return inspect(database);
  } finally {
    database.close();
  }
}

function restore(context, source, flags = []) {
  return spawnSync(process.execPath, [restoreScript, source, ...flags], {
    env: { ...process.env, DATA_DIR: context.dataDir },
    encoding: 'utf8',
    timeout: 15_000,
  });
}

test('online backup includes the newest committed records still in the live WAL', async t => {
  const context = await fixture(t);
  context.database.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA wal_autocheckpoint=0;');
  context.note('latest-note', '刚刚写下、尚未 checkpoint 的新想法');
  const wal = await stat(join(context.dataDir, 'garden.sqlite-wal'));
  assert.ok(wal.size > 32, 'the newest write must exist in a nonempty live WAL');

  const result = await createBackup({ dataDir: context.dataDir });
  assert.ok(result.bytes > 0);
  inspectDatabase(result.file, database => {
    assert.equal(database.prepare('SELECT text FROM notes WHERE id = ?').get('latest-note').text,
      '刚刚写下、尚未 checkpoint 的新想法');
    assert.equal(database.prepare('SELECT title FROM projects').get().title, '一起保存下来的计划');
  });
  assert.equal(context.database.prepare('SELECT count(*) AS count FROM notes').get().count, 1,
    'backup leaves the live database usable');
});

test('a backup is an independently readable snapshot with a successful integrity check', async t => {
  const context = await fixture(t);
  context.note('snapshot-note', '这条记录应当独立保存在快照里');
  const result = await createBackup({ dataDir: context.dataDir });
  context.note('later-note', '备份完成后才写入，不属于这份快照');
  context.close();

  inspectDatabase(result.file, database => {
    assert.equal(database.prepare('PRAGMA quick_check').get().quick_check, 'ok');
    assert.equal(database.prepare('PRAGMA journal_mode').get().journal_mode, 'delete');
    assert.deepEqual(database.prepare('SELECT id FROM notes ORDER BY id').all().map(row => row.id),
      ['snapshot-note']);
  });
  const files = await readdir(context.backupDir);
  assert.ok(!files.includes(`${basename(result.file)}-wal`));
  assert.ok(!files.includes(`${basename(result.file)}-shm`));
});

test('backup retention removes stale generated snapshots and preserves unrelated files', async t => {
  const context = await fixture(t);
  context.note('retained-note', '同一份项目数据可以多次备份');
  const first = await createBackup({ dataDir: context.dataDir, keep: 2 });
  const firstAge = new Date(Date.now() - 30_000);
  await utimes(first.file, firstAge, firstAge);
  const second = await createBackup({ dataDir: context.dataDir, keep: 2 });
  const secondAge = new Date(Date.now() - 15_000);
  await utimes(second.file, secondAge, secondAge);
  const manual = join(context.backupDir, 'manual.sqlite');
  await writeFile(manual, 'unrelated manual file');
  const result = await createBackup({ dataDir: context.dataDir, keep: 2 });

  assert.deepEqual(result.removed, [basename(first.file)]);
  await assert.rejects(stat(first.file), { code: 'ENOENT' });
  assert.ok((await stat(second.file)).isFile());
  assert.ok((await stat(result.file)).isFile());
  assert.equal(await readFile(manual, 'utf8'), 'unrelated manual file');
  assert.equal((await readdir(context.backupDir)).filter(name => name.startsWith('garden-')).length, 2);
});

test('invalid retention settings fail before replacing or removing data', async t => {
  const context = await fixture(t);
  context.note('keep-original', '参数有误也要保留原记录');
  for (const keep of [0, -1, 1.5, 'invalid', 3651]) {
    await assert.rejects(createBackup({ dataDir: context.dataDir, keep }), /保留数量/);
  }
  assert.equal(context.database.prepare('SELECT text FROM notes').get().text, '参数有误也要保留原记录');
});

test('restore refuses to run without explicit app-stopped confirmation', async t => {
  const context = await fixture(t);
  context.note('first-note', '备份时的记录');
  const snapshot = await createBackup({ dataDir: context.dataDir });
  context.note('newer-note', '未确认停止时应保留的后续记录');
  context.close();

  const result = restore(context, snapshot.file);
  assert.equal(result.error, undefined);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--app-stopped/);
  inspectDatabase(join(context.dataDir, 'garden.sqlite'), database => {
    assert.equal(database.prepare('SELECT count(*) AS count FROM notes').get().count, 2);
    assert.equal(database.prepare('SELECT count(*) AS count FROM sessions').get().count, 1);
  });
  assert.equal((await readdir(context.dataDir)).filter(name => name.startsWith('before-restore-')).length, 0);
});

test('restore rejects a non-application snapshot before changing the current database', async t => {
  const context = await fixture(t);
  context.note('original-note', '无效备份不能替换它');
  context.close();
  const invalid = join(context.directory, 'unrelated.sqlite');
  const unrelated = new DatabaseSync(invalid);
  unrelated.exec('CREATE TABLE unrelated (value TEXT);');
  unrelated.close();

  const result = restore(context, invalid, ['--app-stopped']);
  assert.equal(result.error, undefined);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /不是本应用/);
  inspectDatabase(join(context.dataDir, 'garden.sqlite'), database => {
    assert.equal(database.prepare('SELECT text FROM notes').get().text, '无效备份不能替换它');
  });
});

test('successful restore recovers the snapshot, clears sessions, and retains the previous database', async t => {
  const context = await fixture(t);
  context.note('saved-note', '这条想法在备份中');
  const snapshot = await createBackup({ dataDir: context.dataDir });
  context.note('after-snapshot', '恢复前新增的想法会保存在旧数据库中');
  context.close();

  const result = restore(context, snapshot.file, ['--app-stopped']);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  inspectDatabase(join(context.dataDir, 'garden.sqlite'), database => {
    assert.equal(database.prepare('PRAGMA quick_check').get().quick_check, 'ok');
    assert.deepEqual(database.prepare('SELECT id FROM notes').all().map(row => row.id), ['saved-note']);
    assert.equal(database.prepare('SELECT count(*) AS count FROM users').get().count, 1);
    assert.equal(database.prepare('SELECT count(*) AS count FROM sessions').get().count, 0);
  });
  const previous = (await readdir(context.dataDir)).filter(name => name.startsWith('before-restore-'));
  assert.equal(previous.length, 1);
  inspectDatabase(join(context.dataDir, previous[0], 'garden.sqlite'), database => {
    assert.equal(database.prepare('SELECT count(*) AS count FROM notes').get().count, 2);
    assert.equal(database.prepare('SELECT count(*) AS count FROM sessions').get().count, 1);
  });
  inspectDatabase(snapshot.file, database => {
    assert.equal(database.prepare('SELECT count(*) AS count FROM sessions').get().count, 1,
      'restoring must not mutate the selected backup file');
  });
});
