import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../server.mjs';
import { createAccount } from '../../lib/accounts.mjs';
const require=createRequire(import.meta.url);
const {chromium,expect}=require(process.env.GARDEN_PLAYWRIGHT_PATH || 'playwright');
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const output=join(root,'.local/desktop-qa');await mkdir(output,{recursive:true});
const run=await mkdtemp(join(output,'registration-ui-'));
const server=createApp({dataDir:join(run,'service'),cookieSecure:false});server.listen(0,'127.0.0.1');await once(server,'listening');
const origin=`http://127.0.0.1:${server.address().port}`;
const password='Browser-registration-fixture-2026!';
await createAccount(server.db,{name:'原来的甲',password});await createAccount(server.db,{name:'原来的乙',password});
const browser=await chromium.launch({channel:'msedge',headless:true});
const errors=[];
async function page(path='/companion/index.html',viewport={width:1100,height:1000}){const context=await browser.newContext({viewport});const p=await context.newPage();p.setDefaultTimeout(10000);p.on('pageerror',e=>errors.push(e.message));await p.goto(origin+path);await p.locator('#login-form').waitFor();return p;}
async function register(p,name,code){await p.locator('[data-action=auth-mode][data-mode=register]').click();const form=p.locator('#register-form');await form.locator('[name=name]').fill(name);await form.locator('[name=password]').fill(password);await form.locator('[name=passwordConfirmation]').fill(password);if(code)await form.locator('[name=inviteCode]').fill(code);await form.locator('button[type=submit]').click();}
async function textEventually(locator,text){for(let i=0;i<100;i++){if((await locator.textContent()).includes(text))return;await new Promise(r=>setTimeout(r,100));}assert.fail('Expected text: '+text);}
try{
  const a=await page();await a.locator('[data-action=auth-mode][data-mode=register]').click();
  const form=a.locator('#register-form');await form.locator('[name=name]').fill('注册甲');await form.locator('[name=password]').fill(password);await form.locator('[name=passwordConfirmation]').fill('Different-password-2026!');await form.locator('button[type=submit]').click();await textEventually(a.locator('#login-error'),'两次密码不一致');
  await form.locator('[name=passwordConfirmation]').fill(password);await a.screenshot({path:join(output,'registration-form.png'),fullPage:true});await form.locator('button[type=submit]').click();
  await a.locator('[data-action=create-invite]').waitFor();await a.locator('[data-action=create-invite]').click();const code=await a.locator('#garden-invite-code').inputValue();assert.match(code,/^[A-F0-9]{8}(?:-[A-F0-9]{8}){3}$/);
  const b=await page('/');await register(b,'注册甲',code);await textEventually(b.locator('#login-error'),'已经有人使用');await b.locator('#register-form [name=name]').fill('注册乙');await b.locator('#register-form button[type=submit]').click();await b.locator('.profile-button').waitFor();await textEventually(b.locator('body'),'注册乙');
  await textEventually(a.locator('#pairing-settings'),'我们已经连接好了');
  await a.locator('.back[data-page=talk]').click();await a.locator('#idea-input').fill('注册后两人一起记住这个念头。');await a.locator('#compose-form button[type=submit]').click();await textEventually(a.locator('#toast'),'原话已收好');
  await b.reload();await textEventually(b.locator('body'),'注册后两人一起记住这个念头');
  await a.locator('#settings-button').click();await a.screenshot({path:join(output,'paired-accounts.png'),fullPage:true});
  await b.locator('.profile-button').click();await b.locator('[data-action=logout]').click();await b.locator('#login-form').waitFor();await b.locator('#login-form [name=name]').fill('注册乙');await b.locator('#login-form [name=password]').fill(password);await b.locator('#login-form button[type=submit]').click();await b.locator('.profile-button').waitFor();await textEventually(b.locator('body'),'注册后两人一起记住这个念头');
  const c=await page();await register(c,'已注册丙');await c.locator('[data-action=create-invite]').waitFor();await c.locator('.back[data-page=talk]').click();await c.locator('#idea-input').fill('丙确认后分享的旧念头。');await c.locator('#compose-form button[type=submit]').click();await textEventually(c.locator('#toast'),'原话已收好');
  await c.locator('[data-page=ideas].nav-button').click();assert.equal(await c.getByText('注册后两人一起记住这个念头',{exact:true}).count(),0);
  const d=await page('/');await register(d,'邀请丁');await d.locator('[data-action=create-invite]').waitFor();await d.locator('[data-action=create-invite]').click();const otherCode=await d.locator('#garden-invite-code').inputValue();
  await c.locator('#settings-button').click();await c.locator('#garden-join-form [name=code]').fill(otherCode);await c.locator('#garden-join-form [name=shareExisting]').check();await c.locator('#garden-join-form button[type=submit]').click();await c.locator('#idea-input').waitFor();
  await d.reload();await textEventually(d.locator('body'),'丙确认后分享的旧念头');
  const mobile=await page('/companion/index.html',{width:320,height:900});await mobile.locator('[data-action=auth-mode][data-mode=register]').click();await mobile.screenshot({path:join(output,'registration-mobile320.png'),fullPage:true});assert.ok(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.deepEqual(errors,[]);console.log(JSON.stringify({result:'passed',flows:['registration confirmation error','duplicate nickname preserved form','companion creates invite','website registers with invite','peer sees connection in realtime','cross-platform shared idea','logout and login','separate gardens stay private','registered member joins with explicit history sharing','320px registration layout'],screenshot:join(output,'registration-form.png')}));
}finally{await browser.close();const done=once(server,'close');server.close();server.closeIdleConnections();await done;}
