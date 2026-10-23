const fs=require('node:fs/promises'),{createReadStream}=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),JSZip=require('jszip'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),out=path.resolve(root,'../../outputs'),version=require('../package.json').version;
async function hash(file){const h=crypto.createHash('sha256');for await(const data of createReadStream(file))h.update(data);return h.digest('hex');}
async function main(){
 await fs.mkdir(out,{recursive:true});const installer=`Qixu-Setup-${version}-x64.exe`,source=`Qixu-source-${version}.zip`;
 await fs.copyFile(path.join(root,'release',installer),path.join(out,installer));
 await fs.copyFile(path.join(root,'docs/使用说明.md'),path.join(out,'栖序-使用说明.md'));
 const runRoot=path.resolve(root,'../test-runs'),names=await fs.readdir(runRoot);
 const latest=prefix=>names.filter(n=>new RegExp('^'+prefix+'\\d+$').test(n)).sort((a,b)=>Number(b.slice(prefix.length))-Number(a.slice(prefix.length)))[0];
 const reports={};for(const [name,prefix] of [['v17','qixu-1.7-'],['autoHide','auto-hide-'],['browser','browser-benchmark-'],['startup','qixu-startup-'],['tourbox','qixu-tourbox-'],['v14','qixu-1.4-'],['bilibili','qixu-bilibili-'],['v13','qixu-1.3-'],['v12','qixu-1.2-'],['integration','qixu-'],['media','qixu-media-'],['platforms','qixu-platform-'],['installed','qixu-installed-'],['youtubeProtocol','qixu-youtube-protocol-']]){const folder=latest(prefix);if(folder){try{reports[name]=JSON.parse(await fs.readFile(path.join(runRoot,folder,'report.json'),'utf8'));}catch{}}}
 const protocolFolders=names.filter(n=>/^qixu-youtube-protocol-\d+$/.test(n)).sort().slice(-2);reports.subtitleRegression={results:[]};for(const folder of protocolFolders){const report=JSON.parse(await fs.readFile(path.join(runRoot,folder,'report.json'),'utf8'));reports.subtitleRegression.results.push(...report.results);}
 reports.unit=await fs.readFile(path.resolve(root,'../unit-1.7.0.tap'),'utf8');reports.nativeLogic=await fs.readFile(path.join(root,'native/test-result.txt'),'utf8');reports.nativeUI=await fs.readFile(path.join(root,'native/ui-test-result.txt'),'utf8');
 const noteFolder=names.filter(n=>n.startsWith('note-restart-')).sort().at(-1);if(noteFolder)reports.noteRestart={results:[{name:(await fs.readFile(path.join(runRoot,noteFolder,'note-restart-pass.txt'),'utf8')).trim(),pass:true}]};
 const clockFolder=names.filter(n=>n.startsWith('clock-restart-')).sort().at(-1);if(clockFolder)reports.clockRestart={results:[{name:(await fs.readFile(path.join(runRoot,clockFolder,'clock-restart-pass.txt'),'utf8')).trim(),pass:true}]};
 const overtimeFolder=names.filter(n=>n.startsWith('overtime-restart-')).sort().at(-1);if(overtimeFolder)reports.overtimeRestart={results:[{name:(await fs.readFile(path.join(runRoot,overtimeFolder,'overtime-restart-pass.txt'),'utf8')).trim(),pass:true}]};
 reports.workdayClock={results:[{name:"下班倒计时：双向设置同步、无效输入保留、保存重启、跨天与到点显示",pass:reports.nativeUI.includes("countdown main/widget settings sync")&&reports.nativeLogic.includes("workday countdown validation")}]};
 reports.quadrantDrag={results:[{name:'四象限左键拖动：12 个跨象限方向、空象限、批量移动、取消、撤销、保存与框选回归',pass:reports.nativeUI.includes('left-button cross-quadrant drag (12 directions)')}]};
 await fs.writeFile(path.join(out,'栖序-验收数据.json'),JSON.stringify(reports,null,2));
 const list=Object.entries(reports).flatMap(([group,report])=>(report.results||[]).map(r=>`- ${r.pass?'通过':'未通过'} · ${group} · ${r.name||r.error}`));
 const testText=[`# 栖序 ${version} · 测试与交付记录`,'','## 自动验收','',...list,'','## 性能','','本地样例首次完成翻译约 11 秒；120 个字幕绘制样本帧间隔 p95 为 8.5 毫秒。离线翻译进程工作集约 3.5 GB，峰值约 4.3 GB；返回待办、书架或设置时释放模型进程。以下为实测原始数据：','',JSON.stringify(reports.v12?.metrics||{},null,2),'','## 实测范围与限制','','- 自启动已验证真实 Windows Run 注册、开启/关闭、系统禁用同步及同一 --autostart 命令的组件显示；未实际注销或重启用户电脑。','- 账号验证由用户自行扫码或输入验证码；未自动操作真实账号。抖音真实账号回跳不因为模拟测试通过就记为通过。','- 本地测试验证空白登录弹窗与父页面共用会话，以及正常退出后登录 Cookie 保存。','- 真实 B 站公开视频的播放暂停、全屏悬浮控制、退出尺寸保持、隐藏恢复与视频时间已验证，详见 bilibili；YouTube 实际字幕及其他站点以 platforms 记录为准，没有记录的项目保持未验证。','- v13、v12 与 youtubeProtocol 使用受控网页；v13 在实际安装版中验证 Windows 全局 Ctrl+Alt、隐藏恢复、全屏与弹窗翻译，不代表真实账号登录成功。','- 当前真实 YouTube 样例出现过字幕接口空响应或视频持续缓冲，稳定的实站双语字幕仍未验证通过。','- 抖音真实账号仍有访问太频繁提示；1.3 已移除该来源，保留已有会话数据。','- 本地字幕测试使用真实量化模型，不替换翻译结果；无字幕视频不进行语音识别。','- 模型文件随安装包提供，版本和哈希见 resources/models/manifest.json，个人非商业使用。','','## 文件','',`- ${installer}：一键安装至 F:\\栖序。`,`- ${source}：源码与锁文件，不含模型权重、用户数据、登录会话或测试账号数据。`,'- 桌面“栖序安装包.exe”与 outputs 安装包相同；“栖序”快捷方式打开应用。','- 栖序-使用说明.md、栖序-验收数据.json、Qixu-SHA256SUMS.txt。',''].join('\n');
 await fs.writeFile(path.join(out,'栖序-测试记录.md'),testText);
 const zip=new JSZip(),skip=new Set(['node_modules','release','dist','dist-electron','native','models','reference','.git']);
 async function add(dir,prefix='Qixu-source/'){for(const e of await fs.readdir(dir,{withFileTypes:true})){if(skip.has(e.name)||e.name.endsWith('.log'))continue;const full=path.join(dir,e.name);if(e.isDirectory())await add(full,prefix+e.name+'/');else if(e.isFile())zip.file(prefix+e.name,await fs.readFile(full));}}
 await add(root);for(const name of ['manifest.json','MODEL-LICENSE-AND-CARD.md'])zip.file('Qixu-source/models/'+name,await fs.readFile(path.join(root,'models',name)));
 await fs.writeFile(path.join(out,source),await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE',compressionOptions:{level:9}}));
 const checks=[];for(const name of [installer,source,'栖序-使用说明.md','栖序-测试记录.md','栖序-验收数据.json']){checks.push(await hash(path.join(out,name))+'  '+name);console.log(name,(await fs.stat(path.join(out,name))).size);}
 await fs.writeFile(path.join(out,'Qixu-SHA256SUMS.txt'),checks.join('\n')+'\n');
 if(!process.argv.includes('--no-desktop')){
  const desktop=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"[Environment]::GetFolderPath('Desktop')"],{encoding:'utf8',windowsHide:true}).trim();
  const file=path.join(desktop,'栖序安装包.exe');await fs.copyFile(path.join(out,installer),file);if(await hash(file)!==await hash(path.join(out,installer)))throw Error('Desktop installer checksum mismatch');console.log('Desktop installer verified:',file);
 }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
