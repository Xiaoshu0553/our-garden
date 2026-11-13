// Regression check for the actual Windows portable launcher. Each invocation
// must own its extraction directory, including an invocation that exits after
// forwarding to the already running single-instance application.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

assert.equal(process.platform, 'win32', 'This checks the Windows portable launcher');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const version = JSON.parse(await readFile(join(root, 'desktop/package.json'), 'utf8')).version;
const executable = process.env.GARDEN_PORTABLE_EXECUTABLE;
assert.ok(executable, 'Set GARDEN_PORTABLE_EXECUTABLE to the built portable exe');
const qa = join(root, '.local/desktop-qa');
await mkdir(qa, { recursive: true });
const profile = await mkdtemp(join(qa, 'portable-'));
await writeFile(join(profile, 'settings.json'), JSON.stringify({ mode: 'demo', settingsVersion: 2, notifications: false }));
const env = { ...process.env, GARDEN_COMPANION_PROFILE: profile };
delete env.GARDEN_COMPANION_TEST; // Exercise the actual single-instance lock.
function launch() {
  const child = spawn(resolve(executable), [], { env, windowsHide: true, stdio: 'ignore' });
  child.finished = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal })); });
  return child;
}
function nativeChild(launcherId) {
  const script = `$ProgressPreference='SilentlyContinue'; [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); Get-CimInstance Win32_Process -Filter 'ParentProcessId = ${launcherId}' | Where-Object { $_.Name -eq '小花园桌宠.exe' } | Select-Object ProcessId,ExecutablePath | ConvertTo-Json -Compress`;
  const result = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true }).trim();
  return result ? JSON.parse(result) : null;
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function hashes(directory) {
  const result = {};
  for (const file of ['resources/app.asar', 'resources/companion/pet.js', 'resources/companion/index.html', 'resources/companion/app.mjs', 'resources/companion/styles.css', 'resources/companion/accounts-ui.mjs', 'resources/companion/accounts.css', 'resources/companion/dog.svg', 'resources/companion/cat.svg', 'resources/companion/transport.mjs', 'icudtl.dat', 'chrome_100_percent.pak']) {
    result[file] = createHash('sha256').update(await readFile(join(directory, file))).digest('hex');
  }
  return result;
}
const first = launch();
let second;
try {
  let native;
  for (let attempt = 0; attempt < 45; attempt++) {
    native = nativeChild(first.pid);
    if (native?.ExecutablePath) break;
    assert.equal(first.exitCode, null, 'First portable invocation exited unexpectedly');
    await pause(500);
  }
  assert.ok(native?.ExecutablePath, 'Portable application did not start');
  const directory = dirname(native.ExecutablePath);
  const before = await hashes(directory);
  second = launch();
  const timeout = new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Second invocation did not forward and exit')), 60000); timer.unref(); });
  const outcome = await Promise.race([second.finished, timeout]);
  assert.equal(outcome.code, 0);
  assert.equal(first.exitCode, null, 'First portable launcher must remain running');
  assert.ok(nativeChild(first.pid)?.ExecutablePath, 'First native application must remain running');
  assert.deepEqual(await hashes(directory), before, 'Second invocation changed or removed active application resources');
  const result = { version, test: 'real portable executable launched twice using an isolated profile', singleInstanceForwarding: 'passed', activeResourcesPreserved: 'passed', hashedFiles: Object.keys(before).length };
  await writeFile(join(qa, `portable-regression-${version}.json`), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  for (const child of [second, first].filter(Boolean)) {
    if (child.exitCode === null) {
      try { execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch { /* may already have exited */ }
    }
  }
}
