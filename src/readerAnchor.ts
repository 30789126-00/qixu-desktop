export interface ReadingAnchor {position:string;relativeY:number;}
export interface TextReadingAnchor {index:number;offset:number;relativeY:number;}
export function captureTextAnchor(host:HTMLElement):TextReadingAnchor|null{
 const box=host.getBoundingClientRect(),doc=host.ownerDocument as Document&{caretRangeFromPoint?:(x:number,y:number)=>Range|null};
 const range=doc.caretRangeFromPoint?.(box.left+box.width/2,box.top+Math.min(64,box.height*.2));
 const paragraph=range?.startContainer.parentElement?.closest<HTMLElement>('.reader-paragraph');
 if(!range||range.startContainer.nodeType!==3||!paragraph||!host.contains(paragraph))return null;
 const offset=range.startOffset,measured=range.cloneRange();if(offset<(range.startContainer.textContent?.length||0))measured.setEnd(range.startContainer,offset+1);
 return {index:Number(paragraph.dataset.index),offset,relativeY:Math.max(0,Math.min(.8,(measured.getBoundingClientRect().top-box.top)/box.height))};
}
export function alignTextAnchor(host:HTMLElement,anchor:TextReadingAnchor){
 const paragraph=host.querySelector<HTMLElement>('.reader-paragraph[data-index="'+anchor.index+'"]'),node=paragraph?.firstChild;
 if(!node||node.nodeType!==3)return false;
 const range=host.ownerDocument.createRange(),length=node.textContent?.length||0;range.setStart(node,Math.min(anchor.offset,Math.max(0,length-1)));range.setEnd(node,Math.min(anchor.offset+1,length));
 const delta=range.getBoundingClientRect().top-host.getBoundingClientRect().top-anchor.relativeY*host.clientHeight;
 if(Number.isFinite(delta))host.scrollTop+=delta;return true;
}
export function captureEpubAnchor(host:HTMLElement,rendition:any,fallback:string):ReadingAnchor{
 const area=host.getBoundingClientRect(),y=area.top+Math.min(64,area.height*.2);
 for(const frame of host.querySelectorAll('iframe')){const rect=frame.getBoundingClientRect();if(rect.top>y||rect.bottom<=y)continue;const doc=frame.contentDocument as (Document&{caretRangeFromPoint?:(x:number,y:number)=>Range|null})|null;if(!doc)continue;
  const range=doc.caretRangeFromPoint?.(Math.max(30,Math.min(rect.width-30,rect.width/2)),y-rect.top);const contents=rendition.getContents().find((c:any)=>c.document===doc);
  if(range&&contents&&range.startContainer.nodeType===3&&range.startContainer.textContent?.trim()){const position=contents.cfiFromRange(range),measured=range.cloneRange();if(measured.startOffset<(measured.startContainer.textContent?.length||0))measured.setEnd(measured.startContainer,measured.startOffset+1);const top=measured.getBoundingClientRect().top+rect.top-area.top;return {position,relativeY:Math.max(0,Math.min(.8,top/area.height))};}
 }return {position:fallback,relativeY:0};
}
export function alignEpubAnchor(host:HTMLElement,rendition:any,anchor:ReadingAnchor){
 const range=rendition.getRange(anchor.position);if(!range)return;const doc=range.startContainer.ownerDocument,frame=[...host.querySelectorAll('iframe')].find(f=>f.contentDocument===doc),container=host.querySelector<HTMLElement>('.epub-container');if(!frame||!container)return;
 if(range.collapsed&&range.startContainer.nodeType===3&&range.startOffset<(range.startContainer.textContent?.length||0))range.setEnd(range.startContainer,range.startOffset+1);
 const delta=range.getBoundingClientRect().top+frame.getBoundingClientRect().top-host.getBoundingClientRect().top-anchor.relativeY*host.clientHeight;if(Number.isFinite(delta))container.scrollTop+=delta;
}
