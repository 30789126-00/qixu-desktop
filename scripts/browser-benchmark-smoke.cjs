const {_electron}=require('playwright');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');

const root=path.resolve(__dirname,'..');
const runDir=path.resolve(root,'../test-runs','browser-benchmark-'+Date.now());
const dataDir=path.join(runDir,'data');
const installedExecutable=process.env.QIXU_EXECUTABLE||'';
fs.mkdirSync(runDir,{recursive:true});

let app=null,page=null,server=null;
const results=[];
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const api=(method,...args)=>page.evaluate(({method,args})=>window.moyu[method](...args),{method,args});
async function wait(fn,timeout=15000){const started=Date.now();while(Date.now()-started<timeout){try{if(await fn())return;}catch{}await pause(80);}throw new Error('Timed out');}
async function snapshot(){return api('getState');}
async function remoteByPath(pathname){return app.evaluate(async({webContents},pathname)=>{const wc=webContents.getAllWebContents().find(item=>{try{return new URL(item.getURL()).pathname===pathname;}catch{return false;}});if(!wc)return null;return {id:wc.id,url:wc.getURL(),muted:wc.isAudioMuted(),ua:await wc.executeJavaScript('navigator.userAgent'),media:await wc.executeJavaScript(`(()=>{const v=document.querySelector('video');return v?{paused:v.paused,time:v.currentTime,ready:v.readyState}:null})()`)};},pathname);}
async function setMedia(pathname,script){return app.evaluate(async({webContents},{pathname,script})=>{const wc=webContents.getAllWebContents().find(item=>{try{return new URL(item.getURL()).pathname===pathname;}catch{return false;}});if(!wc)throw new Error('remote not found '+pathname);return wc.executeJavaScript(script);},{pathname,script});}
async function launch(){const options={env:{...process.env,MOYU_TEST:'1',MOYU_DATA_DIR:dataDir}};if(installedExecutable){options.executablePath=installedExecutable;options.args=[];}else options.args=[root];app=await _electron.launch(options);page=await app.firstWindow();await page.waitForFunction(()=>!!window.moyu);await wait(async()=>(await snapshot()).todoReady);await app.evaluate(({app})=>app.emit('qixu:test-unlock'));await page.getByLabel('访问口令').waitFor();assert.equal(await api('submitPassword','WSAD'),true);await page.locator('.app-shell').waitFor();await api('updateSettings',{autoHide:false,autoTranslate:false,bilingualSubtitles:false});}

async function main(){
  const wave=Buffer.alloc(44+16000*30);wave.write('RIFF');wave.writeUInt32LE(wave.length-8,4);wave.write('WAVEfmt ',8);wave.writeUInt32LE(16,16);wave.writeUInt16LE(1,20);wave.writeUInt16LE(1,22);wave.writeUInt32LE(8000,24);wave.writeUInt32LE(16000,28);wave.writeUInt16LE(2,32);wave.writeUInt16LE(16,34);wave.write('data',36);wave.writeUInt32LE(wave.length-44,40);
  server=http.createServer((req,res)=>{
    if(req.url==='/media'){
      res.setHeader('Content-Type','audio/wav');res.setHeader('Accept-Ranges','bytes');
      const match=String(req.headers.range||'').match(/bytes=(\d+)-(\d*)/);
      if(match){const start=Math.min(wave.length-1,Number(match[1])||0),end=Math.min(wave.length-1,match[2]?Number(match[2]):wave.length-1);res.statusCode=206;res.setHeader('Content-Range',`bytes ${start}-${end}/${wave.length}`);res.setHeader('Content-Length',end-start+1);res.end(wave.subarray(start,end+1));}
      else{res.setHeader('Content-Length',wave.length);res.end(wave);}
      return;
    }
    const isB=req.url?.startsWith('/b');const title=isB?'Beta tab':'Alpha tab';const marker=isB?'BETA_FIND_TARGET':'ALPHA_FIND_TARGET';
    res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<!doctype html><html><head><title>${title}</title></head><body><div id="marker">${marker}</div><video controls src="/media"></video></body></html>`);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  await launch();
  const initial=await snapshot();await api('saveSources',[...initial.sources,{id:'benchmark-local',title:'本地标签验收',kind:'video',url:`${base}/a`,color:'#6574d9',abbr:'签'}]);

  await api('openSource','benchmark-local',`${base}/a`);await wait(async()=>!!(await remoteByPath('/a'))?.media?.ready);await page.locator('.content-tab').click();await wait(async()=>await page.locator('.web-host').count()===1);let state=await snapshot();assert.equal(state.browserTabs.length,1);const tabA=state.activeTabId;assert.ok(tabA);
  const aBefore=await remoteByPath('/a');const desktopUA=aBefore.ua;await api('mediaAction','play');await wait(async()=>!(await remoteByPath('/a')).media.paused);await setMedia('/a',`document.querySelector('video').currentTime=6`);await wait(async()=>(await remoteByPath('/a')).media.time>=5.5);

  await api('openSource','benchmark-local',`${base}/b`);await wait(async()=>!!(await remoteByPath('/b'))?.media?.ready);state=await snapshot();assert.equal(state.browserTabs.length,2);const tabB=state.activeTabId;assert.ok(tabB&&tabB!==tabA);const aHidden=await remoteByPath('/a');assert.equal(aHidden.id,aBefore.id);assert.equal(aHidden.media.paused,true);assert.equal(aHidden.muted,true);results.push({name:'打开第二标签不会销毁第一标签，后台标签自动暂停静音',pass:true});

  await api('switchBrowserTab',tabA);await wait(async()=>!(await remoteByPath('/a')).media.paused);const aRestored=await remoteByPath('/a');assert.equal(aRestored.id,aBefore.id);assert.ok(aRestored.media.time>=5.5);results.push({name:'切回原标签复用同一 WebContents，并恢复播放与原视频时间',pass:true});

  await page.locator('.home-tab').click();await wait(async()=>(await remoteByPath('/a')).media.paused);assert.equal(await page.locator('.video-home').count(),1);assert.equal((await remoteByPath('/a')).id,aBefore.id);await page.locator(`.browser-tab-shell.selected`).count().catch(()=>0);await page.locator('.browser-tab-shell').filter({hasText:'Alpha tab'}).locator('.browser-tab').click();await wait(async()=>!(await remoteByPath('/a')).media.paused);results.push({name:'主页标签只隐藏暂停网页，不销毁当前观看会话',pass:true});

  await api('toggleBrowserBookmark');state=await snapshot();assert.ok(state.browserBookmarks.some(entry=>entry.url===`${base}/a`));assert.ok(state.browserHistory.some(entry=>entry.url===`${base}/a`));assert.ok(state.browserHistory.some(entry=>entry.url===`${base}/b`));await api('findInPage','ALPHA_FIND_TARGET',true);await api('stopFindInPage');results.push({name:'书签、历史记录和页内查找接口可正常工作',pass:true});

  await api('setBrowserTabMobile',tabA,true);await wait(async()=>/Android|Mobile/.test((await remoteByPath('/a')).ua),20000);assert.equal((await snapshot()).browserTabs.find(tab=>tab.id===tabA).mobile,true);await api('setBrowserTabMobile',tabA,false);await wait(async()=>{const item=await remoteByPath('/a');return item&&item.ua===desktopUA;},20000);assert.equal((await snapshot()).browserTabs.find(tab=>tab.id===tabA).mobile,false);results.push({name:'手机模式可切换并可靠恢复原始桌面 UA',pass:true});

  await api('switchBrowserTab',tabB);await wait(async()=>(await snapshot()).activeTabId===tabB);await api('closeBrowserTab',tabB);await wait(async()=>(await snapshot()).activeTabId===tabA);assert.equal((await snapshot()).browserTabs.length,1);await api('closeBrowserTab',tabA);await wait(async()=>(await snapshot()).browserTabs.length===0);await wait(async()=>await page.locator('.video-home').count()===1);results.push({name:'关闭活动标签会切到相邻标签，关闭最后标签自动回主页',pass:true});
}

main().catch(error=>{results.push({name:'浏览器基准回归',pass:false,error:String(error.stack||error)});console.error(error);process.exitCode=1;}).finally(async()=>{if(app)await app.close().catch(()=>{});if(server)await new Promise(resolve=>server.close(resolve));const report=path.join(runDir,'report.json');fs.writeFileSync(report,JSON.stringify({results},null,2));console.log(JSON.stringify(results,null,2));console.log('Report:',report);});
