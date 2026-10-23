const fs=require('node:fs/promises'),{createReadStream}=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const repo='Xenova/nllb-200-distilled-600M',revision='261c31d1a5732c67cdd16d80e8d6088507c7ccea';
const root=path.resolve(__dirname,'../models'),folder=path.join(root,repo);
const files=['config.json','generation_config.json','tokenizer.json','tokenizer_config.json','special_tokens_map.json','sentencepiece.bpe.model','onnx/encoder_model_quantized.onnx','onnx/decoder_model_merged_quantized.onnx'];
async function digest(file,algorithm='sha256',git=false){const h=crypto.createHash(algorithm);if(git)h.update('blob '+(await fs.stat(file)).size+'\0');for await(const data of createReadStream(file))h.update(data);return h.digest('hex');}
async function main(){
 await fs.mkdir(folder,{recursive:true});
 const meta=await fetch(`https://hf-mirror.com/api/models/${repo}/revision/${revision}?blobs=true`,{signal:AbortSignal.timeout(30000)}).then(r=>{if(!r.ok)throw Error('Metadata HTTP '+r.status);return r.json();});
 if(meta.sha!==revision)throw Error('Unexpected model revision');
 const manifest={repo,revision,license:'CC-BY-NC-4.0',files:[]};
 for(const name of files){
  const entry=meta.siblings.find(f=>f.rfilename===name);if(!entry)throw Error('Missing model file '+name);
  const file=path.join(folder,name),expected=entry.lfs?.sha256||entry.lfs?.oid,blob=entry.blobId;
  await fs.mkdir(path.dirname(file),{recursive:true});
  async function valid(){try{return expected?(await digest(file))===expected:(await digest(file,'sha1',true))===blob;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
  if(!await valid()){
   let completed=false;
   for(let attempt=0;attempt<4&&!completed;attempt++){
    const partial=file+'.part';
    try{
     let offset=0;try{offset=(await fs.stat(partial)).size;}catch{}
     const response=await fetch(`https://hf-mirror.com/${repo}/resolve/${revision}/${name}?download=true&attempt=${attempt}`,{headers:offset?{Range:`bytes=${offset}-`}:{},signal:AbortSignal.timeout(600000)});
     if(!response.ok)throw Error('HTTP '+response.status);
     if(response.status!==206)offset=0;
     const handle=await fs.open(partial,offset?'a':'w');let received=offset,last=offset;
     try{for await(const data of response.body){await handle.write(data);received+=data.length;if(received-last>50*1024*1024){console.log(name,Math.round(received/1048576)+' MB');last=received;}}}finally{await handle.close();}
     await fs.rename(partial,file);if(!await valid())throw Error('Checksum mismatch '+name);completed=true;
    }catch(e){console.log('Retry',name,attempt+1,e.message);if(attempt===3)throw e;}
   }
  }
  const sha256=await digest(file);manifest.files.push({name,sha256,bytes:(await fs.stat(file)).size,upstream:expected||blob});console.log('Verified',name);
 }
 await fs.writeFile(path.join(root,'manifest.json'),JSON.stringify(manifest,null,2));
 const card=await fetch(`https://hf-mirror.com/${repo}/resolve/${revision}/README.md`).then(r=>r.text());await fs.writeFile(path.join(root,'MODEL-LICENSE-AND-CARD.md'),card+'\n\nOriginal model: https://huggingface.co/facebook/nllb-200-distilled-600M\nLicense: CC-BY-NC-4.0; personal non-commercial build.\n');
 console.log('Model ready:',manifest.files.reduce((n,f)=>n+f.bytes,0),'bytes');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
