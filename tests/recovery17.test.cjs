const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const path=require('node:path');
const fs=require('node:fs/promises');
const os=require('node:os');
const {buildSync}=require('esbuild');

function moduleFrom(relative){
  const built=buildSync({entryPoints:[path.resolve(__dirname,'..',relative)],bundle:true,platform:'node',format:'cjs',write:false});
  const module={exports:{}};vm.runInNewContext(built.outputFiles[0].text,{module,exports:module.exports,require,console,process,Buffer,URL,setTimeout,clearTimeout});return module.exports;
}

const {transitionWindowMode,modeFields}=moduleFrom('electron/window-machine.ts');
const {loadDurableState,saveDurableState}=moduleFrom('electron/state-store.ts');
const {sanitizeResumeState,checkpoint}=moduleFrom('electron/recovery.ts');
const {mediaScript}=moduleFrom('electron/media.ts');

test('1.7 window state machine keeps panic hide restorable without exposing todo',()=>{
  let mode='todo';mode=transitionWindowMode(mode,'REQUEST_UNLOCK');assert.equal(mode,'unlock');mode=transitionWindowMode(mode,'UNLOCK_OK');assert.equal(mode,'privateVisible');
  mode=transitionWindowMode(mode,'PANIC_HIDE');assert.equal(mode,'privatePanicHidden');assert.deepEqual({...modeFields(mode)},{access:'private',windowState:'panicHidden'});
  mode=transitionWindowMode(mode,'RESTORE');assert.equal(mode,'privateVisible');assert.equal(transitionWindowMode(mode,'AUTO_HIDE'),'privateAutoHidden');
  assert.equal(transitionWindowMode('privatePanicHidden','SHOW_TODO'),'todo');
});

test('1.7 durable state falls back to the previous valid backup after primary corruption',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'qixu-state-')),file=path.join(dir,'state.json');
  try{
    await saveDurableState(file,{version:1,value:'first'});await saveDurableState(file,{version:2,value:'second'});
    await fs.writeFile(file,'{broken','utf8');
    const loaded=await loadDurableState(file);assert.equal(loaded.recoveredFrom,'state.json.bak');assert.equal(loaded.data.value,'first');
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('1.7 recovery snapshot rejects missing books/sources and marks unclean checkpoints',()=>{
  const sources=[{id:'youtube',title:'YouTube',url:'https://youtube.com/',kind:'video',color:'#000000',abbr:'Y'}];
  const books=[{id:'a'.repeat(24),title:'Book',type:'txt',size:1,addedAt:1,progress:null,bookmarks:[]}];
  const resume=sanitizeResumeState({section:'library',activeSourceId:'youtube',activeBookId:'a'.repeat(24),mediaUrl:'https://youtube.com/watch?v=x',mediaTime:42.5,mediaWasPlaying:true},sources,books);
  assert.equal(resume.mediaTime,42.5);assert.equal(resume.activeBookId,'a'.repeat(24));assert.equal(checkpoint(resume,false).cleanExit,false);
  const sanitized=sanitizeResumeState({...resume,activeSourceId:'gone',activeBookId:'gone'},sources,books);assert.equal(sanitized.activeSourceId,null);assert.equal(sanitized.activeBookId,null);
});

function mediaEnv(platform='bilibili'){
  const events={};
  const target={attrs:new Map(),isConnected:true,setAttribute(k,v){this.attrs.set(k,v);},removeAttribute(k){this.attrs.delete(k);}};
  const video={paused:false,ended:false,isConnected:true,tagName:'VIDEO',readyState:4,currentTime:18,duration:100,parentElement:target,addEventListener(name,cb){(events[name]||=[]).push(cb);},getBoundingClientRect:()=>({width:800,height:450}),closest:()=>target,pause(){this.paused=true;},play(){this.paused=false;return Promise.resolve();}};
  const styleHost={appendChild(){}};
  const document={body:{innerText:''},head:styleHost,documentElement:styleHost,fullscreenElement:null,querySelectorAll(selector){return selector==='video,audio'?[video]:[];},querySelector(selector){if(selector.includes('video'))return video;if(selector==='#movie_player')return null;return null;},getElementById(){return null;},createElement(){return {id:'',style:{},textContent:''};},exitFullscreen(){this.fullscreenElement=null;return Promise.resolve();}};
  const context={document,console,Set,WeakSet,Promise,MutationObserver:class{constructor(cb){this.cb=cb;}observe(){}}};vm.createContext(context);
  return {video,target,run:(command,opts={})=>vm.runInContext(mediaScript(command,platform,false,opts),context)};
}

test('1.7 Bilibili adapter uses in-app fullscreen CSS and preserves controllable playback',()=>{
  const env=mediaEnv();const before=env.run('status');assert.equal(before.currentTime,18);env.run('fullscreen');assert.equal(env.target.attrs.get('data-qixu-app-fullscreen'),'1');assert.equal(env.video.paused,false);
  env.run('pause');assert.equal(env.video.paused,true);env.run('resume');assert.equal(env.video.paused,false);env.run('exitFullscreen');assert.equal(env.target.attrs.has('data-qixu-app-fullscreen'),false);
});

test('1.7 media seek restores time and respects whether playback was active before restart',()=>{
  const env=mediaEnv();env.run('seek',{time:63,autoplay:false});assert.equal(env.video.currentTime,63);assert.equal(env.video.paused,true);env.run('seek',{time:27,autoplay:true});assert.equal(env.video.currentTime,27);assert.equal(env.video.paused,false);
});
test('Media recovery waits for metadata and does not autoplay or acknowledge an unloaded video',()=>{
 const env=mediaEnv();env.video.readyState=0;env.video.currentTime=0;env.video.paused=true;const waiting=env.run('seek',{time:27,autoplay:true});assert.equal(waiting.seekReady,false);assert.equal(env.video.paused,true);assert.equal(env.video.currentTime,0);env.video.readyState=2;const ready=env.run('seek',{time:27,autoplay:true});assert.equal(ready.seekReady,true);assert.equal(env.video.currentTime,27);assert.equal(env.video.paused,false);
});
