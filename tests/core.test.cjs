const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const path=require('node:path');
const {buildSync}=require('esbuild');
function moduleFrom(relative) {
  const built=buildSync({entryPoints:[path.resolve(__dirname,'..',relative)],bundle:true,platform:'node',format:'cjs',write:false});
  const module={exports:{}};vm.runInNewContext(built.outputFiles[0].text,{module,exports:module.exports,require,URL,console,Set,WeakSet,setTimeout});return module.exports;
}
const {safeUrl,sanitizeSettings,defaultSettings}=moduleFrom('electron/defaults.ts');
const {mediaScript}=moduleFrom('electron/media.ts');
test('Remote navigation accepts websites and rejects executable/local protocols or embedded credentials',()=>{
  assert.equal(safeUrl('example.com'),'https://example.com/');
  assert.equal(safeUrl('https://www.bilibili.com/video/BV1'),'https://www.bilibili.com/video/BV1');
  for(const url of ['file:///C:/Windows/win.ini','javascript:alert(1)','data:text/html,test','https://user:password@example.com'])assert.throws(()=>safeUrl(url));
  assert.throws(()=>safeUrl('http://127.0.0.1:1234/'));
  assert.equal(safeUrl('http://127.0.0.1:1234/',true),'http://127.0.0.1:1234/');
});
test('Invalid saved settings cannot make the window invisible or produce invalid scroll/reading values',()=>{
  const s=sanitizeSettings({opacity:-1,fontSize:NaN,scrollSpeed:1e9,lineHeight:0,readerWidth:Infinity,autoHide:'false',theme:'invalid'});
  assert.equal(s.opacity,0.2);assert.equal(s.fontSize,defaultSettings.fontSize);assert.equal(s.scrollSpeed,100);assert.equal(s.lineHeight,1.2);assert.equal(s.readerWidth,defaultSettings.readerWidth);assert.equal(s.autoHide,true);assert.equal(s.theme,defaultSettings.theme);
  const changed=sanitizeSettings({scrollSpeed:38});assert.equal(sanitizeSettings({opacity:0.7},changed).scrollSpeed,38);
});
function mediaEnvironment() {
  const elements=[];
  const context={console,Set,WeakSet,Promise};
  const document={fullscreenElement:null,documentElement:{},querySelectorAll:()=>elements,querySelector:()=>elements[0],exitFullscreen(){this.fullscreenElement=null;return Promise.resolve();}};
  context.document=document;
  context.MutationObserver=class {constructor(cb){context.observer=this;this.cb=cb;} observe(){} disconnect(){}};
  vm.createContext(context);
  function video(paused=true) {
    const events={};const el={paused,ended:false,isConnected:true,tagName:'VIDEO',addEventListener(name,cb){(events[name]||=[]).push(cb);},getBoundingClientRect:()=>({width:300,height:200}),pause(){this.paused=true;},play(){this.paused=false;for(const cb of events.play||[])cb();return Promise.resolve();},requestFullscreen(){document.fullscreenElement=this;return Promise.resolve();}};elements.push(el);return el;
  }
  return {video,context,run:(command,blocked=false)=>vm.runInContext(mediaScript(command,'generic',blocked),context)};
}
test('Hide pauses playing media and resume restores only previously playing elements',()=>{
  const env=mediaEnvironment(),playing=env.video(false),paused=env.video(true);
  env.run('install');env.run('pause');assert.equal(playing.paused,true);assert.equal(paused.paused,true);
  env.run('pause');env.run('resume');assert.equal(playing.paused,false);assert.equal(paused.paused,true);
  env.run('manualPause');env.run('pause');env.run('resume');assert.equal(playing.paused,true);
});
test('Media inserted while hidden cannot remain playing; removal does not restart detached media',()=>{
  const env=mediaEnvironment();env.run('install',true);const late=env.video(false);env.context.observer.cb();assert.equal(late.paused,true);
  late.play();assert.equal(late.paused,true);late.isConnected=false;env.run('resume');assert.equal(late.paused,true);
});
test('A buffering media element is not reported as playing until it has decoded data',()=>{
  const env=mediaEnvironment(),video=env.video(false);video.readyState=0;
  assert.equal(env.run('status').playing,false);video.readyState=4;assert.equal(env.run('status').playing,true);
});
