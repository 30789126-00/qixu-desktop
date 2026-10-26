import JSZip from 'jszip';
import {DOMParser} from '@xmldom/xmldom';
import path from 'node:path';
export async function epubMetadata(bytes:Uint8Array){
 const archive=await JSZip.loadAsync(bytes),mime=archive.file('mimetype'),container=archive.file('META-INF/container.xml');
 if(!mime||!container||(await mime.async('string')).trim()!=='application/epub+zip')throw Error('EPUB 缺少有效结构');
 const parser=new DOMParser(),c=parser.parseFromString(await container.async('string'),'application/xml');const packagePath=c.getElementsByTagNameNS('*','rootfile')[0]?.getAttribute('full-path');if(!packagePath||!archive.file(packagePath))throw Error('EPUB 缺少内容索引');
 const xml=parser.parseFromString(await archive.file(packagePath)!.async('string'),'application/xml'),ns='http://purl.org/dc/elements/1.1/';
 const title=xml.getElementsByTagNameNS(ns,'title')[0]?.textContent?.trim().slice(0,200)||'',author=[...xml.getElementsByTagNameNS(ns,'creator')].map(el=>el.textContent?.trim()).filter(Boolean).join(' / ').slice(0,200);
 const items=[...xml.getElementsByTagNameNS('*','item')],coverId=[...xml.getElementsByTagNameNS('*','meta')].find(el=>el.getAttribute('name')==='cover')?.getAttribute('content');const cover=items.find(el=>el.getAttribute('id')===coverId)||items.find(el=>(el.getAttribute('properties')||'').split(/\s+/).includes('cover-image'));
 let coverBytes:Buffer|undefined;if(cover){const name=path.posix.normalize(path.posix.join(path.posix.dirname(packagePath),decodeURIComponent(cover.getAttribute('href')||'')));const file=archive.file(name);if(file&&!name.startsWith('../')){const value=await file.async('nodebuffer');if(value.length<=1024*1024&&((value[0]===0xff&&value[1]===0xd8)||(value[0]===0x89&&value.subarray(1,4).toString()==='PNG')||value.subarray(0,4).toString()==='RIFF'))coverBytes=value;}}
 return {title,author,coverBytes};
}
