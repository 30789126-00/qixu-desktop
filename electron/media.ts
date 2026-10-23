import type { WebContents, WebFrameMain } from 'electron';

export type MediaCommand = 'install' | 'pause' | 'resume' | 'play' | 'manualPause' | 'status' | 'fullscreen' | 'exitFullscreen' | 'seek';
export interface MediaCommandOptions { time?: number; autoplay?: boolean; }
export interface MediaAdapter { selector: string; fullscreen: string[]; }

export const adapters: Record<string, MediaAdapter> = {
  bilibili: { selector: '.bpx-player-video-wrap video, .bilibili-player-video video, video', fullscreen: ['.bpx-player-container', '#bilibili-player', '.bilibili-player-video-wrap'] },
  youtube: { selector: 'video.html5-main-video, video', fullscreen: ['#movie_player', '.html5-video-player'] },
  generic: { selector: 'video, audio', fullscreen: [] },
};

export function mediaScript(command: MediaCommand, platform: string, initiallyBlocked: boolean, options: MediaCommandOptions = {}) {
  const adapter = adapters[platform] || adapters.generic;
  return `(() => {
    const KEY='__qixuMediaController';
    const adapter=${JSON.stringify(adapter)}, platform=${JSON.stringify(platform)}, opts=${JSON.stringify(options)};
    let c=globalThis[KEY];
    if(!c){
      c=globalThis[KEY]={blocked:${initiallyBlocked},resume:new Set(),attached:new WeakSet(),fullscreenTarget:null};
      c.elements=()=>Array.from(document.querySelectorAll('video,audio'));
      c.attach=()=>c.elements().forEach(el=>{if(c.attached.has(el))return;c.attached.add(el);el.addEventListener('play',()=>{if(c.blocked){c.resume.add(el);el.pause();}},true);if(c.blocked&&!el.paused){c.resume.add(el);el.pause();}});
      c.observer=new MutationObserver(c.attach);c.observer.observe(document.documentElement||document,{childList:true,subtree:true});c.attach();
    }
    const elements=c.elements(),cmd=${JSON.stringify(command)};
    const chosen=document.querySelector(adapter.selector)||elements.find(el=>{const r=el.getBoundingClientRect();return r.width>120&&r.height>80;})||elements[0];
    const yt=platform==='youtube'?document.querySelector('#movie_player'):null;
    const currentTime=()=>{try{if(yt?.getCurrentTime)return Number(yt.getCurrentTime())||0;}catch{}return Number(chosen?.currentTime)||0;};
    const duration=()=>{try{if(yt?.getDuration)return Number(yt.getDuration())||0;}catch{}return Number(chosen?.duration)||0;};
    const setTime=time=>{if(!Number.isFinite(time)||time<0)return;try{if(yt?.seekTo){yt.seekTo(time,true);return;}}catch{}if(chosen){const apply=()=>{try{chosen.currentTime=Math.min(time,Number.isFinite(chosen.duration)&&chosen.duration>0?Math.max(0,chosen.duration-.05):time);}catch{}};if(chosen.readyState>0)apply();else chosen.addEventListener('loadedmetadata',apply,{once:true});}};
    if(cmd==='pause'){c.blocked=true;elements.forEach(el=>{if(!el.paused&&!el.ended)c.resume.add(el);el.pause();});try{yt?.pauseVideo?.();}catch{}}
    if(cmd==='manualPause'){c.blocked=false;c.resume.clear();elements.forEach(el=>el.pause());try{yt?.pauseVideo?.();}catch{}}
    if(cmd==='resume'){c.blocked=false;const saved=[...c.resume];c.resume.clear();saved.filter(el=>el.isConnected).forEach(el=>el.play().catch(()=>{}));if(saved.some(el=>el.isConnected))try{yt?.playVideo?.();}catch{}}
    if(cmd==='play'){c.blocked=false;c.resume.clear();try{yt?.playVideo?.();}catch{}if(chosen)chosen.play().catch(()=>{});}
    if(cmd==='seek'){setTime(Number(opts.time)||0);if(opts.autoplay===true){c.blocked=false;try{yt?.playVideo?.();}catch{}if(chosen)chosen.play().catch(()=>{});}else if(opts.autoplay===false){c.resume.clear();try{yt?.pauseVideo?.();}catch{}chosen?.pause?.();}}
    if(cmd==='fullscreen'){
      let target=null;for(const selector of adapter.fullscreen){target=chosen?.closest?.(selector)||document.querySelector(selector);if(target)break;}target=target||chosen?.parentElement||chosen;
      if(target){
        if(!document.getElementById('qixu-app-fullscreen-style')){const style=document.createElement('style');style.id='qixu-app-fullscreen-style';style.textContent='[data-qixu-app-fullscreen="1"]{position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;max-width:none!important;max-height:none!important;margin:0!important;z-index:2147483000!important;background:#000!important;transform:none!important}[data-qixu-app-fullscreen="1"] video{max-width:none!important;max-height:none!important}';(document.head||document.documentElement).appendChild(style);}
        if(c.fullscreenTarget&&c.fullscreenTarget!==target)c.fullscreenTarget.removeAttribute('data-qixu-app-fullscreen');
        c.fullscreenTarget=target;target.setAttribute('data-qixu-app-fullscreen','1');
      }
    }
    if(cmd==='exitFullscreen'){if(c.fullscreenTarget?.isConnected)c.fullscreenTarget.removeAttribute('data-qixu-app-fullscreen');c.fullscreenTarget=null;if(document.fullscreenElement)document.exitFullscreen().catch(()=>{});}
    const pageText=platform==='youtube'?(document.body?.innerText||''):'';
    const hint=/请登录.{0,15}确认.{0,15}不是|Sign in to confirm/i.test(pageText)?'YouTube 要求登录以确认访问，请在网页中操作；当前视频尚未开始播放':'';
    let riskText='';if(platform==='douyin'){const panels=[...document.querySelectorAll('[role="dialog"],[role="alert"],[class*="login"],[class*="verify"],[class*="captcha"],[class*="toast"]')];riskText=panels.slice(0,60).map(el=>el.innerText||'').join(' ');if((document.body?.innerText||'').length<5000)riskText+=' '+(document.body?.innerText||'');}
    const rateLimited=/访问太频繁|访问过于频繁|操作太频繁|操作过于频繁|请求太频繁|请求过于频繁|验证次数过多/.test(riskText);
    return {count:elements.length,playing:elements.some(el=>!el.paused&&!el.ended&&(typeof el.readyState!=='number'||el.readyState>=2)),paused:elements.every(el=>el.paused),blocked:c.blocked,hint,currentTime:currentTime(),duration:duration(),rateLimited};
  })()`;
}

export interface MediaResult { count: number; playing: boolean; paused: boolean; blocked: boolean; hint?: string; currentTime: number; duration: number; rateLimited?: boolean; }

export async function controlMedia(contents: WebContents, command: MediaCommand, platform: string, blocked: boolean, options: MediaCommandOptions = {}): Promise<MediaResult[]> {
  if (contents.isDestroyed()) return [];
  let frames: WebFrameMain[];
  try { frames = contents.mainFrame.framesInSubtree; } catch { return []; }
  const results = await Promise.allSettled(frames.map(frame => Promise.race([
    frame.executeJavaScript(mediaScript(command, platform, blocked, options), true),
    new Promise<never>((_, reject) => { const timer = setTimeout(() => reject(new Error('播放器响应超时')), 1800); timer.unref(); })
  ])));
  return results.filter((r): r is PromiseFulfilledResult<MediaResult> => r.status === 'fulfilled').map(r => r.value);
}
