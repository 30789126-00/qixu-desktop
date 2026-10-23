const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildSync } = require('esbuild');
const vm = require('node:vm');
const path = require('node:path');
const built = buildSync({entryPoints:[path.resolve(__dirname,'../src/readerText.ts')],bundle:true,platform:'node',format:'cjs',write:false});
const moduleObject={exports:{}};
vm.runInNewContext(built.outputFiles[0].text,{module:moduleObject,exports:moduleObject.exports,TextDecoder,Uint8Array,Set,console});
const {decodeAndIndex, searchParagraphs}=moduleObject.exports;
function bytes(s,encoding='utf8') {const b=Buffer.from(s,encoding);return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);}
test('TXT encoding detection preserves Chinese and creates chapter index',()=>{
  const source='第一章 小憩\n今天，给自己一点时间。\n\n第二章 晚风\n窗外的风慢慢吹过。';
  for(const content of [bytes(source),bytes('\ufeff'+source,'utf16le')]) {
    const parsed=decodeAndIndex(content);
    assert.equal(parsed.chapters.length,2);assert.equal(parsed.paragraphs[1].text,'今天，给自己一点时间。');
  }
  const gb=require('iconv-lite').encode(source,'gb18030');
  const parsed=decodeAndIndex(gb.buffer.slice(gb.byteOffset,gb.byteOffset+gb.byteLength));
  assert.equal(parsed.encoding,'gb18030');assert.equal(parsed.paragraphs[0].text,'第一章 小憩');
});
test('A very long paragraph is bounded and does not split emoji surrogate pairs',()=>{
  const source='字'.repeat(1199)+'🐟'+'风'.repeat(10000);
  const parsed=decodeAndIndex(bytes(source));
  assert.equal(parsed.paragraphs.map(p=>p.text).join(''),source);
  assert.ok(parsed.paragraphs.every(p=>p.text.length<=1200));
  assert.ok(parsed.paragraphs.every(p=>!/[\uD800-\uDBFF]$/.test(p.text)));
});
test('Text search returns bounded navigable results and empty books fail clearly',()=>{
  const parsed=decodeAndIndex(bytes(Array.from({length:300},(_,i)=>'第'+i+'段：晚风里的故事').join('\n')));
  const hits=searchParagraphs(parsed.paragraphs,'晚风');assert.equal(hits.count,300);assert.equal(hits.matches.length,200);assert.match(hits.matches[0].position,/^txt:\d+:0$/);
  assert.throws(()=>decodeAndIndex(bytes('  \n  ')),/没有可阅读/);assert.throws(()=>decodeAndIndex(new ArrayBuffer(0)),/空文件/);
});
