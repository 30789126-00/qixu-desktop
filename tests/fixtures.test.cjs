const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const dir=path.resolve(__dirname,'../fixtures');
test('EPUB fixtures contain an uncompressed first mimetype entry',()=>{
  for(const name of ['sample.epub','hundreds-chapters.epub']) {
    const data=fs.readFileSync(path.join(dir,name));
    assert.equal(data.readUInt32LE(0),0x04034b50);
    assert.equal(data.readUInt16LE(8),0);
    assert.equal(data.subarray(30,38).toString(),'mimetype');
    assert.equal(data.subarray(38,58).toString(),'application/epub+zip');
    assert.ok(data.includes(Buffer.from('OEBPS/content.opf')));
    assert.ok(data.includes(Buffer.from('OEBPS/nav.xhtml')));
  }
});
test('Text fixtures include UTF-8 and BOM-tagged UTF-16 text',()=>{
  assert.match(fs.readFileSync(path.join(dir,'sample-utf8.txt'),'utf8'),/第二章/);
  const utf16=fs.readFileSync(path.join(dir,'sample-utf16.txt'));
  assert.deepEqual([...utf16.subarray(0,2)],[0xff,0xfe]);
  assert.match(utf16.subarray(2).toString('utf16le'),/第一章/);
});
