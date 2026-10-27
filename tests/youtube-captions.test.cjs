const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{buildSync}=require('esbuild');
const built=buildSync({entryPoints:[path.resolve(__dirname,'../electron/youtube-captions.ts')],bundle:true,platform:'node',format:'cjs',write:false,external:['electron']});const mod={exports:{}};new Function('require','module','exports',built.outputFiles[0].text)(require,mod,mod.exports);const {parseCaptionResponse,parseTranscriptResponse,YouTubeCaptionActivator}=mod.exports;
test('YouTube JSON3 and native XML subtitles retain time and decoded text',()=>{
 const json=parseCaptionResponse(JSON.stringify({events:[{tStartMs:1000,dDurationMs:2000,segs:[{utf8:'Hello '},{utf8:'world'}]}]}),'id','en');assert.equal(json[0].text,'Hello world');assert.equal(json[0].start,1);assert.equal(json[0].end,3);
 const xml=parseCaptionResponse('<timedtext><body><p t="1000" d="2000"><s>Hello &amp; welcome</s></p></body></timedtext>','id','en');assert.equal(xml[0].text,'Hello & welcome');assert.equal(xml[0].start,1);
 const legacy=parseCaptionResponse('<transcript><text start="2" dur="3">Bonjour</text></transcript>','id','fr');assert.equal(legacy[0].end,5);
});
test('WebVTT subtitles and unavailable responses have explicit outcomes',()=>{const vtt=parseCaptionResponse('WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nHello world\n','id','en');assert.equal(vtt[0].start,1);assert.throws(()=>parseCaptionResponse('','id','en'),/空内容/);assert.throws(()=>parseCaptionResponse('{"events":[]}','id','en'),/没有返回/);});
test('Modern YouTube transcript responses become timed cues',()=>{
 const body=JSON.stringify({actions:[{updateEngagementPanelAction:{content:{transcriptRenderer:{body:{transcriptBodyRenderer:{cueGroups:[{transcriptCueGroupRenderer:{cues:[{transcriptCueRenderer:{startOffsetMs:'1000',durationMs:'2500',cue:{runs:[{text:'Hello '},{text:'world'}]}}},{transcriptCueRenderer:{startOffsetMs:'3500',cue:{simpleText:'Second line'}}}]}}]}}}}}}]});
 const cues=parseTranscriptResponse(body,'video','en-US');assert.equal(cues.length,2);assert.equal(cues[0].text,'Hello world');assert.equal(cues[0].start,1);assert.equal(cues[0].end,3.5);assert.equal(cues[1].end,8.5);assert.match(cues[0].id,/transcript:en-US/);
});
test('YouTube caption activator uses trusted Chromium input only for valid targets',async()=>{
 const events=[];const wc={isDestroyed:()=>false,getURL:()=> 'https://www.youtube.com/watch?v=test',executeJavaScript:async()=>({x:120,y:90}),sendInputEvent:e=>events.push(e)};
 await new YouTubeCaptionActivator().tick(wc,()=>true);assert.deepEqual(events.map(e=>e.type),['mouseDown','mouseUp']);
 events.length=0;let allowed=true;wc.executeJavaScript=async()=>{allowed=false;return {x:120,y:90}};await new YouTubeCaptionActivator().tick(wc,()=>allowed);assert.equal(events.length,0);
});
