import { DOMParser } from '@xmldom/xmldom';
import type { WebContents } from 'electron';
import { translationPageScript } from './translation-page';
export interface CaptionCue { id:string;start:number;end:number;text:string;lang:string; }
function cleanCaptionText(value:string){return value.replace(/\s+/g,' ').trim();}
export function parseCaptionResponse(body:string,videoId:string,language:string):CaptionCue[]{
 if(!body.trim())throw Error('字幕接口返回空内容');if(body.length>4*1024*1024)throw Error('字幕轨道过大');
 const text=body.replace(/^\)\]\}'[^\n]*\n/,'').trim();let cues:Omit<CaptionCue,'id'|'lang'>[]=[];
 if(text.startsWith('{')){
  const json=JSON.parse(text);cues=(json.events||[]).filter((e:any)=>e.segs).map((e:any)=>({start:Number(e.tStartMs)/1000,end:(Number(e.tStartMs)+Number(e.dDurationMs||2000))/1000,text:e.segs.map((s:any)=>s.utf8||'').join('').replace(/\s+/g,' ').trim()}));
 }else if(text.startsWith('<')){
  if(/<!DOCTYPE|<!ENTITY/i.test(text))throw Error('字幕格式不受支持');
  const doc=new DOMParser().parseFromString(text,'text/xml');
  if(doc.getElementsByTagName('p').length)cues=Array.from(doc.getElementsByTagName('p')).map(n=>({start:Number(n.getAttribute('t'))/1000,end:(Number(n.getAttribute('t'))+Number(n.getAttribute('d')||2000))/1000,text:(n.textContent||'').replace(/\s+/g,' ').trim()}));
  else cues=Array.from(doc.getElementsByTagName('text')).map(n=>({start:Number(n.getAttribute('start')),end:Number(n.getAttribute('start'))+Number(n.getAttribute('dur')||2),text:(n.textContent||'').replace(/\s+/g,' ').trim()}));
 }else if(text.startsWith('WEBVTT')){
  const seconds=(s:string)=>s.split(':').reduce((n,part)=>n*60+Number(part),0);
  for(const block of text.split(/\r?\n\s*\r?\n/)){const lines=block.split(/\r?\n/),at=lines.findIndex(l=>l.includes(' --> '));if(at<0)continue;const match=lines[at].match(/([\d:.]+)\s+-->\s+([\d:.]+)/);if(match)cues.push({start:seconds(match[1]),end:seconds(match[2]),text:lines.slice(at+1).join(' ').replace(/<[^>]+>/g,'').trim()});}
 }
 cues=cues.filter(c=>c.text&&Number.isFinite(c.start)&&Number.isFinite(c.end)&&c.end>c.start).sort((a,b)=>a.start-b.start);
 if(!cues.length)throw Error('字幕接口没有返回可用字幕');
 return cues.slice(0,30000).map((cue,i)=>({...cue,id:videoId+':native:'+language+':'+i,lang:language}));
}
function runsText(value:any):string{
 if(!value||typeof value!=='object')return '';
 if(typeof value.simpleText==='string')return cleanCaptionText(value.simpleText);
 if(Array.isArray(value.runs))return cleanCaptionText(value.runs.map((run:any)=>typeof run?.text==='string'?run.text:'').join(''));
 return '';
}
export function parseTranscriptResponse(body:string,videoId:string,language:string):CaptionCue[]{
 if(!body.trim())throw Error('转写接口返回空内容');if(body.length>4*1024*1024)throw Error('转写内容过大');
 const text=body.replace(/^\)\]\}'[^\n]*\n/,'').trim();const json=JSON.parse(text);const raw:Array<{start:number;duration:number;text:string}>=[];
 const visit=(value:any)=>{
  if(!value||typeof value!=='object')return;
  for(const key of ['transcriptCueRenderer','transcriptSegmentRenderer']){
   const cue=value[key];if(!cue||typeof cue!=='object')continue;
   const startMs=Number(cue.startOffsetMs??cue.startTimeMs??cue.startMs);
   const durationMs=Number(cue.durationMs??cue.durationMilliseconds??0);
   const cueText=runsText(cue.cue)||runsText(cue.snippet)||runsText(cue.text)||runsText(cue);
   if(Number.isFinite(startMs)&&startMs>=0&&cueText&&!/^\d+(?::\d+){1,2}$/.test(cueText))raw.push({start:startMs/1000,duration:Number.isFinite(durationMs)&&durationMs>0?durationMs/1000:0,text:cueText});
  }
  if(Array.isArray(value))for(const item of value)visit(item);else for(const child of Object.values(value))visit(child);
 };
 visit(json);
 const unique=[...new Map(raw.sort((a,b)=>a.start-b.start).map(cue=>[`${cue.start}:${cue.text}`,cue])).values()];
 const cues=unique.map((cue,i)=>({start:cue.start,end:cue.duration>0?cue.start+cue.duration:(unique[i+1]?.start??cue.start+5),text:cue.text})).filter(cue=>cue.end>cue.start);
 if(!cues.length)throw Error('转写接口没有返回可用字幕');
 const lang=language||'en';return cues.slice(0,30000).map((cue,i)=>({...cue,id:videoId+':transcript:'+lang+':'+i,lang}));
}

export function youtubeCaptionTargetScript(){
 return `(() => {
  if(!/(^|\\.)youtube\\.com$/.test(location.hostname))return null;
  if(document.querySelector('.html5-video-player.ad-showing,#movie_player.ad-showing'))return null;
  const button=document.querySelector('.ytp-subtitles-button');
  if(!button||button.getAttribute('aria-pressed')!=='false'||button.getAttribute('aria-disabled')==='true')return null;
  const r=button.getBoundingClientRect(),s=getComputedStyle(button),x=Math.round(r.x+r.width/2),y=Math.round(r.y+r.height/2);
  if(r.width<=0||r.height<=0||s.display==='none'||s.visibility==='hidden'||Number(s.opacity)===0||x<0||y<0||x>=innerWidth||y>=innerHeight)return null;
  const hit=document.elementFromPoint(x,y);if(hit!==button&&!button.contains(hit))return null;
  return {x,y};
 })()`;
}

export class YouTubeCaptionActivator {
 private busy=false;private lastClick=0;
 async tick(contents:WebContents,allowed:()=>boolean){
  if(this.busy||contents.isDestroyed()||!allowed()||Date.now()-this.lastClick<2500)return;
  try{if(!/(^|\.)youtube\.com$/.test(new URL(contents.getURL()).hostname))return;}catch{return;}
  this.busy=true;let timer:ReturnType<typeof setTimeout>|undefined;
  try{
   const point:any=await Promise.race([contents.executeJavaScript(youtubeCaptionTargetScript()),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('caption-toggle-timeout')),1000);timer.unref();})]);
   if(!point||contents.isDestroyed()||!allowed()||!Number.isInteger(point.x)||!Number.isInteger(point.y)||point.x<0||point.y<0)return;
   if(!/(^|\.)youtube\.com$/.test(new URL(contents.getURL()).hostname))return;
   this.lastClick=Date.now();contents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,x:point.x,y:point.y});contents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:point.x,y:point.y});
  }catch{/* Player controls can disappear during navigation; retry on the next tick. */}
  finally{if(timer)clearTimeout(timer);this.busy=false;}
 }
}
// Read only subtitle responses already requested by the website's own player.
// Request headers, cookies, account data and signed URLs are never exposed or logged.
const attached=new WeakSet<WebContents>();
export function attachYouTubeCaptions(wc:WebContents,isCurrent:()=>boolean){
 if(attached.has(wc))return;attached.add(wc);
 const pending=new Map<string,{videoId:string;language:string;originalLanguage:string;status:number;transcript:boolean}>();
 try{wc.debugger.attach('1.3');}catch{return;}
 void wc.debugger.sendCommand('Network.enable',{maxTotalBufferSize:8*1024*1024,maxResourceBufferSize:4*1024*1024}).catch(()=>{});
 const notify=async(message:string,source='caption')=>{if(!isCurrent()||wc.isDestroyed())return;await wc.executeJavaScript(translationPageScript('captionError',{message,source})).catch(()=>{});};
 wc.debugger.on('message',(_event,method,params)=>{
  if(method==='Network.responseReceived'){
   try{const url=new URL(params.response.url);if(url.protocol!=='https:'||!/(^|\.)youtube\.com$/.test(url.hostname))return;
    const transcript=url.pathname==='/youtubei/v1/get_transcript';if(url.pathname!=='/api/timedtext'&&!transcript)return;
    if(pending.size>20)pending.clear();pending.set(params.requestId,{videoId:url.searchParams.get('v')||'',language:url.searchParams.get('tlang')||url.searchParams.get('lang')||'',originalLanguage:url.searchParams.get('lang')||'',status:params.response.status,transcript});
   }catch{}return;
  }
  if(method==='Network.loadingFailed'){if(pending.delete(params.requestId))void notify('字幕请求失败，请稍后重试');return;}
  if(method!=='Network.loadingFinished')return;const track=pending.get(params.requestId);if(!track)return;pending.delete(params.requestId);
  if(track.status<200||track.status>=300){void notify('YouTube '+(track.transcript?'转写文稿':'字幕')+'接口返回 HTTP '+track.status+'；请在原站重试或确认登录状态',track.transcript?'transcript':'caption');return;}
  void(async()=>{try{
   const response=await wc.debugger.sendCommand('Network.getResponseBody',{requestId:params.requestId});
   if(!isCurrent()||wc.isDestroyed())return;
   const body=response.base64Encoded?Buffer.from(response.body,'base64').toString('utf8'):response.body;
   let videoId=track.videoId,language=track.language,originalLanguage=track.originalLanguage;
   if(track.transcript){
    const meta:any=await wc.executeJavaScript(`(()=>{const player=document.querySelector('#movie_player');const selected=player?.getOption?.('captions','track');return {videoId:new URL(location.href).searchParams.get('v')||'',language:selected?.languageCode||document.documentElement.lang||'',originalLanguage:selected?.languageCode||''}})()`).catch(()=>({}));
    videoId=videoId||meta.videoId||'';language=language||meta.language||'en';originalLanguage=originalLanguage||meta.originalLanguage||language;
   }
   const cues=track.transcript?parseTranscriptResponse(body,videoId,language):parseCaptionResponse(body,videoId,language);
   await wc.executeJavaScript(translationPageScript('importCaptions',{videoId,language,originalLanguage,cues,source:track.transcript?'transcript':'native'}));
  }catch(e:any){void notify('YouTube '+String(e.message||'字幕读取失败').slice(0,100)+'；可关闭后重新开启双语字幕重试',track.transcript?'transcript':'caption');}})();
 });
}
