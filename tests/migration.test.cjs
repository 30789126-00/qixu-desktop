const {test}=require('node:test'),assert=require('node:assert/strict'),{buildSync}=require('esbuild');
const built=buildSync({entryPoints:[require('node:path').resolve(__dirname,'../electron/legacy-migration.ts')],bundle:true,platform:'node',format:'cjs',write:false});
const mod={exports:{}};new Function('require','module','exports',built.outputFiles[0].text)(require,mod,mod.exports);const {mergeLegacy}=mod.exports;
const task=(id,title)=>`<TaskItem><Id>${id}</Id><Title>${title}</Title><Done>false</Done></TaskItem>`;
const state=(tasks,note='')=>`<State><Tasks>${tasks}</Tasks><Note>${note}</Note><StickyOpen>true</StickyOpen></State>`;
test('Three-way migration adds new tasks once and keeps edits and deletions made in Qixu',()=>{
 const base=state(task('a','original')+task('b','deleted'));
 const current=state(task('a','edited'));
 const old=state(task('a','original')+task('b','deleted')+task('c','new'));
 const first=mergeLegacy(current,old,base);assert.equal(first.total,2);assert.equal(first.added,1);assert.ok(first.xml.includes('edited'));assert.ok(!first.xml.includes('<Id>b</Id>'));
 const again=mergeLegacy(first.xml,old,base);assert.equal(again.xml,first.xml);assert.equal(again.added,0);
});
test('Conflicting task revisions are both retained, without repeated conflict copies',()=>{
 const base=state(task('a','original')),old=state(task('a','legacy edit')),current=state(task('a','qixu edit'));
 const first=mergeLegacy(current,old,base);assert.equal(first.total,2);assert.equal(first.conflicts,1);assert.match(first.xml,/旧待办保留版本/);assert.equal(mergeLegacy(first.xml,old,base).total,2);
});
test('Damaged XML or external entity declarations abort migration',()=>{
 assert.throws(()=>mergeLegacy('<State>','<State/>'));
 assert.throws(()=>mergeLegacy('<!DOCTYPE x [<!ENTITY y SYSTEM "file:///x">]><State/>','<State/>'));
});
