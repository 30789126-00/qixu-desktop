import { app, BrowserWindow, WebContentsView, ipcMain, screen, globalShortcut, nativeTheme, Tray, Menu, nativeImage, dialog, shell, powerMonitor, session, Notification, net } from 'electron';
import type { Rectangle, WebContents } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import JSZip from 'jszip';
import {SaveCoordinator} from './save-coordinator';
import {WindowDiagnostics} from './window-diagnostics';
import {videoIdentity,progressId,recordVideo,sanitizeVideoProgress} from './video-progress';
import {YouTubePlaybackRecovery} from './youtube-recovery';
import {epubMetadata} from './book-metadata';
import {BoundedCache} from '../shared/bounded-cache';
import {BackupService} from './backups';
import {UpdateService,installHelper} from './updates';
import {spawn} from 'node:child_process';
import type {VideoProgress} from '../shared/types';
import type { AppState, Book, Settings, Source, Rect, WindowState, ResumeState, BrowserTab, BrowserHistoryEntry, BrowserBookmark, MediaState } from '../shared/types';
import { defaultSettings, defaultSources, sanitizeSettings, safeUrl, clamp, migrateSources13, ensurePermanentSources } from './defaults';
import { controlMedia } from './media';
import { loadBossKey, normalizeBossShortcut, createPasswordRecord, verifyBossPassword, type BossKeyConfig } from './boss-key';
let bossKeyConfig:BossKeyConfig=loadBossKey(null,false);
import { TodoHost } from './todo-host';
import { readStartup,writeStartup,reconcileStartup } from './startup';
import { EventEmitter } from 'node:events';
import { TranslationService } from './translation-service';
import { BrowserTranslator } from './translation-browser';
import { attachYouTubeCaptions, YouTubeCaptionActivator } from './youtube-captions';
import { YouTubeAdSkipper } from './youtube-ads';
import { BilibiliPlayerControls } from './bilibili-controls';
import { YouTubePlayerControls } from './youtube-controls';
import { emptyNarration, NarrationService } from './narration';
import { SITE_COOLDOWN_MS, sanitizeCooldowns, cooldownMessage } from './site-cooldown';
import {isLoginPopup,isVideoLink} from './navigation';
import { emptyResumeState, sanitizeResumeState, checkpoint, type SessionCheckpoint } from './recovery';
import { loadDurableState, saveDurableState } from './state-store';
import { modeFields, transitionWindowMode, type WindowEvent, type WindowMode } from './window-machine';
import {fitWindow} from './window-geometry';

const testing = process.env.MOYU_TEST === '1';
const skipTodoHostForTests = testing && process.env.QIXU_TEST_SKIP_TODO_HOST === '1';
const manageLoginItems=!testing||process.env.QIXU_TEST_LOGIN_ITEMS==='1';
const dataDir = process.env.MOYU_DATA_DIR || path.join(app.getPath('appData'), 'Moyu');
app.setPath('userData', dataDir);
app.setAppUserModelId('com.moyu.desktop');
const state: AppState = { maintenanceOpen:false,save:{status:'saved',lastSaved:0,attempt:0,error:''}, bossKeyPanel:false, bossKey:{configured:false,shortcutConfigured:false,passwordRequired:true}, access:'todo', todoReady:false, settings: defaultSettings, sources: defaultSources, books: [], section:'video', activeSourceId:null, activeTabId:null, browserTabs:[], browserHistory:[], browserBookmarks:[], windowState:'visible', fullscreen:false,
  media:{ url:'', title:'', loading:false, error:'', playing:null, muted:false, status:'' }, notice:'',loginMode:false,translation:{model:'idle',page:'',subtitles:'',error:'',completed:0},narration:emptyNarration(),resume:{...emptyResumeState} };
let windowMode:WindowMode='todo';
let win: BrowserWindow;
let tray: Tray;
let mediaView: WebContentsView | null = null;
let controlsView:WebContentsView|null=null;
let recoveryRegions:Rectangle[]=[];
let viewport: Rect | null = null;
let rememberedBounds: Rectangle | undefined;
let playerFullscreenBounds: Rectangle | null = null;
let quitting = false;
let hideArmed = false;
let graceUntil = Date.now() + 2500;
const POINTER_VERIFY_MS = 35;
const AUTO_RESTORE_VERIFY_MS = 45;
const RESTORE_GRACE_MS = 220;
let pendingAutoHide: NodeJS.Timeout | undefined;
let pendingAutoRestore: NodeJS.Timeout | undefined;
let pendingBlurHide: NodeJS.Timeout | undefined;
let blurAutoHidden = false;
let restoreNeedsExit = false;
let fullscreenPending = false;
let dialogDepth = 0;
let transitionVersion = 0;
let progressFlushUntil=0;
let saveTimer: NodeJS.Timeout | undefined;
let persistQueue: Promise<void> = Promise.resolve();
let checkpointTimer:NodeJS.Timeout|undefined;
let checkpointQueue:Promise<void>=Promise.resolve();
let pendingMediaRestore:{time:number;autoplay:boolean}|null=null;
let statusBusy = false;
let widgetHovered=false;
let activePlatform = 'generic';
let sourceCooldowns:Record<string,number>={};
type RuntimeBrowserTab={id:string;sourceId:string;platform:string;view:WebContentsView;sleeping?:boolean;lastActive?:number;time?:number;restorePending?:boolean;seekVersion?:number;youtubeRecovery?:YouTubePlaybackRecovery;media:MediaState;mobile:boolean;desktopUA:string;resumeOnActivate:boolean};
let videoPositions:VideoProgress[]=[];
const diagnostics=new WindowDiagnostics();
const coverCache=new BoundedCache<string>(100,3*1024*1024,s=>s.length*2);
const backups=new BackupService(dataDir,app.getVersion());
const updates=new UpdateService(path.join(dataDir,'updates'),app.getVersion(),(input,init)=>net.fetch(input as string,init),testing?process.env.QIXU_UPDATE_FEED:undefined);
const maintenanceMethods=new Set(['getMaintenance','retrySave','createBackup','previewRestore','restoreBackup','exportDiagnostics','checkUpdates','downloadUpdate','installUpdate']);
const stateWriter=new SaveCoordinator<any>(async value=>{try{await saveDurableState(settingsPath,value);await fs.rm(settingsPath+'.pending',{force:true});}catch(error){await fs.writeFile(settingsPath+'.pending',JSON.stringify(value)).catch(()=>{});throw error;}},()=>{state.save={...stateWriter.state};if(win&&!win.isDestroyed())emit();});
const runtimeTabs=new Map<string,RuntimeBrowserTab>();
const tabOrder:string[]=[];
let activeTabId:string|null=null;
const MAX_BROWSER_TABS=10;
const MOBILE_UA='Mozilla/5.0 (Linux; Android 15; Pixel 9 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
const popups = new Set<BrowserWindow>();
const hiddenPopups = new Set<BrowserWindow>();
const sessionsConfigured = new Set<string>();
const libraryPath = path.join(dataDir,'library');
const settingsPath = path.join(dataDir,'state.json');
const sessionPath = path.join(dataDir,'session.json');
const packagedUiRoot = app.isPackaged ? path.join(process.resourcesPath,'ui') : null;
const preload = packagedUiRoot ? path.join(packagedUiRoot,'preload.cjs') : path.join(__dirname,'preload.cjs');
const homeFile = packagedUiRoot ? path.join(packagedUiRoot,'index.html') : path.join(__dirname,'../dist/index.html');
const homeUrl = pathToFileURL(homeFile).href;
const fullscreenControlsFile = packagedUiRoot ? path.join(packagedUiRoot,'fullscreen-controls.html') : path.join(__dirname,'../assets/fullscreen-controls.html');
const fullscreenControlsUrl = pathToFileURL(fullscreenControlsFile).href;
const overlayPreload = packagedUiRoot ? path.join(packagedUiRoot,'overlay-preload.cjs') : path.join(__dirname,'overlay-preload.cjs');

function isSameLocalFile(url:string,file:string){
  try{return path.resolve(fileURLToPath(url)).toLowerCase()===path.resolve(file).toLowerCase();}
  catch{return false;}
}

function syncMode(){const fields=modeFields(windowMode);state.access=fields.access;state.windowState=fields.windowState;}
function transition(event:WindowEvent){const done=diagnostics.begin('transition',windowMode);windowMode=transitionWindowMode(windowMode,event);syncMode();narrator.sync();done();}
function updateResume(patch:Partial<ResumeState>,immediate=false){state.resume={...state.resume,...patch,recoveredAfterCrash:state.resume.recoveredAfterCrash};narrator.sync();persist(immediate);checkpointSession(false,immediate);}
function checkpointSession(cleanExit=false,immediate=false){
  clearTimeout(checkpointTimer);
  const write=()=>{const snapshot=checkpoint(state.resume,cleanExit);checkpointQueue=checkpointQueue.then(()=>saveDurableState(sessionPath,snapshot)).catch(()=>{});};
  if(immediate)write();else checkpointTimer=setTimeout(write,700);
}
const todoHost=new TodoHost(command=>{
  if(narrator.receive(command))return;
  if(command==='UNLOCK'&&(!bossKeyConfig.configured||bossKeyConfig.legacyCtrlAlt||state.settings.shortcut==='Ctrl+Alt'))togglePrivate();
  else if(command==='HOTKEY_FAILED'){notice('Ctrl+Alt 全局监听未能启动，请使用托盘打开待办。');todoHost.send('STATUS:'+state.notice);}
  else if(command==='SHOW_TODO')showTodo();
  else if(command==='BOSS_KEY_SETTINGS')openBossKeySettings();
  else if(command==='MAINTENANCE')void openMaintenance();
  else if(command.startsWith('WIDGET_HOVER:'))widgetHovered=command.endsWith(':1');
  else if(testing&&command.startsWith('TEST_WINDOWS:'))app.emit('qixu:test-native-windows',command.slice(13));
  else if(testing&&command.startsWith('TEST_BOSS_KEY_VISIBLE:'))app.emit('qixu:test-boss-key-visible',command.endsWith(':1'));
  else if(command==='QUIT'){if(!quitting)app.quit();}
  else if(command==='STARTUP_QUERY'){if(manageLoginItems&&app.isPackaged){try{state.settings.launchAtLogin=readStartup(app,process.execPath).enabled;persist();emit();}catch(error:any){todoHost.send('STATUS:'+error.message);}}todoHost.send('STARTUP:'+(state.settings.launchAtLogin?'1':'0'));}
  else if(command==='STARTUP_ON'||command==='STARTUP_OFF')void updateSettings({launchAtLogin:command==='STARTUP_ON'}).catch(error=>{todoHost.send('STATUS:'+error.message);todoHost.send('STARTUP:'+(state.settings.launchAtLogin?'1':'0'));});
  else if(command.startsWith('REMINDER:')&&Notification.isSupported())new Notification({title:'栖序 · 待办提醒',body:command.slice(9)}).show();
},()=>{if(!quitting)app.quit();});
const allTabContents=()=>tabOrder.map(id=>runtimeTabs.get(id)).filter((tab):tab is RuntimeBrowserTab=>!!tab&&!tab.view.webContents.isDestroyed()).map(tab=>tab.view.webContents);
const allContents = (): WebContents[] => [ ...allTabContents(), ...[...popups].filter(p=>!p.isDestroyed()).map(p=>p.webContents) ];
const isBlocked = () => state.access!=='private'||state.windowState !== 'visible' || state.section !== 'video' || !viewport;
const isTabBlocked=(tabId:string)=>isBlocked()||activeTabId!==tabId;
const translator=new TranslationService(app.isPackaged?path.join(process.resourcesPath,'models'):path.join(__dirname,'../models'),(model,error)=>{state.translation.model=model;if(error)state.translation.error=error;emit();},path.join(dataDir,'cache','translation-v1.json'));
const browserTranslator=new BrowserTranslator(translator,patch=>{Object.assign(state.translation,patch);emit();},()=>!isBlocked());
const youtubeAdSkipper=new YouTubeAdSkipper();
const youtubeCaptionActivator=new YouTubeCaptionActivator();
const bilibiliPlayerControls=new BilibiliPlayerControls();
const youtubePlayerControls=new YouTubePlayerControls();
const narrator=new NarrationService(command=>todoHost.send(command),()=>({unlocked:state.access==='private',bookId:state.section==='library'?state.resume.activeBookId:null,visible:state.windowState==='visible',suspended:state.windowState==='suspended',continueHidden:state.settings.narrationContinueHidden,voice:state.settings.narrationVoice,rate:state.settings.narrationRate,sleepMinutes:state.settings.narrationSleepMinutes}),()=>{state.narration=narrator.state;emit();});
const popupTranslators=new Map<BrowserWindow,BrowserTranslator>();
function cancelBrowserTranslation(){browserTranslator.cancel();for(const controller of popupTranslators.values())controller.cancel();}
async function flushSessions(){await Promise.allSettled([...sessionsConfigured].map(async partition=>{const s=session.fromPartition(partition);s.flushStorageData();await s.cookies.flushStore();}));}
function loginDiagnostic(event:string,code?:number){if(testing)return;void fs.mkdir(dataDir,{recursive:true}).then(()=>fs.appendFile(path.join(dataDir,'login-diagnostics.log'),JSON.stringify({at:new Date().toISOString(),source:state.activeSourceId,event,code})+'\n')).catch(()=>{});}
function playbackDiagnostic(event:string,url:string,attempt:number,reason=''){
 if(testing)return;
 // Only a hash is persisted, not the video URL, cookies, or its request data.
 let video='';try{video=progressId(url).slice(0,12);}catch{}
 void fs.mkdir(dataDir,{recursive:true}).then(()=>fs.appendFile(path.join(dataDir,'playback-diagnostics.log'),JSON.stringify({at:new Date().toISOString(),platform:'youtube',event,video,attempt,reason})+'\n')).catch(()=>{});
}
function publicState():AppState {return state.access==='private'?state:{...state,sources:[],books:[],activeSourceId:null,activeTabId:null,browserTabs:[],browserHistory:[],browserBookmarks:[],fullscreen:false,notice:'',loginMode:false,translation:{model:'idle',page:'',subtitles:'',error:'',completed:0},media:{url:'',title:'',loading:false,error:'',playing:null,muted:true,status:''},resume:{...emptyResumeState}};}
function emit() { if (win && !win.isDestroyed()) win.webContents.send('moyu:state', publicState());if(controlsView&&!controlsView.webContents.isDestroyed())controlsView.webContents.send('qixu:controls-state',{playing:state.media.playing,muted:state.media.muted});if(tray&&!tray.isDestroyed())tray.setToolTip(state.access==='private'?'栖序 · 单击恢复当前影音／小说，保留进度':'栖序 · 今日待办'); }
function showTodo(message='',background=false) {
  state.maintenanceOpen=false;
  state.bossKeyPanel=false;
  if(!win||win.isDestroyed())return;
  clearPointerTransitionTimers();
  if(pendingBlurHide)clearTimeout(pendingBlurHide);
  blurAutoHidden=false;restoreNeedsExit=false;
  ++transitionVersion;pauseAll();
  translator.stop();state.translation.model='idle';
  state.loginMode=false;void flushSessions();
  if(state.access==='private')progressFlushUntil=Date.now()+1500;
  if(state.access==='private'&&!state.fullscreen)rememberedBounds=win.getBounds();
  if(state.activeSourceId)updateResume({section:state.section,activeSourceId:state.activeSourceId,mediaUrl:state.media.url,mediaWasPlaying:state.resume.mediaWasPlaying},true);
  for(const popup of popups)if(!popup.isDestroyed()){hiddenPopups.add(popup);popup.hide();}
  if(state.fullscreen)void fullscreen(false);
  transition('SHOW_TODO');viewport=null;
  mediaView?.setVisible(false);
  controlsView?.setVisible(false);win.hide();win.setSkipTaskbar(true);todoHost.send(background?'HIDE_ALL':'SHOW');if(message)todoHost.send('STATUS:'+message);emit();persist();
}
function requestUnlock() {
  state.bossKeyPanel=false;
  if(state.access==='private')return;
  if(bossKeyConfig.configured&&!bossKeyConfig.passwordRequired){transition('REQUEST_UNLOCK');void enterPrivate();return;}
  if(state.access!=='prompt'){transition('REQUEST_UNLOCK');win.setOpacity(1);win.setAlwaysOnTop(true);win.setBounds(visibleBounds({ ...win.getBounds(),width:bossKeyConfig.configured?480:560,height:bossKeyConfig.configured?360:680}));win.center();win.setSkipTaskbar(true);emit();}
  win.show();win.focus();
}
function openBossKeySettings(){
 if(bossKeyConfig.shortcutConfigured)return;
 showTodo();state.bossKeyPanel=true;win.setTitle('栖序 · 老板键');win.setOpacity(1);win.setAlwaysOnTop(false);win.setBounds(visibleBounds({...win.getBounds(),width:560,height:720}));win.center();win.setSkipTaskbar(false);emit();win.show();win.focus();
}
function togglePrivate(){
  if(state.bossKeyPanel){showTodo();return;}
  if(state.access!=='private'){requestUnlock();return;}
  if(state.windowState!=='visible')restore();
  else hidePrivate();
}
function hidePrivate(){hide('panicHidden');win.setSkipTaskbar(true);}
async function submitPassword(password:unknown) {
  if(state.access!=='prompt')throw new Error('请先使用切换快捷键打开访问验证');
  if(!bossKeyConfig.configured)throw Error('请先完成老板键设置');
  if(!await verifyBossPassword(password,bossKeyConfig)){showTodo('已返回待办。');return false;}
  return enterPrivate();
}
async function enterPrivate(){
  blurAutoHidden=false;restoreNeedsExit=false;
  transition('UNLOCK_OK');state.section=state.resume.section;state.activeSourceId=state.resume.activeSourceId;todoHost.send('ENTER_PRIVATE');win.setSkipTaskbar(false);
  setWindowBoundsExact(visibleBounds(rememberedBounds));win.setOpacity(state.settings.opacity);win.setAlwaysOnTop(state.settings.alwaysOnTop);
  graceUntil=Date.now()+RESTORE_GRACE_MS;emit();win.show();win.focus();
  hideArmed=pointerInsideVisibleApp(screen.getCursorScreenPoint());
  for(const popup of hiddenPopups)if(!popup.isDestroyed())popup.showInactive();hiddenPopups.clear();
  if(state.section==='video'&&state.activeSourceId){
    if(!mediaView)await openSource(state.activeSourceId,state.resume.mediaUrl||undefined,true);
    else {layout();setAudioGuard();void resumeMedia();}
  }
  return true;
}
function notice(text: string) { state.notice = text; emit(); }
async function flushUserData(){if(win&&!win.isDestroyed())await win.webContents.executeJavaScript(`new Promise(resolve=>{window.dispatchEvent(new CustomEvent('moyu:flush-progress',{detail:resolve}));setTimeout(resolve,800);})`).catch(()=>{});if(!await todoHost.flush())throw Error('待办尚未保存，请在待办中重试保存后再继续');persist(true);checkpointSession(false,true);await Promise.all([persistQueue,checkpointQueue]);if(stateWriter.hasPending)throw Error('设置或进度尚未保存，请重试保存后再继续');}
async function openMaintenance(){await flushUserData().catch(error=>notice(error.message));showTodo('',true);state.maintenanceOpen=true;win.setTitle('栖序 · 数据与版本');win.setOpacity(1);win.setAlwaysOnTop(false);win.setBounds(visibleBounds({...win.getBounds(),width:920,height:740}));win.setSkipTaskbar(false);emit();win.show();win.focus();}
function restartForMaintenance(){if(testing){app.emit('qixu:test-restart-request');return;}app.relaunch();app.quit();}
async function createBackup(includeAccounts:boolean){await flushUserData();dialogDepth++;try{const selected=await dialog.showOpenDialog(win,{title:'选择备份保存位置（将在其中创建新文件夹）',properties:['openDirectory','createDirectory']});if(selected.canceled||!selected.filePaths[0])return null;const folder=path.join(selected.filePaths[0],'栖序备份-'+Date.now()+'-'+randomUUID().slice(0,8));if(includeAccounts===true){await flushSessions();await saveDurableState(path.join(dataDir,'.maintenance','pending-backup.json'),{folder});setTimeout(restartForMaintenance,200);return {path:folder,files:0,bytes:0,pendingRestart:true};}return await backups.create(folder,false);}finally{dialogDepth--;}}
async function previewRestore(pointId?:string){await flushUserData();dialogDepth++;try{let folder:string;if(pointId!==undefined){if(!/^[-\w]{1,100}$/.test(pointId))throw Error('回滚点无效');folder=path.join(dataDir,'restore-points',pointId);}else{const selected=await dialog.showOpenDialog(win,{title:'选择含 manifest.json 的栖序备份文件夹',properties:['openDirectory']});if(selected.canceled||!selected.filePaths[0])return null;folder=selected.filePaths[0];}return await backups.preview(folder);}finally{dialogDepth--;}}
async function exportDiagnostics(){dialogDepth++;try{const result=await dialog.showSaveDialog(win,{title:'导出窗口性能诊断',defaultPath:'栖序窗口诊断.json',filters:[{name:'JSON',extensions:['json']}]});if(result.canceled||!result.filePath)return null;await fs.writeFile(result.filePath,JSON.stringify({version:app.getVersion(),...diagnostics.snapshot()},null,2));return result.filePath;}finally{dialogDepth--;}}
async function installUpdate(id?:string){const installer=await updates.installer(id);await flushUserData();if(!app.isPackaged&&!testing)throw Error('请在安装版使用升级功能');await backups.create(path.join(dataDir,'restore-points','update-'+Date.now()+'-'+randomUUID()),false);await flushSessions();if(testing){app.emit('qixu:test-install-request',installer);return;}const helper=path.join(dataDir,'updates','install-helper.cjs');await fs.writeFile(helper,installHelper);const child=spawn(process.execPath,[helper,installer.path,installer.sha256,String(process.pid),process.execPath,path.join(dataDir,'updates','install-result.json')],{detached:true,stdio:'ignore',windowsHide:true,env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}});await new Promise<void>((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();app.quit();}
function persist(immediate=false) {
  clearTimeout(saveTimer);
  const write = () => {
    const snapshot = structuredClone({ settings:state.settings, bossKey:bossKeyConfig, sources:state.sources, books:state.books, bounds:rememberedBounds,sourceCooldowns,sourceRevision:13,stateRevision:19,resume:state.resume,browserHistory:state.browserHistory,browserBookmarks:state.browserBookmarks,videoPositions });
    persistQueue=stateWriter.schedule(snapshot);
  };
  if(immediate)write(); else saveTimer=setTimeout(write,350);
}
async function load() {
  await fs.mkdir(libraryPath,{recursive:true});
  try {
    let loaded=await loadDurableState(settingsPath);try{const [pending,current]=await Promise.all([fs.stat(settingsPath+'.pending'),fs.stat(settingsPath).catch(()=>null)]);if(pending.mtimeMs>(current?.mtimeMs||0)){const rescue=JSON.parse(await fs.readFile(settingsPath+'.pending','utf8'));if(rescue&&Array.isArray(rescue.books)&&rescue.settings)loaded={data:rescue,recoveredFrom:'state.json.pending'};}}catch{}const saved:any=loaded.data||{};
    state.settings=sanitizeSettings(saved.settings||{});diagnostics.setEnabled(state.settings.diagnosticsEnabled);videoPositions=sanitizeVideoProgress(saved.videoPositions);
    bossKeyConfig=loadBossKey(saved.bossKey,!!loaded.data||(testing&&process.env.QIXU_TEST_FIRST_RUN!=='1'));
    state.bossKey={configured:bossKeyConfig.configured,shortcutConfigured:bossKeyConfig.shortcutConfigured,passwordRequired:bossKeyConfig.passwordRequired};
    sourceCooldowns=sanitizeCooldowns(saved.sourceCooldowns);
    if(Array.isArray(saved.sources))state.sources=validateSources(saved.sources);
    if(saved.sourceRevision!==13)state.sources=migrateSources13(state.sources);
    state.sources=ensurePermanentSources(state.sources);
    if(Array.isArray(saved.books))state.books=saved.books.filter((b:Book)=>/^[a-f0-9]{24}$/.test(b.id) && ['txt','epub'].includes(b.type)).map((b:Book)=>({...b,bookmarks:Array.isArray(b.bookmarks)?b.bookmarks:[],progress:b.progress||null}));
    if(Array.isArray(saved.browserHistory))state.browserHistory=saved.browserHistory.filter((entry:any)=>entry&&typeof entry.id==='string'&&typeof entry.sourceId==='string'&&typeof entry.title==='string'&&typeof entry.url==='string'&&Number.isFinite(entry.visitedAt)&&state.sources.some(source=>source.id===entry.sourceId)).slice(0,300).flatMap((entry:any)=>{try{return [{id:entry.id.slice(0,80),sourceId:entry.sourceId,title:entry.title.slice(0,180),url:safeUrl(entry.url,testing),visitedAt:entry.visitedAt} as BrowserHistoryEntry];}catch{return [];}});
    if(Array.isArray(saved.browserBookmarks))state.browserBookmarks=saved.browserBookmarks.filter((entry:any)=>entry&&typeof entry.id==='string'&&typeof entry.sourceId==='string'&&typeof entry.title==='string'&&typeof entry.url==='string'&&Number.isFinite(entry.addedAt)&&state.sources.some(source=>source.id===entry.sourceId)).slice(0,200).flatMap((entry:any)=>{try{return [{id:entry.id.slice(0,80),sourceId:entry.sourceId,title:entry.title.slice(0,180),url:safeUrl(entry.url,testing),addedAt:entry.addedAt} as BrowserBookmark];}catch{return [];}});
    if(saved.bounds && ['x','y','width','height'].every(k=>Number.isFinite(saved.bounds[k])))rememberedBounds=saved.bounds;
    state.resume=sanitizeResumeState(saved.resume,state.sources,state.books);
    if(state.resume.activeSourceId&&state.resume.mediaUrl&&state.resume.mediaTime>0&&!videoPositions.some(item=>item.id===progressId(state.resume.mediaUrl)))videoPositions=recordVideo(videoPositions,{sourceId:state.resume.activeSourceId,url:state.resume.mediaUrl,title:'上次观看',time:state.resume.mediaTime,duration:0,at:Date.now()});
    if(loaded.recoveredFrom)state.notice=`检测到上次状态文件异常，已从 ${loaded.recoveredFrom} 自动恢复。`;
    const sessionLoaded=await loadDurableState(sessionPath);const sessionSaved=sessionLoaded.data as Partial<SessionCheckpoint>|null;
    if(sessionSaved?.schema===1&&sessionSaved.resume){state.resume=sanitizeResumeState(sessionSaved.resume,state.sources,state.books);if(sessionSaved.cleanExit===false)state.resume.recoveredAfterCrash=true;}
  }catch{ state.notice='上次配置未能读取，已使用默认设置。原书库文件仍保留。'; }
}
function validateSources(input: unknown): Source[] {
  if(!Array.isArray(input)||input.length>80)throw new Error('来源最多支持 80 个');
  const ids=new Set<string>();
  return input.map((s:any)=>{
    if(typeof s.id!=='string'||!/^[\w-]{1,60}$/.test(s.id)||ids.has(s.id))throw new Error('来源标识无效或重复');
    ids.add(s.id);
    if(typeof s.title!=='string'||!s.title.trim()||s.title.length>60)throw new Error('请输入来源名称');
    return {id:s.id,title:s.title.trim(),url:safeUrl(String(s.url),testing),kind:s.kind==='novel'?'novel':'video',color:/^#[0-9a-f]{6}$/i.test(s.color)?s.color:'#6b79e8',abbr:String(s.abbr||s.title[0]).slice(0,3)};
  });
}
function mediaIdentity(value:string){
  try{return videoIdentity(value);}catch{return value;}
}
function runtimeTab(id:string|null=activeTabId){return id?runtimeTabs.get(id)||null:null;}
function rememberVideo(tab:RuntimeBrowserTab,value:{currentTime:number;duration:number;adPlaying?:boolean}){
 if(tab.sleeping||tab.restorePending||value.adPlaying||!Number.isFinite(value.currentTime))return;tab.time=Math.max(0,value.currentTime);
 const previous=videoPositions.find(item=>item.id===progressId(tab.media.url));if(previous&&Math.abs(previous.time-tab.time)<1&&Date.now()-previous.at<30000)return;
 videoPositions=recordVideo(videoPositions,{sourceId:tab.sourceId,url:tab.media.url,title:tab.media.title,time:tab.time,duration:Math.max(0,value.duration||0),at:Date.now()});persist();
}
function prepareVideoNavigation(tab:RuntimeBrowserTab,url:string){if(mediaIdentity(tab.media.url)===mediaIdentity(url))return;tab.youtubeRecovery?.reset();const saved=videoPositions.find(item=>item.id===progressId(url));tab.time=saved?.time||0;tab.restorePending=!!saved;if(tab.id===activeTabId)pendingMediaRestore=saved?{time:saved.time,autoplay:tab.resumeOnActivate}:null;}
function remoteView(sourceId:string){return new WebContentsView({webPreferences:{partition:`persist:moyu-${sourceId}`,nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,disableHtmlFullscreenWindowResize:true,autoplayPolicy:'no-user-gesture-required',backgroundThrottling:true}});}
function wakeTab(tab:RuntimeBrowserTab){const old=tab.view;try{win.contentView.removeChildView(old);}catch{}if(!old.webContents.isDestroyed())old.webContents.close();tab.view=remoteView(tab.sourceId);tab.sleeping=false;tab.restorePending=true;tab.media.loading=true;tab.media.error='';tab.view.setVisible(false);if(tab.mobile)tab.view.webContents.setUserAgent(MOBILE_UA);win.contentView.addChildView(tab.view);wireRemote(tab.view.webContents,undefined,tab.id);if(/(^|\.)youtube\.com$/.test(new URL(tab.media.url).hostname)){const wc=tab.view.webContents;attachYouTubeCaptions(wc,()=>mediaView?.webContents===wc&&state.access==='private');}}
async function sleepBrowserTab(id:string,manual=true){
 const tab=runtimeTabs.get(id);if(!tab)throw Error('标签页不存在');if(tab.sleeping)return;
 const host=new URL(tab.media.url).hostname;const excluded=state.settings.tabSleepExceptions.some(site=>host===site||host.endsWith('.'+site));
 if(tab.id===activeTabId||state.loginMode||popups.size||tab.media.loading||excluded){if(manual)throw Error('当前标签、登录操作和例外网站暂不休眠');return;}
 const original=tab.view.webContents;
 const editable=await original.executeJavaScript(`(()=>{const active=document.activeElement;if(active?.matches('input,textarea,[contenteditable="true"]'))return true;return [...document.querySelectorAll('input:not([type="hidden"]),textarea')].some(e=>e.value!==e.defaultValue||('checked'in e&&e.checked!==e.defaultChecked))})()`).catch(()=>true);
 if(editable||tab.id===activeTabId||tab.view.webContents!==original){if(manual)throw Error('标签页含有未提交的输入，已保留');return;}
 await pauseTabForSwitch(tab);if(tab.id===activeTabId||tab.view.webContents!==original)return;
 const old=tab.view;try{win.contentView.removeChildView(old);}catch{}original.close();tab.view=remoteView(tab.sourceId);tab.view.webContents.setAudioMuted(true);tab.view.setVisible(false);win.contentView.addChildView(tab.view);tab.sleeping=true;tab.media.playing=false;tab.media.loading=false;syncBrowserTabs();emit();
}
async function enrichBook(book:Book,bytes:Buffer,rename:boolean){
 try{const metadata=await epubMetadata(bytes);if(rename&&metadata.title)book.title=metadata.title;book.author=metadata.author;
  if(metadata.coverBytes){const image=nativeImage.createFromBuffer(metadata.coverBytes),size=image.getSize();if(!image.isEmpty()&&size.width<=4096&&size.height<=4096){const thumb=image.resize({width:180,quality:'good'}).toJPEG(75);if(thumb.length<=128*1024){await fs.mkdir(path.join(libraryPath,'.covers'),{recursive:true});await fs.writeFile(path.join(libraryPath,'.covers',book.id+'.jpg'),thumb);book.cover=book.id;}}}
  persist();
 }catch{if(book.author===undefined)book.author='';}
}
async function getBookCover(id:string){const book=findBook(id);if(book.type!=='epub')return null;const cached=coverCache.get(id);if(cached)return cached;if(book.author===undefined)await enrichBook(book,await fs.readFile(path.join(libraryPath,id+'.epub')),false);if(!book.cover)return null;try{const bytes=await fs.readFile(path.join(libraryPath,'.covers',id+'.jpg'));if(bytes.length>128*1024)return null;const value='data:image/jpeg;base64,'+bytes.toString('base64');coverCache.set(id,value);return value;}catch{return null;}}
function tabSnapshot(tab:RuntimeBrowserTab):BrowserTab{return {id:tab.id,sourceId:tab.sourceId,title:tab.media.title||state.sources.find(source=>source.id===tab.sourceId)?.title||'网页',url:tab.media.url,loading:tab.media.loading,error:tab.media.error,mobile:tab.mobile,sleeping:tab.sleeping===true};}
function syncBrowserTabs(){state.browserTabs=tabOrder.map(id=>runtimeTabs.get(id)).filter((tab):tab is RuntimeBrowserTab=>!!tab).map(tabSnapshot);state.activeTabId=activeTabId;}
function syncActiveMedia(tab:RuntimeBrowserTab){mediaView=tab.view;activePlatform=tab.platform;state.activeSourceId=tab.sourceId;state.media={...tab.media};activeTabId=tab.id;syncBrowserTabs();}
function recordHistory(tab:RuntimeBrowserTab){
  if(!tab.media.url||tab.media.url==='about:blank')return;
  let normalized:string;try{normalized=safeUrl(tab.media.url,testing);}catch{return;}
  const title=(tab.media.title||state.sources.find(source=>source.id===tab.sourceId)?.title||new URL(normalized).hostname).slice(0,180);
  const previous=state.browserHistory[0];
  if(previous&&previous.url===normalized&&Date.now()-previous.visitedAt<15000){previous.title=title;previous.visitedAt=Date.now();persist();return;}
  state.browserHistory=[{id:randomUUID(),sourceId:tab.sourceId,title,url:normalized,visitedAt:Date.now()},...state.browserHistory.filter(entry=>entry.url!==normalized)].slice(0,300);
  persist();emit();
}
function isBookmarked(url=state.media.url){return !!url&&state.browserBookmarks.some(entry=>entry.url===url);}
function closeRuntimeTab(tabId:string){
  const tab=runtimeTabs.get(tabId);if(!tab)return;
  if(!tab.view.webContents.isDestroyed()){try{win.contentView.removeChildView(tab.view);}catch{}tab.view.webContents.close();}
  runtimeTabs.delete(tabId);const index=tabOrder.indexOf(tabId);if(index>=0)tabOrder.splice(index,1);
  if(activeTabId===tabId){activeTabId=null;mediaView=null;state.activeTabId=null;state.activeSourceId=null;}
  syncBrowserTabs();
}
async function pauseTabForSwitch(tab:RuntimeBrowserTab){
  const seekVersion=tab.seekVersion||0;const url=tab.media.url;if(tab.id===activeTabId)tab.lastActive=Date.now();
  const wasPlaying=tab.id===activeTabId?state.media.playing===true:tab.resumeOnActivate||tab.media.playing===true;
  tab.resumeOnActivate=wasPlaying;
  tab.view.webContents.setAudioMuted(true);
  const values=await controlMedia(tab.view.webContents,'pause',tab.platform,true);
  if(mediaIdentity(url)!==mediaIdentity(tab.media.url)||(tab.seekVersion||0)!==seekVersion)return;
  tab.media.playing=values.length?values.some(value=>value.playing):false;
  const principal=values.find(value=>value.count>0);
  if(principal)rememberVideo(tab,principal);
  if(tab.id===activeTabId&&principal&&!tab.restorePending){state.resume={...state.resume,section:'video',activeSourceId:tab.sourceId,mediaUrl:tab.media.url,mediaTime:Math.max(0,principal.currentTime||0),mediaWasPlaying:wasPlaying,recoveredAfterCrash:false};checkpointSession(false,true);persist();}
}
async function switchBrowserTab(tabId:string){
  const next=runtimeTabs.get(tabId);if(!next)throw new Error('标签页不存在');
  const waking=next.sleeping===true;if(waking)wakeTab(next);next.lastActive=Date.now();
  if(activeTabId===tabId){syncActiveMedia(next);layout();setAudioGuard();emit();return;}
  if(state.fullscreen)await fullscreen(false);
  const previous=runtimeTab();if(previous)await pauseTabForSwitch(previous);
  cancelBrowserTranslation();state.translation.subtitles='';state.translation.error='';
  pendingMediaRestore=next.restorePending?{time:next.time||0,autoplay:next.resumeOnActivate}:null;
  syncActiveMedia(next);state.section='video';
  updateResume({section:'video',activeSourceId:next.sourceId,mediaUrl:next.media.url,mediaTime:next.time||0,mediaWasPlaying:next.resumeOnActivate,activeBookId:null},true);
  layout();setAudioGuard();emit();if(waking){pendingMediaRestore={time:next.time||0,autoplay:next.resumeOnActivate};void next.view.webContents.loadURL(next.media.url).catch(()=>{});}else await resumeMedia();
}
async function switchRelativeTab(direction:number){
  if(tabOrder.length<2)return;
  const index=Math.max(0,tabOrder.indexOf(activeTabId||''));const next=(index+direction+tabOrder.length)%tabOrder.length;await switchBrowserTab(tabOrder[next]);
}
function visibleBounds(bounds?: Rectangle): Rectangle {
  const area=bounds?screen.getDisplayMatching(bounds).workArea:screen.getPrimaryDisplay().workArea;
  return fitWindow(bounds,area);
}
function layout() {
  layoutControls();
  for(const tab of runtimeTabs.values())tab.view.setVisible(false);
  if(!mediaView||!win||win.isDestroyed())return;
  const [w,h]=win.getContentSize();
  const show=state.access==='private'&&state.section==='video'&&!!viewport;
  mediaView.setVisible(show);
  if(show){
    const r=state.fullscreen?{x:0,y:0,width:w,height:h}:viewport!;
    const x=Math.max(0,Math.round(r.x)),y=Math.max(0,Math.round(r.y));
    mediaView.setBounds({x,y,width:Math.max(1,Math.min(w-x,Math.round(r.width))),height:Math.max(1,Math.min(h-y,Math.round(r.height)))});
  }
}
function layoutControls(){
 if(!controlsView||!win||win.isDestroyed())return;
 const [width]=win.getContentSize();controlsView.setBounds({x:Math.max(0,width-350),y:8,width:Math.min(342,width),height:64});
 controlsView.setVisible(state.access==='private'&&state.section==='video'&&state.fullscreen);
 // WebContentsView is above the React renderer; controls must be a top sibling.
 win.contentView.addChildView(controlsView);
}
function setAudioGuard() {
  for(const tab of runtimeTabs.values())if(!tab.view.webContents.isDestroyed())tab.view.webContents.setAudioMuted(tab.id!==activeTabId||isBlocked()||state.media.muted);
  for(const popup of popups)if(!popup.isDestroyed())popup.webContents.setAudioMuted(isBlocked()||state.media.muted);
}
function pauseAll() {
  cancelBrowserTranslation();
  allContents().forEach(wc=>wc.setAudioMuted(true));
  const version=transitionVersion;
  const wasPlaying=state.media.playing===true||state.resume.mediaWasPlaying;
  const tabJobs=[...runtimeTabs.values()].map(async tab=>({tab,values:await controlMedia(tab.view.webContents,'pause',tab.platform,true)}));
  const popupJobs=[...popups].filter(p=>!p.isDestroyed()).map(async popup=>({tab:null,values:await controlMedia(popup.webContents,'pause',activePlatform,true)}));
  for(const tab of runtimeTabs.values())if(tab.id===activeTabId)tab.resumeOnActivate=wasPlaying;else if(tab.media.playing===true)tab.resumeOnActivate=true;
  return Promise.all([...tabJobs,...popupJobs]).then(results=>{
    if(version!==transitionVersion)return;
    for(const item of results)if(item.tab){item.tab.media.playing=item.values.length?item.values.some(value=>value.playing):false;}
    const values=results.flatMap(item=>item.values);
    for(const item of results)if(item.tab){const value=item.values.find(value=>value.count>0&&!value.adPlaying);if(value)rememberVideo(item.tab,value);}
    const principal=results.find(item=>item.tab?.id===activeTabId)?.values.find(value=>value.count>0&&!value.adPlaying);
    if(principal&&state.activeSourceId&&!runtimeTab()?.restorePending){state.resume={...state.resume,section:state.section,activeSourceId:state.activeSourceId,mediaUrl:state.media.url,mediaTime:Math.max(0,principal.currentTime||0),mediaWasPlaying:wasPlaying,recoveredAfterCrash:false};checkpointSession(false,true);persist();}
    state.media.playing=values.length?values.some(v=>v.playing):null;
    state.media.status=values.length&&values.every(v=>v.paused)?'已暂停并静音':'已静音；播放器暂停状态未确认';emit();
  });
}
async function resumeMedia() {
  if(isBlocked())return;
  const tab=runtimeTab();if(!tab||tab.view.webContents.isDestroyed())return;
  if(tab.restorePending){await applyPendingMediaRestore(tab.view.webContents);if(tab.restorePending)return;}
  const diagnosticDone=diagnostics.begin('media-resume',state.windowState);
  const version=transitionVersion;
  const targets=[tab.view.webContents,...[...popups].filter(p=>!p.isDestroyed()&&p.isVisible()).map(p=>p.webContents)];
  const results=(await Promise.all(targets.map(wc=>controlMedia(wc,'resume',activePlatform,false)))).flat();
  if(version===transitionVersion&&!isBlocked()){tab.media.playing=results.some(value=>value.count>0)?results.some(value=>value.playing):tab.media.playing;state.media.playing=tab.media.playing;setAudioGuard();emit();}diagnosticDone(version===transitionVersion);
}
function hide(kind: WindowState='panicHidden') {
  const diagnosticDone=diagnostics.begin('hide',kind);
  if(!win||win.isDestroyed())return;
  clearPointerTransitionTimers();
  if(kind!=='autoHidden'){blurAutoHidden=false;restoreNeedsExit=false;}
  ++transitionVersion;
  if(kind==='autoHidden')transition('AUTO_HIDE');else if(kind==='minimized')transition('MINIMIZE');else if(kind==='suspended')transition('SUSPEND');else transition('PANIC_HIDE');
  recoveryRegions=[win.getBounds(),...[...popups].filter(p=>!p.isDestroyed()&&p.isVisible()).map(p=>p.getBounds())];
  if(!win.isMinimized())rememberedBounds=win.getBounds();
  if(state.activeSourceId)updateResume({section:state.section,activeSourceId:state.activeSourceId,mediaUrl:state.media.url,mediaWasPlaying:state.media.playing===true||state.resume.mediaWasPlaying},true);
  pauseAll();
  for(const popup of popups)if(!popup.isDestroyed()&&popup.isVisible()){hiddenPopups.add(popup);popup.hide();}
  if(kind!=='minimized')win.hide();
  emit();persist();diagnosticDone();
}
function restore(focus=true) {
  if(!win||win.isDestroyed())return;
  if(state.access!=='private'){showTodo();return;}
  const diagnosticDone=diagnostics.begin('restore',state.windowState);
  clearPointerTransitionTimers();blurAutoHidden=false;restoreNeedsExit=false;
  ++transitionVersion;transition('RESTORE');graceUntil=Date.now()+RESTORE_GRACE_MS;recoveryRegions=[];
  if(win.isMinimized())win.restore();
  win.setSkipTaskbar(false);
  if(focus){win.show();win.focus();}else win.showInactive();
  win.moveTop();
  for(const popup of hiddenPopups)if(!popup.isDestroyed())popup.showInactive();
  hiddenPopups.clear();
  hideArmed=pointerInsideVisibleApp(screen.getCursorScreenPoint());
  layout();if(focus&&mediaView&&!mediaView.webContents.isDestroyed())mediaView.webContents.focus();emit();void resumeMedia();diagnosticDone();
}
function inside(point:{x:number;y:number},r:Rectangle){return point.x>=r.x&&point.x<r.x+r.width&&point.y>=r.y&&point.y<r.y+r.height;}
function pointerInsideVisibleApp(point:{x:number;y:number}){
  if(!win||win.isDestroyed()||!win.isVisible()||win.isMinimized()||widgetHovered)return false;
  if(inside(point,win.getBounds()))return true;
  return [...popups].some(p=>!p.isDestroyed()&&p.isVisible()&&inside(point,p.getBounds()));
}
function pointerInsideRecovery(point:{x:number;y:number}){
  if(widgetHovered)return false;
  const regions=rememberedBounds?[...recoveryRegions,visibleBounds(rememberedBounds)]:recoveryRegions;
  return regions.some(r=>inside(point,r));
}
function clearAutoHideTimer(){if(pendingAutoHide){clearTimeout(pendingAutoHide);pendingAutoHide=undefined;}}
function clearAutoRestoreTimer(){if(pendingAutoRestore){clearTimeout(pendingAutoRestore);pendingAutoRestore=undefined;}}
function clearPointerTransitionTimers(){clearAutoHideTimer();clearAutoRestoreTimer();}
function scheduleAutoHideVerification(){
  if(pendingAutoHide)return;
  pendingAutoHide=setTimeout(()=>{
    pendingAutoHide=undefined;
    if(!win||win.isDestroyed()||state.access!=='private'||!state.settings.autoHide||state.loginMode||state.windowState!=='visible'||win.isMinimized()||dialogDepth||Date.now()<graceUntil)return;
    if(pointerInsideVisibleApp(screen.getCursorScreenPoint())){hideArmed=true;return;}
    if(hideArmed)hide('autoHidden');
  },POINTER_VERIFY_MS);
}
function scheduleAutoRestoreVerification(){
  if(pendingAutoRestore)return;
  pendingAutoRestore=setTimeout(()=>{
    pendingAutoRestore=undefined;
    if(!win||win.isDestroyed()||state.access!=='private'||(!state.settings.autoHide&&!blurAutoHidden)||state.loginMode||state.windowState!=='autoHidden')return;
    if(pointerInsideRecovery(screen.getCursorScreenPoint()))restore(true);
  },AUTO_RESTORE_VERIFY_MS);
}
function setWindowBoundsExact(target:Rectangle){
  const same=(a:Rectangle,b:Rectangle)=>a.x===b.x&&a.y===b.y&&a.width===b.width&&a.height===b.height;
  if(same(win.getBounds(),target))return;
  win.setBounds(target);const actual=win.getBounds();
  // Windows fractional DPI can add a frame pixel on a redundant setBounds.
  if(!same(actual,target))win.setBounds({x:target.x+(target.x-actual.x),y:target.y+(target.y-actual.y),width:target.width+(target.width-actual.width),height:target.height+(target.height-actual.height)});
}
function preparePlayerFullscreenHost(){
  if(!win||win.isDestroyed())return;
  if(!playerFullscreenBounds)playerFullscreenBounds=win.getBounds();
  // The site needs HTML fullscreen permission for its real player fullscreen
  // button to work. disableHtmlFullscreenWindowResize keeps the outer Qixu
  // window at the exact same desktop bounds.
  win.setFullScreenable(true);
}
function lockPlayerFullscreenHost(){
  if(!win||win.isDestroyed())return;
  if(!playerFullscreenBounds)playerFullscreenBounds=win.getBounds();
  // Once Chromium has entered HTML fullscreen, prevent any later native
  // fullscreen promotion while the player remains fullscreen.
  win.setFullScreenable(false);
}
function restorePlayerFullscreenHost(){
  if(!win||win.isDestroyed())return;
  const target=playerFullscreenBounds;playerFullscreenBounds=null;
  if(!target){win.setFullScreenable(true);return;}
  const restore=()=>{if(!win.isDestroyed()&&!win.isFullScreen()){win.setFullScreenable(true);setWindowBoundsExact(target);}};
  if(win.isFullScreen()){
    win.once('leave-full-screen',restore);
    setTimeout(()=>{if(!win.isDestroyed()&&win.isFullScreen())win.setFullScreen(false);},0);
  }else restore();
}
function pollMouse() {
  if(!win||win.isDestroyed()||state.access!=='private'||state.loginMode||(!state.settings.autoHide&&!blurAutoHidden)){clearPointerTransitionTimers();return;}
  const now=Date.now();const cursor=screen.getCursorScreenPoint();
  if(state.windowState==='autoHidden'){
    clearAutoHideTimer();
    const inRecovery=pointerInsideRecovery(cursor);
    // A blur hide must not immediately pop back over the app the user just clicked.
    if(restoreNeedsExit){if(!inRecovery)restoreNeedsExit=false;clearAutoRestoreTimer();return;}
    if(inRecovery)scheduleAutoRestoreVerification();else clearAutoRestoreTimer();
    return;
  }
  clearAutoRestoreTimer();
  if(!state.settings.autoHide){clearAutoHideTimer();return;}
  if(state.windowState!=='visible'||win.isMinimized()||dialogDepth){clearAutoHideTimer();return;}
  const within=pointerInsideVisibleApp(cursor);
  if(within){hideArmed=true;clearAutoHideTimer();return;}
  if(now<graceUntil){clearAutoHideTimer();return;}
  if(hideArmed)scheduleAutoHideVerification();
}
function registerShortcut(shortcut:string) {
  if(shortcut==='Ctrl+Alt')return true;
  try {return globalShortcut.register(shortcut,()=>togglePrivate());}catch{return false;}
}
async function updateSettings(patch:Partial<Settings>) {
  if(!patch||typeof patch!=='object')throw new Error('设置格式无效');
  const next=sanitizeSettings(patch,state.settings);
  if(Object.hasOwn(patch,'shortcut'))throw Error('请在老板键中修改切换快捷键');
  if(next.shortcut!==state.settings.shortcut){
    if(!registerShortcut(next.shortcut))throw new Error('快捷键无效或已被占用，请换一组组合键');
    globalShortcut.unregister(state.settings.shortcut);
  }
  if(Object.hasOwn(patch,'launchAtLogin')&&manageLoginItems){
    if(!app.isPackaged)throw new Error('开机自启需要使用安装后的版本');
    next.launchAtLogin=writeStartup(app,process.execPath,next.launchAtLogin);
  }
  state.settings=next;nativeTheme.themeSource=next.theme;narrator.sync();diagnostics.setEnabled(next.diagnosticsEnabled);
  if(!next.autoTranslate&&!next.bilingualSubtitles){cancelBrowserTranslation();translator.stop();state.translation.model='idle';}
  if(state.access==='private'){win.setOpacity(next.opacity);win.setAlwaysOnTop(next.alwaysOnTop);}
  todoHost.send('STARTUP:'+(next.launchAtLogin?'1':'0'));
  for(const popup of popups)if(!popup.isDestroyed())popup.setOpacity(next.opacity);
  if(!next.autoHide&&state.windowState==='autoHidden')restore();
  graceUntil=Date.now()+500;persist();emit();return publicState();
}
let bossKeySaveBusy=false;
async function updateBossKey(patch:any){
 if(bossKeySaveBusy)throw Error('设置正在保存，请稍候');
 if(state.access!=='private'&&!state.bossKeyPanel&&!(state.access==='prompt'&&!bossKeyConfig.configured))throw Error('请先打开待办中的老板键设置');
 if(!patch||typeof patch!=='object'||typeof patch.passwordRequired!=='boolean')throw Error('老板键设置格式无效');
 bossKeySaveBusy=true;
 try{
 const shortcut=normalizeBossShortcut(patch.shortcut);
 if(bossKeyConfig.configured&&bossKeyConfig.passwordRequired&&(state.bossKeyPanel||patch.newPassword||!patch.passwordRequired)&&!await verifyBossPassword(patch.currentPassword,bossKeyConfig))throw Error('当前口令不正确');
 let record=bossKeyConfig.passwordRecord;
 if(patch.newPassword)record=await createPasswordRecord(patch.newPassword);
 if((!bossKeyConfig.configured||!bossKeyConfig.passwordRequired)&&patch.passwordRequired&&!record)throw Error('请为访问验证设置新口令');
 if(shortcut!==state.settings.shortcut&&!registerShortcut(shortcut))throw Error('快捷键无效或已被占用，请换一组组合键');
 const oldShortcut=state.settings.shortcut;
 state.settings.shortcut=shortcut;
 bossKeyConfig={configured:true,shortcutConfigured:true,passwordRequired:patch.passwordRequired,legacyCtrlAlt:false,passwordRecord:record};
 state.bossKey={configured:true,shortcutConfigured:true,passwordRequired:patch.passwordRequired};
 if(oldShortcut!==shortcut&&oldShortcut!=='Ctrl+Alt')globalShortcut.unregister(oldShortcut);
 persist(true);await persistQueue;todoHost.send('BOSS_KEY_CONFIGURED:1');emit();
 if(state.access==='prompt'||state.bossKeyPanel)showTodo('老板键已保存，可在影音模式的设置中更改。');
 return publicState();
 }finally{bossKeySaveBusy=false;}
}
function configureSession(partition:string) {
  if(sessionsConfigured.has(partition))return;
  sessionsConfigured.add(partition);
  const s=session.fromPartition(partition);
  s.cookies.on('changed',()=>{void s.cookies.flushStore().catch(()=>{});});
  s.setPermissionRequestHandler((_wc,permission,callback)=>callback(permission==='fullscreen'));
  s.setPermissionCheckHandler((_wc,permission)=>permission==='fullscreen');
  s.on('will-download',(_event,item)=>{item.setSaveDialogOptions({defaultPath:path.join(app.getPath('downloads'),item.getFilename())});});
}
async function fullscreen(enabled:boolean) {
  if(!mediaView||fullscreenPending||state.fullscreen===enabled)return;
  const contents=mediaView.webContents;
  const before=await controlMedia(contents,'status',activePlatform,isBlocked());
  const wasPlaying=before.some(result=>result.playing);
  let fullscreenTransitionSucceeded=true;
  if(enabled){
    // Trigger the website player's real fullscreen button first. The app window
    // itself never changes size or position, and we never synthesize fullscreen
    // by invoking the page/container Fullscreen API ourselves.
    preparePlayerFullscreenHost();
    fullscreenPending=true;
    try{
      const allowed=()=>mediaView?.webContents===contents&&!isBlocked()&&!state.fullscreen;
      let clicked=false;
      if(activePlatform==='bilibili')clicked=await bilibiliPlayerControls.click(contents,'fullscreen',allowed);
      else if(activePlatform==='youtube')clicked=await youtubePlayerControls.click(contents,'fullscreen',allowed);
      else {
        fullscreenTransitionSucceeded=false;
        state.media.status='该网站请使用播放器自带的全屏按钮；进入后栖序会自动适配当前窗口';
      }
      if(clicked){
        for(let attempt=0;attempt<6&&!state.fullscreen;attempt++){
          await new Promise(resolve=>setTimeout(resolve,70));
          const entered=await controlMedia(contents,'status',activePlatform,isBlocked());
          if(entered.some(result=>result.fullscreen)){
            // enter-html-full-screen normally sets this first. This fallback only
            // mirrors a fullscreen state Chromium has already confirmed.
            state.fullscreen=true;layout();emit();break;
          }
        }
        if(!state.fullscreen){
          fullscreenTransitionSucceeded=false;
          state.media.status=activePlatform==='bilibili'?'B站播放器“全屏”未响应，请重试':'YouTube 播放器“全屏”未响应，请重试';
          restorePlayerFullscreenHost();
          layout();emit();
        }
      }else if(activePlatform==='bilibili'||activePlatform==='youtube'){
        fullscreenTransitionSucceeded=false;
        state.media.status=activePlatform==='bilibili'?'未找到 B站播放器的“全屏”按钮':'未找到 YouTube 播放器的“全屏”按钮';
        restorePlayerFullscreenHost();
        emit();
      }
    }finally{fullscreenPending=false;}
  }else{
    fullscreenPending=true;
    state.fullscreen=false;
    try{await controlMedia(contents,'exitFullscreen',activePlatform,isBlocked());}
    finally{fullscreenPending=false;layout();restorePlayerFullscreenHost();emit();}
  }
  // Bilibili and some other players can transiently pause while their native
  // fullscreen container is being reparented/resized. Restore only content
  // that was actually playing before the transition; respect user pauses.
  if(wasPlaying&&!isBlocked()){
    await controlMedia(contents,'play',activePlatform,false);
    if(activePlatform==='bilibili'){
      let playing=await controlMedia(contents,'status',activePlatform,false);
      if(!playing.some(result=>result.playing)){
        await bilibiliPlayerControls.click(contents,'play',()=>mediaView?.webContents===contents&&!isBlocked());
        await new Promise(resolve=>setTimeout(resolve,100));
      }
    }
  }
  const after=await controlMedia(contents,'status',activePlatform,isBlocked());
  if(wasPlaying&&!isBlocked())state.media.playing=true;
  else if(after.length)state.media.playing=after.some(result=>result.playing);
  const tab=runtimeTab();if(tab){tab.media.playing=state.media.playing;tab.resumeOnActivate=state.media.playing===true;syncBrowserTabs();}
  emit();
  if(enabled&&!fullscreenTransitionSucceeded)return;
  const expectedFullscreen=state.fullscreen;
  const settleTimer=setTimeout(async()=>{
    if(!mediaView||mediaView.webContents!==contents||contents.isDestroyed()||state.fullscreen!==expectedFullscreen||isBlocked())return;
    const settled=await controlMedia(contents,'status',activePlatform,false);
    if(!settled.length)return;
    state.media.playing=settled.some(result=>result.playing);
    const currentTab=runtimeTab();if(currentTab){currentTab.media.playing=state.media.playing;currentTab.resumeOnActivate=state.media.playing===true;syncBrowserTabs();}
    emit();
  },180);settleTimer.unref();
}
async function applyPendingMediaRestore(wc:WebContents){
  if(!pendingMediaRestore||mediaView?.webContents!==wc||isBlocked())return;
  const pending=pendingMediaRestore;
  const values=await controlMedia(wc,'seek',activePlatform,false,{time:pending.time,autoplay:pending.autoplay});
  if(mediaView?.webContents!==wc||pendingMediaRestore!==pending||isBlocked())return;
  if(values.some(value=>value.count>0&&value.seekReady)){
    const tab=runtimeTab();if(tab){tab.restorePending=false;tab.seekVersion=(tab.seekVersion||0)+1;}
    pendingMediaRestore=null;
    state.media.playing=pending.autoplay;
    state.media.status=state.resume.recoveredAfterCrash?'已恢复崩溃前的观看位置':'已恢复上次观看位置';
    state.resume.recoveredAfterCrash=false;emit();checkpointSession(false,true);
  }
}
function wireRemote(wc:WebContents, popup?:BrowserWindow,tabId?:string) {
  const tab=()=>{const current=tabId?runtimeTabs.get(tabId):null;return current?.view.webContents===wc?current:null;};
  const blocked=()=>popup?isBlocked():tabId?isTabBlocked(tabId):isBlocked();
  const platform=()=>tab()?.platform||activePlatform;
  const syncIfActive=()=>{const current=tab();if(current&&current.id===activeTabId){state.media={...current.media};syncBrowserTabs();emit();}else if(current){syncBrowserTabs();emit();}};
  wc.setAudioMuted(true);
  wc.on('will-navigate',(event,url)=>{try{safeUrl(url,testing);if(popup&&isVideoLink(url)){event.preventDefault();void navigateEmbedded(url);popup.destroy();}}catch{event.preventDefault();}});
  wc.on('will-redirect',(event,url)=>{try{safeUrl(url,testing);if(popup&&isVideoLink(url)){event.preventDefault();void navigateEmbedded(url);popup.destroy();}}catch{event.preventDefault();}});
  wc.setWindowOpenHandler(({url})=>{
    try{if(url!=='about:blank')safeUrl(url,testing);}catch{loginDiagnostic('popup-blocked');return {action:'deny'};}
    if(!isLoginPopup(url)){const current=tab();if(!blocked()&&current)void openSource(current.sourceId,url);return {action:'deny'};}
    loginDiagnostic('popup-open');
    return {action:'allow',overrideBrowserWindowOptions:{parent:win,width:640,height:680,show:false,autoHideMenuBar:true,fullscreenable:false,webPreferences:{session:wc.session,nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,disableHtmlFullscreenWindowResize:true,backgroundThrottling:true}}};
  });
  wc.on('did-create-window',child=>{
    popups.add(child);child.setMenu(null);child.setOpacity(state.settings.opacity);wireRemote(child.webContents,child,tabId);
    popupTranslators.set(child,new BrowserTranslator(translator,patch=>{if(child.isFocused()){Object.assign(state.translation,patch);emit();}},()=>!isBlocked()&&!child.isDestroyed()&&child.isVisible()));
    const showChild=()=>{if(child.isDestroyed())return;if(!isBlocked())child.show();else hiddenPopups.add(child);};
    child.once('ready-to-show',showChild);child.webContents.once('did-finish-load',showChild);
    child.on('closed',()=>{cancelBrowserTranslation();popupTranslators.delete(child);popups.delete(child);hiddenPopups.delete(child);});
  });
  wc.on('dom-ready',()=>{void controlMedia(wc,blocked()?'pause':'install',platform(),blocked());setAudioGuard();if(!popup)void applyPendingMediaRestore(wc);});
  wc.on('did-frame-finish-load',()=>{void controlMedia(wc,blocked()?'pause':'install',platform(),blocked());setAudioGuard();if(!popup)void applyPendingMediaRestore(wc);});
  wc.on('before-input-event',(event,input)=>{
    if(input.type!=='keyDown')return;
    if(input.key==='Escape'&&state.fullscreen&&tabId===activeTabId){event.preventDefault();void fullscreen(false);return;}
    if(input.control&&input.key==='Tab'&&state.access==='private'){event.preventDefault();void switchRelativeTab(input.shift?-1:1);return;}
    if(input.control&&String(input.key).toLowerCase()==='f'&&tabId===activeTabId){event.preventDefault();win.webContents.send('moyu:browser-command','find');}
  });
  wc.on('enter-html-full-screen',()=>{
    if(popup||tabId!==activeTabId||state.fullscreen)return;
    // The user clicked the site's own native fullscreen button. Mirror that
    // state into the shell only; never invoke the button a second time.
    lockPlayerFullscreenHost();
    state.fullscreen=true;layout();emit();
  });
  wc.on('leave-html-full-screen',()=>{
    if(!popup&&tabId===activeTabId&&state.fullscreen){state.fullscreen=false;layout();restorePlayerFullscreenHost();emit();}
  });
  if(popup)return;
  wc.on('did-start-loading',()=>{const current=tab();if(!current)return;current.media.loading=true;current.media.error='';syncIfActive();});
  wc.on('did-start-navigation',(_e,_url,_inPlace,isMainFrame)=>{if(isMainFrame){cancelBrowserTranslation();loginDiagnostic('navigation-start');}});
  wc.on('did-stop-loading',()=>{const current=tab();if(!current)return;current.media.loading=false;current.media.url=wc.getURL();if(current.id===activeTabId)updateResume({activeSourceId:current.sourceId,mediaUrl:current.media.url});syncIfActive();recordHistory(current);void applyPendingMediaRestore(wc);});
  wc.on('did-navigate',(_event,url)=>{const current=tab();if(!current)return;if(/(^|\.)youtube\.com$/.test(new URL(url).hostname))attachYouTubeCaptions(wc,()=>mediaView?.webContents===wc&&state.access==='private');const changed=current.id===activeTabId&&mediaIdentity(url)!==mediaIdentity(state.resume.mediaUrl);prepareVideoNavigation(current,url);current.media.url=url;if(current.id===activeTabId)updateResume({activeSourceId:current.sourceId,mediaUrl:url,...(changed?{mediaTime:current.time||0,mediaWasPlaying:current.resumeOnActivate}:{})});syncIfActive();});
  wc.on('did-navigate-in-page',(_event,url,isMainFrame)=>{if(!isMainFrame)return;const current=tab();if(!current)return;const changed=current.id===activeTabId&&mediaIdentity(url)!==mediaIdentity(state.resume.mediaUrl);prepareVideoNavigation(current,url);current.media.url=url;if(current.id===activeTabId)updateResume({activeSourceId:current.sourceId,mediaUrl:url,...(changed?{mediaTime:current.time||0,mediaWasPlaying:current.resumeOnActivate}:{})});syncIfActive();});
  wc.on('page-title-updated',(_event,title)=>{const current=tab();if(!current)return;current.media.title=title.slice(0,200);syncIfActive();recordHistory(current);});
  wc.on('did-fail-load',(_event,code,description,url,isMainFrame)=>{
    if(code===-3||!isMainFrame)return;
    loginDiagnostic('load-failed',code);
    const current=tab();if(!current)return;current.media.loading=false;current.media.error=`页面加载失败（${description} / ${code}）。请检查网络后重试。`;current.media.url=url;syncIfActive();
  });
  wc.on('render-process-gone',(_event,details)=>{const current=tab();if(!current)return;current.media.loading=false;current.media.error=`网页进程已退出（${details.reason}），请刷新重试。`;syncIfActive();});
  wc.on('unresponsive',()=>{const current=tab();if(!current)return;current.media.status='网页暂时没有响应，可刷新重试';syncIfActive();});
}
async function navigateEmbedded(url:string){
 const contents=mediaView?.webContents;if(!contents||state.access!=='private')return;
 const target=safeUrl(url,testing);if(state.fullscreen)await fullscreen(false);
 if(quitting||mediaView?.webContents!==contents)return;
 ++transitionVersion;pendingMediaRestore=null;updateResume({mediaUrl:target,mediaTime:0,mediaWasPlaying:false});await controlMedia(contents,'pause',activePlatform,true);void flushSessions();void contents.loadURL(target).catch(()=>{});
}
async function openSource(id:string,url?:string,restoring=false) {
  const source=state.sources.find(s=>s.id===id);if(!source)throw new Error('内容来源不存在');
  const target=safeUrl(url||source.url,testing);
  if(tabOrder.length>=MAX_BROWSER_TABS)throw new Error(`最多同时打开 ${MAX_BROWSER_TABS} 个网页标签，请先关闭一个`);
  if(state.fullscreen)await fullscreen(false);
  ++transitionVersion;
  state.loginMode=false;await flushSessions();
  for(const popup of popups)if(!popup.isDestroyed())popup.destroy();popups.clear();hiddenPopups.clear();
  state.section='video';
  if(restoring)pendingMediaRestore={time:state.resume.mediaTime,autoplay:state.resume.mediaWasPlaying};
  else {const remembered=videoPositions.find(item=>item.id===progressId(target));pendingMediaRestore=remembered?{time:remembered.time,autoplay:false}:null;}
  if((sourceCooldowns[id]||0)>Date.now()){
    throw new Error(cooldownMessage(sourceCooldowns[id]));
  }
  const partition=`persist:moyu-${id}`;configureSession(partition);
  const tabId=randomUUID();const view=new WebContentsView({webPreferences:{partition,nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,disableHtmlFullscreenWindowResize:true,autoplayPolicy:'no-user-gesture-required',backgroundThrottling:true}});
  const tab:RuntimeBrowserTab={id:tabId,sourceId:id,platform:id,view,media:{url:target,title:source.title,loading:true,error:'',playing:null,muted:state.media.muted,status:''},mobile:false,desktopUA:view.webContents.getUserAgent(),resumeOnActivate:restoring?state.resume.mediaWasPlaying:false,lastActive:Date.now(),time:pendingMediaRestore?.time||0,restorePending:!!pendingMediaRestore};
  runtimeTabs.set(tabId,tab);tabOrder.push(tabId);view.setVisible(false);win.contentView.addChildView(view);wireRemote(view.webContents,undefined,tabId);
  await switchBrowserTab(tabId);syncBrowserTabs();persist();
  if(!restoring)updateResume({section:'video',activeSourceId:id,mediaUrl:target,mediaTime:tab.time||0,mediaWasPlaying:false,activeBookId:null},true);
  if(/(^|\.)youtube\.com$/.test(new URL(target).hostname)){const contents=view.webContents;attachYouTubeCaptions(contents,()=>mediaView?.webContents===contents&&state.access==='private');}
  // Let UI navigation finish immediately; network failure is reported through did-fail-load.
  void view.webContents.loadURL(target).catch(()=>{});
}
async function closeBrowserTab(tabId:string){
  const tab=runtimeTabs.get(tabId);if(!tab)return;
  const wasActive=activeTabId===tabId;const index=tabOrder.indexOf(tabId);let nextId:string|null=null;
  if(wasActive&&tabOrder.length>1)nextId=tabOrder[index+1]||tabOrder[index-1]||null;
  await pauseTabForSwitch(tab);closeRuntimeTab(tabId);
  if(nextId&&runtimeTabs.has(nextId)){await switchBrowserTab(nextId);return;}
  if(wasActive){state.media={url:'',title:'',loading:false,error:'',playing:null,muted:state.media.muted,status:''};state.activeSourceId=null;activePlatform='generic';viewport=null;syncBrowserTabs();emit();persist();}
}
async function setBrowserTabMobile(tabId:string,enabled:boolean){
  const tab=runtimeTabs.get(tabId);if(!tab)throw new Error('标签页不存在');
  tab.mobile=enabled===true;
  tab.view.webContents.setUserAgent(tab.mobile?MOBILE_UA:tab.desktopUA);
  syncBrowserTabs();emit();tab.view.webContents.reload();
}
function toggleBrowserBookmark(){
  const tab=runtimeTab();if(!tab||!tab.media.url)return false;
  const index=state.browserBookmarks.findIndex(entry=>entry.url===tab.media.url);
  if(index>=0)state.browserBookmarks.splice(index,1);
  else state.browserBookmarks=[{id:randomUUID(),sourceId:tab.sourceId,title:(tab.media.title||state.sources.find(source=>source.id===tab.sourceId)?.title||'网页').slice(0,180),url:tab.media.url,addedAt:Date.now()},...state.browserBookmarks].slice(0,200);
  persist(true);emit();return index<0;
}
function clearBrowserHistory(){state.browserHistory=[];persist(true);emit();}
function findInPage(query:string,forward=true){const text=String(query||'').trim().slice(0,200);if(!mediaView||!text)return;mediaView.webContents.findInPage(text,{findNext:true,forward:forward!==false});}
function stopFindInPage(){if(mediaView&&!mediaView.webContents.isDestroyed())mediaView.webContents.stopFindInPage('clearSelection');}
async function navigate(action:string,url?:string) {
  if(!mediaView){if(state.activeSourceId&&(action==='reload'||action==='url'))await openSource(state.activeSourceId,action==='url'?url:state.media.url);return;}const wc=mediaView.webContents;
  if(action==='url'&&url){const target=safeUrl(url,testing);void wc.loadURL(target).catch(()=>{});}
  if(action==='back'&&wc.navigationHistory.canGoBack())wc.navigationHistory.goBack();
  if(action==='forward'&&wc.navigationHistory.canGoForward())wc.navigationHistory.goForward();
  if(action==='reload')wc.reload();
}
async function stopRateLimitedSource(contents:WebContents){
  if(mediaView?.webContents!==contents||state.activeSourceId!=='douyin')return;
  sourceCooldowns.douyin=Date.now()+SITE_COOLDOWN_MS;
  ++transitionVersion;pauseAll();translator.stop();state.translation.model='idle';
  if(state.fullscreen)void fullscreen(false);
  state.loginMode=false;
  for(const popup of popups)if(!popup.isDestroyed())popup.destroy();popups.clear();hiddenPopups.clear();
  const current=runtimeTab();if(current&&current.view.webContents===contents)closeRuntimeTab(current.id);
  state.media.loading=false;state.media.playing=false;state.media.error=cooldownMessage(sourceCooldowns.douyin);state.media.status='原站访问受限 · 已停止自动请求';
  state.translation.subtitles='';state.translation.error='';loginDiagnostic('site-rate-limited');persist(true);emit();void flushSessions();
}
async function mediaAction(action:string,value?:boolean) {
  if(!mediaView)return;
  const tab=runtimeTab();
  if(action==='mute'){state.media.muted=value??!state.media.muted;if(tab)tab.media.muted=state.media.muted;setAudioGuard();emit();return;}
  if(action==='fullscreen'){await fullscreen(value??!state.fullscreen);return;}
  if(action==='play'||action==='pause'){
    if(isBlocked())return;
    // An explicit user action cancels any outstanding automatic recovery cycle.
    tab?.youtubeRecovery?.reset();
    if(pendingMediaRestore)pendingMediaRestore={...pendingMediaRestore,autoplay:action==='play'};
    let result=await controlMedia(mediaView.webContents,action==='play'?'play':'manualPause',activePlatform,false);
    if(action==='play'&&activePlatform==='bilibili'&&!result.some(r=>r.playing)){
      const contents=mediaView.webContents;
      await bilibiliPlayerControls.click(contents,'play',()=>mediaView?.webContents===contents&&!isBlocked());
      await new Promise(resolve=>setTimeout(resolve,100));
      if(mediaView?.webContents===contents&&!contents.isDestroyed())result=await controlMedia(contents,'status',activePlatform,false);
    }
    state.media.playing=result.length?result.some(r=>r.playing):null;
    if(tab){tab.media.playing=state.media.playing;tab.resumeOnActivate=action==='play'&&(state.media.playing===true||!!tab.restorePending);syncBrowserTabs();}
    updateResume({mediaWasPlaying:action==='play'&&state.media.playing===true,mediaTime:tab?.restorePending?tab.time||state.resume.mediaTime:result.find(r=>r.count>0)?.currentTime??state.resume.mediaTime});
    state.media.status=result.find(r=>r.hint)?.hint || (result.some(r=>r.count>0)?(action==='pause'?'已请求暂停':result.some(r=>r.playing)?'正在播放':'等待视频加载；如有登录提示，请先在网页内操作'):'请先在网页中选择视频，再使用播放按钮');emit();
  }
}
async function importBooks(paths?:string[]) {
  dialogDepth++;
  try {
    if(!paths){const result=await dialog.showOpenDialog(win,{title:'导入小说',properties:['openFile','multiSelections'],filters:[{name:'小说',extensions:['txt','epub']}]});if(result.canceled)return [];paths=result.filePaths;}
    if(!Array.isArray(paths)||paths.length>50)throw new Error('一次最多导入 50 本书');
    const imported:Book[]=[];const failures:string[]=[];
    for(const file of paths){
      try {
        if(typeof file!=='string'||!path.isAbsolute(file))throw new Error('文件路径无效');
        const type=path.extname(file).slice(1).toLowerCase();if(type!=='txt'&&type!=='epub')throw new Error('仅支持 TXT 和 EPUB');
        const stat=await fs.stat(file);if(!stat.isFile()||stat.size>256*1024*1024||!stat.size)throw new Error('文件为空或超过 256 MB');
        const bytes=await fs.readFile(file);
        if(type==='epub'){
          try {
            const archive=await JSZip.loadAsync(bytes);
            const mime=archive.file('mimetype'),container=archive.file('META-INF/container.xml');
            if(!mime||!container||(await mime.async('string')).trim()!=='application/epub+zip')throw new Error('缺少 EPUB 结构');
            const containerText=await container.async('string');
            const packagePath=containerText.match(/full-path\s*=\s*["']([^"']+)["']/)?.[1];
            if(!packagePath||!archive.file(packagePath))throw new Error('缺少图书内容索引');
          }catch{throw new Error('EPUB 文件已损坏或缺少有效的内容索引');}
        }
        const id=createHash('sha256').update(bytes).digest('hex').slice(0,24);
        const existing=state.books.find(b=>b.id===id);if(existing){imported.push(existing);continue;}
        const dest=path.join(libraryPath,`${id}.${type}`);await fs.writeFile(dest+'.tmp',bytes);await fs.rename(dest+'.tmp',dest);
        const book:Book={id,title:path.basename(file,path.extname(file)),type,size:stat.size,addedAt:Date.now(),progress:null,bookmarks:[]};if(type==='epub')await enrichBook(book,bytes,true);book.readingStatus='unread';state.books.unshift(book);imported.push(book);
      }catch(err:any){failures.push(`${path.basename(String(file))}：${err.message}`);}
    }
    persist(true);await persistQueue;
    state.notice=failures.length?`部分书籍未导入：${failures.join('；')}`:imported.length?`已导入 ${imported.length} 本书`:'';emit();return imported;
  }finally{dialogDepth--;graceUntil=Date.now()+800;}
}
function findBook(id:string){const book=state.books.find(b=>b.id===id);if(!book)throw new Error('图书不存在');return book;}
async function saveBook(id:string,patch:any){
  const book=findBook(id);if(!patch||typeof patch!=='object')throw new Error('图书信息无效');
  if(patch.progress&&typeof patch.progress.position==='string'&&patch.progress.position.length<4096)book.progress={position:patch.progress.position,percent:clamp(patch.progress.percent,0,1,0)};
  if(Array.isArray(patch.bookmarks))book.bookmarks=patch.bookmarks.slice(0,1000).filter((b:any)=>typeof b.id==='string'&&typeof b.position==='string'&&b.position.length<4096).map((b:any)=>({id:b.id.slice(0,100),label:String(b.label||'书签').slice(0,150),position:b.position,percent:clamp(b.percent,0,1,0)}));
  if(typeof patch.encoding==='string'&&patch.encoding.length<32)book.encoding=patch.encoding;
  if(typeof patch.title==='string'&&patch.title.trim())book.title=patch.title.trim().slice(0,200);
  if(typeof patch.author==='string')book.author=patch.author.trim().slice(0,200);if(['unread','reading','finished'].includes(patch.readingStatus))book.readingStatus=patch.readingStatus;
  if(patch.progress){book.lastReadAt=Date.now();if(!book.readingStatus||book.readingStatus==='unread')book.readingStatus='reading';}
  persist();emit();
}
const handlers: Record<string, (...args:any[])=>any> = {
  openMaintenance,getMaintenance:async()=>({save:{...state.save},diagnostics:diagnostics.summary(),updates:updates.snapshot(),backups:await backups.restorePoints(),operation:{...backups.operation}}),createBackup,previewRestore,restoreBackup:async(token:string)=>{await flushUserData();await backups.stageRestore(token);setTimeout(restartForMaintenance,200);},exportDiagnostics,checkUpdates:()=>updates.check(),downloadUpdate:()=>updates.download(),installUpdate,
  getBookCover,videoProgress:()=>videoPositions.filter(item=>state.sources.some(source=>source.id===item.sourceId)),sleepBrowserTab,
  retrySave:async()=>{persist(true);await persistQueue;},
  speakBook:(segment:any)=>{if(!segment||typeof segment.bookId!=='string'||!state.books.some(book=>book.id===segment.bookId)||typeof segment.text!=='string')throw Error('朗读书籍无效');narrator.speak(segment);},
  narrationAction:(action:string,runId?:string)=>{if(typeof runId!=='undefined'&&(typeof runId!=='string'||runId.length>80))throw Error('朗读会话无效');if(action==='stop')narrator.stop(runId);else if(!runId||runId===narrator.state.runId){if(action==='pause')narrator.pause();else if(action==='resume')narrator.resume();else throw Error('未知朗读操作');}},
  setLoginMode:(enabled:boolean)=>{state.loginMode=enabled===true;clearPointerTransitionTimers();graceUntil=Date.now()+1000;if(state.loginMode&&state.windowState==='autoHidden')restore();loginDiagnostic(state.loginMode?'login-mode-start':'login-mode-end');if(!state.loginMode)void flushSessions();emit();},
  translationAction:async(action:string)=>{if(action==='retry'){cancelBrowserTranslation();translator.stop();state.translation.error='';state.translation.model='idle';}else if(action==='toggleSite'&&mediaView){const host=new URL(mediaView.webContents.getURL()).hostname;const sites=state.settings.translationDisabledSites;await updateSettings({translationDisabledSites:sites.includes(host)?sites.filter(s=>s!==host):[...sites,host]});cancelBrowserTranslation();}emit();},
  getState:()=>publicState(),updateBossKey,updateSettings,submitPassword,cancelUnlock:()=>showTodo(),lockToTodo:()=>showTodo(),
  windowAction:(action:string)=>{if(action==='hide'||action==='close'){if(state.access==='private'){if(state.windowState!=='panicHidden')hidePrivate();}else showTodo();return;}if(action==='restore')restore();if(action==='minimize'){hide('minimized');win.minimize();}if(action==='maximize'){if(win.isMaximized())win.unmaximize();else win.maximize();}if(action==='fullscreen')void mediaAction('fullscreen');},
  setSection:(section:string)=>{if(!['video','library','settings'].includes(section))throw new Error('页面不存在');if(state.fullscreen)fullscreen(false);++transitionVersion;state.section=section as AppState['section'];updateResume({section:state.section,activeBookId:section==='library'?state.resume.activeBookId:null});if(section!=='video'){pauseAll();translator.stop();state.translation.model='idle';}layout();emit();if(section==='video')void resumeMedia();},
  setViewport:(rect:Rect|null)=>{const wasBlocked=isBlocked();if(rect && ['x','y','width','height'].every(k=>Number.isFinite((rect as any)[k])))viewport=rect;else viewport=null;layout();if(isBlocked()){if(!wasBlocked){++transitionVersion;pauseAll();}}else if(wasBlocked){++transitionVersion;void resumeMedia();}},
  openSource,switchBrowserTab,closeBrowserTab,setBrowserTabMobile,toggleBrowserBookmark,clearBrowserHistory,findInPage,stopFindInPage,navigate,mediaAction,
  saveSources:async(sources:Source[])=>{const next=ensurePermanentSources(validateSources(sources));const validIds=new Set(next.map(source=>source.id));for(const tabId of [...tabOrder]){const tab=runtimeTabs.get(tabId);if(tab&&!validIds.has(tab.sourceId))await closeBrowserTab(tabId);}state.sources=next;persist(true);await persistQueue;emit();},
  importBooks,getBookContent:async(id:string)=>{const book=findBook(id),bytes=await fs.readFile(path.join(libraryPath,`${book.id}.${book.type}`));if(book.type==='epub'&&book.author===undefined)await enrichBook(book,bytes,false);return new Uint8Array(bytes);},saveBook,
  setReaderSession:(bookId:string|null)=>{const valid=typeof bookId==='string'&&state.books.some(book=>book.id===bookId)?bookId:null;if(narrator.state.bookId&&narrator.state.bookId!==valid)narrator.stop();if(valid)state.section='library';updateResume({section:valid?'library':state.section,activeBookId:valid});narrator.sync();emit();},
  deleteBook:async(id:string)=>{const book=findBook(id);await fs.unlink(path.join(libraryPath,`${book.id}.${book.type}`)).catch((err)=>{if(err.code!=='ENOENT')throw err;});state.books=state.books.filter(b=>b.id!==id);persist();emit();},
  openExternal:()=>{if(state.media.url)return shell.openExternal(safeUrl(state.media.url,testing));}
};
async function start() {
  let maintenanceNotice='';try{maintenanceNotice=await backups.applyPending()||'';}catch(error){maintenanceNotice=error instanceof Error?error.message:String(error);}
  const pendingBackup=path.join(dataDir,'.maintenance','pending-backup.json');try{const request=JSON.parse(await fs.readFile(pendingBackup,'utf8'));if(typeof request.folder!=='string'||!path.isAbsolute(request.folder))throw Error('备份请求无效');const result=await backups.create(request.folder,true);await fs.rm(pendingBackup,{force:true});maintenanceNotice='包含网站会话的备份已完成：'+result.path;}catch(error:any){if(error.code!=='ENOENT'){maintenanceNotice='账号备份未完成：'+error.message;await fs.rm(pendingBackup,{force:true}).catch(()=>{});}}
  await load();windowMode='todo';syncMode();checkpointSession(false,true);if(manageLoginItems&&app.isPackaged){try{state.settings.launchAtLogin=reconcileStartup(app,process.execPath,state.settings.launchAtLogin);persist();}catch(error:any){state.settings.launchAtLogin=false;state.notice='自启动状态读取失败：'+error.message;}}nativeTheme.themeSource=state.settings.theme;
  if(maintenanceNotice)state.notice=maintenanceNotice;
  win=new BrowserWindow({...visibleBounds(rememberedBounds),minWidth:420,minHeight:360,frame:false,show:false,backgroundColor:'#f5f6fa',autoHideMenuBar:true,fullscreenable:true,
    icon:path.join(__dirname,'../assets/icon.ico'),webPreferences:{preload,nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,disableHtmlFullscreenWindowResize:true,backgroundThrottling:false}});
  win.setMenu(null);win.setSkipTaskbar(true);
  ipcMain.handle('qixu:controls',async(event,action)=>{
    if(event.sender!==controlsView?.webContents||event.senderFrame!==controlsView.webContents.mainFrame||state.access!=='private')throw Error('控制来源无效');
    if(action==='exit')await fullscreen(false);else if(action==='hide'){if(state.windowState==='visible')togglePrivate();}else if(['play','pause','mute'].includes(action))await mediaAction(action);else throw Error('未知控制');
  });
  ipcMain.on('qixu:controls-ready',event=>{if(event.sender===controlsView?.webContents)emit();});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',(event,url)=>{if(!isSameLocalFile(url,homeFile))event.preventDefault();});
  win.webContents.on('before-input-event',(event,input)=>{
    if(input.type!=='keyDown')return;
    if(input.key==='Escape'){if(state.bossKeyPanel){event.preventDefault();showTodo();return;}if(state.access==='prompt'){event.preventDefault();showTodo();}else if(state.fullscreen){event.preventDefault();void fullscreen(false);}return;}
    if(state.access==='private'&&input.control&&input.key==='Tab'){event.preventDefault();void switchRelativeTab(input.shift?-1:1);return;}
    if(state.access==='private'&&input.control&&String(input.key).toLowerCase()==='f'){event.preventDefault();win.webContents.send('moyu:browser-command','find');}
  });
  ipcMain.handle('moyu:invoke',(event,method,...args)=>{
    if(event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame)throw new Error('请求来源无效');
    if(typeof method!=='string'||!Object.hasOwn(handlers,method))throw new Error('不支持的操作');
    if(state.access!=='private'&&!['getState','submitPassword','cancelUnlock','lockToTodo','windowAction','setViewport','updateBossKey'].includes(method)){
      if(method==='openMaintenance')return openMaintenance();
      if(state.maintenanceOpen&&maintenanceMethods.has(method))return handlers[method](...args);
      if(state.maintenanceOpen&&method==='updateSettings'&&args[0]&&Object.keys(args[0]).every(key=>key==='diagnosticsEnabled'))return updateSettings(args[0]);
      if(method==='narrationAction'&&args[0]==='stop'){narrator.stop(args[1]);return;}
      if(method==='saveBook'&&Date.now()<progressFlushUntil&&args[1]?.progress&&!args[1]?.bookmarks)return saveBook(args[0],{progress:args[1].progress});
      throw new Error('请先完成访问验证');
    }
    if(method==='setViewport'&&state.access!=='private')return;
    return handlers[method](...args);
  });
  const remember=()=>{if(state.access==='private'&&!win.isDestroyed()&&!win.isMinimized()&&!win.isFullScreen()&&!state.fullscreen){rememberedBounds=win.getBounds();persist();}graceUntil=Date.now()+650;layout();};
  win.on('move',remember);win.on('resize',remember);
  // A normal player HTML-fullscreen transition is confined by
  // disableHtmlFullscreenWindowResize. This handler is only a defensive escape
  // hatch for a Chromium/site regression. Defer the correction so we never
  // re-enter Electron's native fullscreen transition synchronously.
  win.on('enter-full-screen',()=>{
    const target=playerFullscreenBounds||win.getBounds();
    if(!playerFullscreenBounds)playerFullscreenBounds=target;
    setTimeout(()=>{
      if(win.isDestroyed())return;
      const restore=()=>{if(!win.isDestroyed()){setWindowBoundsExact(target);layout();}};
      if(win.isFullScreen()){win.once('leave-full-screen',restore);win.setFullScreen(false);}
      else restore();
    },0);
  });
  win.on('will-move',()=>{graceUntil=Date.now()+1500;});win.on('will-resize',()=>{graceUntil=Date.now()+1500;});
  // With pin disabled, moving focus to another application quietly suspends video.
  // Ignore the app's own login and media popups; they remain part of this window.
  win.on('focus',()=>{if(pendingBlurHide){clearTimeout(pendingBlurHide);pendingBlurHide=undefined;}});
  win.on('blur',()=>{
    if(pendingBlurHide)clearTimeout(pendingBlurHide);
    if(state.access!=='private'||state.windowState!=='visible'||state.settings.alwaysOnTop||state.loginMode||dialogDepth)return;
    pendingBlurHide=setTimeout(()=>{
      pendingBlurHide=undefined;
      if(!win||win.isDestroyed()||state.access!=='private'||state.windowState!=='visible'||state.settings.alwaysOnTop||state.loginMode||dialogDepth||win.isFocused())return;
      const focused=BrowserWindow.getFocusedWindow();
      if(focused===win||[...popups].some(p=>!p.isDestroyed()&&(p===focused||p.isFocused())))return;
      blurAutoHidden=true;restoreNeedsExit=true;hide('autoHidden');
    },160);
  });
  win.on('minimize',()=>{if(state.windowState!=='minimized')hide('minimized');});
  win.on('restore',()=>{if(state.windowState==='minimized')restore();});
  win.on('close',event=>{if(!quitting){event.preventDefault();if(state.access==='private'){if(state.windowState!=='panicHidden')togglePrivate();}else showTodo();}});
  win.once('ready-to-show',()=>{rememberedBounds=rememberedBounds||win.getBounds();});
  const iconFile=path.join(__dirname,'../assets/icon.png');
  let icon=nativeImage.createFromPath(iconFile);if(icon.isEmpty())icon=nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==');
  tray=new Tray(icon.resize({width:24,height:24}));tray.setToolTip('栖序 · 让生活自有次序');
  tray.setContextMenu(Menu.buildFromTemplate([{label:'恢复影音／阅读（保留当前进度）',click:()=>{if(state.access==='private')restore();else requestUnlock();}},{label:'打开待办并锁定影音',click:()=>showTodo()},{label:'暂停朗读',click:()=>narrator.pause()},{label:'停止朗读',click:()=>narrator.stop()},{type:'separator'},{label:'退出栖序',click:()=>{quitting=true;app.quit();}}]));tray.on('click',()=>{if(state.access==='private')restore();else showTodo();});
  if(!registerShortcut(state.settings.shortcut))state.notice=`快捷键 ${state.settings.shortcut} 已被占用，请在设置中修改`;
  powerMonitor.on('lock-screen',()=>showTodo('',true));powerMonitor.on('suspend',()=>showTodo('',true));
  screen.on('display-removed',()=>{rememberedBounds=visibleBounds(rememberedBounds);win.setBounds(rememberedBounds);});
  screen.on('display-metrics-changed',()=>{if(state.windowState==='visible'){rememberedBounds=visibleBounds(win.getBounds());win.setBounds(rememberedBounds);}else rememberedBounds=visibleBounds(rememberedBounds);});
  const sleepTimer=setInterval(()=>{if(quitting||state.loginMode)return;for(const tab of runtimeTabs.values())if(state.settings.tabSleepMinutes>0&&!tab.sleeping&&tab.id!==activeTabId&&Date.now()-(tab.lastActive||Date.now())>=state.settings.tabSleepMinutes*60000)void sleepBrowserTab(tab.id,false).catch(()=>{});},30000);sleepTimer.unref();
  const mouseTimer=setInterval(pollMouse,50);mouseTimer.unref();
  const translationTimer=setInterval(()=>{if(mediaView&&!isBlocked()){
    const current=mediaView.webContents;
    void youtubeAdSkipper.tick(current,()=>state.settings.autoSkipYouTubeAds&&!isBlocked()&&mediaView?.webContents===current);
    void youtubeCaptionActivator.tick(current,()=>state.settings.bilingualSubtitles&&!isBlocked()&&mediaView?.webContents===current);
    void browserTranslator.tick(mediaView.webContents,state.settings,true);
    for(const [popup,controller] of popupTranslators)if(!popup.isDestroyed()&&popup.isVisible())void controller.tick(popup.webContents,state.settings,true);
  }},450);translationTimer.unref();
  const mediaTimer=setInterval(async()=>{
    if(quitting||statusBusy||!mediaView||mediaView.webContents.isDestroyed())return;
    statusBusy=true;
    try {setAudioGuard();const contents=mediaView.webContents;const platform=activePlatform;const identity=mediaIdentity(state.media.url);if(!isBlocked())await applyPendingMediaRestore(contents);
      const seekVersion=runtimeTab()?.seekVersion||0;
      const values=(await Promise.all((platform==='douyin'?allContents():[contents]).map(wc=>controlMedia(wc,isBlocked()?'pause':'status',platform,isBlocked())))).flat();
      if(mediaView?.webContents!==contents||mediaIdentity(state.media.url)!==identity||(runtimeTab()?.seekVersion||0)!==seekVersion)return;
      if(platform==='douyin'&&values.some(v=>v.rateLimited)){await stopRateLimitedSource(contents);return;}
      const playing=values.some(v=>v.count>0)?values.some(v=>v.playing):null;const hint=!isBlocked()?values.find(v=>v.hint)?.hint:undefined;
      const currentTab=runtimeTab();
      if(platform==='youtube'&&currentTab&&!isBlocked()){
        const failure=values.find(value=>value.playbackError)?.playbackError||'';
        const intended=currentTab.resumeOnActivate||state.resume.mediaWasPlaying||state.media.playing===true;
        const recovery=currentTab.youtubeRecovery??=new YouTubePlaybackRecovery();
        const event=recovery.observe({identity,error:failure,playing,position:values.find(v=>v.count>0)?.currentTime||0,intended,now:Date.now()});
        if(event?.kind==='detected'){
          playbackDiagnostic('detected',currentTab.media.url,event.attempt,failure);
          state.media.status='YouTube 播放中断，准备自动恢复';emit();
        }else if(event?.kind==='recovered'){
          playbackDiagnostic('recovered',currentTab.media.url,event.attempt);
          state.media.status='YouTube 已自动恢复播放';emit();
        }else if(event?.kind==='exhausted'){
          playbackDiagnostic('exhausted',currentTab.media.url,event.attempt,failure);
          state.media.status='YouTube 自动恢复未成功，请检查网络或手动刷新';emit();
        }else if(event?.kind==='retry'){
          // Use the last confirmed playing position, never the errored player's
          // often-reset time of 0, and preserve the user's play/pause intention.
          const position=Math.max(0,currentTab.time||state.resume.mediaTime||0);
          const autoplay=intended;
          playbackDiagnostic('retry',currentTab.media.url,event.attempt,failure||'no-forward-progress');
          if(state.fullscreen)await fullscreen(false);
          if(mediaView?.webContents!==contents||currentTab!==runtimeTab()||isBlocked()||mediaIdentity(currentTab.media.url)!==identity)return;
          currentTab.time=position;currentTab.restorePending=true;currentTab.resumeOnActivate=autoplay;
          pendingMediaRestore={time:position,autoplay};
          state.media.loading=true;state.media.error='';state.media.status=`YouTube 自动重试 ${event.attempt}/2，恢复至上次观看位置`;
          updateResume({mediaTime:position,mediaWasPlaying:autoplay},true);emit();
          try{contents.reload();}catch(e){
            playbackDiagnostic('reload-failed',currentTab.media.url,event.attempt);
            currentTab.restorePending=false;pendingMediaRestore=null;
            state.media.loading=false;state.media.status='YouTube 重新加载失败，请手动刷新';emit();
          }
          return;
        }
        if(failure){
          // Ignore the error screen's paused/zero-time status: overwriting it
          // would destroy the resume point and the autoplay intention.
          return;
        }
      }
      if(!isBlocked()){
        const principal=values.find(v=>v.count>0&&!v.adPlaying);if(principal&&!runtimeTab()?.restorePending){const active=runtimeTab();if(active)rememberVideo(active,principal);const time=Math.max(0,principal.currentTime||0);if(Math.abs(time-state.resume.mediaTime)>=1||playing!==state.resume.mediaWasPlaying){state.resume={...state.resume,section:'video',activeSourceId:state.activeSourceId,mediaUrl:state.media.url,mediaTime:time,mediaWasPlaying:playing===true,recoveredAfterCrash:false};checkpointSession();}}
      }
      const current=runtimeTab();if(current){current.media.url=state.media.url;current.media.title=state.media.title;current.media.loading=state.media.loading;current.media.error=state.media.error;current.media.muted=state.media.muted;current.media.playing=playing;if(hint)current.media.status=hint;syncBrowserTabs();}
      if(playing!==state.media.playing||(hint&&hint!==state.media.status)){state.media.playing=playing;if(hint)state.media.status=hint;emit();}
    }finally{statusBusy=false;}
  },1200);mediaTimer.unref();
  // Load the packaged UI from extraResources with a canonical file URL.
  // Keep local navigation restricted to this exact file.
  await win.loadURL(homeUrl);
  controlsView=new WebContentsView({webPreferences:{preload:overlayPreload,nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
  controlsView.setBackgroundColor('#00000000');controlsView.setVisible(false);win.contentView.addChildView(controlsView);
  controlsView.webContents.setWindowOpenHandler(()=>({action:'deny'}));controlsView.webContents.on('will-navigate',(event,url)=>{if(!isSameLocalFile(url,fullscreenControlsFile))event.preventDefault();});
  controlsView.webContents.on('before-input-event',(event,input)=>{if(input.type==='keyDown'&&input.key==='Escape'){event.preventDefault();void fullscreen(false);}});
  await controlsView.webContents.loadURL(fullscreenControlsUrl);
  if(testing)EventEmitter.prototype.on.call(app,'qixu:test-unlock',requestUnlock);
  if(testing)EventEmitter.prototype.on.call(app,'qixu:test-native-key',()=>todoHost.send('TEST_CTRL_ALT'));
  if(testing)EventEmitter.prototype.on.call(app,'qixu:test-native-command',(command:string)=>{if(['TEST_WINDOWS','TEST_OPEN_LIST','TEST_CLOSE_WIDGET','TEST_GLOBAL_CTRL_ALT','TEST_OPEN_BOSS_KEY','TEST_BOSS_KEY_VISIBLE'].includes(command))todoHost.send(command);});
  const nativeExe=app.isPackaged?path.join(process.resourcesPath,'native','TodoHost.exe'):path.join(__dirname,'../native/TodoHost.exe');
  if(!skipTodoHostForTests){
    await todoHost.start(nativeExe,dataDir,process.execPath,state.settings.launchAtLogin,process.argv.includes('--autostart'),testing,bossKeyConfig.shortcutConfigured);
    todoHost.send('SPEECH_VOICES');
  }
  state.todoReady=true;if(process.argv.includes('--boss-key-settings'))openBossKeySettings();else if(!bossKeyConfig.configured)requestUnlock();if(state.notice)todoHost.send('STATUS:'+state.notice);emit();
}
if(!testing&&!app.requestSingleInstanceLock())app.quit();else {
  app.on('second-instance',(_event,args)=>{if(args.includes('--quit')){quitting=true;app.quit();}else if(args.includes('--boss-key-settings'))openBossKeySettings();else if(state.access==='private')restore();else showTodo();});app.whenReady().then(()=>{if(process.argv.includes('--quit')){app.exit(0);return;}return start();}).catch(async err=>{await fs.mkdir(dataDir,{recursive:true});await fs.writeFile(path.join(dataDir,'startup-error.log'),String(err.stack||err));if(!testing)dialog.showErrorBox('栖序启动失败',String(err));app.exit(1);});
  app.on('window-all-closed',()=>{if(quitting)app.quit();});
  let cleanupStarted=false;
  let quitPending=false;
  app.on('before-quit',event=>{if(cleanupStarted)return;event.preventDefault();if(quitPending)return;quitPending=true;
    void (async()=>{if(backups.operation.busy)throw Error('备份或恢复正在进行，请完成后再退出');await flushUserData();cleanupStarted=true;quitting=true;narrator.stop();globalShortcut.unregisterAll();++transitionVersion;translator.stop();await pauseAll();persist(true);checkpointSession(true,true);await Promise.all([persistQueue,checkpointQueue,todoHost.stop(),flushSessions()]);stateWriter.close();for(const popup of popups)if(!popup.isDestroyed())popup.destroy();for(const tab of runtimeTabs.values())if(!tab.view.webContents.isDestroyed())tab.view.webContents.close();runtimeTabs.clear();tabOrder.length=0;tray?.destroy();app.quit();})().catch(error=>{quitPending=false;quitting=false;cleanupStarted=false;showTodo('退出暂缓：'+error.message);});
  });
}
