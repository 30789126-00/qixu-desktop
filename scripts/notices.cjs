const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),seen=new Set(),notices=[];
function locate(name,from){
 let current=from;
 while(true){const candidate=path.join(current,'node_modules',name);if(fs.existsSync(path.join(candidate,'package.json')))return candidate;const parent=path.dirname(current);if(parent===current)return null;current=parent;}
}
function visit(name,from){
 const dir=locate(name,from);if(!dir||seen.has(dir))return;seen.add(dir);
 const pkg=JSON.parse(fs.readFileSync(path.join(dir,'package.json'),'utf8'));
 const files=fs.readdirSync(dir).filter(f=>/^(licen[cs]e|copying|copyright|notice)(\.|$)/i.test(f)&&fs.statSync(path.join(dir,f)).isFile());
 notices.push('='.repeat(72)+'\n'+pkg.name+' '+pkg.version+'\nLicense: '+String(pkg.license||'See package source')+'\n'+files.map(f=>'\n'+f+'\n'+fs.readFileSync(path.join(dir,f),'utf8')).join('\n'));
 for(const dep of Object.keys(pkg.dependencies||{}))visit(dep,dir);
}
for(const dep of Object.keys(require('../package.json').dependencies))visit(dep,root);
fs.writeFileSync(path.join(root,'THIRD_PARTY_NOTICES.txt'),'Third-party components used by Moyu\nElectron and Chromium notices are also included with the runtime.\n\n'+notices.join('\n\n'));
console.log('Collected license notices for',notices.length,'packages.');
