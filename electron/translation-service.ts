import { utilityProcess, type UtilityProcess } from 'electron';
import path from 'node:path';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {BoundedCache} from '../shared/bounded-cache';
import {saveDurableState,loadDurableState} from './state-store';
type Job={id:number;text:string;source:string;target:string;priority:number;resolve:(text:string)=>void;reject:(e:Error)=>void;key:string};
export class TranslationService {
 private child:UtilityProcess|null=null;private queue:Job[]=[];private current:Job|null=null;private id=0;private cache=new BoundedCache<string>(2500,2*1024*1024,s=>s.length*2,7*86400000);private revision='nllb-q8-v1';private ready:Promise<void>;private cacheTimer:ReturnType<typeof setTimeout>|undefined;private cacheWrites=Promise.resolve();
 constructor(private root:string,private onState:(model:'loading'|'ready'|'error',error?:string)=>void,private cacheFile?:string){try{this.revision=createHash('sha256').update(readFileSync(path.join(root,'manifest.json'))).digest('hex');}catch{}this.ready=this.loadCache();}
 private async loadCache(){if(!this.cacheFile)return;try{if((await fs.stat(this.cacheFile)).size>4*1024*1024)return;const {data}=await loadDurableState(this.cacheFile);if(data?.revision!==this.revision||!Array.isArray(data.entries))return;for(const e of data.entries)if(typeof e.key==='string'&&/^[a-f0-9]{64}$/.test(e.key)&&typeof e.value==='string'&&Number.isFinite(e.at)&&Date.now()-e.at<7*86400000)this.cache.set(e.key,e.value,e.at);}catch{}}
 private saveCache(){if(!this.cacheFile)return;clearTimeout(this.cacheTimer);this.cacheTimer=setTimeout(()=>{const data={revision:this.revision,entries:this.cache.entries()};this.cacheWrites=this.cacheWrites.then(()=>saveDurableState(this.cacheFile!,data)).catch(()=>{});},1000);this.cacheTimer.unref?.();}
 stats(){return {entries:this.cache.count,bytes:this.cache.bytes};}
 private cancelSerial=0;
 translate(text:string,source:string,target:string,priority=1):Promise<string>{const serial=this.cancelSerial;return this.cacheFile?this.ready.then(()=>{if(serial!==this.cancelSerial)throw Error('cancelled');return this.enqueue(text,source,target,priority);}):this.enqueue(text,source,target,priority);}
 private enqueue(text:string,source:string,target:string,priority:number):Promise<string>{
  if(source===target)return Promise.resolve(text);
  const key=createHash('sha256').update(this.revision+'|'+source+'|'+target+'|'+text).digest('hex'),cached=this.cache.get(key);if(cached!==undefined)return Promise.resolve(cached);
  if(this.queue.length>80)return Promise.reject(Error('翻译队列繁忙'));
  return new Promise((resolve,reject)=>{this.queue.push({id:++this.id,text,source,target,priority,resolve,reject,key});this.queue.sort((a,b)=>b.priority-a.priority||a.id-b.id);this.pump();});
 }
 private pump(){
  if(this.current||!this.queue.length)return;
  if(!this.child){
   const child=this.child=utilityProcess.fork(path.join(__dirname,'translation-worker.cjs'),[],{serviceName:'栖序 · 本地翻译',stdio:'pipe'});
   child.on('message',(message:any)=>{
    if(message.type==='state'){this.onState(message.model);return;}
    if(message.type!=='result'||message.id!==this.current?.id)return;
    const job=this.current!;this.current=null;
    if(message.error){job.reject(Error(message.error));if(message.error!=='cancelled')this.onState('error',message.error);}
    else if(typeof message.text==='string'){this.cache.set(job.key,message.text);this.saveCache();job.resolve(message.text);}else job.reject(Error('翻译返回值无效'));
    this.pump();
   });
   child.on('exit',()=>{if(this.child!==child)return;this.child=null;this.current?.reject(Error('翻译进程已退出'));this.current=null;for(const job of this.queue)job.reject(Error('翻译进程已退出'));this.queue=[];this.onState('error','翻译进程已退出，请重试');});
   child.stderr?.on('data',()=>{});
  }
  this.current=this.queue.shift()!;const {id,text,source,target}=this.current;this.child.postMessage({type:'translate',id,text,source,target,modelRoot:this.root});
 }
 cancel(){this.cancelSerial++;for(const job of this.queue)job.reject(Error('cancelled'));this.queue=[];if(this.current){this.current.reject(Error('cancelled'));this.child?.postMessage({type:'cancel',id:this.current.id});}}
 stop(){this.cancel();const child=this.child;this.child=null;this.current=null;child?.kill();}
}
