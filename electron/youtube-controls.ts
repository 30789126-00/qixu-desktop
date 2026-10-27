import type { WebContents } from 'electron';

export type YouTubeControl = 'fullscreen';

const selectorByControl:Record<YouTubeControl,string> = {
  fullscreen: '.ytp-fullscreen-button',
};

function isYouTubeUrl(value:string){
  try{return /(^|\.)youtube\.com$/.test(new URL(value).hostname);}catch{return false;}
}

export function youtubeRevealTargetScript(){
  return `(() => {
    if(!/(^|\\.)youtube\\.com$/.test(location.hostname))return null;
    const player=document.querySelector('#movie_player,.html5-video-player');
    if(!player)return null;
    const r=player.getBoundingClientRect();
    if(r.width<160||r.height<100)return null;
    const x=Math.round(Math.min(innerWidth-2,Math.max(1,r.left+r.width/2)));
    const y=Math.round(Math.min(innerHeight-2,Math.max(1,r.bottom-Math.min(34,r.height/5))));
    if(x<0||y<0||x>=innerWidth||y>=innerHeight)return null;
    return {x,y};
  })()`;
}

export function youtubeControlTargetScript(control:YouTubeControl){
  const selector=selectorByControl[control];
  return `(() => {
    if(!/(^|\\.)youtube\\.com$/.test(location.hostname))return null;
    const button=document.querySelector(${JSON.stringify(selector)});
    if(!button||button.getAttribute('aria-disabled')==='true'||button.hasAttribute('disabled'))return null;
    const r=button.getBoundingClientRect(),s=getComputedStyle(button),x=Math.round(r.x+r.width/2),y=Math.round(r.y+r.height/2);
    if(r.width<=0||r.height<=0||s.display==='none'||s.visibility==='hidden'||Number(s.opacity)===0||x<0||y<0||x>=innerWidth||y>=innerHeight)return null;
    const hit=document.elementFromPoint(x,y);if(hit!==button&&!button.contains(hit))return null;
    return {x,y};
  })()`;
}

export class YouTubePlayerControls {
  private busy=false;

  async click(contents:WebContents,control:YouTubeControl,allowed:()=>boolean):Promise<boolean>{
    if(this.busy||contents.isDestroyed()||!allowed()||!isYouTubeUrl(contents.getURL()))return false;
    this.busy=true;
    try{
      const reveal:any=await contents.executeJavaScript(youtubeRevealTargetScript()).catch(()=>null);
      if(reveal&&Number.isInteger(reveal.x)&&Number.isInteger(reveal.y)&&allowed()&&!contents.isDestroyed()){
        contents.sendInputEvent({type:'mouseMove',x:reveal.x,y:reveal.y,movementX:0,movementY:0});
        await new Promise(resolve=>setTimeout(resolve,55));
      }
      if(contents.isDestroyed()||!allowed()||!isYouTubeUrl(contents.getURL()))return false;
      const point:any=await contents.executeJavaScript(youtubeControlTargetScript(control)).catch(()=>null);
      if(!point||!Number.isInteger(point.x)||!Number.isInteger(point.y)||point.x<0||point.y<0)return false;
      if(contents.isDestroyed()||!allowed()||!isYouTubeUrl(contents.getURL()))return false;
      contents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,x:point.x,y:point.y});
      contents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:point.x,y:point.y});
      return true;
    }catch{return false;}
    finally{this.busy=false;}
  }
}
