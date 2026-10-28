# 栖序 1.9.2 测试记录

测试平台：Windows x64、Electron 41。代码与构建测试使用隔离数据目录，不读取或写入用户真实任务、书籍正文、Cookie 内容或账号凭据。

## 已通过

- Node 回归测试 **78 / 78** 通过。
- 新增 B 站原生全屏测试：确认只定位 `.bpx-player-ctrl-full`，排除 `.bpx-player-ctrl-web`；使用 Chromium trusted input 触发按钮。
- 新增 YouTube 原生全屏测试：确认定位 `.ytp-fullscreen-button` 并使用 Chromium trusted input；页面脚本不再执行 `requestFullscreen()` 兜底。
- 新增全屏事件回归：网站自己触发 `enter-html-full-screen` 后，栖序只同步 `state.fullscreen` 和布局，不再次调用进入全屏，避免双触发。
- 构建通过：TypeScript 检查、Vite 构建和 Electron 主进程打包步骤均完成。
- 代码路径确认主窗口、WebContentsView 与登录弹窗均启用 `disableHtmlFullscreenWindowResize: true`；登录弹窗额外设置 `fullscreenable: false`；主窗口允许网页触发真实 HTML Fullscreen，进入后锁定宿主，并提供异步原生全屏恢复守卫。全屏布局只调整 WebContentsView 到当前 BrowserWindow 内容范围。
- B 站 / YouTube 原生全屏失败时不再执行容器 `requestFullscreen()` 兜底；失败会保持普通布局并提示重试。
- 双语字幕代码不再替换 `HTMLVideoElement.prototype.requestFullscreen`，避免字幕功能改变播放器全屏语义。

## 当前自动化环境限制

本次 Codex 执行环境无法完成真实 B 站 / YouTube GUI 播放器实测。最小 Electron 窗口在该环境中出现 GPU 子进程 `0xC0000135` 退出，以及磁盘缓存访问受限；因此 Playwright 无法稳定建立可交互的真实桌面窗口。

这意味着本记录**不把真实站点点击播放、字幕显示、网站原生全屏视觉结果写成已通过**。真实站点仍需在正常 Windows 桌面会话中补验以下项目：

- B 站底部“全屏”按钮进入后，视频占满栖序当前窗口，外层窗口大小和位置不变。
- YouTube 原生全屏同样只占满栖序当前窗口。
- 全屏内空格播放／暂停、方向键、字幕层与双语字幕仍可操作。
- Esc 退出后窗口大小、位置、视频进度和字幕状态不丢失。

## 安装与数据

覆盖升级沿用 `%APPDATA%\\Moyu` 数据目录和既有安装位置。安装前应完成数据备份；安装器设置为不删除 AppData，现有待办、书库、Cookie、阅读位置、视频进度、老板键和设置按原数据目录继续使用。

## 2026-10-28 发布复核

- 本地 78 项测试和 TypeScript / Vite / Electron 构建全部通过。
- 修复远端传输损坏的主进程、React 界面和依赖锁文件，发布流水线恢复使用 npm ci。
- 全屏源码检查兼容 Windows CRLF 换行。
- 真实站点 GUI 验收仍未完成；本记录不将其计为通过。

- 正常 Windows 桌面下，隔离会话已验证 B站公开视频加载、播放、暂停与原生视频全屏，进入时宿主位置大小保持；发现悬浮控制脚本漏打包并补齐，完整循环等待重新验收。
