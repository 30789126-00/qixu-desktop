import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
function parse(text:string) {
  if(/<!DOCTYPE|<!ENTITY/i.test(text))throw new Error('待办数据包含不支持的 XML 声明');
  const errors:string[]=[];
  const doc=new DOMParser({onError:(level,message)=>{if(level!=='warning')errors.push(message);}}).parseFromString(text,'text/xml');
  if(errors.length||doc.documentElement?.nodeName!=='State')throw new Error('待办数据损坏，未执行合并');
  return doc;
}
const serialize=(node:any)=>new XMLSerializer().serializeToString(node);
function children(node:any):any[]{return Array.from(node.childNodes||[]).filter((n:any)=>n.nodeType===1);}
function field(node:any,name:string):string{return children(node).find(n=>n.nodeName===name)?.textContent||'';}
function canonical(node:any):string|null{return node?JSON.stringify(children(node).map(n=>[n.nodeName,n.textContent]).sort()):null;}
function tasks(doc:any):Map<string,any>{const items=children(children(doc.documentElement).find(n=>n.nodeName==='Tasks')||{});const map=new Map<string,any>();for(const t of items){const id=field(t,'Id');if(!id||map.has(id))throw new Error('待办任务标识无效');map.set(id,t);}return map;}
export function mergeLegacy(currentText:string,legacyText:string,baseText?:string) {
  const current=parse(currentText),legacy=parse(legacyText),base=baseText?parse(baseText):null;
  const a=tasks(current),b=tasks(legacy),before=base?tasks(base):new Map<string,any>();
  let added=0,conflicts=0;
  for(const id of new Set([...a.keys(),...b.keys(),...before.keys()])){
    const left=a.get(id),right=b.get(id),original=before.get(id);
    const l=canonical(left),r=canonical(right),o=canonical(original);
    if(l===r||r===o)continue;
    if(l===o){if(right){a.set(id,right);if(!left)added++;}else a.delete(id);continue;}
    if(!right)continue; // Keep an edited current revision when the legacy revision was deleted.
    if(!left&&!original){a.set(id,right);added++;continue;}
    const conflictId=id+'-legacy-'+hash(r!).slice(0,12);
    if(a.has(conflictId))continue;
    const clone=right.cloneNode(true);
    children(clone).find(n=>n.nodeName==='Id').textContent=conflictId;
    children(clone).find(n=>n.nodeName==='Title').textContent=field(right,'Title')+'（旧待办保留版本）';
    a.set(conflictId,clone);conflicts++;
  }
  const root=current.documentElement!;
  let list=children(root).find(n=>n.nodeName==='Tasks');
  if(!list){list=current.createElement('Tasks');root.appendChild(list);}
  while(list.firstChild)list.removeChild(list.firstChild);
  for(const task of a.values())list.appendChild(current.importNode(task,true));
  for(const item of children(legacy.documentElement).filter(n=>n.nodeName!=='Tasks')){
    const name=item.nodeName,left=children(root).find(n=>n.nodeName===name),original=base&&children(base.documentElement).find(n=>n.nodeName===name);
    const l=left?.textContent||'',r=item.textContent||'',o=original?.textContent||'';
    if(l===r||r===o)continue;
    if(l===o){if(left)root.replaceChild(current.importNode(item,true),left);else root.appendChild(current.importNode(item,true));}
    else if(name==='Note'&&r){left!.textContent=l+'\n\n【旧待办保留便签】\n'+r;conflicts++;}
  }
  return {xml:serialize(current),added,conflicts,total:a.size};
}
export async function migrateLegacy(dataDir:string,legacyFile='F:\\待办\\数据\\tasks.xml') {
  let legacy:string;
  try{legacy=await fs.readFile(legacyFile,'utf8');}catch(e:any){if(e.code==='ENOENT')return null;throw e;}
  const folder=path.join(dataDir,'todo'),destination=path.join(folder,'tasks.xml');
  const backup=path.join(dataDir,'migration-backup'),marker=path.join(backup,'merge-1.2.json');
  const digest=hash(legacy);
  try{if(JSON.parse(await fs.readFile(marker,'utf8')).legacyHash===digest)return null;}catch(e:any){if(e.code!=='ENOENT')throw e;}
  let current:string;try{current=await fs.readFile(destination,'utf8');}catch(e:any){if(e.code!=='ENOENT')throw e;current='<State><Tasks/></State>';}
  let baseline:string|undefined;try{baseline=await fs.readFile(path.join(backup,'legacy-tasks.xml'),'utf8');}catch(e:any){if(e.code!=='ENOENT')throw e;}
  const result=mergeLegacy(current,legacy,baseline);
  const snapshot=path.join(backup,'upgrade-1.2-'+Date.now());await fs.mkdir(snapshot,{recursive:true});
  await fs.writeFile(path.join(snapshot,'qixu-tasks.xml'),current);await fs.writeFile(path.join(snapshot,'legacy-tasks.xml'),legacy);
  await fs.mkdir(folder,{recursive:true});await fs.writeFile(destination+'.merge',result.xml);
  await fs.rename(destination+'.merge',destination);
  await fs.writeFile(marker,JSON.stringify({legacyHash:digest,at:new Date().toISOString(),added:result.added,conflicts:result.conflicts,total:result.total,snapshot},null,2));
  return {added:result.added,conflicts:result.conflicts,total:result.total};
}
