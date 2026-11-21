# 便携版打包（Windows）

两条路线共用同一套启动器与停止服务，区别只在「谁来提供静态文件」：

| 路线               | 命令                   | 包体积     | 目标机依赖                                   |
| ------------------ | ---------------------- | ---------- | -------------------------------------------- |
| **方案 A（默认）** | `npm run package`      | 约 1.75 MB | .NET Framework 4.x（Win10 2004+/Win11 自带） |
| 方案 B（兜底）     | `npm run package:node` | 约 97 MB   | 无（自带 node.exe）                          |

两者都先需要 `npm run build`（`npm run package:full` 会代跑）。

## 文件职责

| 文件                     | 作用                                                                                                                                   |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `build-portable.mjs`     | 打包入口：拷 dist、编译 exe、写说明、打 zip；支持 `--server dotnet                                                                     | node`、`--out <dir>` |
| `server/StaticServer.cs` | 方案 A 的静态服务：只监听 `127.0.0.1`，支持 GET/HEAD、`/__health`、路径越界拦截、MIME、缓存头、端口占用退出码 2                        |
| `server.mjs`             | 方案 B 的静态服务（Node），能力对齐方案 A                                                                                              |
| `launcher/Launcher.cs`   | 双击入口：探测包内服务类型 → 启动/复用 → 等 pid 就绪 → 打开默认浏览器（显式 `--new-window`，按「新窗口」判定成功）→ 失败弹可点击地址窗 |
| `stopper/Stopper.cs`     | 读 `state/server.json` 结束服务；兼容 `ScheduleServer.exe` 与 `node.exe` 两种进程                                                      |
| `make-ico.mjs`           | 生成 `app.ico`（零依赖，多尺寸 PNG-in-ICO）                                                                                            |

## 产物结构（方案 A）

```text
日程轻量版便携版/
├─ 日程轻量版.exe
├─ 停止服务.exe
├─ ScheduleServer.exe
├─ runtime/web/          ← dist 内容
├─ 使用说明.txt
└─ state/                ← 运行时生成，不要打进 zip
```

## 约定

- 端口固定 **4180**，不自动顺延（数据按「浏览器 + 端口」隔离）。
- 状态目录三级探测：程序目录 `state/` → `%LOCALAPPDATA%\DailyScheduleLite` → `%TEMP%\DailyScheduleLite`。
- 服务写 `state/server.json`（pid/port）后才算就绪；启动器以它判断复用与等待。
- 改 `StaticServer.cs` 后必须重新打包并做接口冒烟（见 `docs/HANDOFF.md` §6.4）。
- C# 源码用 UTF-8；**不要用 PowerShell 写这些文件**（会按 GBK 读坏中文）。
