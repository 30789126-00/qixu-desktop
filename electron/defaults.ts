import type { Settings, Source } from '../shared/types';
export const defaultSettings: Settings = { theme: 'system', opacity: 1, alwaysOnTop: false, autoHide: true, shortcut: 'Ctrl+Alt+Space', launchAtLogin: false, fontSize: 20, lineHeight: 1.9, readerWidth: 720, readerTheme: 'sepia', scrollSpeed: 25, autoTranslate:true,bilingualSubtitles:true,translationDisabledSites:[],autoSkipYouTubeAds:true,narrationVoice:'',narrationRate:0,narrationContinueHidden:false };
export const aikanSource: Source = { id:'aikan', title:'爱看', url:'https://ikapp.com/', kind:'video', color:'#9474e8', abbr:'爱' };
export function ensurePermanentSources(sources:Source[]):Source[]{
 const found=sources.findIndex(s=>s.id==='aikan'||new URL(s.url).hostname.replace(/^www\./,'')==='ikapp.com');
 const result=sources.map(s=>({...s}));
 if(found<0)result.push({...aikanSource});else result[found]={...aikanSource};
 return result;
}
export const defaultSources: Source[] = [
  aikanSource,
  { id: 'bilibili', title: '哔哩哔哩', url: 'https://www.bilibili.com/', kind: 'video', color: '#ec79a5', abbr: '哔' },
  { id: 'youtube', title: 'YouTube', url: 'https://www.youtube.com/', kind: 'video', color: '#ed6267', abbr: '▶' },
  { id: 'fanqie', title: '番茄小说', url: 'https://fanqienovel.com/', kind: 'novel', color: '#ee8565', abbr: '番' },
  { id: 'google', title: 'Google 浏览器', url: 'https://www.google.com/', kind: 'video', color: '#4285f4', abbr: 'G' },
  { id: 'yandex', title: 'Yandex 浏览器', url: 'https://yandex.com/', kind: 'video', color: '#ef4444', abbr: 'Y' }
];
export function migrateSources13(sources:Source[]):Source[]{
 const result=sources.filter(source=>!['douyin','ixigua','haokan','wikisource'].includes(source.id)&&!/(^|\.)(douyin\.com|ixigua\.com|haokan\.baidu\.com|wikisource\.org)$/.test(new URL(source.url).hostname));
 return ensurePermanentSources(result);
}
export function safeUrl(value: string, testing = false): string {
  const url = new URL(value.includes('://') ? value : `https://${value}`);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && (testing || !['localhost', '127.0.0.1'].includes(url.hostname)))) throw new Error('请使用有效的 http 或 https 网站地址');
  if (url.username || url.password) throw new Error('网址不能包含用户名或密码');
  return url.toString();
}
export function clamp(n: unknown, min: number, max: number, fallback: number) { return typeof n === 'number' && Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback; }
export function sanitizeSettings(input: Partial<Settings>, base = defaultSettings): Settings {
  return { theme: ['system','light','dark'].includes(input.theme!) ? input.theme! : base.theme,
    opacity: clamp(input.opacity,.2,1,base.opacity), alwaysOnTop: typeof input.alwaysOnTop === 'boolean' ? input.alwaysOnTop : base.alwaysOnTop,
    autoHide: typeof input.autoHide === 'boolean' ? input.autoHide : base.autoHide, shortcut: typeof input.shortcut === 'string' && input.shortcut.length < 80 ? input.shortcut : base.shortcut,
    launchAtLogin: typeof input.launchAtLogin === 'boolean' ? input.launchAtLogin : base.launchAtLogin,
    fontSize: clamp(input.fontSize,14,40,base.fontSize), lineHeight: clamp(input.lineHeight,1.2,2.8,base.lineHeight), readerWidth: clamp(input.readerWidth,320,1100,base.readerWidth),
    readerTheme: ['light','sepia','dark'].includes(input.readerTheme!) ? input.readerTheme! : base.readerTheme,
    scrollSpeed: clamp(input.scrollSpeed,5,100,base.scrollSpeed),
    autoTranslate:typeof input.autoTranslate==='boolean'?input.autoTranslate:base.autoTranslate,
    bilingualSubtitles:typeof input.bilingualSubtitles==='boolean'?input.bilingualSubtitles:base.bilingualSubtitles,
    autoSkipYouTubeAds:typeof input.autoSkipYouTubeAds==='boolean'?input.autoSkipYouTubeAds:base.autoSkipYouTubeAds,
    narrationVoice:typeof input.narrationVoice==='string'&&input.narrationVoice.length<=200?input.narrationVoice:base.narrationVoice,
    narrationRate:Math.round(clamp(input.narrationRate,-5,5,base.narrationRate)),
    narrationContinueHidden:typeof input.narrationContinueHidden==='boolean'?input.narrationContinueHidden:base.narrationContinueHidden,
    translationDisabledSites:Array.isArray(input.translationDisabledSites)?[...new Set(input.translationDisabledSites.filter(s=>typeof s==='string'&&/^[a-z0-9.-]+$/i.test(s)).slice(0,200))]:base.translationDisabledSites };
}
