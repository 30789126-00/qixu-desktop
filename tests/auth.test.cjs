const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),path=require('node:path'),{buildSync}=require('esbuild');
const built=buildSync({entryPoints:[path.resolve(__dirname,'../electron/auth.ts')],bundle:true,platform:'node',format:'cjs',write:false});
const mod={exports:{}};vm.runInNewContext(built.outputFiles[0].text,{module:mod,exports:mod.exports,require,Buffer});
const {verifyPassword}=mod.exports;
test('Password accepts only ASCII WSAD with any letter casing',()=>{for(const p of ['WSAD','wsad','wSaD','WsAd'])assert.equal(verifyPassword(p),true);for(const p of ['',null,1234,'wrong','WSAD ',' WSAD','WſAD','WSAD\n','WASD','WSA'])assert.equal(verifyPassword(p),false);});
