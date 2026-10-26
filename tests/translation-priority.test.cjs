const {test}=require('node:test'),assert=require('node:assert/strict'),{buildSync}=require('esbuild'),path=require('node:path');
test('Busy page translation never stops caption discovery or subtitle priority',async()=>{
 const built=buildSync({entryPoints:[path.resolve(__dirname,'../electron/translation-browser.ts')],bundle:true,platform:'node',format:'cjs',write:false,external:['electron']});const mod={exports:{}};new Function('require','module','exports',built.outputFiles[0].text)(require,mod,mod.exports);
 const calls=[],jobs=[];let serial=0;const frame={executeJavaScript:async script=>{calls.push(script);if(script.includes(')("collect",')){const config=JSON.parse(script.slice(script.lastIndexOf(')("collect",')+12,-1));return {pages:Array.from({length:config.pageBudget},()=>({id:'p'+ ++serial,text:'This paragraph is waiting for translation.',lang:'en'})),captions:config.captionBudget?[{id:'c'+ ++serial,text:'Hello world, welcome to this video.',lang:'en'}]:[],reason:'ready'};}return true;}};frame.framesInSubtree=[frame];const wc={isDestroyed:()=>false,getURL:()=> 'https://www.youtube.com/watch?v=test',mainFrame:frame};
 const service={translate:(...args)=>{jobs.push(args);return new Promise(()=>{});},cancel(){}};const translator=new mod.exports.BrowserTranslator(service,()=>{},()=>true);
 const settings={autoTranslate:true,translationDisabledSites:[],bilingualSubtitles:true};for(let i=0;i<20;i++)await translator.tick(wc,settings,true);
 assert.equal(jobs.filter(j=>j[3]===1).length,2);assert.equal(jobs.filter(j=>j[3]===10).length,8);assert.equal(calls.filter(c=>c.includes(')("collect",')).length,20);
});

