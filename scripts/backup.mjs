import { DatabaseSync, backup } from 'node:sqlite';
import { chmod, mkdir, readdir, rename, stat, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const backupName = /^garden-\d{8}T\d{9}Z-[0-9a-f]{8}\.sqlite$/;

export async function createBackup(options = {}) {
  const dataDir = resolve(options.dataDir ?? process.env.DATA_DIR ?? join(projectRoot, 'data'));
  const backupDir = resolve(options.backupDir ?? process.env.BACKUP_DIR ?? join(dataDir, 'backups'));
  const keep = Number(options.keep ?? process.env.BACKUP_KEEP ?? 14);
  if (!Number.isSafeInteger(keep) || keep < 1 || keep > 3650) {
    throw new Error('备份保留数量必须为 1 至 3650 的整数。');
  }
  const source = join(dataDir, 'garden.sqlite');
  const sourceStat = await stat(source).catch(() => null);
  if (!sourceStat?.isFile()) throw new Error('未找到 garden.sqlite，请先启动应用创建数据库。');

  await mkdir(backupDir, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[-:.]/g, '');
  const destination = join(backupDir, `garden-${stamp}-${randomUUID().slice(0, 8)}.sqlite`);
  const partial = `${destination}.partial`;
  let database;
  let pages;
  try {
    database = new DatabaseSync(source, { readOnly: true });
    database.exec('PRAGMA busy_timeout=10000');
    pages = await backup(database, partial);
    await chmod(partial, 0o600);
    const verification = new DatabaseSync(partial);
    try {
      // Make each snapshot a self-contained file rather than a new WAL database.
      verification.exec('PRAGMA journal_mode=DELETE');
      const checks = verification.prepare('PRAGMA quick_check').all();
      if (checks.length !== 1 || Object.values(checks[0])[0] !== 'ok') {
        throw new Error('备份完整性校验未通过；原数据库保持不变。');
      }
    } finally {
      verification.close();
    }
    await rename(partial, destination);
  } catch (error) {
    for (const suffix of ['', '-wal', '-shm']) await unlink(`${partial}${suffix}`).catch(() => {});
    throw error;
  } finally {
    database?.close();
  }

  const entries = await readdir(backupDir, { withFileTypes: true });
  const backups = await Promise.all(entries.filter(entry => entry.isFile() && backupName.test(entry.name)).map(async entry => {
    const path = join(backupDir, entry.name);
    const info = await stat(path);
    return { path, name: entry.name, modified: info.mtimeMs };
  }));
  backups.sort((a, b) => b.modified - a.modified || b.name.localeCompare(a.name));
  const removed = [];
  for (const old of backups.slice(keep)) {
    if (old.path === destination) continue;
    if (dirname(resolve(old.path)) !== backupDir) throw new Error('备份清理路径校验失败。');
    await unlink(old.path);
    for (const suffix of ['-wal', '-shm']) await unlink(`${old.path}${suffix}`).catch(() => {});
    removed.push(old.name);
  }
  const info = await stat(destination);
  return { file: destination, pages, bytes: info.size, removed };
}

function argumentValue(args, flag) {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`${flag} 需要一个值。`);
  return args[index + 1];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.includes('--help')) {
      console.log('用法: node scripts/backup.mjs [--data-dir PATH] [--backup-dir PATH] [--keep 14]');
    } else {
      const allowed = new Set(['--data-dir', '--backup-dir', '--keep']);
      for (let i = 0; i < args.length; i += 2) {
        if (!allowed.has(args[i])) throw new Error(`未知参数: ${args[i]}`);
        if (args[i + 1] === undefined) throw new Error(`${args[i]} 需要一个值。`);
      }
      const result = await createBackup({
        dataDir: argumentValue(args, '--data-dir'),
        backupDir: argumentValue(args, '--backup-dir'),
        keep: argumentValue(args, '--keep'),
      });
      console.log(`备份完成: ${result.file}`);
      console.log(`完整性校验通过，${result.bytes} 字节，清理 ${result.removed.length} 个过期备份。`);
    }
  } catch (error) {
    console.error(`备份失败: ${error.message}`);
    process.exitCode = 1;
  }
}
