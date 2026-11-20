// 离线验收脚本：用本机 Chrome/Edge 的无头模式 + CDP 验证「断网后仍可用」。
//
// 用法：
//   1) npm run build
//   2) npm run preview        （另开一个终端，保持运行）
//   3) node scripts/offline-check.mjs
//
// 校验内容：
//   - Service Worker 注册并接管页面
//   - 切到离线后刷新，应用外壳与首屏仍能渲染
//   - 离线状态下可切换路由（#/tasks）
//   - 离线状态下可新建任务（写 IndexedDB）并读回
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const BASE_URL = process.env.OFFLINE_BASE_URL ?? 'http://127.0.0.1:4180';
const DEBUG_PORT = Number(process.env.OFFLINE_DEBUG_PORT ?? 9333);
const PROFILE_DIR = join(process.cwd(), '.tmp', 'chrome-offline-profile');

const BROWSERS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

const browserPath = BROWSERS.find((path) => existsSync(path));
if (!browserPath) {
  console.error('未找到 Chrome 或 Edge，无法执行离线验收');
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
      // 页面正在重载，忽略
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

/** 用真实鼠标事件点击：headless 下比 element.click() 更接近用户操作。 */
async function clickButtonByText(cdp, text) {
  const rect = await evaluate(
    cdp,
    `(() => {
      const button = [...document.querySelectorAll('button')].find((item) =>
        (item.textContent ?? '').includes(${JSON.stringify(text)}) && !item.disabled);
      if (!button) return null;
      button.scrollIntoView({ block: 'center' });
      const box = button.getBoundingClientRect();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    })()`,
  );
  if (!rect) return false;
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: rect.x,
    y: rect.y,
    button: 'left',
    clickCount: 1,
  });
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: rect.x,
    y: rect.y,
    button: 'left',
    clickCount: 1,
  });
  return true;
}

let cdp;
try {
  await waitForHttp(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
  const target = await pageTarget();
  cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');

  console.log('离线验收（headless Chromium + CDP）');
  check(true, `浏览器：${browserPath.split('\\').pop()}`);

  // 1) 首次在线加载，等待 Service Worker 接管
  await cdp.send('Page.navigate', { url: `${BASE_URL}/` });
  const loaded = await waitForExpression(
    cdp,
    `document.readyState === 'complete' && !!document.querySelector('h1')`,
  );
  check(loaded, '在线首屏加载完成');

  const swReady = await waitForExpression(
    cdp,
    `navigator.serviceWorker.ready.then((registration) => !!registration.active)`,
    30000,
  );
  check(swReady, 'Service Worker 注册并激活');

  // 首次注册后控制器可能尚未接管，刷新一次让它生效
  await cdp.send('Page.reload', { ignoreCache: false });
  await waitForExpression(
    cdp,
    `document.readyState === 'complete' && !!document.querySelector('h1')`,
  );
  const controlled = await waitForExpression(cdp, `!!navigator.serviceWorker.controller`, 15000);
  check(controlled, 'Service Worker 已接管页面');

  // 2) 断网后刷新
  await cdp.send('Network.emulateNetworkConditions', {
    offline: true,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
  await cdp.send('Page.reload', { ignoreCache: false });
  const offlineRendered = await waitForExpression(
    cdp,
    `document.readyState === 'complete' && (document.querySelector('h1')?.textContent ?? '').includes('综合仪表盘')`,
    20000,
  );
  check(offlineRendered, '断网刷新后首屏仍渲染（综合仪表盘）');

  // 3) 离线切换路由
  await evaluate(cdp, `location.hash = '#/tasks'`);
  const tasksRendered = await waitForExpression(
    cdp,
    `(document.querySelector('h1')?.textContent ?? '').includes('全部任务')`,
    20000,
  );
  check(tasksRendered, '离线状态可切换到「全部任务」');

  // 4) 离线新建任务并读回（写 IndexedDB）
  const drawerOpened = await (async () => {
    const buttonReady = await waitForExpression(
      cdp,
      `[...document.querySelectorAll('button')].some((item) => (item.textContent ?? '').includes('新建任务') && !item.disabled)`,
      15000,
    );
    if (!buttonReady) return false;
    await clickButtonByText(cdp, '新建任务');
    return waitForExpression(
      cdp,
      `!!document.querySelector('.ant-drawer input#title') || !!document.querySelector('.ant-drawer .ant-form')`,
      15000,
    );
  })();
  check(drawerOpened, '离线状态可打开「新建任务」抽屉');

  if (!drawerOpened) {
    const snapshot = await evaluate(
      cdp,
      `JSON.stringify({
        h1: document.querySelector('h1')?.textContent ?? null,
        buttons: [...document.querySelectorAll('button')].map((item) => (item.textContent ?? '').trim()).slice(0, 12),
        drawers: document.querySelectorAll('.ant-drawer').length,
        body: (document.body.innerText ?? '').slice(0, 200),
      })`,
    );
    console.log(`  诊断：${snapshot}`);
  }

  if (drawerOpened) {
    await evaluate(
      cdp,
      `(() => {
        const input = document.querySelector('.ant-drawer input#title');
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, '离线创建的任务');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return input.value;
      })()`,
    );
    await sleep(300);
    await evaluate(
      cdp,
      `(() => {
        const button = [...document.querySelectorAll('.ant-drawer button')].find((item) =>
          item.classList.contains('ant-btn-primary'));
        if (button) button.click();
        return !!button;
      })()`,
    );
    const saved = await waitForExpression(
      cdp,
      `document.body.textContent.includes('离线创建的任务')`,
      20000,
    );
    check(saved, '离线状态保存任务并回显到列表');
  }

  // 恢复网络，避免影响后续手动验证
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
} catch (error) {
  failures.push(`执行异常：${error.message}`);
  console.error(error);
} finally {
  cdp?.close();
  browser.kill();
  await sleep(500);
  try {
    rmSync(PROFILE_DIR, { recursive: true, force: true });
  } catch {
    // 浏览器可能仍占用 profile 目录，忽略
  }
}

if (failures.length > 0) {
  console.error(`\n离线验收失败 ${failures.length} 项`);
  process.exit(1);
}
console.log('\n离线验收全部通过');
