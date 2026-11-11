import { DatabaseSync } from 'node:sqlite';
import { chmod, copyFile, mkdir, realpath, rename, stat, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));

if (!process.argv.includes('--app-stopped')) {
  console.error('请先停止应用，再使用 --app-stopped 明确确认。恢复操作会替换数据库。');
  process.exitCode = 1;
} else {
  try {
    const args = process.argv.slice(2).filter(arg => arg !== '--app-stopped');
    if (args.length !== 1) throw new Error('用法: node deploy/restore.mjs BACKUP_FILE --app-stopped');
    const source = await realpath(resolve(args[0]));
    const info = await stat(source);
    if (!info.isFile()) throw new Error('备份来源必须是文件。');
    const dataDir = resolve(process.env.DATA_DIR ?? join(projectRoot, 'data'));
    await mkdir(dataDir, { recursive: true, mode: 0o700 });
    const target = join(dataDir, 'garden.sqlite');
    if (source === await realpath(target).catch(() => null)) throw new Error('来源不能是当前数据库。');
    const verification = new DatabaseSync(source, { readOnly: true });
    try {
      const checks = verification.prepare('PRAGMA quick_check').all();
      if (checks.length !== 1 || Object.values(checks[0])[0] !== 'ok') throw new Error('备份完整性校验未通过。');
      const tables = verification.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name);
      if (!tables.includes('users') || !tables.includes('projects')) throw new Error('这不是本应用的数据库备份。');
    } finally {
      verification.close();
    }
    const token = randomUUID().slice(0, 8);
    const staged = join(dataDir, `.restore-${token}.sqlite`);
    await copyFile(source, staged);
    await chmod(staged, 0o600);
    const restored = new DatabaseSync(staged);
    try {
      const hasSessions = restored.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'").get();
      if (hasSessions) restored.exec('DELETE FROM sessions');
    } finally {
      restored.close();
    }
    const previous = join(dataDir, `before-restore-${new Date().toISOString().replace(/[-:.]/g, '')}-${token}`);
    await mkdir(previous, { mode: 0o700 });
    const moved = [];
    try {
      // With the application stopped, keep the whole previous DB/WAL/SHM set together.
      for (const suffix of ['', '-wal', '-shm']) {
        const old = `${target}${suffix}`;
        if (dirname(resolve(old)) !== dataDir) throw new Error('恢复路径校验失败。');
        const exists = await stat(old).catch(() => null);
        if (exists) {
          await rename(old, join(previous, `garden.sqlite${suffix}`));
          moved.push(suffix);
        }
      }
      await rename(staged, target);
    } catch (error) {
      for (const suffix of moved) {
        const old = join(previous, `garden.sqlite${suffix}`);
        if (await stat(old).catch(() => null)) await rename(old, `${target}${suffix}`);
      }
      await unlink(staged).catch(() => {});
      throw error;
    }
    console.log('数据库已恢复。重新启动应用后，请重新登录并确认内容。');
    console.log(`恢复前的数据库保留在: ${previous}`);
  } catch (error) {
    console.error(`恢复失败: ${error.message}`);
    process.exitCode = 1;
  }
}
