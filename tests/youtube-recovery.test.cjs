const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const vm=require('node:vm');
const {buildSync}=require('esbuild');

function load(file){
  const output=buildSync({entryPoints:[path.resolve(__dirname,'../electron',file)],bundle:true,platform:'node',format:'cjs',write:false});
  const mod={exports:{}};
  new Function('require','module','exports',output.outputFiles[0].text)(require,mod,mod.exports);
  return mod.exports;
}

const {YouTubePlaybackRecovery}=load('youtube-recovery.ts');
const {mediaScript}=load('media.ts');

function sample(now,overrides={}){
  return {identity:'youtube:demo',error:'',playing:false,position:177,intended:true,now,...overrides};
}

test('YouTube mid-playback failure retries at most twice, including a stalled reload without an overlay',()=>{
  const recovery=new YouTubePlaybackRecovery();
  assert.deepEqual(recovery.observe(sample(0,{error:'player-error'})),{kind:'detected',attempt:0});
  assert.equal(recovery.observe(sample(1000,{error:'player-error'})),null);
  assert.deepEqual(recovery.observe(sample(1600,{error:'player-error'})),{kind:'retry',attempt:1});
  assert.equal(recovery.observe(sample(16000)),null);
  assert.deepEqual(recovery.observe(sample(16601)),{kind:'retry',attempt:2});
  assert.deepEqual(recovery.observe(sample(36602)),{kind:'exhausted',attempt:2});
  assert.equal(recovery.observe(sample(90000,{error:'player-error'})),null);
  assert.equal(recovery.active,false);
  assert.deepEqual(recovery.observe(sample(90001,{identity:'youtube:another',error:'player-error'})),{kind:'detected',attempt:0});
});

test('YouTube recovery recognizes sustained forward playback and resets its retry budget',()=>{
  const recovery=new YouTubePlaybackRecovery();
  recovery.observe(sample(0,{error:'player-error'}));
  recovery.observe(sample(1600,{error:'player-error'}));
  recovery.observe(sample(2000,{playing:true,position:177}));
  recovery.observe(sample(3200,{playing:true,position:178}));
  recovery.observe(sample(4400,{playing:true,position:179}));
  recovery.observe(sample(5600,{playing:true,position:180}));
  recovery.observe(sample(6800,{playing:true,position:181}));
  assert.deepEqual(recovery.observe(sample(8000,{playing:true,position:182})),{kind:'recovered',attempt:1});
  assert.equal(recovery.active,false);
  assert.deepEqual(recovery.observe(sample(7000,{error:'media-error-2'})),{kind:'detected',attempt:0});
});

test('YouTube recovery respects pause and never retries while user does not intend playback',()=>{
  const recovery=new YouTubePlaybackRecovery();
  recovery.observe(sample(0,{error:'player-error'}));
  assert.equal(recovery.observe(sample(4000,{error:'player-error',intended:false})),null);
  assert.equal(recovery.observe(sample(25000,{intended:false})),null);
  assert.equal(recovery.active,false);
});

function inspectPage({message='',visible=true,ad=false,mediaError=0}={}){
  const video={paused:false,ended:false,readyState:4,currentTime:177,duration:187,error:mediaError?{code:mediaError}:null,
    addEventListener(){},getBoundingClientRect(){return {width:800,height:450};}};
  const overlay={innerText:message,textContent:message,
    getBoundingClientRect(){return {width:400,height:visible?120:0};}};
  const document={documentElement:{},body:{innerText:''},fullscreenElement:null,
    querySelector(selector){
      if(selector==='video.html5-main-video, video')return video;
      if(selector==='.ad-showing,.ad-interrupting')return ad?{}:null;
      return null;
    },
    querySelectorAll(selector){
      if(selector==='video,audio')return [video];
      if(selector.includes('.ytp-error'))return message?[overlay]:[];
      return [];
    }};
  const context=vm.createContext({document,MutationObserver:class{observe(){}},
    getComputedStyle:()=>({display:'block',visibility:'visible',opacity:'1'}),Set});
  return vm.runInContext(mediaScript('status','youtube',false),context);
}

test('YouTube player overlay and HTMLMediaElement errors are detected, hidden errors and ads ignored',()=>{
  assert.equal(inspectPage({message:'Something went wrong. Refresh or try again later.'}).playbackError,'player-error');
  assert.equal(inspectPage({message:'Something went wrong.',visible:false}).playbackError,'');
  assert.equal(inspectPage({mediaError:3}).playbackError,'media-error-3');
  assert.equal(inspectPage({message:'Something went wrong.',ad:true,mediaError:2}).playbackError,'');
  assert.equal(inspectPage().playbackError,'');
});
