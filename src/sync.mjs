import {createClient} from '@supabase/supabase-js';
import {copy,equal,mergePlans,resolveConflicts} from './merge.mjs';
const D=window.Dayloom,config=window.DAYLOOM_CLOUD;
const BINDING='dayloom-cloud-binding-v1',PREFIX='dayloom-cloud-base-v1:',PRE_SYNC='dayloom-before-cloud-v1';
let client,user=null,busy=false,enabled=false,lastError='',status='未登录',kind='',timer,lastSync='',pending=null,epoch=0;
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function getJSON(key){try{return JSON.parse(localStorage.getItem(key)||'null');}catch{return null;}}
const baseKey=()=>PREFIX+config.url+':'+user.id;
function getBase(){const value=getJSON(baseKey());if(!value||!Number.isSafeInteger(value.revision))return null;try{return {...value,data:D.validateState(value.data)};}catch{return null;}}
function bound(){const b=getJSON(BINDING);return b&&b.url===config.url&&b.userId===user?.id;}
function setStatus(text,state=''){status=text;kind=state;drawStatus();}
function drawStatus(){
 let button=$('#cloud-button');if(!button){button=document.createElement('button');button.id='cloud-button';button.className='button small cloud-button';button.dataset.sync='open';$('.topbar-actions').prepend(button);}
 button.textContent=status;button.dataset.state=kind;button.title=user?`${user.email||'已登录'} · ${status}`:'登录后同步手机与电脑';button.setAttribute('aria-label','云同步：'+status);
 const settings=$('#settings-form');if(settings&&!$('#cloud-settings-entry')){const section=document.createElement('section');section.id='cloud-settings-entry';section.className='settings-card cloud-settings-entry';section.innerHTML='<div><h2>手机与电脑同步</h2><p>登录同一个账号，任务、倒数日和设置自动合并。</p></div><button class="button soft" type="button" data-sync="open">管理同步</button>';settings.before(section);}
 if($('#cloud-live-status'))$('#cloud-live-status').textContent=status+(lastSync?' · 上次成功 '+lastSync:'');
 if(settings&&getJSON(PRE_SYNC)?.state&&!$('#cloud-backup-button')){const backup=document.createElement('button');backup.id='cloud-backup-button';backup.className='button small';backup.type='button';backup.dataset.sync='backup';backup.textContent='下载首次同步前备份';$('#cloud-settings-entry').append(backup);}
}
function errorMessage(error){const s=String(error?.message||error);if(/Invalid login credentials/i.test(s))return '邮箱或密码不正确，请使用在 Authentication → Users 中创建的同步账号。';if(/Email not confirmed/i.test(s))return '邮箱尚未确认，请在 Supabase 的 Users 页面确认该账号。';if(/fetch|network|timeout|abort/i.test(s))return '连接超时或网络不可用。修改仍保存在本机，连接恢复后会重试。';if(/relation.*not exist|Could not find.*dayloom|permission denied/i.test(s))return '数据库尚未完成设置或访问权限不足，请检查初始化 SQL 是否已成功运行。';return s.slice(0,350);}
function fail(error){lastError=errorMessage(error);setStatus('同步未完成','error');}
function openPanel(){
 if(!config?.url||!config?.key){D.showDialog('云同步', '<div class="dialog-body cloud-panel"><p>当前版本尚未配置云端连接。</p></div>');return;}
 if(!user){D.showDialog('登录云同步',`<form id="cloud-login-form"><div class="dialog-body cloud-panel"><p>手机和电脑使用同一个同步账号，任务会自动保持一致。</p><label class="field"><span>邮箱</span><input type="email" name="email" autocomplete="username" required placeholder="你的邮箱"></label><label class="field"><span>密码</span><input type="password" name="password" autocomplete="current-password" required></label><div class="form-error" id="cloud-login-error">${esc(lastError)}</div><p class="cloud-setup-note">使用已创建的时序同步账号。登录前的计划仍保存在本机，首次同步会先确认如何合并。</p></div><div class="dialog-footer"><button type="button" class="button" data-action="close-dialog">取消</button><button type="submit" class="button primary">登录</button></div></form>`);return;}
 const binding=getJSON(BINDING),other=binding&&(binding.userId!==user.id||binding.url!==config.url);
 D.showDialog('手机与电脑同步',`<div class="dialog-body cloud-panel"><div class="cloud-account">${esc(user.email||'已登录账号')}<div id="cloud-live-status" class="cloud-state">${esc(status)}${lastSync?' · 上次成功 '+esc(lastSync):''}</div></div>${lastError?`<p class="cloud-error">${esc(lastError)}</p>`:''}<p>${enabled?'任务修改后自动上传；页面打开时约每 15 秒检查云端，切回页面也会刷新。离线修改会在重连后合并。':'首次同步会先查看云端计划，再由你选择合并方式。'}</p>${other?'<p class="cloud-error">本机计划关联了另一个账号。本次连接只会读取当前账号的云端计划；旧计划会保留一份本机备份。</p>':''}${pending?'<p>发现同一内容在两端都有修改，请处理冲突后继续同步。</p>':''}<p class="cloud-setup-note">关闭页面期间不会后台同步；重新打开后会拉取最新计划。退出登录会保留本机计划。</p></div><div class="dialog-footer cloud-footer"><button class="button danger" data-sync="logout">退出登录</button><button class="button" data-sync="connection-test">测试连接</button>${pending?'<button class="button primary" data-sync="resolve">处理冲突</button>':enabled?'<button class="button primary" data-sync="now">立即同步</button>':'<button class="button primary" data-sync="attach">开启同步</button>'}</div>`);
}
async function readRemote(){const {data,error}=await client.from('dayloom_documents').select('revision,data').eq('user_id',user.id).maybeSingle();if(error)throw error;if(!data)return {revision:0,data:D.emptyState()};if(!Number.isSafeInteger(data.revision)||data.revision<1)throw Error('云端版本无效，请检查数据');return {revision:data.revision,data:D.validateState(data.data)};}
function storeBase(remote){localStorage.setItem(baseKey(),JSON.stringify(remote));localStorage.setItem(BINDING,JSON.stringify({url:config.url,userId:user.id}));}
function finish(remote,localSnapshot){
 if(D.isEditing()){setStatus('编辑完成后同步');return false;}
 const rebased=mergePlans(localSnapshot,D.getState(),remote.data);
 if(rebased.conflicts.length){pending={merged:rebased,remote,local:D.getState()};setStatus('需要处理冲突','error');return false;}
 const value=D.validateState(rebased.data);if(!equal(value,D.getState()))D.applySync(value);storeBase(remote);lastError='';lastSync=new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Shanghai'});setStatus(equal(value,remote.data)?'已同步':'有修改待同步');return true;
}
async function syncInside(){
 if(!user||!enabled||busy||pending||D.isEditing()||document.hidden)return;
 if(!navigator.onLine){setStatus('离线 · 本机已保存');return;}
 const currentEpoch=epoch;busy=true;setStatus('同步中…');
 try{
  let remote=await readRemote();
  for(let attempts=0;attempts<4;attempts++){
   if(epoch!==currentEpoch||!enabled||!user)return;
   if(D.isEditing()){setStatus('编辑完成后同步');return;}
   const base=getBase();if(!base){enabled=false;setStatus('请确认首次同步');return;}
   const local=D.getState(),merged=mergePlans(base.data,local,remote.data);
   if(merged.conflicts.length){pending={merged,remote,local};setStatus('需要处理冲突','error');return;}
   const next=D.validateState(merged.data);
   if(equal(next,remote.data)){finish(remote,local);return;}
   const {data,error}=await client.rpc('dayloom_save',{expected_revision:remote.revision,new_data:next});if(error)throw error;
   if(epoch!==currentEpoch||!user)return;
   if(!data||typeof data.applied!=='boolean'||!Number.isSafeInteger(data.revision))throw Error('云端返回格式无效');
   remote={revision:data.revision,data:data.data?D.validateState(data.data):D.emptyState()};
   if(data.applied){finish(remote,local);return;}
  }
  setStatus('云端正在更新，稍后重试');
 }catch(error){fail(error);}finally{busy=false;}
}
async function sync(){if(!user)return;if(navigator.locks){await navigator.locks.request('dayloom-sync-'+user.id,{ifAvailable:true},async lock=>{if(lock)await syncInside();});}else await syncInside();}
function schedule(){clearTimeout(timer);timer=setTimeout(()=>{sync();},1200);}
async function attach(){
 if(!user||busy)return;busy=true;setStatus('读取云端…');const currentEpoch=epoch;
 try{const remote=await readRemote();if(currentEpoch!==epoch)return;const local=D.getState(),binding=getJSON(BINDING),other=binding&&(binding.userId!==user.id||binding.url!==config.url);
  D.showDialog('确认首次同步',`<div class="dialog-body cloud-panel"><p>本机有 ${local.tasks.length} 项任务、${local.milestones.length} 个重要日期。<br>云端有 ${remote.data.tasks.length} 项任务、${remote.data.milestones.length} 个重要日期。</p><p>${other?'当前登录的是另一个账号。请选择读取该账号的云端计划，旧计划会保留本机备份。':'合并会保留双方的不同任务；云端已有计划时采用云端的专注时段设置。同一内容有冲突时会让你选择。'}</p><p class="cloud-setup-note">操作前会自动保留一份本机备份，也可先从偏好设置导出 JSON 备份。</p></div><div class="dialog-footer cloud-footer"><button class="button" data-action="close-dialog">暂不开启</button><button class="button" id="cloud-use-remote">只读取云端</button>${!other?'<button class="button primary" id="cloud-merge-first">合并并开启</button>':''}</div>`);
  const activate=mode=>{
   try{localStorage.setItem(PRE_SYNC,JSON.stringify({savedAt:new Date().toISOString(),binding,state:D.getState()}));const snapshot=D.getState();let result;
    if(mode==='remote')result={data:remote.data,conflicts:[]};
    else if(!remote.revision)result={data:snapshot,conflicts:[]};
    else {const adjusted={...snapshot,settings:copy(remote.data.settings)};result=mergePlans(D.emptyState(),adjusted,remote.data);}
    $('#editor').close();storeBase(remote);enabled=true;
    if(result.conflicts.length){pending={merged:result,remote,local:snapshot};showConflicts();}
    else{D.applySync(D.validateState(result.data));setStatus('准备同步');sync();}
   }catch(error){fail(error);openPanel();}
  };
  $('#cloud-use-remote').onclick=()=>activate('remote');if($('#cloud-merge-first'))$('#cloud-merge-first').onclick=()=>activate('merge');setStatus('请确认首次同步');
 }catch(error){fail(error);openPanel();}finally{busy=false;}
}
const FIELD_LABELS={title:'任务名称',done:'完成状态',minutes:'预计时长',date:'计划日期',slot:'专注时段',priority:'优先级',due:'截止日期',note:'备注',settings:'偏好设置',exerciseDone:'锻炼打卡',courseHints:'课程占用提示',semester:'学期开始',exercise:'锻炼时段',exerciseEnabled:'显示锻炼',morning:'上午',afternoon:'下午',evening:'晚上'};
function valueText(value){if(value===undefined)return '已删除';if(value===true)return '是 / 已完成';if(value===false)return '否 / 未完成';if(typeof value==='object')return JSON.stringify(value);return String(value||'留空');}
function showConflicts(){
 if(!pending)return openPanel();const item=pending;
 D.showDialog('选择要保留的修改',`<form id="cloud-conflict-form"><div class="dialog-body cloud-panel"><p>以下内容在本机和云端都被修改，选择后继续同步。</p>${item.merged.conflicts.map((c,i)=>{const task=[...item.local.tasks,...item.local.milestones,...item.remote.data.tasks,...item.remote.data.milestones].find(t=>t.id===c.path[1]);const label=task?.title||FIELD_LABELS[c.path[0]]||'计划';return `<div class="cloud-conflict"><strong>${esc(label)} · ${esc(FIELD_LABELS[c.path.at(-1)]||'整项内容')}</strong><label><input type="radio" name="conflict-${i}" value="local" required>本机：${esc(valueText(c.local))}</label><label><input type="radio" name="conflict-${i}" value="remote" required>云端：${esc(valueText(c.remote))}</label></div>`;}).join('')}<div id="cloud-conflict-error" class="form-error"></div></div><div class="dialog-footer"><button type="button" class="button" data-action="close-dialog">稍后处理</button><button type="submit" class="button primary">保留选择并同步</button></div></form>`);
 $('#cloud-conflict-form').onsubmit=e=>{e.preventDefault();try{const f=new FormData(e.target),chosen=resolveConflicts(item.merged,item.merged.conflicts.map((_,i)=>f.get('conflict-'+i)));const rebased=mergePlans(item.local,D.getState(),chosen);if(rebased.conflicts.length){pending={merged:rebased,remote:item.remote,local:D.getState()};showConflicts();return;}const value=D.validateState(rebased.data);D.applySync(value);storeBase(item.remote);pending=null;$('#editor').close();schedule();setStatus('准备同步');}catch(error){$('#cloud-conflict-error').textContent=errorMessage(error);}};
}
async function setUser(next){
 if(user?.id===next?.id)return;
 epoch++;user=next;enabled=!!user&&bound()&&!!getBase();pending=null;lastError='';setStatus(!user?'登录同步':enabled?'检查云端…':'开启同步');if(enabled)schedule();
}
async function testConnection(){
 const el=$('#cloud-live-status');if(el)el.textContent='正在测试…';const begin=performance.now();
 try{const response=await fetch(config.url+'/auth/v1/health',{headers:{apikey:config.key},signal:AbortSignal.timeout(12000)});if(!response.ok)throw Error('连接响应 '+response.status);lastError='';if(el)el.textContent=`连接成功，用时 ${((performance.now()-begin)/1000).toFixed(1)} 秒`;D.toast('云端连接正常');}catch(error){fail(error);if(el)el.textContent=lastError;}
}
document.addEventListener('click',async e=>{const b=e.target.closest('[data-sync]');if(!b)return;
 const action=b.dataset.sync;
 if(action==='backup'){try{const data=D.validateState(getJSON(PRE_SYNC)?.state),url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='dayloom-before-sync.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}catch(error){D.toast('无法读取同步前备份：'+errorMessage(error));}return;}
 if(action==='open')return openPanel();if(action==='attach')return attach();if(action==='resolve')return showConflicts();if(action==='connection-test')return testConnection();
 if(action==='now'){$('#editor').close();return sync();}
 if(action==='logout'){epoch++;enabled=false;pending=null;try{const {error}=await client.auth.signOut({scope:'local'});if(error)throw error;user=null;$('#editor').close();setStatus('登录同步');D.toast('已退出，本机计划仍保留');}catch(error){fail(error);openPanel();}}
});
document.addEventListener('submit',async e=>{if(e.target.getAttribute('id')!=='cloud-login-form')return;e.preventDefault();const form=e.target,button=form.querySelector('button[type=submit]'),f=new FormData(form);button.disabled=true;button.textContent='登录中…';try{const {data,error}=await client.auth.signInWithPassword({email:String(f.get('email')).trim(),password:String(f.get('password'))});if(error)throw error;form.querySelector('[name=password]').value='';await setUser(data.user);$('#editor').close();if(enabled){schedule();D.toast('已登录，开始同步');}else await attach();}catch(error){$('#cloud-login-error').textContent=errorMessage(error);}finally{button.disabled=false;button.textContent='登录';}});
document.addEventListener('dayloom:render',drawStatus);
document.addEventListener('dayloom:change',()=>{if(enabled){setStatus(navigator.onLine?'有修改待同步':'离线 · 本机已保存');schedule();}});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)schedule();});window.addEventListener('online',schedule);window.addEventListener('offline',()=>{if(enabled)setStatus('离线 · 本机已保存');});
$('#editor').addEventListener('close',schedule);
window.addEventListener('storage',e=>{if(e.key==='dayloom-planner-v1'||e.key?.startsWith(PREFIX))schedule();});
setInterval(sync,15000);
try{
 if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(config.url)||!config.key.startsWith('sb_publishable_'))throw Error('云端连接配置无效');
 client=createClient(config.url,config.key,{auth:{storageKey:'dayloom-cloud-auth-v1',persistSession:true,autoRefreshToken:true,detectSessionInUrl:false},global:{fetch:(url,init={})=>fetch(url,{...init,signal:init.signal?AbortSignal.any([init.signal,AbortSignal.timeout(12000)]):AbortSignal.timeout(12000)})}});
 client.auth.onAuthStateChange((_event,session)=>{setTimeout(()=>setUser(session?.user||null),0);});
 client.auth.getSession().then(({data,error})=>{if(error)throw error;setUser(data.session?.user||null);}).catch(fail);
 setStatus('登录同步');
}catch(error){fail(error);}
window.DayloomSync={mergePlans,sync,open:openPanel,getStatus:()=>({status,enabled,pending:!!pending,user:user?.id||null})};
