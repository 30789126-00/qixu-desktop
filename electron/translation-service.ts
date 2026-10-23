import { utilityProcess, type UtilityProcess } from 'electron';
import path from 'node:path';
import { createHash } from 'node:crypto';
type Job={id:number;text:string;source:string;target:string;priority:number;resolve:(text:string)=>void;reject:(e:Error)=>void;key:string};
export class TranslationService {
 private child:UtilityProcess|null=null;private queue:Job[]=[];private current:Job|null=null;private id=0;private cache=new Map<string,string>();
 constructor(private root:string,private onState:(model:'loading'|'ready'|'error',error?:string)=>void){}
 translate(text:string,source:string,target:string,priority=1):Promise<string>{
  if(source===target)return Promise.resolve(text);
  const key=createHash('sha256').update(source+'|'+target+'|'+text).digest('hex'),cached=this.cache.get(key);if(cached)return Promise.resolve(cached);
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
    else{this.cache.set(job.key,message.text);if(this.cache.size>2500)this.cache.delete(this.cache.keys().next().value!);job.resolve(message.text);}
    this.pump();
   });
   child.on('exit',()=>{if(this.child!==child)return;this.child=null;this.current?.reject(Error('翻译进程已退出'));this.current=null;for(const job of this.queue)job.reject(Error('翻译进程已退出'));this.queue=[];this.onState('error','翻译进程已退出，请重试');});
   child.stderr?.on('data',()=>{});
  }
  this.current=this.queue.shift()!;const {id,text,source,target}=this.current;this.child.postMessage({type:'translate',id,text,source,target,modelRoot:this.root});
 }
 cancel(){for(const job of this.queue)job.reject(Error('cancelled'));this.queue=[];if(this.current){this.current.reject(Error('cancelled'));this.child?.postMessage({type:'cancel',id:this.current.id});}}
 stop(){this.cancel();const child=this.child;this.child=null;this.current=null;child?.kill();}
}
