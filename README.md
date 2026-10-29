# 栖序 · QIXU

<div align="center">

<img src="docs/images/qixu-hero.svg" width="100%" alt="栖序 QIXU — 今日有序，片刻从容" />

<br/>

**今日有序，片刻从容。**

一款为 Windows 打造的桌面应用。用四象限管理待办，用轻量窗口浏览视频、阅读小说；让专注与放松，都有自己的位置。

[**⬇ 下载最新版**](https://github.com/30789126-00/qixu-desktop/releases/latest) · [使用说明](docs/使用说明.md) · [更新记录](CHANGELOG.md) · [问题反馈](https://github.com/30789126-00/qixu-desktop/issues) · [English](README_EN.md)

![Windows](https://img.shields.io/badge/Windows-10%20%2F%2011-4388c7?style=flat-square)
![Latest Release](https://img.shields.io/github/v/release/30789126-00/qixu-desktop?style=flat-square&color=9a7ee7&label=Release)
![Electron](https://img.shields.io/badge/Electron%20%2B%20React%20%2B%20TS-34354d?style=flat-square)

</div>

---

## 一张桌面，两种节奏

<img src="docs/images/qixu-modes.svg" width="100%" alt="栖序待办整理与影音阅读双模式，产品功能示意" />

|  🗂 待办整理 | 🎬 影音与阅读 |
| :--- | :--- |
| 四象限任务管理，支持拖动调整优先级 | 多标签网页浏览，支持哔哩哔哩与 YouTube |
| 桌面待办小组件、随手记与提醒 | 番茄小说等在线阅读入口 |
| 下班倒计时与加班计时 | TXT / EPUB 本地书库、书签与目录 |
| 周期待办、项目标签与备份恢复 | 阅读进度、视频断点与会话恢复 |

**认真时，理清眼前的事。** 任务可以在四象限间直接拖动；小组件停留在桌面，记录待办、随手记和下班倒计时。

**放松时，打开熟悉的内容。** 网页与本地书籍在栖序里各有入口，影音窗口可以调整透明度、置顶状态和尺寸。

<p align="center"><img src="docs/images/qixu-widget.png" width="360" alt="栖序桌面待办小组件实际界面" /><br/><sub>桌面待办小组件</sub></p>

## 让阅读回到阅读本身

<img src="docs/images/qixu-reader.svg" width="100%" alt="栖序小说阅读器功能示意" />

把本地 **TXT / EPUB** 导入书架，按自己的节奏阅读：目录跳转、全文搜索、书签、字号与主题调整、自动滚动，以及本机朗读和定时停止。阅读进度会保存，重新打开时可以继续阅读。

## 一些小而重要的体验

- **老板键与隐私式切换**：在设置中自定义快捷键、访问口令或免口令模式；快速收起影音窗口。
- **窗口内视频全屏**：让视频占满栖序现有窗口的内容区域；退出时恢复原布局与窗口位置、尺寸。
- **鼠标移出自动隐藏**：可设置自动隐藏，隐藏时暂停、静音，移回后恢复；也可切换窗口置顶行为。
- **视频与小说接着看**：分别记录阅读位置和支持的平台视频播放进度；崩溃或重启后可尝试恢复上次会话。
- **本地翻译与双语字幕**：对支持的外文网页进行本机翻译；当站点允许读取现有字幕轨道时，提供双语字幕功能。
- **数据管理**：支持保存状态提示、备份与恢复；用户书籍、任务和账号会话保存在本机应用数据中。

> **使用边界**：第三方网站的登录、播放、字幕读取和广告跳过功能会受网站与网络环境影响，无法保证所有视频都支持。快捷隐藏不等同于文件加密或安全访问控制，栖序不绕过原站会员及付费限制。

## 最新更新 · v1.9.3

本版重点改善 **YouTube 播放中断后的恢复体验**：识别部分播放器可见错误与媒体错误，针对同一次故障最多自动尝试两次刷新，并尽量从最后一个有效观看时间继续。若网络或站点限制仍导致失败，会提示手动处理；用户主动暂停或切换视频不会触发旧任务继续播放。

**[查看 v1.9.3 发布说明 →](https://github.com/30789126-00/qixu-desktop/releases/tag/v1.9.3)**

## 下载安装

适用系统：**Windows 10 / 11 x64**

1. 前往 **[GitHub Releases](https://github.com/30789126-00/qixu-desktop/releases/latest)** 下载 `Qixu-Setup-*-x64.exe`。
2. 运行安装程序；覆盖升级时沿用已有安装位置，并保留用户数据与设置。
3. 打开栖序，从待办模式开始使用，需要影音阅读时再进入相应模式。

安装包包含离线翻译模型，因此体积较大。本地书籍导入后可离线阅读；在线网页仍需网络。

**下载安全**：本个人项目暂未使用商业代码签名证书，Windows SmartScreen 可能提示未知发布者。请仅从本仓库 Releases 下载，并校验同版 SHA-256 文件。

## 从源码构建

环境：Node.js 22.12+、npm、Windows .NET Framework 4.x C# 编译器。

```powershell
npm ci
node scripts/prepare-models.cjs
npm test
npm run package
```

构建结果位于 `release/`。核心技术为 **Electron · React · TypeScript · Vite · WPF · epub.js · Transformers.js**。仓库不包含约 900 MB 的翻译模型权重，也不包含个人任务、书籍、Cookie 或登录数据。

## 反馈与关注

欢迎通过 **[Issues](https://github.com/30789126-00/qixu-desktop/issues)** 反馈 Bug、交互建议或站点兼容性问题。提交日志和截图时，请遮盖账户、私人书籍内容与其他敏感信息。

觉得这个项目有用，可以点击右上角的 **⭐ Star**；选择 **Watch → Custom → Releases** 关注后续更新。

<details>
<summary>第三方许可与使用范围</summary>

栖序是持续迭代中的个人 Windows 项目，目前不保证所有第三方网站的功能一致。翻译模型来自 [Xenova/nllb-200-distilled-600M](https://huggingface.co/Xenova/nllb-200-distilled-600M)，模型权重遵循 **CC BY-NC 4.0（非商业）**。具体第三方声明见 [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt) 与 [模型说明](models/MODEL-LICENSE-AND-CARD.md)。第三方网站及商标归原权利人所有。源码公开仅供查看与反馈，尚未另行授予无限制再分发或商业使用许可。

</details>

---

<div align="center"><sub>QIXU · 今日有序，片刻从容 ｜ 图中应用界面为功能示意，非真实截图</sub></div>
