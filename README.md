# Lofi Vinyl

一个桌面优先的本地音乐库 + 黑胶唱机模拟器。

用户可以从本地导入音频文件或整个文件夹，应用会把曲目整理成专辑与盘面结构，保存到本地 SQLite 曲库，并通过 Canvas 唱机界面和 Web Audio 播放引擎模拟黑胶播放体验。

## 功能

- 导入本地音频文件或文件夹
- 自动按黑胶单面时长限制分配到 Side A / B / C / D...
- 提取音频内嵌封面并显示在唱片标签或整张盘面
- 播放当前盘面，支持切换 Side
- 拖动唱针进行手动落针和定位播放
- 模拟黑胶播放质感
  - 唱盘启转
  - 唱臂 cue / drop 动画
  - 持续底噪
  - 随机爆裂声
  - wow & flutter
- 编辑专辑内容
  - 重命名专辑
  - 向当前专辑追加导入
  - 调整曲目顺序
  - 把曲目移动到相邻盘面
  - 删除曲目或整张专辑
- 使用 SQLite 持久化本地曲库

## 技术栈

- 前端：Svelte 5 + TypeScript + Vite
- 桌面壳：Tauri 2
- 后端：Rust + `rusqlite`
- 音频：Web Audio API
- 文件选择：`rfd`

## 当前实现特点

- 桌面优先：完整功能依赖 Tauri 运行时
- 单窗口、单页应用：主要状态集中在 [`src/App.svelte`](./src/App.svelte)
- 曲库数据保存在 Tauri 应用数据目录下的 `library.sqlite3`
- 本地音频通过 Tauri asset protocol 暴露给前端解码和播放
- 支持的音频扩展名：`mp3`、`flac`、`ogg`、`m4a`、`aac`、`wav`
- macOS 下会通过 `mdls` 补充读取标题和艺人元数据

## 开发

### 环境要求

- Node.js
- npm
- Rust toolchain
- Tauri 2 构建环境

如果是第一次在本机开发 Tauri，先按官方文档准备对应平台的依赖。

### 安装依赖

```bash
npm install
```

### 启动前端开发模式

```bash
npm run dev
```

说明：

- 这会启动纯前端 Vite 开发服务器
- 不会提供 Tauri IPC、数据库、桌面文件导入等完整能力

### 启动桌面开发模式

```bash
npm run desktop:dev
```

这是项目的主要开发方式，包含：

- Tauri 窗口
- 本地文件选择
- SQLite 持久化
- asset protocol 文件访问

### 构建

```bash
npm run build
npm run desktop:build
```

### 类型检查

```bash
npm run check
```

## 发布 GitHub Release

仓库内已经提供 GitHub Actions 工作流 [`release.yml`](./.github/workflows/release.yml)。

触发方式：

1. 先同步版本号
   - `package.json`
   - `src-tauri/tauri.conf.json`
   - `src-tauri/Cargo.toml`
2. 提交代码并推送 tag，例如：

```bash
git tag v0.1.0
git push origin v0.1.0
```

推送后会自动执行：

- macOS Apple Silicon 安装包构建
- macOS Intel 安装包构建
- Windows x64 NSIS 安装包构建
- 生成对应的 GitHub Release 并上传产物

说明：

- 当前 workflow 不包含 macOS / Windows 代码签名，产物可发布，但首次安装时仍可能看到系统安全提示
- 如果后续要接入自动更新签名或平台证书签名，再补对应的 GitHub Secrets 即可

## 项目结构

```text
src/
├── App.svelte                    # 应用状态中心、UI 编排、导入/保存/播放流程
├── app.css                       # 全局样式
├── lib/
│   ├── audio/
│   │   ├── albumSplitter.ts      # 自动分面、播放态专辑构建、时间定位
│   │   ├── coverArt.ts           # 内嵌封面提取
│   │   ├── importAudio.ts        # 导入准备、时长解码、桌面/浏览器兼容入口
│   │   └── vinylEngine.ts        # Web Audio 播放引擎和黑胶音效
│   ├── library/
│   │   ├── model.ts              # 曲库模型操作与播放态转换
│   │   └── persistence.ts        # Tauri IPC 封装
│   ├── turntable/
│   │   ├── needleMapper.ts       # 唱针几何与时间映射
│   │   └── Turntable.svelte      # Canvas 唱机渲染与交互
│   └── types/
│       └── index.ts              # 共享类型定义
└── main.ts

src-tauri/
├── src/
│   ├── lib.rs                    # Tauri 命令、SQLite、导入扫描、元数据读取
│   └── main.rs
├── capabilities/
├── tauri.conf.json
└── Cargo.toml
```

## 数据流

### 导入流程

1. 用户在桌面端选择文件或文件夹
2. Rust 端返回音频条目列表和基础元数据
3. 前端解码音频时长，提取封面，生成 `PreparedImport`
4. `PreparedImport` 被转换成 `LibraryAlbum`
5. 前端通过 IPC 将 `LibraryAlbum` 保存到 SQLite

### 播放流程

1. 选中专辑后，前端把 `LibraryAlbum` 转成播放态 `Album`
2. 当前盘面的全部曲目会预加载并解码到 `AudioBuffer`
3. UI 先执行唱盘启转与唱臂动画
4. `VinylEngine` 从指定的面内时间开始播放
5. 播放结束后自动续播下一首，整面播完后回到停靠状态

## 数据模型概览

项目里有两层主要模型：

- `LibraryAlbum`
  - 持久化主模型
  - 结构贴近数据库
  - `sides` 以 `Track[][]` 表示
- `Album`
  - 播放态运行时模型
  - 包含 `DiscSide`、`label`、`discIndex`、`totalDuration` 等派生字段

更完整的协作文档见 [`AI_README.md`](./AI_README.md)。

## 已知限制

- 纯 `npm run dev` 模式下不能完整体验桌面功能
- 当前主界面只开放桌面导入入口，浏览器导入辅助代码主要用于兼容和后续扩展
- 元数据补充读取对 macOS 更友好，其他平台目前以文件名和已存数据回退为主
- 当前没有完整自动化测试，主要依赖 `npm run check`

## 后续适合扩展的方向

- 更完整的跨平台元数据提取
- 曲库搜索、筛选和排序
- 播放进度与 UI 偏好持久化
- 更丰富的唱机音效参数调节
- 更细粒度的专辑/曲目编辑能力
