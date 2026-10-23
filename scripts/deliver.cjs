const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),JSZip=require('jszip');
const root=path.resolve(__dirname,'..'),out=path.resolve(root,'../../outputs');
const records={
 core:'2026-10-17T12-50-02-002Z',
 reader:'reader-1792240503182',
 largeEpub:'large-epub-1792240734959',
 installed:'installed-1792241456610',
 platforms:'platforms-1792240646557',
 douyin:'platforms-1792241170936'
};
async function main(){
 await fs.mkdir(out,{recursive:true});
 await fs.copyFile(path.join(root,'release/Moyu-Setup-1.0.0-x64.exe'),path.join(out,'Moyu-Setup-1.0.0-x64.exe'));
 await fs.copyFile(path.join(root,'docs/使用说明.md'),path.join(out,'使用说明.md'));
 const reports={};
 for(const [name,dir] of Object.entries(records))reports[name]=JSON.parse(await fs.readFile(path.resolve(root,'../test-runs',dir,'report.json'),'utf8'));
 reports.nativeDesktop={globalShortcutHidden:true,secondInstanceRestore:true,desktopShortcutExists:true,installedPath:'F:\\摸鱼\\摸鱼.exe',launchAtLogin:false};
 await fs.writeFile(path.join(out,'验收数据.json'),JSON.stringify(reports,null,2));
 const report=[
 '# 摸鱼 1.0.0 · 交付与测试记录',
 '',
 '测试日期：2026-10-17（北京时间）。运行环境：本机 Windows 11 x64。',
 '',
 '## 交付状态',
 '',
 '- 已安装到 F:\\摸鱼，桌面“摸鱼”快捷方式已创建，正式程序已打开。',
 '- 默认开机自启关闭；真实登记的开启、关闭均已验证，最终保持关闭。',
 '- 本机数据保存在 %APPDATA%\\Moyu；卸载默认保留个人数据。',
 '',
 '## 已通过的自动验收',
 '',
 '| 分类 | 通过项数 | 范围 |',
 '|---|---:|---|',
 '| 基础逻辑 | 10 | 网站地址限制、设置边界、媒体暂停/恢复、缓冲状态、中文编码、长段落与搜索 |',
 '| 真实 Electron 窗口 | 15 | 透明置顶、页面隔离、全屏与 Esc、隐藏静音、鼠标恢复、进度和重启、损坏 EPUB 拒绝、最小化和托盘恢复 |',
 '| 阅读器 | 7 | 大 TXT、目录/搜索/书签、自动滚动、隐藏暂停、排版锚点、EPUB、窄屏与深色 |',
 '| 大 EPUB | 1 | 22MB/360章首屏、跳章、关闭重开恢复原位置 |',
 '| 实际安装版 | 4 | 安装版启动、全局快捷键注册、自启登记开关、TXT Worker/EPUB资源、托盘行为（按测试分组计数） |',
 '',
 '合计 37 项自动验收通过。另通过 Windows 桌面实际按下 Ctrl+Alt+Space 验证隐藏，并确认程序再次启动可以恢复已有窗口。',
 '',
 '## 阅读性能实测',
 '',
 '- 约 20MB 中文 TXT 首屏 431 毫秒；初始挂载 12 个段落。',
 '- TXT 连续自动滚动 60 秒：8627 帧，95% 帧间隔不超过 7.2 毫秒，最大约 14.1 毫秒；结束时仅挂载 18 个段落。',
 '- 小型 EPUB 首屏约 123 毫秒；360 章 EPUB 目录完整。',
 '- 22,765,832 字节、360 章 EPUB 首屏 476 毫秒；跳至约 50.2% 后关闭重开，仍恢复到 50.2%。',
 '- 上述为本机运行结果，不是所有硬件的性能保证；首屏时间从点击书籍开始计算，文件导入另行处理。',
 '',
 '## 在线平台实测',
 '',
 '| 平台 | 实际观察 |',
 '|---|---|',
 '| 哔哩哔哩 | 官方首页和视频页可打开；测试视频已解码播放（640×360），窗口内全屏前后尺寸一致，隐藏后静音且暂停。未登录时原站可能限制试看或清晰度。 |',
 '| 抖音 | 官方首页可加载并跳转到精选页，推荐内容可显示；本次未完成选中具体视频后的播放验证。播放器操作仍以网页实际状态为准。 |',
 '| YouTube | 首页与视频页可打开；本机新会话被要求“请登录，以便我们确认你不是聊天机器人”，未验证成功播放。App 会提示登录限制，不将零解码/缓冲状态显示为正在播放。 |',
 '| 其他预置网站与自定义来源 | 提供官方网页入口与通用 HTML5 控制，未逐站验证所有内容。 |',
 '',
 '未自动操作登录、验证码或账号授权；平台可访问性、账号、会员及地区条件遵循原站。',
 '',
 '## 测试边界',
 '',
 '- 多显示器不同缩放比例、物理拔插显示器、真实锁屏/休眠恢复未在所有硬件组合上验收。',
 '- 没有进行数小时压力测试或完整内存泄漏分析；已覆盖一分钟连续滚动、跨章与多次开关阅读器。',
 '- 网站未来改版可能需要更新适配器。隐藏静音由主进程控制，暂停失败或状态无法确认时会给出提示。',
 '- 安装包为本地构建版本，未使用商业代码签名证书。',
 '',
 '## 文件',
 '',
 '- Moyu-Setup-1.0.0-x64.exe：安装程序，可重新安装或选择目录。',
 '- Moyu-source-1.0.0.zip：完整源码、依赖锁文件、构建脚本与原创测试夹具；不含 node_modules、浏览记录、测试会话或个人图书。',
 '- 使用说明.md：快捷键、透明窗口、阅读器、自启及备份说明。',
 '- 验收数据.json：对应的自动测试与平台观察数据。',
 '- SHA256SUMS.txt：交付文件校验值。',
 ''
 ].join('\n');
 await fs.writeFile(path.join(out,'测试记录.md'),report);
 const zip=new JSZip(),excluded=new Set(['node_modules','release','dist','dist-electron','.git']);
 async function add(dir,prefix='Moyu-source/'){
  for(const entry of await fs.readdir(dir,{withFileTypes:true})){
   if(excluded.has(entry.name)||entry.name.endsWith('.log'))continue;
   const full=path.join(dir,entry.name);
   if(entry.isDirectory())await add(full,prefix+entry.name+'/');
   else if(entry.isFile())zip.file(prefix+entry.name,await fs.readFile(full));
  }
 }
 await add(root);await fs.writeFile(path.join(out,'Moyu-source-1.0.0.zip'),await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE',compressionOptions:{level:9}}));
 const hashes=[];
 for(const name of (await fs.readdir(out)).filter(n=>n!=='SHA256SUMS.txt').sort()){
  const file=path.join(out,name),stat=await fs.stat(file);if(!stat.isFile())continue;
  const hash=crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');hashes.push(hash+'  '+name);
 }
 await fs.writeFile(path.join(out,'SHA256SUMS.txt'),hashes.join('\n')+'\n');
 console.log(out);for(const name of await fs.readdir(out)){const stat=await fs.stat(path.join(out,name));console.log(name,stat.size);}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
