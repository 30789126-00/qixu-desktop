const {_electron}=require('playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),runDir=path.resolve(root,'../test-runs','large-epub-'+Date.now());fs.mkdirSync(runDir,{recursive:true});
let app;const results=[];
async function main(){
 app=await _electron.launch({args:[root],env:{...process.env,MOYU_TEST:'1',MOYU_DATA_DIR:path.join(runDir,'data')}});
 const page=await app.firstWindow();await page.waitForFunction(()=>!!window.moyu);
 await page.evaluate(()=>window.moyu.updateSettings({autoHide:false,alwaysOnTop:true}));
 const file=path.resolve(root,'../test-fixtures/large-20mb-360.epub');const size=fs.statSync(file).size;
 await page.evaluate(file=>window.moyu.importBooks([file]),file);await page.evaluate(()=>window.moyu.setSection('library'));
 const start=Date.now();await page.locator('.book-open').click();await page.locator('.reader-loading').waitFor({state:'hidden',timeout:35000});
 assert.equal(await page.locator('.reader-error').count(),0);const firstPaintMs=Date.now()-start;
 assert.ok(await page.locator('.reader-epub-host iframe').count()>0);await page.getByTitle('目录',{exact:true}).click();assert.equal(await page.locator('.reader-list-item').count(),360);
 await page.locator('.reader-list-item').nth(180).click();await page.getByTitle('关闭面板',{exact:true}).click();await page.waitForTimeout(250);
 const before=await page.locator('.reader-title small').innerText();await page.getByTitle('返回书架',{exact:true}).click();await page.locator('.book-open').click();await page.locator('.reader-loading').waitFor({state:'hidden'});const after=await page.locator('.reader-title small').innerText();
 assert.ok(!before.includes('0.0%'));assert.ok(!after.includes('0.0%'));await page.screenshot({path:path.join(runDir,'large-epub.png')});
 results.push({name:'22MB/360章 EPUB 首屏、跳章与阅读位置恢复',pass:true,size,firstPaintMs,before,after});console.log(JSON.stringify(results[0]));
}
main().catch(e=>{results.push({pass:false,error:String(e.stack||e)});console.error(e);process.exitCode=1;}).finally(async()=>{if(app)await app.close().catch(()=>{});fs.writeFileSync(path.join(runDir,'report.json'),JSON.stringify({results},null,2));console.log('Report:',path.join(runDir,'report.json'));});
