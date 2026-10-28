import {chromium} from 'playwright';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../',import.meta.url)).replaceAll('\\','/');
await fs.mkdir(root+'/work',{recursive:true});
const server=http.createServer(async(req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(await fs.readFile(root+'/index.html'));});
await new Promise(r=>server.listen(4319,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:process.env.DAYLOOM_CHROME||undefined,headless:true});
const errors=[],docs=new Map();let rpcCount=0,delayRPC=null,casInterfere=null;
const uid='10000000-0000-4000-8000-000000000001';
const jwt=id=>[Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),Buffer.from(JSON.stringify({sub:id,aud:'authenticated',role:'authenticated',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url'),'test-signature'].join('.');
const token=jwt(uid),account={id:uid,email:'sync-test@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{provider:'email'},user_metadata:{},created_at:new Date().toISOString()};
async function device(mobile=false){
 const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1040},isMobile:mobile,hasTouch:mobile,timezoneId:'Asia/Shanghai'});
 await context.route('https://*.supabase.co/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;
  const reply=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  if(path==='/auth/v1/token')return reply({access_token:token,refresh_token:'qa-refresh',expires_in:3600,token_type:'bearer',user:account});
  if(path==='/auth/v1/user')return reply(account);
  if(path==='/auth/v1/logout')return route.fulfill({status:204});
  if(path==='/auth/v1/health')return reply({name:'mock'});
  assert.equal(req.headers().authorization,'Bearer '+token);
  if(path==='/rest/v1/dayloom_documents')return reply(docs.has(uid)?[structuredClone(docs.get(uid))]:[]);
  if(path==='/rest/v1/rpc/dayloom_save'){
   rpcCount++;const input=req.postDataJSON();
   if(delayRPC){const delay=delayRPC;delayRPC=null;await delay();}
   if(casInterfere){casInterfere();casInterfere=null;}
   const row=docs.get(uid)||{revision:0,data:null};
   if(input.expected_revision!==row.revision)return reply({applied:false,...row});
   const next={revision:row.revision+1,data:input.new_data};docs.set(uid,next);return reply({applied:true,...next});
  }
  throw Error('Unexpected request '+path);
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:4319');await page.waitForFunction(()=>window.DayloomSync);
 return {context,page};
}
const state=p=>p.evaluate(()=>Dayloom.getState());
const status=p=>p.evaluate(()=>DayloomSync.getStatus());
const sync=p=>p.evaluate(()=>DayloomSync.sync());
async function edit(p,change){await p.evaluate(change);await p.locator('h1').first().click();}
async function login(p,mode='merge'){
 await p.locator('#cloud-button').click();await p.locator('#cloud-login-form [name=email]').fill(account.email);await p.locator('#cloud-login-form [name=password]').fill('qa-only-password');await p.locator('#cloud-login-form button[type=submit]').click();
 await p.locator(mode==='merge'?'#cloud-merge-first':'#cloud-use-remote').click();
 await p.waitForFunction(()=>DayloomSync.getStatus().status==='已同步');
}
try{
 const a=await device(),p=a.page;
 await p.locator('.focus-add[data-slot=morning]').click();await p.locator('#task-form [name=title]').fill('细胞生物学复习');await p.locator('#task-form button[type=submit]').click();
 await login(p);assert.equal(docs.get(uid).data.tasks.length,1);
 const b=await device(true),q=b.page;await login(q,'remote');assert.equal((await state(q)).tasks[0].title,'细胞生物学复习');
 await q.locator('.focus-card.morning .check').click();await sync(q);await sync(p);assert.equal((await state(p)).tasks[0].done,true);
 console.log('PASS: login, first upload/download, phone completion reaches desktop');
 await p.reload();await p.waitForFunction(()=>DayloomSync.getStatus().enabled);await sync(p);assert.equal((await state(p)).tasks[0].done,true);
 await a.context.setOffline(true);await b.context.setOffline(true);
 for(const [page,title] of [[p,'电脑离线任务'],[q,'手机离线任务']]){await page.locator('#quick-task input').fill(title);await page.locator('#quick-task button').click();}
 assert.match((await status(q)).status,/离线/);
 await a.context.setOffline(false);await b.context.setOffline(false);await Promise.all([sync(p),sync(q)]);await sync(p);await sync(q);
 assert.equal((await state(p)).tasks.length,3);assert.equal((await state(q)).tasks.length,3);assert.equal(docs.get(uid).data.tasks.length,3);
 console.log('PASS: offline edits on both devices merge, concurrent CAS retry');
 await edit(p,()=>{const s=Dayloom.getState();s.tasks[0].title='电脑修改标题';Dayloom.applySync(s);});
 await edit(q,()=>{const s=Dayloom.getState();s.tasks[0].minutes=60;Dayloom.applySync(s);});
 await Promise.all([sync(p),sync(q)]);await sync(p);await sync(q);
 assert.equal((await state(q)).tasks[0].title,'电脑修改标题');assert.equal((await state(p)).tasks[0].minutes,60);
 console.log('PASS: changes to independent fields survive');
 await edit(p,()=>{const s=Dayloom.getState();s.tasks[0].title='电脑版本';Dayloom.applySync(s);});
 await edit(q,()=>{const s=Dayloom.getState();s.tasks[0].title='手机版本';Dayloom.applySync(s);});
 await sync(p);await sync(q);assert.equal((await status(q)).pending,true);assert.equal(docs.get(uid).data.tasks[0].title,'电脑版本');
 await q.locator('#cloud-button').click();await q.locator('[data-sync=resolve]').click();await q.locator('[name=conflict-0][value=local]').check();await q.locator('#cloud-conflict-form button[type=submit]').click();await sync(q);await sync(p);
 assert.equal((await state(p)).tasks[0].title,'手机版本');assert.equal((await status(q)).pending,false);
 console.log('PASS: conflicting title waits for explicit choice and then converges');
 await edit(p,()=>{const s=Dayloom.getState();s.tasks=s.tasks.slice(1);Dayloom.applySync(s);});
 await edit(q,()=>{const s=Dayloom.getState();s.tasks[0].note='保留此修改';Dayloom.applySync(s);});
 await sync(p);await sync(q);assert.equal((await status(q)).pending,true);
 await q.locator('#cloud-button').click();await q.locator('[data-sync=resolve]').click();await q.locator('[name=conflict-0][value=local]').check();await q.locator('#cloud-conflict-form button[type=submit]').click();await sync(q);await sync(p);
 assert.equal((await state(p)).tasks.length,3);assert.equal((await state(p)).tasks.find(t=>t.title==='手机版本').note,'保留此修改');
 console.log('PASS: deletion versus edit offers recovery');
 let release,started;const waitStarted=new Promise(r=>started=r);delayRPC=async()=>{started();await new Promise(r=>release=r);};
 await edit(p,()=>{const s=Dayloom.getState();s.tasks[0].note='发送中的修改';Dayloom.applySync(s);});
 const inFlight=sync(p);await waitStarted;
 await edit(p,()=>{const s=Dayloom.getState();s.tasks[0].minutes=75;Dayloom.applySync(s);});release();await inFlight;await sync(p);
 assert.equal(docs.get(uid).data.tasks[0].minutes,75);
 console.log('PASS: local edits while upload is pending survive');
 await p.locator('#quick-task input').fill('尚未提交的输入');
 docs.get(uid).data.tasks[0].note='云端新备注';docs.get(uid).revision++;
 await sync(p);assert.equal(await p.locator('#quick-task input').inputValue(),'尚未提交的输入');
 await p.locator('#quick-task input').fill('');await p.locator('h1').click();await sync(p);assert.equal((await state(p)).tasks[0].note,'云端新备注');
 await p.locator('[data-view=settings]').click();await p.locator('[name=morning-start]').fill('09:15');await p.locator('h1').click();await sync(p);assert.equal(await p.locator('[name=morning-start]').inputValue(),'09:15');await p.locator('#settings-form button[type=submit]').click();await sync(p);await sync(q);assert.equal((await state(q)).settings.slots.morning[0],'09:15');
 console.log('PASS: unfinished inputs protected, saved settings sync');
 await p.locator('[data-view=calendar]').click();await p.screenshot({path:root+'/work/sync-desktop.png',fullPage:true});await q.screenshot({path:root+'/work/sync-mobile.png',fullPage:true});
 assert.equal(await q.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await q.locator('#cloud-button').click();await q.screenshot({path:root+'/work/sync-panel.png'});await q.locator('[data-sync=logout]').click();assert.equal((await status(q)).enabled,false);assert.equal((await state(q)).tasks.length,3);
 assert.deepEqual(errors,[]);console.log('PASS: mobile layout, logout retains plan; no browser exceptions. RPC writes: '+rpcCount);
}finally{await browser.close();await new Promise(r=>server.close(r));}
