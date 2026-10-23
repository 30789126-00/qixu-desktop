import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import ePub from 'epubjs';
import { ArrowLeft, Bookmark as BookmarkIcon, BookOpen, Check, ChevronLeft, ChevronRight, List, Pause, Play, Search, Settings2, Trash2, X } from 'lucide-react';
import type { Book, Bookmark, BookProgress, Settings, WindowState } from '../shared/types';
import type { TextIndex, TextMatch } from './readerText';
import './reader.css';

interface ReaderProps {
  book: Book; settings: Settings; windowState: WindowState; onClose: () => void;
  onSettingsChange: (patch: Partial<Settings>) => void | Promise<void>;
}
interface Chapter { label: string; position: string; depth?: number }
interface SearchHit { label: string; position: string }
type Panel = 'contents' | 'search' | 'bookmarks' | 'appearance' | null;
const palette = { light: { bg: '#fcfcfa', fg: '#30332f' }, sepia: { bg: '#f5eddd', fg: '#594c39' }, dark: { bg: '#20231f', fg: '#dadfd4' } };
const bounded = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

export default function Reader({ book, settings, windowState, onClose, onSettingsChange }: ReaderProps) {
  const [text, setText] = useState<TextIndex | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [panel, setPanel] = useState<Panel>(null);
  const [percent, setPercent] = useState((book.progress?.percent || 0) * 100);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(book.bookmarks);
  const [running, setRunning] = useState(false);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchCount, setSearchCount] = useState(0);
  const [encoding, setEncoding] = useState(book.encoding || 'auto');
  const [revision, setRevision] = useState(0);
  const viewport = useRef<HTMLDivElement>(null);
  const epubHost = useRef<HTMLDivElement>(null);
  const workerRef = useRef<Worker | null>(null);
  // epub.js exposes manager/section internals without complete public typings.
  const epubRef = useRef<any>(null);
  const renditionRef = useRef<any>(null);
  const locationRef = useRef<any>(null);
  const progressRef = useRef<BookProgress | null>(book.progress);
  const latest = useRef({ book, settings, windowState });
  latest.current = { book, settings, windowState };
  const runningRef = useRef(running);
  runningRef.current = running;
  const autoResume = useRef(false);
  const previousState = useRef(windowState);
  const searchSerial = useRef(0);
  const pendingPosition = useRef<string | null>(null);
  const lastBookId = useRef(book.id);
  const requestedEncoding = useRef(encoding);
  const mounted = useRef(true);
  const suppressProgressUntil = useRef(0);
  const savedProgress = useRef('');
  const textRef = useRef(text);
  textRef.current = text;

  const virtualizer = useVirtualizer({
    count: text?.paragraphs.length || 0,
    getScrollElement: () => viewport.current,
    estimateSize: index => {
      const paragraph = text?.paragraphs[index];
      const availableWidth = Math.min(settings.readerWidth, (viewport.current?.clientWidth || 700) - 64);
      const charactersPerLine = Math.max(12, availableWidth / settings.fontSize);
      return Math.ceil((paragraph?.text.length || 30) / charactersPerLine) * settings.fontSize * settings.lineHeight + (paragraph?.heading ? 48 : 22);
    },
    overscan: 6,
    paddingStart: 32,
    paddingEnd: 100,
  });
  const virtualizerRef = useRef(virtualizer);
  virtualizerRef.current = virtualizer;

  const pauseManually = useCallback(() => { autoResume.current = false; setRunning(false); }, []);
  const publishProgress = useCallback((position: string, progress: number) => {
    if (performance.now() < suppressProgressUntil.current) return;
    const next = bounded(Number.isFinite(progress) ? progress : 0, 0, 100);
    progressRef.current = { position, percent: next / 100 };
    setPercent(previous => Math.abs(previous - next) >= .05 ? next : previous);
  }, []);

  const flushProgress = useCallback(async (id = latest.current.book.id) => {
    const value = progressRef.current;
    if (!value) return;
    const serialized = `${id}:${value.position}:${Math.round(value.percent * 10000)}`;
    if (savedProgress.current === serialized) return;
    savedProgress.current = serialized;
    try { await window.moyu.saveBook(id, { progress: value }); }
    catch { savedProgress.current = ''; if (mounted.current) setNotice('阅读进度暂未保存，请稍后重试。'); }
  }, []);

  const restoreTextPosition = useCallback((position: string, measure = false) => {
    if (!textRef.current) { pendingPosition.current = position; return; }
    const [, indexText, ratioText] = position.split(':');
    const index = bounded(Number(indexText) || 0, 0, textRef.current.paragraphs.length - 1);
    const ratio = bounded(Number(ratioText) || 0, 0, 1);
    suppressProgressUntil.current = performance.now() + 160;
    if (measure) virtualizerRef.current.measure();
    virtualizerRef.current.scrollToIndex(index, { align: 'start' });
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const measured = virtualizerRef.current.getVirtualItems().find(item => item.index === index);
      if (measured && viewport.current) viewport.current.scrollTop = measured.start + measured.size * ratio;
    }));
  }, []);

  const goTo = useCallback((position: string) => {
    pauseManually();
    if (position.startsWith('txt:')) restoreTextPosition(position);
    else if (renditionRef.current) renditionRef.current.display(position).catch((failure: unknown) => setNotice(`无法跳转：${errorMessage(failure)}`));
  }, [pauseManually, restoreTextPosition]);

  const applyEpubTheme = useCallback(() => {
    const rendition = renditionRef.current;
    if (!rendition) return;
    const current = latest.current.settings;
    const colors = palette[current.readerTheme];
    rendition.themes.default({
      'html': { 'background': `${colors.bg} !important`, 'color': `${colors.fg} !important` },
      'body': { 'font-family': 'Georgia, "Noto Serif CJK SC", "Microsoft YaHei", serif !important', 'font-size': `${current.fontSize}px !important`, 'line-height': `${current.lineHeight} !important`, 'color': `${colors.fg} !important`, 'background': `${colors.bg} !important`, 'max-width': `${current.readerWidth}px !important`, 'margin': '0 auto !important', 'padding': '28px 26px 60px !important', 'box-sizing': 'border-box !important', 'overflow-wrap': 'anywhere !important' },
      'p': { 'line-height': `${current.lineHeight} !important`, 'margin-bottom': '1em !important' },
      'img': { 'max-width': '100% !important', 'height': 'auto !important' },
      'a': { 'color': '#719562 !important' },
    });
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let currentWorker: Worker | null = null;
    let epubBook: any = null;
    let rendition: any = null;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const id = book.id;
    if (lastBookId.current !== id) {
      lastBookId.current = id;
      requestedEncoding.current = book.encoding || 'auto';
      setEncoding(requestedEncoding.current);
      progressRef.current = book.progress;
    }
    const initialProgress = progressRef.current || book.progress;
    setLoading(true); setError(''); setNotice(''); setText(null); setChapters([]); setRunning(false);
    setHits([]); setQuery(''); setBookmarks(book.bookmarks); setPercent((initialProgress?.percent || 0) * 100);
    autoResume.current = false; searchSerial.current++; savedProgress.current = '';
    const fail = (failure: unknown) => { if (!cancelled) { setError(errorMessage(failure)); setLoading(false); } };
    const initialize = async () => {
      try {
        const content = await window.moyu.getBookContent(id);
        if (cancelled) return;
        const bytes = new Uint8Array(content);
        const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
        if (book.type === 'txt') {
          currentWorker = new Worker(new URL('./txt.worker.ts', import.meta.url), { type: 'module' });
          workerRef.current = currentWorker;
          currentWorker.onerror = () => fail(new Error('文本处理失败，请重新打开这本书。'));
          currentWorker.onmessage = event => {
            if (cancelled) return;
            const message = event.data;
            if (message.type === 'parsed') {
              const parsed: TextIndex = message;
              setText(parsed); setEncoding(parsed.encoding);
              setChapters(parsed.chapters.map(chapter => ({ label: chapter.label, position: `txt:${chapter.index}:0` })));
              pendingPosition.current = initialProgress?.position || 'txt:0:0';
              setLoading(false);
              void window.moyu.saveBook(id, { encoding: parsed.encoding }).catch(() => {});
            } else if (message.type === 'matches' && message.id === searchSerial.current) {
              setHits((message.matches as TextMatch[]).map(hit => ({ label: hit.label, position: hit.position })));
              setSearchCount(message.count); setSearching(false);
            } else if (message.type === 'error') fail(new Error(message.error));
          };
          currentWorker.postMessage({ type: 'parse', buffer, encoding: requestedEncoding.current }, [buffer]);
        } else {
          if (!epubHost.current) return;
          epubBook = ePub(buffer);
          epubRef.current = epubBook;
          // Strip executable elements before serialization, in addition to iframe sandboxing.
          epubBook.spine.hooks.content.register((document: Document) => {
            document.querySelectorAll('script,iframe,object,embed,base,form').forEach(node => node.remove());
            document.querySelectorAll('*').forEach(node => Array.from(node.attributes).forEach(attribute => {
              if (/^on/i.test(attribute.name) || /^(?:href|src|action)$/i.test(attribute.name) && /^\s*javascript:/i.test(attribute.value)) node.removeAttribute(attribute.name);
            }));
          });
          timeoutId = setTimeout(() => fail(new Error('这本 EPUB 读取时间过长，可能已损坏或包含缺失资源。')), 30000);
          await epubBook.ready;
          if (cancelled) return;
          const navigation = await epubBook.loaded.navigation;
          const flatten = (items: any[], depth = 0): Chapter[] => items.flatMap(item => [{ label: item.label.trim(), position: item.href, depth }, ...flatten(item.subitems || [], depth + 1)]);
          setChapters(flatten(navigation.toc));
          rendition = epubBook.renderTo(epubHost.current, { width: '100%', height: '100%', manager: 'continuous', flow: 'scrolled-doc', spread: 'none', allowScriptedContent: false, allowPopups: false });
          renditionRef.current = rendition;
          rendition.hooks.content.register((contents: any) => {
            contents.document.addEventListener('wheel', pauseManually, { passive: true });
            contents.document.addEventListener('touchstart', pauseManually, { passive: true });
            contents.document.addEventListener('keydown', (event: KeyboardEvent) => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) pauseManually(); });
          });
          rendition.on('relocated', (location: any) => {
            if (cancelled || !location?.start?.cfi) return;
            locationRef.current = location;
            const total = Math.max(1, epubBook.spine.length || epubBook.spine.spineItems.length);
            const sectionProgress = Math.max(0, (location.start.displayed?.page || 1) - 1) / Math.max(1, location.start.displayed?.total || 1);
            const progress = location.atEnd ? 100 : ((location.start.index + sectionProgress) / total) * 100;
            publishProgress(location.start.cfi, progress);
            if (location.atEnd) setRunning(false);
          });
          rendition.on('displayError', fail);
          applyEpubTheme();
          try { await rendition.display(initialProgress?.position || undefined); }
          catch { await rendition.display(); if (!cancelled) setNotice('原来的阅读位置不可用，已返回书籍开头。'); }
          if (!cancelled) { clearTimeout(timeoutId); setLoading(false); }
        }
      } catch (failure) { fail(failure); }
    };
    void initialize();
    return () => {
      cancelled = true; searchSerial.current++; clearTimeout(timeoutId);
      void flushProgress(id);
      currentWorker?.terminate();
      if (workerRef.current === currentWorker) workerRef.current = null;
      try { rendition?.destroy(); epubBook?.destroy(); } catch { /* A partially parsed EPUB may have no manager yet. */ }
      if (renditionRef.current === rendition) renditionRef.current = null;
      if (epubRef.current === epubBook) epubRef.current = null;
      locationRef.current = null;
    };
    // A library update contains fresh Book objects; reload only when identity or encoding changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id, revision]);

  useLayoutEffect(() => {
    if (!text || !pendingPosition.current) return;
    const target = pendingPosition.current;
    pendingPosition.current = null;
    restoreTextPosition(target, true);
  }, [text, restoreTextPosition]);

  useEffect(() => {
    if (loading) return;
    if (book.type === 'txt') restoreTextPosition(progressRef.current?.position || 'txt:0:0', true);
    else {
      const cfi = progressRef.current?.position;
      applyEpubTheme();
      if (cfi) requestAnimationFrame(() => renditionRef.current?.display(cfi).catch(() => {}));
    }
  }, [settings.fontSize, settings.lineHeight, settings.readerWidth, settings.readerTheme, loading, book.type, applyEpubTheme, restoreTextPosition]);

  useEffect(() => {
    const element = viewport.current;
    if (!element || !text) return;
    let frame = 0;
    const update = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const top = element.scrollTop;
        const items = virtualizerRef.current.getVirtualItems();
        const item = items.find(candidate => candidate.end > top) || items[0];
        if (!item) return;
        const fraction = bounded((top - item.start) / item.size, 0, 1);
        const end = element.scrollTop + element.clientHeight >= element.scrollHeight - 2;
        publishProgress(`txt:${item.index}:${fraction.toFixed(4)}`, end ? 100 : (item.index + fraction) / text.paragraphs.length * 100);
      });
    };
    element.addEventListener('scroll', update, { passive: true });
    let width = element.clientWidth;
    const resize = new ResizeObserver(() => {
      if (Math.abs(width - element.clientWidth) < 2) return;
      width = element.clientWidth;
      restoreTextPosition(progressRef.current?.position || 'txt:0:0', true);
    });
    resize.observe(element);
    return () => { element.removeEventListener('scroll', update); resize.disconnect(); cancelAnimationFrame(frame); };
  }, [text, publishProgress, restoreTextPosition]);

  useEffect(() => {
    const timer = setInterval(() => void flushProgress(), 1800);
    return () => clearInterval(timer);
  }, [flushProgress]);

  useEffect(() => {
    const previous = previousState.current;
    if (windowState !== 'visible') {
      if (previous === 'visible') autoResume.current = windowState === 'autoHidden' && runningRef.current;
      else if (windowState !== 'autoHidden') autoResume.current = false;
      setRunning(false); void flushProgress();
    } else if (previous === 'autoHidden' && autoResume.current) {
      autoResume.current = false; setRunning(true);
    }
    previousState.current = windowState;
  }, [windowState, flushProgress]);

  useEffect(() => {
    if (!running || loading || windowState !== 'visible') return;
    let frame = 0, previous = 0, remainder = 0, stuckSince = 0, changing = false;
    const tick = (now: number) => {
      const delta = previous ? Math.min(now - previous, 50) : 0;
      previous = now;
      const scroller = book.type === 'txt' ? viewport.current : epubHost.current?.querySelector<HTMLElement>('.epub-container');
      if (scroller && !changing) {
        remainder += delta * latest.current.settings.scrollSpeed / 1000;
        const advance = Math.floor(remainder);
        if (advance > 0) {
          const before = scroller.scrollTop;
          scroller.scrollTop += advance;
          remainder -= advance;
          if (scroller.scrollTop === before) {
            if (!stuckSince) stuckSince = now;
            if (now - stuckSince > 1000) {
              if (book.type === 'txt' || locationRef.current?.atEnd) { setRunning(false); return; }
              changing = true;
              renditionRef.current?.next().catch(() => setRunning(false)).finally(() => { changing = false; stuckSince = 0; previous = 0; });
            }
          } else stuckSince = 0;
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [running, loading, windowState, book.type]);

  useEffect(() => {
    const serial = ++searchSerial.current;
    setHits([]); setSearchCount(0);
    if (!query.trim()) { setSearching(false); return; }
    setSearching(true);
    const timer = setTimeout(async () => {
      if (book.type === 'txt') workerRef.current?.postMessage({ type: 'search', query, id: serial });
      else {
        const currentBook = epubRef.current;
        if (!currentBook) { setSearching(false); return; }
        const found: SearchHit[] = [];
        let count = 0;
        try {
          for (const section of currentBook.spine.spineItems) {
            if (searchSerial.current !== serial) return;
            const alreadyLoaded = !!section.document;
            await section.load(currentBook.load.bind(currentBook));
            const results = section.find(query.trim());
            count += results.length;
            for (const result of results) if (found.length < 200) found.push({ label: result.excerpt, position: result.cfi });
            if (!alreadyLoaded) section.unload();
            await new Promise(resolve => setTimeout(resolve, 0));
          }
          if (searchSerial.current === serial) { setHits(found); setSearchCount(count); setSearching(false); }
        } catch { if (searchSerial.current === serial) { setSearching(false); setNotice('部分章节无法搜索，请通过目录继续阅读。'); } }
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query, book.type]);

  const togglePanel = (next: Exclude<Panel, null>) => { pauseManually(); setPanel(current => current === next ? null : next); };
  const saveBookmarks = async (next: Bookmark[]) => {
    const before = bookmarks;
    setBookmarks(next);
    try { await window.moyu.saveBook(book.id, { bookmarks: next }); }
    catch { setBookmarks(before); setNotice('书签保存失败，请重试。'); }
  };
  const addBookmark = () => {
    const progress = progressRef.current || { position: book.type === 'txt' ? 'txt:0:0' : locationRef.current?.start?.cfi, percent: 0 };
    if (!progress.position) return;
    if (bookmarks.some(mark => mark.position === progress.position)) { setNotice('此处已经有书签。'); return; }
    const index = Number(progress.position.split(':')[1]) || 0;
    const label = book.type === 'txt' ? text?.paragraphs[index]?.text.slice(0, 48) : chapters.find(chapter => locationRef.current?.start?.href?.includes(chapter.position.split('#')[0]))?.label;
    void saveBookmarks([...bookmarks, { id: crypto.randomUUID(), label: label || `阅读到 ${(progress.percent * 100).toFixed(1)}%`, ...progress }]);
    setNotice('已收藏这一页。');
  };
  const updateAppearance = (patch: Partial<Settings>) => { pauseManually(); void onSettingsChange(patch); };
  const jumpChapter = (direction: -1 | 1) => {
    pauseManually();
    if (book.type === 'epub') { renditionRef.current?.[direction < 0 ? 'prev' : 'next']().catch(() => {}); return; }
    const index = Number(progressRef.current?.position.split(':')[1]) || 0;
    let current = 0;
    chapters.forEach((chapter, chapterIndex) => { if (Number(chapter.position.split(':')[1]) <= index) current = chapterIndex; });
    goTo(chapters[bounded(current + direction, 0, chapters.length - 1)]?.position || 'txt:0:0');
  };

  return <section className={`reader-shell reader-${settings.readerTheme}`} aria-label={`正在阅读 ${book.title}`}>
    <header className="reader-toolbar">
      <button className="reader-icon" title="返回书架" onClick={() => { pauseManually(); void flushProgress(); onClose(); }}><ArrowLeft size={18} /></button>
      <div className="reader-title"><span>{book.title}</span><small>{book.type.toUpperCase()} · {loading ? '正在准备' : `${percent.toFixed(1)}%`}</small></div>
      <div className="reader-tools">
        <button className={`reader-icon ${panel === 'contents' ? 'is-active' : ''}`} title="目录" onClick={() => togglePanel('contents')}><List size={18} /></button>
        <button className={`reader-icon ${panel === 'search' ? 'is-active' : ''}`} title="搜索全文" onClick={() => togglePanel('search')}><Search size={17} /></button>
        <button className={`reader-icon ${panel === 'bookmarks' ? 'is-active' : ''}`} title="我的书签" onClick={() => togglePanel('bookmarks')}><BookmarkIcon size={17} /></button>
        <button className={`reader-icon ${panel === 'appearance' ? 'is-active' : ''}`} title="阅读设置" onClick={() => togglePanel('appearance')}><Settings2 size={18} /></button>
      </div>
    </header>
    <div className="reader-body">
      {panel && <aside className="reader-panel" aria-label="阅读工具">
        <div className="reader-panel-heading"><strong>{{ contents: '章节目录', search: '寻找一句话', bookmarks: '我的书签', appearance: '舒适地阅读' }[panel]}</strong><button className="reader-icon" title="关闭面板" onClick={() => setPanel(null)}><X size={16} /></button></div>
        {panel === 'contents' && <div className="reader-panel-list">{chapters.map((chapter, index) => <button key={`${chapter.position}-${index}`} className="reader-list-item" style={{ paddingLeft: 14 + (chapter.depth || 0) * 12 }} onClick={() => goTo(chapter.position)}><span className="reader-list-number">{String(index + 1).padStart(2, '0')}</span><span>{chapter.label}</span></button>)}{!chapters.length && <p className="reader-empty">这本书没有章节目录。</p>}</div>}
        {panel === 'search' && <><label className="reader-search"><Search size={16} /><input autoFocus placeholder="搜索书中的文字" value={query} onChange={event => setQuery(event.target.value)} /></label><p className="reader-panel-hint">{searching ? '正在寻找…' : query ? `找到 ${searchCount} 处${searchCount > 200 ? '，显示前 200 处' : ''}` : '输入关键词，继续那段故事。'}</p><div className="reader-panel-list">{hits.map((hit, index) => <button key={`${hit.position}-${index}`} className="reader-list-item reader-search-hit" onClick={() => goTo(hit.position)}>{hit.label}</button>)}</div></>}
        {panel === 'bookmarks' && <><button className="reader-add-mark" onClick={addBookmark}><BookmarkIcon size={15} /> 收藏当前位置</button><div className="reader-panel-list">{bookmarks.map(mark => <div className="reader-bookmark" key={mark.id}><button onClick={() => goTo(mark.position)}><span>{mark.label}</span><small>{(mark.percent * 100).toFixed(1)}%</small></button><button className="reader-icon" title="删除书签" onClick={() => void saveBookmarks(bookmarks.filter(item => item.id !== mark.id))}><Trash2 size={14} /></button></div>)}{!bookmarks.length && <p className="reader-empty">喜欢的段落，留在这里。</p>}</div></>}
        {panel === 'appearance' && <div className="reader-appearance">
          <label><span>字号 <b>{settings.fontSize}px</b></span><input type="range" min="14" max="32" step="1" value={settings.fontSize} onChange={event => updateAppearance({ fontSize: Number(event.target.value) })} /></label>
          <label><span>行距 <b>{settings.lineHeight.toFixed(1)}</b></span><input type="range" min="1.4" max="2.6" step="0.1" value={settings.lineHeight} onChange={event => updateAppearance({ lineHeight: Number(event.target.value) })} /></label>
          <label><span>阅读宽度 <b>{settings.readerWidth}px</b></span><input type="range" min="360" max="1000" step="20" value={settings.readerWidth} onChange={event => updateAppearance({ readerWidth: Number(event.target.value) })} /></label>
          <div className="reader-theme-options">{(['light', 'sepia', 'dark'] as const).map(theme => <button key={theme} className={`reader-theme-${theme} ${settings.readerTheme === theme ? 'chosen' : ''}`} onClick={() => updateAppearance({ readerTheme: theme })}>{settings.readerTheme === theme && <Check size={13} />}{({ light: '明亮', sepia: '纸张', dark: '夜读' })[theme]}</button>)}</div>
          <label><span>滚动速度 <b>{settings.scrollSpeed}px/s</b></span><input type="range" min="5" max="100" step="1" value={settings.scrollSpeed} onChange={event => updateAppearance({ scrollSpeed: Number(event.target.value) })} /></label>
          {book.type === 'txt' && <label className="reader-encoding"><span>文字编码</span><select value={encoding} onChange={event => { pauseManually(); requestedEncoding.current = event.target.value; setEncoding(event.target.value); setRevision(value => value + 1); }}><option value="auto">自动识别</option><option value="utf-8">UTF-8</option><option value="utf-16le">UTF-16 LE</option><option value="utf-16be">UTF-16 BE</option><option value="gb18030">GB18030 / GBK</option></select></label>}
          <p className="reader-panel-hint">手动滚动或调整排版会暂停自动阅读。隐藏后暂停，回来接着读。</p>
        </div>}
      </aside>}
      <div className="reader-reading-area">
        {loading && <div className="reader-loading"><div className="reader-spinner" /><p>正在打开故事…</p><small>大文件会在后台处理，请稍候。</small></div>}
        {error && <div className="reader-error"><BookOpen size={36} /><strong>这本书暂时打不开</strong><p>{error}</p><div><button onClick={() => setRevision(value => value + 1)}>重新读取</button><button onClick={() => { setError(''); setPanel('appearance'); }}>检查编码设置</button></div></div>}
        {book.type === 'txt' ? <div className="reader-text-scroll" data-testid="reader-scroll" ref={viewport} tabIndex={0} aria-label="小说正文" onWheel={pauseManually} onTouchStart={pauseManually} onKeyDown={event => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) pauseManually(); }}>
          <div className="reader-text-page" style={{ height: virtualizer.getTotalSize(), maxWidth: settings.readerWidth, fontSize: settings.fontSize, lineHeight: settings.lineHeight }}>
            {virtualizer.getVirtualItems().map(item => { const paragraph = text?.paragraphs[item.index]; return <div key={item.key} data-index={item.index} ref={virtualizer.measureElement} className={`reader-paragraph ${paragraph?.heading ? 'reader-chapter-title' : ''}`} style={{ transform: `translateY(${item.start}px)` }}>{paragraph?.text}</div>; })}
          </div>
        </div> : <div ref={epubHost} className="reader-epub-host" aria-label="EPUB 小说正文" />}
      </div>
    </div>
    {notice && <div className="reader-notice" role="status"><span>{notice}</span><button className="reader-icon" title="关闭提示" onClick={() => setNotice('')}><X size={14} /></button></div>}
    <footer className="reader-footer">
      <button className="reader-icon" title="上一章 / 上一页" disabled={loading || !!error} onClick={() => jumpChapter(-1)}><ChevronLeft size={17} /></button>
      <div className="reader-progress"><div><i style={{ width: `${percent}%` }} /></div><span>{percent.toFixed(1)}% <span className="reader-progress-caption">· 给自己一点慢下来的时间</span></span></div>
      <button className={`reader-auto ${running ? 'is-running' : ''}`} disabled={loading || !!error} onClick={() => { autoResume.current = false; setRunning(value => !value); }}>{running ? <Pause size={14} /> : <Play size={14} />}<span>{running ? '暂停滚动' : '自动阅读'}</span></button>
      <button className="reader-icon" title="下一章 / 下一页" disabled={loading || !!error} onClick={() => jumpChapter(1)}><ChevronRight size={17} /></button>
    </footer>
  </section>;
}
