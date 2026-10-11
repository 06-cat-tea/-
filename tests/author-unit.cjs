/* Deterministic migration, backup, calendar and monotonic-timer checks. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const scripts=['store.js','writer.js'].map(name=>fs.readFileSync(path.join(__dirname,'..','assets',name),'utf8'));
function environment({initial={},blocked=false,start=new Date(2026,9,12,12).getTime()}={}){
  let wall=start,clock=0,id=0;const storage=new Map(Object.entries(initial)),ticks=[];
  class ClockDate extends Date{constructor(...args){super(...(args.length?args:[wall]))}static now(){return wall}}
  const context=vm.createContext({Date:ClockDate,performance:{now:()=>clock},crypto:{randomUUID:()=>`test-${++id}`},document:{hidden:false},console,Event:class{},CustomEvent:class{},setInterval:fn=>ticks.push(fn),setTimeout:()=>{},localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>{if(blocked)throw Error('quota');storage.set(key,value)},removeItem:key=>storage.delete(key)}});
  context.window=context;context.dispatchEvent=()=>{};
  scripts.forEach(script=>vm.runInContext(script,context));
  return {Store:context.ZhezhiStore,Writer:context.ZhezhiWriter,context,storage,advance(ms){wall+=ms;clock+=ms;ticks.forEach(fn=>fn())}};
}
const work={id:'stable-work',title:'测试作品',description:'',category:'日常',createdAt:'2026-10-12T00:00:00Z',updatedAt:'2026-10-12T00:00:00Z',chapters:[{id:'stable-chapter',title:'第一章',content:'旧稿'}]};
const note={id:'note-1',title:'灵感',content:'人物对白',workId:work.id,pinned:false,createdAt:work.createdAt,updatedAt:work.updatedAt};
const checks=[];function check(name,fn){fn();checks.push(name);console.log('PASS '+name)}
check('v2 migration preserves IDs and previous storage, including denied writes',()=>{
  const empty=JSON.parse(JSON.stringify(environment().Store.get()));empty.version=2;empty.works=[work];delete empty.authorSettings;delete empty.inspirationNotes;delete empty.writingRecords;
  const source=JSON.stringify(empty);
  for(const blocked of [false,true]){const env=environment({initial:{'zhezhi-local-v2':source},blocked});assert.equal(env.Store.get().version,3);assert.equal(env.Store.get().works[0].chapters[0].id,'stable-chapter');assert.equal(env.Store.get().authorSettings.dailyWordGoal,2000);assert.equal(env.storage.get('zhezhi-local-v2'),source);assert.equal(env.Store.isDurable(),!blocked);assert.equal(env.Store.parseBackup(JSON.stringify({format:'zhezhi-literature-backup',version:1,data:empty})).version,3)}
});
check('timer checkpoints, idle cutoff, manual resume and background pause',()=>{
  const {Store,Writer,context,advance}=environment();Writer.bind(work);assert.equal(Writer.state().running,false);Writer.activity();advance(15000);assert.equal(Store.get().writingRecords[0].durationMs,15000);advance(115000);assert.equal(Writer.summary().totalMs,120000);assert.equal(Writer.state().running,false);
  Writer.activity();advance(3000);Writer.togglePause();const baseline=Writer.summary().totalMs;Writer.activity();advance(10000);assert.equal(Writer.summary().totalMs,baseline);Writer.togglePause();assert.equal(Writer.state().running,false);Writer.activity();advance(2000);Writer.pause();context.document.hidden=true;Writer.activity();advance(5000);assert.equal(Writer.summary().totalMs,baseline+2000);
});
check('cross-midnight duration splits into local calendar days',()=>{
  const {Store,Writer,advance}=environment({start:new Date(2026,9,12,23,59,50).getTime()});Writer.bind(work);Writer.activity();advance(20000);Writer.pause();const rows=Store.get().writingRecords;assert.equal(rows.length,2);assert.equal(rows.find(r=>r.date==='2026-10-12').durationMs,10000);assert.equal(rows.find(r=>r.date==='2026-10-13').durationMs,10000);assert.equal(Writer.summary().todayMs,10000);assert.equal(Writer.summary().weekMs,20000);
});
check('Monday week boundary and negative net words are preserved',()=>{
  const {Store,Writer}=environment();Store.change(d=>{d.writingRecords=[{id:'sunday',workId:work.id,workTitle:work.title,date:'2026-10-11',durationMs:9000,netWords:30,updatedAt:work.updatedAt}]});Writer.addWords(work,{'2026-10-12':-7});assert.equal(Writer.summary().todayWords,-7);assert.equal(Writer.summary().weekMs,0);assert.equal(Writer.summary().totalMs,9000);
});
check('backup merge is idempotent and selects newer notes and records',()=>{
  const {Store,Writer,advance}=environment();Store.change(d=>{d.works=[work];d.inspirationNotes=[note]});Writer.bind(work);Writer.activity();advance(2000);Writer.addWords(work,{'2026-10-12':10});Writer.pause();const text=JSON.stringify(Store.backup()),before=JSON.stringify(Store.get());Store.merge(Store.parseBackup(text));Store.merge(Store.parseBackup(text));assert.equal(JSON.stringify(Store.get()),before);
  const incoming=Store.parseBackup(text);incoming.inspirationNotes[0].content='新版灵感';incoming.inspirationNotes[0].updatedAt='2026-10-13T00:00:00Z';Store.merge(incoming);assert.equal(Store.get().inspirationNotes[0].content,'新版灵感');assert.equal(Writer.summary().todayWords,10);
});
check('malformed author backups are rejected before mutation',()=>{
  const {Store}=environment();Store.change(d=>{d.works=[work];d.inspirationNotes=[note];d.writingRecords=[{id:'record-1',workId:work.id,workTitle:work.title,date:'2026-10-12',durationMs:10,netWords:2,updatedAt:work.updatedAt}]});
  const before=JSON.stringify(Store.get());for(const mutate of [d=>d.inspirationNotes.push({...note}),d=>d.inspirationNotes[0].id='__proto__',d=>d.writingRecords[0].date='2026-02-30',d=>d.writingRecords[0].durationMs=-1,d=>d.authorSettings.dailyWordGoal=-1]){const backup=Store.backup();mutate(backup.data);assert.throws(()=>Store.parseBackup(JSON.stringify(backup)));assert.equal(JSON.stringify(Store.get()),before)}
});
check('work cleanup preserves notes and records; category cleanup stays independent',()=>{
  const {Store,Writer}=environment();Store.change(d=>{d.works=[work];d.inspirationNotes=[note]});Writer.addWords(work,{'2026-10-12':5});Store.clear(['works']);assert.equal(Store.get().inspirationNotes.length,1);assert.equal(Store.get().writingRecords.length,1);Store.clear(['inspirationNotes']);assert.equal(Store.get().writingRecords.length,1);Store.clear(['writingRecords']);assert.equal(Store.get().writingRecords.length,0);
});
console.log(`${checks.length} author unit scenarios passed.`);
