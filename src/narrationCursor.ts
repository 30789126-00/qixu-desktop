import type {TextIndex} from './readerText';
import type {EpubResources} from './epubResources';
import {speechElements,splitSpeechText} from './readerNarration';
export interface SpokenSentence {text:string;position:string;chapter:number;}
export function sentenceParts(text:string){return text.replace(/\s+/g,' ').trim().split(/(?<=[。！？!?])|(?<=\.)\s+(?=[A-Z])/u).flatMap(value=>splitSpeechText(value));}
export class NarrationCursor {
 private entries:{text:string;position:string}[]=[];private paragraph=0;private parts:string[]=[];private part=0;private lease:{section:any;release:()=>void}|null=null;private closed=false;private cfi:string|null;
 constructor(private options:{text:TextIndex|null;epub:any;resources:EpubResources|null;section:number;cfi:string|null;chapter:(index:number)=>number}){this.cfi=options.cfi;}
 async next():Promise<SpokenSentence|null>{while(!this.closed){const o=this.options;
  if(this.paragraph>=this.entries.length){this.lease?.release();this.lease=null;
   if(o.text){if(o.section>=o.text.paragraphs.length)return null;const i=o.section++;this.entries=[{text:o.text.paragraphs[i].text,position:`txt:${i}:0`}];}
   else{if(!o.resources||o.section>=o.epub.spine.spineItems.length)return null;this.lease=await o.resources.acquire(o.section++);if(!this.lease||this.closed){this.lease?.release();this.lease=null;return null;}const section=this.lease.section,elements=speechElements(section.document);this.entries=elements.map(el=>({text:el.textContent||'',position:section.cfiFromElement(el)}));if(this.cfi){try{const range=await o.epub.getRange(this.cfi);const i=elements.findIndex(el=>el.contains(range.startContainer));if(i>0)this.entries=this.entries.slice(i);}catch{}this.cfi=null;}}
   this.paragraph=0;this.parts=[];this.part=0;if(!this.entries.length)continue;
  }
  const entry=this.entries[this.paragraph];if(!this.parts.length)this.parts=sentenceParts(entry.text);
  if(this.part>=this.parts.length){this.paragraph++;this.parts=[];this.part=0;continue;}
  return {text:this.parts[this.part++],position:entry.position,chapter:o.chapter(o.section-1)};
 }return null;}
 close(){this.closed=true;this.lease?.release();this.lease=null;this.entries=[];this.parts=[];}
}
