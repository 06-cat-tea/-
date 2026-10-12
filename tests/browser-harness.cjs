const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const root=path.resolve(__dirname,'..'),artifacts=path.join(root,'.cache','acceptance');
fs.mkdirSync(artifacts,{recursive:true});
function createServer(){return http.createServer((req,res)=>{
  let file=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\/-\//,'');
  if(!file||file==='/'||file==='index.html')file='index.html';
  if(!['index.html','sw.js','icon.svg','manifest.webmanifest','novel-data/jinli.js'].includes(file)&&!/^assets\/[\w.-]+\.(js|css)$/.test(file)){res.writeHead(404);return res.end()}
  const target=path.join(root,file);if(!fs.existsSync(target)){res.writeHead(404);return res.end()}
  const types={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
  res.writeHead(200,{'Content-Type':types[path.extname(file)]||'text/plain','Cache-Control':'no-store'});res.end(fs.readFileSync(target));
});}
async function click(page,action){if(!await page.locator(`[data-action="${action}"]:visible:not([inert] *)`).count()&&await page.locator(`#writerMore [data-action="${action}"]`).count())await page.locator('#writerMore summary').click();await page.locator(`[data-action="${action}"]:visible:not([inert] *)`).first().click();if(['author','new-work','save-work','edit-work','edit-chapter','add-chapter','chapter-up','chapter-down','delete-chapter','undo','pin-note','studio-new-person','studio-new-shadow','studio-delete-person','backup-snooze','resume-relink'].includes(action))await page.evaluate(()=>window.__zhezhiAction?.catch(()=>{}))}
async function acknowledge(page){if(await page.locator('#showcaseNotice.open').count())await click(page,'ack-notice')}
async function data(page){return page.evaluate(async()=>{if(['author','new-work','save-work','edit-work','edit-chapter','add-chapter','chapter-up','chapter-down','delete-chapter','undo','pin-note','studio-new-person','studio-new-shadow','studio-delete-person','resume-relink'].includes(window.__zhezhiActionName))await window.__zhezhiAction?.catch(()=>{});await window.ZhezhiAuthorSession?.settled();await ZhezhiStore.settled();return ZhezhiStore.get()})}
async function verifyNoOverflow(page){assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'horizontal page overflow')}
async function download(page,action){const pending=page.waitForEvent('download');await click(page,action);return fs.readFileSync(await(await pending).path())}
async function mergeBackup(page){await page.locator('[data-dialog-result="merge"]').click();await page.waitForFunction(()=>document.body.dataset.backupBusy!=='true');}
module.exports={createServer,root,artifacts,chromium,click,acknowledge,data,verifyNoOverflow,download,mergeBackup};
