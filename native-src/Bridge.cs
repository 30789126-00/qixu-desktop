using System;
using System.IO;
using System.Threading;
using System.Collections.Generic;
using System.Text;
using System.IO.Pipes;
using System.Windows;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using System.Runtime.InteropServices;
public static class ManagedBridge {
 public static bool Active;
 public static bool StartupEnabled;
 public static bool PrivateMode;
 public static bool BossKeyConfigured;
 static MainWindow window;
 static NamedPipeClientStream pipe;
 static StreamReader input;
 static StreamWriter output;
 static bool chord;
 delegate IntPtr KeyboardProc(int code,IntPtr message,IntPtr info);
 static KeyboardProc keyboardProc;
 static IntPtr keyboardHook;
 static HwndSource rawSource;
 static HashSet<int> rawKeys=new HashSet<int>();
 static bool rawPendingChord,rawDirtyChord;
 static readonly object unlockGate=new object();
 static long lastUnlockTicks;
 [DllImport("user32.dll",SetLastError=true)] static extern IntPtr SetWindowsHookEx(int type,KeyboardProc callback,IntPtr module,uint thread);
 [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr hook);
 [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hook,int code,IntPtr message,IntPtr info);
 [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
 [DllImport("user32.dll")] static extern void keybd_event(byte key,byte scan,uint flags,UIntPtr extra);
 [DllImport("user32.dll",SetLastError=true)] static extern bool RegisterRawInputDevices(RAWINPUTDEVICE[] devices,uint count,uint size);
 [DllImport("user32.dll",SetLastError=true)] static extern uint GetRawInputData(IntPtr raw,uint command,IntPtr data,ref uint size,uint headerSize);
 [DllImport("kernel32.dll",CharSet=CharSet.Auto)] static extern IntPtr GetModuleHandle(string name);
 [StructLayout(LayoutKind.Sequential)] struct RAWINPUTDEVICE { public ushort UsagePage; public ushort Usage; public uint Flags; public IntPtr Target; }
 [StructLayout(LayoutKind.Sequential)] struct RAWINPUTHEADER { public uint Type; public uint Size; public IntPtr Device; public IntPtr WParam; }
 [StructLayout(LayoutKind.Sequential)] struct RAWKEYBOARD { public ushort MakeCode; public ushort Flags; public ushort Reserved; public ushort VKey; public uint Message; public uint ExtraInformation; }
 static HashSet<int> physicalKeys=new HashSet<int>();
 static bool pendingChord,dirtyChord;
 static bool CtrlKey(int key){return key==0x11||key==0xA2||key==0xA3;}
 static bool AltKey(int key){return key==0x12||key==0xA4||key==0xA5;}
 public static void ResetUnlockGesture(){physicalKeys.Clear();pendingChord=false;dirtyChord=false;}
 // Ignore injected events. Wait for release to distinguish Ctrl+Alt+editing keys.
 public static bool ProcessUnlockKey(int vk,bool down,bool up,bool injected){
  if(injected){pendingChord=false;if(physicalKeys.Count>0)dirtyChord=true;return false;}
  if(down)physicalKeys.Add(vk);else if(up)physicalKeys.Remove(vk);else return false;
  bool ctrl=false,alt=false,other=false;
  foreach(int key in physicalKeys){if(CtrlKey(key))ctrl=true;else if(AltKey(key))alt=true;else other=true;}
  if(down&&other){dirtyChord=true;pendingChord=false;}
  bool trigger=up&&pendingChord&&(!ctrl||!alt)&&!dirtyChord;
  if(trigger)pendingChord=false;
  if(down&&ctrl&&alt&&!other&&!dirtyChord)pendingChord=true;
  if(!ctrl&&!alt){pendingChord=false;dirtyChord=other;}
  return trigger;
 }
 static bool ProcessRawUnlockKey(int vk,bool down,bool up){
  if(down)rawKeys.Add(vk);else if(up)rawKeys.Remove(vk);else return false;
  bool ctrl=false,alt=false,other=false;
  foreach(int key in rawKeys){if(CtrlKey(key))ctrl=true;else if(AltKey(key))alt=true;else other=true;}
  if(down&&other){rawDirtyChord=true;rawPendingChord=false;}
  bool trigger=up&&rawPendingChord&&(!ctrl||!alt)&&!rawDirtyChord;
  if(trigger)rawPendingChord=false;
  if(down&&ctrl&&alt&&!other&&!rawDirtyChord)rawPendingChord=true;
  if(!ctrl&&!alt){rawPendingChord=false;rawDirtyChord=other;}
  return trigger;
 }
 static void SendUnlock(){
  lock(unlockGate){long now=DateTime.UtcNow.Ticks;if(lastUnlockTicks!=0&&now-lastUnlockTicks<TimeSpan.FromMilliseconds(350).Ticks)return;lastUnlockTicks=now;}
  Send("UNLOCK");
 }
 public static void TestUnlockGestures(){
  ResetUnlockGesture();if(ProcessUnlockKey(0xA2,true,false,false)||ProcessUnlockKey(0xA4,true,false,false)||!ProcessUnlockKey(0xA4,false,true,false)||ProcessUnlockKey(0xA2,false,true,false))throw new Exception("Physical Ctrl+Alt release");
  ResetUnlockGesture();foreach(int key in new[]{0x11,0x12})if(ProcessUnlockKey(key,true,false,true))throw new Exception("Injected press");foreach(int key in new[]{0x12,0x11})if(ProcessUnlockKey(key,false,true,true))throw new Exception("Injected release");
  ResetUnlockGesture();foreach(int key in new[]{0xA2,0xA4,0x4B})if(ProcessUnlockKey(key,true,false,false))throw new Exception("Editing chord press");foreach(int key in new[]{0x4B,0xA4,0xA2})if(ProcessUnlockKey(key,false,true,false))throw new Exception("Editing chord release");
  ResetUnlockGesture();ProcessUnlockKey(0xA3,true,false,false);ProcessUnlockKey(0xA5,true,false,false);ProcessUnlockKey(0xA5,true,false,false);if(!ProcessUnlockKey(0xA3,false,true,false)||ProcessUnlockKey(0xA5,false,true,false))throw new Exception("Right modifiers/repeat");ResetUnlockGesture();
  rawKeys.Clear();rawPendingChord=false;rawDirtyChord=false;if(ProcessRawUnlockKey(0xA2,true,false)||ProcessRawUnlockKey(0xA4,true,false)||!ProcessRawUnlockKey(0xA4,false,true)||ProcessRawUnlockKey(0xA2,false,true))throw new Exception("Raw physical Ctrl+Alt release");
  rawKeys.Clear();rawPendingChord=false;rawDirtyChord=false;foreach(int key in new[]{0xA2,0xA4,0x4B})if(ProcessRawUnlockKey(key,true,false))throw new Exception("Raw editing chord press");foreach(int key in new[]{0x4B,0xA4,0xA2})if(ProcessRawUnlockKey(key,false,true))throw new Exception("Raw editing chord release");
  rawKeys.Clear();rawPendingChord=false;rawDirtyChord=false;
 }
 static void InstallKeyboardHook(){
  keyboardProc=(code,message,info)=>{
   if(code>=0){int msg=message.ToInt32(),vk=Marshal.ReadInt32(info),flags=Marshal.ReadInt32(info,8);bool down=msg==0x100||msg==0x104,up=msg==0x101||msg==0x105;
    if(ProcessUnlockKey(vk,down,up,(flags&0x12)!=0))SendUnlock();
   }
   return CallNextHookEx(keyboardHook,code,message,info);
  };
  keyboardHook=SetWindowsHookEx(13,keyboardProc,GetModuleHandle(null),0);
 }
 static bool InstallRawInput(MainWindow w){
  try{
   var handle=new WindowInteropHelper(w).Handle;if(handle==IntPtr.Zero)return false;
   rawSource=HwndSource.FromHwnd(handle);if(rawSource==null)return false;
   var devices=new[]{new RAWINPUTDEVICE{UsagePage=0x01,Usage=0x06,Flags=0x00000100,Target=handle}};
   if(!RegisterRawInputDevices(devices,1,(uint)Marshal.SizeOf(typeof(RAWINPUTDEVICE)))){rawSource=null;return false;}
   rawSource.AddHook(RawInputHook);return true;
  }catch{return false;}
 }
 static IntPtr RawInputHook(IntPtr hwnd,int msg,IntPtr wParam,IntPtr lParam,ref bool handled){
  if(msg!=0x00FF)return IntPtr.Zero;
  uint size=0,headerSize=(uint)Marshal.SizeOf(typeof(RAWINPUTHEADER));
  if(GetRawInputData(lParam,0x10000003,IntPtr.Zero,ref size,headerSize)==0xFFFFFFFF||size<headerSize)return IntPtr.Zero;
  IntPtr data=Marshal.AllocHGlobal((int)size);
  try{
   if(GetRawInputData(lParam,0x10000003,data,ref size,headerSize)==0xFFFFFFFF)return IntPtr.Zero;
   var header=(RAWINPUTHEADER)Marshal.PtrToStructure(data,typeof(RAWINPUTHEADER));
   // Device == 0 is synthetic/legacy input. Only genuine device packets may unlock the app.
   if(header.Type!=1||header.Device==IntPtr.Zero)return IntPtr.Zero;
   var keyboard=(RAWKEYBOARD)Marshal.PtrToStructure(IntPtr.Add(data,Marshal.SizeOf(typeof(RAWINPUTHEADER))),typeof(RAWKEYBOARD));
   int key=keyboard.VKey,msgCode=(int)keyboard.Message;bool down=msgCode==0x100||msgCode==0x104,up=msgCode==0x101||msgCode==0x105;
   if(ProcessRawUnlockKey(key,down,up))SendUnlock();
  }finally{Marshal.FreeHGlobal(data);}
  return IntPtr.Zero;
 }
 public static bool IsUnlockChord(Key key,ModifierKeys modifiers,bool repeat) {return !repeat && modifiers==(ModifierKeys.Control|ModifierKeys.Alt) && (key==Key.LeftCtrl||key==Key.RightCtrl||key==Key.LeftAlt||key==Key.RightAlt);}
 static void HandleKey(Key key,ModifierKeys modifiers,bool down,bool repeat){
  if(down&&!chord&&IsUnlockChord(key,modifiers,repeat)){chord=true;Send("UNLOCK");}
  if(!down&&modifiers!=(ModifierKeys.Control|ModifierKeys.Alt))chord=false;
 }
 static List<Window> hidden = new List<Window>();
 public static void Send(string command) { if (Active && output!=null) { try {lock(output){output.WriteLine(command.Replace("\r"," ").Replace("\n"," "));output.Flush();}} catch {} } }
 public static void Attach(MainWindow w) {
  if (!Active) return; window=w; w.Title="栖序 · 今日安排";
  try { w.Icon=BitmapFrame.Create(new Uri(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"icon.ico"))); } catch {}
  var reader=new Thread(()=>{try {string line;while((line=input.ReadLine())!=null){var command=line;w.Dispatcher.BeginInvoke(new Action(()=>Receive(command)));}}catch{}finally{try{w.Dispatcher.BeginInvoke(new Action(()=>w.BridgeExit()));}catch{}}});
  reader.IsBackground=true; reader.Start();
  InstallKeyboardHook();
  w.SourceInitialized+=(s,e)=>{if(!InstallRawInput(w)&&keyboardHook==IntPtr.Zero)Send("HOTKEY_FAILED");};
  w.Closed+=(s,e)=>{if(rawSource!=null){rawSource.RemoveHook(RawInputHook);rawSource=null;}if(keyboardHook!=IntPtr.Zero){UnhookWindowsHookEx(keyboardHook);keyboardHook=IntPtr.Zero;}};
  w.Loaded+=(s,e)=>w.Dispatcher.BeginInvoke(new Action(()=>Send("HELLO:"+Environment.GetEnvironmentVariable("QIXU_BRIDGE_NONCE"))),DispatcherPriority.ContextIdle);
 }
 static void Receive(string command) {
  if(command=="TEST_CTRL_ALT"&&Environment.GetEnvironmentVariable("QIXU_TEST")=="1"){chord=false;HandleKey(Key.LeftAlt,ModifierKeys.Control|ModifierKeys.Alt,true,false);}
  if(Environment.GetEnvironmentVariable("QIXU_TEST")=="1") {
   if(command=="TEST_GLOBAL_CTRL_ALT"){keybd_event(0x11,0,0,UIntPtr.Zero);keybd_event(0x12,0,0,UIntPtr.Zero);keybd_event(0x12,0,2,UIntPtr.Zero);keybd_event(0x11,0,2,UIntPtr.Zero);}
   if(command=="TEST_WINDOWS")Send("TEST_WINDOWS:"+window.BridgeWindowStatus());
   if(command=="TEST_OPEN_LIST")window.BridgeRestore();
   if(command=="TEST_CLOSE_WIDGET")window.BridgeCloseWidget();
   if(command=="TEST_BOSS_KEY_VISIBLE")Send("TEST_BOSS_KEY_VISIBLE:"+(window.BridgeBossKeyButton.Visibility==Visibility.Visible&&window.BridgeBossKeyButton.IsEnabled?"1":"0"));
   if(command=="TEST_OPEN_BOSS_KEY"&&window.BridgeBossKeyButton.IsVisible&&window.BridgeBossKeyButton.IsEnabled)window.BridgeBossKeyButton.RaiseEvent(new RoutedEventArgs(System.Windows.Controls.Button.ClickEvent));
  }
  if(command=="SHOW") { PrivateMode=false;foreach(var w in hidden)try{w.Show();}catch{}hidden.Clear();window.BridgeRestore(); }
  else if(command=="ENTER_PRIVATE") {PrivateMode=true;window.Hide();}
  else if(command=="HIDE_ALL") {PrivateMode=false;foreach(Window w in Application.Current.Windows)if(w.IsVisible){if(!hidden.Contains(w))hidden.Add(w);w.Hide();}}
  else if(command=="EXIT")window.BridgeExit();
  else if(command.StartsWith("STATUS:"))window.BridgeReport(command.Substring(7));
  else if(command.StartsWith("STARTUP:")){StartupEnabled=command.Substring(8)=="1";window.BridgeRefreshStartup();}
  else if(command.StartsWith("BOSS_KEY_CONFIGURED:")){BossKeyConfigured=command.Substring(20)=="1";window.BridgeBossKeyButton.Visibility=BossKeyConfigured?Visibility.Collapsed:Visibility.Visible;}
 }
 public static void Run(string[] args) {
  Active=true;StartupEnabled=Environment.GetEnvironmentVariable("QIXU_STARTUP")=="1";BossKeyConfigured=Environment.GetEnvironmentVariable("QIXU_BOSS_KEY_CONFIGURED")=="1";
  string folder=Environment.GetEnvironmentVariable("QIXU_TODO_DATA");
  if(String.IsNullOrEmpty(folder)||String.IsNullOrEmpty(Environment.GetEnvironmentVariable("QIXU_BRIDGE_NONCE")))return;
  pipe=new NamedPipeClientStream(".",Environment.GetEnvironmentVariable("QIXU_PIPE_NAME"),PipeDirection.InOut,PipeOptions.Asynchronous);
  pipe.Connect(8000);input=new StreamReader(pipe,new UTF8Encoding(false));output=new StreamWriter(pipe,new UTF8Encoding(false));output.AutoFlush=true;
  Data.Folder=folder; Directory.CreateDirectory(folder);
  var app=new Application();var w=new MainWindow();
  if(Array.IndexOf(args,"--background")>=0)w.Loaded+=(s,e)=>{w.Hide();w.BridgeEnsureStartupWidget();};
  app.Run(w);
 }
}
