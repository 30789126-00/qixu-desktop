export type YouTubeRecoveryEvent =
  | {kind:'detected';attempt:number}
  | {kind:'retry';attempt:number}
  | {kind:'recovered';attempt:number}
  | {kind:'exhausted';attempt:number};

interface YouTubePlaybackSample {
  identity:string;
  error?:string;
  playing:boolean|null;
  position:number;
  intended:boolean;
  now:number;
}

/** A separate budget for each video, retained across page reloads. */
export class YouTubePlaybackRecovery {
  private identity='';
  private attempts=0;
  private nextRetryAt=0;
  private hadError=false;
  private exhausted=false;
  private stableSince=0;
  private lastPosition=0;

  get active(){return this.hadError&&!this.exhausted;}

  reset(identity=''){
    this.identity=identity;this.attempts=0;this.nextRetryAt=0;
    this.hadError=false;this.exhausted=false;this.stableSince=0;this.lastPosition=0;
  }

  observe(sample:YouTubePlaybackSample):YouTubeRecoveryEvent|null {
    if(sample.identity!==this.identity)this.reset(sample.identity);
    if(!sample.intended){
      // Pausing in YouTube itself or via the shell must never cause a restart.
      this.reset(sample.identity);return null;
    }
    if(sample.error&&!this.hadError){
      this.hadError=true;this.nextRetryAt=sample.now+1600;
      return {kind:'detected',attempt:this.attempts};
    }
    if(this.hadError && !sample.error && sample.playing && Number.isFinite(sample.position)){
      if(sample.position>this.lastPosition+.25){
        if(!this.stableSince)this.stableSince=sample.now;
        if(sample.now-this.stableSince>=4000){
          const attempt=this.attempts;this.reset(sample.identity);
          return {kind:'recovered',attempt};
        }
      }else this.stableSince=0;
    }else this.stableSince=0;
    if(Number.isFinite(sample.position))this.lastPosition=sample.position;
    // Once the error page disappears, a reload may still stall while seeking
    // or buffering. Retry on missing forward progress as well as on overlays.
    if(this.hadError&&!this.exhausted&&sample.now>=this.nextRetryAt){
      if(this.attempts>=2){
        this.exhausted=true;
        return {kind:'exhausted',attempt:this.attempts};
      }
      this.attempts++;
      this.nextRetryAt=sample.now+(this.attempts===1?15000:20000);
      return {kind:'retry',attempt:this.attempts};
    }
    return null;
  }
}
