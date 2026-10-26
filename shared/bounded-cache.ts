/** Access-ordered, byte-budgeted cache. A single oversized value is never kept. */
export class BoundedCache<V> {
 private items=new Map<string,{value:V;bytes:number;at:number}>();private used=0;
 constructor(readonly maxEntries:number,readonly maxBytes:number,private size:(value:V)=>number,private ttl=Infinity){}
 get bytes(){return this.used;}get count(){return this.items.size;}
 get(key:string,now=Date.now()):V|undefined{const item=this.items.get(key);if(!item)return;if(now-item.at>this.ttl){this.delete(key);return;}this.items.delete(key);this.items.set(key,item);return item.value;}
 set(key:string,value:V,at=Date.now()){this.delete(key);const bytes=this.size(value)+key.length*2;if(bytes>this.maxBytes)return;this.items.set(key,{value,bytes,at});this.used+=bytes;while(this.items.size>this.maxEntries||this.used>this.maxBytes)this.delete(this.items.keys().next().value!);}
 delete(key:string){const item=this.items.get(key);if(item)this.used-=item.bytes;this.items.delete(key);}
 clear(){this.items.clear();this.used=0;}
 entries(){return [...this.items].map(([key,item])=>({key,value:item.value,at:item.at}));}
}
