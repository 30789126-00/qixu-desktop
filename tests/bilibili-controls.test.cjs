const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),{buildSync}=require('esbuild');
const built=buildSync({entryPoints:[path.resolve(__dirname,'../electron/bilibili-controls.ts')],bundle:true,platform:'node',format:'cjs',write:false,external:['electron']});const mod={exports:{}};new Function('require','module','exports',built.outputFiles[0].text)(require,mod,mod.exports);const {BilibiliPlayerControls,bilibiliControlTargetScript,bilibiliEnsureControlVisibleScript}=mod.exports;

test('Bilibili trusted controls use Chromium input only on bilibili.com',async()=>{
 const events=[];const scripts=[];const wc={isDestroyed:()=>false,getURL:()=> 'https://www.bilibili.com/video/BV1GJ411x7h7/',executeJavaScript:async script=>{scripts.push(script);if(script.includes('scrollIntoView'))return false;if(script.includes("document.querySelector('.bpx-player-container,#bilibili-player,.bilibili-player-video-wrap')"))return {x:320,y:420};return {x:610,y:430}},sendInputEvent:e=>events.push(e)};
 const clicked=await new BilibiliPlayerControls().click(wc,'fullscreen',()=>true);
 assert.equal(clicked,true);assert.deepEqual(events.map(e=>e.type),['mouseMove','mouseDown','mouseUp']);assert.ok(scripts.some(script=>/bpx-player-ctrl-full/.test(script)));assert.ok(scripts.every(script=>!/bpx-player-ctrl-web/.test(script)));
 events.length=0;wc.getURL=()=> 'https://example.com/';assert.equal(await new BilibiliPlayerControls().click(wc,'play',()=>true),false);assert.equal(events.length,0);
});

test('Bilibili fullscreen target script is pinned to the native fullscreen control',()=>{
 const script=bilibiliControlTargetScript('fullscreen');assert.match(script,/bpx-player-ctrl-full/);assert.doesNotMatch(script,/bpx-player-ctrl-web/);assert.match(script,/elementFromPoint/);assert.match(script,/bilibili\\\.com/);
 const visibility=bilibiliEnsureControlVisibleScript('fullscreen');assert.match(visibility,/bpx-player-ctrl-full/);assert.match(visibility,/scrollIntoView/);assert.doesNotMatch(visibility,/bpx-player-ctrl-web/);
});

test('Bilibili native fullscreen event is mirrored without triggering fullscreen a second time',()=>{
 const source=fs.readFileSync(path.resolve(__dirname,'../electron/main.ts'),'utf8').replace(/\r\n/g,'\n');
 const eventBlock=source.match(/wc\.on\('enter-html-full-screen',[\s\S]*?\n\s*\}\);/i)?.[0]||'';
 assert.match(eventBlock,/state\.fullscreen=true/);
 assert.doesNotMatch(eventBlock,/fullscreen\(true\)/);
 const fullscreenFunction=source.match(/async function fullscreen\(enabled:boolean\) \{[\s\S]*?\n\}/)?.[0]||'';
 assert.match(fullscreenFunction,/bilibiliPlayerControls\.click\(contents,'fullscreen'/);
 assert.match(fullscreenFunction,/youtubePlayerControls\.click\(contents,'fullscreen'/);
 assert.doesNotMatch(fullscreenFunction,/controlMedia\(contents,'fullscreen'/);
 assert.doesNotMatch(fullscreenFunction,/requestFullscreen/);
 assert.doesNotMatch(fullscreenFunction,/win\.(setFullScreen|maximize|setBounds|setSize)/);
});

test('Fullscreen is mirrored only after the native player has entered HTML fullscreen',()=>{
 const source=fs.readFileSync(path.resolve(__dirname,'../electron/main.ts'),'utf8').replace(/\r\n/g,'\n');
 const fullscreenFunction=source.match(/async function fullscreen\(enabled:boolean\) \{[\s\S]*?\n\}/)?.[0]||'';
 const clickAt=fullscreenFunction.indexOf("bilibiliPlayerControls.click(contents,'fullscreen'");
 const firstEnterAt=fullscreenFunction.indexOf('state.fullscreen=true');
 assert.ok(clickAt>=0&&firstEnterAt>clickAt,'shell fullscreen state must follow the real player click');
 assert.match(source,/disableHtmlFullscreenWindowResize:true/);
});

test('Host window is explicitly protected from OS fullscreen',()=>{
 const source=fs.readFileSync(path.resolve(__dirname,'../electron/main.ts'),'utf8').replace(/\r\n/g,'\n');
 assert.match(source,/win=new BrowserWindow\(\{[\s\S]*?fullscreenable:true,[\s\S]*?disableHtmlFullscreenWindowResize:true/);
 assert.match(source,/overrideBrowserWindowOptions:\{[\s\S]*?fullscreenable:false,[\s\S]*?disableHtmlFullscreenWindowResize:true/);
 assert.match(source,/let playerFullscreenBounds: Rectangle \| null = null/);
 assert.match(source,/function preparePlayerFullscreenHost\(\)[\s\S]*?playerFullscreenBounds=win\.getBounds\(\)[\s\S]*?win\.setFullScreenable\(true\)/);
 assert.match(source,/function lockPlayerFullscreenHost\(\)[\s\S]*?playerFullscreenBounds=win\.getBounds\(\)[\s\S]*?win\.setFullScreenable\(false\)/);
 assert.match(source,/function restorePlayerFullscreenHost\(\)[\s\S]*?win\.setFullScreenable\(true\)[\s\S]*?setWindowBoundsExact\(target\)/);
 assert.match(source,/win\.on\('enter-full-screen',[\s\S]*?setTimeout\(\(\)=>[\s\S]*?win\.setFullScreen\(false\)/);
 assert.match(source,/!win\.isFullScreen\(\)&&!state\.fullscreen/);
});

test('Player fullscreen fills only Qixu client content and preserves the host bounds snapshot',()=>{
 const source=fs.readFileSync(path.resolve(__dirname,'../electron/main.ts'),'utf8').replace(/\r\n/g,'\n');
 assert.match(source,/const r=state\.fullscreen\?\{x:0,y:0,width:w,height:h\}:viewport!/);
 const fullscreenFunction=source.match(/async function fullscreen\(enabled:boolean\) \{[\s\S]*?\n\}/)?.[0]||'';
 assert.match(fullscreenFunction,/preparePlayerFullscreenHost\(\)/);
 assert.match(fullscreenFunction,/restorePlayerFullscreenHost\(\)/);
 assert.doesNotMatch(fullscreenFunction,/win\.(setFullScreen|maximize|setBounds|setSize)/);
});

test('Packaged local UI uses canonical file URLs instead of loadFile paths',()=>{
 const source=fs.readFileSync(path.resolve(__dirname,'../electron/main.ts'),'utf8').replace(/\r\n/g,'\n');
 assert.match(source,/app\.isPackaged \? path\.join\(process\.resourcesPath,'ui'\) : null/);
 assert.match(source,/packagedUiRoot \? path\.join\(packagedUiRoot,'index\.html'\)/);
 assert.match(source,/await win\.loadURL\(homeUrl\)/);
 assert.match(source,/await controlsView\.webContents\.loadURL\(fullscreenControlsUrl\)/);
 assert.doesNotMatch(source,/await win\.loadFile\(homeFile\)/);
 assert.doesNotMatch(source,/await controlsView\.webContents\.loadFile\(fullscreenControlsFile\)/);
 assert.match(source,/fileURLToPath\(url\)/);
 assert.match(source,/!isSameLocalFile\(url,homeFile\)/);
 assert.match(source,/!isSameLocalFile\(url,fullscreenControlsFile\)/);
});

test('Packaged fullscreen overlay includes the script referenced by its HTML',()=>{
 const root=path.resolve(__dirname,'..');
 const html=fs.readFileSync(path.join(root,'assets/fullscreen-controls.html'),'utf8');
 const resources=require('../package.json').build.extraResources;
 for(const match of html.matchAll(/<script\s+src="([^"]+)"/g)){
  const name=match[1];
  assert.ok(resources.some(entry=>entry.from===`assets/${name}`&&entry.to===`ui/${name}`),`${name} must be shipped beside the overlay HTML`);
  assert.ok(fs.statSync(path.join(root,'assets',name)).size>0);
 }
});
