const { _electron }=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const root=path.resolve(__dirname,'..');const runDir=path.resolve(root,'../test-runs','reader-'+Date.now());fs.mkdirSync(runDir,{recursive:true});
const results=[];let app,page;
const api=(method,...args)=>page.evaluate(({method,args})=>window.moyu[method](...args),{method,args});
async function step(name,action){const start=Date.now();try{const detail=await action();results.push({name,pass:true,ms:Date.now()-start,detail});console.log('PASS',name,detail||'');}catch(e){results.push({name,pass:false,error:String(e.stack||e)});console.error('FAIL',name,e.message);throw e;}}
async function open(title){await page.locator('.book-open').filter({has:page.locator('strong',{hasText:title})}).first().click();await page.locator('.reader-loading').waitFor({state:'hidden',timeout:35000});const error=page.locator('.reader-error');if(await error.count())throw new Error(await error.innerText());}
async function back(){await page.getByTitle('返回书架',{exact:true}).click();await page.locator('.library-page,.books-grid').first().waitFor();}
async function main(){
  app=await _electron.launch({...(process.env.QIXU_EXECUTABLE?{executablePath:process.env.QIXU_EXECUTABLE,args:[]}:{args:[root]}),env:{...process.env,MOYU_TEST:'1',MOYU_DATA_DIR:path.join(runDir,'data')},timeout:30000});page=await app.firstWindow();
  page.on('pageerror',e=>fs.appendFileSync(path.join(runDir,'renderer-errors.log'),String(e.stack||e)+'\n'));
  await page.waitForFunction(()=>!!window.moyu);for(let i=0;i<100&&!(await api('getState')).todoReady;i++)await page.waitForTimeout(100);await app.evaluate(({app})=>app.emit('qixu:test-unlock'));await api('submitPassword','WSAD');await api('updateSettings',{autoHide:false,theme:'light',alwaysOnTop:true,autoTranslate:false,bilingualSubtitles:false});
  await api('setSection','library');
  await api('importBooks',[path.join(root,'fixtures/sample-utf8.txt'),path.join(root,'fixtures/sample.epub'),path.join(root,'fixtures/hundreds-chapters.epub'),path.resolve(root,'../test-fixtures/large-20mb-utf8.txt'),path.resolve(root,'../test-fixtures/large-20mb-gb18030.txt'),path.resolve(root,'../test-fixtures/long-paragraph.txt')].filter(fs.existsSync));
  await step('20MB TXT 首屏、虚拟渲染、搜索和书签',async()=>{
    const start=Date.now();await open('large-20mb-utf8');const firstPaintMs=Date.now()-start;
    const visible=await page.locator('.reader-paragraph').count();assert.ok(visible>0&&visible<80);
    await page.getByTitle('搜索全文',{exact:true}).click();await page.locator('.reader-search input').fill('天光');await page.waitForFunction(()=>document.querySelector('.reader-panel-hint')?.textContent.includes('找到'));
    assert.ok(await page.locator('.reader-search-hit').count()>0);await page.getByTitle('关闭面板',{exact:true}).click();
    await page.getByTitle('我的书签',{exact:true}).click();await page.locator('.reader-add-mark').click();assert.equal(await page.locator('.reader-bookmark').count(),1);await page.getByTitle('关闭面板',{exact:true}).click();
    await page.screenshot({path:path.join(runDir,'reader-txt.png')});return {firstPaintMs,mountedParagraphs:visible};
  });
  await step('TXT 自动滚动帧耗时与隐藏暂停',async()=>{
    await page.locator('.reader-auto').click();
    const timing=await page.evaluate(duration=>new Promise(resolve=>{let last=0;const samples=[];const start=performance.now();function frame(now){if(last)samples.push(now-last);last=now;if(now-start<duration)requestAnimationFrame(frame);else{samples.sort((a,b)=>a-b);resolve({frames:samples.length,p95:samples[Math.floor(samples.length*.95)],max:samples.at(-1),scrollTop:document.querySelector('.reader-text-scroll').scrollTop,mountedParagraphs:document.querySelectorAll('.reader-paragraph').length,duration});}}requestAnimationFrame(frame);}),Number(process.env.QIXU_SCROLL_TEST_MS)||60000);
    assert.ok(timing.scrollTop>100);assert.ok(timing.mountedParagraphs<80);
    await page.locator('.reader-auto').click();const top=await page.locator('.reader-text-scroll').evaluate(el=>el.scrollTop);await api('windowAction','hide');await page.waitForTimeout(600);assert.equal(await page.locator('.reader-text-scroll').evaluate(el=>el.scrollTop),top);await api('windowAction','restore');
    assert.equal(await page.locator('.reader-auto').innerText(),'自动滚动');return timing;
  });
  await step('TXT 排版变更保持阅读段落且重开恢复进度',async()=>{
    const before=await page.locator('.reader-text-scroll').evaluate(el=>el.scrollTop);await api('updateSettings',{fontSize:24,lineHeight:2.1});await page.waitForTimeout(500);
    assert.ok(await page.locator('.reader-text-scroll').evaluate(el=>el.scrollTop)>0);await back();await open('large-20mb-utf8');const after=await page.locator('.reader-text-scroll').evaluate(el=>el.scrollTop);assert.ok(after>0);return {before,after};
  });
  await back();
  await step('GB18030 和超长段落可读且节点有界',async()=>{
    for(const title of ['large-20mb-gb18030','long-paragraph']){if(!(await api('getState')).books.some(b=>b.title===title))continue;await open(title);assert.ok(await page.locator('.reader-paragraph').count()<80);assert.ok((await page.locator('.reader-text-scroll').innerText()).length>20);await back();}
  });
  await step('EPUB 连续阅读、目录、搜索、书签和自动滚动',async()=>{
    const start=Date.now();await open('sample');const firstPaintMs=Date.now()-start;
    assert.ok(await page.locator('.reader-epub-host iframe').count()>0);
    await page.getByTitle('目录',{exact:true}).click();assert.equal(await page.locator('.reader-list-item').count(),3);await page.locator('.reader-list-item').nth(1).click();
    await page.getByTitle('搜索全文',{exact:true}).click();await page.locator('.reader-search input').fill('午后的光');await page.waitForFunction(()=>document.querySelector('.reader-panel-hint')?.textContent.includes('找到'),null,{timeout:15000});assert.ok(await page.locator('.reader-search-hit').count()>0);await page.getByTitle('关闭面板',{exact:true}).click();
    await page.getByTitle('我的书签',{exact:true}).click();await page.locator('.reader-add-mark').click();assert.equal(await page.locator('.reader-bookmark').count(),1);await page.getByTitle('关闭面板',{exact:true}).click();
    await page.locator('.reader-auto').click();await page.waitForTimeout(1200);const top=await page.locator('.epub-container').evaluate(el=>el.scrollTop);assert.ok(top>0);await page.locator('.reader-auto').click();await page.screenshot({path:path.join(runDir,'reader-epub.png')});await back();return {firstPaintMs,scrollTop:top};
  });
  await step('360章 EPUB 首屏和目录完整',async()=>{const start=Date.now();await open('hundreds-chapters');const firstPaintMs=Date.now()-start;await page.getByTitle('目录',{exact:true}).click();assert.equal(await page.locator('.reader-list-item').count(),360);await page.getByTitle('关闭面板',{exact:true}).click();await back();return {firstPaintMs};});
  await step('窄窗口布局和深色设置',async()=>{await api('setSection','settings');await api('updateSettings',{theme:'dark'});await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(460,540));await page.waitForTimeout(200);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));await page.screenshot({path:path.join(runDir,'settings-narrow.png')});});
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(app)await app.close().catch(()=>{});fs.writeFileSync(path.join(runDir,'report.json'),JSON.stringify({runDir,results,passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length},null,2));console.log('Report:',path.join(runDir,'report.json'));});
