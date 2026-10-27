import type { WebContents } from 'electron';

export type BilibiliControl = 'play' | 'fullscreen';

const selectorByControl:Record<BilibiliControl,string> = {
  play: '.bpx-player-ctrl-play',
  fullscreen: '.bpx-player-ctrl-full',
};

function isBilibiliUrl(value:string){
  try{return /(^|\.)bilibili\.com$/.test(new URL(value).hostname);}catch{return false;}
}

export function bilibiliRevealTargetScript(){
  return `(() => {
    if(!/(^|\\.)bilibili\\.com$/.test(location.hostname))return null;
    const player=document.querySelector('.bpx-player-container,#bilibili-player,.bilibili-player-video-wrap');
    if(!player)return null;
    const r=player.getBoundingClientRect();
    if(r.width<160||r.height<100)return null;
    const x=Math.round(Math.min(innerWidth-2,Math.max(1,r.left+r.width/2)));
    const y=Math.round(Math.min(innerHeight-2,Math.max(1,r.bottom-Math.min(38,r.height/5))));
    if(x<0||y<0||x>=innerWidth||y>=innerHeight)return null;
    return {x,y};
  })()`;
}

export function bilibiliEnsureControlVisibleScript(control:BilibiliControl){
  const selector=selectorByControl[control];
  return `(() => {
    if(!/(^|\\.)bilibili\\.com$/.test(location.hostname))return false;
    const button=document.querySelector(${JSON.stringify(selector)});
    if(!button)return false;
    const r=button.getBoundingClientRect();
    const visible=r.width>0&&r.height>0&&r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;
    if(visible)return false;
    const player=document.querySelector('.bpx-player-container,#bilibili-player,.bilibili-player-video-wrap');
    if(!player)return false;
    player.scrollIntoView({block:'center',inline:'nearest'});
    return true;
  })()`;
}

export function bilibiliControlTargetScript(control:BilibiliControl){
  const selector=selectorByControl[control];
  return `(() => {
    if(!/(^|\\.)bilibili\\.com$/.test(location.hostname))return null;
    const button=document.querySelector(${JSON.stringify(selector)});
    if(!button)return null;
    if(${JSON.stringify(control)}==='fullscreen'&&/网页全屏/.test(button.getAttribute('aria-label')||button.textContent||''))return null;
    if(button.getAttribute('aria-disabled')==='true'||button.hasAttribute('disabled'))return null;
    const r=button.getBoundingClientRect(),s=getComputedStyle(button),x=Math.round(r.x+r.width/2),y=Math.round(r.y+r.height/2);
    if(r.width<=0||r.height<=0||s.display==='none'||s.visibility==='hidden'||Number(s.opacity)===0||x<0||y<0||x>=innerWidth||y>=innerHeight)return null;
    const hit=document.elementFromPoint(x,y);if(hit!==button&&!button.contains(hit))return null;
    return {x,y};
  })()`;
}

export class BilibiliPlayerControls {
  private busy=false;

  async click(contents:WebContents,control:BilibiliControl,allowed:()=>boolean):Promise<boolean>{
    if(this.busy||contents.isDestroyed()||!allowed()||!isBilibiliUrl(contents.getURL()))return false;
    this.busy=true;
    try{
      const scrolled=await contents.executeJavaScript(bilibiliEnsureControlVisibleScript(control)).catch(()=>false);
      if(scrolled)await new Promise(resolve=>setTimeout(resolve,110));
      if(contents.isDestroyed()||!allowed()||!isBilibiliUrl(contents.getURL()))return false;
      const reveal:any=await contents.executeJavaScript(bilibiliRevealTargetScript()).catch(()=>null);
      if(reveal&&Number.isInteger(reveal.x)&&Number.isInteger(reveal.y)&&allowed()&&!contents.isDestroyed()){
        contents.sendInputEvent({type:'mouseMove',x:reveal.x,y:reveal.y,movementX:0,movementY:0});
        await new Promise(resolve=>setTimeout(resolve,70));
      }
      if(contents.isDestroyed()||!allowed()||!isBilibiliUrl(contents.getURL()))return false;
      const point:any=await contents.executeJavaScript(bilibiliControlTargetScript(control)).catch(()=>null);
      if(!point||!Number.isInteger(point.x)||!Number.isInteger(point.y)||point.x<0||point.y<0)return false;
      if(contents.isDestroyed()||!allowed()||!isBilibiliUrl(contents.getURL()))return false;
      contents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,x:point.x,y:point.y});
      contents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:point.x,y:point.y});
      return true;
    }catch{return false;}
    finally{this.busy=false;}
  }
}
