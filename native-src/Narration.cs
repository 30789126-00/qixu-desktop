using System;
using System.Collections.Generic;
using System.Text;
using System.Speech.Synthesis;

public static class NativeNarration {
 static SpeechSynthesizer synth;
 static Prompt current;
 static string job;
 static DateTime lastProgress;
 static string Encode(string value) { return Convert.ToBase64String(Encoding.UTF8.GetBytes(value)); }
 static string Decode(string value) { return Encoding.UTF8.GetString(Convert.FromBase64String(value)); }
 static void Ready() {
  if(synth!=null)return;
  synth=new SpeechSynthesizer();
  synth.SpeakStarted+=(s,e)=>{if(e.Prompt==current)ManagedBridge.Send("SPEECH_STARTED:"+job);};
  synth.SpeakProgress+=(s,e)=>{if(e.Prompt==current&&(DateTime.UtcNow-lastProgress).TotalMilliseconds>120){lastProgress=DateTime.UtcNow;ManagedBridge.Send("SPEECH_PROGRESS:"+job+"|"+e.CharacterPosition);}};
  synth.SpeakCompleted+=(s,e)=>{if(e.Prompt!=current)return;if(e.Error!=null)ManagedBridge.Send("SPEECH_ERROR:"+job+"|"+Encode(e.Error.Message));else if(!e.Cancelled)ManagedBridge.Send("SPEECH_FINISHED:"+job);};
 }
 static void Stop() { current=null;job="";if(synth!=null){if(synth.State==SynthesizerState.Paused)synth.Resume();synth.SpeakAsyncCancelAll();} }
 public static bool Receive(string command) {
  if(!command.StartsWith("SPEECH_"))return false;
  try {
   Ready();
   if(command=="SPEECH_VOICES") {var rows=new List<string>();foreach(var voice in synth.GetInstalledVoices())if(voice.Enabled)rows.Add(Encode(voice.VoiceInfo.Name)+"|"+Encode(voice.VoiceInfo.Culture.Name));ManagedBridge.Send("SPEECH_VOICES:"+String.Join(";",rows.ToArray()));}
   else if(command=="SPEECH_STOP")Stop();
   else if(command=="SPEECH_PAUSE") {if(synth.State!=SynthesizerState.Paused)synth.Pause();}
   else if(command=="SPEECH_RESUME") {if(synth.State==SynthesizerState.Paused)synth.Resume();}
   else if(command.StartsWith("SPEECH_START:")) {
    var parts=command.Substring(13).Split('|');if(parts.Length!=4)return true;
    int token,rate;if(!Int32.TryParse(parts[0],out token)||!Int32.TryParse(parts[1],out rate))return true;
    string text=Decode(parts[3]);if(text.Length==0||text.Length>2400)return true;
    Stop();job=parts[0];synth.SetOutputToDefaultAudioDevice();synth.Rate=Math.Max(-5,Math.Min(5,rate));synth.SelectVoice(Decode(parts[2]));
    current=new Prompt(text);synth.SpeakAsync(current);
   }
  }catch(Exception e){ManagedBridge.Send("SPEECH_ERROR:"+(String.IsNullOrEmpty(job)?"0":job)+"|"+Encode(e.Message));}
  return true;
 }
 public static void Dispose() {if(synth!=null){Stop();synth.Dispose();synth=null;}}
}
