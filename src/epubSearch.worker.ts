interface Row {text:string;position:string;limit?:number;}
const VERSION=2,MAX_BOOK_BYTES=48*1024*1024;
let epoch=0,bytes=0,rows:Row[]=[],complete=false,bookId='',hits=0;
const db=()=>new Promise<IDBDatabase>((resolve,reject)=>{
 const request=indexedDB.open('qixu-reader-index',VERSION);
 request.onupgradeneeded=()=>{const database=request.result;if(!database.objectStoreNames.contains('books'))database.createObjectStore('books',{keyPath:'id'});else request.transaction!.objectStore('books').clear();if(!database.objectStoreNames.contains('meta'))database.createObjectStore('meta',{keyPath:'id'});};
 request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
});
async function stored(id:string){try{const database=await db();return await new Promise<any>(resolve=>{const tx=database.transaction('books'),req=tx.objectStore('books').get(id);req.onsuccess=()=>resolve(req.result);req.onerror=()=>resolve(null);tx.oncomplete=()=>database.close();});}catch{return null;}}
async function persist(){try{const database=await db();await new Promise<void>((resolve,reject)=>{const tx=database.transaction(['books','meta'],'readwrite'),store=tx.objectStore('books'),meta=tx.objectStore('meta'),at=Date.now();store.put({id:bookId,version:VERSION,rows,bytes});meta.put({id:bookId,at,bytes});const all=meta.getAll();all.onsuccess=()=>{let total=0,index=0;for(const entry of all.result.sort((a:any,b:any)=>b.at-a.at)){total+=entry.bytes||0;if(total>96*1024*1024||index++>=20){store.delete(entry.id);meta.delete(entry.id);}}};tx.oncomplete=()=>{database.close();resolve();};tx.onerror=()=>{database.close();reject(tx.error);};});return true;}catch{return false;}}
self.onmessage=async(event:MessageEvent)=>{const m=event.data;
 if(m.type==='init'){const token=++epoch;bookId=m.bookId;rows=[];bytes=0;complete=false;const cached=await stored(bookId);if(token!==epoch)return;if(cached?.version===VERSION&&Array.isArray(cached.rows)&&cached.bytes<=MAX_BOOK_BYTES){rows=cached.rows;bytes=cached.bytes;complete=true;}postMessage({type:'ready',cached:complete,bytes});}
 if(m.type==='append'){const incoming=m.rows as Row[],size=incoming.reduce((n,r)=>n+r.text.length*2+r.position.length*2,0);if(bytes+size>MAX_BOOK_BYTES){postMessage({type:'error',error:'全文索引超过 48MB 限额，请使用目录定位或拆分超大书籍。'});return;}for(const row of incoming)rows.push(row);bytes+=size;postMessage({type:'indexed',section:m.section,bytes});}
 if(m.type==='finish'){complete=true;const persisted=await persist();postMessage({type:'complete',bytes,persisted});}
 if(m.type==='search'){const token=++hits,q=String(m.query).trim(),found:{label:string;position:string}[]=[];let count=0;if(q)for(let i=0;i<rows.length;i++){if(token!==hits)return;const row=rows[i];let at=-1;while((at=row.text.indexOf(q,at+1))>=0){if(at>=(row.limit??row.text.length))break;count++;if(found.length<200)found.push({label:row.text.slice(Math.max(0,at-32),at+q.length+48),position:row.position.replace(/:(\d+)\)$/,(_v,n)=>':'+(Number(n)+at)+')')});}if(i%500===0)await new Promise(r=>setTimeout(r,0));}if(token===hits)postMessage({type:'matches',id:m.id,matches:found,count,complete});}
 if(m.type==='cancel')hits++;
};
