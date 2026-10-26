const {test}=require('node:test'),assert=require('node:assert/strict'),p=require('node:path'),{buildSync}=require('esbuild');
const m={exports:{}};new Function('require','module','exports',buildSync({entryPoints:[p.resolve(__dirname,'../electron/window-geometry.ts')],bundle:true,platform:'node',format:'cjs',write:false}).outputFiles[0].text)(require,m,m.exports);
const {fitWindow}=m.exports;
test('DIP geometry regression matrix: mixed DPI, negative secondary monitors, removed monitors and constrained work areas',()=>{
 let cases=0;
 for(const scale of [1,1.25,1.5,2])for(const origin of [{x:0,y:0},{x:-1920,y:-300},{x:2560,y:0}])for(const saved of [undefined,{x:9999,y:-9999,width:960,height:680},{x:-1800,y:-100,width:1900,height:1200},{x:100,y:100,width:20,height:20}]){
  const area={...origin,width:Math.floor(1920/scale),height:Math.floor(1040/scale)},b=fitWindow(saved,area);assert.ok(b.x>=area.x&&b.y>=area.y);assert.ok(b.x+b.width<=area.x+area.width&&b.y+b.height<=area.y+area.height);assert.ok(b.width>0&&b.height>0);cases++;
 }
 assert.equal(cases,48);assert.deepEqual(fitWindow(undefined,{x:-300,y:0,width:300,height:250}),{x:-300,y:0,width:300,height:250});
});
