# dsh-desktop

DeepSeek Harness 的桌面窗口客户端：以 Tauri (Rust) 为壳，内嵌 Node.js 主机（sidecar），
完整复用 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 的 Web GUI
（`dsh web` 组合）——不改动 harness 一行代码，即可获得原生桌面窗口体验。

- 窗口：Tauri 2（Windows WebView2 / macOS WKWebView / Linux WebKitGTK）
- 主机：捆绑的 Node.js 运行时 + npm 上发布的 `@deepseek-ai/dsh`（`dsh web --port 0`）
- 传输：WebView 直接访问 `http://127.0.0.1:<随机端口>`，完整复用 harness 的
  `window.__DSH_BOOT__` 注入、插件 bundle 服务、`/api` JSON-RPC 与 WebSocket 事件下行
- 发布：GitHub Actions（`tauri-action`）在标签推送时自动构建 Windows/macOS/Linux 安装包
  并发布到 GitHub Releases

## 架构

```
┌─────────────────────────────────────────────┐
│ Tauri 窗口 (WebView2 / WKWebView)           │
│  └─ 加载 http://127.0.0.1:<port>            │
├─────────────────────────────────────────────┤
│ Rust 壳 (src-tauri)                         │
│  ├─ 拉起/监控 sidecar，解析 `dsh web:` URL 行│
│  ├─ 窗口生命周期、退出时终止主机进程         │
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

## 目录

```
dsh-desktop/
├── src-tauri/            # Rust 壳（窗口、sidecar 生命周期、打包配置、图标）
├── host/                 # Node 主机入口（main.mjs + 依赖 @deepseek-ai/dsh）
├── scripts/              # 构建辅助脚本（下载 Node、组装 resources、冒烟测试）
├── ui/                   # 启动闪屏页（主机就绪前显示）
├── .github/workflows/    # release.yml（标签→发布）+ ci.yml（PR 检查）
└── package.json          # 便捷脚本
```

## 快速开始（开发）

需要 Node ≥ 22.19（含 npm）、pnpm ≥ 11 与 Rust 工具链（cargo）。

```sh
# 1. 安装依赖并组装主机资源（Node 运行时 + @deepseek-ai/dsh 及其依赖）
npm install
npm run host:install        # 内部使用 pnpm -C host install --prod
npm run host:bundle         # 产物: src-tauri/resources/host/（已 gitignore）

# 2. 开发运行（打开窗口；主机由 Rust 自动拉起）
npm run tauri dev
```

> 首次运行会在 `~/.dsh` 初始化 harness 数据（会话、设置、profile）。模型调用需要
> 在 GUI 的 设置 → 模型 中配置 API Key（或设置环境变量 `DEEPSEEK_API_KEY`）。

## 构建安装包

```sh
npm run build             # 先 bundle host，再 tauri build
# Windows 产物: src-tauri/target/release/bundle/nsis/*.exe
# macOS 产物:  bundle/macos/*.app + bundle/dmg/*.dmg
# Linux 产物:  bundle/deb/*.deb + bundle/rpm/*.rpm
```

> Linux 上如需跳过 AppImage（当前 CI 中 linuxdeploy 打包失败，见已知限制），
> 使用 `npx tauri build --bundles deb,rpm`。

## 发布到 GitHub

1. 本仓库已配置 `.github/workflows/release.yml`。
2. 推送形如 `v0.1.0` 的标签（或在 Actions 页面手动触发 `release` 工作流）：
   ```sh
   git tag v0.1.0
   git push origin v0.1.0
   ```
3. 工作流会在 Windows / macOS / Linux 上分别构建安装包并发布到 GitHub Releases
   （草稿，确认无误后手动转正式版）。

可选 secrets（暂未启用自动更新，见下文）：

| Secret | 用途 |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | 自动更新签名私钥（启用 updater 时必需） |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 私钥密码 |

## 自动更新（路线图）

当前版本未编译 `tauri-plugin-updater`。启用步骤：

1. `cargo add tauri-plugin-updater` 并在 `lib.rs` 注册；
2. 生成密钥对 `npx tauri signer generate -w ~/.tauri/dsh-desktop.key`，
   公钥写入 `tauri.conf.json → plugins.updater.pubkey`；
3. 在仓库 Secrets 中配置上述两个 secret；
4. `tauri.conf.json` 配置 `plugins.updater.endpoints` 指向
   `https://github.com/<owner>/<repo>/releases/latest/download/latest.json`；
5. 推送新标签，`tauri-action` 会自动上传更新清单与签名产物。

## 已知限制

- 首次启动需数秒（主机装配约 30 个插件行 + 前端 bundle 预取），期间显示闪屏页。
- 安装包体积较大（内含 Node 运行时与全部 harness 依赖，约 100 MB 量级）。
- 主机异常退出时窗口停留在最后页面；日志位于系统日志目录（tauri-plugin-log）。
- Linux 构建需要 WebKitGTK 系统依赖；详见
  [Tauri prerequisites](https://tauri.app/start/prerequisites/)。
- Linux AppImage 暂不提供：CI 中 `linuxdeploy` 打包失败（与本地 deb/rpm 无关，
  属于 AppImage 工具链问题），后续版本修复。

## License

MIT — 与 deepseek-harness 一致。本项目与 DeepSeek 官方无附属关系，是社区桌面封装。
