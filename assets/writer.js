/* Local author utilities. Duration uses a monotonic clock; calendar buckets use local dates. */
(() => {
  'use strict';
  const Store=window.ZhezhiStore, IDLE_MS=120000, SAVE_MS=15000;
  const recordIds=new Map(),pending=new Map();
  let work=null,running=false,manualPaused=false,lastActivity=0,checkpoint=0,wallCheckpoint=0,lastSaved=0;
  const dayKey=(date=new Date())=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  const wordCount=text=>String(text||'').replace(/\s/g,'').length;
  function rowFor(target,day){
    const key=`${target.id}:${day}`;if(!recordIds.has(key))recordIds.set(key,Store.uuid());const id=recordIds.get(key);
    if(!pending.has(id))pending.set(id,{id,workId:target.id,workTitle:(target.title||'未命名作品').slice(0,40),date:day,durationMs:0,netWords:0});
    const row=pending.get(id);row.workTitle=(target.title||'未命名作品').slice(0,40);return row;
  }
  function accrue(){
    if(!running||!work)return;
    const clock=performance.now(),end=Math.min(clock,lastActivity+IDLE_MS);
    let remaining=Math.max(0,end-checkpoint),wall=wallCheckpoint;
    while(remaining>0){
      const date=new Date(wall),midnight=new Date(date.getFullYear(),date.getMonth(),date.getDate()+1).getTime();
      const slice=Math.min(remaining,Math.max(1,midnight-wall));
      rowFor(work,dayKey(date)).durationMs+=slice;wall+=slice;remaining-=slice;
    }
    wallCheckpoint=wall;checkpoint=end;
    if(clock>=lastActivity+IDLE_MS)running=false;
  }
  function flush(){
    accrue();
    if(pending.size){
      Store.change(data=>{
        for(const row of pending.values()){
          const durationMs=Math.round(row.durationMs);
          if(!durationMs&&!row.netWords)continue;
          let stored=data.writingRecords.find(r=>r.id===row.id);
          if(!stored){stored={...row,durationMs:0,netWords:0};data.writingRecords.push(stored)}
          stored.durationMs+=durationMs;stored.netWords+=row.netWords;stored.workTitle=row.workTitle;stored.updatedAt=new Date().toISOString();
        }
      });pending.clear();
    }
    lastSaved=performance.now();notify();
  }
  function notify(){window.dispatchEvent(new Event('zhezhi-writing'));}
  function pause(manual=false){accrue();running=false;if(manual)manualPaused=true;flush();}
  function bind(target){pause();if(work?.id!==target.id)manualPaused=false;work={id:target.id,title:target.title};notify();}
  function activity(){
    accrue();if(!work||manualPaused||document.hidden)return;
    const clock=performance.now();
    if(!running){checkpoint=clock;wallCheckpoint=Date.now();lastSaved=clock;running=true}
    lastActivity=clock;notify();
  }
  function togglePause(){if(manualPaused){manualPaused=false;notify()}else pause(true);}
  function addWords(target,deltas){if(work?.id===target.id)work.title=target.title;for(const row of pending.values())if(row.workId===target.id)row.workTitle=(target.title||'未命名作品').slice(0,40);for(const [day,words] of Object.entries(deltas))if(words)rowFor(target,day).netWords+=words;flush();}
  function records(){accrue();return [...Store.get().writingRecords,...pending.values()];}
  function summary(filter=''){
    const today=dayKey(),week=new Date();week.setHours(0,0,0,0);week.setDate(week.getDate()-(week.getDay()+6)%7);
    const first=dayKey(week),rows=records().filter(r=>!filter||r.workId===filter);
    const sum=(select,key)=>rows.filter(select).reduce((n,r)=>n+r[key],0);
    return {todayMs:sum(r=>r.date===today,'durationMs'),weekMs:sum(r=>r.date>=first&&r.date<=today,'durationMs'),totalMs:sum(()=>true,'durationMs'),todayWords:sum(r=>r.date===today,'netWords')};
  }
  function duration(ms){const seconds=Math.floor(ms/1000),hours=Math.floor(seconds/3600),minutes=Math.floor(seconds%3600/60);return `${hours?hours+' 小时 ':''}${minutes} 分 ${seconds%60} 秒`;}
  function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function filename(title){return (String(title||'').replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g,'_').replace(/[. ]+$/g,'').trim().slice(0,100)||'未命名作品').replace(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i,'_$1');}
  function exportTxt(target,chapterId){
    const chapters=chapterId?target.chapters.filter(c=>c.id===chapterId):target.chapters;
    const lines=[target.title.trim()||'未命名作品'];if(!chapterId&&target.description)lines.push(target.description);
    chapters.forEach(c=>lines.push(c.title.trim()||'未命名章节',c.content));
    const text=lines.join('\n\n').replace(/\r\n?/g,'\n').replace(/\n/g,'\r\n');
    const suffix=chapterId?'-'+filename(chapters[0]?.title||'未命名章节'):'';
    download(new Blob(['\ufeff',text],{type:'text/plain;charset=utf-8'}),filename(target.title)+suffix+'.txt');
  }
  setInterval(()=>{const active=running;accrue();if(active&&!running||running&&performance.now()-lastSaved>=SAVE_MS)flush();else if(running)notify();},1000);
  window.ZhezhiWriter={dayKey,wordCount,bind,activity,pause,togglePause,flush,addWords,records,summary,duration,download,exportTxt,state:()=>({running,manualPaused})};
})();
