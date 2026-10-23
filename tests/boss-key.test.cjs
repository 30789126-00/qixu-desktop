const {test}=require('node:test'),assert=require('node:assert/strict'),{buildSync}=require('esbuild'),path=require('node:path');
const code=buildSync({entryPoints:[path.resolve(__dirname,'../electron/boss-key.ts')],bundle:true,platform:'node',format:'cjs',write:false}).outputFiles[0].text,m={exports:{}};new Function('require','module','exports',code)(require,m,m.exports);
const {loadBossKey,normalizeBossShortcut,createPasswordRecord,verifyBossPassword}=m.exports;
test('fresh setup stays pending across restart; existing installation keeps legacy access',async()=>{
 const fresh=loadBossKey(null,false);assert.equal(fresh.configured,false);assert.equal(loadBossKey(fresh,true).configured,false);
 const old=loadBossKey(null,true);assert.equal(old.legacyCtrlAlt,true);assert.equal(await verifyBossPassword('wsad',old),true);assert.equal(await verifyBossPassword('wrong',old),false);
});
test('custom password is salted, case sensitive, and survives configuration reload',async()=>{
 const a=await createPasswordRecord('Study-2048'),b=await createPasswordRecord('Study-2048');assert.notEqual(a.hash,b.hash);assert.notEqual(a.salt,b.salt);
 const cfg=loadBossKey({configured:true,passwordRequired:true,passwordRecord:a},true);assert.equal(await verifyBossPassword('Study-2048',cfg),true);assert.equal(await verifyBossPassword('study-2048',cfg),false);assert.equal(await verifyBossPassword('WSAD',cfg),false);assert.equal(await verifyBossPassword('x'.repeat(65),cfg),false);
 await assert.rejects(createPasswordRecord('123'));await assert.rejects(createPasswordRecord('    '));
});
test('boss shortcut accepts legacy modifiers and proper accelerator, rejects malformed values',()=>{
 assert.equal(normalizeBossShortcut('ctrl + alt'),'Ctrl+Alt');assert.equal(normalizeBossShortcut('Ctrl+Alt+Q'),'Ctrl+Alt+Q');assert.throws(()=>normalizeBossShortcut('Q'));assert.throws(()=>normalizeBossShortcut('Ctrl+'));assert.throws(()=>normalizeBossShortcut(12));
});
