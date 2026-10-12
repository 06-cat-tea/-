/* Deterministic migration, backup, calendar and monotonic-timer checks. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const scripts=['utils.js','store.js','writer.js'].map(name=>fs.readFileSync(path.join(__dirname,'..','assets',name),'utf8'));
async function environment({initial={},blocked=false,start=new Date(2026,9,12,12).getTime()}={}){
  let wall=start,clock=0,id=0;const storage=new Map(Object.entries(initial)),ticks=[];
  class ClockDate extends Date{constructor(...args){super(...(args.length?args:[wall]))}static now(){return wall}}
  const context=vm.createContext({TextEncoder,Date:ClockDate,performance:{now:()=>clock},crypto:{randomUUID:()=>`test-${++id}`},document:{hidden:false},console,Event:class{},CustomEvent:class{},setInterval:fn=>ticks.push(fn),setTimeout:()=>{},localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>{if(blocked)throw Error('quota');storage.set(key,value)},removeItem:key=>storage.delete(key)}});
  context.window=context;context.dispatchEvent=()=>{};context.addEventListener=()=>{};context.ZhezhiCoordination={supported:true,has:()=>true,announce:()=>{},commit:fn=>Promise.resolve().then(fn),withWorks:async(ids,fn)=>fn()};
  scripts.forEach(script=>vm.runInContext(script,context));
  await context.ZhezhiStore.ready;
  return {Store:context.ZhezhiStore,Writer:context.ZhezhiWriter,context,storage,async advance(ms){wall+=ms;clock+=ms;ticks.forEach(fn=>fn());await context.ZhezhiStore.settled()}};
}
const work={id:'stable-work',title:'测试作品',description:'',category:'日常',createdAt:'2026-10-12T00:00:00Z',updatedAt:'2026-10-12T00:00:00Z',chapters:[{id:'stable-chapter',title:'第一章',content:'旧稿'}]};
const note={id:'note-1',title:'灵感',content:'人物对白',workId:work.id,pinned:false,createdAt:work.createdAt,updatedAt:work.updatedAt};
const checks=[];async function check(name,fn){await fn();checks.push(name);console.log('PASS '+name)}
(async()=>{
await check('v2 migration preserves IDs and previous storage, including denied writes',async()=>{
  const empty=JSON.parse(JSON.stringify((await environment()).Store.get()));empty.version=2;empty.works=[work];delete empty.authorSettings;delete empty.inspirationNotes;delete empty.writingRecords;
  const source=JSON.stringify(empty);
  for(const blocked of [false,true]){const env=await environment({initial:{'zhezhi-local-v2':source},blocked});assert.equal(env.Store.get().version,5);assert.equal(env.Store.get().works[0].chapters[0].id,'stable-chapter');assert.equal(env.Store.get().authorSettings.dailyWordGoal,2000);assert.equal(env.storage.get('zhezhi-local-v2'),source);assert.equal(env.Store.isDurable(),!blocked);assert.equal(env.Store.parseBackup(JSON.stringify({format:'zhezhi-literature-backup',version:1,data:empty})).version,5)}
});
await check('timer checkpoints, idle cutoff, manual resume and background pause',async()=>{
  const {Store,Writer,context,advance}=await environment();Writer.bind(work);assert.equal(Writer.state().running,false);Writer.activity();await advance(15000);assert.equal(Store.get().writingRecords[0].durationMs,15000);await advance(115000);assert.equal(Writer.summary().totalMs,120000);assert.equal(Writer.state().running,false);
  Writer.activity();await advance(3000);await Writer.togglePause();const baseline=Writer.summary().totalMs;Writer.activity();await advance(10000);assert.equal(Writer.summary().totalMs,baseline);await Writer.togglePause();assert.equal(Writer.state().running,false);Writer.activity();await advance(2000);await Writer.pause();context.document.hidden=true;Writer.activity();await advance(5000);assert.equal(Writer.summary().totalMs,baseline+2000);
});
await check('cross-midnight duration splits into local calendar days',async()=>{
  const {Store,Writer,advance}=await environment({start:new Date(2026,9,12,23,59,50).getTime()});Writer.bind(work);Writer.activity();await advance(20000);await Writer.pause();const rows=Store.get().writingRecords;assert.equal(rows.length,2);assert.equal(rows.find(r=>r.date==='2026-10-12').durationMs,10000);assert.equal(rows.find(r=>r.date==='2026-10-13').durationMs,10000);assert.equal(Writer.summary().todayMs,10000);assert.equal(Writer.summary().weekMs,20000);
});
await check('Monday week boundary and negative net words are preserved',async()=>{
  const {Store,Writer}=await environment();await Store.change(d=>{d.writingRecords=[{id:'sunday',workId:work.id,workTitle:work.title,date:'2026-10-11',durationMs:9000,netWords:30,updatedAt:work.updatedAt}]});await Writer.addWords(work,{'2026-10-12':-7});assert.equal(Writer.summary().todayWords,-7);assert.equal(Writer.summary().weekMs,0);assert.equal(Writer.summary().totalMs,9000);
});
await check('backup merge is idempotent and selects newer notes and records',async()=>{
  const {Store,Writer,advance}=await environment();await Store.change(d=>{d.works=[work];d.inspirationNotes=[note]});Writer.bind(work);Writer.activity();await advance(2000);await Writer.addWords(work,{'2026-10-12':10});await Writer.pause();const text=JSON.stringify(Store.backup()),before=JSON.stringify(Store.get());await Store.merge(Store.parseBackup(text));await Store.merge(Store.parseBackup(text));assert.equal(JSON.stringify(Store.get()),before);
  const incoming=Store.parseBackup(text);incoming.inspirationNotes[0].content='新版灵感';incoming.inspirationNotes[0].updatedAt='2026-10-13T00:00:00Z';await Store.merge(incoming);assert.equal(Store.get().inspirationNotes[0].content,'新版灵感');assert.equal(Writer.summary().todayWords,10);
});
await check('malformed author backups are rejected before mutation',async()=>{
  const {Store}=await environment();await Store.change(d=>{d.works=[work];d.inspirationNotes=[note];d.writingRecords=[{id:'record-1',workId:work.id,workTitle:work.title,date:'2026-10-12',durationMs:10,netWords:2,updatedAt:work.updatedAt}]});
  const before=JSON.stringify(Store.get());for(const mutate of [d=>d.inspirationNotes.push({...note}),d=>d.inspirationNotes[0].id='__proto__',d=>d.writingRecords[0].date='2026-02-30',d=>d.writingRecords[0].durationMs=-1,d=>d.authorSettings.dailyWordGoal=-1]){const backup=Store.backup();mutate(backup.data);assert.throws(()=>Store.parseBackup(JSON.stringify(backup)));assert.equal(JSON.stringify(Store.get()),before)}
});
await check('work cleanup preserves notes and records; category cleanup stays independent',async()=>{
  const {Store,Writer}=await environment();await Store.change(d=>{d.works=[work];d.inspirationNotes=[note]});await Writer.addWords(work,{'2026-10-12':5});await Store.clear(['works']);assert.equal(Store.get().inspirationNotes.length,1);assert.equal(Store.get().writingRecords.length,1);await Store.clear(['inspirationNotes']);assert.equal(Store.get().writingRecords.length,1);await Store.clear(['writingRecords']);assert.equal(Store.get().writingRecords.length,0);
});
await check('v3 migration preserves author records and initializes independent workspace data',async()=>{
  const original=await (await environment()).Store.backup().data;original.version=3;delete original.workspaces;original.works=[work];original.inspirationNotes=[note];original.authorSettings.dailyWordGoal=0;
  const {Store}=await environment({initial:{'zhezhi-local-v3':JSON.stringify(original)}});assert.equal(Store.get().version,5);assert.equal(Store.get().works[0].id,work.id);assert.equal(Store.get().inspirationNotes[0].id,note.id);assert.equal(Store.get().authorSettings.dailyWordGoal,0);assert.equal(Store.get().workspaces.length,0);
});
await check('repeated pause and statistics reads do not cause duplicate storage writes',async()=>{
  const {Store,Writer,advance}=await environment();let writes=0;const change=Store.change;Store.change=fn=>{writes++;return change(fn)};Writer.bind(work);await Writer.pause();await Writer.pause();await Writer.flush();Writer.summary();assert.equal(writes,0);Writer.activity();await advance(15000);assert.equal(writes,1);await Writer.pause();await Writer.pause();Writer.summary();Writer.summary();assert.equal(writes,1);
});
await check('workspace merge chooses newer settings and rejects broken character relations',async()=>{
  const {Store}=await environment();const settings=Store.workspace(work.id);settings.characters=[{id:'person-a',name:'甲',aliases:'',role:'旅人',motivation:'',notes:''},{id:'person-b',name:'乙',aliases:'',role:'剑修',motivation:'',notes:''}];settings.relations=[{id:'relation-a',from:'person-a',to:'person-b',label:'同行',direction:'both'}];settings.chapterCards=[{id:'card-a',chapterId:'deleted-chapter',goal:'保留已删除章节的卡片',conflict:'',turn:''}];await Store.change(d=>{d.works=[work];d.workspaces=[settings]});const incoming=Store.parseBackup(JSON.stringify(Store.backup()));incoming.workspaces[0].overview.theme='更新主题';incoming.workspaces[0].updatedAt='2026-10-13T00:00:00Z';await Store.merge(incoming);assert.equal(Store.get().workspaces[0].overview.theme,'更新主题');const broken=Store.backup();broken.data.workspaces[0].relations[0].to='missing-person';assert.throws(()=>Store.parseBackup(JSON.stringify(broken)),/创作设定/);await Store.clear(['works']);assert.equal(Store.get().workspaces.length,1);await Store.clear(['workspaces']);assert.equal(Store.get().workspaces.length,0);
});
await check('backup size validation uses UTF-8 bytes rather than character count',async()=>{
  const {Store}=await environment();const oversized='汉'.repeat(Math.floor(Store.MAX_BACKUP_BYTES/3)+1);assert(oversized.length<Store.MAX_BACKUP_BYTES);assert.throws(()=>Store.parseBackup(oversized),/50 MB/);
});
console.log(`${checks.length} author unit scenarios passed.`);

})().catch(error=>{console.error(error);process.exitCode=1});
