import type { NarrationSegment, NarrationState } from '../shared/types';

export const emptyNarration = ():NarrationState => ({status:'idle',bookId:null,runId:'',segmentId:'',voices:[],error:'',character:0});
interface Context { unlocked:boolean; bookId:string|null; visible:boolean; suspended:boolean; continueHidden:boolean; voice:string; rate:number; }
const encode=(text:string)=>Buffer.from(text,'utf8').toString('base64');
export class NarrationService {
 readonly state=emptyNarration();
 private current:{segment:NarrationSegment;job:string;submitted:boolean}|null=null;
 private serial=0;private autoResume=false;private pendingFinish=false;
 constructor(private send:(command:string)=>void,private context:()=>Context,private changed:()=>void){}
 private notify(){this.changed();}
 private blocked(){const c=this.context();return c.suspended||(!c.visible&&!c.continueHidden);}
 private submit(){
  if(!this.current)return;const c=this.context(),s=this.current.segment;
  const voice=this.state.voices.find(v=>v.name===c.voice)||this.state.voices.find(v=>/^zh/i.test(v.language))||this.state.voices[0];
  if(!voice){this.state.status='error';this.state.error='本机没有可用的朗读语音，请先在 Windows 安装中文语音。';this.notify();return;}
  this.current.submitted=true;this.state.status='preparing';this.state.error='';
  this.send(`SPEECH_START:${this.current.job}|${Math.max(-5,Math.min(5,Math.round(c.rate)))}|${encode(voice.name)}|${encode(s.text)}`);this.notify();
 }
 speak(segment:NarrationSegment){
  const c=this.context();
  if(!c.unlocked||c.bookId!==segment.bookId)throw Error('请在当前书籍中启动朗读');
  if(!segment.text.trim()||segment.text.length>2400||!/^[\w-]{1,80}$/.test(segment.runId)||!/^[-\w:.]{1,120}$/.test(segment.segmentId))throw Error('朗读段落格式无效');
  this.send('SPEECH_STOP');this.current={segment:{...segment,text:segment.text.trim()},job:String(++this.serial),submitted:false};
  Object.assign(this.state,{bookId:segment.bookId,runId:segment.runId,segmentId:segment.segmentId,character:0,error:''});
  this.autoResume=false;this.pendingFinish=false;
  if(this.blocked()){this.autoResume=true;this.state.status='paused';this.notify();}else this.submit();
 }
 pause(automatic=false){
  if(!this.current||!['preparing','speaking'].includes(this.state.status))return;
  this.autoResume=automatic;this.send('SPEECH_PAUSE');this.state.status='paused';this.notify();
 }
 resume(){
  if(!this.current||this.state.status!=='paused'||this.blocked())return;
  this.autoResume=false;
  if(this.pendingFinish){this.pendingFinish=false;this.state.status='finished';this.notify();return;}
  if(!this.current.submitted)this.submit();else{this.state.status='speaking';this.send('SPEECH_RESUME');this.notify();}
 }
 stop(runId?:string){
  if(runId&&this.state.runId!==runId)return;
  this.autoResume=false;this.pendingFinish=false;this.current=null;++this.serial;this.send('SPEECH_STOP');
  if(this.state.status!=='idle'){Object.assign(this.state,{status:'idle',bookId:null,runId:'',segmentId:'',error:'',character:0});this.notify();}
 }
 sync(){
  if(!this.current)return;const c=this.context();
  if(!c.unlocked||c.bookId!==this.state.bookId||c.suspended){this.stop();return;}
  if(this.blocked())this.pause(true);else if(this.autoResume)this.resume();
 }
 receive(command:string){
  if(command.startsWith('SPEECH_VOICES:')){
   this.state.voices=command.slice(14).split(';').filter(Boolean).slice(0,100).map(row=>{const [name,language]=row.split('|');return {name:Buffer.from(name,'base64').toString('utf8'),language:Buffer.from(language||'','base64').toString('utf8')};});this.notify();return true;
  }
  const match=/^SPEECH_(STARTED|FINISHED|ERROR|PROGRESS):([^|]+)(?:\|(.*))?$/.exec(command);if(!match)return false;
  if(!this.current||match[2]!==this.current.job)return true;
  if(match[1]==='ERROR'){this.state.status='error';this.state.error=Buffer.from(match[3]||'','base64').toString('utf8').slice(0,200)||'本机语音启动失败';this.autoResume=false;}
  else if(match[1]==='FINISHED'){if(this.state.status==='paused')this.pendingFinish=true;else this.state.status='finished';this.state.character=this.current.segment.text.length;}
  else if(match[1]==='PROGRESS'){this.state.character=Math.max(0,Math.min(this.current.segment.text.length,Number(match[3])||0));}
  else if(this.state.status!=='paused')this.state.status='speaking';else this.send('SPEECH_PAUSE');
  this.sync();this.notify();return true;
 }
}
