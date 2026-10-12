/* Complete and selected-history backups share the same validated, importable envelope. */
(() => {
  'use strict';
  window.ZhezhiBackup={create({dialog,flash,saved,onMerged,getDraft}){
    const Store=window.ZhezhiStore,History=window.ZhezhiSnapshots,Writer=window.ZhezhiWriter,{esc,bytes}=window.ZhezhiUtils;
    const serialize=(base,rows,scope)=>JSON.stringify({...base,chapterSnapshots:rows,historyScope:scope},null,2);
    async function download(text,selected,captured,base){if(bytes(text)>Store.MAX_BACKUP_BYTES)throw Error('所选数据超过 50 MB，请减少选中的历史快照。');Writer.download(new Blob([text],{type:'application/json;charset=utf-8'}),`折纸文学${base.backupScope==='work'?'-作品-'+String(base.workId).replace(/[^\w.-]/g,'_'):''}${selected?'分批历史':'完整'}备份-${Writer.dayKey()}.json`);await window.ZhezhiBackupStatus.exported(captured,base.backupScope||'all',base.historyScope,base.workId);flash('已发起备份下载，请检查并妥善保存文件。');}
    async function exportBackup(workId=null){
      await Store.settled();const captured=await window.ZhezhiBackupStatus.capture(),base=Store.backup(),draft=getDraft?.(),unsafe=new Set();if(draft){const i=base.data.works.findIndex(w=>w.id===draft.id);if(i>=0)base.data.works[i]=draft;else base.data.works.push(draft);if(JSON.stringify(draft)!==JSON.stringify(Store.get().works.find(w=>w.id===draft.id))){delete captured[draft.id];unsafe.add(draft.id)}}
      base.backupScope=workId?'work':'all';base.workId=workId;if(workId){base.data.works=base.data.works.filter(w=>w.id===workId);if(!base.data.works.length)throw Error('作品不存在');base.data.workspaces=base.data.workspaces.filter(w=>w.id===workId);base.data.inspirationNotes=base.data.inspirationNotes.filter(n=>n.workId===workId);base.data.writingRecords=base.data.writingRecords.filter(r=>r.workId===workId);base.data.library=[];base.data.history=[];base.data.ratings={};base.data.comments={}}
      for(const id of [...base.data.works.map(w=>w.id),...base.data.inspirationNotes.map(n=>n.workId||n.id)])if(!unsafe.has(id))captured[id]||={generation:0};
      let rows;
      try{rows=await History.list(workId)}catch(error){const choice=await dialog('无法读取历史快照',`<p>${esc(error.message)}</p><p>可以导出当前稿件与创作设定。此文件不包含历史快照。</p>`,[{value:'cancel',label:'取消'},{value:'current',label:'导出当前数据',primary:true}]);if(choice==='current')await download(serialize(base,[],'none'),true,captured,{...base,historyScope:'none'});return;}
      const text=serialize(base,rows,'all');if(bytes(text)<=Store.MAX_BACKUP_BYTES){await download(text,false,captured,{...base,historyScope:'all'});return;}
      return exportSelected(rows,base,captured);
    }
    async function exportSelected(rows,base=Store.backup(),captured){captured||=await window.ZhezhiBackupStatus.capture();
      if(bytes(serialize(base,[],'selected'))>Store.MAX_BACKUP_BYTES)throw Error('当前稿件超过 50 MB，请先使用 TXT 导出作品正文。');
      const names=new Map(base.data.works.map(w=>[w.id,w.title]));
      const result=await dialog('分批导出历史快照',`<p class="help-text">完整备份超过 50 MB。每批包含全部当前数据及勾选的历史，单批上限 50 MB；各批可分别导入，重复导入会去重。</p><div class="snapshot-selection">${rows.map(r=>`<label class="check-row"><input type="checkbox" name="backupSnapshot" value="${esc(r.id)}"> <span>${esc(names.get(r.workId)||'已删除作品')} · ${esc(r.name||r.title||'未命名章节')}<small>${esc(new Date(r.createdAt).toLocaleString('zh-CN'))} · ${Math.ceil(bytes(r.content)/1024)} KB</small></span></label>`).join('')}</div>`,[{value:'cancel',label:'关闭'},{value:'export-selected',label:'导出选中历史',primary:true}]);
      if(result!=='export-selected')return;const ids=new Set([...document.querySelectorAll('[name="backupSnapshot"]:checked')].map(el=>el.value));
      try{await download(serialize(base,rows.filter(r=>ids.has(r.id)),'selected'),true,captured,{...base,historyScope:'selected'})}catch(error){flash(error.message);return exportSelected(rows,base,captured)}
    }
    async function importBackup(file){
      if(!file)return;
      try{
        if(file.size>Store.MAX_BACKUP_BYTES)throw Error('备份超过 50 MB，请选择分批导出的文件');
        const incoming=Store.parseBackup(await file.text()),snapshots=History.validate(incoming.chapterSnapshots);
        if(!['none','all','selected'].includes(incoming.historyScope))throw Error('备份历史范围格式不正确');
        const result=await dialog('确认合并备份',`<p class="notice-copy">此文件包含 ${incoming.library.length} 部收藏、${incoming.history.length} 条阅读记录、${incoming.works.length} 部作品（${incoming.works.reduce((n,w)=>n+w.chapters.length,0)} 章）、${incoming.inspirationNotes.length} 条灵感便条、${incoming.writingRecords.length} 条写作记录、${incoming.workspaces.length} 份创作设定及 ${snapshots.length} 个快照。</p><p class="notice-copy">历史范围：${{none:'不含历史',all:'完整历史',selected:'选中的部分历史'}[incoming.historyScope]}。相同 ID 不重复累计，设定和作品保留较新版本。自动快照每章保留最新 20 个，手动版本不自动清理。文件仅在本机处理。</p>`,[{value:'cancel',label:'取消'},{value:'merge',label:'确认合并',primary:true}]);
        if(result!=='merge')return;
        document.body.dataset.backupBusy='true';document.querySelector('body>.shell').inert=true;const input=document.querySelector('#backupFile');if(input)input.disabled=true;const status=document.querySelector('#backupStatus');if(status)status.textContent='正在合并历史快照与当前数据……';
        if(incoming.backupScope==='work'&&snapshots.some(r=>r.workId!==incoming.workId))throw Error('作品备份含其他作品的历史');await window.ZhezhiCoordination.withWorks([...incoming.works.map(w=>w.id),...incoming.workspaces.map(w=>w.id),...snapshots.map(r=>r.workId)],async()=>{if(snapshots.length)await History.merge(snapshots);await Store.merge(incoming)});await onMerged();saved('备份已合并');
      }catch(error){await dialog('无法导入备份',`<p class="notice-copy">${esc(error.message)}</p>`)}
      finally{delete document.body.dataset.backupBusy;document.querySelector('body>.shell').inert=Boolean(document.querySelector('#utilityLayer.open,#readerLayer.open,#bookDetailLayer.open,#showcaseNotice.open'));const input=document.querySelector('#backupFile');if(input){input.value='';input.disabled=false}const status=document.querySelector('#backupStatus');if(status)status.textContent='';}
    }
    return {export:exportBackup,import:importBackup,exportSelected:async()=>exportSelected(await History.list())};
  }};
})();
