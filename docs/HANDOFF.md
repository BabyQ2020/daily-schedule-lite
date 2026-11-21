# 交接文档 · 日程轻量版（Daily Schedule Lite V1.0）

> 目的：拿到「便携包 + 这份文档」，就能完成日常使用、改版、重新打包和排错。
> 最后更新：2026-11-21（方案 A 落地后）。

---

## 1. 一页速览

| 项目     | 内容                                                                                         |
| -------- | -------------------------------------------------------------------------------------------- |
| 产品     | 单用户、本地优先、离线可用的日程工具：左侧按天排的普通任务，右侧长期/周期任务规则            |
| 形态     | 纯前端 SPA（React 18 + Vite 6），数据存浏览器 IndexedDB，无后端、无账号、无遥测              |
| 交付物   | `release/日程轻量版便携版.zip`（约 0.61 MB），解压双击 `日程轻量版.exe` 即用                 |
| 运行依赖 | 目标机只需 **.NET Framework 4.x**（Win10 2004+/Win11 自带）；不需要 Node、不需要管理员权限   |
| 源码仓   | https://github.com/BabyQ2020/daily-schedule-lite （分支 `main`）                             |
| 数据库   | Dexie/IndexedDB，库名 `daily-schedule-lite`，`DB_VERSION = 2`、`SCHEMA_VERSION = 2`，11 张表 |
| 访问地址 | 固定 `http://127.0.0.1:4180/`（端口固定，保证数据同源）                                      |

三个最容易踩的坑，先记住：

1. **数据跟「浏览器 + 地址」绑定**。换浏览器（Chrome→Edge）或换端口（4180→4181）都会看到一份空数据，不是数据丢了。
2. **端口 4180 被占用时服务不会自动换端口**（会退出并写日志），因为换端口等于换一套数据。
3. **改完代码必须重新打包**，直接把 `dist` 或 `src` 换进去没用；便携包里的 `runtime/web` 才是真正被服务的文件。

---

## 2. 交接物清单

| 交接物        | 位置                                | 说明                                                        |
| ------------- | ----------------------------------- | ----------------------------------------------------------- |
| 便携包        | `release/日程轻量版便携版.zip`      | 给最终用户；解压即用                                        |
| 源码          | 上述 GitHub 仓库 / 本目录           | 开发、改版用                                                |
| 本交接文档    | `docs/HANDOFF.md`                   | 先读这个                                                    |
| 设计资料      | `docs/architecture/`                | 数据层 v2 设计（v1.3，含决策记录）、S1 报告、Preflight 报告 |
| 实施/验收报告 | `docs/reports/`                     | 各阶段做了什么、验证了什么                                  |
| 截图          | `docs/screenshots/`                 | 界面基线（改动后对比用）                                    |
| 隔离基线      | `docs/isolation/source-hashes.json` | 源码哈希基线，防外部工具误改                                |

---

## 3. 五分钟跑起来

### 3.1 只是使用

1. 解压 `日程轻量版便携版.zip` 到任意目录（**整个文件夹**，不能只拷 exe）。
2. 双击 `日程轻量版.exe` → 1–5 秒后浏览器自动打开页面。
3. 如需关闭后台服务：双击 `停止服务.exe`。
4. 数据备份：页面右上「数据」→ 导出完整备份 JSON。

### 3.2 开发

```powershell
cd Work_Lite_version1.0
npm install          # 首次；依赖已锁定在 package-lock.json
npm run dev          # http://127.0.0.1:5180
```

开发端口 5180 与正式 4180 **是两套数据**：开发时看不到正式环境的数据，这是预期行为（同源隔离）。

### 3.3 打一个包

```powershell
npm run package:full        # = build + 方案 A 打包，输出 release/
```

产物：`release/日程轻量版便携版/`（1.75 MB）与同名 zip（0.61 MB）。

---

## 4. 环境与依赖

| 用途           | 需要什么                                  | 备注                                                                     |
| -------------- | ----------------------------------------- | ------------------------------------------------------------------------ |
| 开发/构建      | Node.js 20+（本机为 26.13.0）、npm 11+    | 仅开发机需要                                                             |
| 打包           | Windows + .NET Framework 4.x 的 `csc.exe` | 系统自带；路径 `C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe` |
| 运行（目标机） | .NET Framework 4.8                        | Win10 2004+ / Win11 默认有；老系统用 Node 兜底包                         |
| 推送 GitHub    | Git + 可用的 SSH key                      | 本机无系统 git，用 `.tmp/tools/mingit/cmd/git.exe`（解压版，见 §11.3）   |

`.npmrc` 指向本目录的 `.npm-cache`（不要改回父目录缓存，权限会失败）。

---

## 5. 目录结构与分层

```text
Work_Lite_version1.0/
├─ src/
│  ├─ app/            路由、导航、PWA 注册
│  ├─ components/     通用组件（状态面板、TagSelect、错误边界、PWA 提示）
│  ├─ db/             Dexie 定义（db.ts）、迁移（migrations.ts）
│  ├─ domain/         实体与类型（long-task.ts 是长期任务模型）
│  ├─ features/       页面级组件（schedule / long-tasks / shell / system / tasks / projects / logs / today）
│  ├─ lib/            纯函数（period、iso-date、id、checksum、download、format）
│  ├─ pages/          路由页面（日程、每日工作台、任务、项目、日志、报告、设置）
│  ├─ repositories/   数据访问层（唯一直接碰 db 的地方）
│  ├─ services/       业务逻辑（long-tasks 引擎与守卫、stats、backup、exporters、diagnose）
│  ├─ styles/         global.css（双栏布局、表格行、月历、抽屉）
│  └─ test/           测试环境（fake-indexeddb）与工具
├─ packaging/         便携版：C# 服务、启动器、停止服务、打包脚本
├─ scripts/           构建/校验/离屏检查/隔离检查
├─ public/            图标、救援导出页
├─ docs/              交接文档、设计、报告、截图、隔离基线
└─ release/           打包产物（不入库）
```

**分层铁律**：`pages/features → services → repositories → db`。页面禁止 `import @/db/*` 或 `@/repositories/*`（ESLint `no-restricted-imports` + `no-restricted-syntax` 双重拦截），所有写入必须过 `services/long-tasks/*` 的守卫。

---

## 6. 打包（方案 A 为主）

### 6.1 命令

```powershell
npm run package         # 方案 A：内置 .NET 服务（默认，约 1.75 MB）
npm run package:node    # 兜底：内置 Node（约 97 MB，老系统用）
npm run package:full    # 先 build 再打方案 A
# 也可直接调用，自定义输出目录：
node packaging/build-portable.mjs --server dotnet --out .tmp/test-pkg
```

### 6.2 包内结构（方案 A）

```text
日程轻量版便携版/
├─ 日程轻量版.exe        启动器（20 KB）：起服务 → 打开浏览器 → 失败弹提示窗
├─ 停止服务.exe          关闭服务（18 KB）
├─ ScheduleServer.exe    静态服务（23 KB）：只监听 127.0.0.1:4180
├─ runtime/web/          构建产物（index.html、assets、sw.js、manifest）
├─ 使用说明.txt          给最终用户
└─ state/                运行时生成（server.json / server.log / launcher.log），不要打包
```

### 6.3 打包脚本做了什么

`packaging/build-portable.mjs`：

1. 校验 `dist/index.html` 存在；
2. 清空并重建目标目录，`dist → runtime/web`；
3. 用 `csc` 编译 `packaging/server/StaticServer.cs` → `ScheduleServer.exe`；
4. 用 `csc` 编译启动器与停止服务（共用 `packaging/launcher/Launcher.cs`、`packaging/stopper/Stopper.cs`、`packaging/app.ico`）；
5. 写 `使用说明.txt`（UTF-8 BOM，记事本可读）；
6. `Compress-Archive` 打 zip。

### 6.4 验证一个包（每次发版照做）

```powershell
# 1) 结构
Get-ChildItem release\日程轻量版便携版

# 2) 直接跑服务，验接口
$dir = (Resolve-Path 'release\日程轻量版便携版').Path
$p = Start-Process "$dir\ScheduleServer.exe" -ArgumentList @('--root',"$dir\runtime\web",'--port','4191','--pid-file',"$dir\state\t.json",'--log-file',"$dir\state\t.log") -PassThru
Invoke-WebRequest http://127.0.0.1:4191/ -UseBasicParsing | Select-Object StatusCode
Invoke-WebRequest http://127.0.0.1:4191/sw.js -UseBasicParsing | Select-Object StatusCode
Invoke-WebRequest http://127.0.0.1:4191/__health -UseBasicParsing | Select-Object Content
Stop-Process -Id $p.Id -Force
```

预期：`/` 200、`/sw.js` 200、`/__health` 返回 `{"ok":true,...}`；`/assets/xxx.js` 带 `max-age=31536000, immutable`；`POST /` 405；`/%2e%2e/package.json` 403。

3. 双击 exe 确认浏览器自动打开（或弹出可点击地址的提示窗）；断网刷新仍可用。

---

## 7. 改版流程（最常见的活）

### 7.1 只改布局/样式/文案（占绝大多数需求）

1. 改 `src/features/...` 或 `src/styles/global.css`；
2. `npm run dev` 边看边调（5180）；
3. 自检：`npm run check`（typecheck + lint + 571 例单测）；
4. `npm run build`；
5. `npm run package`（若已 build 可跳过 build）；
6. 按 §6.4 验证，替换 `release/` 里的旧包；
7. 提交：`git add -A && git commit -m "..." && git push`。

> 布局改动**不需要动** `ScheduleServer.exe` 或任何 C# 代码。

### 7.2 新增文件类型（图片/字体/视频）

若用了 `webp/avif/mp4` 等，在 `packaging/server/StaticServer.cs` 的 MIME 表里加一行；否则会按 `application/octet-stream` 返回，浏览器可能不显示。改完必须重新打包。

### 7.3 改数据模型 / 加字段

1. 改 `src/domain/*.ts`；
2. 改 `src/db/db.ts`：**DB_VERSION +1**，新增 `version(n).stores(...)` 全量声明（Dexie 只声明本版本变化会删表）；
3. 如涉及备份：`src/services/backup.ts` 的 schema 与 `BACKUP_TABLE_NAMES_V2` 同步，`SCHEMA_VERSION +1`，并处理旧备份导入；
4. 老数据回填写在 `upgrade()` 里，必须幂等；
5. 新增测试：`src/db/*.test.ts` 覆盖升级、回填、回滚；
6. 参考 `docs/architecture/P3.1_data_layer_v2_final_design.md` 的迁移规范（C1–C9、失败即停）。

### 7.4 改长期任务规则

- 展开引擎：`src/services/long-tasks/schedule.ts`（纯函数，`computeSlots` 是核心）；
- 写入守卫：`src/services/long-tasks/guards.ts`（R1–R5、L0–L5、E1–E16、A1–A11）；
- 仓储写入：`src/repositories/long-tasks.ts`；
- 服务封装：`src/services/long-tasks/service.ts`；
- 铁律：规则版本只追加、按日期选版、`count` 系列累计、`ended` 生效日 = 第一天不执行、历史只能走 correction 例外。
- 改前先看 `docs/architecture/...final_design.md` 第 8/9/10/21/25 章。

---

## 8. 数据模型（当前 v2）

- 库名 `daily-schedule-lite`；`DB_VERSION = 2`；`SCHEMA_VERSION = 2`；
- 11 张表：`tasks`（含 `deletedAt`）、`projects`、`dailyPlans`、`workLogs`、`reports`、`tags`、`settings`、`meta` + `longTasks`、`longTaskRuleVersions`、`longTaskExceptions`；
- 索引要点：`tasks.deletedAt`（回收站用 `where('deletedAt').above('')`，注意 IndexedDB 不索引 `null`）；`longTaskRuleVersions` 有 `taskId+effectiveFrom`、`taskId+versionNo` 唯一索引；`longTaskExceptions` 有 `taskId+occurrenceDate+revision` 唯一索引。

备份：`daily-schedule-lite/backup` 信封（`format/formatVersion/schemaVersion/appVersion/exportedAt/counts/checksum/data`），导入顺序 = zod → 版本上限 → checksum（原始 data）→ 归一化 → counts → 引用完整性 → 迁移；任一步失败零写入。

备份文件命名：`daily-schedule-lite-backup-YYYYMMDD-HHmm.json`。

---

## 9. 界面结构与交互约定

- 顶栏：品牌 + 「数据」「回收站」「新建任务」；无侧边导航（V1 只保留日程主界面，其它页面仍可通过 `#/settings` 等地址访问）。
- 左栏：周导航（`‹`/`›`/回到本周/展开月历/跳转日期）+ 连续日程列表（30 天前 ~ 60 天后，滚到边缘自动扩展，最多 370 天）。
- 行表格列：标题、详情、优先级（L1 红 / L2 橙 / L3 蓝）、状态（待办/进行中/已完成/已取消）、截止时间、备注、操作。
- 提醒：逾期红（行左侧红条 + 日期红）、当日到期黄；月历格子同样高亮，同日两者以逾期为准。
- 右栏：长期任务卡片（规则、详情、备注、未来 5 次、↑/↓ 排序、⋯ 菜单）。
- 编辑方式：标题/详情/备注失焦即存；优先级/状态点选即存；计划日期在行尾「⋯ → 改到其他日期」。
- 移动端：< 1024px 右栏折叠为抽屉。

---

## 10. 测试与校验

```powershell
npm run typecheck       # tsc 两套配置
npm run lint            # eslint（含分层依赖限制）
npm run test            # vitest，44 文件 / 462 例，全部用 fake-indexeddb
npm run check           # 上面三个
npm run verify:dist     # 校验 dist 的 SW/manifest/预缓存
npm run verify:offline  # 无头 Chrome 真断网验收
npm run verify:rescue   # 救援导出页的真实浏览器验证（需先 preview）
npm run isolation:check # 身份 + 旧标识 + 源码哈希基线
```

- 测试**不访问真实 IndexedDB**，不写工程外目录；
- 单测遵循「页面 → 服务 → 仓储」三层，新增功能至少补服务层 + 页面级各一例；
- 改了源码后若 `isolation:check` 报 `CHANGED`：确认是你自己的改动，再 `npm run isolation:baseline` 定点重建（不要把无关文件一起重建）。

---

## 11. 发布、升级与数据安全

### 11.1 发新版给用户

1. `npm run package:full`；
2. 让用户先双击旧包的 `停止服务.exe`；
3. 解压覆盖（或删旧文件夹再解压）；
4. 双击新包 —— 地址仍是 `127.0.0.1:4180`，**数据不丢**（同源）。

页面有 Service Worker 预缓存，换包后首次打开会提示「有新版本可用 → 刷新以更新」，点一次即可。

### 11.2 用户数据备份/迁移

设置页/数据抽屉 → 导出完整 JSON；新机器导入即可。跨浏览器不会自动同步（单机单浏览器设计）。

### 11.3 GitHub

本机没有系统 git，用的是解压版 MinGit：

```powershell
$git = '.tmp\tools\mingit\cmd\git.exe'
$env:GIT_SSH_COMMAND = '"' + (Resolve-Path '.tmp\tools\mingit\usr\bin\ssh.exe').Path + '" -i "' + (Join-Path $env:USERPROFILE '.ssh\id_ed25519_eda_dsh') + '" -o IdentitiesOnly=yes'
& $git add -A
& $git commit -m "feat: ..."
& $git push origin main
```

`.gitignore` 已排除 `node_modules/ dist/ release/ .tmp/ .npm-cache/ coverage/` 等，提交前用 `git status` 确认没有把产物带进去。

---

## 12. 排错手册

| 现象                                  | 可能原因                                            | 处理                                                                                                    |
| ------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 双击 exe 没反应                       | 杀软/SmartScreen 拦截；或便携包不完整（只拷了 exe） | 解压整包、允许运行；看 `state\launcher.log`                                                             |
| 服务起来了但浏览器没自动开            | 浏览器进程在后台无窗口、默认浏览器注册异常          | 新版启动器会显式 `--new-window` 并在失败时弹「可点击地址」窗；也可手动访问 `http://127.0.0.1:4180/`     |
| 提示端口 4180 被占用                  | 旧服务没退、其它程序占用                            | 双击 `停止服务.exe`；或 `Get-NetTCPConnection -LocalPort 4180` 查占用进程                               |
| 页面白屏                              | 资源 404 / MIME 不对 / 包不完整                     | F12 看 Network；确认 `runtime/web` 有 `index.html` 与 `assets/`                                         |
| 数据「没了」                          | 换了浏览器或端口                                    | 回到原浏览器原地址；数据仍在原源                                                                        |
| 页面还是旧版                          | SW 缓存未更新                                       | 页面横幅点「刷新以更新」；或 DevTools → Application → Service Workers → Update                          |
| 中文乱码（日志/文本）                 | 编码不匹配                                          | 日志用 `Get-Content -Encoding utf8`；源码只用编辑器改，**绝不用 PowerShell 写源码**（本项目已两次踩坑） |
| 改完代码双击还是旧界面                | 没重新 build/打包                                   | `npm run build && npm run package`，替换包                                                              |
| `npm install` 报 EPERM                | 缓存目录在沙箱外                                    | `.npmrc` 的 `cache` 指向本目录 `.npm-cache`                                                             |
| `npm run preview` 起不来（4180 占用） | 旧服务还在跑                                        | 先关服务/job，再 preview                                                                                |

---

## 13. 已知限制与后续建议（P1 候选）

1. 无拖拽排序（用 ↑/↓）；无批量编辑、跨任务搜索。
2. 备份明文 JSON；加密备份未做。
3. 无 E2E 自动化测试（浏览器行为靠 `scripts/verify-*.mjs` 与手工清单）。
4. 内置服务无 gzip/ETag/Range；单进程单人够用。
5. 老系统需 `package:node` 兜底包。
6. 长期任务「规则版本历史」界面未做（数据已按只追加保存，可后续加查看/对比）。
7. 报告模板占位符固定，未做自定义字段。

---

## 14. 关键决策记录（避免重复讨论）

- **D-方案A**：用内置 .NET 静态服务替代 Node 运行时；保留 Node 模式作兜底，两者共用启动器。
- **端口固定 4180**：不自动顺延，避免「换端口像丢数据」。
- **Hash 路由**：静态服务无需 SPA 回退，刷新不 404。
- **规则版本只追加**：同日最多一版；`reopened` 早于新版本时中间段沿用上一版（DECISION-1）。
- **软删除**：`deletedAt > archivedAt > 生命周期`；回收站查询固定 `archived:'all'`。
- **备份 checksum 对原始 data 计算**：v1 备份补数组前先校验，顺序不可换。
- **页面禁止直连仓储**：ESLint 强制，新增页面走 services。

完整决策见 `docs/architecture/P3.1_data_layer_v2_final_design.md` 第 21/25 章与 `docs/reports/`。

---

## 15. 每次发版的检查清单

- [ ] `npm run check` 通过（typecheck / lint / 全部单测）
- [ ] `npm run build` 成功
- [ ] `npm run package` 产出新包，大小仍 ~1.7 MB
- [ ] §6.4 接口冒烟通过
- [ ] 双击启动 → 页面正常 → 断网刷新仍可用
- [ ] 旧数据仍在（同源 4180）
- [ ] `npm run isolation:check` 通过（必要时定点重建基线）
- [ ] `git status` 干净、提交并推送
- [ ] 更新 `docs/screenshots/` 与本文档「最后更新」日期
