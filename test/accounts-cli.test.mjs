import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../lib/db.mjs';
import { verifyPassword } from '../lib/security.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const cli = join(root, 'scripts', 'accounts.mjs');

test('无人值守账号工具仅把密码写入私有文件，限制双人并支持可靠重置', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'our-garden-accounts-cli-'));
  const credentials = join(directory, 'initial.credentials.local');
  let db;
  const run = (...args) => spawnSync(process.execPath, [cli, '--data-dir', directory, ...args], { cwd: root, encoding: 'utf8', timeout: 20_000 });
  try {
    const first = run('--name', '初始住户', '--generate', credentials);
    assert.equal(first.status, 0, first.stderr);
    const record = JSON.parse((await readFile(credentials, 'utf8')).trim());
    assert.equal(record.name, '初始住户');
    assert.equal(record.operation, 'create');
    assert.ok(record.password.length >= 24);
    assert.ok(!first.stdout.includes(record.password));
    assert.ok(!first.stderr.includes(record.password));
    db = openDatabase(directory);
    let account = db.prepare('SELECT * FROM users WHERE name = ?').get(record.name);
    assert.equal(await verifyPassword(record.password, account.password_hash), true);
    db.prepare('INSERT INTO sessions (token_hash, user_id, csrf_token, expires_at) VALUES (?, ?, ?, ?)').run('old-session', account.id, 'csrf', Date.now() + 10000);
    assert.equal(run('--name', '第二位住户', '--generate', credentials).status, 0);
    const beforeThird = await readFile(credentials, 'utf8');
    const third = run('--name', '第三位住户', '--generate', credentials);
    assert.equal(third.status, 1);
    assert.match(third.stderr, /最多/);
    assert.equal(await readFile(credentials, 'utf8'), beforeThird);
    assert.equal(db.prepare('SELECT COUNT(*) AS total FROM users').get().total, 2);
    const reset = run('--reset', '--name', record.name, '--generate', credentials);
    assert.equal(reset.status, 0, reset.stderr);
    const records = (await readFile(credentials, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.equal(records.length, 3);
    assert.equal(records.at(-1).operation, 'reset');
    assert.notEqual(records.at(-1).password, record.password);
    assert.ok(!reset.stdout.includes(records.at(-1).password));
    account = db.prepare('SELECT * FROM users WHERE name = ?').get(record.name);
    assert.equal(await verifyPassword(record.password, account.password_hash), false);
    assert.equal(await verifyPassword(records.at(-1).password, account.password_hash), true);
    assert.equal(db.prepare('SELECT COUNT(*) AS total FROM sessions').get().total, 0);
    if (process.platform !== 'win32') assert.equal((await stat(credentials)).mode & 0o777, 0o600);
  } finally {
    db?.close();
    if (dirname(directory) === tmpdir() && basename(directory).startsWith('our-garden-accounts-cli-')) await rm(directory, { recursive: true, force: true });
  }
});

test('账号工具拒绝公开凭据位置及不完整的生成参数', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'our-garden-accounts-cli-'));
  try {
    const run = (...args) => spawnSync(process.execPath, [cli, '--data-dir', directory, ...args], { cwd: root, encoding: 'utf8', timeout: 20_000 });
    const filename = join(root, 'public', `rejected-${Date.now()}.credentials.local`);
    const publicOutput = run('--name', '住户', '--generate', filename);
    assert.equal(publicOutput.status, 1);
    assert.match(publicOutput.stderr, /public/);
    await assert.rejects(stat(filename), { code: 'ENOENT' });
    const missingName = run('--generate', join(directory, 'initial.credentials.local'));
    assert.equal(missingName.status, 1);
    assert.match(missingName.stderr, /--name/);
    const unignored = run('--name', '住户', '--generate', join(directory, 'passwords.txt'));
    assert.equal(unignored.status, 1);
    await assert.rejects(stat(join(directory, 'garden.sqlite')), { code: 'ENOENT' });
  } finally {
    if (dirname(directory) === tmpdir() && basename(directory).startsWith('our-garden-accounts-cli-')) await rm(directory, { recursive: true, force: true });
  }
});
