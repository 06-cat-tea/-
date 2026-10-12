/* Author state and UI live together; navigation and overlays are supplied by the app. */
(() => {
  'use strict';
  window.ZhezhiAuthor={create(hooks){
  const {$,$$,esc,now,count,wordCount,flash,saved,offerUndo,dialog,finishDialog,topLayer,go,observeReveals,getRoute,setRoute,routeURL,exportBackup}=hooks;
  const Store=window.ZhezhiStore,Writer=window.ZhezhiWriter;
  const History=window.ZhezhiSnapshots,Utils=window.ZhezhiUtils;
  const authorUi={search:'',sort:'latest',noteSearch:'',noteWork:'',recordWork:'',chapterSearch:''};
  let editor=null,noteEditor=null,saveTimer,noteTimer;
  const signature=chapter=>JSON.stringify([chapter.title,chapter.content]);
  function peekChapter(){if(!editor)return null;const chapter=editor.work.chapters.find(c=>c.id===editor.chapterId),form=$('#workForm');return {...chapter,title:form?.elements.chapterTitle.value??chapter.title,content:form?.elements.content.value??chapter.content};}
  const Studio=window.ZhezhiStudio.create({flash,dialog,offerUndo,getContext:()=>editor,saveDraft:saveEditor,peekChapter,restoreSnapshot,goChapter:async id=>{saveEditor();await go({kind:'author',work:editor.work.id,chapter:id},{replace:true,skipGuard:true})}});
  async function guardEditor() {
    Studio.flush();
    if(noteEditor)finishDialog('ok');
    if(!editor?.dirty)return true;
    clearTimeout(saveTimer);
    const choice=await dialog('还有文字尚未保存','<p class="notice-copy">离开创作页前，可以保存当前内容，或放弃本次尚未保存的修改。</p>',[{value:'cancel',label:'继续编辑'},{value:'discard',label:'放弃修改'},{value:'save',label:'保存并离开',primary:true}]);
    if(choice==='cancel'){scheduleSave();return false}
    if(choice==='save'){
      saveEditor();
      if(!Store.isDurable()){
        const result=await dialog('内容暂存于当前页面','<p class="notice-copy">浏览器无法持久保存，请先导出备份。继续离开仍会保留当前页面的临时数据。</p>',[{value:'cancel',label:'返回编辑'},{value:'export',label:'导出并离开',primary:true}]);
        if(result!=='export')return false;await exportBackup();
      }
    }
    if(choice==='discard')editor.wordDeltas={};editor.dirty=false;return true;
  }

  // The author workspace edits a buffer; auto-save replaces only that work.
  function renderAuthor(target) {
    Studio.dispose();clearTimeout(saveTimer);
    const tab=target.work?'works':target.tab||'works';
    $$('#authorTabs button').forEach(button=>{const selected=button.dataset.tab===tab;button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',String(selected))});
    const work=Store.get().works.find(w=>w.id===target.work);
    document.body.classList.toggle('author-editing',Boolean(work));
    if(target.work&&!work){flash('作品不存在或已删除。');history.replaceState({...history.state},'',routeURL({kind:'author'}));setRoute({kind:'author'})}
    if(!work){
      editor=null;
      if(tab==='notes')renderNotesPage();
      else if(tab==='records')renderRecordsPage();
      else {$('#authorContent').innerHTML=`<div class="author-tools"><label>查找作品<input id="authorWorkSearch" type="search" placeholder="搜索作品名称" value="${esc(authorUi.search)}"></label><label>排序<select id="authorWorkSort"><option value="latest">最近修改</option><option value="title">作品名称</option><option value="words">字数最多</option></select></label></div><div class="work-grid" id="authorWorkList"></div>`;$('#authorWorkSort').value=authorUi.sort;renderWorkList()}
      updateAuthorStats();return;
    }
    const chapter=work.chapters.find(c=>c.id===target.chapter)||work.chapters[0];
    editor={work:Store.clone(work),chapterId:chapter.id,dirty:false,wordDeltas:{},composing:false,snapshotBaseline:signature(chapter)};authorUi.chapterSearch='';Writer.bind(work);
    const expanded=matchMedia('(min-width:621px)').matches?'open':'';
    $('#authorContent').innerHTML=`<div class="editor-toolbar"><button class="outline-button" data-action="author">← 作品列表</button><span id="saveStatus" role="status">${Store.isDurable()?'已保存到本机':'当前页面暂存，请导出备份'}</span><div class="editor-actions"><button class="outline-button" data-action="writer-focus" aria-pressed="false">专注模式</button><button class="outline-button" data-action="export-txt" data-id="${esc(work.id)}">导出全书</button><button class="outline-button" data-action="export-chapter-txt">导出本章</button><button class="outline-button" data-action="export">JSON 备份</button><button class="outline-button" data-action="preview">本地阅读预览</button><button class="solid-button" data-action="save-work">保存</button></div></div><div class="writer-session"><span id="writerTimer"></span><button class="quiet-button" data-action="writer-pause" aria-pressed="false">暂停计时</button><span id="writerGoal"></span><progress id="writerGoalProgress" max="100" value="0" aria-label="今日写作目标进度"></progress><button class="quiet-button" data-action="writer-goal">设置目标</button></div><div class="editor-layout"><details class="chapter-sidebar" ${expanded}><summary>章节 · <span id="authorChapterCount">${work.chapters.length}</span></summary><label class="chapter-search-label">查找章节<input id="authorChapterSearch" type="search" placeholder="章节标题或序号"></label><div id="authorChapters"></div><button class="outline-button" data-action="add-chapter">＋ 添加章节</button></details><form id="workForm" class="editor-form"><details class="work-information" ${expanded}><summary>作品信息</summary><div class="work-fields"><label class="field"><span>作品名称</span><input name="title" maxlength="40" required value="${esc(work.title)}"></label><label class="field"><span>分类</span><select name="category">${[...new Set(['校园','奇幻','日常','恋爱','成长','轻松','悬疑','科幻','变身仙侠',work.category])].map(c=>`<option ${c===work.category?'selected':''}>${esc(c)}</option>`).join('')}</select></label></div><label class="field"><span>作品简介</span><input name="description" maxlength="100" value="${esc(work.description)}"></label></details><label class="field chapter-title-field"><span>本章标题</span><input name="chapterTitle" maxlength="80" value="${esc(chapter.title)}"></label><label class="field body-field"><span>本章正文</span><textarea name="content" maxlength="200000" placeholder="把第一段写在这里……">${esc(chapter.content)}</textarea></label><div class="editor-count"><span id="writerCount">本章 ${count(chapter.content)} 字 · 全书 ${wordCount(work)} 字</span><span>停止输入 1 秒后自动保存 · Ctrl/Cmd + S</span></div></form></div><details class="writer-note-panel" id="writerNotePanel"><summary>作品灵感便条 <span id="workNoteCount"></span></summary><div class="note-panel-head"><p>先收好这个念头，再慢慢写进故事。</p><button class="outline-button" data-action="new-note" data-work="${esc(work.id)}">＋ 记下灵感</button></div><div class="note-grid" id="workNotes"></div></details>`;
    $('#authorContent').insertAdjacentHTML('beforeend','<section id="storyStudio" aria-label="故事创作工具"></section>');
    renderAuthorChapters();renderWorkNotes();updateAuthorStats();Studio.mount();
  }
  function renderWorkList(){
    const works=Store.get().works.filter(w=>(w.title||'未命名作品').toLocaleLowerCase().includes(authorUi.search.trim().toLocaleLowerCase())).slice();
    works.sort(authorUi.sort==='title'?(a,b)=>a.title.localeCompare(b.title,'zh-CN'):authorUi.sort==='words'?(a,b)=>wordCount(b)-wordCount(a):(a,b)=>b.updatedAt.localeCompare(a.updatedAt));
    $('#authorWorkList').innerHTML=works.length?works.map(w=>`<article class="work-card reveal"><span class="section-kicker">${esc(w.category)} · 私有草稿</span><h3>${esc(w.title||'未命名作品')}</h3><p>${esc(w.description||'等待你写下简介。')}</p><small>${w.chapters.length} 章 · ${wordCount(w).toLocaleString('zh-CN')} 字 · ${esc(new Date(w.updatedAt).toLocaleDateString('zh-CN'))}</small><div class="work-actions"><button class="solid-button" data-action="edit-work" data-id="${esc(w.id)}">继续创作</button><button class="outline-button" data-action="export-txt" data-id="${esc(w.id)}">导出全书 TXT</button><button class="quiet-button" data-action="delete-work" data-id="${esc(w.id)}">删除作品</button></div></article>`).join(''):`<div class="empty author-empty"><span>✎</span><h3>${Store.get().works.length?'没有找到对应作品':'每个故事都从一张白纸开始'}</h3><p>${Store.get().works.length?'试试另一个作品名称。':'新建作品，写下属于你的第一章。'}</p>${Store.get().works.length?'':'<button class="solid-button" data-action="new-work">写下新故事</button>'}</div>`;observeReveals();
  }
  function collectEditor(){
    if(!editor||!$('#workForm'))return;
    const form=$('#workForm');editor.work.title=form.elements.title.value;editor.work.description=form.elements.description.value;editor.work.category=form.elements.category.value;
    const chapter=editor.work.chapters.find(c=>c.id===editor.chapterId),content=form.elements.content.value,delta=count(content)-count(chapter.content);
    if(delta){const day=Writer.dayKey();editor.wordDeltas[day]=(editor.wordDeltas[day]||0)+delta}
    chapter.title=form.elements.chapterTitle.value;chapter.content=content;
    $('#writerCount').textContent=`本章 ${count(chapter.content)} 字 · 全书 ${wordCount(editor.work)} 字`;
  }
  function scheduleSave(){clearTimeout(saveTimer);if(editor?.dirty&&!editor.composing)saveTimer=setTimeout(saveEditor,1000)}
  function saveEditor(){
    clearTimeout(saveTimer);if(!editor)return true;collectEditor();
    const current=Store.get().works.find(w=>w.id===editor.work.id);
    if(!current||JSON.stringify({...editor.work,updatedAt:current.updatedAt})!==JSON.stringify(current))editor.work.title=editor.work.title.trim()||'未命名作品';
    if(current&&JSON.stringify({...editor.work,updatedAt:current.updatedAt})===JSON.stringify(current)){
      const deltas=editor.wordDeltas;editor.wordDeltas={};editor.dirty=false;Writer.addWords(editor.work,deltas);
      if($('#saveStatus'))$('#saveStatus').textContent=Utils.saveText(Store.isDurable());return Store.isDurable();
    }
    editor.work.updatedAt=now();const work=Store.clone(editor.work);
    const persisted=Store.change(d=>{const i=d.works.findIndex(w=>w.id===work.id);if(i>=0)d.works[i]=work;else d.works.unshift(work)});
    const deltas=editor.wordDeltas;editor.wordDeltas={};Writer.addWords(work,deltas);
    editor.dirty=false;if($('#saveStatus'))$('#saveStatus').textContent=Utils.saveText(persisted);
    renderAuthorChapters();updateAuthorStats();return persisted;
  }
  function renderAuthorChapters(){
    if(!editor)return;$('#authorChapterCount').textContent=editor.work.chapters.length;
    $('#authorChapters').innerHTML=editor.work.chapters.map((c,i)=>({c,i})).filter(({c,i})=>`${i+1} ${c.title}`.toLowerCase().includes(authorUi.chapterSearch.trim().toLowerCase())).map(({c,i})=>`<div class="author-chapter ${c.id===editor.chapterId?'selected':''}"><button data-action="edit-chapter" data-id="${esc(c.id)}" ${c.id===editor.chapterId?'aria-current="true"':''}><span>${i+1}. ${esc(c.title||'未命名章节')}</span><small>${count(c.content)} 字</small></button><div><button data-action="chapter-up" data-id="${esc(c.id)}" aria-label="上移${esc(c.title)}" ${i===0?'disabled':''}>↑</button><button data-action="chapter-down" data-id="${esc(c.id)}" aria-label="下移${esc(c.title)}" ${i===editor.work.chapters.length-1?'disabled':''}>↓</button><button data-action="delete-chapter" data-id="${esc(c.id)}" aria-label="删除${esc(c.title)}" ${editor.work.chapters.length===1?'disabled':''}>×</button></div></div>`).join('')||'<p class="help-text">没有找到对应章节。</p>';
  }
  function newWork(){
    const id=Store.uuid(),chapter=Store.uuid();Store.change(d=>{d.works.unshift({id,title:'未命名作品',description:'',category:'变身仙侠',createdAt:now(),updatedAt:now(),chapters:[{id:chapter,title:'第一章',content:''}]})});
    go({kind:'author',work:id,chapter},{skipGuard:true});
  }
  async function mutateChapter(action,id){
    if(!editor)return;saveEditor();const workId=editor.work.id,work=Store.clone(editor.work),i=work.chapters.findIndex(c=>c.id===id);let selected=editor.chapterId;
    if(action==='add-chapter'){const c={id:Store.uuid(),title:`第 ${work.chapters.length+1} 章`,content:''};work.chapters.push(c);selected=c.id}
    if(action==='chapter-up'&&i>0)[work.chapters[i-1],work.chapters[i]]=[work.chapters[i],work.chapters[i-1]];
    if(action==='chapter-down'&&i>=0&&i<work.chapters.length-1)[work.chapters[i],work.chapters[i+1]]=[work.chapters[i+1],work.chapters[i]];
    if(action==='delete-chapter'&&i>=0&&work.chapters.length>1){
      const removed=work.chapters.splice(i,1)[0];if(removed.id===selected)selected=work.chapters[Math.min(i,work.chapters.length-1)].id;
      offerUndo('章节已删除',()=>{if(editor?.dirty)saveEditor();Store.change(d=>{const w=d.works.find(w=>w.id===workId);if(w&&!w.chapters.some(c=>c.id===removed.id)){w.chapters.splice(Math.min(i,w.chapters.length),0,removed);w.updatedAt=now()}});refreshCurrentAuthor()});
    }
    work.updatedAt=now();Store.change(d=>{const pos=d.works.findIndex(w=>w.id===workId);if(pos>=0)d.works[pos]=work});
    go({kind:'author',work:workId,chapter:selected},{replace:true,skipGuard:true});
  }
  function refreshCurrentAuthor(){if(getRoute().kind==='author')renderAuthor(getRoute())}

  function updateAuthorStats(){
    if(getRoute()?.kind!=='author')return;
    const stats=Writer.summary(),pending=editor?.wordDeltas[Writer.dayKey()]||0,words=stats.todayWords+pending,goal=Store.get().authorSettings.dailyWordGoal;
    const progress=goal?Math.max(0,Math.min(100,words/goal*100)):0;
    $('#authorTodayTime').textContent=Writer.duration(stats.todayMs);$('#authorTodayWords').textContent=`${words.toLocaleString('zh-CN')} 字`;
    $('#authorGoalText').textContent=goal?`${Math.max(0,words).toLocaleString('zh-CN')} / ${goal.toLocaleString('zh-CN')} 字`:'目标已关闭';$('#authorGoalProgress').value=progress;
    if($('#writerTimer')){
      const state=Writer.state();$('#writerTimer').textContent=`${state.manualPaused?'手动暂停':state.running?'正在写作':'等待正文编辑'} · 今日 ${Writer.duration(stats.todayMs)}`;
      const button=$('[data-action="writer-pause"]');button.textContent=state.manualPaused?'恢复计时':'暂停计时';button.setAttribute('aria-pressed',String(state.manualPaused));
      $('#writerGoal').textContent=goal?`今日净增 ${words} / ${goal} 字`:`今日净增 ${words} 字 · 目标已关闭`;$('#writerGoalProgress').value=progress;$('#writerGoalProgress').hidden=!goal;
    }
  }
  function setWriterFocus(enabled){
    Studio.setFocus(enabled);
    document.body.classList.toggle('writer-focus',Boolean(enabled));const button=$('[data-action="writer-focus"]');
    if(button){button.textContent=enabled?'退出专注':'专注模式';button.setAttribute('aria-pressed',String(Boolean(enabled)))}
  }
  async function editWriterGoal(){
    Writer.pause();const result=await dialog('每日写作目标',`<form id="writerGoalForm"><label class="field"><span>每日目标字数（0 表示关闭）</span><input id="dailyWordGoal" type="number" min="0" max="1000000" step="1" required value="${Store.get().authorSettings.dailyWordGoal}"></label><p class="help-text">统计所有作品的正文净增字数，删除正文会抵扣，导入备份不计为新的创作。</p></form>`,[{value:'cancel',label:'取消'},{value:'save',label:'保存目标',primary:true}]);
    if(result!=='save')return;const value=Number($('#dailyWordGoal').value);
    if(!$('#dailyWordGoal').value||!Number.isInteger(value)||value<0||value>1000000){flash('请输入 0 到 1000000 之间的整数。');return}
    Store.change(d=>{d.authorSettings.dailyWordGoal=value});updateAuthorStats();saved('每日目标已保存');
  }
  function workOptions(selected='',all=false){
    const names=new Map(Store.get().works.map(w=>[w.id,w.title||'未命名作品']));
    Store.get().writingRecords.forEach(r=>{if(!names.has(r.workId))names.set(r.workId,`${r.workTitle||'原作品'}（已删除）`)});
    Store.get().inspirationNotes.forEach(n=>{if(n.workId&&!names.has(n.workId))names.set(n.workId,'原作品已删除')});
    return `<option value="">${all?'所有作品':'独立便条'}</option>`+[...names].map(([id,title])=>`<option value="${esc(id)}" ${id===selected?'selected':''}>${esc(title)}</option>`).join('');
  }
  function noteMarkup(note){
    const work=Store.get().works.find(w=>w.id===note.workId),label=note.workId?(work?.title||'原作品已删除'):'独立灵感';
    return `<article class="note-card"><div class="note-card-top"><span>${note.pinned?'◆ 已置顶 · ':''}${esc(label)}</span><small>${esc(new Date(note.updatedAt).toLocaleDateString('zh-CN'))}</small></div><h3>${esc(note.title||note.content.slice(0,35)||'未命名便条')}</h3><p>${esc(note.content)}</p><div class="work-actions"><button class="outline-button" data-action="edit-note" data-id="${esc(note.id)}">编辑便条</button><button class="quiet-button" data-action="pin-note" data-id="${esc(note.id)}" aria-pressed="${note.pinned}">${note.pinned?'取消置顶':'置顶'}</button><button class="quiet-button" data-action="delete-note" data-id="${esc(note.id)}">删除</button></div></article>`;
  }
  function sortedNotes(notes){return notes.slice().sort((a,b)=>Number(b.pinned)-Number(a.pinned)||b.updatedAt.localeCompare(a.updatedAt));}
  function renderNotesPage(){
    $('#authorContent').innerHTML=`<div class="author-tools"><label>搜索灵感<input id="noteSearch" type="search" placeholder="标题或便条内容" value="${esc(authorUi.noteSearch)}"></label><label>关联作品<select id="noteWorkFilter">${workOptions(authorUi.noteWork,true)}<option value="unlinked">独立灵感</option></select></label><button class="solid-button" data-action="new-note">＋ 记下灵感</button></div><div class="note-grid" id="noteList"></div>`;$('#noteWorkFilter').value=authorUi.noteWork;renderNoteList();
  }
  function renderNoteList(){
    if(!$('#noteList'))return;const search=authorUi.noteSearch.trim().toLowerCase();
    const notes=sortedNotes(Store.get().inspirationNotes.filter(n=>(!authorUi.noteWork||(authorUi.noteWork==='unlinked'?!n.workId:n.workId===authorUi.noteWork))&&`${n.title} ${n.content}`.toLowerCase().includes(search)));
    $('#noteList').innerHTML=notes.map(noteMarkup).join('')||'<div class="empty"><h3>给灵感留一张纸</h3><p>还没有符合条件的便条。随手记下一个场景、一句对白，或一个故事的开头。</p><button class="outline-button" data-action="new-note">＋ 记下灵感</button></div>';
  }
  function renderWorkNotes(){
    if(!editor||!$('#workNotes'))return;const notes=sortedNotes(Store.get().inspirationNotes.filter(n=>n.workId===editor.work.id));
    $('#workNoteCount').textContent=`· ${notes.length} 条`;$('#workNotes').innerHTML=notes.map(noteMarkup).join('')||'<p class="help-text">这部作品还没有灵感便条。</p>';
  }
  async function openNote(id,workId=null){
    if(topLayer()?.id==='utilityLayer')finishDialog('cancel');Writer.pause();
    const note=id?Store.get().inspirationNotes.find(n=>n.id===id):{id:Store.uuid(),title:'',content:'',workId,pinned:false,createdAt:now(),updatedAt:now()};
    if(!note)return;noteEditor={note:Store.clone(note),dirty:false,composing:false};
    await dialog(id?'编辑灵感便条':'记下灵感',`<form id="noteForm"><label class="field"><span>标题（可选）</span><input name="noteTitle" maxlength="80" placeholder="给这个念头起个名字" value="${esc(note.title)}"></label><label class="field"><span>关联作品</span><select name="noteWork">${workOptions(note.workId||'')}</select></label><label class="field"><span>灵感内容</span><textarea name="noteContent" maxlength="20000" placeholder="场景、对白、人物的小秘密……">${esc(note.content)}</textarea></label><p id="noteSaveStatus" role="status">停止输入 1 秒后自动保存</p></form>`,[{value:'ok',label:'保存并关闭',primary:true}]);
  }
  function collectNote(){if(!noteEditor||!$('#noteForm'))return;const form=$('#noteForm');noteEditor.note.title=form.elements.noteTitle.value;noteEditor.note.content=form.elements.noteContent.value;noteEditor.note.workId=form.elements.noteWork.value||null;}
  function saveNote(){
    clearTimeout(noteTimer);if(!noteEditor)return;collectNote();
    if(!noteEditor.dirty)return;
    const note=Store.clone(noteEditor.note),existing=Store.get().inspirationNotes.some(n=>n.id===note.id);
    if(!existing&&!note.title.trim()&&!note.content.trim()){noteEditor.dirty=false;return}
    note.updatedAt=now();const durable=Store.change(d=>{const i=d.inspirationNotes.findIndex(n=>n.id===note.id);if(i<0)d.inspirationNotes.unshift(note);else d.inspirationNotes[i]=note});
    noteEditor.note=note;noteEditor.dirty=false;if($('#noteSaveStatus'))$('#noteSaveStatus').textContent=durable?'便条已保存到本机':'当前页面暂存，请导出备份';renderNoteList();renderWorkNotes();
  }
  function noteInput(){collectNote();noteEditor.dirty=true;$('#noteSaveStatus').textContent='尚未保存 · 正在等待输入结束';clearTimeout(noteTimer);if(!noteEditor.composing)noteTimer=setTimeout(saveNote,1000);}
  function deleteNote(id){
    const note=Store.get().inspirationNotes.find(n=>n.id===id);if(!note)return;
    const removed=Store.clone(note);Store.change(d=>{d.inspirationNotes=d.inspirationNotes.filter(n=>n.id!==id)});renderNoteList();renderWorkNotes();
    offerUndo('灵感便条已删除',()=>{Store.change(d=>{if(!d.inspirationNotes.some(n=>n.id===id))d.inspirationNotes.push(removed)});renderNoteList();renderWorkNotes()});
  }
  function renderRecordsPage(){
    $('#authorContent').innerHTML=`<div class="author-tools"><div><h3>把写过的时间留在这里</h3><p class="help-text">正文编辑自动计时，闲置 2 分钟或进入后台暂停。净增字数保留删除抵扣。</p></div><label>查看作品<select id="recordWorkFilter">${workOptions(authorUi.recordWork,true)}</select></label></div><div class="record-summary" id="recordSummary"></div><div class="record-table-wrap"><table class="record-table"><caption>近 30 天写作记录</caption><thead><tr><th scope="col">日期</th><th scope="col">有效写作时长</th><th scope="col">正文净增字数</th></tr></thead><tbody id="recordRows"></tbody></table></div>`;$('#recordWorkFilter').value=authorUi.recordWork;renderRecordRows();
  }
  function renderRecordRows(){
    if(!$('#recordRows'))return;const rows=Writer.records().filter(r=>!authorUi.recordWork||r.workId===authorUi.recordWork),stats=Writer.summary('',rows);
    $('#recordSummary').innerHTML=`<div><small>今日写作</small><strong>${Writer.duration(stats.todayMs)}</strong></div><div><small>本周写作 · 周一开始</small><strong>${Writer.duration(stats.weekMs)}</strong></div><div><small>累计写作</small><strong>${Writer.duration(stats.totalMs)}</strong></div>`;
    const days=new Map();rows.forEach(r=>{if(!days.has(r.date))days.set(r.date,{durationMs:0,netWords:0});const day=days.get(r.date);day.durationMs+=r.durationMs;day.netWords+=r.netWords});
    const today=new Date();today.setHours(0,0,0,0);const list=[];
    for(let i=0;i<30;i++){const date=new Date(today);date.setDate(date.getDate()-i);const key=Writer.dayKey(date),day=days.get(key)||{durationMs:0,netWords:0};list.push(`<tr><th scope="row">${key}${i===0?' · 今天':''}</th><td>${Writer.duration(day.durationMs)}</td><td>${day.netWords>0?'+':''}${day.netWords.toLocaleString('zh-CN')} 字</td></tr>`)}
    $('#recordRows').innerHTML=list.join('');
  }
  function exportWorkTxt(id,chapter=false){
    Studio.flush();
    if(editor)saveEditor();Writer.flush();if(noteEditor)saveNote();
    const work=chapter?editor?.work:Store.get().works.find(w=>w.id===id);if(!work)return;
    Writer.exportTxt(work,chapter?editor.chapterId:null);flash(chapter?'本章 TXT 已导出。':'全书 TXT 已导出。');
  }


  async function leave(){
    Studio.flush();Writer.pause();if(!editor)return;const active=editor,work=Store.get().works.find(w=>w.id===active.work.id),chapter=work?.chapters.find(c=>c.id===active.chapterId);
    if(!chapter||signature(chapter)===active.snapshotBaseline)return;
    try{await History.take(work.id,chapter,'auto');if(editor===active)active.snapshotBaseline=signature(chapter)}catch(error){flash(error.message)}
  }
  async function restoreSnapshot(row){
    if(!editor||!await guardEditor())return;saveEditor();Writer.pause();
    const work=Store.clone(Store.get().works.find(w=>w.id===editor.work.id));
    if(row.workId!==work.id)throw Error('快照属于其他作品。');
    let target=work.chapters.find(c=>c.id===row.chapterId);
    const current=target||work.chapters.find(c=>c.id===editor.chapterId);
    await History.take(work.id,current,'manual','恢复前的当前稿');
    if(target){target.title=row.title;target.content=row.content}else{target={id:Store.uuid(),title:row.title,content:row.content};work.chapters.push(target)}
    work.updatedAt=now();Store.change(data=>{const i=data.works.findIndex(w=>w.id===work.id);if(i>=0)data.works[i]=work});
    if(target.id===editor.chapterId)editor.snapshotBaseline=signature(target);editor.dirty=false;editor.wordDeltas={};
    await go({kind:'author',work:work.id,chapter:target.id},{replace:true,skipGuard:true});saved('章节版本已恢复');
  }
  async function deleteWork(id){
    const original=Store.get().works.find(w=>w.id===id);if(!original)return;
    const choice=await dialog('删除作品',`<p class="notice-copy">将删除“${esc(original.title)}”及其正文。灵感便条和写作记录保留。</p><label class="check-row"><input type="checkbox" id="deleteWorkTools"> 同时删除这部作品的创作设定和历史快照</label><p class="help-text">未勾选时设定和快照保留，恢复作品后可继续使用；删除后 12 秒内可撤销。</p>`,[{value:'cancel',label:'保留作品'},{value:'delete-work',label:'删除作品',primary:true}]);
    if(choice!=='delete-work')return;const erase=$('#deleteWorkTools').checked,work=Store.clone(original),workspace=Store.clone(Store.get().workspaces.find(w=>w.id===id)||null);
    let history=[];if(erase){try{history=await History.list(id);await History.clear(id)}catch(error){flash(error.message);return}}
    Store.change(data=>{data.works=data.works.filter(w=>w.id!==id);if(erase)data.workspaces=data.workspaces.filter(w=>w.id!==id)});renderAuthor(getRoute());
    offerUndo('作品与章节已删除',async()=>{if(erase&&history.length)await History.merge(history);Store.change(data=>{if(!data.works.some(w=>w.id===id))data.works.unshift(work);if(erase&&workspace&&!data.workspaces.some(w=>w.id===id))data.workspaces.push(workspace)});refreshCurrentAuthor()});
  }
  async function action(name,button){if(Studio.handlesAction(name))return Studio.action(name,button);Studio.flush();const id=button.dataset.id;switch(name){
      case 'new-work':if(await guardEditor())newWork();return;
      case 'author-tab':return go({kind:'author',tab:button.dataset.tab});
      case 'writer-focus':return setWriterFocus(!document.body.classList.contains('writer-focus'));
      case 'writer-pause':return Writer.togglePause();
      case 'writer-goal':return editWriterGoal();
      case 'export-txt':return exportWorkTxt(id);
      case 'export-chapter-txt':return exportWorkTxt(null,true);
      case 'new-note':return openNote(null,button.dataset.work||null);
      case 'edit-note':return openNote(id);
      case 'delete-note':return deleteNote(id);
      case 'pin-note':Store.change(d=>{const note=d.inspirationNotes.find(n=>n.id===id);if(note){note.pinned=!note.pinned;note.updatedAt=now()}});renderNoteList();renderWorkNotes();return;
      case 'edit-work':return go({kind:'author',work:id});
      case 'save-work':saveEditor();saved('作品已保存到本机');return;
      case 'edit-chapter':saveEditor();return go({kind:'author',work:editor.work.id,chapter:id},{replace:true,skipGuard:true});
      case 'add-chapter':case 'chapter-up':case 'chapter-down':case 'delete-chapter':return mutateChapter(name,id);
      case 'preview':{if(!editor)return;saveEditor();return go({kind:'reader',preview:true,work:editor.work.id,chapter:editor.work.chapters.findIndex(c=>c.id===editor.chapterId)},{skipGuard:true})}
      case 'delete-work':return deleteWork(id);

  }}
  const names=new Set(['new-work','author-tab','writer-focus','writer-pause','writer-goal','export-txt','export-chapter-txt','new-note','edit-note','delete-note','pin-note','edit-work','save-work','edit-chapter','add-chapter','chapter-up','chapter-down','delete-chapter','preview','delete-work']);
  function input(event){if(Studio.input(event))return;const el=event.target;if(el.id==='authorWorkSearch'){authorUi.search=el.value;renderWorkList()}if(el.id==='authorChapterSearch'){authorUi.chapterSearch=el.value;renderAuthorChapters()}if(el.id==='noteSearch'){authorUi.noteSearch=el.value;renderNoteList()}if(el.closest('#noteForm')&&noteEditor)noteInput();if(el.closest('#workForm')&&editor){collectEditor();editor.dirty=true;if(el.name==='content')Writer.activity();$('#saveStatus').textContent='尚未保存 · 正在等待输入结束';scheduleSave();updateAuthorStats()}}
  function change(event){if(Studio.change(event))return;const el=event.target;if(el.id==='authorWorkSort'){authorUi.sort=el.value;renderWorkList()}if(el.id==='noteWorkFilter'){authorUi.noteWork=el.value;renderNoteList()}if(el.id==='recordWorkFilter'){authorUi.recordWork=el.value;renderRecordRows()}}
  function submit(event){if(Studio.submit(event))return true;const form=event.target;if(!['workForm','noteForm','writerGoalForm'].includes(form.id))return false;event.preventDefault();if(form.id==='workForm'){saveEditor();saved('作品已保存到本机')}if(form.id==='noteForm')saveNote();if(form.id==='writerGoalForm'&&form.reportValidity())finishDialog('save');return true;}
  function composition(event,start){if(Studio.composition(event,start))return;if(event.target.closest('#workForm')&&editor){editor.composing=start;clearTimeout(saveTimer);if(!start)scheduleSave()}if(event.target.closest('#noteForm')&&noteEditor){noteEditor.composing=start;clearTimeout(noteTimer);if(!start)noteInput()}}
  function keydown(event){if(Studio.keydown(event))return true;if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'&&!event.isComposing&&(noteEditor||editor&&!topLayer())){event.preventDefault();if(noteEditor)saveNote();else{saveEditor();saved('作品已保存到本机')}return true}if(!topLayer()&&event.key==='Escape'&&document.body.classList.contains('writer-focus')){event.preventDefault();setWriterFocus(false);return true}return false;}
  function closeDialog(){if(noteEditor){saveNote();noteEditor=null;clearTimeout(noteTimer)}}
  function flush(){Studio.flush();if(editor?.dirty)saveEditor();if(noteEditor?.dirty)saveNote();Writer.flush()}
  function persist(){flush();Writer.pause()}
  function dispose(){Studio.dispose();clearTimeout(saveTimer);setWriterFocus(false);Writer.pause();editor=null;}
  window.addEventListener('zhezhi-writing',updateAuthorStats);
  return {render:renderAuthor,guard:guardEditor,leave,dispose,flush,persist,input,change,submit,composition,keydown,closeDialog,action,handlesAction:name=>names.has(name)||Studio.handlesAction(name),hasUnsaved:()=>Boolean(Studio.hasUnsaved()||editor&&(editor.dirty||!Store.isDurable())||noteEditor&&(noteEditor.dirty||!Store.isDurable()))};
  }};
})();
