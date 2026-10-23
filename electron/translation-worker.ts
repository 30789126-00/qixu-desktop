import { pipeline, env, StoppingCriteria } from '@huggingface/transformers';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { splitTranslationText } from './translation-language';
const port=(process as any).parentPort;
let translator:any=null,loading:Promise<void>|null=null;const cancelled=new Set<number>();
class CancelCriterion extends StoppingCriteria {constructor(private id:number){super();} _call(ids:any[]){return ids.map(()=>cancelled.has(this.id));}}
async function load(root:string){
 if(translator)return;if(loading)return loading;
 loading=(async()=>{
  port.postMessage({type:'state',model:'loading'});
  const manifest=JSON.parse(await fs.readFile(path.join(root,'manifest.json'),'utf8'));
  for(const entry of manifest.files){const hash=createHash('sha256');for await(const bytes of createReadStream(path.join(root,manifest.repo,entry.name)))hash.update(bytes);if(hash.digest('hex')!==entry.sha256)throw Error('模型文件校验失败：'+entry.name);}
  env.allowRemoteModels=false;env.localModelPath=root+path.sep;env.useFSCache=false;
  translator=await pipeline('translation',manifest.repo,{dtype:'q8',device:'cpu',session_options:{intraOpNumThreads:2,interOpNumThreads:1}} as any);
  port.postMessage({type:'state',model:'ready'});
 })();try{await loading;}catch(e){loading=null;throw e;}
}
port.on('message',async(event:any)=>{
 const job=event.data;
 if(job.type==='cancel'){cancelled.add(job.id);return;}
 if(job.type!=='translate')return;
 try{
  await load(job.modelRoot);const pieces=splitTranslationText(job.text);const results:string[]=[];
  for(const piece of pieces){if(cancelled.has(job.id))throw Error('cancelled');const output=await translator(piece,{src_lang:job.source,tgt_lang:job.target,max_new_tokens:180,num_beams:1,stopping_criteria:new CancelCriterion(job.id)});if(cancelled.has(job.id))throw Error('cancelled');results.push(output[0].translation_text);}
  port.postMessage({type:'result',id:job.id,text:results.join(' ')});
 }catch(e:any){port.postMessage({type:'result',id:job.id,error:e.message||String(e)});}finally{cancelled.delete(job.id);}
});
