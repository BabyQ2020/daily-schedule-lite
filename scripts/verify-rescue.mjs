// V1–V6 真实浏览器验收：用本机 Chrome/Edge 无头模式 + CDP，在独立 profile 中
// 打开真实的 Service Worker 应用与救援导出页，验证 S8.1 报告 §6 的清单。
//
// 用法：
//   1) npm run build
//   2) npm run preview        （另开终端，保持运行于 4180）
//   3) node scripts/verify-rescue.mjs
//
// 说明：使用全新 profile，不触碰你日常浏览器里的数据；脚本结束会删除该 profile。
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const BASE_URL = process.env.RESCUE_BASE_URL ?? 'http://127.0.0.1:4180';
const DEBUG_PORT = Number(process.env.RESCUE_DEBUG_PORT ?? 9345);
const PROFILE_DIR = join(process.cwd(), '.tmp', `chrome-rescue-profile-${Date.now()}`);
const DB_NAME = 'daily-schedule-lite';
const TABLE_COUNT = 11;

const BROWSERS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

const browserPath = BROWSERS.find((path) => existsSync(path));
if (!browserPath) {
  console.error('未找到 Chrome 或 Edge，无法执行救援页验收');
  process.exit(1);
}

const failures = [];
function check(condition, message) {
  console.log(`  ${condition ? 'ok  ' : 'FAIL'} ${message}`);
  if (!condition) failures.push(message);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForHttp(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
    } catch {
      // 浏览器尚未监听调试端口
    }
    await sleep(250);
  }
  throw new Error(`等待 ${url} 超时`);
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 0;
    this.pending = new Map();
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);
      if (message.error) entry.reject(new Error(message.error.message));
      else entry.resolve(message.result);
    });
  }

  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', () => reject(new Error('CDP WebSocket 连接失败')), {
        once: true,
      });
    });
    return new Cdp(ws);
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = (this.nextId += 1);
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.ws.close();
  }
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text ?? '页面内执行失败');
  }
  return result.result.value;
}

async function waitForExpression(cdp, expression, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await evaluate(cdp, expression)) return true;
    } catch {
      // 页面正在导航，忽略
    }
    await sleep(250);
  }
  return false;
}

/** 只选择「页面」目标，避免拿到 service_worker 目标。 */
async function pageTarget() {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
      const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      // 端口未就绪
    }
    await sleep(250);
  }
  throw new Error('未找到可调试的页面目标');
}

async function goto(cdp, url) {
  await cdp.send('Page.navigate', { url });
  await waitForExpression(cdp, 'document.readyState === "complete"', 25000);
}

const RESCUE_URL = `${BASE_URL}/tools/rescue-export.html`;

if (existsSync(PROFILE_DIR)) rmSync(PROFILE_DIR, { recursive: true, force: true });
mkdirSync(PROFILE_DIR, { recursive: true });

const browser = spawn(
  browserPath,
  [
    '--headless=new',
    `--remote-debugging-port=${DEBUG_PORT}`,
    '--remote-allow-origins=*',
    `--user-data-dir=${PROFILE_DIR}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-extensions',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

let cdp;
try {
  await waitForHttp(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
  const target = await pageTarget();
  cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  console.log('救援页真实浏览器验收（headless + CDP）');
  check(true, `浏览器：${browserPath.split('\\').pop()}`);
  check(true, `目标：${BASE_URL}`);

  // ---- V1：全新 profile、应用尚未启动时，救援页检测到「库不存在」且不建库
  await goto(cdp, RESCUE_URL);
  if (!(await waitForExpression(cdp, 'Boolean(window.__RESCUE_CORE__)', 20000))) {
    throw new Error('救援页未暴露 __RESCUE_CORE__');
  }
  const emptyDetect = await evaluate(
    cdp,
    `window.__RESCUE_CORE__.detect(${JSON.stringify(DB_NAME)})`,
  );
  check(emptyDetect.exists === false, 'V1 库不存在时 detect 返回 exists=false');
  const dbsAfterDetect = await evaluate(
    cdp,
    `indexedDB.databases().then((list) => list.map((d) => d.name))`,
  );
  check(!dbsAfterDetect.includes(DB_NAME), 'V1 检测后未创建空库');

  // ---- 让应用真实启动一次，触发生成 IndexedDB（v2，Dexie 版本 ×10）
  await goto(cdp, `${BASE_URL}/`);
  const dbCreated = await waitForExpression(
    cdp,
    `indexedDB.databases().then((list) => list.some((d) => d.name === ${JSON.stringify(DB_NAME)}))`,
    25000,
  );
  check(dbCreated, 'V2 打开应用后数据库已创建');

  // ---- V2：救援页检测、按真实版本只读打开、读取 11 表
  await goto(cdp, RESCUE_URL);
  await waitForExpression(cdp, 'Boolean(window.__RESCUE_CORE__)', 20000);
  const detect = await evaluate(cdp, `window.__RESCUE_CORE__.detect(${JSON.stringify(DB_NAME)})`);
  check(detect.exists === true, 'V2 detect 返回 exists=true');
  check(
    typeof detect.version === 'number' && detect.version >= 10,
    `V2 版本号为原始 IDB 版本（${detect.version}）`,
  );
  check(detect.version === 20, `V2 库版本为 Dexie v2（原始 IDB 版本 ${detect.version}）`);

  const overflow = await evaluate(
    cdp,
    `window.__RESCUE_CORE__.openExistingReadonly(${JSON.stringify(DB_NAME)}, ${detect.version + 1}, 4000)
       .then(() => 'opened', (error) => 'rejected:' + error.message)`,
  );
  check(String(overflow).startsWith('rejected:'), 'V5 版本高于库时拒绝打开（不升级）');
  const afterOverflow = await evaluate(
    cdp,
    `window.__RESCUE_CORE__.detect(${JSON.stringify(DB_NAME)})`,
  );
  check(afterOverflow.version === detect.version, 'V5 库版本保持不变');

  const readResult = await evaluate(
    cdp,
    `window.__RESCUE_CORE__
       .openExistingReadonly(${JSON.stringify(DB_NAME)}, ${detect.version}, 8000)
       .then((db) => {
         const stores = db.objectStoreNames.length;
         return window.__RESCUE_CORE__.readSnapshot(db, window.__RESCUE_CORE__.TABLES, 10000)
           .then((snapshot) => {
             const envelope = window.__RESCUE_CORE__.buildEnvelope(${JSON.stringify(DB_NAME)}, ${detect.version}, snapshot);
             const tables = window.__RESCUE_CORE__.TABLES.filter((name) => name in snapshot.counts);
             db.close();
             return { stores, tables, counts: snapshot.counts, format: envelope.format, dbVersion: envelope.dbVersion };
           });
       })`,
  );
  check(
    readResult.stores === TABLE_COUNT && readResult.tables.length === TABLE_COUNT,
    `V2 只读读取 ${readResult.stores} 张表（TABLES 中 ${readResult.tables.length} 张命中）`,
  );
  check(
    readResult.format === 'daily-schedule-lite/rescue-snapshot',
    'V6 信封 format 为 rescue-snapshot（不会被当作备份导入）',
  );
  check(readResult.dbVersion === detect.version, 'V6 信封 dbVersion 与检测版本一致');

  // ---- 读取不改数据：再读一次，行数一致
  const second = await evaluate(
    cdp,
    `window.__RESCUE_CORE__
       .openExistingReadonly(${JSON.stringify(DB_NAME)}, ${detect.version}, 8000)
       .then((db) =>
         window.__RESCUE_CORE__
           .readSnapshot(db, window.__RESCUE_CORE__.TABLES, 10000)
           .then((snapshot) => {
             db.close();
             return snapshot.counts;
           }),
       )`,
  );
  check(
    JSON.stringify(second) === JSON.stringify(readResult.counts),
    'V2 两次读取行数一致（只读无副作用）',
  );

  // ---- V4：救援连接持有时，另一处请求升级 → 救援连接收到 versionchange 并关闭，
  //          之后的读取必须失败（不会拿旧连接继续读）
  const held = await evaluate(
    cdp,
    `window.__RESCUE_CORE__
       .openExistingReadonly(${JSON.stringify(DB_NAME)}, ${detect.version}, 8000)
       .then((db) => {
         window.__heldRescueDb = db;
         return 'held';
       }, (error) => 'failed:' + error.message)`,
  );
  check(held === 'held', 'V4 救援连接已持有');
  const upgrade = await evaluate(
    cdp,
    `new Promise((resolve) => {
       const request = indexedDB.open(${JSON.stringify(DB_NAME)}, ${detect.version + 1});
       request.onupgradeneeded = () => {};
       request.onsuccess = () => { request.result.close(); resolve('upgraded'); };
       request.onerror = () => resolve('error:' + (request.error && request.error.name));
       request.onblocked = () => resolve('blocked');
     })`,
  );
  check(upgrade === 'upgraded', `V4 升级请求完成（${upgrade}）`);
  const afterVersionChange = await evaluate(
    cdp,
    `(() => {
       try {
         window.__heldRescueDb.transaction(['tasks'], 'readonly');
         return 'still-open';
       } catch (error) {
         return 'closed:' + error.name;
       }
     })()`,
  );
  check(
    String(afterVersionChange).startsWith('closed:'),
    'V4 版本变更后旧连接已关闭，拒绝继续读取',
  );

  // ---- V3 说明：blocked 需要「另一连接不响应 versionchange」才能稳定复现，手工清单覆盖
  console.log('  skip V3（需要不响应 versionchange 的占用页，手工清单覆盖）');
} catch (error) {
  console.error(`\n验收中断：${error.message}`);
  failures.push(error.message);
} finally {
  cdp?.close();
  browser.kill();
  await sleep(300);
  rmSync(PROFILE_DIR, { recursive: true, force: true });
}

console.log('');
if (failures.length > 0) {
  console.error(`未通过 ${failures.length} 项：`);
  for (const item of failures) console.error(` - ${item}`);
  process.exit(1);
}
console.log('全部验收项通过');
