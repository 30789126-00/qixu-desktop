const {_electron}=require('playwright'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),folder=path.resolve(root,'../test-runs','qixu-platform-'+Date.now());fs.mkdirSync(folder,{recursive:true});
let app,page;const results=[],pause=ms=>new Promise(r=>setTimeout(r,ms));
const api=(method,...args)=>page.evaluate(({method,args})=>window.moyu[method](...args),{method,args});
async function main(){
 app=await _electron.launch({args:[root],env:{...process.env,MOYU_TEST:'1',MOYU_DATA_DIR:path.join(folder,'data')}});page=await app.firstWindow();await page.waitForFunction(()=>!!window.moyu);for(let i=0;i<100&&!(await api('getState')).todoReady;i++)await pause(100);
 await app.evaluate(({app})=>app.emit('qixu:test-unlock'));await api('submitPassword','WSAD');await api('updateSettings',{autoHide:false,autoTranslate:false});
 for(const [id,url] of [['douyin','https://www.douyin.com/'],['bilibili','https://www.bilibili.com/'],['youtube','https://www.youtube.com/watch?v=EWX0bbGAd0k']]){
  await api('openSource',id,url);await api('setLoginMode',true);
  for(let i=0;i<50;i++){await pause(500);const s=await api('getState');if(s.media.error||(!s.media.loading&&i>8))break;}
  const state=await api('getState');const details=await app.evaluate(async({webContents})=>{const wc=webContents.getAllWebContents().find(w=>w.getURL().startsWith('http'));if(!wc)return null;return wc.executeJavaScript(`({title:document.title,loginRequired:/Sign in to confirm|登录.{0,15}确认/.test(document.body?.innerText||''),videos:[...document.querySelectorAll('video')].map(v=>({ready:v.readyState,paused:v.paused,time:v.currentTime,tracks:v.textTracks.length})),captionTracks:document.querySelector('#movie_player')?.getPlayerResponse?.()?.captions?.playerCaptionsTracklistRenderer?.captionTracks?.length||0})`).catch(()=>null);});
  results.push({name:id+' 官方网页加载',pass:!state.media.error&&!!details,details,mediaError:state.media.error,translation:state.translation,accountVerification:'未操作真实账号；抖音扫码验证后登录仍需用户确认'});console.log(id,JSON.stringify(results.at(-1)));
 }
}
main().catch(e=>{results.push({pass:false,error:String(e.stack||e)});process.exitCode=1;}).finally(async()=>{if(app)await app.close().catch(()=>{});fs.writeFileSync(path.join(folder,'report.json'),JSON.stringify({freshSessions:true,results},null,2));console.log('Report:',path.join(folder,'report.json'));});
