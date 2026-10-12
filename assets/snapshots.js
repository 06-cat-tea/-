/* History has its own transactional store, independent of draft localStorage. */
(() => {
  'use strict';
  const Store=window.ZhezhiStore;
  let connection,queue=Promise.resolve();
  function open(){
    if(connection)return connection;
    connection=new Promise((resolve,reject)=>{
      if(!globalThis.indexedDB)return reject(Error('浏览器不支持历史快照，当前正文仍可保存和导出。'));
      let request;try{request=indexedDB.open('zhezhi-chapter-history',1)}catch{reject(Error('历史存储不可用，当前正文仍可保存和导出。'));return}
      const timeout=setTimeout(()=>reject(Error('历史存储暂时无法打开，请关闭其他旧版本页面后重试。')),6000);
      request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains('snapshots')){const store=db.createObjectStore('snapshots',{keyPath:'id'});store.createIndex('workId','workId');}};
      request.onsuccess=()=>{clearTimeout(timeout);const db=request.result;db.onversionchange=()=>{db.close();connection=null};resolve(db)};
      request.onerror=()=>{clearTimeout(timeout);reject(Error('无法打开历史存储，当前正文仍可保存和导出。'))};
    }).catch(error=>{connection=null;throw error});return connection;
  }
  async function list(workId){const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction('snapshots','readonly'),store=tx.objectStore('snapshots'),request=workId?store.index('workId').getAll(workId):store.getAll();request.onsuccess=()=>resolve(request.result.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id)));request.onerror=()=>reject(Error('无法读取历史快照。'));});}
  function validate(rows){
    if(!Array.isArray(rows)||rows.length>100000)throw Error('快照列表格式不正确');const seen=new Set(),id=value=>typeof value==='string'&&value.length<=160&&/^[\w:.-]+$/.test(value)&&!['__proto__','constructor','prototype'].includes(value);
    return rows.map(r=>{if(!r||!id(r.id)||seen.has(r.id)||!id(r.workId)||!id(r.chapterId)||!['manual','auto'].includes(r.kind)||typeof r.name!=='string'||r.name.length>80||typeof r.title!=='string'||r.title.length>80||typeof r.content!=='string'||r.content.length>200000||typeof r.createdAt!=='string'||!Number.isFinite(Date.parse(r.createdAt)))throw Error('章节快照格式不正确');seen.add(r.id);return {id:r.id,workId:r.workId,chapterId:r.chapterId,title:r.title,content:r.content,name:r.name,kind:r.kind,createdAt:r.createdAt};});
  }
  async function write(rows,removeIds=[]){const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction('snapshots','readwrite'),store=tx.objectStore('snapshots');for(const row of rows)store.put(row);for(const id of removeIds)store.delete(id);tx.oncomplete=()=>resolve(true);tx.onabort=tx.onerror=()=>reject(Error('历史快照未保存：存储空间不足或浏览器限制。当前正文不受影响。'));});}
  async function takeImpl(workId,chapter,kind='auto',name=''){
    const existing=(await list(workId)).filter(r=>r.chapterId===chapter.id),latest=existing[0];
    if(kind==='auto'&&latest?.title===chapter.title&&latest?.content===chapter.content)return null;
    const stamp=existing.reduce((time,r)=>Math.max(time,Date.parse(r.createdAt)+1),Date.now());
    const row={id:Store.uuid(),workId,chapterId:chapter.id,title:chapter.title,content:chapter.content,kind,name:name.slice(0,80),createdAt:new Date(stamp).toISOString()};
    const autos=[row,...existing].filter(r=>r.kind==='auto');await write([row],autos.slice(20).map(r=>r.id));return row;
  }
  async function merge(rows){const validated=validate(rows),existing=new Set((await list()).map(r=>r.id));return write(validated.filter(r=>!existing.has(r.id)));}
  async function clear(workId){const rows=await list(workId);return write([],rows.map(r=>r.id));}
  const serialize=operation=>(...args)=>{const next=queue.catch(()=>{}).then(()=>operation(...args));queue=next;return next;};
  window.ZhezhiSnapshots={list,take:serialize(takeImpl),validate,merge:serialize(merge),clear:serialize(clear),remove:serialize(id=>write([],[id]))};
})();
