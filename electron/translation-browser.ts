import type { WebContents, WebFrameMain } from 'electron';
import type { Settings } from '../shared/types';
import { TranslationService } from './translation-service';
import { detectLanguage } from './translation-language';
import { translationPageScript } from './translation-page';
export class BrowserTranslator {
 private epoch=0;private busy=false;private inFlight=0;private pageFlight=0;private captionFlight=0;private frames:WebFrameMain[]=[];private translated=0;
 constructor(private service:TranslationService,private onStatus:(patch:{page?:string;subtitles?:string;completed?:number;error?:string})=>void,private allowed:()=>boolean){}
 cancel(){++this.epoch;this.service.cancel();for(const frame of this.frames)void frame.executeJavaScript(translationPageScript('configure',{page:true,subtitles:true,active:false})).catch(()=>{});}
 async tick(contents:WebContents,settings:Settings,enabled:boolean){
  if(this.busy||contents.isDestroyed())return;
  this.busy=true;const epoch=this.epoch;
  try{
   const hostname=new URL(contents.getURL()).hostname;
   const page=settings.autoTranslate&&!settings.translationDisabledSites.includes(hostname);
   this.frames=contents.mainFrame.framesInSubtree;
   for(const frame of this.frames){
    if(epoch!==this.epoch)return;
    await frame.executeJavaScript(translationPageScript('configure',{page,subtitles:settings.bilingualSubtitles,autoSkipAds:settings.autoSkipYouTubeAds,active:enabled}));
    if(!enabled)continue;
    const result:any=await frame.executeJavaScript(translationPageScript('collect',{pageBudget:Math.max(0,2-this.pageFlight),captionBudget:Math.max(0,8-this.captionFlight)}));
    if(epoch!==this.epoch||!this.allowed())return;
    if(frame===contents.mainFrame)this.onStatus({page:page?'自动翻译 · 本地处理':'网页翻译已关闭',subtitles:String(result.reason||''),completed:this.translated});
    for(const cue of (result.captions||[]).slice(0,6))this.process(frame,cue,'caption',epoch);
    for(const item of (result.pages||[]).slice(0,3))this.process(frame,item,'page',epoch);
   }
  }catch{/* Frames can disappear during navigation. No navigation URL or page text is logged. */}
  finally{this.busy=false;}
 }
 private process(frame:WebFrameMain,item:any,kind:'page'|'caption',epoch:number){
  if(typeof item.text!=='string'||item.text.length>2000||typeof item.id!=='string')return;
  const language=detectLanguage(item.text,String(item.lang||''));
  if(!language||language.startsWith('zho')){
   void frame.executeJavaScript(translationPageScript('skip',{id:item.id,kind})).catch(()=>{});
   if(kind==='caption')this.onStatus({subtitles:language?'中文字幕无需叠加':'无法识别字幕语言'});
   return;
  }
  this.inFlight++;if(kind==='page')this.pageFlight++;else this.captionFlight++;
  void(async()=>{
   try{
    const zh=await this.service.translate(item.text,language,'zho_Hans',kind==='caption'?10:1);
    const en=kind==='caption'?(language==='eng_Latn'?item.text:await this.service.translate(item.text,language,'eng_Latn',10)):'';
    if(epoch!==this.epoch||!this.allowed())return;
    await frame.executeJavaScript(translationPageScript('apply',{kind:kind==='caption'?'caption':'page',id:item.id,text:zh,zh,en}));this.translated++;this.onStatus({completed:this.translated,error:''});
   }catch(e:any){if(epoch===this.epoch&&e.message!=='cancelled'){this.onStatus({error:'本地翻译：'+String(e.message).slice(0,160)});await frame.executeJavaScript(translationPageScript('retry')).catch(()=>{});}}
   finally{this.inFlight--;if(kind==='page')this.pageFlight--;else this.captionFlight--;}
  })();
 }
}
