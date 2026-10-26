/** Loaded EPUB XML documents are shared by rendition, search and speech.
 * A lease prevents one consumer from unloading a document used by another. */
export class EpubResources {
 private pins=new Map<number,number>();private loaded=new Map<number,Promise<any>>();private disposed=false;private holds=0;
 hold(){this.holds++;let active=true;return()=>{if(active){active=false;this.holds=Math.max(0,this.holds-1);this.trim();}};}
 constructor(private book:any,private visible:()=>number[],private changed:(stats:{loaded:number;pinned:number})=>void=()=>{}){ }
 async acquire(index:number){if(this.disposed)throw Error('书籍已关闭');const section=this.book.spine.spineItems[index];if(!section)return null;
  this.pins.set(index,(this.pins.get(index)||0)+1);
  let promise=this.loaded.get(index);if(!promise){promise=(section.document?Promise.resolve(section):section.load(this.book.load.bind(this.book)).then(()=>section)).finally(()=>this.loaded.delete(index));this.loaded.set(index,promise!);}
  try{await promise;}catch(e){this.loaded.delete(index);this.release(index);throw e;}
  if(this.disposed){this.release(index);return null;}
  return {section,release:()=>this.release(index)};
 }
 private release(index:number){const count=(this.pins.get(index)||1)-1;if(count>0)this.pins.set(index,count);else this.pins.delete(index);this.trim();}
 trim(){if(this.disposed||this.holds)return;const live=new Set<number>();for(const i of this.visible())for(const n of [i-1,i,i+1])live.add(n);
  for(const section of this.book.spine.spineItems){if(live.has(section.index)||this.pins.has(section.index))continue;if(section.document)section.unload();this.loaded.delete(section.index);}this.changed(this.stats());
 }
 stats(){return {loaded:this.book.spine.spineItems.filter((s:any)=>!!s.document).length,pinned:this.pins.size};}
 dispose(){this.disposed=true;this.loaded.clear();this.pins.clear();}
}
