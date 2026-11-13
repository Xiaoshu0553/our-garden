import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { request as httpRequest, createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../server.mjs';
import { hashPassword, secretToken, tokenHash, verifyPassword } from '../lib/security.mjs';
import core from '../desktop/core.cjs';

const password = 'Registration-fixture-only-2026!';
const origin = 'http://garden.test';
async function fixture(t, options = {}, prepare) {
  const directory = await mkdtemp(join(tmpdir(), 'garden-registration-'));
  if (prepare) await prepare(directory);
  let app, base;
  async function start() { app = createApp({ dataDir: directory, publicOrigin: origin, cookieSecure: false, registrationRateLimit: { perAccount: 100, perIp: 100, global: 500 }, ...options }); app.listen(0,'127.0.0.1'); await once(app,'listening'); base = `http://127.0.0.1:${app.address().port}`; }
  async function stop() { if (!app?.listening) return; const done = once(app,'close'); app.close(); app.closeIdleConnections(); await done; }
  await start();
  t.after(async () => { await stop(); const inside = relative(resolve(tmpdir()), resolve(directory)); assert.ok(inside && !inside.startsWith('..') && !isAbsolute(inside) && basename(directory).startsWith('garden-registration-')); await rm(directory,{recursive:true,force:true}); });
  function client() {
    return {
      cookie:'',csrf:'',
      async request(path, method='GET', body, overrides={}) {
        const response = await fetch(base+path,{method,headers:{Origin:origin,...(this.cookie?{Cookie:this.cookie}:{}),...(method!=='GET'?{'Content-Type':'application/json','X-CSRF-Token':this.csrf}:{}),...overrides},...(body!==undefined?{body:JSON.stringify(body)}:{})});
        const data = await response.json();
        for(const line of response.headers.getSetCookie()) if(line.startsWith('garden_session=')) this.cookie = /Max-Age=0/.test(line)?'':line.split(';')[0];
        if(data.csrfToken) this.csrf=data.csrfToken;
        return {status:response.status,data,response};
      },
      async register(name, inviteCode) { const result=await this.request('/api/auth/register','POST',{name,password,passwordConfirmation:password,...(inviteCode?{inviteCode}:{})}); assert.equal(result.status,201,JSON.stringify(result.data)); return result.data; },
      async invite() { const result=await this.request('/api/garden/invite','POST',{});assert.equal(result.status,201,JSON.stringify(result.data));return result.data.invite; },
      async idea(text='只有当前小花园可以看到') { const result=await this.request('/api/companion/capture','POST',{text,clientId:secretToken()});assert.equal(result.status,201,JSON.stringify(result.data));return result.data.project; }
    };
  }
  return {get app(){return app;},get base(){return base;},client,start,stop};
}

test('自行注册、校验确认密码、重复昵称、自动登录、退出和重新登录',async t=>{
  const f=await fixture(t);const a=f.client();
  for(const body of [{name:'新住户',password:'short',passwordConfirmation:'short'},{name:'新住户',password,passwordConfirmation:'another password'},{name:'新住户',password,passwordConfirmation:password,admin:true}]) assert.equal((await a.request('/api/auth/register','POST',body)).status,400);
  assert.equal((await a.request('/api/auth/register','POST',{name:'新住户',password,passwordConfirmation:password},{Origin:'https://evil.invalid'})).status,403);
  assert.equal(f.app.db.prepare('SELECT COUNT(*) AS n FROM users').get().n,0);
  const result=await a.register('FirstMember');assert.ok(result.user.id);assert.equal(result.garden.members.length,1);assert.notEqual(result.garden.id,'legacy');
  assert.ok(a.cookie && a.csrf);assert.equal((await a.request('/api/auth/state')).data.user.id,result.user.id);
  assert.equal((await a.request('/api/state')).data.users.length,1);
  const saved=f.app.db.prepare('SELECT * FROM users WHERE id = ?').get(result.user.id);
  assert.notEqual(saved.password_hash,password);assert.equal(await verifyPassword(password,saved.password_hash),true);
  assert.equal((await f.client().request('/api/auth/register','POST',{name:'firstmember',password,passwordConfirmation:password})).status,409);
  const sessionCookie=a.cookie;assert.equal((await a.request('/api/auth/logout','POST',{})).status,200);
  assert.equal((await a.request('/api/state','GET',undefined,{Cookie:sessionCookie})).status,401);
  assert.equal((await a.request('/api/auth/login','POST',{name:'FirstMember',password:'wrong-password'})).status,401);
  const login=await a.request('/api/auth/login','POST',{name:'FirstMember',password});assert.equal(login.status,200);assert.match(login.response.headers.get('set-cookie'),/HttpOnly/);assert.match(login.response.headers.get('set-cookie'),/SameSite=Strict/);assert.equal(login.response.headers.get('cache-control'),'no-store');
});

test('不同小花园隔离成员、项目、分工、留言、通知、AI 上下文和实时事件',async t=>{
  const f=await fixture(t);const a=f.client(),b=f.client();const aa=await a.register('花园甲');const bb=await b.register('花园乙');
  const pa=await a.idea('甲的私密想法'),pb=await b.idea('乙的私密想法');
  const own=await a.request('/api/state');assert.deepEqual(own.data.users.map(u=>u.id),[aa.user.id]);assert.deepEqual(own.data.projects.map(p=>p.id),[pa.id]);
  assert.notEqual(aa.garden.id,bb.garden.id);assert.equal((await b.request(`/api/projects/${pa.id}`)).status,404);
  const task=await a.request(`/api/projects/${pa.id}/tasks`,'POST',{text:'甲的任务',assigneeId:aa.user.id});const taskId=task.data.project.tasks[0].id;
  const note=await a.request(`/api/projects/${pa.id}/notes`,'POST',{kind:'comment',text:'甲的留言'});const noteId=note.data.project.notes[0].id;
  for(const [path,method,body] of [[`/api/projects/${pa.id}`,'PATCH',{title:'越权修改'}],[`/api/projects/${pa.id}`,'DELETE',{}],[`/api/projects/${pa.id}/consent`,'POST',{}],[`/api/projects/${pa.id}/tasks`,'POST',{text:'越权'}],[`/api/projects/${pa.id}/tasks/${taskId}`,'PATCH',{done:true}],[`/api/projects/${pa.id}/notes`,'POST',{kind:'comment',text:'越权'}],[`/api/projects/${pa.id}/notes/${noteId}`,'DELETE',{}],['/api/companion/inbox/read','POST',{projectId:pa.id}],['/api/companion/chat','POST',{projectId:pa.id,messages:[{role:'user',content:'总结别人的内容'}]}]]) assert.equal((await b.request(path,method,body)).status,404,path);
  assert.equal((await a.request(`/api/projects/${pa.id}/tasks`,'POST',{text:'不能分给别的小花园',assigneeId:bb.user.id})).status,400);
  assert.equal((await b.request('/api/companion/inbox')).data.unreadCount,0);
  const controllers=[new AbortController(),new AbortController()];const chunks=[[],[]];const readers=[];
  try{
    for(const [index,c] of [a,b].entries()){
      const response=await fetch(f.base+'/api/companion/events',{headers:{Cookie:c.cookie,Origin:origin},signal:controllers[index].signal});const reader=response.body.getReader();readers.push(reader);await reader.read();
      (async()=>{try{while(true){const {done,value}=await reader.read();if(done)break;chunks[index].push(Buffer.from(value).toString());}}catch{}})();
    }
    await a.idea('只应唤醒甲');for(let i=0;i<50&&!chunks[0].join('').includes('event: changed');i++)await new Promise(r=>setTimeout(r,10));
    assert.match(chunks[0].join(''),/event: changed/);assert.equal(chunks[1].join(''),'');
  }finally{controllers.forEach(c=>c.abort());await Promise.all(readers.map(r=>r.cancel().catch(()=>{})));}
  assert.deepEqual((await b.request('/api/state')).data.projects.map(p=>p.id),[pb.id]);
});

test('邀请码只保存摘要，可轮换、过期和单次使用；伴侣注册后看到同一份记录',async t=>{
  const f=await fixture(t);const a=f.client();const owner=await a.register('邀请人');const idea=await a.idea('伴侣加入后一起看到');
  const first=await a.invite();const second=await a.invite();assert.notEqual(first.code,second.code);
  const row=f.app.db.prepare('SELECT * FROM garden_invites WHERE garden_id = ?').get(owner.garden.id);assert.notEqual(row.token_hash,second.code.replaceAll('-',''));assert.equal(row.token_hash.length,64);
  const visitor=f.client();assert.equal((await visitor.request('/api/auth/register','POST',{name:'未入住',password,passwordConfirmation:password,inviteCode:first.code})).status,400);
  f.app.db.prepare('UPDATE garden_invites SET expires_at = ?').run(Date.now()-1);
  assert.equal((await visitor.request('/api/auth/register','POST',{name:'未入住',password,passwordConfirmation:password,inviteCode:second.code})).status,400);
  const fresh=await a.invite();const partner=f.client();const joined=await partner.register('伴侣',fresh.code.toLowerCase());assert.equal(joined.garden.id,owner.garden.id);assert.equal(joined.garden.members.length,2);
  assert.equal((await partner.request('/api/state')).data.projects[0].id,idea.id);
  assert.equal((await a.request('/api/garden/invite','POST',{})).status,409);
  assert.equal((await visitor.request('/api/auth/register','POST',{name:'第三人',password,passwordConfirmation:password,inviteCode:fresh.code})).status,400);
  assert.equal(f.app.db.prepare('SELECT COUNT(*) AS n FROM users').get().n,2);
  await visitor.register('另一个小花园');
  await a.request(`/api/projects/${idea.id}/consent`,'POST',{});const consent=await partner.request(`/api/projects/${idea.id}/consent`,'POST',{});assert.equal(consent.data.project.stage,'exploring');
  const newest=await partner.idea('伴侣的新想法');assert.equal((await a.request('/api/companion/inbox')).data.items.filter(item=>item.projectId===newest.id).length,1);
});

test('桌面传输支持注册和配对，会话轮换后继续同步且不向界面暴露 Cookie 或 CSRF',async t=>{
  const f=await fixture(t,{publicOrigin:undefined});let stored='';
  const a=new core.GardenClient({origin:f.base}),b=new core.GardenClient({origin:f.base,saveSession:value=>{stored=value;}});
  const signup=name=>({name,password,passwordConfirmation:password});
  const aa=await a.request('/api/auth/register','POST',signup('桌面新甲'));const bb=await b.request('/api/auth/register','POST',signup('桌面新乙'));
  assert.ok(!Object.hasOwn(bb,'csrfToken'));assert.ok(!Object.hasOwn(bb,'cookie'));assert.ok(stored);const before=stored;
  const {invite}=await a.request('/api/garden/invite','POST',{});await b.request('/api/garden/join','POST',{code:invite.code});assert.notEqual(stored,before);
  assert.equal((await b.request('/api/auth/state')).garden.id,aa.garden.id);
  await b.request('/api/companion/capture','POST',{text:'桌面注册后一起记住',clientId:secretToken()});assert.equal((await a.request('/api/state')).projects.length,1);
});

test('未指定项目的 AI 对话只取得当前小花园的目标',async t=>{
  let seen='';const provider=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;const parsed=JSON.parse(body);if(parsed.messages.at(-1)?.content==='测试当前小花园上下文')seen=JSON.stringify(parsed.messages);res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({title:'整理后的标题',summary:'测试摘要'})}}]}));});
  provider.listen(0,'127.0.0.1');await once(provider,'listening');t.after(()=>new Promise(resolve=>provider.close(resolve)));
  const f=await fixture(t,{companionAI:{baseUrl:`http://127.0.0.1:${provider.address().port}/v1`,model:'fixture-model'}});const a=f.client(),b=f.client();await a.register('AI甲');await b.register('AI乙');const pa=await a.idea('AI甲的想法'),pb=await b.idea('AI乙的想法');
  await a.request(`/api/projects/${pa.id}`,'PATCH',{goal:'甲可以看见的目标'});await b.request(`/api/projects/${pb.id}`,'PATCH',{goal:'乙不能泄露的目标'});
  const reply=await a.request('/api/companion/chat','POST',{messages:[{role:'user',content:'测试当前小花园上下文'}]});assert.equal(reply.status,200);assert.equal(reply.data.generated,true);assert.match(seen,/甲可以看见的目标/);assert.doesNotMatch(seen,/乙不能泄露的目标/);
});

test('两个请求同时使用邀请码，最多一人加入，失败请求不会留下多余账号',async t=>{
  const f=await fixture(t);const a=f.client();const owner=await a.register('同时邀请');const invite=await a.invite();
  const outcomes=await Promise.all(['同时加入甲','同时加入乙'].map(name=>f.client().request('/api/auth/register','POST',{name,password,passwordConfirmation:password,inviteCode:invite.code})));
  assert.equal(outcomes.filter(r=>r.status===201).length,1);assert.equal(outcomes.filter(r=>r.status===400||r.status===409).length,1);
  assert.equal(f.app.db.prepare('SELECT COUNT(*) AS n FROM garden_members WHERE garden_id = ?').get(owner.garden.id).n,2);assert.equal(f.app.db.prepare('SELECT COUNT(*) AS n FROM users').get().n,2);
});

test('已有账号用邀请码加入，先确认分享已有记录；会话轮换后慢请求不能写入旧小花园',async t=>{
  const f=await fixture(t);const a=f.client(),b=f.client();const aa=await a.register('已注册甲');const bb=await b.register('已注册乙');await a.idea('甲先留下的');const own=await b.idea('乙想一起带过去的');const invite=await a.invite();
  assert.equal((await b.request('/api/garden/join','POST',{code:invite.code})).status,409);
  assert.equal((await b.request('/api/garden')).data.garden.id,bb.garden.id);
  const text=JSON.stringify({title:'来自旧空间的慢写入'});const oldCookie=b.cookie;let finish;
  const slow=new Promise((resolve,reject)=>{const req=httpRequest(f.base+`/api/projects/${own.id}`,{method:'PATCH',headers:{Origin:origin,Cookie:b.cookie,'X-CSRF-Token':b.csrf,'Content-Type':'application/json','Content-Length':Buffer.byteLength(text)}},res=>{let body='';res.on('data',chunk=>body+=chunk);res.on('end',()=>resolve({status:res.statusCode,body}));});req.on('error',reject);req.write(text.slice(0,1));finish=()=>req.end(text.slice(1));});
  await new Promise(r=>setTimeout(r,25));
  const joined=await b.request('/api/garden/join','POST',{code:invite.code,shareExisting:true});assert.equal(joined.status,200);assert.equal(joined.data.garden.id,aa.garden.id);finish();assert.equal((await slow).status,401);
  assert.equal((await b.request('/api/auth/state','GET',undefined,{Cookie:oldCookie})).data.user,null);
  const shared=(await a.request('/api/state')).data;assert.equal(shared.projects.length,2);assert.equal(shared.projects.find(p=>p.id===own.id).title,'乙想一起带过去的');assert.equal(shared.users.length,2);
  assert.equal((await b.request('/api/state')).data.projects.length,2);
});

test('原有双人账号、项目和登录会话自动迁移；后续重启保持新账号隔离',async t=>{
  const token=secretToken(),csrf=secretToken();
  const f=await fixture(t,{},async directory=>{
    const db=new DatabaseSync(join(directory,'garden.sqlite'));const hash=await hashPassword(password);const now=new Date().toISOString();
    db.exec('CREATE TABLE users (id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE COLLATE NOCASE,password_hash TEXT NOT NULL,created_at TEXT NOT NULL); CREATE TABLE sessions (token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),csrf_token TEXT NOT NULL,expires_at INTEGER NOT NULL); CREATE TABLE projects (id TEXT PRIMARY KEY,title TEXT NOT NULL,description TEXT NOT NULL DEFAULT \'\',stage TEXT NOT NULL DEFAULT \'idea\',author_id TEXT NOT NULL REFERENCES users(id),goal TEXT NOT NULL DEFAULT \'\',next_review_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL); CREATE TRIGGER maximum_two_users BEFORE INSERT ON users WHEN (SELECT COUNT(*) FROM users) >= 2 BEGIN SELECT RAISE(ABORT, \'maximum_two_users\'); END;');
    for(const [id,name]of[['old-a','原住户甲'],['old-b','原住户乙']])db.prepare('INSERT INTO users VALUES (?, ?, ?, ?)').run(id,name,hash,now);
    db.prepare('INSERT INTO projects (id,title,author_id,created_at,updated_at) VALUES (?, ?, ?, ?, ?)').run('00000000-0000-4000-8000-000000000001','原来的想法','old-a',now,now);
    db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?)').run(tokenHash(token),'old-a',csrf,Date.now()+60000);db.close();
  });
  const old=f.client();old.cookie='garden_session='+token;old.csrf=csrf;
  assert.equal((await old.request('/api/auth/state')).data.user.id,'old-a');const before=(await old.request('/api/state')).data;assert.equal(before.users.length,2);assert.equal(before.projects[0].title,'原来的想法');
  const newcomer=f.client();const created=await newcomer.register('新来的独立住户');const cookie=newcomer.cookie;await f.stop();await f.start();newcomer.cookie=cookie;
  assert.equal((await newcomer.request('/api/state')).data.garden.id,created.garden.id);assert.equal((await newcomer.request('/api/state')).data.projects.length,0);assert.equal((await old.request('/api/state')).data.users.length,2);
});

test('注册、邀请和加入保留来源校验、CSRF 与注册限流',async t=>{
  const f=await fixture(t,{registrationRateLimit:{perAccount:2,perIp:2,global:2}});const a=f.client();await a.register('限流甲');
  assert.equal((await a.request('/api/garden/invite','POST',{}, {'X-CSRF-Token':''})).status,403);
  assert.equal((await a.request('/api/garden/join','POST',{code:'invalid'},{Origin:'https://evil.invalid'})).status,403);
  await f.client().register('限流乙');assert.equal((await f.client().request('/api/auth/register','POST',{name:'限流丙',password,passwordConfirmation:password})).status,429);
});
