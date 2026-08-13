<div align="center">

# dsh-desktop

**DeepSeek Harness 桌面客户端** — 基于 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 的 Tauri 原生窗口封装

[![Release](https://img.shields.io/github/v/release/kyorakuyk/dsh-desktop?label=release)](https://github.com/kyorakuyk/dsh-desktop/releases/latest)
[![CI](https://img.shields.io/github/actions/workflow/status/kyorakuyk/dsh-desktop/ci.yml?label=ci)](https://github.com/kyorakuyk/dsh-desktop/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/kyorakuyk/dsh-desktop)](LICENSE)
[![Topic](https://img.shields.io/badge/topic-dsh--plugin-blue)](#)

Windows · macOS · Linux — 开箱即用，无需安装 Node.js

</div>

---

## 这是什么

dsh-desktop 把 DeepSeek Harness 的 Web GUI（`dsh web`）装进原生桌面窗口：

- **Tauri 2 (Rust) 壳**负责窗口、主机进程生命周期与打包；
- **内嵌 Node.js 主机（sidecar）**运行 npm 上发布的 [`@deepseek-ai/dsh`](https://www.npmjs.com/package/@deepseek-ai/dsh)（`dsh web --port 0`）；
- **WebView 直接访问 `http://127.0.0.1:<随机端口>`**，完整复用 harness 的
  `window.__DSH_BOOT__` 注入、插件 bundle 服务、`/api` JSON-RPC 与 WebSocket 事件下行——**不改动 deepseek-harness 一行代码**。

安装包自带 Node 运行时与全部 harness 依赖，用户机器上无需预装任何运行时。

## ✨ 功能特性

| 能力 | 说明 |
| --- | --- |
| 🖥️ 原生窗口 | Windows WebView2 / macOS WKWebView / Linux WebKitGTK |
| 📦 零依赖安装 | 安装包内置 Node 运行时 + `@deepseek-ai/dsh` 全家桶 |
| 🔌 完整 harness 能力 | 会话、工具调用、插件、模型配置、工作区等与 `dsh web` 完全一致 |
| 🚀 即开即用 | 启动闪屏 → 主机装配（约 30 个插件行）→ 自动进入 GUI |
| 🤖 模型配置 | GUI 内 设置 → 模型 直接配置 API Key |
| 🔄 跨平台发布 | GitHub Actions 标签一键构建三平台安装包并发布 Releases |
| 📋 日志落地 | 主机与壳日志统一输出（tauri-plugin-log） |

## 📥 下载安装

从 [Releases](https://github.com/kyorakuyk/dsh-desktop/releases/latest) 下载对应平台的安装包：

| 平台 | 文件 | 说明 |
| --- | --- | --- |
| Windows | `dsh-desktop_<version>_x64-setup.exe` | NSIS 安装器，双击安装 |
| macOS (Apple Silicon) | `dsh-desktop_<version>_aarch64.dmg` | 拖入 Applications 即可 |
| macOS (Intel) | `dsh-desktop_<version>_x64.dmg` | 同上 |
| Linux | `dsh-desktop_<version>_amd64.deb` | Debian / Ubuntu：`sudo dpkg -i` |
| Linux | `dsh-desktop-<version>-1.x86_64.rpm` | Fedora / RHEL：`sudo rpm -i` |

> **首次使用**：启动后等待数秒（主机装配），在 设置 → 模型 中配置 API Key 即可开始对话。
> 数据默认存放在 `~/.dsh`（会话、设置、profile；与 dsh CLI 共用）。

## 🏗️ 架构

```
┌─────────────────────────────────────────────┐
│ Tauri 窗口 (WebView2 / WKWebView)           │
│  └─ 加载 http://127.0.0.1:<随机端口>         │
├─────────────────────────────────────────────┤
│ Rust 壳 (src-tauri)                         │
│  ├─ 拉起/监控 sidecar，解析 `dsh web:` URL 行│
│  ├─ 工作目录 ~/.dsh/workspace               │
│  ├─ 退出时终止主机进程                       │
│  └─ 日志（tauri-plugin-log）                 │
├─────────────────────────────────────────────┤
│ Sidecar：捆绑 Node 运行时 + @deepseek-ai/dsh│
│  └─ node host/main.mjs → dsh web --port 0   │
│     ├─ __DSH_BOOT__ 注入（dsh-client-modules│
│     │   节点端扫描 dsh.client 声明）          │
│     ├─ /plugins/<id>/client.js 插件 bundle   │
│     ├─ /api JSON-RPC 网关                    │
│     └─ /api/events.mux|host WebSocket 下行   │
└─────────────────────────────────────────────┘
```

### 启动时序

1. 应用启动，窗口显示**闪屏页**（主机装配期间的加载界面）；
2. Rust 壳 spawn 捆绑的 `node.exe` → `host/main.mjs` → 进程内执行 `dsh web --port 0`；
3. `dsh web` 装配 Cordis 插件树（`@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-web-app` 两个 bundle，
   约 30 个插件行），webserver 绑定到**操作系统分配的随机端口**；
4. web-app bundle 在 Loader 树稳定后打印 `dsh web: http://127.0.0.1:<port>`；
5. Rust 壳解析该行 → WebView 导航到该 URL → harness GUI 完整加载
   （boot manifest、插件 bundle 预取、`/api` 连接、WebSocket 事件下行）；
6. 用户关闭窗口 → 应用退出 → 主机进程被终止（会话数据已持久化到磁盘）。

### 工程要点

- **零端口冲突**：`--port 0` 让 OS 分配端口，Rust 从 stdout 解析真实地址；
- **Windows `\\?\` 前缀**：Tauri 资源路径带扩展长度前缀，Node loader 无法解析，
  传给子进程前已剥除（`strip_verbatim_prefix`）；
- **精简 bundle**：pnpm 以 `hoisted` 布局安装（复制后无符号链接），打包时剔除
  `.pnpm` store（约 250 MB）与 Node 发行包中的 npm/npx/corepack（约 30 MB）；
- **keyless 冒烟测试**：CI 与本地均可用 `npm run smoke` 验证整条主机链路
  （启动 → URL 行 → index 200 + shell HTML），无需 API Key。

## 📁 目录结构

```
dsh-desktop/
├── src-tauri/            # Rust 壳（窗口、sidecar 生命周期、打包配置、图标）
│   ├── src/host.rs       # sidecar spawn / URL 解析 / 进程终止
│   ├── src/lib.rs        # Tauri 应用装配与退出钩子
│   └── resources/        # 构建期组装产物（gitignored）：
│                         #   host/{main.mjs, node/, node_modules/}
├── host/                 # Node 主机入口
│   ├── main.mjs          # 进程内执行 dsh web（argv 重定向 + file:// 导入）
│   └── pnpm-workspace.yaml  # pnpm 11 设置（hoisted / allowBuilds / 发布年龄门槛）
├── scripts/
│   ├── fetch-node.mjs    # 下载官方 Node 运行时（v22 LTS，按平台/架构）
│   ├── bundle-host.mjs   # 组装 resources/host（剔除 .pnpm 与 npm 发行件）
│   └── smoke-host.mjs    # keyless 主机冒烟测试（优先测打包产物）
├── ui/                   # 启动闪屏页（纯静态，无构建步骤）
├── .github/workflows/
│   ├── release.yml       # 标签 → tauri-action 三平台构建 → GitHub Releases
│   └── ci.yml            # PR/推送：主机冒烟 + Windows/Linux cargo check
└── package.json          # 便捷脚本（见下）
```

## 🛠️ 开发

### 环境要求

| 依赖 | 版本 | 说明 |
| --- | --- | --- |
| Node.js | ≥ 22.19 | 含 npm |
| pnpm | ≥ 11 | 用于安装 host 依赖 |
| Rust 工具链 | ≥ 1.77 | cargo / rustc |
| Linux 额外依赖 | — | `libwebkit2gtk-4.1-dev` 等，见 [Tauri 官方文档](https://tauri.app/start/prerequisites/) |

### 快速开始

```sh
# 1. 安装依赖并组装主机资源（Node 运行时 + @deepseek-ai/dsh 及其依赖）
npm install
npm run host:install        # 内部: pnpm -C host install --prod
npm run host:bundle         # 产物: src-tauri/resources/host/（已 gitignore）

# 2. 开发运行（打开窗口；主机由 Rust 自动拉起）
npm run tauri dev
```

### 常用脚本

| 脚本 | 作用 |
| --- | --- |
| `npm run host:install` | 安装 host 依赖（`@deepseek-ai/dsh` 固定版本） |
| `npm run host:fetch-node` | 下载/裁剪官方 Node 运行时 |
| `npm run host:bundle` | 组装 `src-tauri/resources/host/` |
| `npm run smoke` | keyless 主机冒烟测试（优先测打包产物） |
| `npm run tauri dev` | 开发模式运行 |
| `npm run build` | 生产构建（bundle host + tauri build） |

### 构建安装包

```sh
npm run build
# Windows: src-tauri/target/release/bundle/nsis/*.exe
# macOS:   bundle/macos/*.app + bundle/dmg/*.dmg
# Linux:   bundle/deb/*.deb + bundle/rpm/*.rpm（AppImage 暂缓，见已知限制）
```

## 🚀 发布到 GitHub

仓库已配置 `.github/workflows/release.yml`。两种触发方式：

```sh
# 方式一：推送标签（推荐）
git tag v0.2.0
git push origin v0.2.0

# 方式二：Actions 页面手动触发 release 工作流
```

工作流会在 Windows / macOS (arm64+x64) / Linux 上分别构建安装包，上传到 GitHub
Releases（草稿，确认无误后手动转正式版）。

> 可选 secrets（仅启用自动更新时需要，见下文）：
> `TAURI_SIGNING_PRIVATE_KEY`、`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。

## 🧪 CI 检查（ci.yml）

| Job | 内容 |
| --- | --- |
| Host boot smoke | Ubuntu 上安装 host 依赖并启动 `dsh web`，断言 URL 行 + shell HTML |
| cargo check | Windows + Ubuntu 双平台编译检查（含 build.rs 资源校验） |

## 🔄 自动更新（路线图）

当前版本未编译 `tauri-plugin-updater`。启用步骤：

1. `cargo add tauri-plugin-updater` 并在 `src-tauri/src/lib.rs` 注册；
2. 生成密钥对 `npx tauri signer generate -w ~/.tauri/dsh-desktop.key`，
   公钥写入 `tauri.conf.json → plugins.updater.pubkey`；
3. 在仓库 Secrets 配置 `TAURI_SIGNING_PRIVATE_KEY` 与
   `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`；
4. `tauri.conf.json` 配置 `plugins.updater.endpoints` 指向
   `https://github.com/kyorakuyk/dsh-desktop/releases/latest/download/latest.json`；
5. 推送新标签，`tauri-action` 自动上传更新清单与签名产物。

## 🔍 故障排查

| 现象 | 处理 |
| --- | --- |
| 长时间停留在闪屏页 | 查看应用日志定位主机启动失败原因 |
| 主机启动报错 | 日志：Windows `%LOCALAPPDATA%\com.dsh.desktop\logs\dsh-desktop.log`，macOS/Linux 见 `~/Library/Logs` 与 `~/.local/share/com.dsh.desktop/logs` |
| 模型无响应 | 检查 设置 → 模型 中的 API Key 与模型配置 |
| 构建时提示 host bundle missing | 先执行 `npm run host:bundle`（`build.rs` 会主动报错提示） |

## ⚠️ 已知限制

- 首次启动需数秒（主机装配约 30 个插件行 + 前端 bundle 预取），期间显示闪屏页；
- 安装包体积较大（内含 Node 运行时与全部 harness 依赖，约 100 MB 量级）；
- 主机异常退出时窗口停留在最后页面（日志可见退出原因）；
- Linux AppImage 暂不提供：CI 中 `linuxdeploy` 打包失败（deb/rpm 正常，
  属于 AppImage 工具链问题），后续版本修复；
- 自动更新未启用（见上文路线图）。

## 📄 License

[MIT](LICENSE) — 与 deepseek-harness 一致。

> **免责声明**：本项目是社区桌面封装，与 DeepSeek 官方无附属关系；
> DeepSeek Harness 及其相关商标归其各自所有者所有。
