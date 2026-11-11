import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const parameters = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function validateName(value) {
  if (typeof value !== 'string') throw new HttpError(400, '请填写昵称。');
  const name = value.normalize('NFC').trim();
  if (!name || name.length > 40 || /\p{C}/u.test(name)) {
    throw new HttpError(400, '昵称需为 1 到 40 个字符，不能包含控制字符。');
  }
  return name;
}

export function validatePassword(value) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 256 || value.includes('\0')) {
    throw new HttpError(400, '密码需为 12 到 256 个字符。');
  }
  return value;
}

export async function hashPassword(password) {
  validatePassword(password);
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64, parameters);
  return `scrypt$${parameters.N}$${parameters.r}$${parameters.p}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export async function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || password.length > 256) return false;
  const pieces = typeof encoded === 'string' ? encoded.split('$') : [];
  const valid = pieces.length === 6 && pieces[0] === 'scrypt' && pieces[1] === '32768'
    && pieces[2] === '8' && pieces[3] === '1';
  const salt = valid ? Buffer.from(pieces[4], 'base64url') : Buffer.alloc(16);
  const expected = valid ? Buffer.from(pieces[5], 'base64url') : Buffer.alloc(64);
  const actual = await scrypt(password, salt, 64, parameters);
  return valid && expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function secretToken() { return randomBytes(32).toString('base64url'); }
export function tokenHash(token) { return createHash('sha256').update(token).digest('hex'); }
export function equalTokens(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

export function assertKeys(object, allowed, { allowEmpty = false } = {}) {
  if (!object || typeof object !== 'object' || Array.isArray(object)) throw new HttpError(400, '请求内容必须是 JSON 对象。');
  const keys = Object.keys(object);
  if (keys.some((key) => !allowed.includes(key))) throw new HttpError(400, '请求包含不支持的字段。');
  if (!allowEmpty && keys.length === 0) throw new HttpError(400, '请提供需要保存的内容。');
}

export function textField(value, label, maximum, { allowEmpty = false } = {}) {
  if (typeof value !== 'string') throw new HttpError(400, `${label}格式不正确。`);
  const result = value.trim();
  if ((!allowEmpty && result.length === 0) || result.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(result)) {
    throw new HttpError(400, `${label}${allowEmpty ? '最多' : '需为 1 到'} ${maximum} 个字符，且不能包含控制字符。`);
  }
  return result;
}

export function reviewDate(value) {
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > 40) throw new HttpError(400, '下次讨论日期格式不正确。');
  const datePart = value.slice(0, 10);
  const simple = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value);
  const day = new Date(`${datePart}T00:00:00Z`);
  const parsed = new Date(value);
  if ((!simple && !timestamp) || !Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== datePart || !Number.isFinite(parsed.getTime())) {
    throw new HttpError(400, '请选择有效的下次讨论日期。');
  }
  return simple ? value : parsed.toISOString();
}

export function resourceUrl(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > 2048) throw new HttpError(400, '资料链接格式不正确。');
  let url;
  try { url = new URL(value); } catch { throw new HttpError(400, '请输入完整的 http 或 https 链接。'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new HttpError(400, '资料链接只支持不含账号密码的 http 或 https 地址。');
  }
  return url.href;
}

export class RateLimiter {
  constructor({ windowMs = 15 * 60 * 1000, perAccount = 10, perIp = 20, global = 60 } = {}) {
    this.windowMs = windowMs;
    this.limits = { account: perAccount, ip: perIp, global };
    this.entries = new Map();
  }
  consume(ip, account) {
    const now = Date.now();
    for (const [key, entry] of this.entries) if (entry.expires <= now) this.entries.delete(key);
    const groups = [['global', '*'], ['ip', ip], ['account', account.toLocaleLowerCase('en-US')]];
    for (const [group, value] of groups) {
      const existing = this.entries.get(`${group}:${value}`);
      if (existing && existing.count >= this.limits[group]) throw new HttpError(429, '尝试过于频繁，请稍后再试。');
    }
    if (this.entries.size > 2048) throw new HttpError(429, '尝试过于频繁，请稍后再试。');
    for (const [group, value] of groups) {
      const key = `${group}:${value}`;
      const entry = this.entries.get(key) ?? { count: 0, expires: now + this.windowMs };
      entry.count += 1;
      this.entries.set(key, entry);
    }
  }
}
