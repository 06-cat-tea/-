(() => {
  'use strict';
  const {books,updates}=window.ZhezhiCatalog, Store=window.ZhezhiStore, Writer=window.ZhezhiWriter;
  const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
  const {esc,count,now}=window.ZhezhiUtils;
  const labels={want:'想读',reading:'在读',done:'读完'};
  const ui={category:'全部',search:'',sort:'popular',page:1,shelf:'all'};
  let route,activeBook,chapterIndex=0,detailBook,progressTimer,toastTimer,undoTimer,undoAction;
  let renderToken=0,navigationRequest=0,restoring=false,pendingDialog=null,dialogTrigger,noticeTrigger,skipPop=false,directoryRequested=false;
  const chaptersFor=b=>b.chapters?.length?b.chapters:[{title:b.chapter,content:b.content}];
  const catalogBook=id=>books.find(b=>b.id===id);
  const readingRecord=id=>Store.get().history.find(r=>r.id===id);
  function flash(message) {
    const el=$('#toast');el.textContent=message;el.classList.add('show');clearTimeout(toastTimer);
    toastTimer=setTimeout(()=>el.classList.remove('show'),3200);
  }
  function saved(message) {flash(Store.isDurable()?message:'本次操作暂存于当前页面，请导出备份以免丢失。')}
  function storageStatus() {
    const el=$('#storageWarning');el.hidden=Store.isDurable();
    el.textContent='浏览器未能持久保存数据。当前内容暂存在此页面，刷新前请导出备份。';
  }
  function offerUndo(text,fn) {
    undoAction=fn;$('#undoBar span').textContent=text;$('#undoBar').hidden=false;clearTimeout(undoTimer);
    undoTimer=setTimeout(dismissUndo,12000);
  }
  function dismissUndo(){undoAction=null;$('#undoBar').hidden=true;clearTimeout(undoTimer)}

  // All overlays share one focus and scroll-lock stack.
  function topLayer(){return ['bookDetailLayer','readerLayer','showcaseNotice','utilityLayer'].map(id=>$('#'+id)).filter(el=>el.classList.contains('open')).at(-1)}
  function syncLayers() {
    const top=topLayer();$('body>.shell').inert=Boolean(top);
    ['bookDetailLayer','readerLayer','showcaseNotice','utilityLayer'].forEach(id=>{const el=$('#'+id);el.inert=el!==top;el.setAttribute('aria-hidden',String(el!==top))});
    document.body.style.overflow=top?'hidden':'';
  }
  function focusTop(){const top=topLayer();if(top)top.querySelector('button,input,select')?.focus({preventScroll:true})}
  function dialog(title,content,choices=[{value:'ok',label:'我知道了',primary:true}]) {
    if(pendingDialog)finishDialog('cancel');
    dialogTrigger=document.activeElement;$('#utilityTitle').textContent=title;$('#utilityContent').innerHTML=content;
    $('#utilityActions').innerHTML=choices.map(c=>`<button class="${c.primary?'solid-button':'outline-button'}" data-dialog-result="${esc(c.value)}">${esc(c.label)}</button>`).join('');
    $('#utilityLayer').classList.add('open');syncLayers();focusTop();
    return new Promise(resolve=>{pendingDialog=resolve});
  }
  function finishDialog(value='cancel') {
    Author.closeDialog();
    $('#utilityLayer').classList.remove('open');syncLayers();
    const fn=pendingDialog;pendingDialog=null;fn?.(value);
    if(dialogTrigger?.isConnected&&!dialogTrigger.closest('[inert]'))dialogTrigger.focus({preventScroll:true});else focusTop();
  }
  function notice() {noticeTrigger=document.activeElement;$('#showcaseNotice').classList.add('open');syncLayers();$('#showcaseNotice [data-action="ack-notice"]').focus()}
  function closeNotice(ack=false) {
    if(ack)Store.change(d=>{d.noticeVersion=2});$('#showcaseNotice').classList.remove('open');syncLayers();
    if(topLayer())focusTop();else if(noticeTrigger?.isConnected)noticeTrigger.focus({preventScroll:true});
  }

  // Routing preserves existing share URLs and uses one history entry per reading session.
  function parseRoute() {
    const params=new URLSearchParams(location.search),view=params.get('view'),book=params.get('book');
    if(['privacy','terms','settings'].includes(view))return {kind:view};
    if(view==='author')return {kind:'author',work:params.get('work')||null,chapter:params.get('edit')||null,tab:['notes','records'].includes(params.get('tab'))?params.get('tab'):'works'};
    if(view==='preview')return {kind:'reader',preview:true,work:params.get('work'),chapter:Number(params.get('chapter')||0)};
    if(book)return params.has('chapter')?{kind:'reader',book,chapter:/^\d+$/.test(params.get('chapter'))?Number(params.get('chapter')):-1}:{kind:'detail',book};
    return {kind:'home',anchor:location.hash.slice(1)||'home'};
  }
  function routeURL(target) {
    const url=new URL(location.href);url.search='';url.hash='';
    if(target.kind==='home'){if(target.anchor&&target.anchor!=='home')url.hash=target.anchor}
    else if(target.kind==='detail'){url.searchParams.set('book',target.book);url.searchParams.set('detail','1')}
    else if(target.kind==='reader'){
      if(target.preview){url.searchParams.set('view','preview');url.searchParams.set('work',target.work)}
      else url.searchParams.set('book',target.book);
      url.searchParams.set('chapter',String(target.chapter));
    } else {
      url.searchParams.set('view',target.kind);
      if(target.kind==='author'&&target.work){url.searchParams.set('work',target.work);if(target.chapter)url.searchParams.set('edit',target.chapter)}
      else if(target.kind==='author'&&['notes','records'].includes(target.tab))url.searchParams.set('tab',target.tab);
    }
    return url.pathname+url.search+url.hash;
  }
  function snapshot() {
    return {...ui,windowY:window.scrollY,detailY:$('#bookDetailLayer').scrollTop,readerY:$('#readerLayer').scrollTop};
  }
  function saveUI(){history.replaceState({...history.state,zhezhi:true,ui:snapshot()},'',location.href)}
  const guardEditor=()=>Author.guard();
  async function go(target,{replace=false,resume=false,skipGuard=false}={}) {
    const request=++navigationRequest;
    if(!skipGuard&&!await guardEditor())return;
    if(request!==navigationRequest)return;
    await Author.leave();if(request!==navigationRequest)return;saveProgress();saveUI();
    const from=routeURL(route),index=(history.state?.index||0)+(replace?0:1);
    const entry={zhezhi:true,index,from:replace?history.state?.from:from,ui:{...ui},resume};
    history[replace?'replaceState':'pushState'](entry,'',routeURL(target));
    window.__zhezhiIndex=index;
    renderRoute(target,entry);
  }
  async function back(fallback) {
    if(!await guardEditor())return;
    saveProgress();saveUI();
    if(history.state?.from)history.back();else go(fallback,{replace:true,skipGuard:true});
  }
  function routeError(message) {
    flash(message);const target={kind:'home',anchor:'books'};
    history.replaceState({...history.state,from:null},'',routeURL(target));renderRoute(target,history.state);
  }
  function renderRoute(target,entry={}) {
    Author.dispose();
    document.body.classList.remove('author-editing');
    route=target;activeBook=null;detailBook=null;
    renderToken++;restoring=true;const token=renderToken;
    if(entry.ui)for(const key of ['category','search','sort','page','shelf'])if(entry.ui[key]!==undefined)ui[key]=entry.ui[key];
    $('#readerLayer').classList.remove('open');$('#bookDetailLayer').classList.remove('open');
    ['readerView','author','settingsPage','policyPage'].forEach(id=>$('#'+id).classList.add('section-hidden'));
    const mainKind=['detail','reader'].includes(target.kind)?'home':target.kind;
    document.body.dataset.page=mainKind;
    if(mainKind==='home'){$('#readerView').classList.remove('section-hidden');renderHome()}
    if(mainKind==='author'){$('#author').classList.remove('section-hidden');Author.render(target)}
    if(mainKind==='settings'){$('#settingsPage').classList.remove('section-hidden');renderSettings()}
    if(['privacy','terms'].includes(mainKind)){$('#policyPage').classList.remove('section-hidden');renderPolicy(mainKind)}
    if(target.kind==='detail'){
      const book=catalogBook(target.book);if(!book)return routeError('作品暂不可用，已返回书库。');renderDetail(book);
    }
    if(target.kind==='reader'){
      let book=catalogBook(target.book);
      if(target.preview){const work=Store.get().works.find(w=>w.id===target.work);if(!work)return routeError('本地作品不存在，请在原浏览器打开作者中心。');book={...work,author:'你的本地创作',category:work.category,content:work.chapters[0].content}}
      if(!book)return routeError('作品暂不可用，已返回书库。');
      if(!Number.isInteger(target.chapter)||target.chapter<0||target.chapter>=chaptersFor(book).length){
        if(target.preview){return go({kind:'author',work:target.work},{replace:true,skipGuard:true})}
        const detail={kind:'detail',book:book.id};history.replaceState({...entry,from:null},'',routeURL(detail));flash('章节不存在，请从目录选择。');return renderRoute(detail,entry);
      }
      renderReader(book,target,entry);
    }
    $$('.nav a').forEach(a=>{const selected=mainKind==='home'&&a.hash===`#${target.anchor||'home'}`;a.classList.toggle('active',selected);if(selected)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current')});
    $('#authorBtn').setAttribute('aria-pressed',String(mainKind==='author'));
    syncLayers();applySettings();
    requestAnimationFrame(()=>{
      if(token!==renderToken)return;
      const savedUI=entry.ui||{};
      if(target.kind==='detail')$('#bookDetailLayer').scrollTop=savedUI.detailY||0;
      if(target.kind==='reader'){
        const prior=readingRecord(activeBook.id),progress=entry.resume?prior?.progress||0:0;
        $('#readerLayer').scrollTop=savedUI.readerY??readingRange()*progress/100;
      }
      window.scrollTo({top:savedUI.windowY??0,behavior:'instant'});
      if(target.kind==='home'&&!savedUI.windowY&&target.anchor&&target.anchor!=='home')document.getElementById(target.anchor==='readerView'?'books':target.anchor)?.scrollIntoView({behavior:'instant'});
      restoring=false;if(target.kind==='reader')saveProgress();
      if(topLayer())focusTop();else if(mainKind!=='home')document.querySelector(`#${mainKind==='author'?'author':mainKind==='settings'?'settingsPage':'policyPage'} h2`)?.focus({preventScroll:true});
      if(target.kind==='detail'&&directoryRequested){directoryRequested=false;$('#chapterSearch').scrollIntoView({block:'start',behavior:'instant'});$('#chapterSearch').focus({preventScroll:true})}
    });
  }

  function bookLink(id,label,className=''){return `<a class="${className}" href="?book=${encodeURIComponent(id)}&detail=1" data-action="detail" data-id="${esc(id)}">${label}</a>`}
  function renderHome(){renderBooks();renderUpdates();renderShelf();$('#librarySearch').value=ui.search;$('#bookSort').value=ui.sort;$('#shelfFilter').value=ui.shelf;$$('.pill').forEach(p=>{const selected=p.dataset.category===ui.category;p.classList.toggle('selected',selected);p.setAttribute('aria-pressed',String(selected))})}
  function renderBooks() {
    let list=books.filter(b=>(ui.category==='全部'||b.tags.includes(ui.category))&&(!ui.search||`${b.title} ${b.author} ${b.desc} ${b.tags.join(' ')}`.toLowerCase().includes(ui.search.toLowerCase())));
    const latest=new Map(updates.map((u,i)=>[u.id,updates.length-i]));
    list.sort(ui.sort==='title'?(a,b)=>a.title.localeCompare(b.title,'zh-CN'):ui.sort==='latest'?(a,b)=>(latest.get(b.id)||0)-(latest.get(a.id)||0):(a,b)=>Number(Boolean(b.featured))-Number(Boolean(a.featured))||(parseFloat(b.heat)||0)-(parseFloat(a.heat)||0));
    const pages=Math.max(1,Math.ceil(list.length/6));ui.page=Math.max(1,Math.min(ui.page,pages));
    $('#bookGrid').innerHTML=list.length?list.slice((ui.page-1)*6,ui.page*6).map(b=>`<article class="book-card reveal"><div class="cover ${esc(b.cover)}">${bookLink(b.id,`<div class="cover-art"></div><span class="fold">✧</span><h3>${esc(b.title)}</h3>`,'cover-link')}</div><div class="book-meta"><h3>${bookLink(b.id,esc(b.title))}</h3><div class="author">${esc(b.author)} · 演示作品</div><p class="book-desc">${esc(b.desc)}</p><div class="book-bottom"><span class="genre">${esc(b.category)}</span><span>${esc(b.heat)} · 示例</span></div></div>${bookLink(b.id,'翻开这本书 →','text-link read-book')}</article>`).join(''):'<div class="empty">没有找到符合条件的作品。<button class="quiet-button" data-action="reset-filters">重置筛选</button></div>';
    $('#resultsCount').textContent=`共 ${list.length} 部作品 · 第 ${ui.page} / ${pages} 页`;
    $('#filterSummary').textContent=`${ui.category==='全部'?'全部故事':ui.category}${ui.search?` · 搜索“${ui.search}”`:''}`;
    $('#pagination').innerHTML=pages>1?Array.from({length:pages},(_,i)=>`<button class="page-button ${ui.page===i+1?'current':''}" data-action="page" data-page="${i+1}" aria-label="第 ${i+1} 页" ${ui.page===i+1?'aria-current="page"':''}>${i+1}</button>`).join(''):'';
    observeReveals();
  }
  function renderUpdates(){
    $('#updateList').innerHTML=updates.map(u=>`<div class="update-row">${bookLink(u.id,`${esc(u.book)} <small>${esc(u.author)}</small>`,'update-name')}<span class="chapter">${esc(u.chapter)}</span><span class="status">● 演示更新</span><time>${esc(u.time)}</time></div>`).join('');
    $('#ranking').innerHTML=books.slice().sort((a,b)=>Number(Boolean(b.featured))-Number(Boolean(a.featured))||(parseFloat(b.heat)||0)-(parseFloat(a.heat)||0)).slice(0,5).map(b=>`<li>${bookLink(b.id,esc(b.title))}<small>${esc(b.heat)}</small></li>`).join('');
  }
  function renderShelf() {
    const data=Store.get(),library=data.library.filter(r=>catalogBook(r.id)&&(ui.shelf==='all'||r.status===ui.shelf));
    $('#shelfBooks').innerHTML=library.length?library.map(r=>{const b=catalogBook(r.id);return `<div class="shelf-item managed-shelf"><div>${bookLink(b.id,esc(b.title))}<small>${esc(b.author)}</small></div><div class="shelf-item-actions"><select data-shelf-id="${esc(b.id)}" aria-label="${esc(b.title)}阅读状态">${Object.entries(labels).map(([key,text])=>`<option value="${key}" ${key===r.status?'selected':''}>${text}</option>`).join('')}</select><button class="quiet-button" data-action="remove-book" data-id="${esc(b.id)}" aria-label="移除${esc(b.title)}">移除</button></div></div>`}).join(''):`<div class="shelf-empty">${data.library.length?'这个状态下还没有作品。':'还没有收藏，在作品简介或阅读页点“加入书架”吧。'}</div>`;
    const records=data.history.filter(r=>catalogBook(r.id));
    $('#readingHistory').innerHTML=records.length?records.map(r=>{const b=catalogBook(r.id),chapter=chaptersFor(b)[r.chapterIndex];return `<div class="shelf-item managed-shelf"><div>${bookLink(b.id,esc(b.title))}<small>${esc(chapter?.title||'章节已更新')} · ${r.progress}%</small></div><button class="quiet-button" data-action="resume" data-id="${esc(b.id)}">继续阅读 →</button></div>`}).join(''):'<div class="shelf-empty">读过的作品会留在这里。</div>';
  }
  function renderDetail(b) {
    detailBook=b;const chapters=chaptersFor(b),record=readingRecord(b.id),savedBook=Store.get().library.some(r=>r.id===b.id);
    $('#bookDetailContent').innerHTML=`<div class="detail-hero fold-enter"><div class="detail-cover ${esc(b.cover)}"><div class="detail-cover-fallback">${esc(b.title)}<small>折纸文学 · 演示故事</small></div></div><div class="detail-copy"><div class="detail-kicker">${esc(b.category)} · 免费演示阅读</div><h1>${esc(b.title)}</h1><div class="detail-byline">${esc(b.author)} · ${chapters.length} 章 · 约 ${chapters.reduce((sum,c)=>sum+count(c.content),0).toLocaleString('zh-CN')} 字</div><p class="detail-description">${esc(b.desc)}</p><div class="detail-tags">${b.tags.map(t=>`<span class="detail-tag">${esc(t)}</span>`).join('')}</div><div class="detail-actions"><button class="solid-button" data-action="resume" data-id="${esc(b.id)}">${record?'继续阅读':'开始阅读'}</button><button class="outline-button" data-action="bookmark" data-id="${esc(b.id)}" aria-pressed="${savedBook}">${savedBook?'♥ 已收藏':'♡ 加入书架'}</button></div>${record?`<p class="detail-last">上次读到：${esc(chapters[record.chapterIndex]?.title||'首章')} · ${record.progress}%</p>`:''}</div></div><section class="chapter-section"><div class="chapter-section-head"><h2>章节目录</h2><small id="chapterResultCount" aria-live="polite"></small></div><div class="chapter-tools"><label><input id="chapterSearch" type="search" placeholder="搜索章节名或序号" aria-label="搜索章节"></label><button class="outline-button" data-action="chapter-order" aria-pressed="false">倒序排列</button></div><div class="detail-chapters" id="detailChapterList"></div></section>`;
    $('#bookDetailLayer').classList.add('open');renderChapterList();
  }
  function renderChapterList() {
    if(!detailBook)return;const query=($('#chapterSearch')?.value||'').trim().toLowerCase(),reverse=$('[data-action="chapter-order"]')?.getAttribute('aria-pressed')==='true',record=readingRecord(detailBook.id);
    const chapters=chaptersFor(detailBook),list=chapters.map((c,i)=>({c,i})).filter(({c,i})=>`${i+1} ${c.title}`.toLowerCase().includes(query));if(reverse)list.reverse();
    $('#detailChapterList').innerHTML=list.length?list.map(({c,i})=>`<button class="detail-chapter" data-action="chapter" data-id="${esc(detailBook.id)}" data-index="${i}" ${record?.chapterIndex===i?'aria-current="true"':''}><span>${detailBook.chapters?`第 ${i+1} 章 · `:''}${esc(c.title)}</span><small>${record?.chapterIndex===i?'上次读到':'阅读本章'} →</small></button>`).join(''):'<p class="shelf-empty">没有找到这一章，试试章节名或序号。</p>';
    $('#chapterResultCount').textContent=query?`找到 ${list.length} 章`:`共 ${chapters.length} 章 · 选择章节从头阅读`;
  }
  function renderReader(book,target,entry) {
    activeBook=book;chapterIndex=target.chapter;const chapters=chaptersFor(book),chapter=chapters[chapterIndex];
    $('#exitReader').textContent=target.preview?'← 返回创作空间':'← 返回作品简介';
    $('#readerTitle').textContent=book.title;$('#chapterHeading').textContent=chapter.title||`第 ${chapterIndex+1} 章`;
    $('#readerByline').textContent=`${book.author} · ${target.preview?'本地私有预览':book.category} · 第 ${chapterIndex+1} / ${chapters.length} 章`;
    $('#readerChapterSelect').innerHTML=chapters.map((c,i)=>`<option value="${i}">${i+1}. ${esc(c.title||'未命名章节')}</option>`).join('');$('#readerChapterSelect').value=String(chapterIndex);
    $('#readerContent').innerHTML=chapter.content?chapter.content.split(/\n\s*\n/).map(p=>`<p>${esc(p).replace(/\n/g,'<br>')}</p>`).join(''):'<p>这一章还没有正文，回到创作空间写下第一段吧。</p>';
    $('#readerContent').classList.remove('page-turn');void $('#readerContent').offsetWidth;$('#readerContent').classList.add('page-turn');
    $('#readerEnd').textContent=chapterIndex===chapters.length-1?'已读完全部内容 · 感谢你在纸间停留':'本章完 · 下一页，故事仍在继续';
    $('#prevChapter').disabled=chapterIndex===0;$('#nextChapter').disabled=chapterIndex===chapters.length-1;
    $('#readerDirectory').textContent=target.preview?'返回编辑':'返回目录';
    $('#shareBook').hidden=Boolean(target.preview);$('#bookmarkBtn').hidden=Boolean(target.preview);$('.reader-reviews').hidden=Boolean(target.preview);
    if(!target.preview){
      const prior=readingRecord(book.id),progress=entry.resume?prior?.progress||0:0;
      Store.change(d=>{d.history=d.history.filter(r=>r.id!==book.id);d.history.unshift({id:book.id,chapterIndex,progress,readAt:now()});d.history=d.history.slice(0,50);const row=d.library.find(r=>r.id===book.id);if(row&&row.status==='want')row.status='reading'});
      renderFeedback();syncBookmark();
    }
    $('#readerLayer').classList.add('open');
  }
  function readingRange(){const layer=$('#readerLayer');return Math.max(0,$('#readerContent').getBoundingClientRect().bottom-layer.getBoundingClientRect().top+layer.scrollTop-layer.clientHeight+32)}
  function progressValue(){const max=readingRange();return max?Math.max(0,Math.min(100,Math.round($('#readerLayer').scrollTop/max*100))):100}
  function updateProgressVisual(){if(!activeBook||restoring)return;const progress=progressValue();$('#readingProgress span').style.width=`${progress}%`;$('#readingProgress').setAttribute('aria-valuenow',String(progress));$('#readingProgressText').textContent=`本章 ${progress}%`}
  function saveProgress(){
    clearTimeout(progressTimer);if(!activeBook||route?.preview||restoring)return;
    updateProgressVisual();const id=activeBook.id,progress=progressValue();
    Store.change(d=>{const row=d.history.find(r=>r.id===id);if(row){row.progress=progress;row.chapterIndex=chapterIndex}});
  }
  function syncBookmark(){
    if(!activeBook||route.preview)return;const present=Store.get().library.some(r=>r.id===activeBook.id);
    $('#bookmarkBtn').textContent=present?'♥':'♡';$('#bookmarkBtn').setAttribute('aria-pressed',String(present));$('#bookmarkBtn').setAttribute('aria-label',present?'移出书架':'加入书架');
  }
  function bookmark(id,button){
    if(!catalogBook(id))return;const had=Store.get().library.some(r=>r.id===id);
    Store.change(d=>{d.library=had?d.library.filter(r=>r.id!==id):[...d.library,{id,status:activeBook?.id===id?'reading':'want'}]});
    if(button){button.classList.remove('bookmark-pop');void button.offsetWidth;button.classList.add('bookmark-pop');button.setAttribute('aria-pressed',String(!had));if(button.id!=='bookmarkBtn')button.textContent=had?'♡ 加入书架':'♥ 已收藏';if(!had)paperBurst(button)}
    syncBookmark();renderShelf();saved(had?'已从书架移除':'已加入书架');
  }
  function renderFeedback(){
    const id=activeBook.id,rating=Store.get().ratings[id]||0;
    $$('#ratingPicker button').forEach(b=>{const selected=Number(b.dataset.rating)<=rating;b.textContent=selected?'★':'☆';b.setAttribute('aria-pressed',String(Number(b.dataset.rating)===rating))});
    $('#ratingLabel').textContent=rating?`已评 ${rating} 星`:'点击星星评分';
    $('#commentList').innerHTML=(Store.get().comments[id]||[]).map(c=>`<div class="comment-card">${esc(c.text)}<small>${esc(c.createdAt.slice(0,10))}</small></div>`).join('')||'<p class="shelf-empty">留下友善的读后感，书评仅保存在你的浏览器。</p>';
    $('#commentInput').value='';$('#commentCount').textContent='0 / 300';
  }

  function readingSettingsMarkup(){const s=Store.get().settings;return `<div class="settings-fields"><label>阅读背景<select data-setting="theme">${[['paper','纸色'],['warm','暖色'],['night','夜间']].map(([value,label])=>`<option value="${value}" ${s.theme===value?'selected':''}>${label}</option>`).join('')}</select></label><label>字号 <output data-output="fontSize">${s.fontSize}px</output><input type="range" min="13" max="25" value="${s.fontSize}" data-setting="fontSize"></label><label>行距 <output data-output="lineHeight">${s.lineHeight}</output><input type="range" min="1.8" max="2.8" step="0.1" value="${s.lineHeight}" data-setting="lineHeight"></label><label>正文宽度<select data-setting="width">${[600,700,800].map(n=>`<option value="${n}" ${s.width===n?'selected':''}>${n===600?'舒适窄栏':n===700?'标准宽度':'开阔宽栏'}</option>`).join('')}</select></label></div><div class="reading-sample" id="readingSample"><p>窗边的光落在纸页上。故事慢慢展开，每一次翻页，都成为温柔的相逢。</p></div>`}
  function renderSettings(){
    $('#settingsPage').innerHTML=`<div class="section-head"><div><div class="section-kicker">your preferences</div><h2 tabindex="-1">设置与数据管理</h2></div><button class="outline-button" data-action="home">返回首页</button></div><div class="settings-grid"><section class="settings-card"><h3>把阅读调成喜欢的样子</h3>${readingSettingsMarkup()}<label class="motion-toggle"><input type="checkbox" data-setting="motion" ${Store.get().settings.motion?'checked':''}> 开启纸间动画</label><p class="help-text">系统选择减少动态效果时，动画会自动减少；手机不启用封面悬停效果。</p></section><section class="settings-card"><h3>本机数据，自己掌握</h3><p class="help-text">${Store.get().library.length} 部收藏 · ${Store.get().history.length} 条足迹 · ${Store.get().works.length} 部本地作品 · ${Store.get().inspirationNotes.length} 条灵感便条 · ${Store.get().writingRecords.length} 条写作记录。备份可能含私人文字，请自行妥善保管。</p><div class="data-actions"><button class="solid-button" data-action="export">导出 JSON 备份</button><label class="outline-button import-label">导入备份<input id="backupFile" type="file" accept=".json,application/json"></label></div><p class="help-text">导入会先显示内容数量，经确认后合并；同一作品保留更新时间较新的版本，阅读设置采用备份值。</p><p id="backupStatus" role="status" class="help-text"></p><form id="clearDataForm"><h4>选择要清理的数据</h4>${[['library','书架'],['history','阅读足迹'],['feedback','评分与书评'],['settings','阅读设置'],['works','作者作品与章节'],['inspirationNotes','灵感便条'],['writingRecords','写作时间与字数记录'],['authorSettings','每日写作目标'],['workspaces','大纲、人物关系与伏笔'],['chapterSnapshots','章节历史快照']].map(([key,label])=>`<label class="check-row"><input type="checkbox" name="clear" value="${key}"> ${label}</label>`).join('')}<button type="submit" class="outline-button danger-button">清理所选数据</button></form><div class="policy-links"><a href="?view=privacy" data-action="privacy">隐私说明</a><a href="?view=terms" data-action="terms">版权与分享声明</a><button class="quiet-button" data-action="notice">技术展示声明</button></div></section></div>`;
  }
  function applySettings(){
    const s=Store.get().settings,reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.documentElement.classList.toggle('motion-off',!s.motion||reduced);
    const layer=$('#readerLayer');layer.classList.toggle('reader-night',s.theme==='night');layer.classList.toggle('reader-warm',s.theme==='warm');
    $('#readerContent').style.fontSize=`${s.fontSize}px`;$('#readerContent').style.lineHeight=String(s.lineHeight);$('.reader-main').style.maxWidth=`${s.width}px`;
    $('#readingTheme').setAttribute('aria-label',`阅读背景：${{paper:'纸色',warm:'暖色',night:'夜间'}[s.theme]}，点击切换`);
    $('#readingTheme').setAttribute('aria-pressed',String(s.theme!=='paper'));
    const topHeight=$('.reader-top').getBoundingClientRect().height;$('#readingProgress').style.top=`${topHeight||64}px`;
    $$('.reading-sample').forEach(el=>{el.dataset.theme=s.theme;el.style.fontSize=`${s.fontSize}px`;el.style.lineHeight=s.lineHeight});
    $$('[data-output]').forEach(el=>{const key=el.dataset.output;el.textContent=key==='fontSize'?`${s.fontSize}px`:s[key]});
  }
  function setSetting(key,value){
    const progress=activeBook?progressValue():0;
    Store.change(d=>{d.settings=Store.settings({...d.settings,[key]:value})});applySettings();
    if(activeBook){restoring=true;const token=renderToken;requestAnimationFrame(()=>{if(token!==renderToken)return;$('#readerLayer').scrollTop=readingRange()*progress/100;restoring=false;saveProgress()})}
  }
  async function exportBackup(){Author.flush();return exportCompleteBackup();}
  const importBackup=file=>Backup.import(file);
  const exportCompleteBackup=()=>Backup.export();
  async function clearData(form){
    const keys=new FormData(form).getAll('clear');if(!keys.length)return flash('请先选择要清理的数据。');
    const result=await dialog('确认清理本机数据','<p class="notice-copy">所选数据会从本站本地存储中删除。需要保留时，请先导出备份。</p>',[{value:'cancel',label:'取消'},{value:'clear',label:'确认清理',primary:true}]);if(result!=='clear')return;
    if(keys.includes('works')){const authorResult=await dialog('将删除作者作品与全部章节',`<p class="notice-copy">共有 ${Store.get().works.length} 部本地作品。灵感便条、写作记录、创作设定和历史快照仅在单独勾选时清理。此操作无法撤销，请确认已保存所需备份。</p>`,[{value:'cancel',label:'保留作品'},{value:'clear',label:'确认删除作者数据',primary:true}]);if(authorResult!=='clear')return}
    if(keys.includes('chapterSnapshots')){try{await window.ZhezhiSnapshots.clear()}catch(error){flash(error.message);return}}Store.clear(keys);if(keys.includes('writingRecords'))Writer.resetRecords();dismissUndo();renderSettings();applySettings();saved('所选本机数据已清理');
  }
  function renderPolicy(kind){
    const privacy=kind==='privacy';
    const text=privacy?`<h3>哪些数据保存在这里</h3><p>书架与阅读状态、足迹与章节进度、阅读及动画设置、评分、书评、作者作品和章节、灵感便条、写作时间与净增字数记录、每日目标、大纲、人物关系和伏笔，均保存在当前浏览器的本地存储；章节快照保存在此浏览器的 IndexedDB 历史库。本站没有账号注册、广告、统计追踪或主动上传个人数据的功能。作者阅读预览仅使用本地草稿，不会自动发布。</p><h3>保存期限与管理方式</h3><p>本地数据持续保存到你主动清理或浏览器删除为止。可以在“设置与数据管理”导出 JSON 备份、导入备份或分类删除。TXT 可导出全书或本章正文，完整恢复请使用包含创作设定与快照的 JSON 备份（单个文件最多 50 MB，超限可选历史分批导出）；灵感便条与写作记录可独立清理。清理作者作品需再次确认。浏览器存储受限时，内容可能仅暂存于当前页面，刷新会丢失；页面会显示提示。</p><h3>备份与设备使用</h3><p>备份文件可能含有私人稿件和书评，请自行保管。共享电脑上的其他使用者可能访问本机数据。导入备份在浏览器内处理，不上传到服务器。</p><h3>离线缓存</h3><p>网站使用 Service Worker 缓存公开页面、图标与演示章节，以供离线访问；缓存不包含你的私人草稿。更新后清理本站旧版本缓存。你可以通过浏览器的网站数据设置清理离线资源。</p><h3>托管平台与外部链接</h3><p>本站使用 GitHub Pages 托管。GitHub Pages 会为安全目的记录访问者 IP，具体处理由 <a href="https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages" target="_blank" rel="noopener noreferrer">GitHub Pages 官方说明</a>与 <a href="https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement" target="_blank" rel="noopener noreferrer">GitHub 隐私声明</a>说明。点击贴吧或 GitHub 反馈入口后，将进入第三方网站，其规则适用于后续访问。</p><h3>联系与反馈</h3><p>可通过 <a href="https://github.com/06-cat-tea/-/issues" target="_blank" rel="noopener noreferrer">仓库公开反馈区</a>提出功能或隐私问题。反馈内容公开可见，请勿提交私人稿件、密码、联系方式或其他个人信息。</p>`:`<h3>免费阅读，免费分享</h3><p>折纸文学用于技术展示与故事交流，免费阅读、免费分享、非商业用途，不提供收费章节、会员订阅、付费解锁、广告或支付功能。</p><h3>演示内容与创作预览</h3><p>站内《雾台照微》及其他示例内容用于展示书库和阅读交互，榜单与更新数据为演示数据。作者中心是本地创作空间，本地预览不构成公开发表，也不会自动上传作品。</p><h3>仓库文件与许可</h3><p>公开仓库保留 <a href="https://github.com/06-cat-tea/-/blob/main/LICENSE" target="_blank" rel="noopener noreferrer">CC0 1.0 LICENSE</a>。仓库文件的使用以该许可及文件中的单独标注为准；本站免费阅读、无收费功能与非商业运营的说明，不对已有许可增加额外限制。</p><h3>展示作品与第三方素材</h3><p>展示作品、封面和第三方素材的权利归各自权利人，使用时请遵循相应的许可、来源说明或授权条件。分享本站链接不会改变这些内容的权属，也不会扩大已有授权。</p><h3>作者本地稿件</h3><p>作者在本机创建的稿件、便条和创作设定，其权利归相应权利人。使用本站创作工具不会使本地稿件自动适用公开仓库的 CC0 许可。本地保存、阅读预览、TXT 导出与 JSON 备份均不会自动上传或公开发表，也不向本站转让稿件权利。</p><h3>分享与反馈</h3><p>欢迎分享公开作品链接与网站体验。分享链接不会包含你的本地草稿、书评或阅读记录。对内容权属有疑问时，可在 <a href="https://github.com/06-cat-tea/-/issues" target="_blank" rel="noopener noreferrer">公开反馈区</a>提供公开页面位置和问题描述，请勿附上私人稿件或个人信息。</p>`;
    $('#policyPage').innerHTML=`<div class="section-head"><div><div class="section-kicker">折纸文学 · 纸间约定</div><h2 tabindex="-1">${privacy?'隐私说明':'版权与分享声明'}</h2></div><button class="outline-button" data-action="home">返回首页</button></div><article class="policy-card"><p class="policy-date">更新于 2026 年 10 月 12 日</p>${text}<div class="policy-links"><button class="outline-button" data-action="settings">设置与数据管理</button><a class="text-link" href="?view=${privacy?'terms':'privacy'}" data-action="${privacy?'terms':'privacy'}">${privacy?'版权与分享声明':'隐私说明'} →</a></div></article>`;
  }

  // Effects are progressive enhancement: content remains visible if observers fail.
  let revealObserver;
  function paperBurst(button){
    if(document.documentElement.classList.contains('motion-off')||document.hidden)return;
    const rect=button.getBoundingClientRect(),burst=document.createElement('span');burst.className='paper-burst';burst.setAttribute('aria-hidden','true');
    burst.style.left=`${rect.left+rect.width/2}px`;burst.style.top=`${rect.top+rect.height/2}px`;
    for(let i=0;i<6;i++){const piece=document.createElement('i'),angle=(i/6)*Math.PI*2;piece.style.setProperty('--fly-x',`${Math.cos(angle)*35}px`);piece.style.setProperty('--fly-y',`${Math.sin(angle)*30-12}px`);piece.style.setProperty('--fly-angle',`${(i-2)*65}deg`);burst.append(piece)}
    document.body.append(burst);setTimeout(()=>burst.remove(),550);
  }
  function observeReveals(){
    revealObserver?.disconnect();if(!('IntersectionObserver' in window)||document.documentElement.classList.contains('motion-off'))return;
    revealObserver=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add('revealed');revealObserver.unobserve(entry.target)}}),{threshold:0.06});
    $$('.reveal').forEach((el,i)=>{el.style.setProperty('--reveal-delay',`${Math.min(i,5)*45}ms`);revealObserver.observe(el)});
  }
  async function share(){
    if(!activeBook||route.preview)return;const url=new URL(routeURL({kind:'reader',book:activeBook.id,chapter:chapterIndex}),location.href).href;
    try{if(navigator.share)await navigator.share({title:`${activeBook.title} · 折纸文学`,text:'免费阅读 · 折纸文学',url});else{await navigator.clipboard.writeText(url);flash('章节链接已复制')}}
    catch(error){if(error.name!=='AbortError')await dialog('复制章节链接',`<label class="field"><span>选择并复制链接</span><input readonly value="${esc(url)}" aria-label="章节分享链接"></label>`)}
  }
  async function action(name,button){
    if(Author.handlesAction(name))return Author.action(name,button);
    const id=button?.dataset.id;
    switch(name){
      case 'home':return go({kind:'home',anchor:'home'});
      case 'author':return go({kind:'author'});
      case 'settings':case 'privacy':case 'terms':if($('#showcaseNotice').classList.contains('open'))closeNotice();return go({kind:name});
      case 'notice':return notice();
      case 'ack-notice':return closeNotice(true);
      case 'close-utility':return finishDialog('cancel');
      case 'search':await go({kind:'home',anchor:'books'});$('#librarySearch').focus();return;
      case 'detail':return go({kind:'detail',book:id});
      case 'close-detail':return back({kind:'home',anchor:'books'});
      case 'close-reader':case 'directory':{
        directoryRequested=name==='directory'&&!route.preview;
        const fallback=route.preview?{kind:'author',work:route.work,chapter:activeBook?.chapters[chapterIndex]?.id}:{kind:'detail',book:route.book};
        const from=history.state?.from?new URL(history.state.from,location.href):null;
        const correctParent=route.preview?from?.searchParams.get('view')==='author'&&from?.searchParams.get('work')===route.work:from?.searchParams.get('book')===route.book&&!from?.searchParams.has('chapter');
        return correctParent?back(fallback):go(fallback,{replace:true});
      }
      case 'resume':{const b=catalogBook(id);if(!b)return;const chapter=Math.min(readingRecord(id)?.chapterIndex||0,chaptersFor(b).length-1);return go({kind:'reader',book:id,chapter},{resume:true})}
      case 'chapter':return go({kind:'reader',book:id,chapter:Number(button.dataset.index)});
      case 'prev':case 'next':{if(!activeBook)return;const next=chapterIndex+(name==='next'?1:-1);if(next<0||next>=chaptersFor(activeBook).length)return;return go({...route,chapter:next},{replace:true})}
      case 'chapter-order':{const reverse=button.getAttribute('aria-pressed')!=='true';button.setAttribute('aria-pressed',String(reverse));button.textContent=reverse?'正序排列':'倒序排列';return renderChapterList()}
      case 'bookmark':return bookmark(id||activeBook?.id,button);
      case 'remove-book':{const row=Store.get().library.find(r=>r.id===id);Store.change(d=>{d.library=d.library.filter(r=>r.id!==id)});renderShelf();offerUndo('作品已移出书架',()=>{Store.change(d=>{if(!d.library.some(r=>r.id===id))d.library.push(row)});renderShelf()});return}
      case 'reset-filters':Object.assign(ui,{category:'全部',search:'',sort:'popular',page:1});renderHome();saveUI();return;
      case 'random':return go({kind:'detail',book:books[Math.floor(Math.random()*books.length)].id});
      case 'page':ui.page=Number(button.dataset.page);renderBooks();$('#books').scrollIntoView({behavior:document.documentElement.classList.contains('motion-off')?'instant':'smooth'});saveUI();return;
      case 'clear-history':{if(!Store.get().history.length)return flash('阅读记录还是空的。');const result=await dialog('清空阅读记录','<p class="notice-copy">此操作只清理阅读足迹，保留收藏和作者作品。</p>',[{value:'cancel',label:'取消'},{value:'clear',label:'清空记录',primary:true}]);if(result==='clear'){Store.clear(['history']);renderShelf();saved('阅读记录已清空')}return}
      case 'font-down':case 'font-up':return setSetting('fontSize',Store.get().settings.fontSize+(name==='font-up'?1:-1));
      case 'theme':{const themes=['paper','warm','night'];return setSetting('theme',themes[(themes.indexOf(Store.get().settings.theme)+1)%3])}
      case 'reading-settings':{const p=dialog('阅读设置',readingSettingsMarkup(),[{value:'ok',label:'完成',primary:true}]);applySettings();return p}
      case 'share':return share();
      case 'export':return exportBackup();
      case 'undo':{const fn=undoAction;dismissUndo();await fn?.();saved('已撤销删除');return}
      case 'dismiss-undo':return dismissUndo();
    }
  }
  document.addEventListener('click',event=>{
    const result=event.target.closest('[data-dialog-result]');if(result){event.preventDefault();finishDialog(result.dataset.dialogResult);return}
    const button=event.target.closest('[data-action]');if(button){event.preventDefault();if(!button.disabled)Promise.resolve(action(button.dataset.action,button)).catch(error=>{console.error(error);flash('操作未完成，请稍后重试。')});return}
    const pill=event.target.closest('[data-category]');if(pill){ui.category=pill.dataset.category;ui.page=1;renderHome();saveUI();$('#books').scrollIntoView({behavior:document.documentElement.classList.contains('motion-off')?'instant':'smooth'});return}
    const anchor=event.target.closest('a[href^="#"]');if(anchor){event.preventDefault();const hash=anchor.getAttribute('href').slice(1);go(hash==='author'?{kind:'author'}:{kind:'home',anchor:hash||'home'})}
    if(event.target.id==='utilityLayer')finishDialog('cancel');
  });
  document.addEventListener('input',event=>{
    const el=event.target;Author.input(event);
    if(el.id==='librarySearch'){ui.search=el.value.trim();ui.page=1;renderBooks();saveUI()}
    if(el.id==='chapterSearch')renderChapterList();
    if(el.id==='commentInput')$('#commentCount').textContent=`${el.value.length} / 300`;
    if(el.dataset.setting){const key=el.dataset.setting,value=key==='motion'?el.checked:['fontSize','lineHeight','width'].includes(key)?Number(el.value):el.value;setSetting(key,value)}
  });
  document.addEventListener('change',event=>{
    const el=event.target;Author.change(event);
    if(el.id==='bookSort'){ui.sort=el.value;ui.page=1;renderBooks();saveUI()}
    if(el.id==='shelfFilter'){ui.shelf=el.value;renderShelf();saveUI()}
    if(el.dataset.shelfId){Store.change(d=>{const row=d.library.find(r=>r.id===el.dataset.shelfId);if(row)row.status=el.value});saved('阅读状态已更新')}
    if(el.id==='readerChapterSelect')go({...route,chapter:Number(el.value)},{replace:true});
    if(el.id==='backupFile')importBackup(el.files[0]);
  });
  document.addEventListener('submit',event=>{
    const form=event.target;if(Author.submit(event))return;
    if(['librarySearchForm','commentForm','clearDataForm'].includes(form.id))event.preventDefault();
    if(form.id==='clearDataForm')clearData(form);
    if(form.id==='commentForm'&&activeBook&&!route.preview){const text=$('#commentInput').value.trim();if(!text)return flash('先写下你的读后感吧。');Store.change(d=>{const list=d.comments[activeBook.id]||[];list.unshift({id:Store.uuid(),text,createdAt:now()});d.comments[activeBook.id]=list.slice(0,30)});renderFeedback();saved('书评已保存到本机')}
  });
  $('#clearSearch').addEventListener('click',()=>{ui.search='';ui.page=1;$('#librarySearch').value='';renderBooks();saveUI();$('#librarySearch').focus()});
  $('#ratingPicker').addEventListener('click',e=>{const button=e.target.closest('[data-rating]');if(button&&activeBook&&!route.preview){Store.change(d=>{d.ratings[activeBook.id]=Number(button.dataset.rating)});const text=$('#commentInput').value;renderFeedback();$('#commentInput').value=text;$('#commentCount').textContent=`${text.length} / 300`;saved('评分已保存到本机')}});
  $('#readerLayer').addEventListener('scroll',()=>{if(restoring)return;updateProgressVisual();clearTimeout(progressTimer);progressTimer=setTimeout(saveProgress,350)},{passive:true});
  window.addEventListener('popstate',async event=>{
    if(skipPop){skipPop=false;return}
    const oldIndex=window.__zhezhiIndex||0,newIndex=event.state?.index||0;
    if(!await guardEditor()){skipPop=true;history.go(oldIndex-newIndex||1);return}
    await Author.leave();saveProgress();window.__zhezhiIndex=newIndex;renderRoute(parseRoute(),event.state||{});
  });
  window.addEventListener('beforeunload',event=>{saveProgress();Writer.pause();if(Author.hasUnsaved()){event.preventDefault();event.returnValue=''}});
  window.addEventListener('pagehide',()=>{saveProgress();Author.persist();Author.leave();saveUI()});
  document.addEventListener('visibilitychange',()=>{document.documentElement.classList.toggle('page-paused',document.hidden);if(document.hidden){saveProgress();Author.persist();Author.leave()}});
  document.addEventListener('compositionstart',event=>Author.composition(event,true));
  document.addEventListener('compositionend',event=>Author.composition(event,false));
  window.addEventListener('resize',applySettings);
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',applySettings);
  window.addEventListener('zhezhi-storage',storageStatus);
  document.addEventListener('keydown',event=>{
    const top=topLayer();
    if(Author.keydown(event))return;
    if(!top)return;
    if(event.key==='Escape'){event.preventDefault();if(top.id==='utilityLayer')finishDialog('cancel');else if(top.id==='showcaseNotice')closeNotice(true);else action(top.id==='readerLayer'?'close-reader':'close-detail');return}
    if(event.key==='Tab'){
      const items=[...top.querySelectorAll('a[href],button:not(:disabled),input,select,textarea,[tabindex="0"]')].filter(el=>el.getClientRects().length&&!el.closest('[inert]')),first=items[0],last=items.at(-1);if(!first)return;
      if(event.shiftKey&&(document.activeElement===first||!top.contains(document.activeElement))){event.preventDefault();last.focus()}
      else if(!event.shiftKey&&(document.activeElement===last||!top.contains(document.activeElement))){event.preventDefault();first.focus()}
    }
  });
  const hover=matchMedia('(hover: hover) and (pointer: fine)');
  document.addEventListener('pointermove',event=>{
    const cover=event.target.closest('.book-card .cover');if(!cover||!hover.matches||document.documentElement.classList.contains('motion-off'))return;
    const rect=cover.getBoundingClientRect(),x=(event.clientX-rect.left)/rect.width,y=(event.clientY-rect.top)/rect.height;
    cover.style.setProperty('--tilt-x',`${(0.5-y)*7}deg`);cover.style.setProperty('--tilt-y',`${(x-0.5)*8}deg`);cover.style.setProperty('--shine-x',`${x*100}%`);cover.style.setProperty('--shine-y',`${y*100}%`);
  },{passive:true});
  document.addEventListener('pointerout',event=>{const cover=event.target.closest('.book-card .cover');if(cover&&!cover.contains(event.relatedTarget)){cover.style.setProperty('--tilt-x','0deg');cover.style.setProperty('--tilt-y','0deg')}});
  // Track the active history index after application navigation too.
  const Backup=window.ZhezhiBackup.create({dialog,flash,saved,onMerged:()=>{renderSettings();if(route.kind==='author')Author.render(route);applySettings()}});
  const Author=window.ZhezhiAuthor.create({$,$$,esc,now,count,wordCount:window.ZhezhiUtils.wordCount,flash,saved,offerUndo,dialog,finishDialog,topLayer,go,observeReveals,getRoute:()=>route,setRoute:target=>{route=target},routeURL,exportBackup});
  const initial=parseRoute();history.replaceState({...history.state,zhezhi:true,index:history.state?.index||0},'',location.href);
  window.__zhezhiIndex=history.state.index;
  renderRoute(initial,history.state);storageStatus();
  if(Store.get().noticeVersion<2)notice();
  if(!catalogBook('jinli'))flash('演示连载未加载，其他示例仍可阅读，请联网刷新。');
  if('serviceWorker' in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('./sw.js').catch(()=>flash('离线缓存暂不可用，在线阅读不受影响。'));
})();
