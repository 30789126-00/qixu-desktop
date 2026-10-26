// Runs in the remote DOM without Node, preload, or access to application IPC.
function browserController(command:string,args:any):any {
 const g=globalThis as any;
 let c=g.__qixuTranslator;
 if(!c){
  c=g.__qixuTranslator={nodes:new Map(),cues:[],cueStates:new Map(),translations:new Map(),serial:0,videoId:'',active:true,page:true,subtitles:true,blocked:false};
  c.cleanText=(el:Element)=>{const clone=el.cloneNode(true) as Element;clone.querySelectorAll('[data-qixu-ui]').forEach(n=>n.remove());return (clone.textContent||'').replace(/\s+/g,' ').trim();};
  c.resetQueues=()=>{for(const item of c.nodes.values())if(item.status==='queued')item.status='new';for(const [id,status] of c.cueStates)if(status==='queued')c.cueStates.delete(id);};
  c.clearPage=()=>{document.querySelectorAll('[data-qixu-translation]').forEach(n=>n.remove());c.nodes.clear();};
  c.player=()=>document.querySelector('video.html5-main-video')||Array.from(document.querySelectorAll('video')).find(v=>v.getBoundingClientRect().width>0);
  c.isYouTube=()=>/(^|\.)youtube\.com$/.test(location.hostname);
  c.adPlaying=()=>c.isYouTube()&&!!document.querySelector('.html5-video-player.ad-showing,#movie_player.ad-showing');
  // Only click an actual, visible and enabled skip control inside YouTube's player.
  // The independent watchdog still checks while the local translation worker is busy.
  c.skipAd=()=>{
   if(!c.active||!c.autoSkipAds||!c.isYouTube()||Date.now()-(c.lastAdSkip||0)<750)return;
   const player=document.querySelector('#movie_player,.html5-video-player');
   if(!player)return;
   const selectors='.ytp-ad-skip-button,.ytp-ad-skip-button-modern,.ytp-skip-ad-button,.ytp-ad-skip-button-container button,.ytp-ad-skip-button-slot button,button[aria-label*="Skip Ad"],button[aria-label*="Skip ad"],button[aria-label*="跳过广告"],button[aria-label*="略過廣告"]';
   const candidates=Array.from(player.querySelectorAll(selectors)) as HTMLElement[];
   const button=candidates.map(b=>(b.matches('button,[role="button"]')?b:b.querySelector<HTMLElement>('button,[role="button"]')||b))
     .find(b=>{const r=b.getBoundingClientRect(),style=getComputedStyle(b);return r.width>0&&r.height>0&&style.visibility!=='hidden'&&style.display!=='none'&&Number(style.opacity)>0&&b.getAttribute('aria-disabled')!=='true'&&!b.hasAttribute('disabled');});
   if(button){c.lastAdSkip=Date.now();button.click();}
  };
  c.container=(video:HTMLVideoElement)=>{
   let target=video.closest('.html5-video-player,.bpx-player-container,.bilibili-player-video-wrap,[data-qixu-player]') as HTMLElement;
   if(!target){target=video.parentElement!;if(target===document.body||!target){target=document.createElement('div');target.dataset.qixuPlayer='';video.parentNode?.insertBefore(target,video);target.appendChild(video);target.style.cssText='position:relative;display:inline-block;max-width:100%;';}}
   target.dataset.qixuPlayer='';if(!document.getElementById('qixu-fullscreen-style')){const style=document.createElement('style');style.id='qixu-fullscreen-style';style.textContent='[data-qixu-player]:fullscreen{width:100%!important;height:100%!important;background:#000;display:flex;align-items:center;justify-content:center}[data-qixu-player]:fullscreen>video{width:100%!important;height:100%!important;object-fit:contain}';document.documentElement.appendChild(style);}
   if(getComputedStyle(target).position==='static')target.style.position='relative';return target;
  };
  c.fullscreenTarget=(video:HTMLVideoElement)=>c.container(video);
  c.restoreNative=()=>{if(c.nativeCaptions){c.nativeCaptions.el.style.visibility=c.nativeCaptions.visibility;c.nativeCaptions=null;}if(c.nativeTrack){c.nativeTrack.track.mode=c.nativeTrack.mode;c.nativeTrack=null;}};
  // A video element itself cannot contain a DOM subtitle layer in fullscreen.
  const nativeFullscreen=HTMLVideoElement.prototype.requestFullscreen;
  HTMLVideoElement.prototype.requestFullscreen=function(options){return c.subtitles?Element.prototype.requestFullscreen.call(c.container(this),options):nativeFullscreen.call(this,options);};
  c.showCue=(video:HTMLVideoElement,cue:any)=>{
   const container=c.container(video);
   if(!c.overlay||c.overlay.parentElement!==container){c.overlay?.remove();const overlay=document.createElement('div');overlay.dataset.qixuUi='subtitles';overlay.style.cssText='position:absolute;left:5%;right:5%;bottom:9%;z-index:2147483647;pointer-events:none;text-align:center;';
    const shadow=overlay.attachShadow({mode:'closed'}),style=document.createElement('style');
    style.textContent=':host{color:white;font-family:system-ui,"Microsoft YaHei",sans-serif}div{line-height:1.4;text-shadow:0 2px 5px #000,0 0 3px #000;font-size:clamp(15px,2.2vw,28px)}span{background:#111b;box-decoration-break:clone;-webkit-box-decoration-break:clone;padding:2px 7px;border-radius:5px}#en{font-size:.78em;margin-top:4px}';
    shadow.appendChild(style);
    for(const language of ['zh','en']){const line=document.createElement('div'),text=document.createElement('span');line.id=language;line.appendChild(text);shadow.appendChild(line);c[language]=text;}
    c.overlay=overlay;container.appendChild(overlay);
   }
   const translated=c.translations.get(cue.id),zh=translated?.zh||'中文翻译中…',en=translated?.en||(cue.lang?.startsWith('en')?cue.text:'English translation…');if(c.zh.textContent!==zh)c.zh.textContent=zh;if(c.en.textContent!==en)c.en.textContent=en;c.overlay.hidden=false;
   const native=document.querySelector('.ytp-caption-window-container') as HTMLElement;
   if(translated&&native&&!c.nativeCaptions){c.nativeCaptions={el:native,visibility:native.style.visibility};native.style.visibility='hidden';}
   const showing=Array.from(video.textTracks).find(t=>t.mode==='showing');if(translated&&showing&&!c.nativeTrack){c.nativeTrack={track:showing,mode:showing.mode};showing.mode='hidden';}
  };
  c.render=()=>{
   const video=c.player();
   if(c.active&&c.subtitles&&video&&!c.adPlaying()){const at=video.currentTime;const cue=c.cues.find((q:any)=>!q.skip&&!/^(zh|cmn|zho)([-_]|$)/i.test(q.lang||'')&&at>=q.start&&at<q.end);if(cue)c.showCue(video,cue);else {if(c.overlay)c.overlay.hidden=true;c.restoreNative();}}
   else {if(c.overlay)c.overlay.hidden=true;c.restoreNative();}
   if(c.active)c.raf=requestAnimationFrame(c.render);
  };c.render();
  c.refreshCaptions=async(video:HTMLVideoElement)=>{
   const yt=document.querySelector('#movie_player') as any;
   const pageVideoId=new URL(location.href).searchParams.get('v');
   let response=yt?.getPlayerResponse?.();
   if(!response?.captions?.playerCaptionsTracklistRenderer?.captionTracks?.length){
    // getPlayerResponse is absent on some newer YouTube player builds.
    const initial=(globalThis as any).ytInitialPlayerResponse;
    if(initial&&(!pageVideoId||initial.videoDetails?.videoId===pageVideoId))response=initial;
   }
   if(!response?.captions?.playerCaptionsTracklistRenderer?.captionTracks?.length){
    const raw=(globalThis as any).ytplayer?.config?.args?.player_response;
    if(typeof raw==='string'&&raw.length<2000000){try{const candidate=JSON.parse(raw);if(!pageVideoId||candidate.videoDetails?.videoId===pageVideoId)response=candidate;}catch{}}
   }
   const videoId=pageVideoId||response?.videoDetails?.videoId||video.currentSrc||'generic';
   if(c.videoId!==videoId||c.video!==video){c.videoId=videoId;c.video=video;c.cues=[];c.cueStates.clear();c.translations.clear();c.liveText='';c.captionFetch=false;c.captionLoaded=false;c.captionSource='';c.captionReason='';c.nativeCaptionError='';c.nativeTranscriptError='';c.lastCaptionToggle=0;c.captionToggleAttempts=0;c.transcriptAttempts=0;c.lastTranscriptAttempt=0;c.lastCaptionAttempt=0;}
   if(location.hostname.endsWith('youtube.com')){
    const toggle=document.querySelector('.ytp-subtitles-button') as HTMLElement;
    if(toggle?.getAttribute('aria-pressed')==='false'&&toggle.getAttribute('aria-disabled')!=='true'&&video.readyState>=2&&Date.now()-c.lastCaptionToggle>2000&&c.captionToggleAttempts<4){c.lastCaptionToggle=Date.now();c.captionToggleAttempts++;toggle.click();}
    const tracks=response?.captions?.playerCaptionsTracklistRenderer?.captionTracks||[];
    const track=tracks.find((t:any)=>t.languageCode?.startsWith('en')&&t.kind!=='asr')||tracks.find((t:any)=>t.languageCode?.startsWith('en'))||tracks[0];
    const selected=yt?.getOption?.('captions','track');
    if(c.subtitles&&selected?.languageCode?.startsWith('en')&&selected.translationLanguage?.languageCode&&typeof yt?.setOption==='function'&&Date.now()-(c.lastOriginalTrackAttempt||0)>6000){
     const original=tracks.find((t:any)=>t.languageCode===selected.languageCode&&(t.kind||'')===(selected.kind||''))||track;
     if(original){
      c.lastOriginalTrackAttempt=Date.now();
      try{
       // YouTube's saved auto-translation can otherwise replace all English
       // cues with Chinese before the local bilingual translator sees them.
       yt.setOption('captions','track',{languageCode:original.languageCode,kind:original.kind||'',translationLanguage:null});
       c.cues=[];c.cueStates.clear();c.translations.clear();c.captionLoaded=false;c.captionSource='';c.captionFetch=false;c.lastCaptionAttempt=0;
      }catch{/* Keep ordinary captions available if this player lacks track control. */}
     }
    }
    c.captionLang=track?.languageCode||yt?.getOption?.('captions','track')?.languageCode||'';
    if(track&&!c.captionFetch&&!c.captionLoaded&&video.readyState>=2&&Date.now()-(c.lastCaptionAttempt||0)>10000){c.captionFetch=true;c.lastCaptionAttempt=Date.now();const captured=videoId;
     void(async()=>{try{
      const url=new URL(track.baseUrl);if(!/(^|\.)youtube\.com$/.test(url.hostname)||url.protocol!=='https:')throw Error('字幕地址不受支持');url.searchParams.set('fmt','json3');
      const result=await fetch(url.href,{credentials:'include',signal:AbortSignal.timeout(12000)});const body=await result.text();if(body.length>4000000)throw Error('字幕轨道过大');const json=JSON.parse(body);
      const cues=(json.events||[]).filter((e:any)=>e.segs).map((e:any,i:number)=>({id:captured+':'+i,start:e.tStartMs/1000,end:(e.tStartMs+(e.dDurationMs||2000))/1000,text:e.segs.map((s:any)=>s.utf8||'').join('').replace(/\s+/g,' ').trim(),lang:track.languageCode})).filter((q:any)=>q.text);
      if(c.videoId===captured&&cues.length){c.cues=cues;c.captionLoaded=true;}
     }catch(e:any){if(c.videoId===captured){c.captionFetch=false;c.captionFetchError=String(e?.message||e).slice(0,100);c.captionReason='字幕轨道未能读取，正在尝试播放器实时字幕';}}})();
    }
    if(!c.captionLoaded||c.captionSource==='transcript'){
     // Read the site's own transcript panel when timedtext is unavailable.
     // This uses the ordinary page controls, without private APIs or account access.
     const segments=Array.from(document.querySelectorAll('ytd-transcript-segment-renderer,transcript-segment-view-model'));
     const transcript=segments.map(el=>{const stamp=el.querySelector('.segment-timestamp,.ytwTranscriptSegmentViewModelTimestamp')?.textContent?.trim()||'';const text=el.querySelector('.segment-text,span[role="text"]')?.textContent?.replace(/\s+/g,' ').trim()||'';const start=/^\d+(?::\d+){1,2}$/.test(stamp)?stamp.split(':').reduce((n,p)=>n*60+Number(p),0):NaN;return {id:videoId+':transcript:'+start+':'+text,start,end:0,text,lang:c.captionLang};}).filter(q=>q.text&&Number.isFinite(q.start));
     if(transcript.length){
      // New YouTube transcript components can render only part of the list.
      // Keep stable IDs and merge by timestamp so scrolling does not replace cues.
      const merged=new Map<number,any>((c.captionSource==='transcript'?c.cues:[]).map((q:any)=>[q.start,q]));
      for(const q of transcript)merged.set(q.start,q);
      const cues=Array.from(merged.values()).sort((a,b)=>a.start-b.start).slice(0,30000);
      cues.forEach((q,i)=>q.end=cues[i+1]?.start??q.start+5);
      c.cues=cues.filter(q=>q.end>q.start);c.captionLoaded=true;c.captionSource='transcript';c.captionReason='';c.nativeCaptionError='';c.nativeTranscriptError='';
     }
     else if(tracks.length&&video.readyState>=2&&Date.now()-(c.lastTranscriptAttempt||0)>5000&&(c.transcriptAttempts||0)<3){
      c.lastTranscriptAttempt=Date.now();
      const button=Array.from(document.querySelectorAll('button')).find(el=>{const r=el.getBoundingClientRect(),label=(el.getAttribute('aria-label')||'')+' '+el.textContent;return r.width>0&&r.height>0&&!/关闭|關閉|close|hide/i.test(label)&&/show transcript|显示转录|顯示轉錄|文字记录|文字記錄|内容转文字|內容轉文字|转写文稿|轉寫文稿/i.test(label);}) as HTMLElement;
      // Loading an ad can delay the description UI. A missing control must not
      // consume all attempts before the normal video has even started.
      if(button){c.transcriptAttempts=(c.transcriptAttempts||0)+1;button.click();}
      else {
       const expand=Array.from(document.querySelectorAll<HTMLElement>('#description-inline-expander #expand,ytd-watch-metadata #description #expand')).find(el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&!el.hidden;});
       expand?.click();
      }
     }
     const text=Array.from(document.querySelectorAll('.ytp-caption-segment')).map(n=>n.textContent||'').join(' ').trim();
     if(!c.captionLoaded&&text&&text!==c.liveText){c.liveText=text;const at=video.currentTime;const previous=c.cues[c.cues.length-1];if(previous&&at>=previous.start)previous.end=Math.min(previous.end,at);c.cues.push({id:videoId+':live:'+ ++c.serial,start:at,end:at+5,text,lang:c.captionLang});if(c.cues.length>250)c.cues.shift();}
     if(!tracks.length&&!text)c.captionReason='此视频暂无可读取字幕；本版不进行语音识别';
    }
   }else{
    const track=Array.from(video.textTracks).find(t=>t.kind==='subtitles'||t.kind==='captions');
    if(track){if(track.mode==='disabled')track.mode='hidden';c.captionLang=track.language;const cues=Array.from(track.cues||[]) as VTTCue[];if(cues.length)c.cues=cues.map((q,i)=>({id:videoId+':'+i,start:q.startTime,end:q.endTime,text:q.text.replace(/<[^>]+>/g,''),lang:track.language}));}
    else c.captionReason='此播放器未提供可读取的字幕轨道';
   }
  };
  // Skipping and native-caption discovery cannot depend on the translation queue.
  c.youtubeWatchdog=setInterval(()=>{if(!c.active||!c.isYouTube())return;c.skipAd();if(c.subtitles){const video=c.player();if(video&&video.readyState>=2&&!c.adPlaying())void c.refreshCaptions(video);}},300);
 }
 if(command==='configure'){
  const wasActive=c.active;
  if(c.page&&!args.page)c.clearPage();if(c.active&&!args.active)c.resetQueues();
  if(!c.subtitles&&args.subtitles&&!c.cues.length){c.captionFetch=false;c.nativeCaptionError='';c.nativeTranscriptError='';c.lastCaptionToggle=0;c.captionToggleAttempts=0;c.transcriptAttempts=0;c.lastTranscriptAttempt=0;}
  c.page=args.page;c.subtitles=args.subtitles;c.active=args.active;if(typeof args.autoSkipAds==='boolean')c.autoSkipAds=args.autoSkipAds;
  if(c.active)c.skipAd();
  if(!c.active||!c.subtitles){c.overlay?.remove();c.overlay=null;c.restoreNative();}
  if(!c.active)cancelAnimationFrame(c.raf);else if(!wasActive)c.render();
  return true;
 }
 if(command==='apply'){
  if(!c.active)return false;
  if(args.kind==='page'){const item=c.nodes.get(args.id);if(!item||!item.el.isConnected||c.cleanText(item.el)!==item.text)return false;item.status='done';item.translation?.remove();const node=document.createElement('span');node.dataset.qixuUi='translation';node.dataset.qixuTranslation='';node.style.cssText='display:block;margin-top:.35em;color:inherit;font-size:.96em;line-height:1.65;opacity:.92;';node.textContent=args.text;item.el.appendChild(node);item.translation=node;}
  else if(c.cues.some((q:any)=>q.id===args.id)){c.translations.set(args.id,{zh:args.zh,en:args.en});c.cueStates.set(args.id,'done');}
  return true;
 }
 if(command==='retry') {c.resetQueues();return true;}
 if(command==='importCaptions'){
  if(c.videoId&&args.videoId&&c.videoId!==args.videoId)return false;
  if(/^en([-_]|$)/i.test(args.originalLanguage||'')&&!/^en([-_]|$)/i.test(args.language||''))return false;
  if(args.videoId)c.videoId=args.videoId;c.video=c.player();c.cues=args.cues;c.cueStates.clear();c.captionLang=args.language;c.captionLoaded=true;c.nativeCaptionError='';return true;
 }
 if(command==='captionError'){if(args.source==='transcript')c.nativeTranscriptError=args.message;else c.nativeCaptionError=args.message;return true;}
 if(command==='skip'){if(args.kind==='page'){const item=c.nodes.get(args.id);if(item)item.status='done';}else{const cue=c.cues.find((q:any)=>q.id===args.id);if(cue)cue.skip=true;c.cueStates.set(args.id,'done');}return true;}
 if(command!=='collect'||!c.active)return {pages:[],captions:[],reason:''};
 c.skipAd();
 const pages:any[]=[];
 if(c.page){
  for(const [id,item] of c.nodes)if(!item.el.isConnected)c.nodes.delete(id);
  const selectors='p,h1,h2,h3,h4,h5,h6,li,figcaption,div,span,a,[role="heading"],yt-formatted-string#video-title,yt-attributed-string#video-title';
  const candidates=Array.from(document.querySelectorAll(selectors));
  for(const el of candidates){if(pages.length>=(args.pageBudget??3))break;if(el.closest('[data-qixu-ui],script,style,form,[role="dialog"],[contenteditable],input,textarea,select,code,pre,button,[role="button"],.ytp-caption-window-container')||el.querySelector('input,textarea,select,[contenteditable],p,h1,h2,h3,h4,h5,h6,li,div,span:not([data-qixu-ui]),a,[role="heading"]'))continue;
   const r=el.getBoundingClientRect();if(r.width<2||r.height<2||r.bottom<0||r.top>innerHeight+200)continue;
   const text=c.cleanText(el);if(text.length<8||text.length>1800||!/[\p{L}]/u.test(text))continue;
   let item=Array.from(c.nodes.values()).find((n:any)=>n.el===el) as any;
   if(item&&item.text!==text){item.translation?.remove();item.text=text;item.status='new';}
   if(!item){item={id:'p'+ ++c.serial,el,text,status:'new'};c.nodes.set(item.id,item);}
   if(item.status==='new'){item.status='queued';pages.push({id:item.id,text,lang:el.closest('[lang]')?.getAttribute('lang')||document.documentElement.lang});}
  }
 }
 const video=c.player();let captions:any[]=[];
 // Keep nearby subtitle results; seeking back reuses the bounded host cache.
 const keep=new Set(c.cues.filter((q:any)=>video&&q.end>=video.currentTime-90&&q.start<=video.currentTime+120).map((q:any)=>q.id));let captionBytes=0;
 for(const [id,value] of [...c.translations].reverse()){captionBytes+=((value.zh?.length||0)+(value.en?.length||0))*2;if((!keep.has(id)&&c.translations.size>400)||captionBytes>512*1024){c.translations.delete(id);c.cueStates.delete(id);}}
 for(const id of c.cueStates.keys())if(!keep.has(id)&&!c.translations.has(id))c.cueStates.delete(id);
 for(const [id,item] of c.nodes)if(!item.el.isConnected)c.nodes.delete(id);
 while(c.nodes.size>800){const id=c.nodes.keys().next().value;c.nodes.get(id)?.translation?.remove();c.nodes.delete(id);}
 if(c.subtitles&&video&&!c.adPlaying()){c.refreshCaptions(video);captions=c.cues.filter((q:any)=>q.end>=video.currentTime&&q.start<=video.currentTime+30&&!c.cueStates.has(q.id)).slice(0,args.captionBudget??6);for(const cue of captions)c.cueStates.set(cue.id,'queued');}
 if(c.adPlaying())return {pages,captions:[],reason:'广告播放中，正片开始后显示双语字幕',pageLanguage:document.documentElement.lang};
 return {pages,captions,reason:c.subtitles?(video?(c.cues.length?(c.translations.size?'双语字幕已开启':'字幕已读取，正在本地翻译…'):c.nativeTranscriptError||c.nativeCaptionError||c.captionReason||'正在读取视频字幕'):'等待选择视频'):'双语字幕已关闭',pageLanguage:document.documentElement.lang};
}
export function translationPageScript(command:string,args:any={}) {return `(${browserController.toString()})(${JSON.stringify(command)},${JSON.stringify(args)})`;}
