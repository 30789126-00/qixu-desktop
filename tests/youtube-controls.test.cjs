const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),{buildSync}=require('esbuild');

function moduleFrom(relative){
 const built=buildSync({entryPoints:[path.resolve(__dirname,'..',relative)],bundle:true,platform:'node',format:'cjs',write:false,external:['electron']});
 const mod={exports:{}};new Function('require','module','exports',built.outputFiles[0].text)(require,mod,mod.exports);return mod.exports;
}

const {YouTubePlayerControls,youtubeControlTargetScript}=moduleFrom('electron/youtube-controls.ts');

test('YouTube fullscreen uses Chromium trusted input on the real player fullscreen button',async()=>{
 const events=[],scripts=[];
 const wc={isDestroyed:()=>false,getURL:()=> 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',executeJavaScript:async script=>{scripts.push(script);return scripts.length===1?{x:320,y:420}:{x:610,y:430}},sendInputEvent:e=>events.push(e)};
 const clicked=await new YouTubePlayerControls().click(wc,'fullscreen',()=>true);
 assert.equal(clicked,true);assert.deepEqual(events.map(e=>e.type),['mouseMove','mouseDown','mouseUp']);assert.match(scripts[1],/ytp-fullscreen-button/);
 events.length=0;wc.getURL=()=> 'https://example.com/';assert.equal(await new YouTubePlayerControls().click(wc,'fullscreen',()=>true),false);assert.equal(events.length,0);
});

test('No artificial requestFullscreen fallback remains in media or translation code',()=>{
 const media=fs.readFileSync(path.resolve(__dirname,'../electron/media.ts'),'utf8');
 const translation=fs.readFileSync(path.resolve(__dirname,'../electron/translation-page.ts'),'utf8');
 assert.doesNotMatch(media,/cmd==='fullscreen'/);
 assert.doesNotMatch(media,/requestFullscreen\.call|\.requestFullscreen\?\./);
 assert.doesNotMatch(translation,/HTMLVideoElement\.prototype\.requestFullscreen\s*=/);
 assert.match(youtubeControlTargetScript('fullscreen'),/ytp-fullscreen-button/);
});
