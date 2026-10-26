const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),vm=require('node:vm'),{buildSync}=require('esbuild');
function load(file){const mod={exports:{}};new Function('require','module','exports',buildSync({entryPoints:[path.join(__dirname,'../electron',file)],bundle:true,platform:'node',format:'cjs',write:false,external:['electron']}).outputFiles[0].text)(require,mod,mod.exports);return mod.exports;}
const {translationPageScript}=load('translation-page.ts');
test('New YouTube transcript view models feed timed captions and merge virtualized segments with stable IDs',()=>{
 let rows=[{time:'0:00',text:'Hello world, this is the first sentence.'},{time:'0:05',text:'A second sentence follows.'}];
 const video={readyState:4,currentTime:1,currentSrc:'video',textTracks:[],duration:20},player={getPlayerResponse:()=>({videoDetails:{videoId:'new-layout'},captions:{playerCaptionsTracklistRenderer:{captionTracks:[{languageCode:'en',baseUrl:'https://www.youtube.com/api/timedtext?v=new-layout&lang=en'}]}}})};
 const context=vm.createContext({URL,AbortSignal,location:{hostname:'www.youtube.com',href:'https://www.youtube.com/watch?v=new-layout'},HTMLVideoElement:class{},Element:class{},requestAnimationFrame:()=>0,cancelAnimationFrame:()=>{},setInterval:()=>1,getComputedStyle:()=>({position:'relative'}),fetch:async()=>({text:async()=>''}),document:{documentElement:{lang:'en'},querySelector:s=>s==='video.html5-main-video'?video:s==='#movie_player'?player:null,querySelectorAll:s=>s.includes('transcript-segment-view-model')?rows.map(r=>({querySelector:q=>({textContent:q.includes('Timestamp')?r.time:r.text})})):[]}});
 const run=(cmd,args)=>vm.runInContext(translationPageScript(cmd,args),context);
 run('configure',{active:true,page:false,subtitles:true,autoSkipAds:false});
 const first=run('collect',{pageBudget:0,captionBudget:6});assert.equal(first.captions.length,2);assert.equal(first.captions[0].end,5);const id=first.captions[0].id;
 rows=[{time:'0:05',text:'A second sentence follows.'},{time:'0:10',text:'More content after scrolling.'}];
 run('collect',{pageBudget:0,captionBudget:6});assert.equal(context.__qixuTranslator.cues.length,3);assert.equal(context.__qixuTranslator.cues[0].id,id);assert.equal(context.__qixuTranslator.cues[1].end,10);
});
const {YouTubeAdSkipper}=load('youtube-ads.ts');
test('Skip uses Chromium input only when still allowed after asynchronous discovery',async()=>{
 const events=[];const wc={isDestroyed:()=>false,getURL:()=> 'https://www.youtube.com/watch?v=test',executeJavaScript:async()=>({x:100,y:80}),sendInputEvent:e=>events.push(e)};
 await new YouTubeAdSkipper().tick(wc,()=>true);assert.deepEqual(events.map(e=>e.type),['mouseDown','mouseUp']);
 events.length=0;let active=true;wc.executeJavaScript=async()=>{active=false;return {x:100,y:80}};await new YouTubeAdSkipper().tick(wc,()=>active);assert.equal(events.length,0);
});
test('Skip does not send input to other websites or invalid coordinates',async()=>{
 const events=[];const wc={isDestroyed:()=>false,getURL:()=> 'https://notyoutube.com',executeJavaScript:async()=>({x:1,y:1}),sendInputEvent:e=>events.push(e)};
 await new YouTubeAdSkipper().tick(wc,()=>true);assert.equal(events.length,0);
 wc.getURL=()=> 'https://www.youtube.com/watch';wc.executeJavaScript=async()=>({x:NaN,y:1});await new YouTubeAdSkipper().tick(wc,()=>true);assert.equal(events.length,0);
});
const {attachYouTubeCaptions}=load('youtube-captions.ts');
const {EventEmitter}=require('events');
test('Transcript HTTP failures have a concrete UI reason and cannot update after locking',async()=>{
 const debuggerClient=new EventEmitter();debuggerClient.attach=()=>{};debuggerClient.sendCommand=async()=>({});const scripts=[];let current=true;
 const wc={debugger:debuggerClient,isDestroyed:()=>false,executeJavaScript:async script=>scripts.push(script)};attachYouTubeCaptions(wc,()=>current);
 function response(id){debuggerClient.emit('message',{},'Network.responseReceived',{requestId:id,response:{url:'https://www.youtube.com/youtubei/v1/get_transcript',status:400}});debuggerClient.emit('message',{},'Network.loadingFinished',{requestId:id});}
 response('first');await new Promise(r=>setTimeout(r,0));assert.equal(scripts.length,1);assert.ok(scripts[0].includes('HTTP 400'));assert.ok(scripts[0].includes('transcript'));
 current=false;response('late');await new Promise(r=>setTimeout(r,0));assert.equal(scripts.length,1);
});
test('Bilingual mode restores English original track and rejects its late Chinese auto-translation response',()=>{
 let selected={languageCode:'en-US',kind:'',translationLanguage:{languageCode:'zh-Hans'}},calls=0;
 const video={readyState:4,currentTime:1,textTracks:[],currentSrc:'video'},player={getPlayerResponse:()=>({captions:{playerCaptionsTracklistRenderer:{captionTracks:[{languageCode:'en-US',baseUrl:'https://www.youtube.com/api/timedtext?v=original&lang=en-US'}]}}}),getOption:()=>selected,setOption:(module,key,value)=>{assert.equal(module,'captions');assert.equal(key,'track');assert.equal(value.languageCode,'en-US');assert.equal(value.translationLanguage,null);selected={languageCode:'en-US',kind:''};calls++}};
 const context=vm.createContext({URL,AbortSignal,HTMLVideoElement:class{},Element:class{},location:{hostname:'www.youtube.com',href:'https://www.youtube.com/watch?v=original'},requestAnimationFrame:()=>0,cancelAnimationFrame:()=>{},setInterval:()=>1,fetch:async()=>({text:async()=>''}),document:{documentElement:{lang:'en'},querySelector:s=>s==='video.html5-main-video'?video:s==='#movie_player'?player:null,querySelectorAll:()=>[]}});
 const run=(cmd,args)=>vm.runInContext(translationPageScript(cmd,args),context);run('configure',{active:true,page:false,subtitles:true,autoSkipAds:false});run('collect',{pageBudget:0,captionBudget:6});assert.equal(calls,1);
 const late=run('importCaptions',{videoId:'original',originalLanguage:'en-US',language:'zh-Hans',cues:[{id:'wrong',start:0,end:2,text:'中文字幕',lang:'zh-Hans'}]});assert.equal(late,false);assert.equal(context.__qixuTranslator.cues.length,0);
 assert.equal(run('importCaptions',{videoId:'original',originalLanguage:'en-US',language:'en-US',cues:[{id:'right',start:0,end:2,text:'Hello world',lang:'en-US'}]}),true);assert.equal(context.__qixuTranslator.cues[0].id,'right');
});
