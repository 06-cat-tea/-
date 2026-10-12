/* Work ownership and shared commits use the same origin's browser locks. */
(() => {
 'use strict';
 const supported=Boolean(navigator.locks?.request),held=new Map(),listeners=new Set(),tab=globalThis.crypto?.randomUUID?.()||String(Math.random());
 const channel=typeof BroadcastChannel==='function'?new BroadcastChannel('zhezhi-author-v5'):null;
 let handover;
 const send=message=>channel?.postMessage({...message,tab});
 const emit=()=>{for(const listener of listeners)listener()};
 async function acquire(id){
  if(!supported)return true;if(held.has(id))return true;
  return new Promise((resolve,reject)=>{navigator.locks.request('zhezhi-work:'+id,{ifAvailable:true},lock=>{
   if(!lock){resolve(false);return}let release;const done=new Promise(r=>release=r);held.set(id,release);resolve(true);emit();return done;
  }).catch(reject)});
 }
 function release(id){const finish=held.get(id);if(finish){held.delete(id);finish();send({type:'released',work:id});emit()}}
 async function withWorks(ids,operation){
  const acquired=[];try{for(const id of [...new Set(ids)].sort()){if(held.has(id))continue;if(!await acquire(id))throw Error('另一标签页正在编辑这部作品，请先申请接管或关闭原页。');if(supported)acquired.push(id)}return await operation()}
  finally{for(const id of acquired)release(id)}
 }
 async function takeover(id){if(await acquire(id))return true;send({type:'takeover',work:id});const end=Date.now()+5000;while(Date.now()<end){await new Promise(r=>setTimeout(r,100));if(await acquire(id))return true}return false}
 channel?.addEventListener('message',async event=>{const m=event.data;if(!m||m.tab===tab)return;if(m.type==='takeover'&&held.has(m.work)&&handover){try{if(await handover(m.work)){release(m.work);send({type:'handed-over',work:m.work})}}catch{send({type:'handover-failed',work:m.work})}}emit()});
 window.ZhezhiCoordination={supported,acquire,release,withWorks,takeover,has:id=>!supported||held.has(id),setHandover:fn=>handover=fn,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},announce:()=>send({type:'changed'}),commit:fn=>supported?navigator.locks.request('zhezhi-data-v5',fn):Promise.resolve().then(fn)};
})();
