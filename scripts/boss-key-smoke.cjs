const {_electron}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),folder=path.resolve(root,'../test-runs','boss-key-'+Date.now());let data=path.join(folder,'data');fs.mkdirSync(folder,{recursive:true});
let app,page;const results=[];const api=(method,...args)=>page.evaluate(({method,args})=>window.moyu[method](...args),{method,args});
const pause=ms=>new Promise(r=>setTimeout(r,ms));async function wait(fn){for(let i=0;i<180;i++){if(await fn())return;await pause(60)}throw Error('Timed out');}
async function launch(){app=await _electron.launch({...(process.env.QIXU_EXECUTABLE?{executablePath:process.env.QIXU_EXECUTABLE,args:[]}:{args:[root]}),env:{...process.env,MOYU_TEST:'1',QIXU_TEST_FIRST_RUN:'1',MOYU_DATA_DIR:data}});page=await app.firstWindow();await page.waitForFunction(()=>!!window.moyu);await wait(async()=>(await api('getState')).todoReady);}
async function prompt(){await app.evaluate(({app})=>app.emit('qixu:test-unlock'));}
async function main(){
 await launch();await page.screenshot({path:path.join(folder,'first-use.png')});await page.getByRole('heading',{name:'为片刻从容，留一条捷径。'}).waitFor();
 await api('cancelUnlock');await app.close();await launch();assert.equal((await api('getState')).bossKey.configured,false);
 await page.getByLabel('切换快捷键',{exact:true}).fill('Ctrl+Alt+Q');await page.getByLabel('新口令',{exact:true}).fill('Test-1234');await page.getByLabel('确认新口令',{exact:true}).fill('Test-1234');await page.getByRole('button',{name:'保存并开始',exact:true}).click();await wait(async()=>(await api('getState')).access==='todo');
 await app.evaluate(({app})=>app.emit('qixu:test-native-key'));await pause(250);assert.equal((await api('getState')).access,'todo');
 results.push({name:'首次引导可设置快捷键与口令，未完成引导重启仍可设置',pass:true});
 await prompt();assert.equal(await api('submitPassword','WSAD'),false);await prompt();assert.equal(await api('submitPassword','Test-1234'),true);await api('updateSettings',{autoHide:false,autoTranslate:false,bilingualSubtitles:false});
 const original=(await api('getState')).settings.shortcut;await app.evaluate(({globalShortcut})=>{globalShortcut.register('Ctrl+Alt+F10',()=>{});});
 await assert.rejects(api('updateBossKey',{shortcut:'Ctrl+Alt+F10',passwordRequired:true}));assert.equal((await api('getState')).settings.shortcut,original);
 await assert.rejects(api('updateBossKey',{shortcut:'Ctrl+Alt+Q',passwordRequired:false,currentPassword:'wrong'}));
 results.push({name:'错误密码拒绝进入或关闭验证；快捷键冲突不丢失原快捷键',pass:true});
 await api('lockToTodo');await app.evaluate(({app})=>app.emit('qixu:test-native-command','TEST_OPEN_BOSS_KEY'));await wait(async()=>(await api('getState')).bossKeyPanel===true);await page.getByRole('heading',{name:'老板键',exact:true}).waitFor();
 assert.equal((await api('getState')).access,'todo');assert.equal((await api('getState')).sources.length,0);await assert.rejects(api('openSource','youtube'));
 await assert.rejects(api('updateBossKey',{shortcut:'Ctrl+Alt+W',passwordRequired:true,currentPassword:'wrong'}));
 results.push({name:'待办原生老板键按钮可直接打开设置，无须解锁，内容接口保持锁定，修改设置验证当前口令',pass:true});
 await page.screenshot({path:path.join(folder,'boss-key-todo.png')});
 await page.getByLabel('当前口令',{exact:true}).fill('Test-1234');await page.getByLabel('新口令',{exact:true}).fill('Changed-5678');await page.getByLabel('确认新口令',{exact:true}).fill('Changed-5678');await page.getByRole('button',{name:'保存老板键',exact:true}).click();await page.getByRole('status').filter({hasText:'老板键已保存'}).waitFor();
 await api('lockToTodo');await prompt();assert.equal(await api('submitPassword','Changed-5678'),true);await api('updateBossKey',{shortcut:'Ctrl+Alt',passwordRequired:false,currentPassword:'Changed-5678'});await api('lockToTodo');await prompt();await wait(async()=>(await api('getState')).access==='private');
 await app.close();app=null;await launch();assert.equal((await api('getState')).bossKey.passwordRequired,false);await prompt();await wait(async()=>(await api('getState')).access==='private');
 const saved=JSON.parse(fs.readFileSync(path.join(data,'state.json'),'utf8'));assert.ok(!JSON.stringify(saved).includes('Changed-5678'));assert.equal((await api('getState')).settings.shortcut,'Ctrl+Alt');assert.equal((await api('getState')).bossKey.passwordRecord,undefined);
 results.push({name:'设置中修改密码成功；免验证和自定义快捷键完整退出重启后保留；不保存明文密码',pass:true});
 await api('lockToTodo');await app.evaluate(({app})=>app.emit('qixu:test-native-command','TEST_OPEN_BOSS_KEY'));await wait(async()=>(await api('getState')).bossKeyPanel===true);await page.screenshot({path:path.join(folder,'boss-key-settings.png')});await page.keyboard.press('Escape');await wait(async()=>(await api('getState')).bossKeyPanel===false);
 await app.close();app=null;data=path.join(folder,'without-password');await launch();await page.getByRole('checkbox',{name:'访问验证'}).uncheck();await page.getByRole('button',{name:'保存并开始',exact:true}).click();await wait(async()=>(await api('getState')).access==='todo');await prompt();await wait(async()=>(await api('getState')).access==='private');
 await assert.rejects(api('updateBossKey',{shortcut:'Ctrl+Alt',passwordRequired:true}));
 results.push({name:'首次安装可选择免口令；重新启用验证必须设置口令',pass:true});
}
main().catch(e=>{results.push({pass:false,error:String(e.stack||e)});console.error(e);process.exitCode=1}).finally(async()=>{if(app)await app.close().catch(()=>{});fs.writeFileSync(path.join(folder,'report.json'),JSON.stringify({results},null,2));console.log(JSON.stringify(results,null,2));console.log('Report:',folder)});
