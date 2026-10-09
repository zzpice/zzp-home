// Controlled images and adult entries: never depend on the owner's inventory size.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
module.exports = async function preferences(browser, label, origin, repo) {
 const image=fs.readFileSync(path.join(repo,'icons/gallery-fuji.webp'));
 const sampleItems=['alpha','beta'].map(name=>({path:`wallpapers/landscape/1920x1080/${name}.jpg`,title:name,width:1920,height:1080,device:'desktop',sha:name[0].repeat(40),background:`app/previews/${name}-background-1234567890.webp`}));
 for(const width of [1440,390]) {
  let items=sampleItems.slice();
  const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'}), page=await context.newPage(), requests=[], errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await context.route('https://zzpice.github.io/assets/**',route=>{
   requests.push(route.request().url());
   if(route.request().url().endsWith('/index.json')) return route.fulfill({contentType:'application/json',body:JSON.stringify({version:1,wallpapers:items})});
   return route.fulfill({contentType:'image/webp',body:image});
  });
  const retiredRequests=[];page.on('request',request=>{if(new URL(request.url()).hostname==='www.bing.com')retiredRequests.push(request.url());});
  page.on('dialog',dialog=>dialog.accept());
  // Use a controlled adult entry while retaining the editor's complete configuration.
  await context.route('**/index.html',route=>route.continue());
  await page.goto(origin+'/');
  await page.waitForFunction(()=>document.querySelector('#wallpaper-status').textContent.includes('已使用原有背景'));
  assert.equal(await page.locator('#wallpaper-image').isHidden(),true);
  assert.equal(requests.length,0,'default off does not request wallpapers');
  await page.evaluate(()=>{localStorage.setItem('zzp-home-wallpaper',JSON.stringify({mode:'bing',path:''}));localStorage.setItem('zzp-home-theme','dark');});
  await page.reload();
  await page.waitForFunction(()=>document.documentElement.dataset.wallpaper==='on');
  assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('zzp-home-wallpaper')).mode),'daily');
  assert.equal(await page.locator('#wallpaper-mode option[value=bing]').count(),0);
  assert.deepEqual(retiredRequests,[]);
  await page.evaluate(()=>{
   const boot=JSON.parse(document.querySelector('#bootstrap').textContent);
   const adult={...boot.config.groups[0].sites[0],id:'adult-browser-sample',title:'受控成人样本',pinned:true,icon:''};
   const config=structuredClone(boot.config);config.groups.push({id:'adult',title:'成人内容',sites:[adult]});
   window.preferenceFixture=config;
  });
  if(!await page.locator('#edit').isVisible())await page.locator('#browse-settings').click();
  await page.locator('#edit').click();
  await page.locator('.editor-dialog[open]').waitFor();
  const config=await page.evaluate(()=>window.preferenceFixture);
  await page.locator('#import-file').setInputFiles({name:'navigation.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(config))});
  await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('已导入'));
  await page.locator('[data-action=preview]').click();
  await page.locator('#browse-settings').click();
  assert.equal(await page.locator('#show-adult').isChecked(),false);
  await page.locator('#close-browse-settings').click();
  assert.equal(await page.locator('#groups [data-group=adult]').count(),0);
  await page.locator('#search').fill('受控成人样本');
  assert.equal(await page.locator('#navigation-content .site-card:visible').count(),0);
  await page.locator('#browse-settings').click();await page.locator('#show-adult').check();await page.locator('#close-browse-settings').click();
  assert.equal(await page.locator('#navigation-content .site-card:visible').count(),1);
  await page.locator('#clear-filter').click();
  await page.locator('#browse-settings').click();
  await page.locator('#show-adult').uncheck();
  await page.locator('#wallpaper-mode').selectOption('fixed');
  await page.locator('#wallpaper-fixed').selectOption(items[0].path);
  await page.waitForFunction(()=>document.querySelector('#wallpaper-status').textContent.includes('alpha'));
  const tab=await context.newPage();await tab.goto(origin+'/projects/');
  await tab.waitForFunction(()=>document.querySelector('#wallpaper-status').textContent.includes('alpha'));
  assert.equal(await tab.evaluate(()=>JSON.parse(localStorage.getItem('zzp-home-wallpaper')).path),items[0].path);
  const bounds=await page.evaluate(()=>({wallpaper:document.querySelector('.wallpaper-layer').getBoundingClientRect().bottom,search:document.querySelector('.browse-toolbar').getBoundingClientRect().top}));
  assert.ok(bounds.wallpaper<=bounds.search,'wallpaper stays above the search area');
  if(process.env.SCREENSHOT_DIR && label==='Chromium') {
   await page.locator('#close-browse-settings').click();
   await page.screenshot({path:path.join(process.env.SCREENSHOT_DIR,`home-${width}-dark.png`)});
   await page.locator('#browse-settings').click();await page.locator('#appearance').selectOption('light');
   await page.locator('#close-browse-settings').click();
   await page.screenshot({path:path.join(process.env.SCREENSHOT_DIR,`home-${width}-light.png`)});
   await page.locator('#browse-settings').click();
  }
  await page.locator('#wallpaper-mode').selectOption('off');assert.equal(await page.locator('#wallpaper-image').isHidden(),true);
  await page.locator('#wallpaper-mode').selectOption('fixed');
  await page.waitForFunction(()=>document.documentElement.dataset.wallpaper==='on');
  await context.setOffline(true);
  await page.locator('#wallpaper-fixed').selectOption(items[1].path);
  await page.waitForFunction(()=>document.documentElement.dataset.wallpaper==='on');
  await context.setOffline(false);
  assert.ok(requests.filter(url=>url.endsWith('/index.json')).length<=1,'both pages share the cached static index');
  // A freshly deployed index must retire a removed fixed selection on both pages.
  items=items.filter(item=>item.path!==sampleItems[1].path);
  const refreshIndex=()=>page.evaluate(async()=>{
   const entry=document.querySelector('script[type=module]').src;
   const wallpaper=await import(new URL('wallpaper.js',entry).href);
   await wallpaper.loadWallpaperIndex(true);
   document.dispatchEvent(new Event('visibilitychange'));
  });
  await refreshIndex();
  await page.waitForFunction(()=>document.querySelector('#wallpaper-status').textContent.includes('原壁纸已移除'));
  await tab.waitForFunction(()=>document.querySelector('#wallpaper-status').textContent.includes('原壁纸已移除'));
  // Derivative recipes may change without changing the original image SHA.
  items=[{...items[0],background:'app/previews/alpha-background-9876543210.webp'}];
  await refreshIndex();
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('zzp-home-wallpaper-last')).url.endsWith('9876543210.webp'));
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('zzp-home-wallpaper')).path),sampleItems[1].path,'a temporarily unavailable fixed choice is retained');
  assert.ok(requests.every(url=>url.endsWith('/index.json')||url.includes('/app/previews/')),'no wallpaper originals are loaded');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(errors,[]);await context.close();
 }
 console.log(label+': local wallpaper modes, page sharing, adult visibility and offline image fallback passed');
};
