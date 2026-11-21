# 日程轻量版（Daily Schedule Lite V1.0）

单用户、本地优先、离线可用的网页端日程工具。左侧是按周查看的普通日程（顶部周条可用 `‹ ›` 前后翻周、也可直接跳转日期），右侧是长期/周期任务规则；所有数据保存在本机 IndexedDB，不上传、不联网。

> 当前状态：V1.0 可交付（2026-11-21）。双栏界面、长期任务规则/单次例外、备份恢复、诊断与救援工具、方案 A 便携包均已完成。
>
> **接手开发请先读 [`docs/HANDOFF.md`](docs/HANDOFF.md)**：里面有环境、构建、改版流程、数据模型、排错与已知限制。

## 技术栈

| 层   | 选型                                      | 说明                                             |
| ---- | ----------------------------------------- | ------------------------------------------------ |
| 框架 | React 18 + TypeScript                     | 纯前端 SPA，无后端                               |
| 构建 | Vite 6                                    | 开发 5180，预览/正式 4180                        |
| 路由 | React Router 6（Hash）                    | 静态服务器无 SPA 回退，刷新不 404                |
| UI   | Ant Design 5 + 自定义 CSS                 | 中文界面，桌面优先 + 基础响应式                  |
| 状态 | Zustand                                   | 只放查询条件与瞬时草稿，不落 localStorage        |
| 数据 | Dexie 4（IndexedDB）                      | 主数据唯一存储；liveQuery 驱动列表刷新           |
| 离线 | vite-plugin-pwa（Workbox）                | 生产构建注册，断网可用                           |
| 日期 | dayjs + 自研 `period.ts` / `iso-date.ts`  | 日历串统一 `YYYY-MM-DD`，按 UTC 计算避免时区漂移 |
| 测试 | Vitest + Testing Library + fake-indexeddb | 不访问真实 IndexedDB                             |

## 常用命令

```bash
npm run dev            # 本地开发，http://127.0.0.1:5180
npm run build          # 类型检查 + 生产构建（输出 dist/）
npm run preview        # 预览构建产物，http://127.0.0.1:4180
npm run test           # 全部单元测试
npm run check          # typecheck + lint + test
npm run format:check   # 只检查格式，不写文件
npm run isolation:check    # 新旧工程隔离检查 + 源码哈希基线比对
npm run isolation:baseline # 重建哈希基线（确认改动都是自己做的之后）
npm run package        # 打 Windows 便携版（方案 A：内置 .NET 服务，约 1.75 MB）
npm run package:node   # 同上，但内置 Node 运行时不依赖 .NET（约 97 MB，老系统兜底）
npm run package:full   # 先 build 再打方案 A 包
```

## 目录结构

```text
Work_Lite_version1.0/
├─ src/
│  ├─ app/                 # 路由、导航、PWA 注册与状态
│  ├─ components/          # 通用组件（状态面板、标签选择、错误边界）
│  ├─ db/                  # Dexie 定义与版本迁移
│  ├─ domain/              # 实体类型（含长期任务模型）
│  ├─ features/            # 页面级功能组件
│  ├─ lib/                 # 日期、ID、校验和、下载等纯函数
│  ├─ pages/               # 七个路由页面
│  ├─ repositories/        # 数据访问层（唯一允许直接碰 db 的地方）
│  ├─ services/            # 业务逻辑（统计、备份、长期任务引擎与守卫）
│  ├─ styles/              # 全局样式
│  └─ test/                # 测试环境与工具
├─ scripts/                # 构建、校验、离线检查、隔离检查脚本
├─ packaging/              # 便携版：C# 静态服务、启动器、停止服务、打包脚本
│  ├─ build-portable.mjs   # 打包入口（--server dotnet|node、--out <dir>）
│  ├─ server/StaticServer.cs  # 方案 A：只监听 127.0.0.1 的静态服务
│  ├─ server.mjs           # 兜底：Node 版静态服务（package:node 用）
│  ├─ launcher/Launcher.cs # 双击入口：起服务 + 打开浏览器 + 失败提示窗
│  └─ stopper/Stopper.cs   # 停止服务
├─ docs/                   # 交接文档、设计/报告、验收记录、隔离基线
└─ public/                 # 图标与静态资源
```

### 便携版结构（方案 A，默认）

```text
release/日程轻量版便携版/     1.75 MB
├─ 日程轻量版.exe              双击：起服务并打开浏览器
├─ 停止服务.exe                关闭后台服务
├─ ScheduleServer.exe          内置 .NET 静态服务（23 KB，只监听 127.0.0.1）
├─ 使用说明.txt
└─ runtime/web/                构建产物（PWA 缓存与 index.html）
```

### 分层铁律

`pages/features → services → repositories → db`。页面不得直连 `@/db/db`（ESLint 已强制），写入必须先过服务层的聚合守卫。

## 数据模型

当前数据库版本 `DB_VERSION = 2`、`SCHEMA_VERSION = 2`，库名 `daily-schedule-lite`。共 11 张表：8 张基础表 + 3 张长期任务表；`tasks` 自 v2 起增加 `deletedAt`（软删除/回收站）。

| 表                     | 主键   | 说明                                                                |
| ---------------------- | ------ | ------------------------------------------------------------------- |
| `tasks`                | `id`   | 普通任务（日程行），含 `deletedAt` 软删除标记                       |
| `projects`             | `id`   | 项目（V1 界面不再暴露入口，数据保留）                               |
| `dailyPlans`           | `date` | 每日计划                                                            |
| `workLogs`             | `id`   | 工作日志（保留，不再作为主界面）                                    |
| `reports`              | `id`   | 报告与快照                                                          |
| `tags`                 | `id`   | 标签                                                                |
| `settings`             | `key`  | 应用设置                                                            |
| `meta`                 | `key`  | 元信息（最近备份时间等）                                            |
| `longTasks`            | `id`   | 长期任务主体 + `events[]` 生命周期 + `sortOrder` 手动排序           |
| `longTaskRuleVersions` | `id`   | 只追加不可变的规则版本（`taskId + effectiveFrom` 唯一）             |
| `longTaskExceptions`   | `id`   | 只追加的单次例外修订链（`taskId + occurrenceDate + revision` 唯一） |

## 普通任务与长期任务

| 维度     | 普通任务               | 长期任务                              |
| -------- | ---------------------- | ------------------------------------- |
| 位置     | 左栏日程，按计划日分组 | 右栏规则卡片，不出现在左栏            |
| 时间     | 单日，计划日决定归属   | 规则展开，可每天/每周/每月            |
| 完成方式 | 勾选完成               | 按「本次」记录，可改单次              |
| 历史     | 直接编辑字段           | 规则只追加；过去日期只能走 correction |
| 删除     | 软删除进回收站         | 软删除进回收站                        |

长期任务的三条硬规则：

1. **规则版本严格递增**：同一自然日只能有一个版本，`effectiveFrom` 必须晚于上一版；选版只看日期，不看版本号。
2. **生命周期同日最多一次转换**：暂停/恢复/结束/重新启用必须至少隔一天；`ended` 的生效日是「第一天不再执行」。
3. **次数按系列累计**：`count` 从首次计划日起算，不受查询窗口影响；暂停不计次，`skip` 仍计次。

## 备份与导出

- 完整备份：JSON 信封，含 `format`、`formatVersion`、`schemaVersion`、`appVersion`、`exportedAt`、`counts`、`checksum`、`data`。
- 备份格式：`daily-schedule-lite/backup`；文件名 `daily-schedule-lite-backup-YYYYMMDD-HHmm.json`。
- 导入：只读校验（格式 → 版本 → 结构 → 计数 → 校验和 → 引用完整性 → 迁移）通过后才允许覆盖写入，失败零写入。
- 其他导出：任务/日志 CSV（UTF-8 BOM，文件名 `daily-schedule-lite-任务|日志-*.csv`）、报告 Markdown（`daily-schedule-lite-*.md`）。

## 工程隔离（重要）

本工程位于上一代工程目录内部，两套工程共用父目录：

- **只在本目录执行 npm 命令**。父目录的 `npm run format` 会递归格式化本目录，禁止执行。
- 本目录的 `.npmrc` 指向自己的 `.npm-cache`，不要改回父目录缓存。
- 每次收工前跑 `npm run isolation:check`：它校验包名、端口、库名、备份格式，扫描旧标识，并比对 `docs/isolation/source-hashes.json` 的源码哈希。若提示 `CHANGED`，说明有外部工具改过源码，需要确认后再重建基线。
- 端口固定：开发 5180、预览/正式 4180。数据按「浏览器 + 源（含端口）」隔离，换端口等于换一套数据。

## Windows 便携版（方案 A）

默认用「内置 .NET 静态服务」打包：`npm run package:full`，产物在 `release/`：

```
日程轻量版便携版/            约 1.75 MB（压缩后约 0.61 MB）
├─ 日程轻量版.exe            双击启动服务并打开浏览器
├─ 停止服务.exe              关闭后台服务
├─ ScheduleServer.exe        内置静态服务（只监听 127.0.0.1:4180）
├─ 使用说明.txt
└─ runtime/web/              构建产物（dist 目录内容）
```

- 目标机只需 **.NET Framework 4.x**（Win10 2004+ / Win11 自带），不需要 Node、不需要管理员权限。
- 老系统（无 .NET 4.8）用 `npm run package:node` 出一个内置 Node 的版本（约 97 MB），启动器会自动识别两种布局。
- 端口固定 `4180`：再次双击只复用已启动的服务；`停止服务.exe` 才会真正关闭。
- 运行状态（pid、日志）写在程序目录的 `state/`；若不可写则退回 `%LOCALAPPDATA%\DailyScheduleLite`。
- 数据仍在浏览器 IndexedDB 中（按「浏览器 + 源」隔离）；关闭服务不会删除数据，换端口或换地址等于换一套数据。
- 未签名 exe 可能触发 SmartScreen/杀毒软件提示，选择「仍要运行」即可。

## 已知限制

- 暂无拖拽排序（长期任务用 ↑/↓ 按钮调整顺序）、批量编辑与跨任务搜索。
- 报告段落有行数上限（任务 20 / 日志 15 / 项目 10），超出显示「另有 N 项」。
- 备份为明文 JSON，加密列为 P1。
- 无端到端自动化测试；浏览器相关行为依赖 `scripts/verify-*.mjs` 与手工清单。
- 依赖包 antd 体积较大，首屏已按路由懒加载拆分，但仍需在网络较慢时等待。
- 内置静态服务不含 gzip/ETag/Range（本地回环访问，影响可忽略）。

## 代码地图

- 日期口径：`src/lib/period.ts`、`src/lib/iso-date.ts`
- 长期任务展开：`src/services/long-tasks/schedule.ts`
- 长期任务守卫：`src/services/long-tasks/guards.ts`
- 备份格式与校验：`src/services/backup.ts`
- 数据库定义：`src/db/db.ts`
- 隔离检查：`scripts/check-isolation.mjs`
