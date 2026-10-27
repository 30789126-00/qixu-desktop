import { app, BrowserWindow, WebContentsView, ipcMain, screen, globalShortcut, nativeTheme, Tray, Menu, nativeImage, dialog, shell, powerMonitor, session, Notification, net } from 'electron';
import type { Rectangle, WebContents } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import JSZip from 'jszip';
import {SaveCoordinator} from './save-coordinator';
import {WindowDiagnostics} from './window-diagnostics';
import {videoIdentity,progressId,recordVideo,sanitizeVideoProgress} from './video-progress';
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
type RuntimeBrowserTab={id:string;sourceId:string;platform:string;view:WebContentsView;sleeping?:boolean;lastActive?:number;time?:number;restorePending?:boolean;seekVersion?:number;media:MediaState;mobile:boolean;desktopUA:string;resumeOnActivate:boolean};
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
const preload = path.join(__dirname,'preload.cjs');
const homeFile = path.join(__dirname,'../dist/index.html');
const homeUrl = pathToFileURL(homeFile).href;
const fullscreenControlsFile = path.join(__dirname,'../assets/fullscreen-controls.html');
const fullscreenControlsUrl = pathToFileURL(fullscreenControlsFile).href;
const overlayPreload = path.join(__dirname,'overlay-preload.cjs');

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
    const snapshot = structuredClone({ settings:state.…12942 tokens truncated…'string'&&patch.title.trim())book.title=patch.title.trim().slice(0,200);
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
  win.webContents.on('will-navigate',(event,url)=>{if(url!==homeUrl)event.preventDefault();});
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
      if(!isBlocked()){
        const principal=values.find(v=>v.count>0&&!v.adPlaying);if(principal&&!runtimeTab()?.restorePending){const active=runtimeTab();if(active)rememberVideo(active,principal);const time=Math.max(0,principal.currentTime||0);if(Math.abs(time-state.resume.mediaTime)>=1||playing!==state.resume.mediaWasPlaying){state.resume={...state.resume,section:'video',activeSourceId:state.activeSourceId,mediaUrl:state.media.url,mediaTime:time,mediaWasPlaying:playing===true,recoveredAfterCrash:false};checkpointSession();}}
      }
      const current=runtimeTab();if(current){current.media.url=state.media.url;current.media.title=state.media.title;current.media.loading=state.media.loading;current.media.error=state.media.error;current.media.muted=state.media.muted;current.media.playing=playing;if(hint)current.media.status=hint;syncBrowserTabs();}
      if(playing!==state.media.playing||(hint&&hint!==state.media.status)){state.media.playing=playing;if(hint)state.media.status=hint;emit();}
    }finally{statusBusy=false;}
  },1200);mediaTimer.unref();
  await win.loadFile(homeFile);
  controlsView=new WebContentsView({webPreferences:{preload:overlayPreload,nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
  controlsView.setBackgroundColor('#00000000');controlsView.setVisible(false);win.contentView.addChildView(controlsView);
  controlsView.webContents.setWindowOpenHandler(()=>({action:'deny'}));controlsView.webContents.on('will-navigate',(event,url)=>{if(url!==fullscreenControlsUrl)event.preventDefault();});
  controlsView.webContents.on('before-input-event',(event,input)=>{if(input.type==='keyDown'&&input.key==='Escape'){event.preventDefault();void fullscreen(false);}});
  await controlsView.webContents.loadFile(fullscreenControlsFile);
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
