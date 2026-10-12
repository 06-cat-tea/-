/* Complete and selected-history backups share the same validated, importable envelope. */
(() => {
  'use strict';
  window.ZhezhiBackup={create({dialog,flash,saved,onMerged}){
    const Store=window.ZhezhiStore,History=window.ZhezhiSnapshots,Writer=window.ZhezhiWriter,{esc,bytes}=window.ZhezhiUtils;
    const serialize=(base,rows,scope)=>JSON.stringify({...base,chapterSnapshots:rows,historyScope:scope},null,2);
    function download(text,selected){if(bytes(text)>Store.MAX_BACKUP_BYTES)throw Error('所选数据超过 50 MB，请减少选中的历史快照。');Writer.download(new Blob([text],{type:'application/json;charset=utf-8'}),`折纸文学${selected?'分批历史':'完整'}备份-${Writer.dayKey()}.json`);flash('备份已导出，请妥善保存。');}
    async function exportBackup(){
      const base=Store.backup();let rows;
      try{rows=await History.list()}catch(error){const choice=await dialog('无法读取历史快照',`<p>${esc(error.message)}</p><p>可以导出当前稿件与创作设定。此文件不包含历史快照。</p>`,[{value:'cancel',label:'取消'},{value:'current',label:'导出当前数据',primary:true}]);if(choice==='current')download(serialize(base,[],'none'),true);return;}
      const text=serialize(base,rows,'all');if(bytes(text)<=Store.MAX_BACKUP_BYTES){download(text,false);return;}
      return exportSelected(rows,base);
    }
    async function exportSelected(rows,base=Store.backup()){
      if(bytes(serialize(base,[],'selected'))>Store.MAX_BACKUP_BYTES)throw Error('当前稿件超过 50 MB，请先使用 TXT 导出作品正文。');
      const names=new Map(base.data.works.map(w=>[w.id,w.title]));
      const result=await dialog('分批导出历史快照',`<p class="help-text">完整备份超过 50 MB。每批包含全部当前数据及勾选的历史，单批上限 50 MB；各批可分别导入，重复导入会去重。</p><div class="snapshot-selection">${rows.map(r=>`<label class="check-row"><input type="checkbox" name="backupSnapshot" value="${esc(r.id)}"> <span>${esc(names.get(r.workId)||'已删除作品')} · ${esc(r.name||r.title||'未命名章节')}<small>${esc(new Date(r.createdAt).toLocaleString('zh-CN'))} · ${Math.ceil(bytes(r.content)/1024)} KB</small></span></label>`).join('')}</div>`,[{value:'cancel',label:'关闭'},{value:'export-selected',label:'导出选中历史',primary:true}]);
      if(result!=='export-selected')return;const ids=new Set([...document.querySelectorAll('[name="backupSnapshot"]:checked')].map(el=>el.value));
      try{download(serialize(base,rows.filter(r=>ids.has(r.id)),'selected'),true)}catch(error){flash(error.message);return exportSelected(rows,base)}
    }
    async function importBackup(file){
      if(!file)return;
      try{
        if(file.size>Store.MAX_BACKUP_BYTES)throw Error('备份超过 50 MB，请选择分批导出的文件');
        const incoming=Store.parseBackup(await file.text()),snapshots=History.validate(incoming.chapterSnapshots);
        if(!['none','all','selected'].includes(incoming.historyScope))throw Error('备份历史范围格式不正确');
        const result=await dialog('确认合并备份',`<p class="notice-copy">此文件包含 ${incoming.library.length} 部收藏、${incoming.history.length} 条阅读记录、${incoming.works.length} 部作品（${incoming.works.reduce((n,w)=>n+w.chapters.length,0)} 章）、${incoming.inspirationNotes.length} 条灵感便条、${incoming.writingRecords.length} 条写作记录、${incoming.workspaces.length} 份创作设定及 ${snapshots.length} 个快照。</p><p class="notice-copy">历史范围：${{none:'不含历史',all:'完整历史',selected:'选中的部分历史'}[incoming.historyScope]}。相同 ID 不重复累计，设定和作品保留较新版本。文件仅在本机处理。</p>`,[{value:'cancel',label:'取消'},{value:'merge',label:'确认合并',primary:true}]);
        if(result!=='merge')return;
        document.body.dataset.backupBusy='true';document.querySelector('body>.shell').inert=true;const input=document.querySelector('#backupFile');if(input)input.disabled=true;const status=document.querySelector('#backupStatus');if(status)status.textContent='正在合并历史快照与当前数据……';
        if(snapshots.length)await History.merge(snapshots);Store.merge(incoming);onMerged();saved('备份已合并');
      }catch(error){await dialog('无法导入备份',`<p class="notice-copy">${esc(error.message)}</p>`)}
      finally{delete document.body.dataset.backupBusy;document.querySelector('body>.shell').inert=Boolean(document.querySelector('#utilityLayer.open,#readerLayer.open,#bookDetailLayer.open,#showcaseNotice.open'));const input=document.querySelector('#backupFile');if(input){input.value='';input.disabled=false}const status=document.querySelector('#backupStatus');if(status)status.textContent='';}
    }
    return {export:exportBackup,import:importBackup,exportSelected:async()=>exportSelected(await History.list())};
  }};
})();
