# AI_README — Lofi Vinyl 协作开发指南

> **本文档面向参与本项目的 AI Agent。**
> 当你增添、删除模块，或修改系统运作方式时，**必须同步更新本文档对应章节**。

---

## 1. 项目概述

Lofi Vinyl 是一个 **桌面优先** 的本地音乐库 + 黑胶唱机模拟器。用户从本地导入音频文件或整个文件夹，应用将曲目整理为“专辑 → 面（Side A/B/C...）”结构，保存到本地 SQLite 曲库，并通过 Canvas 唱机界面与 Web Audio 播放引擎进行播放。

当前产品重点不是流媒体管理，而是：

- 从本地音频建立专辑收藏
- 按黑胶单面时长限制自动分面
- 手动编辑盘面内曲目顺序
- 用唱针拖拽、启转、落针、底噪、爆裂声等交互模拟黑胶播放体验

**技术栈：** Svelte 5 + TypeScript + Vite（前端） | Tauri 2 + Rust + rusqlite（桌面后端） | Web Audio API（播放引擎）

**运行模式：**

- `npm run desktop:dev` / `desktop:build`：完整桌面功能
- `npm run dev`：仅前端开发壳，Tauri IPC、数据库、桌面导入不可用

**UI 语言：** 以中文为主，夹杂少量英文视觉文案（如 `MUSIC LIBRARY`、`TURNTABLE`）

---

## 2. 架构总览

```text
┌──────────────────────────────────────────────────────────────┐
│                        Tauri Shell                           │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Svelte Frontend (Vite dev :1420)                      │  │
│  │                                                        │  │
│  │   App.svelte                                           │  │
│  │   ├── 曲库状态 / 播放状态 / 编辑状态                     │  │
│  │   ├── 导入、保存、删除、切面、播放编排                   │  │
│  │   ├── Library UI（专辑列表、统计、编辑抽屉）             │  │
│  │   └── Turntable.svelte（Canvas 唱机 + 唱针交互）         │  │
│  │                                                        │  │
│  │   importAudio.ts ── 导入准备（桌面/浏览器兼容）         │  │
│  │   model.ts ─────── 曲库模型操作与播放态转换              │  │
│  │   persistence.ts ── Tauri IPC 封装                      │  │
│  │   vinylEngine.ts ── Web Audio 播放与黑胶音效            │  │
│  └──────────────┬─────────────────────────────────────────┘  │
│                 │ invoke() / asset protocol                  │
│  ┌──────────────▼─────────────────────────────────────────┐  │
│  │  Rust Backend (src-tauri/src/lib.rs)                   │  │
│  │  ├── 文件选择（rfd）                                   │  │
│  │  ├── 本地音频元数据探测（macOS 使用 mdls）              │  │
│  │  ├── SQLite 建表 / 读取 / 事务保存 / 删除               │  │
│  │  └── 应用数据目录中的 library.sqlite3 管理              │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

---

## 3. 模块清单与职责

### 前端 (`src/`)

| 文件 | 职责 | 关键依赖 |
|------|------|----------|
| `App.svelte` | **应用状态中心与交互编排层**：曲库加载、专辑选择、导入、保存、删除、编辑、切面、播放启动序列 | Turntable, vinylEngine, model, persistence, importAudio, Tauri window |
| `lib/turntable/Turntable.svelte` | Canvas 2D 唱机渲染：唱盘启停、唱臂动画、落针拖拽、封面显示模式切换、点击/拖拽寻位 | needleMapper |
| `lib/turntable/needleMapper.ts` | 盘面几何与时间换算：点击位置 ↔ 面内时间、播放时间 ↔ 唱针半径 | — |
| `lib/audio/vinylEngine.ts` | Web Audio 播放引擎：曲目 buffer 缓存、指定时间起播、自动续播、wow/flutter、底噪、爆裂声 | albumSplitter (`resolveTrackAtTime`) |
| `lib/audio/albumSplitter.ts` | 曲目自动分面、从二维 side 数据构建播放态 Album、根据面内时间定位曲目 | types |
| `lib/audio/importAudio.ts` | 导入准备：桌面文件选择 IPC、浏览器文件准备、音频时长解码、封面提取、专辑艺人推断 | coverArt, Tauri core API |
| `lib/audio/coverArt.ts` | 解析音频内嵌封面（ID3 APIC / FLAC PICTURE / MP4 covr） | — |
| `lib/library/model.ts` | 曲库模型操作：新建专辑、追加导入、曲目移动/删除、重命名、持久化前序列化、播放态转换 | albumSplitter, importAudio, Tauri core API |
| `lib/library/persistence.ts` | Tauri IPC 封装：加载、保存、删除曲库专辑 | model, Tauri core invoke |
| `lib/types/index.ts` | 前端共享类型：Track / DiscSide / Album / LibraryAlbum / TonearmState 等 | — |

### 后端 (`src-tauri/`)

| 文件 | 职责 |
|------|------|
| `src/lib.rs` | Tauri 命令注册、数据库路径与 schema 初始化、专辑/曲目 CRUD、文件对话框、目录递归扫描、元数据提取 |
| `src/main.rs` | Tauri 入口样板 |
| `Cargo.toml` | Rust 依赖声明（`rusqlite`、`rfd`、`tauri-plugin-log` 等） |
| `capabilities/default.json` | 桌面权限声明（含窗口拖拽） |
| `tauri.conf.json` | 窗口尺寸、Overlay 标题栏、asset protocol、构建命令配置 |

---

## 4. 核心数据模型

```text
LibraryAlbum（持久化主模型）
├── id
├── title
├── artist
├── coverUrl?
├── sides: Track[][]
├── createdAt
└── updatedAt

Album（播放态运行时模型）
├── id
├── title
├── artist
├── coverUrl?
├── sides: DiscSide[]
└── discs

DiscSide
├── label ('A', 'B', 'C' ...)
├── discIndex
├── sideIndex
├── tracks: Track[]
└── totalDuration

Track
├── id
├── title
├── artist
├── duration
├── file?                ← 浏览器导入时保留 File
├── sourcePath?          ← 桌面导入时的真实文件路径
├── sourceDisplayPath?   ← 用于 UI 展示的相对路径/文件名
└── url?                 ← Object URL 或 convertFileSrc(...) 结果
```

### 真实转换链路

- `importAudio.ts` 先将外部输入整理成 `PreparedImport`
- `createLibraryAlbumFromPreparedImport()` 用 `PreparedImport` 生成新的 `LibraryAlbum`
- `appendPreparedImportToAlbum()` 将新曲目追加到现有 `LibraryAlbum`
- `hydrateLibraryAlbum()` 仍然返回 `LibraryAlbum`
  - 它只负责补齐运行时可用字段，如 `track.id`、`track.url`、缺失 artist 的推断
- `libraryAlbumToPlaybackAlbum()` 才会把 `LibraryAlbum` 转成播放用 `Album`
- `serializeLibraryAlbum()` 在保存前剔除纯运行时字段，并过滤掉没有 `sourcePath` 的曲目

> **注意：** 当前数据库与桌面播放依赖 `sourcePath`。浏览器导入辅助函数存在，但主 UI 目前只开放桌面导入入口。

---

## 5. 数据库 Schema

数据库文件位于 **Tauri 应用数据目录** 下的 `library.sqlite3`。

```sql
CREATE TABLE albums (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  artist TEXT NOT NULL DEFAULT '',
  cover_url TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE tracks (
  source_path TEXT PRIMARY KEY,
  source_display_path TEXT NOT NULL,
  title TEXT NOT NULL,
  artist TEXT NOT NULL DEFAULT '',
  duration REAL NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE album_tracks (
  album_id TEXT NOT NULL,
  track_path TEXT NOT NULL,
  side_index INTEGER NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (album_id, track_path),
  FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE,
  FOREIGN KEY (track_path) REFERENCES tracks(source_path) ON DELETE CASCADE
);
```

**实现细节：**

- 启用 `PRAGMA foreign_keys = ON`
- `tracks.source_path` 是跨专辑复用曲目的主键
- `save_album` 会先重建指定专辑的 `album_tracks` 关系，再清理未被任何专辑引用的孤儿曲目
- 加载曲库时，如果源文件仍存在，Rust 端会重新读取标题/艺人元数据；不存在时回退到数据库里存的值

---

## 6. Tauri IPC 接口

| 命令 | 签名 | 用途 |
|------|------|------|
| `pick_audio_files` | `() -> Option<AudioImportSelection>` | 选择多个音频文件，返回条目列表 |
| `pick_audio_folder` | `() -> Option<AudioImportSelection>` | 选择文件夹，递归扫描支持的音频文件 |
| `load_library` | `(app) -> Vec<LibraryAlbum>` | 加载全部专辑及分面后的曲目列表 |
| `save_album` | `(app, album: LibraryAlbum) -> LibraryAlbum` | 事务性保存/更新专辑及曲目归属 |
| `delete_album` | `(app, album_id: String) -> ()` | 删除专辑，并清理无引用曲目 |

**调用约定：**

- 前端通过 `@tauri-apps/api/core` 的 `invoke()` 调用
- 前端参数用 camelCase，Rust 结构体用 `#[serde(rename_all = "camelCase")]`
- 本地音频文件通过 `convertFileSrc()` 走 Tauri asset protocol 暴露给前端读取/解码

---

## 7. 音频引擎架构

```text
AudioContext
│
├── Music Path
│   AudioBufferSourceNode
│     └── playbackRate <- wow/flutter LFO
│           └── musicGain
│                └── destination
│
├── Continuous Vinyl Noise Path
│   looped noise buffer
│     └── bandpass filter
│           └── vinylNoiseGain
│                └── destination
│
└── Crackle Path
    procedural short bursts
    (随机 1~8 秒触发一次)
```

### 关键实现事实

- 单面最大时长常量：`MAX_SIDE_DURATION = 23 * 60`
- `loadSide()` 会并发抓取并解码当前面的全部曲目，缓存到 `trackBuffers`
- `playWithOptions(timeInSide)` 支持从任意面内时间起播
- 当前播放位置的**真实时间基准是 `AudioContext.currentTime`**
- `requestAnimationFrame` 只用于 UI 侧时间回调与渲染同步，不是底层音频计时来源
- `startLeadInNoise()` / `stopLeadInNoise()` 用于唱盘启转和手动落针前后的噪声包络
- 当前曲目结束后自动衔接下一首；整面结束后触发 `onSideEnded`

### 与 UI 的配合流程

1. `App.svelte` 选定某个 `DiscSide`
2. `VinylEngine.loadSide()` 预载该面的所有曲目
3. 播放开始前，App 先跑唱盘启转 + 唱臂 cue/drop 动画
4. 动画结束后调用 `playWithOptions(...)`
5. 播放中 `onTimeUpdate` 持续回写 `currentTime`
6. 手动拖针时，App 会先进入 `holding` / 手动启转流程，再在放针时从指定时间起播

---

## 8. 状态管理模式

### 应用级状态集中在 `App.svelte`

当前主要状态包括：

- `libraryAlbums`：整个曲库
- `selectedAlbumId`：当前在侧边栏选中的专辑
- `playbackAlbum`：当前转换好的播放态专辑
- `engine`：当前 `VinylEngine` 实例
- `currentSideIndex` / `currentTime` / `isPlaying`
- `isPlatterSpinning` / `tonearmState`
- `discArtworkMode`：封面显示在整张盘面还是中央标签
- `isLoading` / `isSavingLibrary` / `loadError`
- `albumTitleDraft` / `titleDraftAlbumId`
- `isEditorOpen` / `libraryPanelVisible`
- `startSequenceToken` / `manualSpinupStartedAt`：用于防止播放启动序列竞争与手动落针流程串扰

### 子组件职责

- `Turntable.svelte` 可以持有**渲染和交互级的局部状态**
  - 例如动画插值、指针拖拽、画布尺寸、封面图片缓存
- 但**应用级状态和持久化行为仍由 `App.svelte` 编排**

### 组件通信方式

- Props：`App.svelte` -> `Turntable.svelte`
- 回调：`Turntable.svelte` -> `App.svelte`
  - `onSeek`
  - `onTogglePlay`
  - `onNeedleDragStart`
  - `onNeedleDrop`
  - `onArtworkModeChange`

---

## 9. 设计原则与约束

### 必须遵守

1. **应用级状态由 `App.svelte` 统一编排。**
   `Turntable.svelte` 可以有局部渲染状态，但不要把曲库、播放流程、持久化决策分散出去。
2. **所有音频播放逻辑通过 `vinylEngine.ts`。**
   不要在 `App.svelte` 或其他组件里直接拼装 Web Audio Graph。
3. **桌面文件访问和数据库写入通过 Tauri。**
   前端不直接读写 SQLite；桌面导入使用 Rust 命令和 asset protocol。
4. **专辑模型变换通过 `model.ts` / `importAudio.ts`。**
   不要在 UI 层手写 `LibraryAlbum` 与播放态 `Album` 的转换。
5. **共享类型集中在 `src/lib/types/index.ts`。**
6. **保持双运行时安全。**
   桌面能力必须经 `isTauri()` / 桌面运行时判断保护，避免纯浏览器 dev 模式报错。

### 现有架构决策

| 决策 | 原因 |
|------|------|
| 不使用 SvelteKit | 项目是单窗口桌面应用，不需要路由或 SSR |
| 单页应用，`App.svelte` 作为状态中心 | 目前复杂度适中，集中式编排比引入 store/状态库更清晰 |
| `LibraryAlbum` 作为前端持久化主模型 | 更贴近数据库结构，编辑和保存更直接 |
| 播放前再转成 `Album` / `DiscSide` | 播放态需要 label、discIndex、totalDuration 等运行时派生字段 |
| `tracks.source_path` 作为主键 | 支持多个专辑复用同一音频文件 |
| Canvas 唱机而不是 DOM | 需要稳定控制唱盘旋转、唱臂几何、纹理与拖针体验 |
| 使用 `convertFileSrc()` + asset protocol | 前端可直接 `fetch()` 本地音频做解码，无需自建文件流桥接 |
| macOS 上用 `mdls` 读元数据 | 在当前范围内足够轻量，避免引入更重的元数据解析方案 |

### 避免

- 不要绕过 `saveLibraryAlbum()` 直接手写 IPC payload
- 不要在 `App.svelte` 中手动构造 `DiscSide`，优先走 `libraryAlbumToPlaybackAlbum()`
- 不要随意修改播放时序常量后只改一处
  - `App.svelte` 里的启转 / cue / drop 时长需要和 `Turntable.svelte` 动画语义保持一致
  - `needleMapper.ts` 与唱机几何假设也应一并核对
- 不要把桌面导入逻辑直接绑死到浏览器 API；当前代码要求桌面与纯前端 dev 模式都能安全运行

---

## 10. 开发命令

```bash
npm run dev            # Vite 开发服务器（纯浏览器，无 Tauri 功能）
npm run desktop:dev    # Tauri 开发模式（完整功能）
npm run build          # 前端构建
npm run desktop:build  # Tauri 打包
npm run check          # TypeScript + Svelte 类型检查
```

---

## 11. 文件依赖图

```text
App.svelte
  ├→ Turntable.svelte
  │    └→ needleMapper.ts
  ├→ vinylEngine.ts
  │    └→ albumSplitter.ts (resolveTrackAtTime)
  ├→ model.ts
  │    ├→ albumSplitter.ts (buildAlbumFromSides / splitTracksIntoSides / MAX_SIDE_DURATION)
  │    ├→ importAudio.ts (PreparedImport)
  │    ├→ types/index.ts
  │    └→ @tauri-apps/api/core
  ├→ persistence.ts
  │    ├→ model.ts (hydrateLibraryAlbum / serializeLibraryAlbum)
  │    ├→ types/index.ts
  │    └→ @tauri-apps/api/core
  ├→ importAudio.ts
  │    ├→ coverArt.ts
  │    ├→ types/index.ts
  │    └→ @tauri-apps/api/core
  └→ @tauri-apps/api/window

src-tauri/src/lib.rs
  ├→ rusqlite
  ├→ rfd
  ├→ tauri
  └→ std::process::Command (macOS mdls)
```

---

## 12. 变更日志

> 每次对模块结构、IPC 接口、数据模型、设计原则有实质性变更时，在此记录。

| 日期 | 变更内容 | 操作者 |
|------|----------|--------|
| 2026-04-08 | 创建本文档，记录初始架构 | AI Agent |
| 2026-04-08 | 按当前实现修正文档：补充真实模型转换链路、状态字段、播放启动/手动落针流程、asset protocol 与实际模块职责 | AI Agent |

---

## AI Agent 操作守则

1. **先读本文档，再动手。** 修改任何核心模块前，先看相关章节。
2. **修改后同步更新本文档。** 以下内容变动时必须更新对应章节：
   - 模块增删改名 -> 第 3 节、第 11 节
   - 数据模型或转换链路 -> 第 4 节
   - SQLite schema / 存储策略 -> 第 5 节
   - IPC 命令 -> 第 6 节
   - 音频引擎或播放流程 -> 第 7 节
   - 状态管理或组件边界 -> 第 8 节、第 9 节
   - 任何架构决策 -> 第 9 节、第 12 节
3. **保持文档是“架构文档”，不是源码拷贝。**
   记录边界、约束、流程和依赖，不要机械抄实现细节。
4. **文档与代码冲突时，以代码为准，并尽快修正文档。**

