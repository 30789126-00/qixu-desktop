/* Deterministic, original test content; no external downloads. */
const fs = require('node:fs');
const path = require('node:path');
const project = path.resolve(__dirname, '..');
const small = path.join(project, 'fixtures');
const large = path.resolve(project, '..', 'test-fixtures');
fs.mkdirSync(small, { recursive: true });
fs.mkdirSync(large, { recursive: true });
function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) { crc ^= byte; for (let n=0;n<8;n++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function zip(entries) {
  const locals=[], centrals=[]; let offset=0;
  for(const [name,text] of entries) {
    const n=Buffer.from(name), data=Buffer.from(text), crc=crc32(data);
    const local=Buffer.alloc(30); local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);
    local.writeUInt32LE(crc,14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(n.length,26);
    locals.push(local,n,data);
    const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(0x800,8);
    central.writeUInt32LE(crc,16);central.writeUInt32LE(data.length,20);central.writeUInt32LE(data.length,24);central.writeUInt16LE(n.length,28);central.writeUInt32LE(offset,42);
    centrals.push(central,n);offset += local.length+n.length+data.length;
  }
  const directory=Buffer.concat(centrals), end=Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...locals,directory,end]);
}
function epub(chapters, paragraphs = 18) {
  const entries=[['mimetype','application/epub+zip'],['META-INF/container.xml','<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>']];
  const manifest=[],spine=[],nav=[];
  for(let n=1;n<=chapters;n++) {
    manifest.push(`<item id="c${n}" href="c${n}.xhtml" media-type="application/xhtml+xml"/>`);spine.push(`<itemref idref="c${n}"/>`);nav.push(`<li><a href="c${n}.xhtml">第${n}章 清风经过</a></li>`);
    entries.push([`OEBPS/c${n}.xhtml`,`<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh"><head><title>第${n}章 清风经过</title></head><body><h1>第${n}章 清风经过</h1>${Array.from({length:paragraphs},(_,i)=>`<p>这是第${n}章的第${i+1}段。午后的光穿过窗边，落在一本安静的书上。我们缓缓读下去，听见风经过树叶，也把片刻时间留给自己。</p>`).join('')}</body></html>`]);
  }
  entries.push(['OEBPS/nav.xhtml',`<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>目录</title></head><body><nav epub:type="toc"><h1>目录</h1><ol>${nav.join('')}</ol></nav></body></html>`]);
  entries.push(['OEBPS/content.opf',`<?xml version="1.0" encoding="UTF-8"?><package version="3.0" unique-identifier="book-id" xmlns="http://www.idpf.org/2007/opf"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">urn:moyu:fixture:${chapters}</dc:identifier><dc:title>清风经过 · ${chapters}章测试书</dc:title><dc:language>zh</dc:language><dc:creator>摸鱼测试</dc:creator><meta property="dcterms:modified">2026-10-17T00:00:00Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${manifest.join('')}</manifest><spine>${spine.join('')}</spine></package>`]);
  return zip(entries);
}
const sample='第一章 清风经过\n\n午后的光落在窗边。这是用于验证中文编码、阅读位置、搜索和书签的原创测试文字。\n\n第二章 留一点时间\n\n把故事读慢一些，让每一个字都清楚地停在眼前。\n';
fs.writeFileSync(path.join(small,'sample-utf8.txt'),sample);
fs.writeFileSync(path.join(small,'sample-utf16.txt'),Buffer.concat([Buffer.from([0xff,0xfe]),Buffer.from(sample,'utf16le')]));
fs.writeFileSync(path.join(small,'sample.epub'),epub(3));
fs.writeFileSync(path.join(small,'hundreds-chapters.epub'),epub(360));
fs.writeFileSync(path.join(large,'large-20mb-360.epub'),epub(360,360));
fs.writeFileSync(path.join(small,'broken.epub'),'This is deliberately not a ZIP or an EPUB.');
fs.writeFileSync(path.join(small,'broken-zip.epub'),'PK This has a ZIP-looking header but is not a ZIP.');
fs.writeFileSync(path.join(small,'epub-missing-package.epub'),zip([['mimetype','application/epub+zip']]));
fs.writeFileSync(path.join(small,'empty.txt'),'');
const target=20*1024*1024;
const paragraph=Buffer.from('天光从窗边缓缓走过。我们把这一段平静的文字，留作大文件连续阅读和自动滚动的验证。\n\n');
const utf8file=fs.openSync(path.join(large,'large-20mb-utf8.txt'),'w');
let written=0,chapter=0;
while(written<target) {
  const block=Buffer.concat([Buffer.from(`第${++chapter}章 风与光\n\n`),Buffer.concat(Array(100).fill(paragraph))]);
  fs.writeSync(utf8file,block);written+=block.length;
}
fs.closeSync(utf8file);
fs.writeFileSync(path.join(large,'long-paragraph.txt'),'第一章 超长段落\n\n'+'窗边的风带来平静。'.repeat(150000)+'\n\n第二章 结束\n\n末尾仍然可读。');
let gb18030=false;
try {
  const iconv=require('iconv-lite');
  fs.writeFileSync(path.join(small,'sample-gb18030.txt'),iconv.encode(sample,'gb18030'));
  const gb=iconv.encode('第一章 中文编码\n\n'+('简体中文繁體字、标点符号和生僻字𠀀，都应该正确解码。\n\n').repeat(300),'gb18030');
  const f=fs.openSync(path.join(large,'large-20mb-gb18030.txt'),'w');for(let b=0;b<target;b+=gb.length)fs.writeSync(f,gb);fs.closeSync(f);gb18030=true;
} catch { console.log('GB18030 fixture deferred: run again after npm install.'); }
const result={small,large,gb18030,files:[...fs.readdirSync(small).map(f=>({path:path.join(small,f),bytes:fs.statSync(path.join(small,f)).size})),...fs.readdirSync(large).map(f=>({path:path.join(large,f),bytes:fs.statSync(path.join(large,f)).size}))]};
fs.writeFileSync(path.join(large,'manifest.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
