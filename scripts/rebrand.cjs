const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),file=path.join(root,'src/App.tsx');
let s=fs.readFileSync(file,'utf8');
s=s.replace(/<svg viewBox="0 0 40 40"[\s\S]*?<\/svg>/,'<svg viewBox="0 0 40 40" fill="none" aria-hidden="true"><path d="M20 5 36 14 20 23 4 14Z" fill="white"/><path d="m4 21 16 9 16-9M4 28l16 9 16-9" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" opacity=".75"/></svg>');
fs.writeFileSync(file,s);
