const {_electron}=require('playwright');
const {execFileSync}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');

const root=path.resolve(__dirname,'..');
const runDir=path.resolve(root,'../test-runs','auto-hide-'+Date.now());
const dataDir=path.join(runDir,'data');
const installedExecutable=process.env.QIXU_EXECUTABLE||'';
fs.mkdirSync(runDir,{recursive:true});

let app=null,page=null;
const results=[];
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const api=(method,...args)=>page.evaluate(({method,args})=>window.moyu[method](...args),{method,args});

async function wait(fn,timeout=3000){
  const started=Date.now();
  while(Date.now()-started<timeout){
    try{if(await fn())return Date.now()-started;}catch{}
    await pause(20);
  }
  throw new Error(`Timed out after ${timeout} ms`);
}

function setCursor(x,y){
  const script=`Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public static class QixuCursor { [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y); }'; [QixuCursor]::SetCursorPos(${Math.round(x)}, ${Math.round(y)}) | Out-Null`;
  execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{stdio:'ignore'});
}

async function geometry(){
  return app.evaluate(({BrowserWindow,screen})=>{
    const win=BrowserWindow.getAllWindows().find(item=>!item.isDestroyed()&&item.getTitle().includes('栖序'))||BrowserWindow.getAllWindows()[0];
    const bounds=win.getBounds();
    const area=screen.getDisplayMatching(bounds).workArea;
    const inside={x:bounds.x+Math.max(30,Math.floor(bounds.width/2)),y:bounds.y+Math.max(30,Math.floor(bounds.height/2))};
    const candidates=[
      {x:area.x+4,y:area.y+4},
      {x:area.x+area.width-5,y:area.y+4},
      {x:area.x+4,y:area.y+area.height-5},
      {x:area.x+area.width-5,y:area.y+area.height-5},
    ];
    const contains=point=>point.x>=bounds.x&&point.x<bounds.x+bounds.width&&point.y>=bounds.y&&point.y<bounds.y+bounds.height;
    const outside=candidates.find(point=>!contains(point));
    return {bounds,inside,outside};
  });
}

async function launch(){
  const options={env:{...process.env,MOYU_TEST:'1',MOYU_DATA_DIR:dataDir}};
  if(installedExecutable){options.executablePath=installedExecutable;options.args=[];}else options.args=[root];
  app=await _electron.launch(options);
  page=await app.firstWindow();
  await page.waitForFunction(()=>!!window.moyu);
  await wait(async()=>(await api('getState')).todoReady,10000);
  await app.evaluate(({app})=>app.emit('qixu:test-unlock'));
  await page.getByLabel('访问口令').waitFor();
  assert.equal(await api('submitPassword','WSAD'),true);
  await page.locator('.app-shell').waitFor();
  await api('updateSettings',{autoHide:true,autoTranslate:false,bilingualSubtitles:false});
  await pause(650);
}

async function main(){
  await launch();
  const g=await geometry();
  assert.ok(g.outside,'测试窗口必须留有可移动到的屏幕外部区域');

  const cycles=[];
  for(let i=0;i<5;i++){
    setCursor(g.inside.x,g.inside.y);
    await wait(async()=>(await api('getState')).windowState==='visible');
    await pause(90);

    setCursor(g.outside.x,g.outside.y);
    const hideMs=await wait(async()=>(await api('getState')).windowState==='autoHidden',700);

    setCursor(g.inside.x,g.inside.y);
    const restoreMs=await wait(async()=>(await api('getState')).windowState==='visible',700);
    cycles.push({cycle:i+1,hideMs,restoreMs});

    // Regression: an automatic restore must be armed again without an extra click or detour.
    await pause(260);
    setCursor(g.outside.x,g.outside.y);
    const rehideMs=await wait(async()=>(await api('getState')).windowState==='autoHidden',700);
    cycles[cycles.length-1].rehideMs=rehideMs;

    setCursor(g.inside.x,g.inside.y);
    await wait(async()=>(await api('getState')).windowState==='visible',700);
    await pause(260);
  }

  const worst={hide:Math.max(...cycles.map(row=>row.hideMs)),restore:Math.max(...cycles.map(row=>row.restoreMs)),rehide:Math.max(...cycles.map(row=>row.rehideMs))};
  assert.ok(worst.hide<700&&worst.restore<700&&worst.rehide<700);
  results.push({name:'鼠标自动隐藏/恢复连续 5 轮稳定，并且自动恢复后无需额外动作即可再次隐藏',pass:true,cycles,worst});

  await api('windowAction','hide');
  await wait(async()=>(await api('getState')).windowState==='panicHidden');
  setCursor(g.inside.x,g.inside.y);
  await pause(350);
  assert.equal((await api('getState')).windowState,'panicHidden');
  results.push({name:'快捷键/紧急隐藏保持确定性：鼠标经过原区域不会擅自唤醒',pass:true});
}

main().catch(error=>{
  results.push({pass:false,error:String(error.stack||error)});
  console.error(error);
  process.exitCode=1;
}).finally(async()=>{
  if(app)await app.close().catch(()=>{});
  const report=path.join(runDir,'report.json');
  fs.writeFileSync(report,JSON.stringify({results},null,2));
  console.log(JSON.stringify(results,null,2));
  console.log('Report:',report);
});
