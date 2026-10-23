const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),src=path.join(root,'native-src'),out=path.join(root,'native');
fs.mkdirSync(out,{recursive:true});
let code=fs.readFileSync(path.join(src,'Todo.Original.cs'),'utf8');
code=code.replace('public static bool Read() {\n  if (TestMode)', 'public static bool Read() {\n  if (ManagedBridge.Active) return ManagedBridge.StartupEnabled;\n  if (TestMode)');
code=code.replace('public static void Set(bool enabled) {\n  if (TestMode)', 'public static void Set(bool enabled) {\n  if (ManagedBridge.Active) { ManagedBridge.StartupEnabled=enabled; ManagedBridge.Send(enabled ? "STARTUP_ON" : "STARTUP_OFF"); return; }\n  if (TestMode)');
// Original source may use CRLF; normalize before exact guarded transformations.
code=fs.readFileSync(path.join(src,'Todo.Original.cs'),'utf8').replace(/\r\n/g,'\n')
 .replace('public static bool Read() {\n  if (TestMode)','public static bool Read() {\n  if (ManagedBridge.Active) return ManagedBridge.StartupEnabled;\n  if (TestMode)')
 .replace('public static void Set(bool enabled) {\n  if (TestMode)','public static void Set(bool enabled) {\n  if (ManagedBridge.Active) { ManagedBridge.StartupEnabled=enabled; ManagedBridge.Send(enabled ? "STARTUP_ON" : "STARTUP_OFF"); return; }\n  if (TestMode)')
 .replace('PreviewKeyDown += HandleKeys;','PreviewKeyDown += HandleKeys;\n  if (ManagedBridge.Active) { tray.Visible=false; ManagedBridge.Attach(this); }')
 .replace('void Exit() { exiting = true; Close(); }','void Exit() { if (ManagedBridge.Active) ManagedBridge.Send("QUIT"); exiting = true; Close(); }\n public void BridgeExit() { Exit(); }\n public void BridgeRestore() { Restore(); }\n public void BridgeReport(string text) { Report(text); }\n public void BridgeRefreshStartup() { RefreshStartup(); }')
 .replace('if (args.Contains("--exit"))','if (args.Contains("--managed")) { ManagedBridge.Run(args); return; }\n   if (args.Contains("--exit"))')
 .replace('tray.ShowBalloonTip(5000,','if (ManagedBridge.Active) ManagedBridge.Send("REMINDER:"+text); else tray.ShowBalloonTip(5000,')
 .replace('Title = "待办 · 把重要的事，安排好"','Title = "栖序 · 把重要的事，安排好"')
 .replaceAll('"◉  待办"','"◉  栖序"')
 .replace('Title = "待办 · 桌面组件"','Title = "栖序 · 桌面组件"');
code=code.replace('nav.Children.Add(MakeWorkClock(false));', 'BridgeBossKeyButton=Ui.Button("老板键",()=>ManagedBridge.Send("BOSS_KEY_SETTINGS")); Ui.Name(BridgeBossKeyButton,"老板键"); BridgeBossKeyButton.Margin=new Thickness(0,12,0,0); BridgeBossKeyButton.Visibility=ManagedBridge.BossKeyConfigured?Visibility.Collapsed:Visibility.Visible; nav.Children.Add(BridgeBossKeyButton); nav.Children.Add(MakeWorkClock(false));').replace('public class MainWindow : Window {','public class MainWindow : Window {\n public Button BridgeBossKeyButton;');
code=code.replace('void Restore() { Show(); WindowState = WindowState.Normal; Activate(); }','void Restore() { if(ManagedBridge.Active && ManagedBridge.PrivateMode) { ManagedBridge.Send("SHOW_TODO"); return; } Show(); WindowState = WindowState.Normal; Activate(); }');
code=code.replace('public void BridgeRestore() { Restore(); }','public void BridgeRestore() { Restore(); }\n public string BridgeWindowStatus() { return (IsVisible?"1":"0")+","+(sticky!=null&&sticky.IsVisible?"1":"0")+","+(state.StickyOpen?"1":"0"); }\n public void BridgeCloseWidget() { if(sticky!=null)sticky.Close(); }');
code=code.replace('sticky.Left = Math.Max','if(ManagedBridge.Active) { sticky.MouseEnter+=(s,e)=>ManagedBridge.Send("WIDGET_HOVER:1"); sticky.MouseLeave+=(s,e)=>ManagedBridge.Send("WIDGET_HOVER:0"); sticky.Closed+=(s,e)=>ManagedBridge.Send("WIDGET_HOVER:0"); }\n  sticky.Left = Math.Max');
// Geometry self-tests drive selection methods explicitly; do not let live mouse
// movement during the timed hold inject unrelated events into those tests.
code=code.replace('public static class Ui {','public static class Ui {\n public static bool AutomatedTests;')
 .replace('if (args.Contains("--ui-test")) {','if (args.Contains("--ui-test")) { Ui.AutomatedTests=true;')
 .replace('Cancel(); anchor = point; additive = extend; baseline = readSelection(); downTask = Hit(point); pressed = true; Dragging = false; Focus(); CaptureMouse();','Cancel(); anchor = point; additive = extend; baseline = readSelection(); downTask = Hit(point); pressed = true; Dragging = false; Focus(); if(!Ui.AutomatedTests) CaptureMouse();')
 .replace('if (pressed) { MoveAt(e.GetPosition(this));','if (pressed && !Ui.AutomatedTests) { MoveAt(e.GetPosition(this));')
 .replace('if (pressed) { EndAt(e.GetPosition(this));','if (pressed && !Ui.AutomatedTests) { EndAt(e.GetPosition(this));')
 .replace('static void SelfTest() {','static void SelfTest() {\n ManagedBridge.TestUnlockGestures();\n if(!ManagedBridge.IsUnlockChord(Key.LeftAlt,ModifierKeys.Control|ModifierKeys.Alt,false)||ManagedBridge.IsUnlockChord(Key.A,ModifierKeys.Control|ModifierKeys.Alt,false)||ManagedBridge.IsUnlockChord(Key.LeftAlt,ModifierKeys.Control,false)||ManagedBridge.IsUnlockChord(Key.LeftAlt,ModifierKeys.Control|ModifierKeys.Alt,true))throw new Exception("Ctrl+Alt recognition");');
code=code.replace('public void BridgeRestore() { Restore(); }','public void BridgeRestore() { Restore(); }\n public void BridgeEnsureStartupWidget() { ShowSticky(); }').replace('RefreshStartup(); Activated += (o, e) => RefreshStartup();','RefreshStartup(); Activated += (o, e) => { RefreshStartup(); if(ManagedBridge.Active)ManagedBridge.Send("STARTUP_QUERY"); };');
for(const marker of ['ManagedBridge.Run(args)','ManagedBridge.Attach(this)','ManagedBridge.StartupEnabled','BridgeRestore()'])if(!code.includes(marker))throw Error('Native integration transformation missing: '+marker);
fs.writeFileSync(path.join(src,'Todo.Managed.cs'),code);
const version=require('../package.json').version+'.0';
fs.writeFileSync(path.join(src,'AssemblyInfo.cs'),`using System.Reflection;\n[assembly:AssemblyTitle("栖序")]\n[assembly:AssemblyProduct("栖序")]\n[assembly:AssemblyVersion("${version}")]\n[assembly:AssemblyFileVersion("${version}")]\n`);
fs.copyFileSync(path.join(root,'assets/icon.ico'),path.join(out,'icon.ico'));
const fx='C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319';
const args=['/nologo','/target:winexe','/out:'+path.join(out,'TodoHost.exe'),'/win32icon:'+path.join(out,'icon.ico'),...['PresentationFramework','PresentationCore','WindowsBase'].map(n=>'/reference:'+path.join(fx,'WPF',n+'.dll')),'/reference:System.Xaml.dll','/reference:System.Windows.Forms.dll','/reference:System.Drawing.dll',path.join(src,'Todo.Managed.cs'),path.join(src,'Bridge.cs'),path.join(src,'AssemblyInfo.cs')];
const result=spawnSync(path.join(fx,'csc.exe'),args,{stdio:'inherit'});if(result.status!==0)process.exit(result.status||1);
console.log('Native task workspace built.');
