const {_electron}=require('playwright');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),runDir=path.resolve(root,'../test-runs','platforms-'+Date.now());
fs.mkdirSync(runDir,{recursive:true});
let app,page;const results=[];const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const api=(method,...args)=>page.evaluate(({method,args})=>window.moyu[method](...args),{method,args});
async function inspect(){
 return app.evaluate(async({webContents})=>{
  const wc=webContents.getAllWebContents().find(w=>w.getURL().startsWith('http'));if(!wc)return null;
  return wc.executeJavaScript("({title:document.title,url:location.href,text:document.body?.innerText.slice(0,800),targets:[...new Set([...document.querySelectorAll('[data-e2e]')].map(e=>e.getAttribute('data-e2e')))].slice(0,50),links:[...document.querySelectorAll('a[href]')].map(a=>a.href).filter(u=>u.includes('/video/')||u.includes('watch?v=')).slice(0,3),videos:[...document.querySelectorAll('video')].map(v=>({paused:v.paused,time:v.currentTime,ready:v.readyState,error:v.error?.message,muted:v.muted,dimensions:[v.videoWidth,v.videoHeight]}))})").catch(e=>({error:e.message}));
 });
}
async function main(){
 app=await _electron.launch({args:[root],env:{...process.env,MOYU_TEST:'1',MOYU_DATA_DIR:path.join(runDir,'data')},timeout:30000});
 page=await app.firstWindow();await page.waitForFunction(()=>!!window.moyu);await api('updateSettings',{autoHide:false});
 for(const id of (process.argv[2]?.split(',')||['douyin','bilibili','youtube'])){
  const started=Date.now();await api('openSource',id,id==='douyin'?'https://www.douyin.com/recommend':undefined);let s;
  while(Date.now()-started<25000){await sleep(500);s=await api('getState');if(s.media.error||!s.media.loading)break;}
  const homepage=await inspect();
  if(!s.media.error&&id!=='douyin'){const target=homepage?.links?.[0]||(id==='youtube'?'https://www.youtube.com/watch?v=jNQXAC9IVRw':null);if(target){await api('navigate','url',target);await sleep(5000);}}
  if(!s.media.error){await api('mediaAction','play');await sleep(3000);}
  const media=await inspect(),latest=await api('getState');
  const entry={id,elapsedMs:Date.now()-started,homepage,media,state:latest.media};results.push(entry);
  console.log(id,JSON.stringify({title:media?.title,error:latest.media.error,videos:media?.videos}));
  if(media?.videos?.some(v=>!v.paused&&v.time>0)){
   const before=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getBounds());
   await api('mediaAction','fullscreen',true);await sleep(400);
   const during=await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];return {bounds:w.getBounds(),osFullscreen:w.isFullScreen()};});
   await api('mediaAction','fullscreen',false);await sleep(400);
   const after=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getBounds());
   entry.fullscreen={before,during,after};
   await api('windowAction','hide');await sleep(400);
   entry.hidden=await app.evaluate(async({webContents})=>{const wc=webContents.getAllWebContents().find(w=>w.getURL().startsWith('http'));return {muted:wc.isAudioMuted(),paused:await wc.executeJavaScript("[...document.querySelectorAll('video')].every(v=>v.paused)")};});
   await api('windowAction','restore');
  }
 }
}
main().catch(e=>{results.push({error:String(e.stack||e)});console.error(e);process.exitCode=1;}).finally(async()=>{if(app)await app.close().catch(()=>{});fs.writeFileSync(path.join(runDir,'report.json'),JSON.stringify({generatedAt:new Date().toISOString(),freshSessions:true,results},null,2));console.log('Report:',path.join(runDir,'report.json'));});
