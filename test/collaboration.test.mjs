import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server.mjs';
import core from '../desktop/core.cjs';
const password='Collaboration-fixture-2026!';
async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'garden-collaboration-'));const server=createApp({dataDir:dir,cookieSecure:false});server.listen(0,'127.0.0.1');await once(server,'listening');const origin=`http://127.0.0.1:${server.address().port}`;
 t.after(async()=>{const closed=once(server,'close');server.close();server.closeIdleConnections();await closed;const inside=relative(resolve(tmpdir()),resolve(dir));assert.ok(inside&&!inside.startsWith('..')&&!isAbsolute(inside));await rm(dir,{recursive:true,force:true});});
 const client=()=>new core.GardenClient({origin});const a=client(),b=client(),c=client();
 const signup=(name,inviteCode)=>({name,password,passwordConfirmation:password,...(inviteCode?{inviteCode}:{})});
 const aa=await a.request('/api/auth/register','POST',signup('甲'));const {invite}=await a.request('/api/garden/invite','POST',{});const bb=await b.request('/api/auth/register','POST',signup('乙',invite.code));await c.request('/api/auth/register','POST',signup('丙'));
 return{server,origin,a,b,c,aa,bb};
}
test('共同话题可直接提交，提交者自动确认，待对方确认时仍能查看且重试不重复',async t=>{
 const{a,b,aa}=await fixture(t);const body={kind:'goal',text:'这个月一起读完一本书。',clientId:randomUUID()};
 const first=await a.request('/api/companion/capture','POST',body);assert.equal(first.project.goal,body.text);assert.equal(first.project.capture.kind,'goal');assert.deepEqual(first.project.consents,[aa.user.id]);assert.equal(first.project.stage,'idea');
 assert.equal((await b.request('/api/state')).projects[0].goal,body.text);const repeat=await a.request('/api/companion/capture','POST',body);assert.equal(repeat.project.id,first.project.id);assert.equal(repeat.duplicate,true);
 await assert.rejects(a.request('/api/companion/capture','POST',{...body,kind:'idea'}),e=>e.status===409);
 await assert.rejects(a.request(`/api/projects/${first.project.id}`,'PATCH',{stage:'active'}),e=>e.status===409);
 const agreed=await b.request(`/api/projects/${first.project.id}/consent`,'POST',{});assert.equal(agreed.project.stage,'exploring');
 const saved=await a.request(`/api/projects/${first.project.id}`,'PATCH',{goal:'每周分享一个喜欢的片段。'});assert.equal(saved.project.goal,'每周分享一个喜欢的片段。');
});
test('解绑要求确认，双方独立，新内容隔离，历史只给当时双方且不能再修改',async t=>{
 const{a,b,c,aa,bb}=await fixture(t);const {project}=await a.request('/api/companion/capture','POST',{kind:'goal',text:'当时的共同目标',clientId:randomUUID()});await b.request(`/api/projects/${project.id}/notes`,'POST',{kind:'comment',text:'当时彼此的回应'});
 await assert.rejects(a.request('/api/garden/unlink','POST',{}),e=>e.status===400);
 const unlinked=await a.request('/api/garden/unlink','POST',{confirm:true});assert.equal(unlinked.garden.members.length,1);assert.notEqual(unlinked.garden.id,aa.garden.id);
 const other=await b.request('/api/auth/state');assert.equal(other.user.id,bb.user.id);assert.equal(other.garden.members.length,1);assert.notEqual(other.garden.id,unlinked.garden.id);
 for(const member of[a,b]){const s=await member.request('/api/state');assert.equal(s.projects.length,0);assert.equal(s.archives.length,1);assert.equal(s.archives[0].id,aa.garden.id);const history=await member.request('/api/garden/archives/'+aa.garden.id);assert.equal(history.archive.readOnly,true);assert.equal(history.archive.projects[0].notes[0].text,'当时彼此的回应');await assert.rejects(member.request(`/api/projects/${project.id}`,'PATCH',{title:'不能修改历史'}),e=>e.status===404);}
 await assert.rejects(c.request('/api/garden/archives/'+aa.garden.id),e=>e.status===404);assert.equal((await b.request('/api/companion/inbox')).unreadCount,0);
 await a.request('/api/companion/capture','POST',{text:'解绑后的私有想法',clientId:randomUUID()});assert.equal((await b.request('/api/state')).projects.length,0);
 const {invite}=await a.request('/api/garden/invite','POST',{});await c.request('/api/garden/join','POST',{code:invite.code});await assert.rejects(c.request('/api/garden/archives/'+aa.garden.id),e=>e.status===404);assert.equal((await c.request('/api/state')).archives.length,0);
});
