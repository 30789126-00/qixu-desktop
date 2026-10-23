/* Offline Electron acceptance suite. Build first: npm run build && node scripts/smoke.cjs */
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const root = path.resolve(__dirname, '..');
const runDir = path.resolve(root, '..', 'test-runs', new Date().toISOString().replace(/[:.]/g, '-'));
const dataDir = path.join(runDir, 'app-data');
fs.mkdirSync(runDir, { recursive: true });
const results = [];
let app, page, server, base;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function eventually(fn, timeout=8000) {
  const start = Date.now(); let last;
  while(Date.now()-start<timeout) { try { const value=await fn(); if(value)return value; }catch(e){last=e;} await delay(75); }
  throw last || new Error('Condition not reached within '+timeout+' ms');
}
async function test(name, action) {
  const start = Date.now();
  try { const detail=await action();results.push({name,pass:true,ms:Date.now()-start,...(detail?{detail}:{})}); console.log('PASS',name); }
  catch(error) { results.push({name,pass:false,ms:Date.now()-start,error:String(error.stack||error)}); console.error('FAIL',name,error.message); throw error; }
}
const state = () => page.evaluate(()=>window.moyu.getState());
const api = (method,...args) => page.evaluate(async ({method,args})=>window.moyu[method](...args),{method,args});
const winInfo = () => app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('file:'));return {bounds:w.getBounds(),visible:w.isVisible(),minimized:w.isMinimized(),fullscreen:w.isFullScreen(),opacity:w.getOpacity(),alwaysOnTop:w.isAlwaysOnTop()};});
const remote = (code,route='/media')=>app.evaluate(async ({webContents},{base,code,route})=>{const wc=webContents.getAllWebContents().find(w=>w.getURL().startsWith(base+route));if(!wc)throw new Error('Remote page is not ready');return await wc.executeJavaScript(code,true);},{base,code,route});
const remoteMuted = (route='/media')=>app.evaluate(({webContents},{base,route})=>{const wc=webContents.getAllWebContents().find(w=>w.getURL().startsWith(base+route));return wc?.isAudioMuted();},{base,route});
async function cursor(where) {
  await app.evaluate(({BrowserWindow,screen},where)=>{
    const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('file:'));const r=w.getBounds();
    globalThis.__moyuTestCursor=where==='inside'?{x:r.x+40,y:r.y+40}:{x:r.x+r.width+100,y:r.y+r.height+100};
    screen.getCursorScreenPoint=()=>globalThis.__moyuTestCursor;
  },where);
}
function wav() {
  const rate=8000, samples=rate*60, b=Buffer.alloc(44+samples*2);
  b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVE',8);b.write('fmt ',12);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(samples*2,40);
  // A very quiet sine keeps audio decoding real while avoiding disruptive test sound.
  for(let n=0;n<samples;n++)b.writeInt16LE(Math.round(10*Math.sin(n*2*Math.PI*220/rate)),44+n*2);
  return b;
}
async function startServer() {
  const sound=wav();
  server=http.createServer((req,res)=>{
    if(req.url.startsWith('/tone.wav')) {res.setHeader('Content-Type','audio/wav');res.end(sound);return;}
    if(req.url.startsWith('/bad')) {res.destroy();return;}
    const popup=req.url.startsWith('/popup');
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.end(`<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><title>摸鱼离线媒体验收</title></head><body style="margin:0;background:#172536;color:white;font:20px sans-serif"><h1>离线媒体验收</h1><video id="player" controls loop ${popup?'autoplay':''} style="width:90%;height:300px" src="/tone.wav"></video><p>测试静音、暂停与窗口内全屏。</p><button onclick="document.querySelector('video').requestFullscreen()">网页全屏</button></body></html>`);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${server.address().port}`;
}
async function launch() {
  app=await electron.launch({args:[root],env:{...process.env,MOYU_TEST:'1',MOYU_DATA_DIR:dataDir},timeout:30000});
  app.process().stderr?.on('data',data=>fs.appendFileSync(path.join(runDir,'electron-stderr.log'),data));
  page=await app.firstWindow();
  page.on('pageerror',error=>fs.appendFileSync(path.join(runDir,'renderer-errors.log'),String(error.stack||error)+'\n'));
  await page.waitForFunction(()=>!!window.moyu);
  await api('updateSettings',{autoHide:false});await cursor('inside');
  await eventually(async()=>await page.locator('body').innerText().then(t=>t.length>20));
}
async function main() {
  await startServer();await launch();
  let imported, before;
  await test('本地界面启动，默认尺寸及内容来源',async()=>{
    const s=await state(),w=await winInfo();const area=await app.evaluate(({screen})=>screen.getPrimaryDisplay().workArea);assert.equal(s.settings.opacity,1);assert.equal(w.bounds.width,Math.min(960,area.width));assert.equal(w.bounds.height,Math.min(680,area.height));
    for(const id of ['douyin','bilibili','youtube'])assert.ok(s.sources.some(x=>x.id===id));
    assert.equal(s.activeSourceId,null);await page.screenshot({path:path.join(runDir,'home.png')});
  });
  await test('窗口透明度、置顶和设置参数',async()=>{
    await api('updateSettings',{opacity:0.62,alwaysOnTop:true,theme:'dark',scrollSpeed:38});const w=await winInfo();assert.ok(Math.abs(w.opacity-0.62)<0.02);assert.equal(w.alwaysOnTop,true);
    assert.equal((await state()).settings.scrollSpeed,38);await api('updateSettings',{opacity:1,alwaysOnTop:false,theme:'light'});
  });
  await test('离线媒体来源、隔离权限和播放',async()=>{
    const s=await state();await api('saveSources',[...s.sources,{id:'offline-test',title:'离线验收',url:base+'/media',kind:'video',color:'#3878ed',abbr:'测'}]);
    await api('openSource','offline-test');await eventually(()=>remote('document.querySelector("video")?.readyState>=2'));
    assert.deepEqual(await remote('({bridge:typeof window.moyu,node:typeof require})'),{bridge:'undefined',node:'undefined'});
    await api('mediaAction','play');await eventually(()=>remote('!document.querySelector("video").paused'));
    assert.equal(await remoteMuted(),false);
    await assert.rejects(api('navigate','url','javascript:alert(1)'));
    await assert.rejects(api('navigate','url','file:///C:/Windows/win.ini'));
  });
  await test('统一全屏和网页全屏都保持原窗口尺寸',async()=>{
    before=(await winInfo()).bounds;
    for(let n=0;n<3;n++){
      await api('mediaAction','fullscreen',true);await eventually(async()=>(await state()).fullscreen);assert.deepEqual((await winInfo()).bounds,before);assert.equal((await winInfo()).fullscreen,false);
      if(n===0){await page.waitForTimeout(200);await page.keyboard.press('Escape');}else await api('mediaAction','fullscreen',false);await eventually(async()=>!(await state()).fullscreen);assert.deepEqual((await winInfo()).bounds,before);
    }
    await remote('document.querySelector("video").requestFullscreen().catch(()=>{});true');await eventually(async()=>(await state()).fullscreen);
    assert.deepEqual((await winInfo()).bounds,before);await remote('document.exitFullscreen().catch(()=>{});true');await eventually(async()=>!(await state()).fullscreen);assert.deepEqual((await winInfo()).bounds,before);
  });
  await test('紧急隐藏立即静音暂停，鼠标经过不会恢复',async()=>{
    await api('mediaAction','play');await eventually(()=>remote('!document.querySelector("video").paused'));
    await api('windowAction','hide');assert.equal(await remoteMuted(),true);assert.equal((await winInfo()).visible,false);
    await eventually(()=>remote('document.querySelector("video").paused'));assert.equal((await state()).windowState,'panicHidden');
    await cursor('inside');await delay(800);assert.equal((await winInfo()).visible,false);
    await api('windowAction','restore');await eventually(()=>remote('!document.querySelector("video").paused'));assert.equal(await remoteMuted(),false);
  });
  await test('用户暂停和静音选择在隐藏恢复后保留',async()=>{
    await api('mediaAction','pause');await api('mediaAction','mute',true);await api('windowAction','hide');await api('windowAction','restore');await delay(300);
    assert.equal(await remote('document.querySelector("video").paused'),true);assert.equal(await remoteMuted(),true);await api('mediaAction','mute',false);
  });
  await test('鼠标移出自动隐藏，回到原区域停留半秒恢复',async()=>{
    await api('updateSettings',{autoHide:true});await cursor('inside');await delay(900);await api('mediaAction','play');await eventually(()=>remote('!document.querySelector("video").paused'));
    const start=Date.now();await cursor('outside');await eventually(async()=>(await state()).windowState==='autoHidden',3000);const hideMs=Date.now()-start;
    assert.equal(await remoteMuted(),true);await eventually(()=>remote('document.querySelector("video").paused'));
    await cursor('inside');await delay(200);assert.equal((await winInfo()).visible,false);await eventually(async()=>(await state()).windowState==='visible',3000);
    await eventually(()=>remote('!document.querySelector("video").paused'));await api('updateSettings',{autoHide:false});return {observedHideMs:hideMs};
  });
  await test('隐藏期间动态创建媒体及新页面均被静音暂停',async()=>{
    await api('windowAction','hide');await remote('(()=>{const v=document.createElement("video");v.id="late";v.src="/tone.wav";v.autoplay=true;document.body.append(v);return true})()');
    await eventually(()=>remote('document.querySelector("#late").readyState>=2'));await eventually(()=>remote('Array.from(document.querySelectorAll("video")).every(v=>v.paused)'));assert.equal(await remoteMuted(),true);
    await api('navigate','url',base+'/media?hidden=1');await eventually(()=>remote('document.readyState==="complete"'));assert.equal(await remoteMuted(),true);await api('windowAction','restore');
  });
  await test('切换到书架时暂停媒体',async()=>{
    await api('mediaAction','play');await eventually(()=>remote('!document.querySelector("video").paused'));await api('setSection','library');await eventually(()=>remote('document.querySelector("video").paused'));assert.equal(await remoteMuted(),true);
  });
  await test('TXT、EPUB、20MB文本、超长段及360章EPUB导入与重复去重',async()=>{
    const fixtures=['sample-utf8.txt','sample-utf16.txt','sample-gb18030.txt','sample.epub','hundreds-chapters.epub'].map(f=>path.join(root,'fixtures',f)).filter(fs.existsSync);
    const large=['large-20mb-utf8.txt','large-20mb-gb18030.txt','long-paragraph.txt'].map(f=>path.resolve(root,'../test-fixtures',f)).filter(fs.existsSync);
    const start=Date.now();imported=await api('importBooks',[...fixtures,...large]);assert.equal(imported.length,fixtures.length+large.length);const importMs=Date.now()-start;
    const count=(await state()).books.length;await api('importBooks',[fixtures[0]]);assert.equal((await state()).books.length,count);
    const txt=imported.find(b=>b.title==='sample-utf8');const bytes=await api('getBookContent',txt.id);assert.ok(Object.values(bytes).length>100);
    return {count,importMs,totalBytes:imported.reduce((n,b)=>n+b.size,0)};
  });
  await test('损坏、空文件和不存在文件报错，不污染书库',async()=>{
    const count=(await state()).books.length;
    const importedBad=await api('importBooks',[path.join(root,'fixtures/broken.epub'),path.join(root,'fixtures/broken-zip.epub'),path.join(root,'fixtures/epub-missing-package.epub'),path.join(root,'fixtures/empty.txt'),path.join(root,'fixtures/missing.txt')]);assert.equal(importedBad.length,0);assert.equal((await state()).books.length,count);assert.match((await state()).notice,/未导入/);
  });
  await test('进度、书签和阅读设置保存',async()=>{
    const book=imported.find(b=>b.title==='sample-utf8');
    await api('saveBook',book.id,{progress:{position:'txt:3:0',percent:.42},bookmarks:[{id:'smoke-bookmark',label:'离线验收书签',position:'txt:3:0',percent:.42}]});
    await api('updateSettings',{fontSize:24,lineHeight:2,readerWidth:720,readerTheme:'sepia',scrollSpeed:38,autoHide:false});await delay(600);
    assert.ok(fs.existsSync(path.join(dataDir,'state.json')));await page.screenshot({path:path.join(runDir,'library.png')});
  });
  await test('鼠标尚未进入时，通过快捷键或托盘恢复不会立刻隐藏',async()=>{
    await api('updateSettings',{autoHide:true});await cursor('outside');await api('windowAction','hide');await api('windowAction','restore');await delay(1200);assert.equal((await state()).windowState,'visible');assert.equal((await winInfo()).visible,true);await api('updateSettings',{autoHide:false});
  });
  await test('手动最小化不会因鼠标经过自动恢复',async()=>{
    await api('updateSettings',{autoHide:true});await api('windowAction','minimize');await cursor('inside');await delay(800);assert.equal((await state()).windowState,'minimized');assert.equal((await winInfo()).minimized,true);
    await api('windowAction','restore');await api('updateSettings',{autoHide:false});
  });
  await test('重启后书库、书签、阅读设置和窗口尺寸持久化',async()=>{
    await app.close();app=null;await launch();const s=await state();const book=s.books.find(b=>b.title==='sample-utf8');assert.ok(book);assert.equal(book.progress.percent,.42);assert.equal(book.bookmarks[0].label,'离线验收书签');assert.equal(s.settings.fontSize,24);assert.equal(s.settings.scrollSpeed,38);assert.deepEqual((await winInfo()).bounds,before);
  });
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
  if(app)await app.close().catch(()=>{});if(server)await new Promise(resolve=>server.close(resolve));
  const report={generatedAt:new Date().toISOString(),scope:'Offline local fixtures; no claim of live platform playback, multi-monitor hardware, login, or long-duration performance validation.',runDir,passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,results};
  fs.writeFileSync(path.join(runDir,'report.json'),JSON.stringify(report,null,2));console.log('Report:',path.join(runDir,'report.json'));
});
