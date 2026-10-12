/* Versioned browser-only data. Legacy keys remain intact until migration is persisted. */
(() => {
  'use strict';
  const KEY = 'zhezhi-local-v4', MAX_BACKUP_BYTES=50*1024*1024;
  const defaults = {theme:'paper', fontSize:16, lineHeight:2.3, width:700, motion:true};
  const uuid = () => globalThis.crypto?.randomUUID?.() || `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const clone = value => JSON.parse(JSON.stringify(value));
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  const str = (value, max=200000) => typeof value === 'string' && value.length <= max;
  const date = () => new Date().toISOString();
  let durable = true;
  function read(key, fallback) {
    try { const value=JSON.parse(localStorage.getItem(key)); return value ?? fallback; }
    catch { return fallback; }
  }
  function settings(value={}) {
    return {
      theme:['paper','warm','night'].includes(value.theme)?value.theme:'paper',
      fontSize:Math.max(13,Math.min(25,Number(value.fontSize)||16)),
      lineHeight:Math.max(1.8,Math.min(2.8,Number(value.lineHeight)||2.3)),
      width:[600,700,800].includes(Number(value.width))?Number(value.width):700,
      motion:value.motion !== false
    };
  }
  function authorSettings(value={}) {return {dailyWordGoal:Number.isInteger(value.dailyWordGoal)&&value.dailyWordGoal>=0&&value.dailyWordGoal<=1000000?value.dailyWordGoal:2000};}
  function workspace(id) {return {id,overview:{theme:'',mainline:'',ending:''},chapterCards:[],characters:[],relations:[],foreshadows:[],updatedAt:date()};}
  function empty() { return {version:4, library:[], history:[], ratings:{}, comments:{}, works:[], workspaces:[], inspirationNotes:[], writingRecords:[], authorSettings:authorSettings(), settings:{...defaults}, noticeVersion:0}; }
  function validate(input) {
    if (!object(input) || ![2,3,4].includes(input.version)) throw Error('不支持的数据版本');
    for (const key of ['library','history','works']) if(!Array.isArray(input[key]) || input[key].length>1000) throw Error('备份列表格式不正确');
    if(!object(input.ratings)||!object(input.comments)||!object(input.settings))throw Error('备份数据不完整');
    const output=empty();
    const safeId = id => str(id,160) && /^[\w:.-]+$/.test(id) && !['__proto__','constructor','prototype'].includes(id);
    output.library=input.library.map(row=>{
      if(!object(row)||!safeId(row.id)||!['want','reading','done'].includes(row.status))throw Error('书架数据格式不正确');
      return {id:row.id,status:row.status};
    });
    output.history=input.history.map(row=>{
      if(!object(row)||!safeId(row.id)||!Number.isInteger(row.chapterIndex)||row.chapterIndex<0||!Number.isFinite(row.progress)||row.progress<0||row.progress>100||!str(row.readAt,100))throw Error('阅读记录格式不正确');
      return {id:row.id,chapterIndex:row.chapterIndex,progress:row.progress,readAt:row.readAt};
    });
    for(const [id,rating] of Object.entries(input.ratings)){
      if(!safeId(id)||!Number.isInteger(rating)||rating<1||rating>5)throw Error('评分格式不正确');
      output.ratings[id]=rating;
    }
    for(const [id,list] of Object.entries(input.comments)){
      if(!safeId(id)||!Array.isArray(list)||list.length>30)throw Error('书评格式不正确');
      output.comments[id]=list.map(c=>{
        if(!object(c)||!str(c.text,300)||!str(c.createdAt,100))throw Error('书评格式不正确');
        return {id:safeId(c.id)?c.id:uuid(),text:c.text,createdAt:c.createdAt};
      });
    }
    const ids=new Set();
    output.works=input.works.map(w=>{
      if(!object(w)||!safeId(w.id)||ids.has(w.id)||!str(w.title,40)||!str(w.description,100)||!str(w.category,40)||!str(w.createdAt,100)||!str(w.updatedAt,100)||!Array.isArray(w.chapters)||!w.chapters.length||w.chapters.length>500)throw Error('作品数据格式不正确');
      ids.add(w.id);const chapterIds=new Set();
      return {id:w.id,title:w.title,description:w.description,category:w.category,createdAt:w.createdAt,updatedAt:w.updatedAt,chapters:w.chapters.map(c=>{
        if(!object(c)||!safeId(c.id)||chapterIds.has(c.id)||!str(c.title,80)||!str(c.content))throw Error('章节数据格式不正确');
        chapterIds.add(c.id);return {id:c.id,title:c.title,content:c.content};
      })};
    });
    if(input.version>=3){
      if(!Array.isArray(input.inspirationNotes)||input.inspirationNotes.length>10000||!Array.isArray(input.writingRecords)||input.writingRecords.length>100000||!object(input.authorSettings))throw Error('作者工具数据不完整');
      const noteIds=new Set(),recordIds=new Set();
      output.inspirationNotes=input.inspirationNotes.map(n=>{
        if(!object(n)||!safeId(n.id)||noteIds.has(n.id)||!str(n.title,80)||!str(n.content,20000)||(n.workId!==null&&!safeId(n.workId))||typeof n.pinned!=='boolean'||!str(n.createdAt,100)||!str(n.updatedAt,100))throw Error('灵感便条格式不正确');
        noteIds.add(n.id);return {id:n.id,title:n.title,content:n.content,workId:n.workId,pinned:n.pinned,createdAt:n.createdAt,updatedAt:n.updatedAt};
      });
      output.writingRecords=input.writingRecords.map(r=>{
        if(!object(r)||!safeId(r.id)||recordIds.has(r.id)||!safeId(r.workId)||!str(r.workTitle,40)||!/^\d{4}-\d{2}-\d{2}$/.test(r.date)||!Number.isFinite(Date.parse(r.date+'T00:00:00Z'))||new Date(r.date+'T00:00:00Z').toISOString().slice(0,10)!==r.date||!Number.isSafeInteger(r.durationMs)||r.durationMs<0||!Number.isSafeInteger(r.netWords)||!str(r.updatedAt,100))throw Error('写作记录格式不正确');
        recordIds.add(r.id);return {id:r.id,workId:r.workId,workTitle:r.workTitle,date:r.date,durationMs:r.durationMs,netWords:r.netWords,updatedAt:r.updatedAt};
      });
      if(!Number.isInteger(input.authorSettings.dailyWordGoal)||input.authorSettings.dailyWordGoal<0||input.authorSettings.dailyWordGoal>1000000)throw Error('每日目标格式不正确');
      output.authorSettings=authorSettings(input.authorSettings);
    }
    if(input.version===4){
      if(!Array.isArray(input.workspaces)||input.workspaces.length>1000)throw Error('创作设定格式不正确');
      const workspaceIds=new Set();
      output.workspaces=input.workspaces.map(w=>{
        if(!object(w)||!safeId(w.id)||workspaceIds.has(w.id)||!object(w.overview)||!['theme','mainline','ending'].every(k=>str(w.overview[k],20000))||!str(w.updatedAt,100))throw Error('作品大纲格式不正确');
        workspaceIds.add(w.id);const result=workspace(w.id);result.overview={theme:w.overview.theme,mainline:w.overview.mainline,ending:w.overview.ending};result.updatedAt=w.updatedAt;
        const readRows=(key,test,fields)=>{if(!Array.isArray(w[key])||w[key].length>2000)throw Error('创作设定列表格式不正确');const seen=new Set();return w[key].map(row=>{if(!object(row)||!safeId(row.id)||seen.has(row.id)||!test(row))throw Error('创作设定内容格式不正确');seen.add(row.id);return Object.fromEntries(['id',...fields].map(k=>[k,row[k]]));});};
        const ref=id=>id===null||safeId(id), texts=(row,keys,max=20000)=>keys.every(k=>str(row[k],max));
        result.chapterCards=readRows('chapterCards',r=>ref(r.chapterId)&&texts(r,['goal','conflict','turn']),['chapterId','goal','conflict','turn']);
        result.characters=readRows('characters',r=>str(r.name,40)&&r.name.trim()&&texts(r,['aliases','role','motivation','notes']),['name','aliases','role','motivation','notes']);
        const people=new Set(result.characters.map(c=>c.id));
        result.relations=readRows('relations',r=>people.has(r.from)&&people.has(r.to)&&r.from!==r.to&&str(r.label,80)&&['one','both'].includes(r.direction),['from','to','label','direction']);
        result.foreshadows=readRows('foreshadows',r=>str(r.title,80)&&str(r.content,20000)&&ref(r.plantChapterId)&&ref(r.payoffChapterId)&&['pending','resolved','abandoned'].includes(r.status),['title','content','plantChapterId','payoffChapterId','status']);
        return result;
      });
    }
    output.settings=settings(input.settings);
    output.noticeVersion=Number.isInteger(input.noticeVersion)?input.noticeVersion:0;
    return output;
  }
  function legacy() {
    const data=empty(), library=read('zhezhi-library',[]), history=read('zhezhi-history',[]), drafts=read('zhezhi-drafts',[]);
    data.library=Array.isArray(library)?library.filter(id=>typeof id==='string').map(id=>({id,status:'want'})):[];
    data.history=Array.isArray(history)?history.filter(r=>r&&typeof r.id==='string').map(r=>({id:r.id,chapterIndex:Math.max(0,Math.floor(Number(r.chapterIndex)||0)),progress:Math.max(0,Math.min(100,Number(r.progress)||0)),readAt:typeof r.readAt==='string'?r.readAt:date()})):[];
    const ratings=read('zhezhi-ratings',{}),comments=read('zhezhi-comments',{});
    if(object(ratings))for(const [id,v] of Object.entries(ratings))if(Number.isInteger(v)&&v>=1&&v<=5)data.ratings[id]=v;
    if(object(comments))for(const [id,list] of Object.entries(comments))if(Array.isArray(list))data.comments[id]=list.filter(c=>c&&str(c.text,300)).slice(0,30).map(c=>({id:uuid(),text:c.text,createdAt:str(c.createdAt,100)?c.createdAt:date()}));
    if(Array.isArray(drafts))data.works=drafts.filter(d=>d&&str(d.title,40)).map(d=>({id:uuid(),title:d.title,description:str(d.description,100)?d.description:'',category:str(d.category,40)?d.category:'日常',createdAt:str(d.createdAt,100)?d.createdAt:date(),updatedAt:str(d.updatedAt,100)?d.updatedAt:date(),chapters:[{id:uuid(),title:'故事开篇',content:str(d.content)?d.content:''}]}));
    let size=16,theme='paper';try{size=Number(localStorage.getItem('zhezhi-font-size'))||16;theme=localStorage.getItem('zhezhi-reading-theme')==='night'?'night':'paper'}catch{}
    data.settings=settings({fontSize:size,theme});return data;
  }
  let data;
  for(const candidate of [read(KEY,null),read('zhezhi-local-v3',null),read('zhezhi-local-v2',null)]){
    if(!candidate)continue;
    try{data=validate(candidate);break}catch{/* Try the preserved previous version. */}
  }
  if(!data)data=validate(legacy());
  function persist() {
    try { localStorage.setItem(KEY,JSON.stringify(data));durable=true; }
    catch { durable=false; }
    window.dispatchEvent(new CustomEvent('zhezhi-storage',{detail:{durable}}));
    return durable;
  }
  // Do not delete old keys; a failed migration remains recoverable.
  persist();
  function change(fn) {const next=clone(data);fn(next);data=next;return persist();}
  function backup() {return {format:'zhezhi-literature-backup',version:1,exportedAt:date(),data:clone({...data,noticeVersion:0})};}
  function parseBackup(text) {
    if(window.ZhezhiUtils.bytes(text)>MAX_BACKUP_BYTES)throw Error('备份超过 50 MB，请选择分批导出的文件');
    let parsed;try{parsed=JSON.parse(text)}catch{throw Error('文件不是有效的 JSON 备份')}
    if(parsed?.format!=='zhezhi-literature-backup'||parsed.version!==1)throw Error('请选择折纸文学导出的备份文件');
    const incoming=validate(parsed.data);incoming.chapterSnapshots=parsed.chapterSnapshots??[];incoming.historyScope=parsed.historyScope??'none';return incoming;
  }
  function merge(incoming) {
    return change(next=>{
      next.library=[...new Map([...next.library,...incoming.library].map(x=>[x.id,x])).values()];
      const histories=new Map(next.history.map(x=>[x.id,x]));
      incoming.history.forEach(x=>{if(!histories.has(x.id)||x.readAt>histories.get(x.id).readAt)histories.set(x.id,x)});
      next.history=[...histories.values()].sort((a,b)=>b.readAt.localeCompare(a.readAt)).slice(0,50);
      next.ratings={...next.ratings,...incoming.ratings};
      for(const [id,list] of Object.entries(incoming.comments))next.comments[id]=[...new Map([...(next.comments[id]||[]),...list].map(c=>[c.id,c])).values()].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,30);
      for(const key of ['works','inspirationNotes','writingRecords','workspaces'])next[key]=window.ZhezhiUtils.mergeLatest(next[key],incoming[key]);
      next.settings={...incoming.settings};
      next.authorSettings={...incoming.authorSettings};
    });
  }
  function clear(keys) {
    return change(next=>{
      keys.forEach(key=>{
        if(key==='feedback'){next.ratings={};next.comments={}}
        else if(key==='settings')next.settings={...defaults};
        else if(key==='authorSettings')next.authorSettings=authorSettings();
        else if(['library','history','works','inspirationNotes','writingRecords','workspaces'].includes(key))next[key]=[];
      });
      const old={library:['zhezhi-library'],history:['zhezhi-history'],feedback:['zhezhi-ratings','zhezhi-comments'],works:['zhezhi-drafts'],settings:['zhezhi-font-size','zhezhi-reading-theme']};
      keys.flatMap(k=>old[k]||[]).forEach(k=>{try{localStorage.removeItem(k)}catch{}});
      for(const key of ['zhezhi-local-v2','zhezhi-local-v3']){const previous=read(key,null);if(previous){keys.forEach(category=>{if(category==='feedback'){previous.ratings={};previous.comments={}}else if(category==='settings')previous.settings={...defaults};else if(['library','history','works','inspirationNotes','writingRecords'].includes(category))previous[category]=[]});try{localStorage.setItem(key,JSON.stringify(previous))}catch{}}}
    });
  }
  window.ZhezhiStore={get:()=>data,change,settings,authorSettings,workspace,MAX_BACKUP_BYTES,uuid,backup,parseBackup,merge,clear,isDurable:()=>durable,clone};
})();
