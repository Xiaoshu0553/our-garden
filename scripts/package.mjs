import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const files = ['package.json', 'server.mjs', 'lib', 'public', 'scripts', 'deploy',
  'test', 'Dockerfile', 'compose.yaml', 'README.md', '.dockerignore', '.gitignore'];
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--output')) {
  console.error('用法: node scripts/package.mjs [--output PATH.tar.gz]');
  process.exitCode = 1;
} else {
  try {
    const destination = resolve(args[1] ?? resolve(root, '.local/our-garden-release.tar.gz'));
    if (!destination.endsWith('.tar.gz')) throw new Error('发布包文件名应以 .tar.gz 结尾。');
    for (const file of [...files, 'public/app.js', 'scripts/accounts.mjs']) await stat(resolve(root, file));
    await mkdir(dirname(destination), { recursive: true });
    const result = spawnSync('tar', ['-czf', destination, ...files], { cwd: root, encoding: 'utf8' });
    if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr || '打包失败。');
    const listing = spawnSync('tar', ['-tzf', destination], { encoding: 'utf8' });
    if (listing.error || listing.status !== 0) throw new Error('无法检查发布包。');
    const entries = listing.stdout.split(/\r?\n/).filter(Boolean);
    if (entries.some(name => /(^|\/)(\.local|data|backups|\.git|node_modules)(\/|$)|\.credentials\.local$|(^|\/)\.env($|\.)|\.sqlite(?:-|$)|\.pem$|ed25519/.test(name))) {
      throw new Error('发布包中发现运行数据或密钥路径，禁止发布。');
    }
    const content = await readFile(destination);
    const digest = createHash('sha256').update(content).digest('hex');
    await writeFile(`${destination}.sha256`, `${digest}  ${destination.split(/[\\/]/).pop()}\n`);
    console.log(`发布包已生成: ${destination}`);
    console.log(`SHA256: ${digest}`);
    console.log(`已校验 ${entries.length} 个源码路径；运行数据和密钥未打包。`);
  } catch (error) {
    console.error(`打包失败: ${error.message}`);
    process.exitCode = 1;
  }
}
