import { DOMParser } from '@xmldom/xmldom';
import type { WebContents } from 'electron';
import { translationPageScript } from './translation-page';
export interface CaptionCue { id:string;start:number;end:number;text:string;lang:string; }
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
  if(track.transcript)return;
  void(async()=>{try{
   const response=await wc.debugger.sendCommand('Network.getResponseBody',{requestId:params.requestId});
   if(!isCurrent()||wc.isDestroyed())return;
   const body=response.base64Encoded?Buffer.from(response.body,'base64').toString('utf8'):response.body;
   const cues=parseCaptionResponse(body,track.videoId,track.language);
   await wc.executeJavaScript(translationPageScript('importCaptions',{videoId:track.videoId,language:track.language,originalLanguage:track.originalLanguage,cues}));
  }catch(e:any){void notify('YouTube '+String(e.message||'字幕读取失败').slice(0,100)+'；可关闭后重新开启双语字幕重试');}})();
 });
}
