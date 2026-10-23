const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{buildSync}=require('esbuild');
const built=buildSync({entryPoints:[path.resolve(__dirname,'../electron/youtube-captions.ts')],bundle:true,platform:'node',format:'cjs',write:false,external:['electron']});const mod={exports:{}};new Function('require','module','exports',built.outputFiles[0].text)(require,mod,mod.exports);const {parseCaptionResponse}=mod.exports;
test('YouTube JSON3 and native XML subtitles retain time and decoded text',()=>{
 const json=parseCaptionResponse(JSON.stringify({events:[{tStartMs:1000,dDurationMs:2000,segs:[{utf8:'Hello '},{utf8:'world'}]}]}),'id','en');assert.equal(json[0].text,'Hello world');assert.equal(json[0].start,1);assert.equal(json[0].end,3);
 const xml=parseCaptionResponse('<timedtext><body><p t="1000" d="2000"><s>Hello &amp; welcome</s></p></body></timedtext>','id','en');assert.equal(xml[0].text,'Hello & welcome');assert.equal(xml[0].start,1);
 const legacy=parseCaptionResponse('<transcript><text start="2" dur="3">Bonjour</text></transcript>','id','fr');assert.equal(legacy[0].end,5);
});
test('WebVTT subtitles and unavailable responses have explicit outcomes',()=>{const vtt=parseCaptionResponse('WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nHello world\n','id','en');assert.equal(vtt[0].start,1);assert.throws(()=>parseCaptionResponse('','id','en'),/空内容/);assert.throws(()=>parseCaptionResponse('{"events":[]}','id','en'),/没有返回/);});
