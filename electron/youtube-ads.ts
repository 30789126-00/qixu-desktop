import type { WebContents } from 'electron';

// Chromium input reaches YouTube controls that ignore HTMLElement.click().
// Coordinates are only returned for the player's actual, unobstructed Skip button.
export function youtubeSkipTargetScript(){
 return `(() => {
  if(!/(^|\\.)youtube\\.com$/.test(location.hostname))return null;
  const player=document.querySelector('#movie_player,.html5-video-player');
  if(!player)return null;
  const selector='.ytp-ad-skip-button,.ytp-ad-skip-button-modern,.ytp-skip-ad-button,.ytp-ad-skip-button-container button,.ytp-ad-skip-button-slot button,button[aria-label*="Skip Ad"],button[aria-label*="Skip ad"],button[aria-label*="跳过广告"]';
  for(const el of player.querySelectorAll(selector)){
   const button=el.matches('button,[role="button"]')?el:el.querySelector('button,[role="button"]');
   if(!button||button.disabled||button.getAttribute('aria-disabled')==='true')continue;
   const r=button.getBoundingClientRect(),s=getComputedStyle(button),x=Math.round(r.x+r.width/2),y=Math.round(r.y+r.height/2);
   if(r.width<=0||r.height<=0||s.display==='none'||s.visibility==='hidden'||Number(s.opacity)===0||x<0||y<0||x>=innerWidth||y>=innerHeight)continue;
   const hit=document.elementFromPoint(x,y);if(hit!==button&&!button.contains(hit))continue;
   return {x,y};
  }
  return null;
 })()`;
}

export class YouTubeAdSkipper {
 private busy=false;private lastClick=0;
 async tick(contents:WebContents,allowed:()=>boolean){
  if(this.busy||contents.isDestroyed()||!allowed()||Date.now()-this.lastClick<1200)return;
  try{if(!/(^|\.)youtube\.com$/.test(new URL(contents.getURL()).hostname))return;}catch{return;}
  this.busy=true;let timer:ReturnType<typeof setTimeout>|undefined;
  try{
   const point:any=await Promise.race([contents.executeJavaScript(youtubeSkipTargetScript()),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('skip-timeout')),1000);timer.unref();})]);
   if(!point||contents.isDestroyed()||!allowed()||!Number.isInteger(point.x)||!Number.isInteger(point.y)||point.x<0||point.y<0)return;
   if(!/(^|\.)youtube\.com$/.test(new URL(contents.getURL()).hostname))return;
   this.lastClick=Date.now();
   contents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,x:point.x,y:point.y});
   contents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:point.x,y:point.y});
  }catch{/* Navigation and unavailable controls are retried on the next tick. */}
  finally{if(timer)clearTimeout(timer);this.busy=false;}
 }
}
