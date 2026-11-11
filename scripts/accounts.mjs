import { randomBytes } from 'node:crypto';
import { constants, lstatSync, mkdirSync, openSync, closeSync, writeSync, chmodSync, realpathSync } from 'node:fs';
import { resolve, dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { stdin, stdout, stderr } from 'node:process';
import { openDatabase } from '../lib/db.mjs';
import { createAccount, resetAccount } from '../lib/accounts.mjs';
import { HttpError, validateName, validatePassword } from '../lib/security.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseArguments(args) {
  const options = { reset: false, help: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') options.help = true;
    else if (argument === '--reset') options.reset = true;
    else if (['--name', '--generate', '--data-dir'].includes(argument)) {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error(`${argument} 后需要填写一个值。`);
      const property = { '--name': 'name', '--generate': 'generate', '--data-dir': 'dataDir' }[argument];
      if (options[property] !== undefined) throw new Error(`${argument} 不能重复。`);
      options[property] = value;
    } else throw new Error(`不支持的参数：${argument}。运行 --help 查看用法。`);
  }
  return options;
}

function prepareCredentialsFile(input, dataDir) {
  const filename = resolve(input);
  if (!filename.endsWith('.credentials.local')) throw new Error('凭据文件名请以 .credentials.local 结尾，以便自动排除在源码和容器构建之外。');
  if (filename === join(dataDir, 'garden.sqlite')) throw new Error('凭据文件不能覆盖数据库。');
  mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
  const actualParent = realpathSync(dirname(filename));
  const publicDir = realpathSync(join(root, 'public'));
  if (actualParent === publicDir || actualParent.startsWith(`${publicDir}${sep}`)) throw new Error('凭据文件不能存放在可公开访问的 public 目录中。');
  try {
    const existing = lstatSync(filename);
    if (!existing.isFile() || existing.isSymbolicLink()) throw new Error('凭据输出位置必须是普通文件，不能是符号链接。');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | (constants.O_NOFOLLOW ?? 0);
  const descriptor = openSync(filename, flags, 0o600);
  try { chmodSync(filename, 0o600); } catch (error) { closeSync(descriptor); throw error; }
  return { filename, descriptor };
}

class PrivateOutput extends Writable {
  muted = false;
  isTTY = stdout.isTTY;
  get columns() { return stdout.columns; }
  _write(chunk, encoding, callback) {
    if (!this.muted) stdout.write(chunk, encoding);
    callback();
  }
}

async function interactiveDetails(options) {
  if (!stdin.isTTY || !stdout.isTTY) throw new Error('交互模式需要终端。无人值守时使用 --name 昵称 --generate 路径.credentials.local。');
  const output = new PrivateOutput();
  const terminal = createInterface({ input: stdin, output, terminal: true });
  let interrupted = false;
  terminal.on('SIGINT', () => { interrupted = true; terminal.close(); });
  try {
    const name = validateName(options.name ?? await terminal.question(options.reset ? '需要重置密码的昵称：' : '新住户的昵称：'));
    stdout.write('密码（至少 12 个字符，输入时不显示）：');
    output.muted = true;
    const password = await terminal.question('');
    output.muted = false;
    stdout.write('\n');
    validatePassword(password);
    stdout.write('再输入一次密码：');
    output.muted = true;
    const confirmation = await terminal.question('');
    output.muted = false;
    stdout.write('\n');
    if (password !== confirmation) throw new Error('两次密码不一致，没有修改任何账号。');
    return { name, password };
  } catch (error) {
    if (interrupted) throw new Error('已取消，没有继续操作账号。');
    throw error;
  } finally {
    output.muted = false;
    terminal.close();
  }
}

let db;
let credentials;
try {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    stdout.write(`两人小院 · 账号管理\n\n创建账号（交互输入昵称和密码）：\n  node scripts/accounts.mjs\n\n生成随机密码并写入本地私有文件：\n  node scripts/accounts.mjs --name 昵称 --generate data/accounts.credentials.local\n\n重置现有账号并使该账号的旧会话失效：\n  node scripts/accounts.mjs --reset --name 昵称\n  node scripts/accounts.mjs --reset --name 昵称 --generate data/accounts.credentials.local\n\n数据库目录可通过 DATA_DIR 环境变量或 --data-dir 指定。\n小院最多两个账号；没有公开注册接口。密码不会输出到终端或日志。\n`);
  } else {
    const dataDir = resolve(options.dataDir ?? process.env.DATA_DIR ?? join(root, 'data'));
    let details;
    if (options.generate) {
      if (options.name === undefined) throw new Error('生成模式请同时填写 --name 昵称。');
      const name = validateName(options.name);
      credentials = prepareCredentialsFile(options.generate, dataDir);
      details = { name, password: randomBytes(24).toString('base64url') };
    } else details = await interactiveDetails(options);
    db = openDatabase(dataDir);
    const account = options.reset ? await resetAccount(db, details) : await createAccount(db, details);
    if (credentials) {
      writeSync(credentials.descriptor, `${JSON.stringify({ name: account.name, password: details.password, operation: options.reset ? 'reset' : 'create', createdAt: new Date().toISOString() })}\n`, null, 'utf8');
      stdout.write(`${options.reset ? '已重置' : '已创建'}账号：${account.name}\n初始凭据已保存到本地私有文件：${credentials.filename}\n首次登录后，请在账号设置中更换密码。\n`);
    } else stdout.write(`${options.reset ? '已重置' : '已创建'}账号：${account.name}\n`);
  }
} catch (error) {
  stderr.write(`账号操作未完成：${error instanceof HttpError || error instanceof Error ? error.message : '未知错误'}\n`);
  process.exitCode = 1;
} finally {
  if (credentials) closeSync(credentials.descriptor);
  if (db) db.close();
}
