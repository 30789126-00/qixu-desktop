import { useCallback, useEffect, useRef, useState } from 'react';
import type { Book, BookProgress, NarrationState } from '../shared/types';
import type { TextIndex } from './readerText';
import type {EpubResources} from './epubResources';
import {NarrationCursor,type SpokenSentence} from './narrationCursor';
interface Options {book:Book;state:NarrationState;text:TextIndex|null;progress:()=>BookProgress|null;epub:()=>any;location:()=>any;resources:()=>EpubResources|null;chapter:(index:number)=>number;stopAtChapter:boolean;move:(position:string)=>Promise<void>;pauseScroll:()=>void;}
interface Session {runId:string;cursor:NarrationCursor;history:SpokenSentence[];index:number;next:Promise<SpokenSentence|null>|null;serial:number;chapter:number|null;paused:boolean;}
export function useBookNarration(options:Options){
 const latest=useRef(options);latest.current=options;const session=useRef<Session|null>(null),generation=useRef(0),handled=useRef(''),seenRun=useRef('');
 const [preparing,setPreparing]=useState(false),[message,setMessage]=useState(''),[currentSentence,setSentence]=useState<SpokenSentence|null>(null),[localPaused,setLocalPaused]=useState(false);
 const stop=useCallback(()=>{const s=session.current;session.current=null;generation.current++;handled.current='';setPreparing(false);setLocalPaused(false);s?.cursor.close();if(s)void window.moyu.narrationAction('stop',s.runId).catch(()=>{});},[]);
 const advance=useCallback(async(direction=1)=>{const s=session.current;if(!s)return;const token=++generation.current;setPreparing(true);
  try{let entry:SpokenSentence|null;
   if(direction<0){s.index=Math.max(0,s.index-1);entry=s.history[s.index]||null;}
   else if(direction===0&&s.index>=0)entry=s.history[s.index];
   else if(s.index+1<s.history.length)entry=s.history[++s.index];
   else{const next=s.next??=s.cursor.next();entry=await next;if(session.current!==s||token!==generation.current)return;s.next=null;
    if(entry){if(latest.current.stopAtChapter&&s.chapter!==null&&entry.chapter!==s.chapter){stop();setMessage('已在本章结束停止朗读。');return;}s.chapter??=entry.chapter;s.history.push(entry);if(s.history.length>64)s.history.shift();s.index=s.history.length-1;}
   }
   if(!entry){stop();setMessage('已朗读到书末。');return;}setSentence(entry);
   if(s.paused){setLocalPaused(true);return;}
   await latest.current.move(entry.position);if(session.current!==s||token!==generation.current||s.paused)return;
   await window.moyu.speakBook({bookId:latest.current.book.id,runId:s.runId,segmentId:String(++s.serial),text:entry.text});
   // Keep only one upcoming sentence ready, never an unbounded speech queue.
   s.next??=s.cursor.next();s.next.catch(()=>{});
  }catch(error){if(session.current===s){stop();setMessage(error instanceof Error?error.message:String(error));}}
  finally{if(token===generation.current)setPreparing(false);}
 },[stop]);
 const start=useCallback(()=>{stop();const o=latest.current,p=o.progress(),epub=o.epub();const section=o.book.type==='txt'?Math.max(0,Number(p?.position.split(':')[1])||0):(o.location()?.start?.index??epub?.spine.get(p?.position)?.index??0);
  session.current={runId:crypto.randomUUID(),cursor:new NarrationCursor({text:o.text,epub,resources:o.resources(),section,cfi:o.book.type==='epub'?p?.position||null:null,chapter:o.chapter}),history:[],index:-1,next:null,serial:0,chapter:null,paused:false};setSentence(null);setMessage('');o.pauseScroll();void advance();
 },[advance,stop]);
 const pause=useCallback(()=>{const s=session.current;if(!s)return;s.paused=true;setLocalPaused(true);void window.moyu.narrationAction('pause',s.runId).catch(()=>{});},[]);
 const toggle=useCallback(()=>{const s=session.current,o=latest.current;if(!s){start();return;}
  if(s.paused||o.state.status==='paused'){s.paused=false;setLocalPaused(false);if(o.state.status==='paused'&&o.state.segmentId===String(s.serial))void window.moyu.narrationAction('resume',s.runId);else void advance(0);}
  else if(['speaking','preparing'].includes(o.state.status)||preparing)pause();else start();
 },[advance,pause,preparing,start]);
 const seek=useCallback((direction:-1|1)=>{const s=session.current;if(!s)return;s.paused=false;setLocalPaused(false);void window.moyu.narrationAction('pause',s.runId);void advance(direction);},[advance]);
 useEffect(()=>{const s=session.current;if(!s||options.state.runId!==s.runId||options.state.status!=='finished'||s.paused)return;const key=s.runId+':'+options.state.segmentId;if(handled.current===key)return;handled.current=key;void advance();},[options.state.status,options.state.runId,options.state.segmentId,advance]);
 useEffect(()=>{if(session.current&&options.state.runId===session.current.runId)seenRun.current=options.state.runId;if(options.state.status==='idle'&&session.current&&seenRun.current===session.current.runId){const s=session.current;session.current=null;generation.current++;s.cursor.close();setPreparing(false);setLocalPaused(false);setMessage('朗读已停止。');}},[options.state.status,options.state.runId]);
 useEffect(()=>()=>stop(),[options.book.id,stop]);const active=options.state.bookId===options.book.id;
 return {toggle,stop,pause,seek,currentSentence,hasSession:!!session.current,preparing,message,dismiss:()=>setMessage(''),status:localPaused?'paused':active?options.state.status:'idle',error:active?options.state.error:'',active};
}
