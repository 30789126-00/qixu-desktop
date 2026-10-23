const {_electron}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),runDir=path.resolve(root,'../test-runs','installed-'+Date.now());fs.mkdirSync(runDir,{recursive:true});
let app,page;const results=[];
const api=(method,...args)=>page.evaluate(({method,args})=>window.moyu[method](...args),{method,args});
async function main(){
 app=await _electron.launch({executablePath:'F:\\摸鱼\\摸鱼.exe',args:[],env:{...process.env,MOYU_TEST:'0',MOYU_DATA_DIR:path.join(runDir,'data')},timeout:30000});page=await app.firstWindow();await page.waitForFunction(()=>!!window.moyu);
 await api('updateSettings',{autoHide:false});
 const packaged=await app.evaluate(({app,globalShortcut})=>({packaged:app.isPackaged,version:app.getVersion(),shortcutRegistered:globalShortcut.isRegistered('Ctrl+Alt+Space')}));
 assert.equal(packaged.packaged,true);assert.equal(packaged.version,'1.0.0');assert.equal(packaged.shortcutRegistered,true);
 results.push({name:'安装版启动、版本和全局隐藏快捷键注册',pass:true,...packaged});
 await api('updateSettings',{launchAtLogin:true});let login=await app.evaluate(({app})=>app.getLoginItemSettings({path:process.execPath,args:['--autostart']}));assert.equal(login.openAtLogin,true);
 await api('updateSettings',{launchAtLogin:false});login=await app.evaluate(({app})=>app.getLoginItemSettings({path:process.execPath,args:['--autostart']}));assert.equal(login.openAtLogin,false);
 results.push({name:'真实开机自启登记开关，测试后保持关闭',pass:true});
 await api('importBooks',[path.join(root,'fixtures/sample-utf8.txt'),path.join(root,'fixtures/sample.epub')]);await api('setSection','library');await page.locator('.book-open').filter({has:page.getByText('sample-utf8',{exact:true})}).click();await page.locator('.reader-loading').waitFor({state:'hidden'});assert.ok(await page.locator('.reader-paragraph').count()>0);
 await page.getByTitle('返回书架',{exact:true}).click();await page.locator('.book-open').filter({has:page.getByText('sample',{exact:true})}).click();await page.locator('.reader-loading').waitFor({state:'hidden'});assert.ok(await page.locator('.reader-epub-host iframe').count()>0);
 results.push({name:'安装版 TXT Worker 和 EPUB 资源读取',pass:true});
 await api('windowAction','close');const hidden=await app.evaluate(({BrowserWindow})=>!BrowserWindow.getAllWindows()[0].isVisible());assert.equal(hidden,true);await api('windowAction','restore');
 results.push({name:'关闭收起至托盘并恢复',pass:true});
 await api('setSection','video');await api('updateSettings',{autoHide:true});await page.screenshot({path:path.join(runDir,'installed.png')});
}
main().catch(e=>{results.push({pass:false,error:String(e.stack||e)});console.error(e);process.exitCode=1;}).finally(async()=>{if(app){try{await api('updateSettings',{launchAtLogin:false});}catch{}await app.close().catch(()=>{});}fs.writeFileSync(path.join(runDir,'report.json'),JSON.stringify({results},null,2));console.log(JSON.stringify(results));console.log('Report:',path.join(runDir,'report.json'));});
