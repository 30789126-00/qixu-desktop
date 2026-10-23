const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{buildSync}=require('esbuild'),{DOMParser}=require('@xmldom/xmldom');
const data=process.env.APPDATA+'/Moyu',legacy='F:/待办/数据/tasks.xml';
const built=buildSync({entryPoints:[path.resolve(__dirname,'../electron/legacy-migration.ts')],bundle:true,platform:'node',format:'cjs',write:false});
const mod={exports:{}};new Function('require','module','exports',built.outputFiles[0].text)(require,mod,mod.exports);
const read=file=>fs.existsSync(file)?fs.readFileSync(file,'utf8'):undefined;
const current=read(data+'/todo/tasks.xml')||'<State><Tasks/></State>';
const result=process.argv.includes('--current')?{xml:current}:mod.exports.mergeLegacy(current,read(legacy)||current,read(data+'/migration-backup/legacy-tasks.xml'));
const doc=new DOMParser().parseFromString(result.xml,'text/xml'),ids=Array.from(doc.getElementsByTagName('TaskItem')).map(n=>n.getElementsByTagName('Id')[0]?.textContent).sort();
console.log(JSON.stringify({total:ids.length,added:result.added,conflicts:result.conflicts,idsHash:crypto.createHash('sha256').update(ids.join('\n')).digest('hex')}));
