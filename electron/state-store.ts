import fs from 'node:fs/promises';
import path from 'node:path';

async function exists(file:string) {
  try { await fs.stat(file); return true; } catch { return false; }
}

async function readObject(file:string) {
  const text=await fs.readFile(file,'utf8');
  const value=JSON.parse(text);
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('状态文件不是对象');
  return value as Record<string,unknown>;
}

export async function loadDurableState(file:string):Promise<{data:Record<string,unknown>|null;recoveredFrom:string|null}> {
  const candidates=[file,file+'.tmp',file+'.bak'];
  for(const candidate of candidates){
    try{return {data:await readObject(candidate),recoveredFrom:candidate===file?null:path.basename(candidate)};}catch{/* try next copy */}
  }
  return {data:null,recoveredFrom:null};
}

export async function saveDurableState(file:string,data:unknown) {
  const directory=path.dirname(file),temp=file+'.tmp',backup=file+'.bak';
  await fs.mkdir(directory,{recursive:true});
  const serialized=JSON.stringify(data,null,2);
  const handle=await fs.open(temp,'w');
  try { await handle.writeFile(serialized,'utf8'); await handle.sync(); } finally { await handle.close(); }
  await readObject(temp);
  if(await exists(file)){
    await fs.rm(backup,{force:true});
    await fs.rename(file,backup);
  }
  try { await fs.rename(temp,file); }
  catch(error){
    if(!(await exists(file))&&await exists(backup))await fs.rename(backup,file).catch(()=>{});
    throw error;
  }
}
