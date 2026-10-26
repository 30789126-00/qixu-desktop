import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import ePub from 'epubjs';
import { ArrowLeft, Bookmark as BookmarkIcon, BookOpen, Check, ChevronLeft, ChevronRight, Headphones, List, Pause, Play, Search, Settings2, Square, Trash2, X } from 'lucide-react';
import type { Book, Bookmark, BookProgress, NarrationState, Settings, WindowState } from '../shared/types';
import type { TextIndex, TextMatch } from './readerText';
import { useBookNarration } from './useBookNarration';
import { EpubResources } from './epubResources';
import { EpubSearchIndex } from './epubSearch';
import {captureEpubAnchor,alignEpubAnchor,captureTextAnchor,alignTextAnchor,type ReadingAnchor,type TextReadingAnchor} from './readerAnchor';
import './reader.css';

interface ReaderProps {
  book: Book; settings: Settings; narration:NarrationState; windowState: WindowState; onClose: () => void;
  onSettingsChange: (patch: Partial<Settings>) => void | Promise<void>;
}
interface Chapter { label: string; position: string; depth?: number }
interface SearchHit { label: string; position: string }
type Panel = 'contents' | 'search' | 'bookmarks' | 'appearance' | 'narration' | null;
const palette = { light: { bg: '#fcfcfa', fg: '#30332f' }, sepia: { bg: '#f5eddd', fg: '#594c39' }, dark: { bg: '#20231f', fg: '#dadfd4' } };
const bounded = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);
const appearanceKey=(settings:Settings)=>[settings.fontSize,settings.lineHeight,settings.readerWidth,settings.readerTheme].join(':');

export default function Reader({ book, settings, narration, windowState, onClose, onSettingsChange }: ReaderProps) {
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
  const [indexProgress,setIndexProgress]=useState<{sections:number;total:number;cached:boolean}|null>(null);
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
  const interruptVoice=useRef<()=>void>(()=>{});
  const navigationSerial=useRef(0),navigationQueue=useRef(Promise.resolve()),navigationTarget=useRef<string|null>(null);
  const deferredSpeechPosition=useRef<string|null>(null);
  const resourcesRef=useRef<EpubResources|null>(null),indexRef=useRef<EpubSearchIndex|null>(null),anchorRef=useRef<ReadingAnchor|null>(null);
  const appliedAppearance=useRef(appearanceKey(settings));
  const resizingEpub=useRef(0);
  const resizeSnapshot=useRef<ReadingAnchor|null>(null),resizeSettling=useRef(false),readingIntent=useRef(0);
  const textAnchor=useRef<TextReadingAnchor|null>(null),textAligning=useRef(0);
  const textRestoring=useRef({serial:0,busy:false});
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

  const pauseManually = useCallback(() => { readingIntent.current++;autoResume.current = false; setRunning(false);interruptVoice.current(); }, []);
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
    const serial=++textRestoring.current.serial,intent=readingIntent.current;
    textRestoring.current.busy=true;
    suppressProgressUntil.current = performance.now() + 800;
    if(viewport.current)viewport.current.dataset.restoring='true';
    if (measure) virtualizerRef.current.measure();
    virtualizerRef.current.scrollToIndex(index, { align: 'start' });
    let frames=0,stable=0,previous=-1;
    const align=()=>{
      if(serial!==textRestoring.current.serial)return;
      const element=viewport.current;
      if(!element||intent!==readingIntent.current){textRestoring.current.busy=false;suppressProgressUntil.current=0;if(element)element.dataset.restoring='false';return;}
      const measured = virtualizerRef.current.getVirtualItems().find(item => item.index === index);
      if(measured){const desired=measured.start+measured.size*ratio;stable=Math.abs(previous-desired)<.5&&Math.abs(element.scrollTop-desired)<1?stable+1:0;previous=desired;virtualizerRef.current.scrollToOffset(desired);}
      else{stable=0;virtualizerRef.current.scrollToIndex(index,{align:'start'});}
      if(++frames<48&&(frames<6||stable<5))requestAnimationFrame(align);
      else{textRestoring.current.busy=false;element.dataset.restoring='false';textAnchor.current=captureTextAnchor(element)||textAnchor.current;suppressProgressUntil.current=performance.now()+80;}
    };requestAnimationFrame(align);
  }, []);
  const restoreTextAnchor=useCallback(()=>{
    const anchor=textAnchor.current;
    if(!anchor){restoreTextPosition(progressRef.current?.position||'txt:0:0',true);return;}
    const serial=++textAligning.current,intent=readingIntent.current;
    if(viewport.current)viewport.current.dataset.layoutAnchor=JSON.stringify(anchor);
    suppressProgressUntil.current=performance.now()+650;
    virtualizerRef.current.measure();virtualizerRef.current.scrollToIndex(anchor.index,{align:'start'});
    let frames=0;
    const align=()=>{if(serial!==textAligning.current)return;if(intent!==readingIntent.current){textAligning.current=0;return;}
      if(viewport.current)alignTextAnchor(viewport.current,anchor);
      if(++frames<24)requestAnimationFrame(align);
      else{textAligning.current=0;suppressProgressUntil.current=0;if(viewport.current)textAnchor.current=captureTextAnchor(viewport.current)||anchor;}
    };requestAnimationFrame(align);
  },[restoreTextPosition]);

  const moveReadingPosition = useCallback((position:string):Promise<void>=>{
    // Hidden windows may stop animation frames. Keep native speech moving and
    // apply its latest paragraph to the viewport only after the window returns.
    if(latest.current.windowState!=='visible'){
      deferredSpeechPosition.current=position;
      if(position.startsWith('txt:'))publishProgress(position,(Number(position.split(':')[1])||0)/Math.max(1,textRef.current?.paragraphs.length||1)*100);
      else{const epub=epubRef.current,section=epub?.spine.get(position);if(section)publishProgress(position,section.index/Math.max(1,epub.spine.spineItems.length)*100);}
      return Promise.resolve();
    }
    deferredSpeechPosition.current=null;
    if(position.startsWith('txt:')){restoreTextPosition(position);return Promise.resolve();}
    const serial=++navigationSerial.current;navigationTarget.current=position;
    if(epubHost.current)epubHost.current.dataset.navigationTarget=position;
    const task=navigationQueue.current.catch(()=>{}).then(async()=>{
      if(serial!==navigationSerial.current||!renditionRef.current)return;
      await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
      if(serial!==navigationSerial.current)return;
      const release=resourcesRef.current?.hold();try{await renditionRef.current.display(position);if(epubHost.current)epubHost.current.dataset.lastDisplay=position;}finally{release?.();}
      if(serial===navigationSerial.current)navigationTarget.current=null;
    });
    navigationQueue.current=task;return task;
  },[restoreTextPosition,publishProgress]);
  const voice=useBookNarration({book,state:narration,text,progress:()=>progressRef.current,epub:()=>epubRef.current,location:()=>locationRef.current,resources:()=>resourcesRef.current,stopAtChapter:settings.narrationStopAtChapter,chapter:index=>{let found=0;for(const chapter of chapters){const value=book.type==='txt'?Number(chapter.position.split(':')[1]):epubRef.current?.spine.get(chapter.position)?.index;if(Number.isFinite(value)&&value<=index)found=Math.max(found,value);}return found;},move:position=>{readingIntent.current++;resizeSnapshot.current=null;resizeSettling.current=false;return moveReadingPosition(position);},pauseScroll:()=>{autoResume.current=false;setRunning(false);}});
  interruptVoice.current=voice.pause;
  const goTo = useCallback((position: string) => {
    resizeSnapshot.current=null;resizeSettling.current=false;
    pauseManually();voice.stop();
    void moveReadingPosition(position).catch((failure:unknown)=>{navigationTarget.current=null;setNotice(`无法跳转：${errorMessage(failure)}`);});
  }, [pauseManually,moveReadingPosition,voice.stop]);
  const previousLoad=useRef<Promise<unknown>|null>(null);
  const preparePrevious=useCallback(()=>{
    const manager=renditionRef.current?.manager,container=manager?.container;
    if(!manager||!container||container.scrollTop>160||navigationTarget.current)return Promise.resolve();
    if(previousLoad.current)return previousLoad.current;
    const task=manager.q.enqueue(()=>manager.check(undefined,200)).finally(()=>{if(previousLoad.current===task)previousLoad.current=null;});
    previousLoad.current=task;return task as Promise<unknown>;
  },[]);

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
    let epubResize:ResizeObserver|undefined,resizeTimer:ReturnType<typeof setTimeout>|undefined;
    let anchorScroller:HTMLElement|null=null,anchorScroll:(()=>void)|undefined;
    let captureResize:(()=>void)|undefined,settleTimer:ReturnType<typeof setTimeout>|undefined;
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
          resourcesRef.current=new EpubResources(epubBook,()=>{const visible=renditionRef.current?.manager?.views?.all?.()||[];return visible.map((v:any)=>v.section.index).concat(locationRef.current?.start?.index??0);},stats=>{if(epubHost.current)epubHost.current.dataset.loadedDocuments=String(stats.loaded);});
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
          // Prepending on display can displace a separate chapter title page.
          // Load earlier sections only when the reader actually moves upward.
          rendition = epubBook.renderTo(epubHost.current, { width: '100%', height: '100%', manager: 'continuous', flow: 'scrolled-doc', spread: 'none', offset: 0, allowScriptedContent: false, allowPopups: false });
          renditionRef.current = rendition;
          rendition.on('resized',()=>{const release=resourcesRef.current?.hold();resizingEpub.current++;setTimeout(()=>{if(cancelled){resizingEpub.current=Math.max(0,resizingEpub.current-1);release?.();return;}void rendition.q.enqueue(()=>{}).finally(()=>{resizingEpub.current=Math.max(0,resizingEpub.current-1);release?.();});},0);});
          rendition.hooks.content.register((contents: any) => {
            contents.document.addEventListener('wheel', (event:WheelEvent)=>{
              pauseManually();if(event.deltaY>=0)return;
              const container=rendition.manager?.container,atTop=container?.scrollTop<=1;
              void preparePrevious().then(()=>{if(!cancelled&&atTop&&container)container.scrollTop+=event.deltaY;}).catch(()=>{});
            }, { passive: true });
            contents.document.addEventListener('touchstart', pauseManually, { passive: true });
            contents.document.addEventListener('keydown', (event: KeyboardEvent) => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) pauseManually();if(['ArrowUp','PageUp'].includes(event.key))void preparePrevious().catch(()=>{}); });
          });
          rendition.on('relocated', (location: any) => {
            if (cancelled || !location?.start?.cfi) return;
            if(latest.current.windowState!=='visible'&&deferredSpeechPosition.current)return;
            if((resizingEpub.current||resizeSettling.current)&&!navigationTarget.current)return;
            const target=navigationTarget.current;
            if(target){const wanted=epubBook.spine.get(target);if(wanted&&wanted.index!==location.start.index)return;}
            locationRef.current = location;
            if(epubHost.current)epubHost.current.dataset.lastLocation=location.start.cfi;
            const total = Math.max(1, epubBook.spine.length || epubBook.spine.spineItems.length);
            const sectionProgress = Math.max(0, (location.start.displayed?.page || 1) - 1) / Math.max(1, location.start.displayed?.total || 1);
            const progress = location.atEnd ? 100 : ((location.start.index + sectionProgress) / total) * 100;
            publishProgress(location.start.cfi, progress);
            if(epubHost.current&&!navigationTarget.current)anchorRef.current=captureEpubAnchor(epubHost.current,rendition,location.start.cfi);
            resourcesRef.current?.trim();
            if (location.atEnd) setRunning(false);
          });
          rendition.on('displayError', fail);
          applyEpubTheme();
          appliedAppearance.current=appearanceKey(latest.current.settings);
          try { await rendition.display(initialProgress?.position || undefined); }
          catch { await rendition.display(); if (!cancelled) setNotice('原来的阅读位置不可用，已返回书籍开头。'); }
          anchorScroller=epubHost.current?.querySelector<HTMLElement>('.epub-container')||null;
          anchorScroll=()=>{if(!cancelled&&!resizingEpub.current&&!resizeSettling.current&&!navigationTarget.current&&latest.current.windowState==='visible'&&epubHost.current&&progressRef.current)anchorRef.current=captureEpubAnchor(epubHost.current,rendition,progressRef.current.position);};
          anchorScroller?.addEventListener('scroll',anchorScroll,{passive:true});
          captureResize=()=>{if(!resizeSnapshot.current)resizeSnapshot.current=anchorRef.current;resizeSettling.current=true;};
          window.addEventListener('resize',captureResize,true);
          if(!cancelled&&epubHost.current){
            let width=Math.floor(epubHost.current.clientWidth),height=Math.floor(epubHost.current.clientHeight);
            epubResize=new ResizeObserver(()=>{
              clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{
                const host=epubHost.current;if(cancelled||!host)return;
                if(latest.current.windowState!=='visible')return;
                const w=Math.floor(host.clientWidth),h=Math.floor(host.clientHeight);
                if(w<100||h<100||(w===width&&h===height))return;width=w;height=h;
                const anchor=resizeSnapshot.current||anchorRef.current,intent=readingIntent.current;
                resizeSettling.current=true;
                host.dataset.lastResizeTarget=navigationTarget.current||anchor?.position||progressRef.current?.position||'';
                const explicit=navigationTarget.current;
                rendition.resize(w,h,navigationTarget.current||anchor?.position||progressRef.current?.position);
                const finish=()=>{clearTimeout(settleTimer);settleTimer=setTimeout(()=>{resizeSettling.current=false;resizeSnapshot.current=null;anchorScroll?.();},180);};
                if(anchor&&!explicit)void moveReadingPosition(anchor.position).then(()=>{if(!cancelled&&intent===readingIntent.current&&epubHost.current)alignEpubAnchor(epubHost.current,rendition,anchor);}).catch(()=>{}).finally(finish);else finish();
              },90);
            });epubResize.observe(epubHost.current);
          }
          if (!cancelled) { clearTimeout(timeoutId); setLoading(false); }
        }
      } catch (failure) { fail(failure); }
    };
    void initialize();
    return () => {
      cancelled = true; searchSerial.current++;navigationSerial.current++;navigationTarget.current=null;deferredSpeechPosition.current=null;previousLoad.current=null; clearTimeout(timeoutId);clearTimeout(resizeTimer);epubResize?.disconnect();
      void flushProgress(id);
      currentWorker?.terminate();
      if(anchorScroller&&anchorScroll)anchorScroller.removeEventListener('scroll',anchorScroll);
      if(captureResize)window.removeEventListener('resize',captureResize,true);clearTimeout(settleTimer);resizeSnapshot.current=null;resizeSettling.current=false;
      indexRef.current?.dispose();indexRef.current=null;resourcesRef.current?.dispose();resourcesRef.current=null;anchorRef.current=null;
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
    const key=appearanceKey(settings);if(appliedAppearance.current===key)return;appliedAppearance.current=key;
    if (book.type === 'txt') restoreTextAnchor();
    else {
      const anchor=epubHost.current&&!resizingEpub.current&&progressRef.current?captureEpubAnchor(epubHost.current,renditionRef.current,progressRef.current.position):anchorRef.current,cfi = anchor?.position||progressRef.current?.position;
      if(anchor)anchorRef.current=anchor;
      applyEpubTheme();
      const intent=readingIntent.current;
      if (cfi) requestAnimationFrame(() => {if(intent!==readingIntent.current)return;void moveReadingPosition(cfi).then(()=>{if(intent===readingIntent.current&&anchor&&epubHost.current&&renditionRef.current)requestAnimationFrame(()=>{if(intent===readingIntent.current)alignEpubAnchor(epubHost.current!,renditionRef.current,anchor);});}).catch(()=>{});});
    }
  }, [settings.fontSize, settings.lineHeight, settings.readerWidth, settings.readerTheme, loading, book.type, applyEpubTheme, restoreTextAnchor]);

  useEffect(() => {
    const element = viewport.current;
    if (!element || !text) return;
    let frame = 0;
    const update = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if(textAligning.current||textRestoring.current.busy)return;
        textAnchor.current=captureTextAnchor(element)||textAnchor.current;
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
      restoreTextAnchor();
    });
    resize.observe(element);
    return () => { element.removeEventListener('scroll', update); resize.disconnect(); cancelAnimationFrame(frame);textAnchor.current=null;textAligning.current++;textRestoring.current.serial++;textRestoring.current.busy=false; };
  }, [text, publishProgress, restoreTextAnchor]);

  useEffect(() => {
    const timer = setInterval(() => void flushProgress(), 1800);
    return () => clearInterval(timer);
  }, [flushProgress]);
  useEffect(()=>{const flush=(event:Event)=>{void flushProgress().finally(()=>{const done=(event as CustomEvent).detail;if(typeof done==='function')done();});};window.addEventListener('moyu:flush-progress',flush);return()=>window.removeEventListener('moyu:flush-progress',flush);},[flushProgress]);

  useEffect(() => {
    const previous = previousState.current;
    if (windowState !== 'visible') {
      if (previous === 'visible') autoResume.current = windowState === 'autoHidden' && runningRef.current;
      else if (windowState !== 'autoHidden') autoResume.current = false;
      setRunning(false); void flushProgress();
    } else if (previous === 'autoHidden' && autoResume.current) {
      autoResume.current = false; setRunning(true);
    }
    if(windowState==='visible'&&deferredSpeechPosition.current){const position=deferredSpeechPosition.current;if(epubHost.current&&renditionRef.current)renditionRef.current.resize(epubHost.current.clientWidth,epubHost.current.clientHeight,position);void moveReadingPosition(position).catch(()=>setNotice('朗读位置暂未显示，请通过目录重新定位。'));}
    previousState.current = windowState;
  }, [windowState, flushProgress,moveReadingPosition]);

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
    if(panel!=='search'){indexRef.current?.cancelSearch();setSearching(false);return;}
    if (!query.trim()) { setSearching(false); return; }
    setSearching(true);
    const timer = setTimeout(async () => {
      if (book.type === 'txt') workerRef.current?.postMessage({ type: 'search', query, id: serial });
      else {
        const currentBook = epubRef.current;
        if (!currentBook) { setSearching(false); return; }
        try {
          if(!resourcesRef.current)return;
          const index=indexRef.current??=new EpubSearchIndex(book.id,currentBook,resourcesRef.current,progress=>{if(mounted.current){setIndexProgress(progress);if(epubHost.current){epubHost.current.dataset.indexSections=String(progress.sections);epubHost.current.dataset.indexCached=String(progress.cached);}}});
          const results=await index.search(query.trim(),serial);
          if (searchSerial.current === serial) { setHits(results.matches); setSearchCount(results.count); setSearching(false); }
        } catch(failure) { if (searchSerial.current === serial) { setSearching(false);if(errorMessage(failure)!=='cancelled')setNotice('全文搜索失败：'+errorMessage(failure)); } }
      }
    }, 300);
    return () => {clearTimeout(timer);indexRef.current?.cancelSearch();};
  }, [query, book.type,panel]);

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
    pauseManually();voice.stop();
    if (book.type === 'epub') { const prepare=direction<0?preparePrevious():Promise.resolve();void prepare.then(()=>renditionRef.current?.[direction < 0 ? 'prev' : 'next']()).catch(() => {}); return; }
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
        <button disabled={loading||!!error} className={`reader-icon ${panel === 'contents' ? 'is-active' : ''}`} title="目录" onClick={() => togglePanel('contents')}><List size={18} /></button>
        <button disabled={loading||!!error} className={`reader-icon ${panel === 'search' ? 'is-active' : ''}`} title="搜索全文" onClick={() => togglePanel('search')}><Search size={17} /></button>
        <button disabled={loading||!!error} className={`reader-icon ${panel === 'bookmarks' ? 'is-active' : ''}`} title="我的书签" onClick={() => togglePanel('bookmarks')}><BookmarkIcon size={17} /></button>
        <button className={`reader-icon ${panel === 'appearance' ? 'is-active' : ''}`} title="阅读设置" onClick={() => togglePanel('appearance')}><Settings2 size={18} /></button>
        <button className={`reader-icon ${panel === 'narration' ? 'is-active' : ''}`} title="朗读设置" onClick={() => togglePanel('narration')}><Headphones size={18} /></button>
      </div>
    </header>
    <div className="reader-body">
      {panel && <aside className="reader-panel" aria-label="阅读工具">
        <div className="reader-panel-heading"><strong>{{ contents: '章节目录', search: '寻找一句话', bookmarks: '我的书签', appearance: '舒适地阅读',narration:'听一段故事' }[panel]}</strong><button className="reader-icon" title="关闭面板" onClick={() => setPanel(null)}><X size={16} /></button></div>
        {panel === 'contents' && <div className="reader-panel-list">{chapters.map((chapter, index) => <button key={`${chapter.position}-${index}`} className="reader-list-item" style={{ paddingLeft: 14 + (chapter.depth || 0) * 12 }} onClick={() => {setPanel(null);goTo(chapter.position);}}><span className="reader-list-number">{String(index + 1).padStart(2, '0')}</span><span>{chapter.label}</span></button>)}{!chapters.length && <p className="reader-empty">这本书没有章节目录。</p>}</div>}
        {panel === 'search' && <><label className="reader-search"><Search size={16} /><input autoFocus maxLength={128} placeholder="搜索书中的文字" value={query} onChange={event => setQuery(event.target.value)} /></label><p className="reader-panel-hint">{searching ? indexProgress && !indexProgress.cached ? '正在建立全文索引 '+indexProgress.sections+'/'+indexProgress.total+'…' : '正在寻找…' : query ? `找到 ${searchCount} 处${searchCount > 200 ? '，显示前 200 处' : ''}` : '输入关键词，继续那段故事。'}</p><div className="reader-panel-list">{hits.map((hit, index) => <button key={`${hit.position}-${index}`} className="reader-list-item reader-search-hit" onClick={() => goTo(hit.position)}>{hit.label}</button>)}</div></>}
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
        {panel === 'narration' && <div className="reader-appearance reader-narration">
          <p className="reader-panel-hint">从当前段落开始，使用本机语音朗读。文字不发送到网络。</p>
          <label className="reader-encoding"><span>朗读语音</span><select aria-label="朗读语音" value={settings.narrationVoice} onChange={event=>void onSettingsChange({narrationVoice:event.target.value})}><option value="">自动选择中文语音</option>{narration.voices.map(item=><option key={item.name} value={item.name}>{item.name.replace(/^Microsoft /,'')} · {item.language}</option>)}</select></label>
          <label><span>语速 <b>{settings.narrationRate===0?'标准':`${settings.narrationRate>0?'快':'慢'} ${Math.abs(settings.narrationRate)} 档`}</b></span><input aria-label="朗读语速" type="range" min="-5" max="5" step="1" value={settings.narrationRate} onChange={event=>void onSettingsChange({narrationRate:Number(event.target.value)})}/></label>
          <label className="reader-check"><input type="checkbox" checked={settings.narrationContinueHidden} onChange={event=>void onSettingsChange({narrationContinueHidden:event.target.checked})}/><span>隐藏后继续朗读</span></label>
          <label className="reader-encoding"><span>定时停止</span><select aria-label="听书定时停止" value={settings.narrationSleepMinutes} onChange={event=>void onSettingsChange({narrationSleepMinutes:Number(event.target.value)})}>{[0,5,10,15,30,45,60,90,120].map(n=><option key={n} value={n}>{n?`${n} 分钟后停止`:'不限时'}</option>)}</select></label>
          <label className="reader-check"><input type="checkbox" checked={settings.narrationStopAtChapter} onChange={event=>void onSettingsChange({narrationStopAtChapter:event.target.checked})}/><span>本章结束后停止</span></label>
          <p className="reader-panel-hint">定时按实际经过时间计算，隐藏时也有效；更改分钟数会从现在重新计时。回听保留最近 64 句。</p>
          <p className="reader-panel-hint">默认隐藏时暂停，恢复后继续。开启后，鼠标移出、快捷隐藏或最小化时仍可听书；返回待办、锁屏和退出会停止。</p>
          <div className="reader-speech-actions"><button disabled={loading||!!error||!narration.voices.length} onClick={voice.toggle}>{['preparing','speaking'].includes(voice.status)?'暂停朗读':voice.status==='paused'?'继续朗读':'开始朗读'}</button><button disabled={!voice.active&&!voice.preparing} onClick={voice.stop}><Square size={13}/>停止</button></div>
          <p className="reader-voice-status" role="status">{voice.preparing?'正在准备段落…':voice.error||voice.message||({idle:'准备好后，让文字读给你听。',preparing:'正在启动本机语音…',speaking:'正在朗读，阅读位置随段落前进。',paused:'朗读已暂停。',finished:'正在衔接下一段…',error:'语音暂不可用。'}[voice.status])}</p>
          {!narration.voices.length&&<p className="reader-panel-hint">未发现本机语音。可在 Windows 的语言与语音设置中安装中文语音后重启栖序。</p>}
          <p className="reader-panel-hint">语音与语速在下一段生效。跳转目录或切换书籍会停止当前朗读。</p>
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
    {(notice||voice.error||voice.message) && <div className="reader-notice" role="status"><span>{notice||voice.error||voice.message}</span><button className="reader-icon" title="关闭提示" onClick={() => {setNotice('');voice.dismiss();if(voice.error)voice.stop();}}><X size={14} /></button></div>}
    {voice.currentSentence&&voice.hasSession&&<div className="reader-current-sentence" role="status"><button title="朗读上一句" onClick={()=>voice.seek(-1)}><ChevronLeft size={15}/></button><span><b>{voice.currentSentence.text.slice(0,narration.character)}</b>{voice.currentSentence.text.slice(narration.character)}</span><button title="朗读下一句" onClick={()=>voice.seek(1)}><ChevronRight size={15}/></button>{!!narration.sleepUntil&&<small>定时至 {new Date(narration.sleepUntil).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</small>}</div>}
    <footer className="reader-footer">
      <button className="reader-icon" title="上一章 / 上一页" disabled={loading || !!error} onClick={() => jumpChapter(-1)}><ChevronLeft size={17} /></button>
      <div className="reader-progress"><div><i style={{ width: `${percent}%` }} /></div><span>{percent.toFixed(1)}% <span className="reader-progress-caption">· 给自己一点慢下来的时间</span></span></div>
      <button className={`reader-auto ${running ? 'is-running' : ''}`} title={running?'暂停滚动':'自动滚动'} disabled={loading || !!error} onClick={() => {voice.stop();autoResume.current = false; setRunning(value => !value); }}>{running ? <Pause size={14} /> : <Play size={14} />}<span>{running ? '暂停滚动' : '自动滚动'}</span></button>
      <button className={`reader-speak ${['preparing','speaking'].includes(voice.status)?'is-running':''}`} title={['preparing','speaking'].includes(voice.status)?'暂停朗读':voice.status==='paused'?'继续朗读':'开始朗读'} disabled={loading||!!error||!narration.voices.length||voice.preparing} onClick={voice.toggle}>{['preparing','speaking'].includes(voice.status)?<Pause size={14}/>:<Headphones size={15}/>}<span>{['preparing','speaking'].includes(voice.status)?'暂停朗读':voice.status==='paused'?'继续朗读':'语音朗读'}</span></button>
      <button className="reader-icon" title="下一章 / 下一页" disabled={loading || !!error} onClick={() => jumpChapter(1)}><ChevronRight size={17} /></button>
    </footer>
  </section>;
}
