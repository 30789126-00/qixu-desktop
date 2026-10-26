export interface SaveStatus { status:'saved'|'saving'|'retrying'|'error';lastSaved:number;attempt:number;error:string; }
/** Serial, latest-wins writer. Failed snapshots stay pending; newer state supersedes them. */
export class SaveCoordinator<T>{
 readonly state:SaveStatus={status:'saved',lastSaved:0,attempt:0,error:''};
 private pending:T|undefined;private running:Promise<void>|null=null;private retryTimer:ReturnType<typeof setTimeout>|undefined;
 constructor(private write:(value:T)=>Promise<void>,private changed:()=>void,private delay=(attempt:number)=>Math.min(30000,250*2**Math.min(attempt-1,7))){}
 schedule(value:T){this.pending=value;clearTimeout(this.retryTimer);return this.flush();}
 flush():Promise<void>{if(this.running)return this.running;clearTimeout(this.retryTimer);
  this.running=(async()=>{while(this.pending!==undefined){const value=this.pending;this.pending=undefined;this.state.status='saving';this.changed();try{await this.write(value);Object.assign(this.state,{status:'saved',lastSaved:Date.now(),attempt:0,error:''});this.changed();}catch(e){if(this.pending===undefined)this.pending=value;this.state.attempt++;this.state.status=this.state.attempt<6?'retrying':'error';this.state.error=(e instanceof Error?e.message:String(e)).slice(0,160);this.changed();this.retryTimer=setTimeout(()=>void this.flush(),this.delay(this.state.attempt));this.retryTimer.unref?.();break;}}})().finally(()=>{this.running=null;});return this.running;
 }
 get hasPending(){return this.pending!==undefined;}
 close(){clearTimeout(this.retryTimer);}
}
