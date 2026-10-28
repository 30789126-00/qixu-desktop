import type { WebContents, WebFrameMain } from 'electron';

export type MediaCommand = 'install' | 'pause' | 'resume' | 'play' | 'manualPause' | 'status' | 'exitFullscreen' | 'seek';
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
      c=globalThis[KEY]={blocked:${initiallyBlocked},resume:new Set(),attached:new WeakSet()};
      c.elements=()=>Array.from(document.querySelectorAll('video,audio'));
      c.attach=()=>c.elements().forEach(el=>{if(c.attached.has(el))return;c.attached.add(el);el.addEventListener('play',()=>{if(c.blocked){c.resume.add(el);el.pause();}},true);if(c.blocked&&!el.paused){c.resume.add(el);el.pause();}});
      c.observer=new MutationObserver(c.attach);c.observer.observe(document.documentElement||document,{childList:true,subtree:true});c.attach();
    }
    const elements=c.elements(),cmd=${JSON.stringify(command)};
    const chosen=document.querySelector(adapter.selector)||elements.find(el=>{const r=el.getBoundingClientRect();return r.width>120&&r.height>80;})||elements[0];
    const yt=platform==='youtube'?document.querySelector('#movie_player'):null;
    const bili=platform==='bilibili'&&globalThis.player&&typeof globalThis.player==='object'?globalThis.player:null;
    const adPlaying=platform==='youtube'&&!!document.querySelector('.ad-showing,.ad-interrupting');
    // YouTube can fail its media requests after the main document loads. Electron's
    // did-fail-load never fires for the in-player "Something went wrong" screen.
    const playerError=()=>{
      if(platform!=='youtube'||adPlaying)return '';
      const nodes=document.querySelectorAll('#movie_player .ytp-error-content-wrap,#movie_player .ytp-error,ytd-player-error-message-renderer,yt-player-error-message-renderer,#player-error-message');
      for(const node of nodes){
        const style=typeof getComputedStyle==='function'?getComputedStyle(node):null;
        if(style&&(style.display==='none'||style.visibility==='hidden'||style.opacity==='0'))continue;
        if(node.getBoundingClientRect){const rect=node.getBoundingClientRect();if(rect.width<=0||rect.height<=0)continue;}
        const message=String(node.innerText||node.textContent||'').slice(0,700);
        if(/Something went wrong|An error occurred|Playback error|发生错误|出了点问题|播放出错|请刷新.*重试/i.test(message))return 'player-error';
      }
      // MediaError is a separate signal when YouTube's overlay has not rendered.
      const mediaError=chosen?.error?.code;
      return mediaError>=2&&mediaError<=4?'media-error-'+mediaError:'';
    };
    let seekReady=false;
    const currentTime=()=>{try{if(yt?.getCurrentTime)return Number(yt.getCurrentTime())||0;}catch{}return Number(chosen?.currentTime)||0;};
    const duration=()=>{try{if(yt?.getDuration)return Number(yt.getDuration())||0;}catch{}return Number(chosen?.duration)||0;};
    const setTime=time=>{if(!Number.isFinite(time)||time<0)return;try{if(yt?.seekTo){yt.seekTo(time,true);return;}}catch{}if(chosen){const apply=()=>{try{chosen.currentTime=Math.min(time,Number.isFinite(chosen.duration)&&chosen.duration>0?Math.max(0,chosen.duration-.05):time);}catch{}};if(chosen.readyState>0)apply();}};
    if(cmd==='pause'){c.blocked=true;elements.forEach(el=>{if(!el.paused&&!el.ended)c.resume.add(el);el.pause();});try{yt?.pauseVideo?.();}catch{}try{bili?.pause?.();}catch{}}
    if(cmd==='manualPause'){c.blocked=false;c.resume.clear();elements.forEach(el=>el.pause());try{yt?.pauseVideo?.();}catch{}try{bili?.pause?.();}catch{}}
    if(cmd==='resume'){c.blocked=false;const saved=[...c.resume];c.resume.clear();saved.filter(el=>el.isConnected).forEach(el=>el.play().catch(()=>{}));if(saved.some(el=>el.isConnected)){try{yt?.playVideo?.();}catch{}try{bili?.play?.();}catch{}}}
    if(cmd==='play'){c.blocked=false;c.resume.clear();try{yt?.playVideo?.();}catch{}try{bili?.play?.();}catch{}if(chosen?.paused)chosen.play().catch(()=>{});}
    if(cmd==='seek'&&!adPlaying&&chosen&&chosen.readyState>0){const target=Math.min(Number(opts.time)||0,duration()>0?Math.max(0,duration()-.05):Number(opts.time)||0);if(Math.abs(currentTime()-target)>.5)setTime(target);seekReady=Math.abs(currentTime()-target)<=.75;if(seekReady&&opts.autoplay===true){c.blocked=false;try{yt?.playVideo?.();}catch{}chosen.play().catch(()=>{});}else if(opts.autoplay===false){c.resume.clear();try{yt?.pauseVideo?.();}catch{}chosen.pause();}}
    if(cmd==='exitFullscreen'){if(document.fullscreenElement)document.exitFullscreen().catch(()=>{});}
    const pageText=platform==='youtube'?(document.body?.innerText||''):'';
    const hint=/请登录.{0,15}确认.{0,15}不是|Sign in to confirm/i.test(pageText)?'YouTube 要求登录以确认访问，请在网页中操作；当前视频尚未开始播放':'';
    let riskText='';if(platform==='douyin'){const panels=[...document.querySelectorAll('[role="dialog"],[role="alert"],[class*="login"],[class*="verify"],[class*="captcha"],[class*="toast"]')];riskText=panels.slice(0,60).map(el=>el.innerText||'').join(' ');if((document.body?.innerText||'').length<5000)riskText+=' '+(document.body?.innerText||'');}
    const rateLimited=/访问太频繁|访问过于频繁|操作太频繁|操作过于频繁|请求太频繁|请求过于频繁|验证次数过多/.test(riskText);
    return {count:elements.length,playing:elements.some(el=>!el.paused&&!el.ended&&(typeof el.readyState!=='number'||el.readyState>=2)),paused:elements.every(el=>el.paused),blocked:c.blocked,hint,currentTime:currentTime(),duration:duration(),rateLimited,adPlaying,seekReady,fullscreen:!!document.fullscreenElement,playbackError:playerError()};
  })()`;
}

export interface MediaResult { count: number; playing: boolean; paused: boolean; blocked: boolean; hint?: string; currentTime: number; duration: number; rateLimited?: boolean;adPlaying?:boolean;seekReady?:boolean;fullscreen?:boolean;playbackError?:string; }

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
