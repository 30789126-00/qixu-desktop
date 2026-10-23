const {test}=require('node:test'),assert=require('node:assert/strict'),{buildSync}=require('esbuild'),path=require('node:path'),{EventEmitter}=require('node:events');
test('Retry replaces a cancelled worker and can execute the next translation',async()=>{
 const children=[];const electron={utilityProcess:{fork(){const child=new EventEmitter();child.sent=[];child.postMessage=message=>child.sent.push(message);child.kill=()=>child.emit('exit');children.push(child);return child;}}};
 const built=buildSync({entryPoints:[path.resolve(__dirname,'../electron/translation-service.ts')],bundle:true,platform:'node',format:'cjs',write:false,external:['electron']});
 const mod={exports:{}};new Function('require','module','exports','__dirname',built.outputFiles[0].text)(name=>name==='electron'?electron:require(name),mod,mod.exports,__dirname);
 const service=new mod.exports.TranslationService('models',()=>{});
 const first=service.translate('Hello','eng_Latn','zho_Hans');const cancelled=assert.rejects(first,/cancelled/);service.stop();await cancelled;
 const next=service.translate('World','eng_Latn','zho_Hans');assert.equal(children.length,2);const job=children[1].sent[0];children[1].emit('message',{type:'result',id:job.id,text:'世界'});assert.equal(await next,'世界');service.stop();
});
