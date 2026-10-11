/* Run with PLAYWRIGHT_PATH pointing to an installed Playwright package. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const root=path.resolve(__dirname,'..');
const artifacts=path.join(root,'.cache','acceptance');fs.mkdirSync(artifacts,{recursive:true});
const server=http.createServer((req,res)=>{
  let file=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\/-\//,'');
  if(!file||file==='/'||file==='index.html')file='index.html';
  if(!['index.html','sw.js','icon.svg','manifest.webmanifest','novel-data/jinli.js'].includes(file)&&!/^assets\/[\w.-]+\.(js|css)$/.test(file)){res.writeHead(404);return res.end()}
  const target=path.join(root,file);
  if(!fs.existsSync(target)){res.writeHead(404);return res.end()}
  const types={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
  res.writeHead(200,{'Content-Type':types[path.extname(file)]||'text/plain','Cache-Control':'no-store'});res.end(fs.readFileSync(target));
});
let browser;
const failures=[],checks=[];
async function check(name,fn){await fn();checks.push(name);console.log('PASS '+name)}
async function click(page,action){await page.locator(`[data-action="${action}"]:visible:not([inert] *)`).first().click()}
async function settle(page){await page.waitForTimeout(120)}
async function acknowledge(page){if(await page.locator('#showcaseNotice.open').count())await click(page,'ack-notice')}
async function data(page){return page.evaluate(()=>window.ZhezhiStore.get())}
async function verifyNoOverflow(page){assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'horizontal page overflow')}
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}/-/`;
  browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'chrome',headless:true});
  const context=await browser.newContext({viewport:{width:1280,height:900},acceptDownloads:true});
  const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',error=>failures.push(error.message));
  const external=[];page.on('request',request=>{if(!request.url().startsWith(base)&&!request.url().startsWith('data:'))external.push(request.url())});
  await context.addInitScript(()=>{
    if(!localStorage.getItem('zhezhi-local-v2')){
      localStorage.setItem('zhezhi-library',JSON.stringify(['b1']));
      localStorage.setItem('zhezhi-history',JSON.stringify([{id:'b1',chapterIndex:0,progress:42,readAt:'2026-10-10T10:00:00.000Z'}]));
      localStorage.setItem('zhezhi-drafts',JSON.stringify([{title:'旧草稿',description:'迁移测试',category:'日常',content:'旧章节正文',createdAt:'2026-10-10T10:00:00.000Z'}]));
    }
  });
  await page.goto(base);
  await check('legacy migration and first notice',async()=>{
    await page.locator('#showcaseNotice.open').waitFor();await acknowledge(page);
    const store=await data(page);assert.equal(store.library[0].id,'b1');assert.equal(store.history[0].progress,42);assert.equal(store.works[0].chapters[0].content,'旧章节正文');assert.equal(store.noticeVersion,2);
    assert.equal(await page.locator('.book-card').count(),6);await verifyNoOverflow(page);
    assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--paper').trim()),'#f8f3e9');
    assert.equal(await page.locator('#authorBtn').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(171, 90, 76)');
  });
  await check('cover/title routing and browser filter restoration',async()=>{
    await page.locator('#librarySearch').fill('春日');await page.locator('.cover-link').click();await page.locator('#bookDetailLayer.open').waitFor();assert.equal(await page.locator('.detail-copy h1').textContent(),'春日来信，请查收');
    await page.goBack();await settle(page);assert.equal(await page.locator('#librarySearch').inputValue(),'春日');assert.equal(await page.locator('.book-card').count(),1);
    await page.locator('.book-meta h3 a').click();await page.locator('#bookDetailLayer.open').waitFor();
    await page.evaluate(()=>{window.ZhezhiCatalog.books.find(b=>b.id==='b1').chapters=Array.from({length:3},(_,i)=>({title:`测试第 ${i+1} 章`,content:Array.from({length:30},()=>`春风穿过纸页。这是一段用于验证阅读进度的测试文字。`).join('\n\n')}))});
    await click(page,'resume');await page.locator('#readerLayer.open').waitFor();await settle(page);
  });
  await check('reader resume, explicit chapter start, stable theme progress',async()=>{
    await page.locator('#bookmarkBtn').click({clickCount:3});assert(!(await data(page)).library.some(r=>r.id==='b1'));await page.locator('#bookmarkBtn').click();assert((await data(page)).library.some(r=>r.id==='b1'));
    await page.evaluate(()=>{const layer=document.querySelector('#readerLayer');layer.scrollTop=(layer.scrollHeight-layer.clientHeight)*.37});await page.waitForTimeout(500);
    const before=(await data(page)).history.find(r=>r.id==='b1').progress;assert(before>10&&before<100);
    await click(page,'theme');await settle(page);assert(Math.abs((await data(page)).history.find(r=>r.id==='b1').progress-before)<3);
    await click(page,'close-reader');await page.locator('#bookDetailLayer.open').waitFor();await click(page,'resume');await page.locator('#readerLayer.open').waitFor();await settle(page);assert((await data(page)).history.find(r=>r.id==='b1').progress>10);
    await click(page,'close-reader');await page.locator('#bookDetailLayer.open').waitFor();await page.locator('[data-action="chapter"][data-index="0"]').click();await page.locator('#readerLayer.open').waitFor();await settle(page);assert.equal(await page.locator('#readerLayer').evaluate(el=>el.scrollTop),0);
    const initialLength=await page.evaluate(()=>history.length);await click(page,'next');await page.locator('#readerChapterSelect').selectOption('2');await settle(page);assert.equal(await page.evaluate(()=>history.length),initialLength);
    await click(page,'close-reader');await page.locator('#bookDetailLayer.open').waitFor();await click(page,'close-detail');await settle(page);
  });
  await check('shelf state, filtering, removal and undo',async()=>{
    await page.locator('[data-shelf-id="b1"]').selectOption('done');await page.locator('#shelfFilter').selectOption('want');assert.equal(await page.locator('[data-shelf-id="b1"]').count(),0);
    await page.locator('#shelfFilter').selectOption('done');await page.locator('[data-action="remove-book"][data-id="b1"]').click();assert.equal((await data(page)).library.length,0);await click(page,'undo');assert.equal((await data(page)).library[0].status,'done');
    await page.locator('#readingHistory [data-action="resume"]').click();await page.locator('#readerLayer.open').waitFor();await click(page,'directory');await page.locator('#bookDetailLayer.open').waitFor();await settle(page);assert.equal(await page.evaluate(()=>document.activeElement.id),'chapterSearch');await click(page,'close-detail');await settle(page);
  });
  let workId,chapterId;
  await check('author multi-chapter edit, auto-save, reorder and undo',async()=>{
    await click(page,'author');await page.locator('[data-action="edit-work"]').click();await page.locator('#workForm').waitFor();workId=(await data(page)).works[0].id;
    await page.locator('[name="content"]').fill('第一章新的正文\n\n自动保存测试。');await page.waitForTimeout(1200);assert.equal((await data(page)).works[0].chapters[0].content,'第一章新的正文\n\n自动保存测试。');
    await click(page,'add-chapter');await page.locator('[name="chapterTitle"]').fill('第二章');await page.locator('[name="content"]').fill('第二章测试正文');await page.waitForTimeout(1200);chapterId=(await data(page)).works[0].chapters[1].id;
    await page.locator(`[data-action="chapter-up"][data-id="${chapterId}"]`).click();await settle(page);assert.equal((await data(page)).works[0].chapters[0].id,chapterId);
    await page.locator(`[data-action="delete-chapter"][data-id="${chapterId}"]`).click();await settle(page);assert.equal((await data(page)).works[0].chapters.length,1);await click(page,'undo');assert.equal((await data(page)).works[0].chapters.length,2);
    await page.locator(`[data-action="edit-chapter"][data-id="${chapterId}"]`).click();await click(page,'preview');await page.locator('#readerLayer.open').waitFor();assert.equal(await page.locator('#readerByline').textContent(),'你的本地创作 · 本地私有预览 · 第 1 / 2 章');assert(await page.locator('#shareBook').isHidden());await click(page,'close-reader');await page.locator('#workForm').waitFor();
  });
  await check('unsaved editor navigation and browser back cancellation',async()=>{
    await page.locator('#workForm [name="description"]').fill('还在编辑');await page.locator('#authorContent [data-action="author"]').click();await page.locator('#utilityLayer.open').waitFor();await page.locator('[data-dialog-result="cancel"]').click();assert(await page.locator('#workForm').isVisible());await page.waitForTimeout(1200);
    await page.locator('#workForm [name="description"]').fill('后退取消测试');await page.goBack();await page.locator('#utilityLayer.open').waitFor();await page.locator('[data-dialog-result="cancel"]').click();await settle(page);assert(await page.locator('#workForm').isVisible());assert.equal(await page.locator('#workForm [name="description"]').inputValue(),'后退取消测试');await page.waitForTimeout(1200);
  });
  let backup;
  await check('backup export and durable refresh',async()=>{
    const downloadPromise=page.waitForEvent('download');await page.locator('.author-intro [data-action="export"]').click();const download=await downloadPromise;const file=await download.path();backup=JSON.parse(fs.readFileSync(file,'utf8'));assert.equal(backup.format,'zhezhi-literature-backup');assert.equal(backup.data.works[0].id,workId);
    await page.reload();await page.locator('#workForm').waitFor();assert.equal((await data(page)).works[0].chapters.length,2);
  });
  await check('reading preferences, animation switch and JSON import validation',async()=>{
    await click(page,'settings');await page.locator('#settingsPage').waitFor({state:'visible'});await page.locator('[data-setting="theme"]').selectOption('night');await page.locator('[data-setting="width"]').selectOption('800');await page.locator('[data-setting="fontSize"]').focus();await page.keyboard.press('End');await page.locator('[data-setting="motion"]').uncheck();assert.equal((await data(page)).settings.fontSize,25);assert(await page.locator('html').evaluate(el=>el.classList.contains('motion-off')));
    await page.locator('#backupFile').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{"not":"a backup"}')});await page.locator('#utilityLayer.open').waitFor();assert((await page.locator('#utilityContent').textContent()).includes('备份文件'));await page.locator('[data-dialog-result="ok"]').click();
    const incoming=JSON.parse(JSON.stringify(backup));incoming.data.works.push({id:'imported-work',title:'<img src=x onerror=alert(1)>',description:'',category:'日常',createdAt:'2026-10-12T00:00:00Z',updatedAt:'2026-10-12T00:00:00Z',chapters:[{id:'imported-chapter',title:'第一章',content:'导入正文'}]});
    await page.locator('#backupFile').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(incoming))});await page.locator('#utilityLayer.open').waitFor();assert((await data(page)).works.length===1);await page.locator('[data-dialog-result="merge"]').click();assert.equal((await data(page)).works.length,2);
    await page.locator('[name="clear"][value="works"]').check();await page.locator('#clearDataForm button').click();await page.locator('[data-dialog-result="clear"]').click();await page.locator('#utilityTitle').filter({hasText:'将删除作者'}).waitFor();await page.locator('[data-dialog-result="cancel"]').click();assert.equal((await data(page)).works.length,2);
    await click(page,'author');assert.equal(await page.locator('img').count(),0);
  });
  await check('policy links, keyboard focus and absent third-party requests',async()=>{
    await click(page,'privacy');await page.locator('#policyPage').waitFor({state:'visible'});assert((await page.locator('#policyPage').textContent()).includes('记录访问者 IP'));await click(page,'settings');await click(page,'notice');await page.keyboard.press('Tab');assert(await page.evaluate(()=>document.querySelector('#showcaseNotice').contains(document.activeElement)));await acknowledge(page);assert.deepEqual(external,[]);
  });
  await check('offline shell and cache-version cleanup',async()=>{
    await page.evaluate(async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}))});
    await page.goto(base);await acknowledge(page);await context.setOffline(true);await page.reload();assert.equal(await page.locator('.book-card').count(),6);await context.setOffline(false);
    assert((await page.evaluate(()=>caches.keys())).includes('zhezhi-literature-system-20261012'));
    const staleContext=await browser.newContext(),stalePage=await staleContext.newPage();await stalePage.route('**/assets/app.js*',r=>r.abort());await stalePage.goto(base);await stalePage.evaluate(()=>caches.open('zhezhi-literature-obsolete'));await stalePage.unroute('**/assets/app.js*');await stalePage.reload();await acknowledge(stalePage);await stalePage.evaluate(async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}))});assert(!(await stalePage.evaluate(()=>caches.keys())).includes('zhezhi-literature-obsolete'));await staleContext.close();
  });
  const mobile=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'}),mobilePage=await mobile.newPage();mobilePage.on('pageerror',e=>failures.push(e.message));
  await check('mobile layout, deep links, reduced motion and invalid chapters',async()=>{
    await mobilePage.goto(base+'?book=jinli&chapter=1');await acknowledge(mobilePage);await mobilePage.locator('#readerLayer.open').waitFor();await settle(mobilePage);await verifyNoOverflow(mobilePage);assert(await mobilePage.locator('html').evaluate(el=>el.classList.contains('motion-off')));assert.equal(await mobilePage.locator('#readerChapterSelect').inputValue(),'1');
    assert.equal(await mobilePage.locator('#readerLayer').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(248, 243, 233)');
    await mobilePage.screenshot({path:path.join(artifacts,'mobile-reader.png')});await click(mobilePage,'close-reader');await mobilePage.locator('#bookDetailLayer.open').waitFor();await verifyNoOverflow(mobilePage);await mobilePage.screenshot({path:path.join(artifacts,'mobile-detail.png')});await click(mobilePage,'close-detail');await settle(mobilePage);await mobilePage.screenshot({path:path.join(artifacts,'mobile-home.png'),fullPage:true});
    await mobilePage.goto(base+'?book=jinli&chapter=999');await mobilePage.locator('#bookDetailLayer.open').waitFor();await mobilePage.goto(base+'?book=missing');await mobilePage.locator('#bookGrid').waitFor();assert.equal(await mobilePage.locator('.book-card').count(),6);
    await click(mobilePage,'author');await click(mobilePage,'new-work');await mobilePage.locator('[name="content"]').fill('手机编辑测试');await mobilePage.waitForTimeout(1200);await verifyNoOverflow(mobilePage);await mobilePage.screenshot({path:path.join(artifacts,'mobile-author.png'),fullPage:true});
  });
  const blocked=await browser.newContext(),blockedPage=await blocked.newPage();blockedPage.on('pageerror',e=>failures.push(e.message));
  await blocked.addInitScript(()=>{Storage.prototype.setItem=function(){throw new DOMException('blocked','QuotaExceededError')}});
  await check('storage denial remains usable and backup recovers temporary work',async()=>{
    await blockedPage.goto(base);await acknowledge(blockedPage);assert(await blockedPage.locator('#storageWarning').isVisible());await click(blockedPage,'author');await click(blockedPage,'new-work');await blockedPage.locator('[name="content"]').fill('受限存储中的临时内容');await blockedPage.waitForTimeout(1200);assert.equal((await data(blockedPage)).works[0].chapters[0].content,'受限存储中的临时内容');assert((await blockedPage.locator('#saveStatus').textContent()).includes('暂存'));
    const dl=blockedPage.waitForEvent('download');await blockedPage.locator('.author-intro [data-action="export"]').click();const file=await(await dl).path();assert(JSON.parse(fs.readFileSync(file,'utf8')).data.works[0].chapters[0].content.includes('临时内容'));
  });
  const failed=await browser.newContext({serviceWorkers:'block'}),failedPage=await failed.newPage();failedPage.on('pageerror',e=>failures.push(e.message));await failedPage.route('**/novel-data/*',r=>r.abort());
  await check('missing chapter resource does not break the catalog',async()=>{await failedPage.goto(base);await acknowledge(failedPage);assert.equal(await failedPage.evaluate(()=>ZhezhiCatalog.books.length),10);assert.equal(await failedPage.locator('.book-card').count(),6)});
  await check('direct file preview and paused background effects',async()=>{
    const fileContext=await browser.newContext(),filePage=await fileContext.newPage();filePage.on('pageerror',error=>failures.push(error.message));await filePage.goto('file:///'+path.join(root,'index.html').replace(/\\/g,'/'));await acknowledge(filePage);await filePage.locator('.cover-link').first().click();await filePage.locator('#bookDetailLayer.open').waitFor();await click(filePage,'resume');await filePage.locator('#readerLayer.open').waitFor();await click(filePage,'close-reader');await filePage.locator('#bookDetailLayer.open').waitFor();
    await filePage.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))});assert(await filePage.locator('html').evaluate(el=>el.classList.contains('page-paused')));await fileContext.close();
  });
  await page.goto(base);await acknowledge(page);await page.screenshot({path:path.join(artifacts,'desktop-home.png'),fullPage:true});
  assert.deepEqual(failures,[],'browser errors');fs.writeFileSync(path.join(artifacts,'results.json'),JSON.stringify({checks,externalRequests:external,browserErrors:failures},null,2));
  console.log(`${checks.length} acceptance scenarios passed. Screenshots: ${artifacts}`);
})().catch(error=>{console.error(error);process.exitCode=1}).finally(async()=>{if(browser)await browser.close();server.close()});
