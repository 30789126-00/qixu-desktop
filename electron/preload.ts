import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { AppAPI, AppState } from '../shared/types';
const invoke = (method: string, ...args: unknown[]) => ipcRenderer.invoke('moyu:invoke', method, ...args);
const api: AppAPI = {
  speakBook:segment=>invoke('speakBook',segment),
  narrationAction:(action,runId)=>invoke('narrationAction',action,runId),
  updateBossKey: patch=>invoke('updateBossKey',patch),
  submitPassword: password=>invoke('submitPassword',password),
  cancelUnlock: ()=>invoke('cancelUnlock'),
  setLoginMode: enabled=>invoke('setLoginMode',enabled),
  translationAction: action=>invoke('translationAction',action),
  lockToTodo: ()=>invoke('lockToTodo'),
  getState: () => invoke('getState'),
  onState: callback => { const listener = (_: unknown, state: AppState) => callback(state); ipcRenderer.on('moyu:state', listener); return () => ipcRenderer.removeListener('moyu:state', listener); },
  onBrowserCommand: callback => { const listener = (_: unknown, command: 'find'|'nextTab'|'prevTab') => callback(command); ipcRenderer.on('moyu:browser-command', listener); return () => ipcRenderer.removeListener('moyu:browser-command', listener); },
  updateSettings: patch => invoke('updateSettings',patch), windowAction: action => invoke('windowAction',action), setSection: section => invoke('setSection',section), setViewport: rect => invoke('setViewport',rect),
  openSource: (id,url) => invoke('openSource',id,url), switchBrowserTab: id=>invoke('switchBrowserTab',id), closeBrowserTab:id=>invoke('closeBrowserTab',id), setBrowserTabMobile:(id,enabled)=>invoke('setBrowserTabMobile',id,enabled), toggleBrowserBookmark:()=>invoke('toggleBrowserBookmark'), clearBrowserHistory:()=>invoke('clearBrowserHistory'), findInPage:(query,forward)=>invoke('findInPage',query,forward), stopFindInPage:()=>invoke('stopFindInPage'), navigate: (action,url) => invoke('navigate',action,url), mediaAction: (action,value) => invoke('mediaAction',action,value),
  saveSources: sources => invoke('saveSources',sources), importBooks: paths => invoke('importBooks',paths), pathsForFiles: files => files.map(file=>webUtils.getPathForFile(file)).filter(Boolean),
  getBookContent: id => invoke('getBookContent',id), saveBook: (id,patch) => invoke('saveBook',id,patch), setReaderSession: id=>invoke('setReaderSession',id), deleteBook: id=>invoke('deleteBook',id), openExternal: ()=>invoke('openExternal')
};
contextBridge.exposeInMainWorld('moyu',api);
