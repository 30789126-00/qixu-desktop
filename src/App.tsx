import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, BookOpen, Bookmark, Check, ChevronRight, ExternalLink, EyeOff, FolderPlus, Globe2, History, House, Library, Maximize, Maximize2, Minus, MoreHorizontal, Pause, Pin, Play, Plus, Search, Settings2, ShieldCheck, Smartphone, Sparkles, Trash2, Volume2, VolumeX, X, RotateCw } from 'lucide-react';
import type { AppState, Book, Settings, Source } from '../shared/types';
import Reader from './Reader';
import Unlock from './Unlock';
import BossKey from './BossKey';

const api = window.moyu;
const sections = [{ id: 'video', label: '视频', icon: Play }, { id: 'library', label: '书架', icon: Library }, { id: 'settings', label: '设置', icon: Settings2 }] as const;

function Mark({ small = false }: { small?: boolean }) {
  return <span className={`brand-mark ${small ? 'small' : ''}`}><svg viewBox="0 0 40 40" fill="none" aria-hidden="true"><path d="M20 5 36 14 20 23 4 14Z" fill="white"/><path d="m4 21 16 9 16-9M4 28l16 9 16-9" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" opacity=".75"/></svg></span>;
}
function IconButton({ label, children, onClick, active = false, className = '', disabled = false }: { label: string; children: ReactNode; onClick?: () => void; active?: boolean; className?: string; disabled?: boolean }) {
  return <button type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled} className={`icon-button ${active ? 'active' : ''} ${className}`}>{children}</button>;
}
function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return <button type="button" className={`toggle ${checked ? 'checked' : ''}`} role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}><span/></button>;
}
function Row({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return <div className="setting-row"><div className="setting-label"><strong>{title}</strong>{description && <span>{description}</span>}</div><div className="setting-control">{children}</div></div>;
}
function SourceIcon({ source, large = false }: { source: Source; large?: boolean }) {
  return <span className={`source-icon ${large ? 'large' : ''}`} style={{ '--source-color': source.color } as CSSProperties}>{source.abbr}</span>;
}
function sizeLabel(size: number) { return size < 1024 * 1024 ? `${Math.round(size / 1024)} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`; }

export default function App(){
 const [state,setState]=useState<AppState|null>(null);
 useEffect(()=>{void api.getState().then(setState);return api.onState(setState);},[]);
 useEffect(()=>{if(state)document.documentElement.dataset.theme=state.settings.theme;},[state?.settings.theme]);
 useEffect(()=>{if(!state?.bossKeyPanel)return;const close=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();void api.cancelUnlock();}};window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close);},[state?.bossKeyPanel]);
 if(state?.bossKeyPanel)return <main className="unlock-shell boss-key-welcome"><header className="unlock-drag"><span>栖序 · 待办设置</span><button aria-label="返回待办" onClick={()=>void api.cancelUnlock()}><X size={17}/></button></header><section className="boss-key-intro"><h1>老板键</h1><p>设置切换快捷键与访问验证。保存后，此入口移到影音模式的「设置 → 老板键」。</p><BossKey state={state}/></section></main>;
 if(state?.access==='private')return <PrivateSpace/>;
 if(state?.access==='prompt')return state.bossKey.configured?<Unlock/>:<BossKey state={state} initial/>;
 return <div className="app-loading"><Mark/><span>栖序 · 今日安排</span></div>;
}
function PrivateSpace() {
  const [state, setState] = useState<AppState | null>(null);
  const [toast, setToast] = useState('');
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const [sourceEditor, setSourceEditor] = useState(false);
  const [sourceList, setSourceList] = useState(false);
  const [deleteBook, setDeleteBook] = useState<Book | null>(null);
  const [busy, setBusy] = useState(false);
  const [address, setAddress] = useState('');
  const [dragging, setDragging] = useState(false);
  const [sidebarOpen,setSidebarOpen]=useState(false);
  const [videoTab,setVideoTab]=useState<'home'|'content'>('home');
  const videoTabInitialized=useRef(false);
  const readerRestored=useRef(false);
  const [findOpen,setFindOpen]=useState(false);
  const [findQuery,setFindQuery]=useState('');
  const [browserPanel,setBrowserPanel]=useState<'history'|'bookmarks'|null>(null);
  useEffect(()=>setSidebarOpen(false),[state?.activeSourceId,selectedBookId]);
  const host = useRef<HTMLDivElement>(null);
  const noticeRef = useRef('');
  const dragDepth = useRef(0);
  const notify = useCallback((message: string) => setToast(message), []);
  const run = useCallback(async (task: Promise<unknown>) => {
    try { await task; } catch (error) { notify(error instanceof Error ? error.message : String(error)); }
  }, [notify]);
  const updateSettings = useCallback(async (patch: Partial<Settings>) => {
    try { const next = await api.updateSettings(patch); setState(next); }
    catch (error) { notify(error instanceof Error ? error.message : String(error)); }
  }, [notify]);
  useEffect(() => {
    api.getState().then(setState).catch(error => notify(String(error)));
    return api.onState(setState);
  }, [notify]);
  useEffect(()=>{
    if(!state||videoTabInitialized.current)return;
    videoTabInitialized.current=true;
    setVideoTab(state.section==='video'&&!!state.activeTabId?'content':'home');
  },[state]);
  useEffect(()=>api.onBrowserCommand(command=>{if(command==='find')setFindOpen(true);}),[]);
  useEffect(()=>{if(state&&state.browserTabs.length===0)setVideoTab('home');},[state?.browserTabs.length]);
  useEffect(() => { if (!toast) return; const timeout = setTimeout(() => setToast(''), 5500); return () => clearTimeout(timeout); }, [toast]);
  useEffect(() => {
    if (state?.notice && state.notice !== noticeRef.current) notify(state.notice);
    noticeRef.current = state?.notice || '';
  }, [state?.notice, notify]);
  useEffect(() => { setAddress(state?.media.url || ''); }, [state?.media.url]);
  useEffect(() => {
    if (!state || readerRestored.current) return;
    readerRestored.current=true;
    if (state.section !== 'library' || !state.resume.activeBookId) return;
    if (state.books.some(item => item.id === state.resume.activeBookId)) setSelectedBookId(current => current || state.resume.activeBookId);
  }, [state]);
  useEffect(() => {
    if (!state) return;
    document.documentElement.dataset.theme = state.settings.theme;
  }, [state?.settings.theme]);

  const modal = sourceEditor || sourceList || !!deleteBook || dragging;
  const showingVideo = state?.section === 'video' && !!state.activeSourceId && videoTab==='content';
  useLayoutEffect(() => {
    const element = host.current;
    if (!showingVideo || modal || state?.media.error || !element) { void api.setViewport(null); return; }
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = element.getBoundingClientRect();
        void api.setViewport({ x: Math.round(rect.x), y: Math.round(rect.y), width: Math.max(0, Math.round(rect.width)), height: Math.max(0, Math.round(rect.height)) });
      });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element); measure(); window.addEventListener('resize', measure);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener('resize', measure); };
  }, [showingVideo, modal, state?.fullscreen, state?.activeSourceId, state?.section, state?.media.error]);
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setSourceEditor(false); setSourceList(false); setDeleteBook(null);setBrowserPanel(null);if(findOpen){setFindOpen(false);void api.stopFindInPage();} if (state?.fullscreen) void run(api.mediaAction('fullscreen', false)); }
      if(event.ctrlKey&&event.key.toLowerCase()==='f'){event.preventDefault();setFindOpen(true);}
      if(event.ctrlKey&&event.key==='Tab'&&state?.browserTabs.length){event.preventDefault();const index=Math.max(0,state.browserTabs.findIndex(tab=>tab.id===state.activeTabId));const next=(index+(event.shiftKey?-1:1)+state.browserTabs.length)%state.browserTabs.length;setVideoTab('content');void run(api.switchBrowserTab(state.browserTabs[next].id));}
    };
    window.addEventListener('keydown', handleKey); return () => window.removeEventListener('keydown', handleKey);
  }, [state?.fullscreen,state?.browserTabs,state?.activeTabId,findOpen, run]);

  async function importBooks(paths?: string[]) {
    setBusy(true);
    try {
      const books = await api.importBooks(paths);
      if (books.length) { notify(`已将 ${books.length} 本书放入书架`); setSelectedBookId(null); await api.setSection('library'); }
    } catch (error) { notify(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  const openSource = (source: Source,url?:string) => { setVideoTab('content');setSidebarOpen(false);setSourceList(false); setSelectedBookId(null); void api.setReaderSession(null); void run(api.openSource(source.id,url)); };
  const openVideoHome = () => { setVideoTab('home');setSidebarOpen(false);setSelectedBookId(null);void api.setReaderSession(null); };
  const reopenVideoTab = (tabId?:string) => { const id=tabId||state?.activeTabId;if(id){setVideoTab('content');setSidebarOpen(false);void run(api.switchBrowserTab(id));} };
  const closeFind=()=>{setFindOpen(false);setFindQuery('');void api.stopFindInPage();};
  const openBook = (id: string) => { setSelectedBookId(id); void run(api.setReaderSession(id)); };
  const closeBook = () => { setSelectedBookId(null); void run(api.setReaderSession(null)); };
  if (!state) return <div className="app-loading"><Mark/><span>正在准备你的片刻闲暇…</span></div>;
  const active = state.sources.find(source => source.id === state.activeSourceId);
  const activeBrowserTab=state.browserTabs.find(tab=>tab.id===state.activeTabId);
  const bookmarked=!!state.media.url&&state.browserBookmarks.some(entry=>entry.url===state.media.url);
  const book = state.books.find(item => item.id === selectedBookId);
  const reading = state.section === 'library' && !!book;
  const fullscreen = !!state.fullscreen && !!showingVideo;
  return <div className={`app-shell ${fullscreen ? 'is-fullscreen' : ''} ${reading ? 'is-reading' : ''}`}
    onDragEnter={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); dragDepth.current++; setDragging(true); } }}
    onDragLeave={event => { event.preventDefault(); if (--dragDepth.current <= 0) { dragDepth.current = 0; setDragging(false); } }}
    onDragOver={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } }}
    onDrop={event => { event.preventDefault(); dragDepth.current = 0; setDragging(false); const paths = api.pathsForFiles(Array.from(event.dataTransfer.files)); if (paths.length) void importBooks(paths); }}>

    {!fullscreen && ((!showingVideo&&!reading)||sidebarOpen) && <aside className="sidebar">
      <div className="sidebar-brand"><Mark/><span>栖序<span className="brand-caption">一点闲暇，刚刚好</span></span></div>
      <div className="nav-caption">我的空间</div>
      <nav>{sections.map(({ id, label, icon: Icon }) => <button key={id} className={`nav-item ${state.section === id ? 'selected' : ''}`} onClick={() => { setSelectedBookId(null); void api.setReaderSession(null); if(id==='video')setVideoTab('home'); void run(api.setSection(id)); }} title={label}><Icon size={20} strokeWidth={1.9}/><span>{label}</span>{id === 'library' && state.books.length > 0 && <span className="nav-count">{state.books.length}</span>}</button>)}</nav>
      <div className="sidebar-divider"/>
      <div className="nav-caption">常去看看</div>
      <div className="quick-sites">{state.sources.filter(source => source.kind === 'video').slice(0, 5).map(source => <button key={source.id} className={state.activeSourceId === source.id && state.section === 'video' ? 'selected' : ''} onClick={() => openSource(source)} title={source.title}><SourceIcon source={source}/><span>{source.title}</span><ChevronRight size={13}/></button>)}</div>
      <div className="sidebar-bottom"><div className="quiet-card"><span className="quiet-dot"/><span>给自己，留一点空白。</span></div><button className="panic-button" onClick={() => void run(api.windowAction('hide'))}><EyeOff size={17}/><span>隐藏影音<kbd>{state.settings.shortcut.replace('Control', 'Ctrl').replaceAll('+', ' + ')}</kbd></span></button><span className="sidebar-version">QIXU · 1.7</span></div>
    </aside>}

    <div className="workspace">
      <header className="window-bar">
        <div className="window-label">{!fullscreen&&(showingVideo||reading)&&<IconButton label={sidebarOpen?'收起导航':'展开导航'} onClick={()=>setSidebarOpen(v=>!v)}><MoreHorizontal size={18}/></IconButton>}{!fullscreen&&<button className="back-to-todo" onClick={()=>void api.lockToTodo()}><ArrowLeft size={13}/>待办</button>}{fullscreen ? <><span className="tiny-dot"/>{active?.title || '视频'}<span className="window-hint">窗口内全屏</span></> : <><span className="tiny-dot"/>{reading ? '阅读时光' : state.section === 'video' ? '视频空间' : state.section === 'library' ? '私人书架' : '偏好设置'}</>}</div>
        <div className="window-tools">
          {fullscreen ? <button className="exit-fullscreen" onClick={() => void run(api.mediaAction('fullscreen', false))}><Maximize size={14}/>退出全屏 <kbd>Esc</kbd></button> : <>
            <label className="opacity-mini" title={`窗口不透明度 ${Math.round(state.settings.opacity * 100)}%`}><span>透明度</span><input aria-label="窗口不透明度" type="range" min="20" max="100" value={Math.round(state.settings.opacity * 100)} onChange={event => void updateSettings({ opacity: Number(event.target.value) / 100 })}/></label>
            <IconButton label={state.settings.alwaysOnTop ? '取消置顶' : '窗口置顶'} active={state.settings.alwaysOnTop} onClick={() => void updateSettings({ alwaysOnTop: !state.settings.alwaysOnTop })}><Pin size={15}/></IconButton>
          </>}
          <IconButton label={`隐藏窗口 (${state.settings.shortcut})`} onClick={() => void run(api.windowAction('hide'))}><EyeOff size={16}/></IconButton>
          <span className="window-separator"/>
          <IconButton label="最小化" onClick={() => void run(api.windowAction('minimize'))}><Minus size={16}/></IconButton>
          {!fullscreen && <IconButton label="最大化 / 还原" onClick={() => void run(api.windowAction('maximize'))}><Maximize2 size={13}/></IconButton>}
          <IconButton label="收起至托盘" className="window-close" onClick={() => void run(api.windowAction('close'))}><X size={17}/></IconButton>
        </div>
      </header>

      {!fullscreen&&state.section==='video'&&<div className="browser-tabs" role="tablist" aria-label="摸鱼模式标签页">
        <button role="tab" aria-selected={videoTab==='home'} className={`browser-tab home-tab ${videoTab==='home'?'selected':''}`} onClick={openVideoHome} title="摸鱼主页"><House size={14}/><span>主页</span></button>
        {state.browserTabs.map(tab=>{const source=state.sources.find(item=>item.id===tab.sourceId);return <div className={`browser-tab-shell ${videoTab==='content'&&tab.id===state.activeTabId?'selected':''}`} key={tab.id}>{<button role="tab" aria-selected={videoTab==='content'&&tab.id===state.activeTabId} className="browser-tab content-tab" onClick={()=>reopenVideoTab(tab.id)} title={tab.title||source?.title}>{source&&<SourceIcon source={source}/>}<span>{tab.title||source?.title||'网页'}</span>{tab.loading&&<i className="tab-loading"/>}</button>}<button className="browser-tab-close" aria-label={`关闭 ${tab.title||'标签页'}`} title="关闭标签页" onClick={()=>void run(api.closeBrowserTab(tab.id))}><X size={12}/></button></div>})}
        <button className="browser-tab-add" aria-label="打开网站" title="打开网站" onClick={()=>setSourceList(true)}><Plus size={15}/></button>
      </div>}

      {showingVideo ? <section className="browser-space">
        {!fullscreen && <>
          <div className="browser-toolbar"><div className="browser-navigation"><IconButton label="返回" onClick={() => void run(api.navigate('back'))}><ArrowLeft size={16}/></IconButton><IconButton label="前进" onClick={() => void run(api.navigate('forward'))}><ArrowRight size={16}/></IconButton><IconButton label="刷新" onClick={() => void run(api.navigate('reload'))}><RotateCw size={15} className={state.media.loading ? 'spin' : ''}/></IconButton></div>
            <form className="address-form" onSubmit={event => { event.preventDefault(); void run(api.navigate('url', address)); }}><Globe2 size={14}/><input aria-label="网址" value={address} onChange={event => setAddress(event.target.value)} onFocus={event => event.target.select()} placeholder="输入或粘贴网址" spellCheck={false}/><button aria-label="打开网址" title="打开网址"><ArrowRight size={14}/></button></form>
            <IconButton label="页面内查找 (Ctrl+F)" active={findOpen} onClick={()=>setFindOpen(value=>!value)}><Search size={15}/></IconButton>
            <IconButton label={bookmarked?'取消当前书签':'收藏当前网页'} active={bookmarked} onClick={()=>void run(api.toggleBrowserBookmark())}><Bookmark size={15}/></IconButton>
            <IconButton label="我的书签" onClick={()=>setBrowserPanel('bookmarks')}><BookOpen size={15}/></IconButton>
            <IconButton label="历史记录" onClick={()=>setBrowserPanel('history')}><History size={15}/></IconButton>
            <IconButton label={activeBrowserTab?.mobile?'切换电脑模式':'切换手机模式'} active={!!activeBrowserTab?.mobile} onClick={()=>activeBrowserTab&&void run(api.setBrowserTabMobile(activeBrowserTab.id,!activeBrowserTab.mobile))}><Smartphone size={15}/></IconButton>
            <button className={`login-mode-button ${state.loginMode?'active':''}`} aria-pressed={state.loginMode} title="登录期间暂停自动隐藏，紧急隐藏仍然有效" onClick={()=>void run(api.setLoginMode(!state.loginMode))}><ShieldCheck size={14}/>{state.loginMode?'完成登录':'登录操作中'}</button>
            <IconButton label="切换网站" onClick={() => setSourceList(true)}><MoreHorizontal size={18}/></IconButton>
          </div>
          {findOpen&&<form className="browser-find-bar" onSubmit={event=>{event.preventDefault();void run(api.findInPage(findQuery,true));}}><Search size={14}/><input autoFocus value={findQuery} onChange={event=>{setFindQuery(event.target.value);if(event.target.value.trim())void api.findInPage(event.target.value,true);}} placeholder="在当前页面查找"/><IconButton label="上一个" onClick={()=>void run(api.findInPage(findQuery,false))}><ArrowUp size={14}/></IconButton><IconButton label="下一个" onClick={()=>void run(api.findInPage(findQuery,true))}><ArrowDown size={14}/></IconButton><IconButton label="关闭查找" onClick={closeFind}><X size={14}/></IconButton></form>}
          <div className="media-toolbar"><button className="current-source" onClick={() => setSourceList(true)}>{active && <SourceIcon source={active}/>}<span>{active?.title || '浏览网页'}</span><ChevronRight size={12}/></button><span className="media-status">{state.media.error ? '加载遇到问题' : state.media.loading ? '正在加载…' : state.media.status || '已就绪'}</span><div className="media-tools"><IconButton label={state.media.playing ? '暂停播放' : '继续播放'} onClick={() => void run(api.mediaAction(state.media.playing ? 'pause' : 'play'))}>{state.media.playing ? <Pause size={15}/> : <Play size={15}/>}</IconButton><IconButton label={state.media.muted ? '取消静音' : '静音'} active={state.media.muted} onClick={() => void run(api.mediaAction('mute', !state.media.muted))}>{state.media.muted ? <VolumeX size={16}/> : <Volume2 size={16}/>}</IconButton><IconButton label="在浏览器中打开" onClick={() => void run(api.openExternal())}><ExternalLink size={15}/></IconButton><button className="fullscreen-button" onClick={() => void run(api.mediaAction('fullscreen', true))}><Maximize size={14}/><span>窗口内全屏</span></button></div></div>
        </>}
        {!fullscreen && <div className="translation-strip"><span className={state.translation.error?'translation-error':''} title={state.translation.error||state.translation.subtitles}>{state.loginMode?'登录期间已暂停自动隐藏':state.translation.error|| (state.translation.model==='loading'?'正在加载本地翻译模型…':state.translation.subtitles||'本地翻译 · 自动开启')}</span><div><button onClick={()=>void run(api.translationAction('toggleSite'))}>{state.settings.translationDisabledSites.some(site=>state.media.url.includes('://'+site+'/'))?'翻译此网站':'恢复原文'}</button><button aria-pressed={state.settings.bilingualSubtitles} onClick={()=>void updateSettings({bilingualSubtitles:!state.settings.bilingualSubtitles})}>{state.settings.bilingualSubtitles?'双语字幕：开':'双语字幕：关'}</button>{state.translation.error&&<button onClick={()=>void run(api.translationAction('retry'))}>重试</button>}</div></div>}
        <div className="web-host" ref={host}>{state.media.error && <div className="browser-error-page"><span className="error-illustration"><Globe2 size={36} strokeWidth={1.2}/></span><h2>{state.media.error.includes('访问太频繁')?'网站暂时限制了访问':'这个页面暂时没有回应'}</h2><p>{state.media.error}</p><span>{state.media.error.includes('访问太频繁')?'请先等待，不要反复扫码、发送验证码或刷新。':'检查网络连接后再试一次，或前往浏览器继续访问。'}</span><div><button className="button primary" onClick={() => void run(api.navigate('reload'))}><RotateCw size={14}/>重新加载</button><button className="button secondary" onClick={() => void run(api.openExternal())}><ExternalLink size={14}/>在浏览器中打开</button></div></div>}</div>
      </section> : reading && book ? <div className="reader-mount"><Reader book={book} settings={state.settings} narration={state.narration} windowState={state.windowState} onClose={closeBook} onSettingsChange={updateSettings}/></div> : state.section === 'library' ?
        <LibraryPage books={state.books} sources={state.sources} busy={busy} onImport={() => void importBooks()} onOpen={openBook} onDelete={setDeleteBook} onSource={openSource}/> : state.section === 'settings' ?
        <SettingsPage state={state} update={updateSettings} run={run} onAdd={() => setSourceEditor(true)}/> :
        <VideoHome sources={state.sources} onOpen={openSource} onAdd={() => setSourceEditor(true)} autoHide={state.settings.autoHide}/>}
    </div>

    {sourceEditor && <SourceEditor onClose={() => setSourceEditor(false)} onSave={async source => { await api.saveSources([...state.sources, source]); setSourceEditor(false); notify('新网站已添加'); }}/ >}
    {sourceList && <Modal title="想看点什么？" description="切换网站，继续你的闲暇时光。" onClose={() => setSourceList(false)}><div className="source-switcher">{state.sources.map(source => <button key={source.id} onClick={() => openSource(source)}><SourceIcon source={source}/><span>{source.title}</span>{source.id === state.activeSourceId ? <Check size={17}/> : <ChevronRight size={16}/>}</button>)}</div><button className="button secondary full-width" onClick={() => { setSourceList(false); setSourceEditor(true); }}><Plus size={16}/>添加网站</button></Modal>}
    {browserPanel&&<Modal title={browserPanel==='history'?'浏览历史':'我的书签'} description={browserPanel==='history'?'最近访问过的网页，仅保存在本机。':'收藏的网页，点击会在新标签中打开。'} onClose={()=>setBrowserPanel(null)}><div className="browser-library-list">{(browserPanel==='history'?state.browserHistory:state.browserBookmarks).slice(0,80).map(entry=>{const source=state.sources.find(item=>item.id===entry.sourceId);return <button key={entry.id} onClick={()=>{if(source)openSource(source,entry.url);setBrowserPanel(null);}}><span className="browser-library-icon">{source?<SourceIcon source={source}/>:<Globe2 size={15}/>}</span><span><strong>{entry.title}</strong><small>{new URL(entry.url).hostname}</small></span><ArrowRight size={14}/></button>})}{(browserPanel==='history'?state.browserHistory:state.browserBookmarks).length===0&&<div className="browser-library-empty">{browserPanel==='history'?'还没有浏览记录':'还没有收藏网页'}</div>}</div>{browserPanel==='history'&&state.browserHistory.length>0&&<div className="modal-actions"><button className="button secondary" onClick={()=>void run(api.clearBrowserHistory())}>清空历史</button></div>}</Modal>}
    {deleteBook && <Modal title="从书架移除这本书？" description={`《${deleteBook.title}》的阅读进度、书签及书库副本将一并移除，原始文件不受影响。`} onClose={() => setDeleteBook(null)}><div className="modal-actions"><button className="button secondary" onClick={() => setDeleteBook(null)}>保留</button><button className="button danger" onClick={async () => { try { await api.deleteBook(deleteBook.id); setDeleteBook(null); } catch (error) { notify(String(error)); } }}>移除书籍</button></div></Modal>}
    {dragging && <div className="drop-overlay"><div><FolderPlus size={44} strokeWidth={1.3}/><h2>松开，把故事放进书架。</h2><p>支持 TXT 与 EPUB · 文件会保存在本地书库</p></div></div>}
    {toast && <div className="toast" role="status"><span>{toast}</span><button aria-label="关闭提示" onClick={() => setToast('')}><X size={15}/></button></div>}
  </div>;
}

function VideoHome({ sources, onOpen, onAdd, autoHide }: { sources: Source[]; onOpen: (source: Source) => void; onAdd: () => void; autoHide: boolean }) {
  return <main className="page video-home">
    <section className="welcome-hero"><div className="hero-copy"><span className="eyebrow"><span/> YOUR LITTLE ESCAPE</span><h1>偷得半日闲<span>。</span></h1><p>世界很忙，你可以慢一点。<br/>找个喜欢的视频，让时间轻轻流过。</p><div className="hero-badge"><Sparkles size={13}/><span>一点快乐，随时打开</span></div></div><div className="hero-art" aria-hidden="true"><div className="orb-ring ring-one"/><div className="orb-ring ring-two"/><div className="orb-core"><Play fill="white" size={42} strokeWidth={0}/></div><span className="orb-spark spark-one"/><span className="orb-spark spark-two"/><span className="orb-spark spark-three"/><span className="floating-note">JUST A LITTLE BREAK</span></div></section>
    <div className="section-heading"><div><h2>今天，想看点什么？</h2><p>熟悉的内容，舒服的新空间。</p></div><span className="subtle-badge">{sources.filter(source => source.kind === 'video').length} 个视频来源</span></div>
    <div className="source-grid">{sources.filter(source => source.kind === 'video').map(source => <button className="source-card" key={source.id} onClick={() => onOpen(source)} style={{ '--source-color': source.color } as CSSProperties}><div className="source-card-top"><SourceIcon source={source} large/><span className="source-arrow"><ArrowRight size={18}/></span></div><strong>{source.title}</strong><span>{source.id.includes('douyin') ? '发现生活里的小美好' : source.id.includes('bili') ? '兴趣，让快乐发生' : source.id.includes('youtube') ? '看看更大的世界' : '喜欢的内容，随心看'}</span><span className="source-domain">{new URL(source.url).hostname.replace('www.', '')}</span></button>)}<button className="source-card add-source" onClick={onAdd}><span className="add-source-icon"><Plus size={25}/></span><strong>再添一个喜欢的</strong><span>添加你常去的网站</span></button></div>
    <div className="gentle-tip"><span className="tip-icon"><EyeOff size={19}/></span><div><strong>{autoHide ? '安心切换，自在停留' : '你的片刻闲暇，由你掌握'}</strong><p>{autoHide ? '鼠标移开时自动隐藏并静音，回到原位置稍作停留，即可继续。' : '可在设置中开启鼠标移出自动隐藏，也能随时按 Ctrl+Alt 隐藏或恢复。'}</p></div><ShieldCheck size={22} className="tip-end"/></div>
    <footer className="page-footer">在这里，时间可以属于自己。<span>QIXU / MAKE ROOM FOR JOY</span></footer>
  </main>;
}

function LibraryPage({ books, sources, busy, onImport, onOpen, onDelete, onSource }: { books: Book[]; sources: Source[]; busy: boolean; onImport: () => void; onOpen: (id: string) => void; onDelete: (book: Book) => void; onSource: (source: Source) => void }) {
  const [filter, setFilter] = useState('all'); const [query, setQuery] = useState('');
  const filtered = books.filter(book => (filter === 'all' || book.type === filter) && book.title.toLowerCase().includes(query.toLowerCase()));
  const recent = [...books].filter(book => !!book.progress).sort((a, b) => b.addedAt - a.addedAt)[0];
  return <main className="page library-page"><div className="page-title-row"><div><span className="eyebrow">YOUR PRIVATE LIBRARY</span><h1>把故事，装进口袋。</h1><p>每一次翻页，都是一次小小的出走。</p></div><button className="button primary" onClick={onImport} disabled={busy}><FolderPlus size={17}/>{busy ? '正在导入…' : '导入书籍'}</button></div>
    {recent && <button className="continue-card" onClick={() => onOpen(recent.id)}><div className="continue-art"><BookOpen size={29}/></div><div><span>继续上一次的故事</span><strong>{recent.title}</strong><div className="continue-progress"><i style={{ width: `${Math.round((recent.progress?.percent || 0) * 100)}%` }}/></div></div><span className="continue-percent">已读 {Math.round((recent.progress?.percent || 0) * 100)}%</span><ArrowRight size={20}/></button>}
    <div className="library-tools"><div className="segmented">{[['all', '全部'], ['txt', 'TXT'], ['epub', 'EPUB']].map(([value, label]) => <button key={value} className={filter === value ? 'selected' : ''} onClick={() => setFilter(value)}>{label}{value === 'all' && <span>{books.length}</span>}</button>)}</div><label className="search-input"><Search size={15}/><input placeholder="搜索书架" aria-label="搜索书架" value={query} onChange={event => setQuery(event.target.value)}/></label></div>
    {filtered.length ? <div className="books-grid">{filtered.map((book, index) => <article className={`book-card book-color-${index % 5}`} key={book.id}><button className="book-open" onClick={() => onOpen(book.id)}><div className="book-cover"><span className="book-format">{book.type.toUpperCase()}</span><div className="book-cover-line"/><h3>{book.title}</h3><BookOpen size={24} strokeWidth={1.2}/><span className="cover-bottom">A STORY TO GET LOST IN</span></div><strong>{book.title}</strong><span>{book.progress ? `已读 ${Math.round(book.progress.percent * 100)}%` : '尚未开始'}<i/> {sizeLabel(book.size)}</span></button><IconButton className="book-delete" label={`移除 ${book.title}`} onClick={() => onDelete(book)}><Trash2 size={14}/></IconButton></article>)}</div> : <div className="empty-library"><span className="empty-books"><BookOpen size={43} strokeWidth={1.25}/></span><h2>{query || filter !== 'all' ? '还没有找到这本书' : '你的下一段故事，从这里开始。'}</h2><p>{query || filter !== 'all' ? '试试其他关键词，或导入新的书籍。' : '将 TXT、EPUB 拖到这里，或点击按钮导入。'}</p>{!query && filter === 'all' && <button className="button secondary" onClick={onImport} disabled={busy}><Plus size={16}/>{busy ? '正在导入…' : '选择本地书籍'}</button>}<span className="local-note">本地阅读 · 自动记住进度 · 支持自动滚动</span></div>}
    <div className="online-reading"><div><h2>去别处，发现好故事</h2><p>在线阅读，保留熟悉的体验。</p></div><div className="online-sources">{sources.filter(source => source.kind === 'novel').map(source => <button key={source.id} onClick={() => onSource(source)}><SourceIcon source={source}/><span>{source.title}</span><ExternalLink size={13}/></button>)}</div></div>
  </main>;
}

function SettingsPage({ state, update, run, onAdd }: { state: AppState; update: (patch: Partial<Settings>) => Promise<void>; run: (task: Promise<unknown>) => Promise<void>; onAdd: () => void }) {
  const settings = state.settings;
  function moveSource(index: number, direction: number) { const next = [...state.sources]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; void run(api.saveSources(next)); }
  return <main className="page settings-page"><div className="page-title-row"><div><span className="eyebrow">MAKE IT YOURS</span><h1>舒服，因你而定。</h1><p>把每一个细节，调成喜欢的样子。</p></div><div className="settings-symbol"><Settings2 size={28} strokeWidth={1.4}/></div></div>
    <h2 className="settings-section-title">外观与窗口</h2><div className="settings-card"><Row title="外观" description="为你的空间选择一种气氛"><div className="segmented compact">{[['system', '跟随系统'], ['light', '浅色'], ['dark', '深色']].map(([value, label]) => <button key={value} className={settings.theme === value ? 'selected' : ''} onClick={() => void update({ theme: value as Settings['theme'] })}>{label}</button>)}</div></Row><Row title="窗口不透明度" description="视频、文字与工具栏一起变得轻盈"><div className="range-control"><input aria-label="窗口不透明度设置" type="range" min="20" max="100" value={Math.round(settings.opacity * 100)} onChange={event => void update({ opacity: Number(event.target.value) / 100 })}/><span>{Math.round(settings.opacity * 100)}%</span></div></Row><Row title="窗口置顶" description="开启后始终置顶；关闭后点击其他软件会自动隐藏并暂停静音"><Toggle label="窗口置顶" checked={settings.alwaysOnTop} onChange={value => void update({ alwaysOnTop: value })}/></Row></div>
    {state.bossKey.shortcutConfigured&&<><h2 className="settings-section-title">老板键</h2><div className="settings-card"><BossKey state={state}/></div></>}
    <h2 className="settings-section-title">暂离方式</h2><div className="settings-card"><Row title="轻盈暂离" description="鼠标移出后暂停并静音，移回原位置恢复"><Toggle label="鼠标移出自动隐藏" checked={settings.autoHide} onChange={value=>void update({autoHide:value})}/></Row></div>
    <h2 className="settings-section-title">启动方式</h2><div className="settings-card"><Row title="开机自动启动" description="启动后安静地待在托盘，不弹窗、不播放"><Toggle label="开机自动启动" checked={settings.launchAtLogin} onChange={value=>void update({launchAtLogin:value})}/></Row></div>
    <h2 className="settings-section-title">播放体验</h2><div className="settings-card"><Row title="YouTube 自动跳过广告" description="出现可用的跳过按钮时自动点击；不可跳过的广告正常播放"><Toggle label="YouTube 自动跳过广告" checked={settings.autoSkipYouTubeAds} onChange={value=>void update({autoSkipYouTubeAds:value})}/></Row></div><h2 className="settings-section-title">语言与字幕</h2><div className="settings-card"><Row title="自动翻译外文网页" description="译文显示在原文下方；恢复原文会记住当前网站"><Toggle label="自动翻译外文网页" checked={settings.autoTranslate} onChange={value=>void update({autoTranslate:value})}/></Row><Row title="自动开启中英双语字幕" description="使用网站已有字幕，包括自动生成字幕；支持播放器全屏"><Toggle label="自动开启中英双语字幕" checked={settings.bilingualSubtitles} onChange={value=>void update({bilingualSubtitles:value})}/></Row><Row title="免费本地翻译" description={state.translation.model==='loading'?'模型加载中':state.translation.model==='ready'?'模型已就绪 · 文本仅在本机处理':'随安装包提供语言模型，无需 API 密钥'}><span className="subtle-badge">离线运行</span></Row>{settings.translationDisabledSites.length>0&&<Row title="不自动翻译的网站"><div className="translation-exceptions">{settings.translationDisabledSites.map(site=><button key={site} title="点击恢复自动翻译" onClick={()=>void update({translationDisabledSites:settings.translationDisabledSites.filter(s=>s!==site)})}>{site} ×</button>)}</div></Row>}</div>
    <h2 className="settings-section-title">阅读偏好</h2><div className="settings-card"><Row title="阅读主题"><div className="reader-theme-picker">{[['light', '白昼'], ['sepia', '暖纸'], ['dark', '夜读']].map(([value, label]) => <button key={value} className={`${value} ${settings.readerTheme === value ? 'selected' : ''}`} onClick={() => void update({ readerTheme: value as Settings['readerTheme'] })}>{label}</button>)}</div></Row><Row title="文字大小"><div className="range-control"><input aria-label="文字大小" type="range" min="14" max="36" value={settings.fontSize} onChange={event => void update({ fontSize: Number(event.target.value) })}/><span>{settings.fontSize}px</span></div></Row><Row title="行间距"><div className="range-control"><input aria-label="行间距" type="range" min="1.4" max="2.6" step="0.1" value={settings.lineHeight} onChange={event => void update({ lineHeight: Number(event.target.value) })}/><span>{settings.lineHeight.toFixed(1)}</span></div></Row><Row title="阅读宽度"><div className="range-control"><input aria-label="阅读宽度" type="range" min="360" max="1000" step="20" value={settings.readerWidth} onChange={event => void update({ readerWidth: Number(event.target.value) })}/><span>{settings.readerWidth}px</span></div></Row><Row title="自动滚动速度" description="阅读时可随时暂停、继续"><div className="range-control"><input aria-label="自动滚动速度" type="range" min="5" max="100" value={settings.scrollSpeed} onChange={event => void update({ scrollSpeed: Number(event.target.value) })}/><span>{settings.scrollSpeed} px/s</span></div></Row></div>
    <div className="settings-source-heading"><h2 className="settings-section-title">我的内容来源</h2><button className="text-button" onClick={onAdd}><Plus size={14}/>添加网站</button></div><div className="settings-card source-settings">{state.sources.map((source, index) => <div className="managed-source" key={source.id}><SourceIcon source={source}/><div><strong>{source.title}<span>{source.kind === 'novel' ? '小说' : '视频'}</span></strong><p>{source.url}</p></div><div className="source-actions"><IconButton label={`上移 ${source.title}`} disabled={!index} onClick={() => moveSource(index, -1)}><ArrowUp size={14}/></IconButton><IconButton label={`下移 ${source.title}`} disabled={index === state.sources.length - 1} onClick={() => moveSource(index, 1)}><ArrowDown size={14}/></IconButton><IconButton label={`删除来源 ${source.title}`} disabled={source.id==='aikan'} onClick={() => void run(api.saveSources(state.sources.filter(item => item.id !== source.id)))}><Trash2 size={14}/></IconButton></div></div>)}</div>
    <div className="about-app"><Mark small/><div><strong>栖序 <span>1.8.0</span></strong><p>安静地，留一点时间给自己。</p></div><span>MADE FOR YOUR LITTLE BREAKS</span></div>
  </main>;
}

function Modal({ title, description, onClose, children }: { title: string; description?: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; const first = document.querySelector<HTMLElement>('.modal-card input, .modal-card button'); first?.focus(); return () => previous?.focus(); }, []);
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><section role="dialog" aria-modal="true" aria-label={title} className="modal-card"><div className="modal-heading"><h2>{title}</h2><IconButton label="关闭" onClick={onClose}><X size={19}/></IconButton></div>{description && <p className="modal-description">{description}</p>}{children}</section></div>;
}
function SourceEditor({ onClose, onSave }: { onClose: () => void; onSave: (source: Source) => Promise<void> }) {
  const [title, setTitle] = useState(''); const [url, setUrl] = useState(''); const [kind, setKind] = useState<'video' | 'novel'>('video'); const [error, setError] = useState(''); const [saving, setSaving] = useState(false);
  return <Modal title="添加一个喜欢的网站" description="使用网站的公开网址，随时回到熟悉的内容。" onClose={onClose}><form className="source-form" onSubmit={async event => { event.preventDefault(); setError(''); try { const parsed = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`); if (!['https:', 'http:'].includes(parsed.protocol) || !parsed.hostname.includes('.')) throw new Error('请输入有效的 http 或 https 网址'); if (!title.trim()) throw new Error('请给网站起个名字'); setSaving(true); await onSave({ id: `custom-${crypto.randomUUID()}`, title: title.trim().slice(0, 30), url: parsed.href, kind, color: '#6c6ce8', abbr: title.trim().slice(0, 1) }); } catch (err) { setError(err instanceof Error ? err.message : String(err)); } finally { setSaving(false); } }}><label>网站名称<input placeholder="例如：我的视频收藏" value={title} onChange={event => setTitle(event.target.value)} maxLength={30}/></label><label>网站地址<input placeholder="https://example.com" value={url} onChange={event => setUrl(event.target.value)} spellCheck={false}/></label><label>内容类型<div className="segmented"><button type="button" className={kind === 'video' ? 'selected' : ''} onClick={() => setKind('video')}>视频</button><button type="button" className={kind === 'novel' ? 'selected' : ''} onClick={() => setKind('novel')}>在线小说</button></div></label>{error && <div className="form-error">{error}</div>}<div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>取消</button><button className="button primary" disabled={saving}>{saving ? '添加中…' : '添加网站'}</button></div></form></Modal>;
}
