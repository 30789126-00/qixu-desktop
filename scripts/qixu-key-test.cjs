const {_electron}=require('playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),folder=path.resolve(root,'../qixu-key-test');fs.mkdirSync(folder,{recursive:true});
let app;
async function main(){
 app=await _electron.launch({args:[root],env:{...process.env,MOYU_TEST:'1',MOYU_DATA_DIR:path.join(folder,'data')}});
 const page=await app.firstWindow();await page.waitForFunction(()=>!!window.moyu);while(!(await page.evaluate(()=>window.moyu.getState())).todoReady)await page.waitForTimeout(100);
 console.log('READY: native Ctrl+Alt input pending');
 const started=Date.now();while((await page.evaluate(()=>window.moyu.getState())).access!=='prompt'){if(Date.now()-started>120000)throw Error('Native Ctrl+Alt input was not received');await page.waitForTimeout(100);}
 await page.locator('input[type=password]').waitFor();assert.equal(await page.locator('input[type=password]').count(),1);console.log('PASS: real native Ctrl+Alt opened password dialog');
 fs.writeFileSync(path.join(folder,'result.json'),JSON.stringify({nativeCtrlAlt:true,passwordDialog:true}));
 await page.evaluate(()=>window.moyu.cancelUnlock());
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(app)await app.close().catch(()=>{});});
