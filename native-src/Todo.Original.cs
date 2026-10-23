using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Globalization;
using System.Xml.Serialization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Media;
using System.Windows.Input;
using System.Windows.Threading;
using System.Windows.Markup;
using Rectangle = System.Windows.Shapes.Rectangle;
using System.Threading;
using Microsoft.Win32;
using Forms = System.Windows.Forms;

public class TaskItem {
 public string Id = Guid.NewGuid().ToString(); public string Title;
 public DateTime? Start, End;
 public int Quadrant = 1; public bool Done, Notified, EndNotified; public DateTime Created = DateTime.Now;
 public TaskItem Copy() { return (TaskItem)MemberwiseClone(); }
}
public class State {
 public List<TaskItem> Tasks = new List<TaskItem>(); public string Note = "";
 public string OffWorkTime = "18:00"; public DateTime WorkdayDate; public string WorkBootSession="";
 public bool StickyOpen = true; public double WidgetOpacity = 0.72; public bool Pin = true;
 public double NoteLeft = 100, NoteTop = 100, NoteWidth = 390, NoteHeight = 740;
}
public static class Data {
 public static string Folder = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "数据");
 public static string FileName { get { return Path.Combine(Folder, "tasks.xml"); } }
 public static string[] Split(string s) { return s.Split(new char[] { ',', '，', '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries).Select(x => x.Trim()).Where(x => x.Length > 0).ToArray(); }
 public static bool ValidRange(DateTime? start, DateTime? end) { return !start.HasValue || !end.HasValue || end.Value >= start.Value; }
 public static State Read() {
  if (!File.Exists(FileName)) return new State();
  try { using (var f = File.OpenRead(FileName)) return Normalize((State)new XmlSerializer(typeof(State)).Deserialize(f)); }
  catch { if (File.Exists(FileName + ".bak")) { using (var f = File.OpenRead(FileName + ".bak")) { var s = Normalize((State)new XmlSerializer(typeof(State)).Deserialize(f)); MessageBox.Show("已从上一次备份恢复数据。", "待办"); return s; } } throw; }
 }
 static State Normalize(State s) {
  if (s.Tasks == null) s.Tasks = new List<TaskItem>(); var ids = new HashSet<string>();
  foreach (var t in s.Tasks) { if (String.IsNullOrEmpty(t.Id) || !ids.Add(t.Id)) { t.Id = Guid.NewGuid().ToString(); ids.Add(t.Id); } t.Quadrant = Math.Max(0, Math.Min(3, t.Quadrant)); t.Title = t.Title ?? "未命名任务"; }
  return s;
 }
 public static void Save(State s) {
  Directory.CreateDirectory(Folder); string temp = FileName + ".tmp";
  using (var f = new FileStream(temp, FileMode.Create, FileAccess.Write, FileShare.None)) { new XmlSerializer(typeof(State)).Serialize(f, s); f.Flush(true); }
  if (File.Exists(FileName)) File.Replace(temp, FileName, FileName + ".bak"); else File.Move(temp, FileName);
 }
}
public static class WorkdayClock {
 [System.Runtime.InteropServices.DllImport("kernel32.dll")] static extern ulong GetTickCount64();
 public static string BootSession(){
  // Kernel-Boot 27 identifies both cold and fast-startup boots. Hibernate resume
  // (type 2) is excluded so sleep/hibernate do not restart an overtime session.
  try{var query=new System.Diagnostics.Eventing.Reader.EventLogQuery("System",System.Diagnostics.Eventing.Reader.PathType.LogName,"*[System[Provider[@Name='Microsoft-Windows-Kernel-Boot'] and EventID=27]]"){ReverseDirection=true};using(var reader=new System.Diagnostics.Eventing.Reader.EventLogReader(query)){for(int i=0;i<20;i++){using(var record=reader.ReadEvent()){if(record==null)break;var xml=new System.Xml.XmlDocument();xml.LoadXml(record.ToXml());var type=xml.SelectSingleNode("//*[local-name()='Data' and @Name='BootType']");if(type!=null&&(type.InnerText=="0"||type.InnerText=="1"))return "boot:"+record.RecordId+":"+record.TimeCreated.Value.ToUniversalTime().Ticks;}}}}
  catch{}return "uptime:"+DateTime.UtcNow.AddMilliseconds(-(double)GetTickCount64()).Ticks;
 }
 public static bool StartSession(State state,DateTime now,string boot){
  bool same=state.WorkBootSession==boot;
  if(!same&&boot.StartsWith("uptime:")&&(state.WorkBootSession??"").StartsWith("uptime:")){long previous,current;if(Int64.TryParse(state.WorkBootSession.Substring(7),out previous)&&Int64.TryParse(boot.Substring(7),out current))same=Math.Abs((double)previous-current)<TimeSpan.FromMinutes(3).Ticks;}
  if(same&&state.WorkdayDate!=DateTime.MinValue)return false;state.WorkBootSession=boot;state.WorkdayDate=now.Date;return true;
 }
 public static bool TryTime(string text,out TimeSpan time) { return TimeSpan.TryParseExact((text??"").Trim(),new[]{@"h\:mm",@"hh\:mm"},CultureInfo.InvariantCulture,out time)&&time.TotalHours<24; }
 public static string Remaining(DateTime now,string target,DateTime day) { TimeSpan time;if(!TryTime(target,out time))return "请设置下班时间";var left=day.Date.Add(time)-now;if(left<=TimeSpan.Zero){long minutes=(long)Math.Floor(-left.TotalMinutes);return "已加班 "+(minutes/60)+"小时"+(minutes%60)+"分钟";}long remaining=(long)Math.Ceiling(left.TotalMinutes);return (remaining/60)+"小时"+(remaining%60)+"分钟"; }
 public static void Test() {
  TimeSpan t;if(TryTime("24:00",out t)||TryTime("18:99",out t)||!TryTime("9:05",out t))throw new Exception("off-work validation");var day=new DateTime(2026,10,20);var state=new State();
  if(!StartSession(state,day.AddHours(9),"boot:a"))throw new Exception("initial boot session");if(Remaining(day.AddHours(16).AddMinutes(29).AddSeconds(30),"18:00",state.WorkdayDate)!="1小时31分钟"||Remaining(day.AddHours(19),"19:00",state.WorkdayDate)!="已加班 0小时0分钟"||Remaining(day.AddDays(1).AddHours(12),"19:00",state.WorkdayDate)!="已加班 17小时0分钟"||Remaining(day.AddDays(2).AddHours(12),"19:00",state.WorkdayDate)!="已加班 41小时0分钟")throw new Exception("overtime across midnight");
  if(StartSession(state,day.AddDays(1).AddHours(12),"boot:a")||state.WorkdayDate!=day)throw new Exception("app restart must preserve overtime");if(!StartSession(state,day.AddDays(1).AddHours(12),"boot:b")||Remaining(day.AddDays(1).AddHours(12),"19:00",state.WorkdayDate)!="7小时0分钟")throw new Exception("computer reboot resets workday");
 }
}
public static class StartupSettings {
 const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
 const string ValueName = "DaibanDesktop";
 public static bool TestMode;
 static bool testEnabled;
 public static string CommandFor(string executable) { return "\"" + executable + "\" --startup"; }
 static string Command { get { return CommandFor(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Daiban.exe")); } }
 public static bool Read() {
  if (TestMode) return testEnabled;
  using (var key = Registry.CurrentUser.OpenSubKey(RunKey)) return key != null && String.Equals(key.GetValue(ValueName) as string, Command, StringComparison.OrdinalIgnoreCase);
 }
 public static void Set(bool enabled) {
  if (TestMode) { testEnabled = enabled; return; }
  WriteAt(RunKey, ValueName, Command, enabled);
 }
 static void WriteAt(string path, string name, string command, bool enabled) {
  using (var key = Registry.CurrentUser.CreateSubKey(path)) {
   if (key == null) throw new IOException("无法访问当前用户的启动设置。");
   if (enabled) key.SetValue(name, command, RegistryValueKind.String); else key.DeleteValue(name, false);
  }
 }
 public static void TestRegistry() {
  string testKey = @"Software\Daiban\SelfTests\" + Guid.NewGuid().ToString("N");
  string command = CommandFor(@"F:\含 空格\待办\Daiban.exe");
  bool created = false;
  try {
   if (command != "\"F:\\含 空格\\待办\\Daiban.exe\" --startup") throw new Exception("startup command quoting");
   WriteAt(testKey, ValueName, command, true); created = true;
   using (var key = Registry.CurrentUser.OpenSubKey(testKey)) { if (key == null || (string)key.GetValue(ValueName) != command) throw new Exception("startup registry enable"); }
   WriteAt(testKey, ValueName, command, false);
   using (var key = Registry.CurrentUser.OpenSubKey(testKey)) { if (key.GetValue(ValueName) != null) throw new Exception("startup registry disable"); }
  } finally { if (created) Registry.CurrentUser.DeleteSubKey(testKey, false); }
 }
}
public static class Ui {
 public static readonly string[] Names = { "重要且紧急", "重要不紧急", "紧急不重要", "不重要不紧急" };
 public static readonly string[] Colors = { "#BE3152", "#3A55B8", "#965700", "#7842A4" };
 public static readonly string[] Tints = { "#FFE2E8", "#E0ECFF", "#FFF0B8", "#EEE1FF" };
 public static Brush B(string s) { return (Brush)new BrushConverter().ConvertFromString(s); }
 public static TextBlock T(string s, double size = 14, string color = "#25304A") { return new TextBlock { Text = s, FontSize = size, Foreground = B(color), TextWrapping = TextWrapping.Wrap, VerticalAlignment = VerticalAlignment.Center }; }
 public static Button Button(string s, Action action, bool primary = false, bool compact = false) {
  var b = new Button { Content = s, Padding = compact ? new Thickness(9, 6, 9, 6) : new Thickness(14, 9, 14, 9), Margin = new Thickness(0, 0, 6, 5), FontSize = compact ? 12 : 14, Background = B(primary ? "#7350D6" : "#E8DFFB"), Foreground = B(primary ? "#FFFFFF" : "#43516B"), BorderThickness = new Thickness(0), Cursor = Cursors.Hand };
  b.Click += (o, e) => action(); return b;
 }
 public static void Name(DependencyObject control, string name) { System.Windows.Automation.AutomationProperties.SetName(control, name); }
}
public class TimeField : StackPanel {
 public DatePicker Date; public TextBox Time;
 public TimeField(string label, DateTime? value, string defaultTime, bool compact = false) {
  Orientation = Orientation.Horizontal; Margin = new Thickness(0, 4, 0, 4);
  Children.Add(new TextBlock { Text = label, Width = 42, VerticalAlignment = VerticalAlignment.Center, Foreground = Ui.B("#61718E"), FontSize = 12 });
  Date = new DatePicker { Width = compact ? 125 : 135, SelectedDate = value, SelectedDateFormat = DatePickerFormat.Short, Language = XmlLanguage.GetLanguage("zh-CN"), FontSize = 12, VerticalContentAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 6, 0) };
  Date.DateValidationError += (o, e) => { e.ThrowException = false; };
  Time = new TextBox { Width = 55, Text = value.HasValue ? value.Value.ToString("HH:mm") : defaultTime, Padding = new Thickness(5), FontSize = 12, VerticalContentAlignment = VerticalAlignment.Center, BorderBrush = Ui.B("#DCE3F0") };
  Ui.Name(Date, label + "日期"); Ui.Name(Time, label + "时刻"); Children.Add(Date); Children.Add(Time);
  var clear = Ui.Button("清空", () => { Date.SelectedDate = null; Date.Text = ""; }, false, true); clear.Margin = new Thickness(4, 0, 0, 0); clear.Padding = new Thickness(5); clear.ToolTip = "清空" + label + "时间"; Children.Add(clear);
 }
 public bool Read(out DateTime? value, out string error) {
  value = null; error = null; if (!Date.SelectedDate.HasValue && String.IsNullOrWhiteSpace(Date.Text)) return true;
  DateTime d; if (!DateTime.TryParse(Date.Text, CultureInfo.GetCultureInfo("zh-CN"), DateTimeStyles.None, out d)) { error = "请输入有效日期，或点击清空。"; return false; }
  TimeSpan ts; if (!TimeSpan.TryParseExact(Time.Text.Trim(), new[] { @"h\:mm", @"hh\:mm" }, CultureInfo.InvariantCulture, out ts) || ts.TotalHours >= 24) { error = "请输入有效时间，例如 09:30 或 18:00。"; return false; }
  value = d.Date + ts; return true;
 }
}
public class Composer : StackPanel {
 public TextBox TitleBox; public TimeField StartField, EndField; public ComboBox Quadrant; public Expander Schedule;
 public Func<string[], DateTime?, DateTime?, int, bool> AddTasks; public Action<string> Report;
 public Composer(bool compact) {
  Children.Add(Ui.T(compact ? "添加待办" : "添加任务", compact ? 11 : 13, "#61718E"));
  TitleBox = new TextBox { FontSize = compact ? 14 : 16, Padding = new Thickness(8), BorderBrush = Ui.B("#DFE5F0"), Background = compact ? Ui.B("#70FFF5DB") : Ui.B("#FFFAE9"), Margin = new Thickness(0, 5, 0, 5), ToolTip = "输入任务名称；逗号分隔可批量创建" };
  Ui.Name(TitleBox, compact ? "组件任务名称" : "任务名称"); Children.Add(TitleBox);
  var fields = new StackPanel(); StartField = new TimeField("开始", null, "09:00", compact); EndField = new TimeField("截止", null, "18:00", compact); fields.Children.Add(StartField); fields.Children.Add(EndField);
  var actions = new WrapPanel { Margin = new Thickness(0, 6, 0, 0) }; Quadrant = new ComboBox { ItemsSource = Ui.Names, SelectedIndex = 1, Width = 148, Padding = new Thickness(5), Margin = new Thickness(0, 0, 8, 5) }; Ui.Name(Quadrant, compact ? "组件新任务象限" : "新任务象限"); actions.Children.Add(Quadrant); actions.Children.Add(Ui.Button("＋ 添加", () => Submit(), true, compact)); fields.Children.Add(actions);
  if (compact) { Schedule = new Expander { Header = "开始 / 截止时间与象限", IsExpanded = true, Content = fields, FontSize = 12, Foreground = Ui.B("#526581") }; Children.Add(Schedule); } else Children.Add(fields);
  Children.Add(Ui.T(compact ? "逗号分隔批量添加 · Enter 保存" : "输入 子扬，崔京浩 可生成两个待办 · Enter 保存 · 时间可留空", 11, "#8791A6"));
  TitleBox.KeyDown += (o, e) => { if (e.Key == Key.Enter) { Submit(); e.Handled = true; } };
 }
 public bool Submit() {
  var titles = Data.Split(TitleBox.Text); if (titles.Length == 0) { TitleBox.Focus(); return false; }
  DateTime? start, end; string error;
  if (!StartField.Read(out start, out error) || !EndField.Read(out end, out error)) { if (Report != null) Report(error); return false; }
  if (!Data.ValidRange(start, end)) { if (Report != null) Report("截止时间不能早于开始时间。"); return false; }
  if (AddTasks == null || !AddTasks(titles, start, end, Quadrant.SelectedIndex)) return false;
  TitleBox.Clear(); TitleBox.Focus(); return true;
 }
}
class CardView { public TaskItem Task; public Border Border; public CheckBox Check; public bool Widget; }
// A shared, viewport-aware rubber-band selector for lists, quadrants and the desktop widget.
class MarqueeSurface : Grid {
 readonly Func<IEnumerable<CardView>> cards;
 readonly Func<HashSet<string>> readSelection;
 readonly Action<HashSet<string>> writeSelection;
 readonly Action finish;
 readonly Action<TaskItem, bool> clickTask;
 readonly Action<TaskItem> editTask;
 readonly Action clear;
 readonly Canvas overlay;
 readonly Rectangle box;
 readonly TextBlock dragLabel;
 public Func<bool> TaskDragEnabled;
 public Func<Point, int> DropTarget;
 public Func<int, Rect> DropBounds;
 public Action<string[], int> DropTasks;
 bool movingTask;
 string[] moveIds;
 Point anchor;
 bool pressed, additive;
 HashSet<string> baseline;
 TaskItem downTask;
 public bool Dragging { get; private set; }
 public MarqueeSurface(UIElement content, Func<IEnumerable<CardView>> targets, Func<HashSet<string>> read, Action<HashSet<string>> write, Action completed, Action<TaskItem, bool> click, Action<TaskItem> edit, Action clearSelection) {
  cards = targets; readSelection = read; writeSelection = write; finish = completed; clickTask = click; editTask = edit; clear = clearSelection;
  Background = Brushes.Transparent; ClipToBounds = true; Focusable = true;
  Children.Add(content);
  overlay = new Canvas { IsHitTestVisible = false, ClipToBounds = true };
  box = new Rectangle { Fill = Ui.B("#385C88F2"), Stroke = Ui.B("#5C88F2"), StrokeThickness = 1.5, RadiusX = 2, RadiusY = 2, Visibility = Visibility.Collapsed, IsHitTestVisible = false };
  overlay.Children.Add(box); Children.Add(overlay);
  dragLabel = Ui.T("", 12, "#385DA8"); dragLabel.Background = Ui.B("#EDF3FF"); dragLabel.Padding = new Thickness(9, 6, 9, 6); dragLabel.MaxWidth = 260; dragLabel.TextTrimming = TextTrimming.CharacterEllipsis; dragLabel.Visibility = Visibility.Collapsed; overlay.Children.Add(dragLabel);
  PreviewMouseLeftButtonDown += (o, e) => {
   if (Interactive(e.OriginalSource)) return;
   Point at = e.GetPosition(this); var hit = Hit(at);
   if (e.ClickCount == 2 && hit != null) { Cancel(); editTask(hit); e.Handled = true; return; }
   BeginAt(at, (Keyboard.Modifiers & (ModifierKeys.Control | ModifierKeys.Shift)) != 0);
   e.Handled = true;
  };
  PreviewMouseMove += (o, e) => { if (pressed) { MoveAt(e.GetPosition(this)); e.Handled = true; } };
  PreviewMouseLeftButtonUp += (o, e) => { if (pressed) { EndAt(e.GetPosition(this)); e.Handled = true; } };
  LostMouseCapture += (o, e) => { if (pressed) Cancel(); };
  Unloaded += (o, e) => Cancel();
 }
 bool Interactive(object original) {
  DependencyObject node = original as DependencyObject;
  while (node != null && node != this) {
   if (node is ButtonBase || node is TextBoxBase || node is ComboBox || node is ScrollBar) return true;
   node = node is Visual ? VisualTreeHelper.GetParent(node) : LogicalTreeHelper.GetParent(node);
  }
  return false;
 }
 public Rect VisibleBounds(CardView card) {
  if (!card.Border.IsVisible || card.Border.ActualWidth <= 0 || card.Border.ActualHeight <= 0) return Rect.Empty;
  Rect bounds = card.Border.TransformToAncestor(this).TransformBounds(new Rect(card.Border.RenderSize));
  DependencyObject node = VisualTreeHelper.GetParent(card.Border);
  while (node != null && node != this) {
   var viewport = node as ScrollContentPresenter;
   if (viewport != null) bounds.Intersect(viewport.TransformToAncestor(this).TransformBounds(new Rect(viewport.RenderSize)));
   node = VisualTreeHelper.GetParent(node);
  }
  bounds.Intersect(new Rect(RenderSize)); return bounds;
 }
 TaskItem Hit(Point at) { return cards().Where(x => { var r = VisibleBounds(x); return !r.IsEmpty && r.Contains(at); }).Select(x => x.Task).FirstOrDefault(); }
 public void BeginAt(Point point, bool extend) {
  Cancel(); anchor = point; additive = extend; baseline = readSelection(); downTask = Hit(point); pressed = true; Dragging = false; Focus(); CaptureMouse();
  movingTask = downTask != null && !extend && TaskDragEnabled != null && TaskDragEnabled(); moveIds = null;
 }
 public void MoveAt(Point point) {
  if (!pressed) return;
  if (!Dragging && Math.Abs(point.X - anchor.X) < 4 && Math.Abs(point.Y - anchor.Y) < 4) return;
  bool firstMove = !Dragging; Dragging = true;
  if (movingTask) {
   if (firstMove) moveIds = baseline.Contains(downTask.Id) ? baseline.ToArray() : new[] { downTask.Id };
   int target = DropTarget == null ? -1 : DropTarget(point); var bounds = target < 0 || DropBounds == null ? Rect.Empty : DropBounds(target);
   if (!bounds.IsEmpty) { Canvas.SetLeft(box, bounds.Left); Canvas.SetTop(box, bounds.Top); box.Width = bounds.Width; box.Height = bounds.Height; box.Visibility = Visibility.Visible; } else box.Visibility = Visibility.Collapsed;
   dragLabel.Text = (moveIds.Length > 1 ? moveIds.Length + " 项任务" : downTask.Title) + (target < 0 ? " · 松开取消" : " → " + Ui.Names[target]);
   Canvas.SetLeft(dragLabel, Math.Max(0, Math.Min(point.X + 12, ActualWidth - 260))); Canvas.SetTop(dragLabel, Math.Max(0, Math.Min(point.Y + 12, ActualHeight - 40))); dragLabel.Visibility = Visibility.Visible; Cursor = target < 0 ? Cursors.No : Cursors.SizeAll;
   return;
  }
  var rect = new Rect(anchor, point);
  var visible = rect; visible.Intersect(new Rect(RenderSize));
  if (!visible.IsEmpty) { Canvas.SetLeft(box, visible.Left); Canvas.SetTop(box, visible.Top); box.Width = visible.Width; box.Height = visible.Height; box.Visibility = Visibility.Visible; }
  var hits = additive ? new HashSet<string>(baseline) : new HashSet<string>();
  foreach (var card in cards()) { Rect bounds = VisibleBounds(card); if (!bounds.IsEmpty && bounds.Width > 0 && bounds.Height > 0 && rect.IntersectsWith(bounds)) hits.Add(card.Task.Id); }
  writeSelection(hits);
 }
 public void EndAt(Point point) {
  if (!pressed) return;
  if (Dragging) MoveAt(point);
  bool dragged = Dragging; int target = dragged && movingTask && DropTarget != null ? DropTarget(point) : -1; var ids = moveIds; pressed = false; Dragging = false; box.Visibility = Visibility.Collapsed; dragLabel.Visibility = Visibility.Collapsed; Cursor = null; if (IsMouseCaptured) ReleaseMouseCapture();
  if (dragged && movingTask) { if (target >= 0 && DropTasks != null) DropTasks(ids, target); }
  else if (dragged) finish(); else if (downTask != null) clickTask(downTask, additive); else if (!additive) clear();
 }
 public void Cancel() {
  if (!pressed) return;
  bool wasDragging = Dragging; pressed = false; Dragging = false; box.Visibility = Visibility.Collapsed; dragLabel.Visibility = Visibility.Collapsed; Cursor = null; if (IsMouseCaptured) ReleaseMouseCapture();
  if (wasDragging && !movingTask) { writeSelection(new HashSet<string>(baseline)); finish(); }
 }
}
public class MainWindow : Window {
 public State state;
 Composer composer, widgetComposer; TextBox search, note; TextBlock savedNote; bool noteDraftPending; StackPanel items, stickyTasks; Grid board;
 TextBlock heading, summary, status, widgetStatus; WrapPanel mainActions, widgetActions; Window sticky;
 bool exiting, selecting; string view = "列表";
 readonly HashSet<string> selected = new HashSet<string>();
 readonly List<CardView> mainCards = new List<CardView>(), widgetCards = new List<CardView>();
 readonly Stack<List<TaskItem>> undo = new Stack<List<TaskItem>>();
 Forms.NotifyIcon tray; DispatcherTimer noteDebounce, reminderTimer, clockTimer, workClockDebounce;
 TextBlock mainClock,widgetClock; TextBox mainOffWork,widgetOffWork,pendingOffWork; bool syncingWorkClock;
 readonly Dictionary<string,Button> navButtons = new Dictionary<string,Button>(); EventWaitHandle exitSignal; RegisteredWaitHandle exitWait;
 MarqueeSurface mainSurface, widgetSurface;
 CheckBox startupSwitch; TextBlock startupStatus;
 public MainWindow() {
  Title = "待办 · 把重要的事，安排好"; Width = 1160; Height = 860; MinWidth = 950; MinHeight = 760; WindowStartupLocation = WindowStartupLocation.CenterScreen; Background = new LinearGradientBrush((Color)ColorConverter.ConvertFromString("#FFF4DA"),(Color)ColorConverter.ConvertFromString("#F0E5FF"),35); FontFamily = new FontFamily("Microsoft YaHei UI"); FontSize = 14; UseLayoutRounding = true;
  Resources.Add(typeof(Button), (Style)XamlReader.Parse("<Style xmlns='http://schemas.microsoft.com/winfx/2006/xaml/presentation' TargetType='Button'><Setter Property='Template'><Setter.Value><ControlTemplate TargetType='Button'><Border x:Name='b' xmlns:x='http://schemas.microsoft.com/winfx/2006/xaml' Background='{TemplateBinding Background}' CornerRadius='8' Padding='{TemplateBinding Padding}'><ContentPresenter HorizontalAlignment='Center' VerticalAlignment='Center'/></Border><ControlTemplate.Triggers><Trigger Property='IsMouseOver' Value='True'><Setter TargetName='b' Property='Opacity' Value='0.8'/></Trigger><Trigger Property='IsPressed' Value='True'><Setter TargetName='b' Property='Opacity' Value='0.6'/></Trigger><Trigger Property='IsEnabled' Value='False'><Setter TargetName='b' Property='Opacity' Value='0.4'/></Trigger></ControlTemplate.Triggers></ControlTemplate></Setter.Value></Setter></Style>"));
  state = Data.Read(); TimeSpan validTime;if(!WorkdayClock.TryTime(state.OffWorkTime,out validTime))state.OffWorkTime="18:00";if(WorkdayClock.StartSession(state,DateTime.Now,WorkdayClock.BootSession()))Save();
  var root = new Grid(); root.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(190) }); root.ColumnDefinitions.Add(new ColumnDefinition()); Content = root;
  var side = new DockPanel { Background = Ui.B("#E7D9FA") }; root.Children.Add(side);
  var bottom = new StackPanel { Margin = new Thickness(20) }; DockPanel.SetDock(bottom, Dock.Bottom); bottom.Children.Add(Ui.T("本地保存 · 随时继续", 12, "#8791A6")); bottom.Children.Add(Ui.T("Ctrl+Z 撤销 · Esc 退出多选", 10, "#8791A6")); side.Children.Add(bottom);
  var nav = new StackPanel { Margin = new Thickness(18, 30, 12, 0) }; side.Children.Add(nav); nav.Children.Add(Ui.T("◉  待办", 28, "#7141BD")); var tag = Ui.T("把今天过成喜欢的颜色。", 12, "#8590A8"); tag.Margin = new Thickness(0, 8, 0, 32); nav.Children.Add(tag);
  foreach (var name in new[] { "列表", "四象限", "已完成" }) { string target = name; var b = Ui.Button((name == "列表" ? "☰   " : name == "四象限" ? "▦   " : "✓   ") + name, () => { ClearSelection(); view = target; Refresh(); }); b.Margin = new Thickness(0, 0, 0, 12); nav.Children.Add(b); navButtons[target]=b; }
  var widgetButton = Ui.Button("▤   桌面组件", ShowSticky); widgetButton.Margin = new Thickness(0, 24, 0, 12); nav.Children.Add(widgetButton); nav.Children.Add(Ui.Button("打开数据文件夹", () => { Directory.CreateDirectory(Data.Folder); System.Diagnostics.Process.Start(Data.Folder); }));
  nav.Children.Add(MakeWorkClock(false));
  var settingsTitle = Ui.T("设置", 11, "#8590A8"); settingsTitle.Margin = new Thickness(0, 24, 0, 10); nav.Children.Add(settingsTitle);
  startupSwitch = new CheckBox { Content = "开机自启", VerticalContentAlignment = VerticalAlignment.Center, Foreground = Ui.B("#43516B"), Cursor = Cursors.Hand, ToolTip = "开启后，登录 Windows 自动启动待办桌面组件；关闭后取消自启。" };
  startupSwitch.Style = (Style)XamlReader.Parse("<Style xmlns='http://schemas.microsoft.com/winfx/2006/xaml/presentation' TargetType='CheckBox'><Setter Property='Template'><Setter.Value><ControlTemplate TargetType='CheckBox'><StackPanel Orientation='Horizontal'><Border x:Name='track' xmlns:x='http://schemas.microsoft.com/winfx/2006/xaml' Width='36' Height='20' Background='#C5CDDD' CornerRadius='10'><Ellipse x:Name='knob' Width='14' Height='14' Margin='3' Fill='White' HorizontalAlignment='Left'/></Border><ContentPresenter Margin='8,0,0,0' VerticalAlignment='Center'/></StackPanel><ControlTemplate.Triggers><Trigger Property='IsChecked' Value='True'><Setter TargetName='track' Property='Background' Value='#5675E8'/><Setter TargetName='knob' Property='HorizontalAlignment' Value='Right'/></Trigger></ControlTemplate.Triggers></ControlTemplate></Setter.Value></Setter></Style>");
  Ui.Name(startupSwitch, "开机自启"); startupSwitch.Click += (o, e) => SetStartup(); nav.Children.Add(startupSwitch);
  startupStatus = Ui.T("", 10.5, "#8590A8"); startupStatus.Margin = new Thickness(0, 7, 0, 0); nav.Children.Add(startupStatus);
  RefreshStartup(); Activated += (o, e) => RefreshStartup();
  var main = new DockPanel { Margin = new Thickness(28, 26, 28, 18) }; Grid.SetColumn(main, 1); root.Children.Add(main);
  status = Ui.T("按住左键拖动框选任务 · 双击任务编辑", 12, "#7A87A0"); status.Margin = new Thickness(0, 12, 0, 0); DockPanel.SetDock(status, Dock.Bottom); main.Children.Add(status);
  var top = new StackPanel(); DockPanel.SetDock(top, Dock.Top); main.Children.Add(top);
  var header = new DockPanel(); var today = Ui.T(DateTime.Now.ToString("MM月dd日  dddd", CultureInfo.GetCultureInfo("zh-CN")), 12, "#8590A8"); DockPanel.SetDock(today, Dock.Right); header.Children.Add(today); heading = Ui.T("我的待办", 28); header.Children.Add(heading); top.Children.Add(header);
  summary = Ui.T("", 13, "#8590A8"); summary.Margin = new Thickness(0, 8, 0, 15); top.Children.Add(summary);
  composer = MakeComposer(false); top.Children.Add(new Border { Background = Ui.B("#DDF4DF"), CornerRadius = new CornerRadius(20), Padding = new Thickness(16), Margin = new Thickness(0, 0, 0, 13), Child = composer });
  var filter = new DockPanel { Margin = new Thickness(0, 0, 0, 8) }; search = new TextBox { Width = 190, Padding = new Thickness(7), BorderBrush = Ui.B("#E0E5EF"), ToolTip = "搜索任务（Ctrl+F）" }; Ui.Name(search, "搜索任务"); DockPanel.SetDock(search, Dock.Right); filter.Children.Add(search);
  var selectButton = Ui.Button("多选", () => { selecting = true; UpdateSelection(); }, false, true); DockPanel.SetDock(selectButton, Dock.Right); filter.Children.Add(selectButton); filter.Children.Add(Ui.T("任务清单 · 左键拖动框选", 13)); top.Children.Add(filter); search.TextChanged += (o, e) => { ClearSelection(); Refresh(); };
  mainActions = new WrapPanel { Margin = new Thickness(0, 0, 0, 8) }; top.Children.Add(mainActions);
  var content = new Grid(); mainSurface = MakeSurface(content, false); main.Children.Add(mainSurface); items = new StackPanel(); content.Children.Add(new ScrollViewer { Content = items, VerticalScrollBarVisibility = ScrollBarVisibility.Auto }); board = new Grid(); for (int i = 0; i < 2; i++) { board.RowDefinitions.Add(new RowDefinition()); board.ColumnDefinitions.Add(new ColumnDefinition()); } content.Children.Add(board);
  mainSurface.TaskDragEnabled = () => view == "四象限"; mainSurface.DropTarget = QuadrantAt; mainSurface.DropBounds = QuadrantBounds; mainSurface.DropTasks = MoveTasks;
  tray = new Forms.NotifyIcon { Icon = System.Drawing.SystemIcons.Application, Text = "待办 · 本地任务", Visible = true }; var menu = new Forms.ContextMenuStrip(); menu.Items.Add("打开待办", null, (o, e) => Dispatcher.Invoke(new Action(Restore))); menu.Items.Add("桌面组件", null, (o, e) => Dispatcher.Invoke(new Action(ShowSticky))); menu.Items.Add("退出软件", null, (o, e) => Dispatcher.Invoke(new Action(Exit))); tray.ContextMenuStrip = menu; tray.DoubleClick += (o, e) => Dispatcher.Invoke(new Action(Restore));
  Closing += (o, e) => { FlushWorkClock(); if (!exiting) { e.Cancel = true; Hide(); } else { if (noteDebounce != null) noteDebounce.Stop(); CommitNoteDraft(false); Save(); if (sticky != null) sticky.Close(); tray.Dispose(); if (reminderTimer != null) reminderTimer.Stop(); if(clockTimer!=null)clockTimer.Stop(); if (exitWait != null) exitWait.Unregister(null); if (exitSignal != null) exitSignal.Dispose(); } };
  PreviewKeyDown += HandleKeys;
  reminderTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(20) }; reminderTimer.Tick += (o, e) => Remind(); reminderTimer.Start(); clockTimer=new DispatcherTimer{Interval=TimeSpan.FromSeconds(1)};clockTimer.Tick+=(o,e)=>RefreshWorkClock();clockTimer.Start(); Loaded += (o, e) => { if (state.StickyOpen) ShowSticky(); }; Refresh();
 }
 Border MakeWorkClock(bool compact) {
  var panel=new StackPanel();var label=Ui.T("下班 / 加班计时",compact?11:12,"#705324");panel.Children.Add(label);
  var value=Ui.T(WorkdayClock.Remaining(DateTime.Now,state.OffWorkTime,state.WorkdayDate),compact?19:22,"#624119");value.FontWeight=FontWeights.SemiBold;value.Margin=new Thickness(0,4,0,6);Ui.Name(value,compact?"组件下班倒计时":"下班倒计时");panel.Children.Add(value);
  var row=new DockPanel();var input=new TextBox{Text=state.OffWorkTime,Width=60,Padding=new Thickness(5),FontSize=12,Background=Ui.B("#FFF9DF"),BorderBrush=Ui.B("#D2B56A"),ToolTip="每天的下班时间，例如 18:30（24小时制）"};Ui.Name(input,compact?"组件下班时间":"下班时间");
  Action apply=()=>CommitWorkClock(input,true);
  var save=Ui.Button("设置",apply,false,true);save.Background=Ui.B("#F3C74E");save.Foreground=Ui.B("#60431B");save.Margin=new Thickness(6,0,0,0);DockPanel.SetDock(save,Dock.Right);row.Children.Add(save);row.Children.Add(input);panel.Children.Add(row);input.KeyDown+=(o,e)=>{if(e.Key==Key.Enter){apply();e.Handled=true;}};
  input.TextChanged+=(o,e)=>{if(syncingWorkClock)return;pendingOffWork=input;if(workClockDebounce==null){workClockDebounce=new DispatcherTimer{Interval=TimeSpan.FromMilliseconds(450)};workClockDebounce.Tick+=(a,b)=>FlushWorkClock();}workClockDebounce.Stop();workClockDebounce.Start();};input.LostKeyboardFocus+=(o,e)=>{if(pendingOffWork==input)FlushWorkClock();};
  if(compact){widgetClock=value;widgetOffWork=input;}else{mainClock=value;mainOffWork=input;}
  return new Border{Background=Ui.B("#FFE79B"),CornerRadius=new CornerRadius(16),Padding=new Thickness(compact?10:12),Margin=new Thickness(0,compact?0:16,0,10),Child=panel};
 }
 bool CommitWorkClock(TextBox input,bool report){
  TimeSpan time;if(input==null||!WorkdayClock.TryTime(input.Text,out time)){if(input!=null)input.BorderBrush=Ui.B("#BE3152");if(report)Report("下班时间请输入 00:00～23:59，例如 18:30");return false;}
  string before=state.OffWorkTime;state.OffWorkTime=time.ToString(@"hh\:mm");if(state.OffWorkTime!=before&&!Save()){state.OffWorkTime=before;return false;}
  syncingWorkClock=true;try{foreach(var field in new[]{mainOffWork,widgetOffWork})if(field!=null){field.Text=state.OffWorkTime;field.BorderBrush=Ui.B("#D2B56A");}}finally{syncingWorkClock=false;}
  pendingOffWork=null;if(workClockDebounce!=null)workClockDebounce.Stop();RefreshWorkClock();if(report)Report("下班时间已保存 · 主界面与组件同步");return true;
 }
 void FlushWorkClock(){if(workClockDebounce!=null)workClockDebounce.Stop();if(pendingOffWork!=null)CommitWorkClock(pendingOffWork,false);}
 void RefreshWorkClock(){string text=WorkdayClock.Remaining(DateTime.Now,state.OffWorkTime,state.WorkdayDate);if(mainClock!=null)mainClock.Text=text;if(widgetClock!=null)widgetClock.Text=text;}
 public void EnableExitSignal() { exitSignal = new EventWaitHandle(false, EventResetMode.AutoReset, "Local\\DaibanDesktopExit"); exitWait = ThreadPool.RegisterWaitForSingleObject(exitSignal, (o, timed) => Dispatcher.BeginInvoke(new Action(Exit)), null, Timeout.Infinite, true); }
 void RefreshStartup() {
  try { bool enabled = StartupSettings.Read(); startupSwitch.IsChecked = enabled; startupStatus.Text = enabled ? "已开启 · 登录后启动组件" : "已关闭 · 点击开关开启"; }
  catch (Exception e) { startupStatus.Text = "暂时无法读取启动设置"; startupSwitch.ToolTip = e.Message; }
 }
 void SetStartup() {
  try { bool enabled = startupSwitch.IsChecked == true; StartupSettings.Set(enabled); RefreshStartup(); Report(enabled ? "已开启开机自启，下次登录 Windows 自动显示桌面组件" : "已关闭开机自启"); }
  catch (Exception e) { RefreshStartup(); Report("开机自启设置失败：" + e.Message); }
 }
 void Exit() { exiting = true; Close(); }
 void Restore() { Show(); WindowState = WindowState.Normal; Activate(); }
 void Report(string text) { status.Text = text; if (widgetStatus != null) widgetStatus.Text = text; }
 bool Save() { try { Data.Save(state); return true; } catch (Exception e) { MessageBox.Show("保存失败，请检查磁盘空间或权限。\n" + e.Message, "待办"); return false; } }
 Composer MakeComposer(bool compact) { var c = new Composer(compact); c.Report = Report; c.AddTasks = (titles, start, end, q) => Commit(() => { foreach (string title in titles) state.Tasks.Add(new TaskItem { Title = title, Start = start, End = end, Quadrant = q }); }, "已添加 " + titles.Length + " 个待办"); return c; }
 bool Commit(Action action, string message) {
  var before = state.Tasks.Select(x => x.Copy()).ToList(); action(); if (!Save()) { state.Tasks = before; Refresh(); return false; }
  undo.Push(before); selected.RemoveWhere(id => !state.Tasks.Any(x => x.Id == id)); Refresh(); Report(message + " · 已保存，可撤销"); return true;
 }
 void Undo() {
  if (undo.Count == 0) { Report("没有可撤销的操作"); return; } var current = state.Tasks; state.Tasks = undo.Pop(); if (!Save()) { undo.Push(state.Tasks); state.Tasks = current; return; }
  selected.Clear(); selecting = false; Refresh(); Report("已撤销最近一次操作");
 }
 IEnumerable<TaskItem> Filter() { return state.Tasks.Where(x => x.Done == (view == "已完成") && (String.IsNullOrWhiteSpace(search.Text) || x.Title.IndexOf(search.Text, StringComparison.CurrentCultureIgnoreCase) >= 0)).OrderBy(x => x.End ?? DateTime.MaxValue).ThenBy(x => x.Start ?? DateTime.MaxValue).ThenBy(x => x.Created); }
 void Refresh() {
  if (mainSurface != null) mainSurface.Cancel(); if (widgetSurface != null) widgetSurface.Cancel();
  foreach(var pair in navButtons){pair.Value.Background=Ui.B(pair.Key==view?"#7350D6":"#E8DFFB");pair.Value.Foreground=Ui.B(pair.Key==view?"#FFFFFF":"#554070");}
  if (items == null) return; heading.Text = view == "列表" ? "我的待办" : view; summary.Text = state.Tasks.Count(x => !x.Done) + " 件待办   ·   " + state.Tasks.Count(x => x.Done) + " 件已完成   ·   开始有安排，截止有提醒";
  mainCards.Clear(); items.Children.Clear(); board.Children.Clear(); board.Visibility = view == "四象限" ? Visibility.Visible : Visibility.Collapsed; var tasks = Filter().ToList();
  if (view == "四象限") {
   for (int q = 0; q < 4; q++) {
    int index = q; var panel = new DockPanel(); var title = Ui.T(Ui.Names[q] + "   " + tasks.Count(x => x.Quadrant == index), 14, Ui.Colors[q]); title.Margin = new Thickness(0, 0, 0, 10); DockPanel.SetDock(title, Dock.Top); panel.Children.Add(title);
    var list = new StackPanel(); foreach (var task in tasks.Where(x => x.Quadrant == index)) list.Children.Add(Card(task, true, false)); if (list.Children.Count == 0) list.Children.Add(Ui.T("把任务放在合适的位置", 12, "#A1A8B9")); panel.Children.Add(new ScrollViewer { Content = list, VerticalScrollBarVisibility = ScrollBarVisibility.Auto });
    var cell = new Border { Background = Ui.B(Ui.Tints[q]), CornerRadius = new CornerRadius(12), Padding = new Thickness(12), Margin = new Thickness(4), Child = panel, BorderBrush = Ui.B(Ui.Colors[q]), BorderThickness = new Thickness(0, 3, 0, 0) };
    Grid.SetRow(cell, q / 2); Grid.SetColumn(cell, q % 2); board.Children.Add(cell);
   }
  } else { foreach (var task in tasks) items.Children.Add(Card(task, false, false)); if (tasks.Count == 0) { var empty = new StackPanel { Margin = new Thickness(16, 30, 16, 0) }; empty.Children.Add(Ui.T("✓", 38, "#B8C5EC")); empty.Children.Add(Ui.T(String.IsNullOrWhiteSpace(search.Text) ? "这里很清爽" : "没有找到匹配的任务", 21)); items.Children.Add(empty); } }
  RefreshSticky(); UpdateSelection();
  if (view == "四象限") Report("拖动任务到其他象限 · 空白处拖动框选 · Ctrl/Shift 拖动追加框选 · Esc 取消拖动");
 }
 Rect QuadrantBounds(int quadrant) {
  if (view != "四象限" || quadrant < 0 || quadrant >= board.Children.Count) return Rect.Empty;
  var cell = board.Children[quadrant] as FrameworkElement; if (cell == null || !cell.IsVisible) return Rect.Empty;
  var bounds = cell.TransformToAncestor(mainSurface).TransformBounds(new Rect(cell.RenderSize)); bounds.Intersect(new Rect(mainSurface.RenderSize)); return bounds;
 }
 int QuadrantAt(Point point) { for (int q = 0; q < 4; q++) { var bounds = QuadrantBounds(q); if (!bounds.IsEmpty && bounds.Contains(point)) return q; } return -1; }
 static string TimeLine(TaskItem task) { return (task.Start.HasValue ? "开始 " + task.Start.Value.ToString("MM/dd HH:mm") : "开始未设置") + "   ·   " + (task.End.HasValue ? "截止 " + task.End.Value.ToString("MM/dd HH:mm") : "截止未设置"); }
 Border Card(TaskItem task, bool compact, bool widget) {
  var row = new DockPanel(); var check = new CheckBox { VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 10, 0), ToolTip = "完成任务；多选模式下选择任务" }; Ui.Name(check, (selecting ? "选择 " : "完成 ") + task.Title);
  check.Click += (o, e) => { if (selecting) Toggle(task.Id); else { bool done = !task.Done; Commit(() => { task.Done = done; }, done ? "已完成任务" : "已恢复任务"); } e.Handled = true; }; DockPanel.SetDock(check, Dock.Left); row.Children.Add(check);
  var edit = Ui.Button("编辑", () => EditTasks(new[] { task.Id }, widget), false, true); edit.Padding = new Thickness(6, 5, 6, 5); edit.Margin = new Thickness(5, 0, 0, 0); DockPanel.SetDock(edit, Dock.Right); row.Children.Add(edit);
  var text = new StackPanel(); var title = Ui.T(task.Title, compact ? 14 : 16, task.Done ? "#8F9BB0" : "#29364D"); if (task.Done) title.TextDecorations = TextDecorations.Strikethrough; text.Children.Add(title);
  bool late = !task.Done && task.End.HasValue && task.End.Value < DateTime.Now; text.Children.Add(Ui.T(TimeLine(task) + (late ? " · 已逾期" : ""), 10.5, late ? "#C95362" : "#75839D")); text.Children.Add(Ui.T(Ui.Names[task.Quadrant], 10.5, Ui.Colors[task.Quadrant])); row.Children.Add(text);
  var border = new Border { Focusable = true, CornerRadius = new CornerRadius(10), Padding = new Thickness(compact ? 9 : 12), Margin = new Thickness(0, 0, 0, 7), Child = row, BorderThickness = new Thickness(1), ToolTip = compact && !widget ? "左键拖到其他象限 · 空白处或 Ctrl/Shift 拖动框选 · 双击编辑" : "按住左键拖动框选 · Ctrl/Shift 拖动追加选择 · 双击编辑" };
  (widget ? widgetCards : mainCards).Add(new CardView { Task = task, Border = border, Check = check, Widget = widget });
  var context = new ContextMenu(); AddMenu(context, "选择 / 取消选择", () => Toggle(task.Id)); AddMenu(context, "编辑任务", () => EditTasks(new[] { task.Id }, widget));
  var move = new MenuItem { Header = "移动到象限" }; for (int q = 0; q < 4; q++) { int target = q; var item = new MenuItem { Header = Ui.Names[q] }; item.Click += (o, e) => MoveTasks(new[] { task.Id }, target); move.Items.Add(item); } context.Items.Add(move); AddMenu(context, "删除（可撤销）", () => DeleteTasks(new[] { task.Id })); border.ContextMenu = context; return border;
 }
 static void AddMenu(ContextMenu menu, string label, Action action) { var item = new MenuItem { Header = label }; item.Click += (o, e) => action(); menu.Items.Add(item); }
 MarqueeSurface MakeSurface(UIElement content, bool widget) {
  return new MarqueeSurface(content, () => widget ? widgetCards : mainCards, () => new HashSet<string>(selected),
   ids => { selected.Clear(); selected.UnionWith(ids); selecting = true; UpdateSelection(); },
   () => { UpdateSelection(); Report("已框选 " + selected.Count + " 项 · 可批量编辑、删除或移动象限"); },
   (task, extend) => { if (selecting || extend) Toggle(task.Id); },
   task => EditTasks(new[] { task.Id }, widget), ClearSelection);
 }
 void Toggle(string id) { selecting = true; if (!selected.Add(id)) selected.Remove(id); UpdateSelection(); }
 void ClearSelection() { if (mainSurface != null) mainSurface.Cancel(); if (widgetSurface != null) widgetSurface.Cancel(); selected.Clear(); selecting = false; UpdateSelection(); }
 void UpdateSelection() {
  foreach (var card in mainCards.Concat(widgetCards)) { bool chosen = selected.Contains(card.Task.Id); card.Border.Background = Ui.B(chosen ? "#C8D9E8FF" : (card.Widget ? "#85FFF5DC" : Ui.Tints[card.Task.Quadrant])); card.Border.BorderBrush = Ui.B(chosen ? "#6386ED" : "#40C8D2E5"); card.Check.IsChecked = selecting ? chosen : card.Task.Done; Ui.Name(card.Check, (selecting ? "选择 " : "完成 ") + card.Task.Title); }
  if ((mainSurface == null || !mainSurface.Dragging) && (widgetSurface == null || !widgetSurface.Dragging)) { BuildActions(mainActions, false); if (widgetActions != null) BuildActions(widgetActions, true); }
 }
 void BuildActions(WrapPanel panel, bool widget) {
  panel.Children.Clear(); panel.Visibility = selecting ? Visibility.Visible : Visibility.Collapsed; if (!selecting) return;
  var count = Ui.T("已选 " + selected.Count + " 项", 12, "#4768B5"); count.Margin = new Thickness(0, 0, 9, 5); panel.Children.Add(count);
  panel.Children.Add(Ui.Button("全选", () => { var tasks = widget ? state.Tasks.Where(x => !x.Done) : Filter(); foreach (var task in tasks) selected.Add(task.Id); UpdateSelection(); }, false, true));
  panel.Children.Add(Ui.Button("编辑", () => EditTasks(selected.ToArray(), widget), false, true)); panel.Children.Add(Ui.Button("移动象限", () => ShowMoveMenu(panel), false, true));
  panel.Children.Add(Ui.Button("完成", () => { var ids = selected.ToArray(); if (ids.Length > 0 && Commit(() => { foreach (var task in state.Tasks.Where(x => ids.Contains(x.Id))) task.Done = true; }, "已完成 " + ids.Length + " 项")) ClearSelection(); }, false, true));
  panel.Children.Add(Ui.Button("删除", () => DeleteTasks(selected.ToArray()), false, true)); panel.Children.Add(Ui.Button("撤销", Undo, false, true)); panel.Children.Add(Ui.Button("取消多选", ClearSelection, false, true));
 }
 void ShowMoveMenu(FrameworkElement target) { if (selected.Count == 0) { Report("请先选择任务"); return; } var menu = new ContextMenu { PlacementTarget = target, Placement = PlacementMode.Bottom }; for (int q = 0; q < 4; q++) { int index = q; AddMenu(menu, Ui.Names[q], () => MoveTasks(selected.ToArray(), index)); } menu.IsOpen = true; }
 void MoveTasks(string[] ids, int quadrant) { if (ids == null || ids.Length == 0 || quadrant < 0 || quadrant > 3 || !state.Tasks.Any(x => ids.Contains(x.Id) && x.Quadrant != quadrant)) return; Commit(() => { foreach (var task in state.Tasks.Where(x => ids.Contains(x.Id))) task.Quadrant = quadrant; }, "已移动 " + ids.Length + " 项至「" + Ui.Names[quadrant] + "」"); }
 void DeleteTasks(string[] ids) { if (ids.Length == 0) return; Commit(() => state.Tasks.RemoveAll(x => ids.Contains(x.Id)), "已删除 " + ids.Length + " 项，Ctrl+Z 或撤销按钮可恢复"); }
 void HandleKeys(object sender, KeyEventArgs e) {
  if (e.Key == Key.Escape) { ClearSelection(); e.Handled = true; return; }
  if (Keyboard.Modifiers == ModifierKeys.Control && e.Key == Key.N) { if (sender == sticky) widgetComposer.TitleBox.Focus(); else composer.TitleBox.Focus(); e.Handled = true; return; }
  if (Keyboard.Modifiers == ModifierKeys.Control && e.Key == Key.F) { Restore(); search.Focus(); e.Handled = true; return; }
  if (Keyboard.FocusedElement is TextBoxBase) return;
  if (Keyboard.Modifiers == ModifierKeys.Control && e.Key == Key.Z) { Undo(); e.Handled = true; }
  else if (Keyboard.Modifiers == ModifierKeys.Control && e.Key == Key.A) { selecting = true; foreach (var task in sender == sticky ? state.Tasks.Where(x => !x.Done) : Filter()) selected.Add(task.Id); UpdateSelection(); e.Handled = true; }
  else if (e.Key == Key.Delete && selecting) { DeleteTasks(selected.ToArray()); e.Handled = true; }
  else if (Keyboard.Modifiers == ModifierKeys.Control && e.Key == Key.N) { if (sender == sticky) widgetComposer.TitleBox.Focus(); else composer.TitleBox.Focus(); e.Handled = true; }
  else if (Keyboard.Modifiers == ModifierKeys.Control && e.Key == Key.F) { Restore(); search.Focus(); e.Handled = true; }
 }
 bool ApplyEdit(string[] ids, string title, bool useStart, DateTime? start, bool useEnd, DateTime? end, bool useQuadrant, int q, out string error) {
  error = null; var tasks = state.Tasks.Where(x => ids.Contains(x.Id)).ToList(); if (tasks.Count == 0) { error = "任务已不存在"; return false; } if (tasks.Count == 1 && String.IsNullOrWhiteSpace(title)) { error = "请填写任务名称"; return false; }
  foreach (var task in tasks) if (!Data.ValidRange(useStart ? start : task.Start, useEnd ? end : task.End)) { error = "「" + task.Title + "」的截止时间不能早于开始时间。"; return false; }
  return Commit(() => { foreach (var task in tasks) { if (tasks.Count == 1) task.Title = title.Trim(); if (useStart && task.Start != start) { task.Start = start; task.Notified = false; } if (useEnd && task.End != end) { task.End = end; task.EndNotified = false; } if (useQuadrant) task.Quadrant = q; } }, "已更新 " + tasks.Count + " 项任务");
 }
 Window CreateEditor(string[] ids, bool widget) {
  var tasks = state.Tasks.Where(x => ids.Contains(x.Id)).ToList(); if (tasks.Count == 0) return null; bool bulk = tasks.Count > 1; var first = tasks[0]; Window owner = widget && sticky != null ? sticky : this;
  var w = new Window { Title = bulk ? "批量编辑 " + tasks.Count + " 个待办" : "编辑待办", Width = 470, Height = 475, ResizeMode = ResizeMode.NoResize, Owner = owner, Topmost = owner.Topmost, WindowStartupLocation = WindowStartupLocation.CenterOwner, Background = Ui.B("#F6F7FB"), FontFamily = FontFamily, Resources = Resources };
  var p = new StackPanel { Margin = new Thickness(22) }; w.Content = p; p.Children.Add(Ui.T(bulk ? "只修改勾选的字段，其他内容保持不变" : "任务名称", 13, "#61718E"));
  var title = new TextBox { Text = first.Title, Padding = new Thickness(8), Margin = new Thickness(0, 8, 0, 12), Visibility = bulk ? Visibility.Collapsed : Visibility.Visible }; Ui.Name(title, "编辑任务名称"); p.Children.Add(title);
  var useStart = new CheckBox { Content = bulk ? "修改开始时间（日期留空可清除）" : "开始时间（可留空）", IsChecked = !bulk, Margin = new Thickness(0, 9, 0, 2) }; p.Children.Add(useStart); var start = new TimeField("开始", first.Start, "09:00"); p.Children.Add(start);
  var useEnd = new CheckBox { Content = bulk ? "修改截止时间（日期留空可清除）" : "截止时间（可留空）", IsChecked = !bulk, Margin = new Thickness(0, 9, 0, 2) }; p.Children.Add(useEnd); var end = new TimeField("截止", first.End, "18:00"); p.Children.Add(end);
  var useQ = new CheckBox { Content = "修改象限", IsChecked = !bulk, Margin = new Thickness(0, 9, 0, 4) }; p.Children.Add(useQ); var q = new ComboBox { ItemsSource = Ui.Names, SelectedIndex = first.Quadrant, Padding = new Thickness(6) }; Ui.Name(q, "编辑象限"); p.Children.Add(q);
  Action sync = () => { start.IsEnabled = useStart.IsChecked == true; end.IsEnabled = useEnd.IsChecked == true; q.IsEnabled = useQ.IsChecked == true; }; useStart.Click += (o, e) => sync(); useEnd.Click += (o, e) => sync(); useQ.Click += (o, e) => sync(); sync();
  var errorLabel = Ui.T("", 12, "#C95362"); errorLabel.Margin = new Thickness(0, 10, 0, 8); p.Children.Add(errorLabel); var actions = new WrapPanel(); p.Children.Add(actions);
  actions.Children.Add(Ui.Button("保存", () => { DateTime? a = null, b = null; string error; if (useStart.IsChecked == true && !start.Read(out a, out error)) { errorLabel.Text = error; return; } if (useEnd.IsChecked == true && !end.Read(out b, out error)) { errorLabel.Text = error; return; } if (bulk && useStart.IsChecked != true && useEnd.IsChecked != true && useQ.IsChecked != true) { errorLabel.Text = "请勾选至少一个要修改的字段。"; return; } if (ApplyEdit(ids, title.Text, useStart.IsChecked == true, a, useEnd.IsChecked == true, b, useQ.IsChecked == true, q.SelectedIndex, out error)) w.Close(); else errorLabel.Text = error ?? "保存失败"; }, true));
  actions.Children.Add(Ui.Button("删除", () => { DeleteTasks(ids); w.Close(); })); actions.Children.Add(Ui.Button("取消", () => w.Close())); return w;
 }
 void EditTasks(string[] ids, bool widget) { var editor = CreateEditor(ids, widget); if (editor != null) editor.ShowDialog(); }
 void Remind() {
  var now = DateTime.Now; var starts = state.Tasks.Where(x => !x.Done && !x.Notified && x.Start.HasValue && x.Start <= now).ToList(); var ends = state.Tasks.Where(x => !x.Done && !x.EndNotified && x.End.HasValue && x.End <= now).ToList();
  if (starts.Count + ends.Count > 0) { string text = (starts.Count > 0 ? "开始：" + String.Join("、", starts.Take(3).Select(x => x.Title)) : "") + (ends.Count > 0 ? "\n截止：" + String.Join("、", ends.Take(3).Select(x => x.Title)) : ""); tray.ShowBalloonTip(5000, ends.Count > 0 ? "待办截止提醒" : "待办开始提醒", text.Trim(), Forms.ToolTipIcon.Info); starts.ForEach(x => x.Notified = true); ends.ForEach(x => x.EndNotified = true); Save(); Refresh(); }
 }
 void ShowSticky() {
  if (sticky != null) { sticky.Show(); sticky.Activate(); return; } state.StickyOpen = true;
  sticky = new Window { Title = "待办 · 桌面组件", Width = Math.Max(370, Math.Min(600, state.NoteWidth)), Height = Math.Max(640, Math.Min(SystemParameters.WorkArea.Height, state.NoteHeight)), MinWidth = 370, MinHeight = 640, WindowStyle = WindowStyle.None, AllowsTransparency = true, Background = Brushes.Transparent, ResizeMode = ResizeMode.CanResizeWithGrip, ShowInTaskbar = false, Topmost = state.Pin, FontFamily = FontFamily, UseLayoutRounding = true, Resources = Resources };
  sticky.Left = Math.Max(SystemParameters.VirtualScreenLeft, Math.Min(state.NoteLeft, SystemParameters.VirtualScreenLeft + SystemParameters.VirtualScreenWidth - sticky.Width)); sticky.Top = Math.Max(SystemParameters.VirtualScreenTop, Math.Min(state.NoteTop, SystemParameters.VirtualScreenTop + SystemParameters.VirtualScreenHeight - sticky.Height));
  var glass = new SolidColorBrush(Color.FromArgb((byte)(255 * Math.Max(.25, Math.Min(.95, state.WidgetOpacity))), 242, 226, 255)); var shell = new Border { CornerRadius = new CornerRadius(20), Background = glass, BorderBrush = Ui.B("#80FFFFFF"), BorderThickness = new Thickness(1), Padding = new Thickness(16) }; sticky.Content = shell; var p = new DockPanel(); shell.Child = p;
  var top = new StackPanel(); DockPanel.SetDock(top, Dock.Top); p.Children.Add(top);
  var header = new DockPanel { Background = Brushes.Transparent, Cursor = Cursors.SizeAll, Margin = new Thickness(0, 0, 0, 10) }; var close = Ui.Button("×", () => sticky.Close(), false, true); close.Padding = new Thickness(8, 2, 8, 2); close.Margin = new Thickness(0); close.Background = Brushes.Transparent; close.ToolTip = "隐藏组件"; DockPanel.SetDock(close, Dock.Right); header.Children.Add(close);
  var dragTitle = Ui.T("◉  待办", 22, "#374B7B"); dragTitle.ToolTip = "拖动标题移动组件"; dragTitle.MouseLeftButtonDown += (o, e) => { if (e.ButtonState == MouseButtonState.Pressed) sticky.DragMove(); }; header.Children.Add(dragTitle); top.Children.Add(header);
  var settings = new DockPanel { Margin = new Thickness(0, 0, 0, 8) }; var pin = new CheckBox { Content = "置顶", IsChecked = state.Pin, VerticalAlignment = VerticalAlignment.Center }; pin.Click += (o, e) => { state.Pin = pin.IsChecked == true; sticky.Topmost = state.Pin; Save(); }; DockPanel.SetDock(pin, Dock.Right); settings.Children.Add(pin); settings.Children.Add(Ui.T("透明度", 11, "#61718E")); var alpha = new Slider { Minimum = 25, Maximum = 95, Value = state.WidgetOpacity * 100, Width = 110, Margin = new Thickness(8, 0, 12, 0), VerticalAlignment = VerticalAlignment.Center, ToolTip = "向左更透明，文字保持清晰" }; Ui.Name(alpha, "组件背景不透明度"); settings.Children.Add(alpha); top.Children.Add(settings); top.Children.Add(MakeWorkClock(true));
  noteDebounce = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(500) }; noteDebounce.Tick += (o, e) => { noteDebounce.Stop(); CommitNoteDraft(false); Save(); }; Action scheduleSave = () => { noteDebounce.Stop(); noteDebounce.Start(); }; alpha.ValueChanged += (o, e) => { state.WidgetOpacity = alpha.Value / 100; glass.Color = Color.FromArgb((byte)(255 * state.WidgetOpacity), 240, 245, 255); scheduleSave(); };
  var noteExpander = new Expander { Header = "随手记", IsExpanded = sticky.Height>=720, FontSize = 12, Foreground = Ui.B("#61718E"), Margin = new Thickness(0, 0, 0, 8) }; var notePanel = new StackPanel();
  note = new TextBox { Text = "", AcceptsReturn = true, TextWrapping = TextWrapping.Wrap, Height = 55, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, Background = Brushes.Transparent, Foreground = Ui.B("#283A59"), BorderThickness = new Thickness(0), FontSize = 14, ToolTip = "输入新随手记；4 个字符起覆盖下方记录，标点计数，短内容不覆盖。Ctrl+Enter 保存并清空输入。" }; Ui.Name(note, "随手记输入"); noteDraftPending = false;
  note.TextChanged += (o, e) => { noteDraftPending = true; scheduleSave(); }; note.KeyDown += (o, e) => { if (e.Key == Key.Enter && Keyboard.Modifiers == ModifierKeys.Control) { CommitNoteDraft(true); Save(); e.Handled = true; } }; notePanel.Children.Add(note);
  var noteActions = new DockPanel(); var saveNoteButton = Ui.Button("保存记录", () => { CommitNoteDraft(true); Save(); }, false, true); DockPanel.SetDock(saveNoteButton, Dock.Right); noteActions.Children.Add(saveNoteButton); noteActions.Children.Add(Ui.T("4 字起覆盖 · 只保留一条", 10, "#8791A6")); notePanel.Children.Add(noteActions);
  savedNote = Ui.T(String.IsNullOrEmpty(state.Note) ? "暂无保存记录" : state.Note, 13, "#465A7D"); savedNote.TextWrapping = TextWrapping.Wrap; Ui.Name(savedNote, "已保存随手记"); notePanel.Children.Add(new Border { Background = Ui.B("#38FFFFFF"), CornerRadius = new CornerRadius(8), Padding = new Thickness(8), Margin = new Thickness(0, 4, 0, 3), Child = new ScrollViewer { Content = savedNote, MaxHeight = 90, VerticalScrollBarVisibility = ScrollBarVisibility.Auto } }); noteExpander.Content = notePanel; top.Children.Add(noteExpander);
  var listHeading = new DockPanel(); var multi = Ui.Button("多选", () => { selecting = true; UpdateSelection(); }, false, true); DockPanel.SetDock(multi, Dock.Right); listHeading.Children.Add(multi); listHeading.Children.Add(Ui.T("待办清单 · 左键拖动框选 / 双击编辑", 11, "#61718E")); top.Children.Add(listHeading); widgetActions = new WrapPanel { Margin = new Thickness(0, 0, 0, 5) }; top.Children.Add(widgetActions);
  var footer = new StackPanel { Margin = new Thickness(0, 8, 0, 0) }; DockPanel.SetDock(footer, Dock.Bottom); p.Children.Add(footer); widgetComposer = MakeComposer(true); widgetComposer.Schedule.IsExpanded=false; footer.Children.Add(widgetComposer);
  var open = Ui.Button("打开完整清单  ↗", Restore, false, true); open.Background = Ui.B("#45FFFFFF"); open.Margin = new Thickness(0, 8, 0, 0); footer.Children.Add(open); widgetStatus = Ui.T("按住左键拖出选框，选中范围内的任务", 10.5, "#61718E"); widgetStatus.Margin = new Thickness(0, 7, 0, 0); footer.Children.Add(widgetStatus);
  stickyTasks = new StackPanel(); widgetSurface = MakeSurface(new ScrollViewer { Content = stickyTasks, VerticalScrollBarVisibility = ScrollBarVisibility.Auto }, true); p.Children.Add(widgetSurface); sticky.PreviewKeyDown += HandleKeys;
  sticky.LocationChanged += (o, e) => { state.NoteLeft = sticky.Left; state.NoteTop = sticky.Top; scheduleSave(); }; sticky.SizeChanged += (o, e) => { state.NoteWidth = sticky.Width; state.NoteHeight = sticky.Height; scheduleSave(); };
  sticky.SizeChanged+=(o,e)=>{if(e.NewSize.Height<720)noteExpander.IsExpanded=false;};
  sticky.Closing += (o, e) => { FlushWorkClock(); widgetSurface.Cancel(); widgetSurface = null; noteDebounce.Stop(); CommitNoteDraft(false); state.NoteLeft = sticky.Left; state.NoteTop = sticky.Top; state.NoteWidth = sticky.Width; state.NoteHeight = sticky.Height; if (!exiting) state.StickyOpen = false; Save(); note = null; savedNote = null; widgetClock = null; widgetOffWork = null; noteDraftPending = false; sticky = null; stickyTasks = null; widgetActions = null; widgetStatus = null; widgetCards.Clear(); }; RefreshSticky(); UpdateSelection(); sticky.Show(); Save();
 }
 static bool ValidNote(string text) { var reader = StringInfo.GetTextElementEnumerator(text ?? ""); int count = 0; while (reader.MoveNext()) if (!String.IsNullOrWhiteSpace(reader.GetTextElement())) count++; return count > 3; }
 void CommitNoteDraft(bool clear) { if (note == null || !noteDraftPending || !ValidNote(note.Text)) return; state.Note = note.Text.Trim(); noteDraftPending = false; if (savedNote != null) savedNote.Text = state.Note; if (clear) { note.Clear(); noteDraftPending = false; } }
 public void OvertimeRestartTest(string stage){ShowSticky();if(stage=="write"){state.WorkdayDate=DateTime.Today.AddDays(-1);state.WorkBootSession=WorkdayClock.BootSession();state.OffWorkTime="19:00";Save();RefreshWorkClock();Snapshot(this,"overtime-main.png");Snapshot(sticky,"overtime-widget.png");Exit();return;}if(stage=="read"){Assert(state.WorkdayDate==DateTime.Today.AddDays(-1),"app restart keeps original workday");Assert(WorkdayClock.Remaining(DateTime.Today.AddHours(12),state.OffWorkTime,state.WorkdayDate)=="已加班 17小时0分钟","next noon is 17 hours overtime");Assert(mainClock.Text==widgetClock.Text,"main and widget overtime sync");state.WorkBootSession="test:previous-computer-boot";Save();Exit();return;}Assert(state.WorkdayDate==DateTime.Today&&state.OffWorkTime=="19:00","new boot resets workday but keeps configured time");File.WriteAllText(Path.Combine(Data.Folder,"overtime-restart-pass.txt"),"PASS: separate processes preserve overtime workday across app restart; next noon shows 17 hours; changed boot identity resets workday and preserves target time. Computer power cycling was simulated, not performed.");Exit();}
 public void ClockRestartTest(string stage){ShowSticky();if(stage=="write"){mainOffWork.Text="21:47";Exit();return;}if(stage=="widget"){Assert(state.OffWorkTime=="21:47"&&mainOffWork.Text=="21:47"&&widgetOffWork.Text=="21:47","main input survived full process restart");widgetOffWork.Text="22:13";Exit();return;}Assert(state.OffWorkTime=="22:13"&&mainOffWork.Text=="22:13"&&widgetOffWork.Text=="22:13","widget input survived full process restart");File.WriteAllText(Path.Combine(Data.Folder,"clock-restart-pass.txt"),"PASS: three separate processes preserve main and widget time edits on immediate full exit without clicking Save; restored inputs and countdown agree.");Exit();}
 public void NoteRestartTest(bool write) { ShowSticky(); if (write) { note.Text = "关闭前保存！"; Exit(); } else { Assert(state.Note == "关闭前保存！" && note.Text == "" && savedNote.Text == state.Note, "complete process restart preserves record outside empty input"); File.WriteAllText(Path.Combine(Data.Folder, "note-restart-pass.txt"), "PASS: full exit flushes pending note, process restart shows one saved record below an empty input."); Exit(); } }
 void RefreshSticky() { widgetCards.Clear(); if (stickyTasks == null) return; stickyTasks.Children.Clear(); foreach (var task in state.Tasks.Where(x => !x.Done).OrderBy(x => x.End ?? DateTime.MaxValue).ThenBy(x => x.Start ?? DateTime.MaxValue).ThenBy(x => x.Created)) stickyTasks.Children.Add(Card(task, true, true)); if (stickyTasks.Children.Count == 0) stickyTasks.Children.Add(Ui.T("清单已清空，在下方添加新任务。", 12, "#61718E")); }

 // Integration checks exercise the same gesture controller and commands as the installed UI.
 public void UiTest() {
  Assert(!StartupSettings.Read(), "startup test initially disabled"); startupSwitch.IsChecked = true; startupSwitch.RaiseEvent(new RoutedEventArgs(ButtonBase.ClickEvent)); Assert(StartupSettings.Read() && startupStatus.Text.Contains("已开启"), "startup switch enables"); startupSwitch.IsChecked = false; startupSwitch.RaiseEvent(new RoutedEventArgs(ButtonBase.ClickEvent)); Assert(!StartupSettings.Read() && startupStatus.Text.Contains("已关闭"), "startup switch disables");
  composer.TitleBox.Text = "子扬，崔京浩"; composer.StartField.Date.SelectedDate = DateTime.Today; composer.StartField.Time.Text = "09:30"; composer.EndField.Date.SelectedDate = DateTime.Today; composer.EndField.Time.Text = "18:00";
  Assert(composer.Submit() && state.Tasks.Count == 2, "main batch create"); Assert(state.Tasks.All(x => x.Start == DateTime.Today.AddHours(9.5) && x.End == DateTime.Today.AddHours(18)), "main dates");
  ShowSticky(); widgetComposer.TitleBox.Text = "组件任务一，组件任务二"; widgetComposer.StartField.Date.SelectedDate = DateTime.Today; widgetComposer.StartField.Time.Text = "10:00"; widgetComposer.EndField.Date.SelectedDate = DateTime.Today; widgetComposer.EndField.Time.Text = "20:00";
  Assert(widgetComposer.Submit() && state.Tasks.Count == 4, "widget batch create"); var widgetIds = state.Tasks.Where(x => x.Title.StartsWith("组件")).Select(x => x.Id).ToArray(); Assert(widgetIds.Length == 2 && state.Tasks.Where(x => widgetIds.Contains(x.Id)).All(x => x.End == DateTime.Today.AddHours(20)), "widget dates");
  widgetComposer.EndField.Time.Text = "08:00"; widgetComposer.TitleBox.Text = "无效范围"; Assert(!widgetComposer.Submit() && state.Tasks.Count == 4, "reject reversed range"); widgetComposer.TitleBox.Clear();
  state.Note = "之前的记录"; savedNote.Text = state.Note; foreach (var draft in new[] { "", "字", "文字", "文字。", "   " }) { note.Text = draft; CommitNoteDraft(false); Assert(state.Note == "之前的记录", "short drafts preserve previous record"); } note.Text = "新的记。"; CommitNoteDraft(true); Assert(state.Note == "新的记。" && note.Text == "" && savedNote.Text == state.Note, "four characters including punctuation replace one record and clear input"); note.Text = "关闭保存！"; sticky.Close(); Assert(Data.Read().Note == "关闭保存！", "widget close flushes valid draft before debounce"); ShowSticky(); Assert(note.Text == "" && savedNote.Text == "关闭保存！", "reopen keeps saved record below empty input");
  mainOffWork.Text="19:35";((DockPanel)mainOffWork.Parent).Children.OfType<Button>().First().RaiseEvent(new RoutedEventArgs(ButtonBase.ClickEvent));Assert(state.OffWorkTime=="19:35"&&widgetOffWork.Text=="19:35"&&Data.Read().OffWorkTime=="19:35","main countdown setting sync and persistence");mainOffWork.Text="25:00";((DockPanel)mainOffWork.Parent).Children.OfType<Button>().First().RaiseEvent(new RoutedEventArgs(ButtonBase.ClickEvent));Assert(state.OffWorkTime=="19:35","invalid clock input preserves target");widgetOffWork.Text="18:20";((DockPanel)widgetOffWork.Parent).Children.OfType<Button>().First().RaiseEvent(new RoutedEventArgs(ButtonBase.ClickEvent));Assert(mainOffWork.Text=="18:20"&&mainClock.Text==widgetClock.Text&&Data.Read().OffWorkTime=="18:20","widget countdown setting sync and persistence");
  TestQuadrantDrag(); TestMarqueeSurfaces();
  var ids = selected.ToArray(); MoveTasks(ids, 0); Assert(state.Tasks.Where(x => ids.Contains(x.Id)).All(x => x.Quadrant == 0), "bulk quadrant");
  string error; Assert(ApplyEdit(ids, "", true, DateTime.Today.AddHours(11), true, DateTime.Today.AddHours(21), false, 0, out error), "bulk time edit"); Assert(state.Tasks.Where(x => ids.Contains(x.Id)).All(x => x.Start == DateTime.Today.AddHours(11) && x.End == DateTime.Today.AddHours(21)), "bulk times applied"); Assert(!ApplyEdit(ids, "", true, DateTime.Today.AddDays(1), false, null, false, 0, out error), "partial edit validation");
  DeleteTasks(ids); Assert(state.Tasks.Count == 2, "bulk delete"); Undo(); Assert(state.Tasks.Count == 4, "undo restores batch");
  var actualEditor = CreateEditor(ids, true); actualEditor.Show(); Pump(50); var editPanel = (StackPanel)actualEditor.Content;
  var endToggle = editPanel.Children.OfType<CheckBox>().ElementAt(1); endToggle.IsChecked = true; endToggle.RaiseEvent(new RoutedEventArgs(ButtonBase.ClickEvent));
  var actualEnd = editPanel.Children.OfType<TimeField>().ElementAt(1); actualEnd.Date.SelectedDate = DateTime.Today.AddDays(1); actualEnd.Time.Text = "22:30";
  editPanel.Children.OfType<WrapPanel>().Last().Children.OfType<Button>().First().RaiseEvent(new RoutedEventArgs(ButtonBase.ClickEvent));
  Assert(!actualEditor.IsVisible && state.Tasks.Where(x => ids.Contains(x.Id)).All(x => x.End == DateTime.Today.AddDays(1).AddHours(22.5) && x.Start == DateTime.Today.AddHours(11)), "bulk editor saves only enabled end field"); Undo();
  actualEditor = CreateEditor(new[] { ids[0] }, true); actualEditor.Show(); Pump(50); editPanel = (StackPanel)actualEditor.Content;
  editPanel.Children.OfType<TextBox>().First().Text = "组件内编辑名称"; actualEnd = editPanel.Children.OfType<TimeField>().ElementAt(1); actualEnd.Date.SelectedDate = null; actualEnd.Date.Text = "";
  editPanel.Children.OfType<WrapPanel>().Last().Children.OfType<Button>().First().RaiseEvent(new RoutedEventArgs(ButtonBase.ClickEvent));
  Assert(state.Tasks.First(x => x.Id == ids[0]).Title == "组件内编辑名称" && !state.Tasks.First(x => x.Id == ids[0]).End.HasValue, "single editor renames and clears deadline"); Undo();
  ClearSelection();
  var saved = Data.Read(); Assert(saved.Tasks.Count == 4 && saved.Tasks.Any(x => x.End.HasValue), "date persistence"); view = "列表"; Refresh(); Snapshot(this, "list.png"); view = "四象限"; Refresh(); Snapshot(this, "quadrants.png"); Toggle(state.Tasks[0].Id); Toggle(state.Tasks[1].Id); Snapshot(sticky, "sticky.png"); Snapshot(this, "selection.png"); Width=950;Height=760;Snapshot(this,"compact-main.png");sticky.Height=640;Snapshot(sticky,"compact-sticky.png");
  var editor = CreateEditor(new[] { state.Tasks[0].Id }, true); editor.Show(); Pump(100); Snapshot(editor, "editor.png"); editor.Close(); editor = CreateEditor(selected.ToArray(), true); editor.Show(); Pump(100); Snapshot(editor, "bulk-editor.png"); editor.Close();
  File.WriteAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "ui-test-result.txt"), "PASS: countdown main/widget settings sync, invalid input rejection and persistence; one saved note below empty input, four-character threshold, punctuation, short-draft preservation and close flush; left-button cross-quadrant drag (12 directions), empty targets, group move, cancellation, no-op, undo and disk persistence; startup switch enable/disable UI; main list, quadrants and widget rectangular selection; reverse-direction and shrinking rectangles; Ctrl/Shift additive selection; viewport clipping; no selection from stationary hold; marquee cancellation; batch start/end creation/editing, range validation, delete/undo, quadrant moves, old data and persistence."); Exit();
 }
 void TestQuadrantDrag() {
  var original = state.Tasks.Select(x => x.Copy()).ToList(); string id = state.Tasks[0].Id;
  for (int from = 0; from < 4; from++) for (int to = 0; to < 4; to++) {
   if (from == to) continue;
   ClearSelection(); state.Tasks.First(x => x.Id == id).Quadrant = from; view = "四象限"; Refresh(); UpdateLayout();
   var card = mainCards.First(x => x.Task.Id == id); var rect = mainSurface.VisibleBounds(card); var target = QuadrantBounds(to); var start = new Point(rect.Left + rect.Width / 2, rect.Top + rect.Height / 2); var end = new Point(target.Left + target.Width / 2, target.Top + target.Height / 2);
   int count = undo.Count; mainSurface.BeginAt(start, false); mainSurface.MoveAt(end); Assert(mainSurface.Dragging && state.Tasks.First(x => x.Id == id).Quadrant == from, "drag is pending until release"); mainSurface.EndAt(end);
   Assert(state.Tasks.First(x => x.Id == id).Quadrant == to && undo.Count == count + 1 && !selecting && selected.Count == 0, "left-button quadrant drop " + from + " to " + to);
   Assert(Data.Read().Tasks.First(x => x.Id == id).Quadrant == to, "drop persists to disk"); Undo(); Assert(state.Tasks.First(x => x.Id == id).Quadrant == from, "drop undo");
  }
  ClearSelection(); foreach (var task in state.Tasks) task.Quadrant = 0; Refresh(); UpdateLayout();
  var first = mainSurface.VisibleBounds(mainCards.First(x => x.Task.Id == id)); var at = new Point(first.Left + first.Width / 2, first.Top + first.Height / 2); int before = undo.Count;
  mainSurface.BeginAt(at, false); mainSurface.MoveAt(new Point(at.X + 8, at.Y)); mainSurface.EndAt(new Point(at.X + 8, at.Y)); Assert(undo.Count == before, "same quadrant is a no-op");
  ClearSelection(); UpdateLayout(); mainSurface.BeginAt(at, false); mainSurface.MoveAt(new Point(-15, -15)); mainSurface.EndAt(new Point(-15, -15)); Assert(undo.Count == before && state.Tasks.First(x => x.Id == id).Quadrant == 0, "outside board cancels drop");
  ClearSelection(); UpdateLayout(); var empty = QuadrantBounds(3); var into = new Point(empty.Left + empty.Width / 2, empty.Top + empty.Height / 2);
  mainSurface.BeginAt(at, false); mainSurface.MoveAt(into); mainSurface.Cancel(); Assert(undo.Count == before && state.Tasks.First(x => x.Id == id).Quadrant == 0, "cancel drag keeps task");
  ClearSelection(); selected.Add(id); selected.Add(state.Tasks[1].Id); selecting = true; UpdateSelection(); UpdateLayout(); first = mainSurface.VisibleBounds(mainCards.First(x => x.Task.Id == id)); at = new Point(first.Left + first.Width / 2, first.Top + first.Height / 2); empty = QuadrantBounds(3); into = new Point(empty.Left + empty.Width / 2, empty.Top + empty.Height / 2);
  var ids = selected.ToArray(); mainSurface.BeginAt(at, false); mainSurface.MoveAt(into); mainSurface.EndAt(into); Assert(state.Tasks.Where(x => ids.Contains(x.Id)).All(x => x.Quadrant == 3), "drag selection to empty quadrant");
  Assert(widgetCards.Where(x => ids.Contains(x.Task.Id)).All(x => x.Task.Quadrant == 3), "widget receives moved task properties"); Undo(); Assert(state.Tasks.Where(x => ids.Contains(x.Id)).All(x => x.Quadrant == 0), "group move undo");
  state.Tasks = original; undo.Clear(); ClearSelection(); view = "列表"; Refresh(); Save();
 }
 void TestMarqueeSurfaces() {
  ClearSelection(); UpdateLayout(); sticky.UpdateLayout(); Pump(80);
  var a = mainSurface.VisibleBounds(mainCards[0]); var b = mainSurface.VisibleBounds(mainCards[1]);
  var firstIds = new HashSet<string>(mainCards.Take(2).Select(x => x.Task.Id));
  var start = new Point(a.Left + 3, a.Top + 3); var end = new Point(b.Right - 3, b.Bottom - 3);
  mainSurface.BeginAt(start, false); Pump(520); Assert(!selecting && selected.Count == 0, "stationary hold does not select");
  mainSurface.MoveAt(end); Assert(mainSurface.Dragging && selected.SetEquals(firstIds), "main drag rectangle hits exactly two rows"); Snapshot(this, "main-marquee.png");
  mainSurface.EndAt(end); Assert(selected.SetEquals(firstIds), "release keeps box selection");
  ClearSelection(); UpdateLayout(); a = mainSurface.VisibleBounds(mainCards[0]); b = mainSurface.VisibleBounds(mainCards[1]);
  mainSurface.BeginAt(new Point(b.Right - 3, b.Bottom - 3), false); mainSurface.MoveAt(new Point(a.Left + 3, a.Top + 3)); mainSurface.EndAt(new Point(a.Left + 3, a.Top + 3)); Assert(selected.SetEquals(firstIds), "reverse direction box");
  ClearSelection(); UpdateLayout(); a = mainSurface.VisibleBounds(mainCards[0]); b = mainSurface.VisibleBounds(mainCards[2]);
  start = new Point(a.Left + 3, a.Top + 3); mainSurface.BeginAt(start, false); mainSurface.MoveAt(new Point(b.Right - 3, b.Bottom - 3)); Assert(selected.Count == 3, "growing selection rectangle");
  end = new Point(a.Right - 3, a.Bottom - 3); mainSurface.MoveAt(end); Assert(selected.SetEquals(new[] { mainCards[0].Task.Id }), "shrinking rectangle removes outside rows"); mainSurface.EndAt(end);
  UpdateLayout(); var extra = mainCards[2]; b = mainSurface.VisibleBounds(extra); mainSurface.BeginAt(new Point(b.Left + 3, b.Top + 3), true); end = new Point(b.Right - 3, b.Bottom - 3); mainSurface.MoveAt(end); mainSurface.EndAt(end); Assert(selected.SetEquals(new[] { mainCards[0].Task.Id, extra.Task.Id }), "modifier additive selection");
  var previous = new HashSet<string>(selected); UpdateLayout(); a = mainSurface.VisibleBounds(mainCards[0]); b = mainSurface.VisibleBounds(mainCards[1]); mainSurface.BeginAt(new Point(a.Left + 3, a.Top + 3), false); mainSurface.MoveAt(new Point(b.Right - 3, b.Bottom - 3)); mainSurface.Cancel(); Assert(selected.SetEquals(previous), "cancel restores original selection");
  ClearSelection(); UpdateLayout(); sticky.UpdateLayout(); a = widgetSurface.VisibleBounds(widgetCards[0]); b = widgetSurface.VisibleBounds(widgetCards[1]);
  var widgetIds = new HashSet<string>(widgetCards.Take(2).Select(x => x.Task.Id)); start = new Point(a.Left + 3, a.Top + 3); end = new Point(b.Right - 3, b.Bottom - 3);
  widgetSurface.BeginAt(start, false); widgetSurface.MoveAt(end); Assert(selected.SetEquals(widgetIds), "widget rectangular selection"); Snapshot(sticky, "widget-marquee.png"); widgetSurface.EndAt(end); Assert(mainCards.Where(x => widgetIds.Contains(x.Task.Id)).All(x => x.Check.IsChecked == true), "box selection synchronizes both windows");
  ClearSelection(); var fixture = new List<TaskItem>(); for (int i = 0; i < 20; i++) fixture.Add(new TaskItem { Title = "滚动测试" + i }); state.Tasks.AddRange(fixture); Refresh(); UpdateLayout(); sticky.UpdateLayout();
  Assert(widgetSurface.VisibleBounds(widgetCards.Last()).IsEmpty && mainSurface.VisibleBounds(mainCards.Last()).IsEmpty, "offscreen task bounds clipped");
  widgetSurface.BeginAt(new Point(1, 1), false); end = new Point(widgetSurface.ActualWidth - 1, widgetSurface.ActualHeight - 1); widgetSurface.MoveAt(end); widgetSurface.EndAt(end); Assert(!selected.Contains(fixture.Last().Id), "viewport selection does not select hidden task");
  ClearSelection(); state.Tasks.RemoveAll(x => fixture.Any(f => f.Id == x.Id)); for (int q = 0; q < 4; q++) state.Tasks[q].Quadrant = q; view = "四象限"; Refresh(); UpdateLayout();
  a = mainSurface.VisibleBounds(mainCards[0]); b = mainSurface.VisibleBounds(mainCards[3]); start = new Point(a.Left + 2, a.Top + 2); end = new Point(b.Right - 2, b.Bottom - 2); mainSurface.BeginAt(start, true); mainSurface.MoveAt(end); Assert(selected.Count == 4, "rectangle spans four quadrants"); Snapshot(this, "quadrant-marquee.png"); mainSurface.EndAt(end);
  ClearSelection(); foreach (var task in state.Tasks) task.Quadrant = 1; view = "列表"; Refresh(); UpdateLayout();
  a = mainSurface.VisibleBounds(mainCards[0]); b = mainSurface.VisibleBounds(mainCards[1]); mainSurface.BeginAt(new Point(a.Left + 3, a.Top + 3), false); end = new Point(b.Right - 3, b.Bottom - 3); mainSurface.MoveAt(end); mainSurface.EndAt(end); Assert(selected.Count == 2, "final box selection usable by batch actions"); Save();
 }
 static void Assert(bool condition, string name) { if (!condition) throw new Exception("Test failed: " + name); }
 static void Pump(int ms) { var frame = new DispatcherFrame(); var t = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(ms) }; t.Tick += (o, e) => { t.Stop(); frame.Continue = false; }; t.Start(); Dispatcher.PushFrame(frame); }
 static void Snapshot(Window w, string path) { w.UpdateLayout(); Pump(80); var bmp = new System.Windows.Media.Imaging.RenderTargetBitmap((int)w.ActualWidth, (int)w.ActualHeight, 96, 96, PixelFormats.Pbgra32); bmp.Render(w); var encoder = new System.Windows.Media.Imaging.PngBitmapEncoder(); encoder.Frames.Add(System.Windows.Media.Imaging.BitmapFrame.Create(bmp)); using (var f = File.Create(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, path))) encoder.Save(f); }
}
public static class Program {
 static Mutex mutex;
 [STAThread] public static void Main(string[] args) {
  bool test = args.Contains("--self-test") || args.Contains("--ui-test");
  try {
   if (args.Contains("--exit")) { try { using (var signal = EventWaitHandle.OpenExisting("Local\\DaibanDesktopExit")) signal.Set(); } catch (WaitHandleCannotBeOpenedException) { } return; }
   if ((args.Contains("--note-write-test") || args.Contains("--note-read-test")) && Environment.GetEnvironmentVariable("QIXU_TEST") == "1") { StartupSettings.TestMode = true; Data.Folder = Environment.GetEnvironmentVariable("QIXU_NOTE_TEST_DATA"); if (String.IsNullOrEmpty(Data.Folder)) throw new Exception("Missing isolated note test folder"); Directory.CreateDirectory(Data.Folder); var app = new Application(); var w = new MainWindow(); w.Loaded += (o, e) => w.Dispatcher.BeginInvoke(new Action(() => { try { w.NoteRestartTest(args.Contains("--note-write-test")); } catch (Exception ex) { File.WriteAllText(Path.Combine(Data.Folder, "error.txt"), ex.ToString()); Environment.Exit(1); } }), DispatcherPriority.ApplicationIdle); app.Run(w); return; }
   if(args.Any(a=>a.StartsWith("--overtime-test="))&&Environment.GetEnvironmentVariable("QIXU_TEST")=="1"){StartupSettings.TestMode=true;Data.Folder=Environment.GetEnvironmentVariable("QIXU_CLOCK_TEST_DATA");if(String.IsNullOrEmpty(Data.Folder))throw new Exception("Missing overtime test folder");Directory.CreateDirectory(Data.Folder);var app=new Application();var w=new MainWindow();w.Loaded+=(o,e)=>w.Dispatcher.BeginInvoke(new Action(()=>{try{w.OvertimeRestartTest(args.First(a=>a.StartsWith("--overtime-test=")).Substring(16));}catch(Exception ex){File.WriteAllText(Path.Combine(Data.Folder,"error.txt"),ex.ToString());Environment.Exit(1);}}),DispatcherPriority.ApplicationIdle);app.Run(w);return;}
   if(args.Any(a=>a.StartsWith("--clock-test="))&&Environment.GetEnvironmentVariable("QIXU_TEST")=="1"){StartupSettings.TestMode=true;Data.Folder=Environment.GetEnvironmentVariable("QIXU_CLOCK_TEST_DATA");if(String.IsNullOrEmpty(Data.Folder))throw new Exception("Missing clock test folder");Directory.CreateDirectory(Data.Folder);var app=new Application();var w=new MainWindow();w.Loaded+=(o,e)=>w.Dispatcher.BeginInvoke(new Action(()=>{try{w.ClockRestartTest(args.First(a=>a.StartsWith("--clock-test=")).Substring(13));}catch(Exception ex){File.WriteAllText(Path.Combine(Data.Folder,"error.txt"),ex.ToString());Environment.Exit(1);}}),DispatcherPriority.ApplicationIdle);app.Run(w);return;}
   if (args.Contains("--self-test")) { SelfTest(); return; }
   if (args.Contains("--ui-test")) { StartupSettings.TestMode = true; Data.Folder = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "ui-test-" + Guid.NewGuid().ToString("N")); try { var app = new Application(); var w = new MainWindow(); w.Loaded += (o, e) => w.Dispatcher.BeginInvoke(new Action(() => { try { w.UiTest(); } catch (Exception ex) { File.WriteAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "ui-test-error.txt"), ex.ToString()); Environment.Exit(1); } }), DispatcherPriority.ApplicationIdle); app.Run(w); } finally { Directory.Delete(Data.Folder, true); } return; }
   bool fresh; mutex = new Mutex(true, "Local\\DaibanDesktopApp", out fresh); if (!fresh) { if (!args.Contains("--startup")) MessageBox.Show("待办已在运行，请从任务栏右下角托盘打开。", "待办"); return; }
   try { var app = new Application(); var w = new MainWindow(); if (args.Contains("--widget") || args.Contains("--startup")) w.state.StickyOpen = true; if (args.Contains("--startup")) w.Loaded += (o, e) => w.Hide(); w.EnableExitSignal(); app.Run(w); } finally { mutex.ReleaseMutex(); }
  } catch (Exception ex) { if (test) { File.WriteAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "test-error.txt"), ex.ToString()); Environment.ExitCode = 1; } else MessageBox.Show("程序发生错误：\n" + ex, "待办"); }
 }
 static void SelfTest() {
 WorkdayClock.Test();
  Data.Folder = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "test-data-" + Guid.NewGuid().ToString("N"));
  try {
   StartupSettings.TestRegistry();
   if (Data.Split("子扬，崔京浩,, ，第三项\n第四项").Length != 4) throw new Exception("split"); if (Data.ValidRange(DateTime.Today.AddHours(18), DateTime.Today.AddHours(9)) || !Data.ValidRange(null, DateTime.Today) || !Data.ValidRange(DateTime.Today, DateTime.Today)) throw new Exception("date validation");
   Directory.CreateDirectory(Data.Folder); File.WriteAllText(Data.FileName, "<State><Tasks><TaskItem><Id>legacy</Id><Title>旧版任务</Title><Start>2026-10-17T09:00:00</Start><Quadrant>2</Quadrant><Done>false</Done></TaskItem></Tasks><Note>原便签</Note><StickyOpen>true</StickyOpen></State>"); var legacy = Data.Read(); if (legacy.Tasks[0].End != null || legacy.Tasks[0].Title != "旧版任务" || legacy.Note != "原便签" || legacy.OffWorkTime != "18:00") throw new Exception("legacy migration");
   var s = new State(); s.OffWorkTime="19:45"; for (int q = 0; q < 4; q++) s.Tasks.Add(new TaskItem { Title = "测试" + q, Quadrant = q, Start = DateTime.Today.AddHours(9), End = DateTime.Today.AddDays(1).AddHours(18) }); s.Note = "中文便签\n自动保存"; Data.Save(s); s.Tasks[0].Done = true; Data.Save(s);
   var r = Data.Read(); if (r.Tasks.Count != 4 || !r.Tasks[0].Done || r.Tasks[3].Quadrant != 3 || r.Tasks[0].End != s.Tasks[0].End || r.Note != s.Note || r.OffWorkTime != "19:45" || !File.Exists(Data.FileName + ".bak")) throw new Exception("persistence");
   File.WriteAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "test-result.txt"), "PASS: workday countdown validation, minute rounding, deadline and midnight; overtime persists across midnight and app restart, 17h/41h examples and new boot reset; isolated startup registry write/read/remove and command quoting; batch splitting, optional/equal/reversed start-end ranges, old-version data migration, four quadrants, start/end persistence, completion, notes, atomic backup.");
  } finally { if (Directory.Exists(Data.Folder)) Directory.Delete(Data.Folder, true); }
 }
}
