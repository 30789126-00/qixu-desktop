# Qixu · A little order, a little room to breathe.

**A Windows desktop companion for planning, reading, and browsing.**

Qixu combines an Eisenhower Matrix task manager, a persistent desktop widget, a tabbed web viewer, and a local TXT/EPUB reader in one app.

## What you can do

- Manage and drag tasks between four priority quadrants, with reminders and undo.
- Keep a compact, colorful desktop widget with quick notes and an end-of-work countdown.
- Browse Bilibili, YouTube, Fanqie Novel, Google and Yandex in a tabbed Electron window.
- Use adjustable window opacity, window-contained media fullscreen, mouse-leave auto-hide, pause/mute, and quick keyboard hide.
- Import TXT or EPUB, use bookmarks, search, auto-scroll and reading-progress recovery. Version 1.9.0 adds sentence navigation, sleep timers, bounded chapter caching, reusable search indexes, and bookshelf metadata.
- Translate supported non-Chinese webpages locally, and overlay bilingual subtitles when accessible caption tracks are available.
- Restore recent media, independent per-video positions, reader location, window geometry and settings after restart or interruption.
- Schedule weekly/monthly tasks, filter by project and tags, and configure per-weekday end-of-work times.
- Hibernate idle tabs, inspect save status, create and preview backups, and verify update installers before installation or rollback.

![Qixu widget preview](docs/images/qixu-widget.png)

## Install

Windows 10/11 x64. Download from [Releases](https://github.com/30789126-00/qixu-desktop/releases/latest). New installations use the normal per-user app directory; existing installations in `F:\栖序` continue in place. The installer is large because it bundles an offline translation model.

## Build

Requires Node.js 22.12+, npm and the Windows .NET Framework 4.x C# compiler.

```powershell
npm ci
node scripts/prepare-models.cjs
npm test
npm run package
```

Model weights, user books, personal tasks and login sessions are excluded from the repository. See the [Chinese README](README.md), [usage guide](docs/使用说明.md), [third-party notices](THIRD_PARTY_NOTICES.txt), and the [model card](models/MODEL-LICENSE-AND-CARD.md).

**Limitations:** Third-party login, video playback, captions and translations depend on the source website and available caption tracks. This app does not encrypt user data. Model weights are under **CC BY-NC 4.0** for non-commercial use; public source availability does not itself grant unrestricted redistribution or commercial rights.

If you find Qixu useful, **Star** the repository and choose **Watch → Custom → Releases** to follow updates.

