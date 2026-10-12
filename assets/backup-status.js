/* Export reminders are device-local; importing a file never acknowledges a backup. */
(() => {
 'use strict';const Store=window.ZhezhiStore,Coord=window.ZhezhiCoordination,key='zhezhi-backup-device-v5',{esc,count}=window.ZhezhiUtils;
 let queue=Promise.resolve();
 function read(){try{const state=JSON.parse(localStorage.getItem(key));if(state&&typeof state==='object'&&state.entries)return state}catch{}return {entries:{},last:null,snooze:0}}
 let state=read();
 function update(fn){const next=queue.catch(()=>{}).then(()=>Coord.commit(()=>{if(Coord.supported&&Store.isDurable())state=read();fn(state);if(Coord.supported&&Store.isDurable())try{localStorage.setItem(key,JSON.stringify(state))}catch{}render()}));queue=next;return next}
 const entry=(s,id)=>Object.hasOwn(s.entries,id)?s.entries[id]:(s.entries[id]={generation:0,dirty:false,historyDirty:false,words:0,firstChanged:null});
 function changedWords(a,b){let start=0,end=0;while(start<Math.min(a.length,b.length)&&a[start]===b[start])start++;while(end<Math.min(a.length,b.length)-start&&a[a.length-1-end]===b[b.length-1-end])end++;return count(a.slice(start,a.length-end))+count(b.slice(start,b.length-end))}
 window.addEventListener('zhezhi-commit',event=>{const {before,after}=event.detail,ids=new Set();let words={};
  for(const id of new Set([...before.works,...after.works,...before.workspaces,...after.workspaces,...before.inspirationNotes,...after.inspirationNotes].map(r=>r.workId||r.id))){const fields=data=>[data.works.find(r=>r.id===id),data.workspaces.find(r=>r.id===id),data.inspirationNotes.filter(r=>r.workId===id||!r.workId&&r.id===id)];if(JSON.stringify(fields(before))!==JSON.stringify(fields(after)))ids.add(id)}
  for(const work of after.works){const old=before.works.find(w=>w.id===work.id);words[work.id]=work.chapters.reduce((n,c)=>{const previous=old?.chapters.find(r=>r.id===c.id);return n+changedWords(previous?.content||'',c.content)},0)}
  if(ids.size)update(s=>{for(const id of ids){const row=entry(s,id);row.generation++;row.dirty=true;row.firstChanged||=Date.now();row.words+=words[id]||0}});
 });
 function history(workId){return update(s=>{const row=entry(s,workId);row.generation++;row.historyDirty=true;row.firstChanged||=Date.now()})}
 function due(){return Store.get().authorSettings.backupReminders!==false&&Date.now()>=state.snooze&&Object.values(state.entries).some(r=>(r.dirty||r.historyDirty)&&(r.words>=5000||(r.lastExport?.time||r.firstChanged)&&Date.now()-(r.lastExport?.time||r.firstChanged)>=7*86400000))}
 function markup(){const last=state.last,description=last?new Date(last.time).toLocaleString('zh-CN')+' · '+(last.scope==='work'?'单部作品':'全站数据')+' · '+({all:'含完整历史',selected:'含部分历史',none:'不含历史'}[last.history]):'尚未发起 JSON 备份';const dirty=Object.values(state.entries).some(r=>r.dirty||r.historyDirty);return '<p class="help-text">上次发起导出：'+esc(description)+(dirty?' · 有未备份的创作修改':'')+'<br>浏览器无法确认文件是否最终保存，请自行检查下载文件。</p>'+ (due()?'<div class="backup-reminder" role="status"><span>给最近的创作留一份外部备份吧。</span><button class="outline-button" data-action="export">立即备份</button><button class="quiet-button" data-action="backup-snooze">24 小时后提醒</button></div>':'')}
 function render(){for(const el of document.querySelectorAll('[data-backup-info]'))el.innerHTML=markup()}
 async function capture(){await queue;return structuredClone(state.entries)}
 function exported(captured,scope,historyScope,workId){return update(s=>{s.last={time:Date.now(),scope,history:historyScope,workId};for(const [id,c] of Object.entries(captured)){if(scope==='work'&&id!==workId)continue;const r=entry(s,id);if(r.generation!==c.generation)continue;r.dirty=false;r.words=0;r.lastExport={time:s.last.time,scope,history:historyScope};r.historyDirty=historyScope!=='all';if(!r.historyDirty)r.firstChanged=null;else r.firstChanged||=Date.now()}})}
 window.addEventListener('storage',event=>{if(event.key===key&&Store.isDurable()){state=read();render()}});
 window.ZhezhiBackupStatus={markup,render,capture,exported,history,snooze:()=>update(s=>s.snooze=Date.now()+86400000),state:()=>structuredClone(state),due,settled:()=>queue};
})();
