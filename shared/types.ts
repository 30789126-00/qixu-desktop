export type Section = 'video' | 'library' | 'settings';
export type WindowState = 'visible' | 'autoHidden' | 'panicHidden' | 'minimized' | 'suspended';
export interface Settings {
  theme: 'system' | 'light' | 'dark'; opacity: number; alwaysOnTop: boolean; autoHide: boolean;
  shortcut: string; launchAtLogin: boolean; fontSize: number; lineHeight: number;
  readerWidth: number; readerTheme: 'light' | 'sepia' | 'dark'; scrollSpeed: number;
  autoTranslate: boolean; bilingualSubtitles: boolean; translationDisabledSites: string[];
  autoSkipYouTubeAds: boolean;
}
export interface TranslationState { model: 'idle'|'loading'|'ready'|'error'; page: string; subtitles: string; error: string; completed: number; }
export interface Source { id: string; title: string; url: string; kind: 'video' | 'novel'; color: string; abbr: string; }
/** percent is a fraction in [0, 1]. */
export interface BookProgress { position: string; percent: number; }
export interface Bookmark { id: string; label: string; position: string; percent: number; }
export interface Book { id: string; title: string; type: 'txt' | 'epub'; size: number; addedAt: number; progress: BookProgress | null; bookmarks: Bookmark[]; encoding?: string; }
export interface MediaState { url: string; title: string; loading: boolean; error: string; playing: boolean | null; muted: boolean; status: string; cooldownUntil?:number; }
export interface BrowserTab { id: string; sourceId: string; title: string; url: string; loading: boolean; error: string; mobile: boolean; }
export interface BrowserHistoryEntry { id: string; sourceId: string; title: string; url: string; visitedAt: number; }
export interface BrowserBookmark { id: string; sourceId: string; title: string; url: string; addedAt: number; }
export interface ResumeState {
  section: Section;
  activeSourceId: string | null;
  mediaUrl: string;
  mediaTime: number;
  mediaWasPlaying: boolean;
  activeBookId: string | null;
  recoveredAfterCrash: boolean;
}
export interface BossKeyState { configured:boolean; passwordRequired:boolean; }
export interface BossKeyUpdate { shortcut:string; passwordRequired:boolean; currentPassword?:string; newPassword?:string; }
export interface AppState { bossKey:BossKeyState; access: 'todo'|'prompt'|'private'; todoReady: boolean; settings: Settings; sources: Source[]; books: Book[]; section: Section; activeSourceId: string | null; activeTabId: string | null; browserTabs: BrowserTab[]; browserHistory: BrowserHistoryEntry[]; browserBookmarks: BrowserBookmark[]; windowState: WindowState; fullscreen: boolean; media: MediaState; notice: string; loginMode: boolean; translation: TranslationState; resume: ResumeState; }
export interface Rect { x: number; y: number; width: number; height: number; }
export interface AppAPI {
  updateBossKey(patch:BossKeyUpdate):Promise<AppState>;
  submitPassword(password: string): Promise<boolean>;
  cancelUnlock(): Promise<void>;
  lockToTodo(): Promise<void>;
  getState(): Promise<AppState>;
  onState(callback: (state: AppState) => void): () => void;
  updateSettings(patch: Partial<Settings>): Promise<AppState>;
  windowAction(action: 'hide' | 'minimize' | 'maximize' | 'close' | 'restore' | 'fullscreen'): Promise<void>;
  setSection(section: Section): Promise<void>;
  setViewport(rect: Rect | null): Promise<void>;
  openSource(id: string, url?: string): Promise<void>;
  switchBrowserTab(id: string): Promise<void>;
  closeBrowserTab(id: string): Promise<void>;
  setBrowserTabMobile(id: string, enabled: boolean): Promise<void>;
  toggleBrowserBookmark(): Promise<void>;
  clearBrowserHistory(): Promise<void>;
  findInPage(query: string, forward?: boolean): Promise<void>;
  stopFindInPage(): Promise<void>;
  navigate(action: 'back' | 'forward' | 'reload' | 'url', url?: string): Promise<void>;
  mediaAction(action: 'play' | 'pause' | 'mute' | 'fullscreen', value?: boolean): Promise<void>;
  saveSources(sources: Source[]): Promise<void>;
  importBooks(paths?: string[]): Promise<Book[]>;
  pathsForFiles(files: File[]): string[];
  getBookContent(id: string): Promise<Uint8Array>;
  saveBook(id: string, patch: Partial<Pick<Book, 'progress' | 'bookmarks' | 'encoding' | 'title'>>): Promise<void>;
  setReaderSession(bookId: string | null): Promise<void>;
  deleteBook(id: string): Promise<void>;
  openExternal(): Promise<void>;
  setLoginMode(enabled: boolean): Promise<void>;
  translationAction(action: 'toggleSite'|'retry'): Promise<void>;
  onBrowserCommand(callback: (command: 'find'|'nextTab'|'prevTab') => void): () => void;
}
declare global { interface Window { moyu: AppAPI; } }
