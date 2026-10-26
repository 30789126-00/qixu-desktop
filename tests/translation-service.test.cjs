const {test}=require('node:test'),assert=require('node:assert/strict'),{buildSync}=require('esbuild'),path=require('node:path'),{EventEmitter}=require('node:events');
test('Retry replaces a cancelled worker and can execute the next translation',async()=>{
 const children=[];const electron={utilityProcess:{fork(){const child=new EventEmitter();child.sent=[];child.postMessage=message=>child.sent.push(message);child.kill=()=>child.emit('exit');children.push(child);return child;}}};
 const built=buildSync({entryPoints:[path.resolve(__dirname,'../electron/translation-service.ts')],bundle:true,platform:'node',format:'cjs',write:false,external:['electron']});
 const mod={exports:{}};new Function('require','module','exports','__dirname',built.outputFiles[0].text)(name=>name==='electron'?electron:require(name),mod,mod.exports,__dirname);
 const service=new mod.exports.TranslationService('models',()=>{});
 const first=service.translate('Hello','eng_Latn','zho_Hans');const cancelled=assert.rejects(first,/cancelled/);service.stop();await cancelled;
 const next=service.translate('World','eng_Latn','zho_Hans');assert.equal(children.length,2);const job=children[1].sent[0];children[1].emit('message',{type:'result',id:job.id,text:'世界'});assert.equal(await next,'世界');service.stop();
});
test('Translation disk cache is reused after restart and invalidated by model revision',async()=>{
 const fs=require('node:fs/promises'),os=require('node:os'),folder=await fs.mkdtemp(path.join(os.tmpdir(),'qixu-cache-test-')),children=[];
 const electron={utilityProcess:{fork(){const child=new EventEmitter();child.postMessage=message=>setImmediate(()=>child.emit('message',{type:'result',id:message.id,text:children.length===1?'你好':'新版译文'}));child.kill=()=>{};children.push(child);return child;}}};
 const built=buildSync({entryPoints:[path.resolve(__dirname,'../electron/translation-service.ts')],bundle:true,platform:'node',format:'cjs',write:false,external:['electron']}),mod={exports:{}};
 new Function('require','module','exports','__dirname',built.outputFiles[0].text)(name=>name==='electron'?electron:require(name),mod,mod.exports,__dirname);
 const file=path.join(folder,'cache.json');let service;
 try{await fs.writeFile(path.join(folder,'manifest.json'),'revision1');service=new mod.exports.TranslationService(folder,()=>{},file);assert.equal(await service.translate('Hello','eng_Latn','zho_Hans'),'你好');for(let i=0;i<60;i++){try{await fs.access(file);break;}catch{await new Promise(r=>setTimeout(r,25));}}await fs.access(file);service.stop();
  service=new mod.exports.TranslationService(folder,()=>{},file);assert.equal(await service.translate('Hello','eng_Latn','zho_Hans'),'你好');assert.equal(children.length,1);assert.equal(service.stats().entries,1);service.stop();
  await fs.writeFile(path.join(folder,'manifest.json'),'revision2');service=new mod.exports.TranslationService(folder,()=>{},file);assert.equal(await service.translate('Hello','eng_Latn','zho_Hans'),'新版译文');assert.equal(children.length,2);service.stop();await new Promise(r=>setTimeout(r,1100));
 }finally{service?.stop();await fs.rm(folder,{recursive:true,force:true});}
});
