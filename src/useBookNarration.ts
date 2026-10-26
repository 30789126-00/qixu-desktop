import { useCallback, useEffect, useRef, useState } from 'react';
import type { Book, BookProgress, NarrationState } from '../shared/types';
import type { TextIndex } from './readerText';
import { speechElements, splitSpeechText, type SpokenParagraph } from './readerNarration';

interface Options {
 book:Book; state:NarrationState; text:TextIndex|null; progress:()=>BookProgress|null;
 epub:()=>any; location:()=>any; move:(position:string)=>Promise<void>; pauseScroll:()=>void;
}
interface Session { runId:string; bookId:string; paragraph:number; section:number; chunk:number; serial:number; entries:SpokenParagraph[]; startCfi:string|null; }
export function useBookNarration(options:Options){
 const latest=useRef(options);latest.current=options;
 const session=useRef<Session|null>(null),advancing=useRef<number|null>(null),handled=useRef(''),generation=useRef(0);
 const [preparing,setPreparing]=useState(false),[message,setMessage]=useState('');
 const advance=useCallback(async()=>{
  const s=session.current,epoch=generation.current;if(!s||advancing.current===epoch)return;advancing.current=epoch;setPreparing(true);
  try{
   const current=latest.current;
   while(session.current===s&&generation.current===epoch){
    if(!s.entries.length||s.paragraph>=s.entries.length){
     if(current.book.type==='txt'){
      if(!current.text||s.section>=current.text.paragraphs.length)break;
      const index=s.section++;s.entries=[{text:current.text.paragraphs[index].text,position:`txt:${index}:0`}];s.paragraph=0;
     }else{
      const epub=current.epub();if(!epub||s.section>=epub.spine.spineItems.length)break;
      const section=epub.spine.spineItems[s.section++];await section.load(epub.load.bind(epub));
      if(session.current!==s||generation.current!==epoch)return;
      const elements=speechElements(section.document);s.entries=elements.map(el=>({text:el.textContent||'',position:section.cfiFromElement(el)}));s.paragraph=0;
      if(s.startCfi){try{const range=await epub.getRange(s.startCfi);const index=elements.findIndex(el=>el.contains(range.startContainer));if(index>=0)s.paragraph=index;}catch{}s.startCfi=null;}
      if(!s.entries.length)continue;
     }
    }
    const entry=s.entries[s.paragraph],chunks=splitSpeechText(entry.text);
    if(s.chunk>=chunks.length){s.paragraph++;s.chunk=0;continue;}
    if(s.chunk===0)await current.move(entry.position);
    if(session.current!==s||generation.current!==epoch)return;
    const text=chunks[s.chunk++],segmentId=String(++s.serial);
    await window.moyu.speakBook({bookId:s.bookId,runId:s.runId,segmentId,text});
    return;
   }
   if(session.current===s){session.current=null;await window.moyu.narrationAction('stop',s.runId);setMessage('已朗读到书末。');}
  }catch(error){if(session.current===s){session.current=null;await window.moyu.narrationAction('stop',s.runId).catch(()=>{});setMessage(error instanceof Error?error.message:String(error));}}
  finally{if(advancing.current===epoch)advancing.current=null;if(generation.current===epoch)setPreparing(false);}
 },[]);
 const stop=useCallback(()=>{
  const s=session.current;session.current=null;generation.current++;handled.current='';setPreparing(false);
  if(s)void window.moyu.narrationAction('stop',s.runId).catch(()=>{});
 },[]);
 const start=useCallback(()=>{
  stop();const current=latest.current,p=current.progress();const section=current.book.type==='txt'?Math.max(0,Number(p?.position.split(':')[1])||0):(current.location()?.start?.index??current.epub()?.spine.get(p?.position)?.index??0);
  session.current={runId:crypto.randomUUID(),bookId:current.book.id,section,paragraph:0,chunk:0,serial:0,entries:[],startCfi:current.book.type==='epub'?p?.position||null:null};
  setMessage('');current.pauseScroll();void advance();
 },[advance,stop]);
 const pause=useCallback(()=>{const s=session.current;if(s)void window.moyu.narrationAction('pause',s.runId).catch(()=>{});},[]);
 const toggle=useCallback(()=>{
  const current=latest.current,s=session.current;
  if(s&&['preparing','speaking'].includes(current.state.status))pause();
  else if(s&&current.state.status==='paused')void window.moyu.narrationAction('resume',s.runId);
  else start();
 },[pause,start]);
 useEffect(()=>{
  const s=session.current;if(!s||options.state.runId!==s.runId||options.state.status!=='finished')return;
  const key=s.runId+':'+options.state.segmentId;if(handled.current===key)return;handled.current=key;void advance();
 },[options.state.status,options.state.runId,options.state.segmentId,advance]);
 useEffect(()=>()=>stop(),[options.book.id,stop]);
 const active=options.state.bookId===options.book.id;
 return {toggle,stop,pause,preparing,message,dismiss:()=>setMessage(''),status:active?options.state.status:'idle',error:active?options.state.error:'',active};
}
