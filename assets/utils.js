/* Small shared helpers; importing this file does not access browser storage or the DOM. */
(() => {
  'use strict';
  const count=text=>String(text||'').replace(/\s/g,'').length;
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const mergeLatest=(current,incoming)=>{const rows=new Map(current.map(x=>[x.id,x]));for(const row of incoming)if(!rows.has(row.id)||row.updatedAt>rows.get(row.id).updatedAt)rows.set(row.id,row);return [...rows.values()];};
  const saveText=(durable,label='已保存')=>durable?`${label} · ${new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}`:'当前页面暂存，请导出备份';
  window.ZhezhiUtils={count,esc,mergeLatest,saveText,wordCount:work=>work.chapters.reduce((sum,c)=>sum+count(c.content),0),now:()=>new Date().toISOString(),bytes:text=>new TextEncoder().encode(text).length};
})();
