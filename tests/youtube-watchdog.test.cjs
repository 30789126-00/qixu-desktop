const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const vm=require('node:vm');
const {buildSync}=require('esbuild');

const bundle=buildSync({entryPoints:[path.resolve(__dirname,'../electron/translation-page.ts')],bundle:true,platform:'node',format:'cjs',write:false});
const mod={exports:{}};
new Function('require','module','exports',bundle.outputFiles[0].text)(require,mod,mod.exports);

function simulatedPage({captions=false}={}){
 let clicked=0,enabled=false,watchdog;
 const button={
  matches:()=>true,
  getBoundingClientRect:()=>({width:100,height:35}),
  getAttribute:()=>null,
  hasAttribute:()=>false,
  click:()=>{clicked++;}
 };
 const player={
  querySelectorAll:()=>enabled?[button]:[],
  getPlayerResponse:()=>undefined
 };
 const video={readyState:3,currentTime:2,currentSrc:'',textTracks:[]};
 const document={
  querySelector:(sel)=>{
   if(sel==='video.html5-main-video')return video;
   if(sel==='#movie_player'||sel==='#movie_player,.html5-video-player')return player;
   return null;
  },
  querySelectorAll:()=>[],
  documentElement:{lang:'en'}
 };
 const pageResponse={
  videoDetails:{videoId:'fixture'},
  captions:{playerCaptionsTracklistRenderer:{captionTracks:[{languageCode:'en',baseUrl:'https://www.youtube.com/api/timedtext?v=fixture&lang=en'}]}}
 };
 const context=vm.createContext({
  document,location:{hostname:'www.youtube.com',href:'https://www.youtube.com/watch?v=fixture'},
  ytInitialPlayerResponse:pageResponse,URL,AbortSignal,HTMLVideoElement:class {},Element:class {},
  requestAnimationFrame:()=>0,cancelAnimationFrame:()=>{},
  setInterval:(callback)=>{watchdog=callback;return 1;},
  getComputedStyle:()=>({visibility:'visible',display:'block',opacity:'1'}),
  fetch:async()=>({text:async()=>JSON.stringify({events:[{tStartMs:1000,dDurationMs:4000,segs:[{utf8:'Hello world from captions'}]}]})})
 });
 vm.runInContext("HTMLVideoElement.prototype.requestFullscreen=function(){};Element.prototype.requestFullscreen=function(){};",context);
 const execute=(command,args)=>vm.runInContext(mod.exports.translationPageScript(command,args),context);
 return {execute,enableSkip:()=>{enabled=true;},tick:()=>watchdog(),clicked:()=>clicked,controller:()=>context.__qixuTranslator};
}

test('YouTube skip watchdog clicks the visible button even without ad-showing and stops when disabled',()=>{
 const page=simulatedPage();
 page.execute('configure',{page:false,subtitles:false,active:true,autoSkipAds:true});
 assert.equal(page.clicked(),0);
 page.enableSkip();page.tick();assert.equal(page.clicked(),1);
 page.execute('configure',{page:false,subtitles:false,active:true,autoSkipAds:false});
 page.tick();assert.equal(page.clicked(),1);
});

test('YouTube captions use current-video initial response when player method is missing',async()=>{
 const page=simulatedPage({captions:true});
 page.execute('configure',{page:false,subtitles:true,active:true,autoSkipAds:false});
 page.tick();
 for(let attempt=0;attempt<5&&!page.controller().captionLoaded;attempt++)await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(page.controller().captionLoaded,true);
 const result=page.execute('collect',{pageBudget:0,captionBudget:4});
 assert.equal(result.captions.length,1);
 assert.equal(result.captions[0].text,'Hello world from captions');
 assert.equal(result.captions[0].lang,'en');
});
