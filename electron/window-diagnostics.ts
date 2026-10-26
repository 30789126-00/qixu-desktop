export class WindowDiagnostics {
 enabled=false;private rows:{at:number;event:string;ms:number;mode:string;ok:boolean}[]=[];
 setEnabled(enabled:boolean){this.enabled=enabled;if(!enabled)this.rows=[];}
 begin(event:'hide'|'restore'|'transition'|'media-resume',mode:string){const start=performance.now();return (ok=true)=>{if(!this.enabled)return;this.rows.push({at:Date.now(),event,ms:Math.round((performance.now()-start)*100)/100,mode,ok});if(this.rows.length>500)this.rows.shift();};}
 snapshot(){const times=this.rows.map(r=>r.ms).sort((a,b)=>a-b);return {schema:1,enabled:this.enabled,count:times.length,p95:times[Math.floor(times.length*.95)]||0,events:this.rows.map(r=>({...r}))};}
 summary(){const {events,...summary}=this.snapshot();return summary;}
}
