import type { EpubResources } from './epubResources';
export class EpubSearchIndex {
 private worker:Worker;private waiters=new Map<string,{resolve:(v:any)=>void;reject:(e:Error)=>void}>();private build:Promise<void>|null=null;private disposed=false;
 private ready:Promise<any>;
 private indexed=0;private paused=false;private complete=false;
 constructor(bookId:string,private epub:any,private resources:EpubResources,private progress:(value:{sections:number;total:number;cached:boolean})=>void=()=>{}){
  this.worker=new Worker(new URL('./epubSearch.worker.ts',import.meta.url),{type:'module'});
  this.worker.onmessage=e=>{const m=e.data;if(m.type==='error'){for(const w of this.waiters.values())w.reject(Error(m.error));this.waiters.clear();return;}const key=m.type==='matches'?'matches:'+m.id:m.type==='indexed'?'indexed:'+m.section:m.type;const w=this.waiters.get(key);if(w){this.waiters.delete(key);w.resolve(m);}};
  this.worker.onerror=()=>{for(const w of this.waiters.values())w.reject(Error('全文索引处理失败'));this.waiters.clear();};
  this.ready=this.wait('ready');this.worker.postMessage({type:'init',bookId});
 }
 private wait(key:string){return new Promise<any>((resolve,reject)=>{if(this.disposed){reject(Error('cancelled'));return;}this.waiters.set(key,{resolve,reject});});}
 private ensure(){if(this.complete){this.progress({sections:this.indexed,total:this.indexed,cached:true});return Promise.resolve();}if(this.build)return this.build;return this.build=(async()=>{const total=this.epub.spine.spineItems.length;if((await this.ready).cached){this.indexed=total;this.complete=true;this.progress({sections:total,total,cached:true});return;}
  for(const section of this.epub.spine.spineItems.slice(this.indexed)){if(this.disposed||this.paused)throw Error('cancelled');const lease=await this.resources.acquire(section.index);if(!lease)throw Error('cancelled');const rows:{text:string;position:string;limit:number}[]=[];
   try{const doc=lease.section.document,walker=doc.createTreeWalker(doc.body,NodeFilter.SHOW_TEXT);let node:Node|null;while((node=walker.nextNode())){if(!node.textContent?.trim()||node.parentElement?.closest('script,style,nav,[hidden]'))continue;const text=node.textContent;for(let offset=0;offset<text.length;){let limit=Math.min(8192,text.length-offset);if(offset+limit<text.length&&/[\uD800-\uDBFF]/.test(text[offset+limit-1]))limit--;const range=doc.createRange();range.setStart(node,offset);range.collapse(true);rows.push({text:text.slice(offset,offset+limit+127),position:section.cfiFromRange(range),limit});offset+=limit;}}}finally{lease.release();}
   if(this.disposed||this.paused)throw Error('cancelled');const done=this.wait('indexed:'+section.index);this.worker.postMessage({type:'append',section:section.index,rows});await done;this.indexed=section.index+1;this.progress({sections:this.indexed,total,cached:false});await new Promise(r=>setTimeout(r,0));
  }const done=this.wait('complete');this.worker.postMessage({type:'finish'});await done;this.complete=true;
 })().finally(()=>{this.build=null;});}
 async search(query:string,id:number){this.cancelSearch(false);this.paused=false;await this.ensure();if(this.disposed||this.paused)throw Error('cancelled');const result=this.wait('matches:'+id);this.worker.postMessage({type:'search',query,id});return result;}
 cancelSearch(pauseBuild=true){this.paused=pauseBuild;this.worker.postMessage({type:'cancel'});for(const [key,w] of this.waiters)if(key.startsWith('matches:')){w.reject(Error('cancelled'));this.waiters.delete(key);}}
 dispose(){this.disposed=true;for(const w of this.waiters.values())w.reject(Error('cancelled'));this.waiters.clear();this.worker.terminate();}
}
