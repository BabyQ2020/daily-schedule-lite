// 用无头浏览器截取页面，便于交付时直观查看界面。
// 用法：node scripts/screenshot.mjs [url] [输出文件]
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const BASE_URL = process.env.SHOT_BASE_URL ?? 'http://127.0.0.1:4180';
const DEBUG_PORT = 9444;
// 每次用全新 profile：避免旧 Service Worker 缓存导致截到上一版界面
const PROFILE_DIR = join(process.cwd(), '.tmp', `chrome-shot-profile-${Date.now()}`);

const BROWSERS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];
const browserPath = BROWSERS.find((path) => existsSync(path));
if (!browserPath) throw new Error('未找到浏览器');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitJson(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
    } catch {
      // 端口未就绪
    }
    await sleep(200);
  }
  throw new Error(`等待 ${url} 超时`);
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
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
      ws.addEventListener('error', () => reject(new Error('连接失败')), { once: true });
    });
    return new Cdp(ws);
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = (this.id += 1);
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
}

mkdirSync(PROFILE_DIR, { recursive: true });
const browser = spawn(
  browserPath,
  [
    '--headless=new',
    `--remote-debugging-port=${DEBUG_PORT}`,
    '--remote-allow-origins=*',
    `--user-data-dir=${PROFILE_DIR}`,
    '--no-first-run',
    '--disable-gpu',
    '--window-size=1440,980',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

let cdp;
try {
  await waitJson(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
  const targets = await waitJson(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
  const page = targets.find((target) => target.type === 'page');
  cdp = await Cdp.connect(page.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 980,
    deviceScaleFactor: 2,
    mobile: false,
  });

  const shots = [
    ['/#/', 'docs/screenshots/dashboard.png'],
    ['/#/tasks', 'docs/screenshots/tasks.png'],
  ];

  for (const [hash, output] of shots) {
    await cdp.send('Page.navigate', { url: `${BASE_URL}${hash}` });
    await sleep(3500);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const file = join(process.cwd(), output);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, Buffer.from(data, 'base64'));
    console.log(`written ${file}`);
  }
} finally {
  cdp?.ws.close();
  browser.kill();
}
