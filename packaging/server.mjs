/**
 * 便携版静态服务器（零依赖）。
 *
 * 由「日程轻量版.exe」启动，也可以手动运行：
 *   node server.mjs --root runtime/web --port 4180
 *
 * 只监听 127.0.0.1，不对外网开放；只读取本地文件，不发任何外部请求。
 */
import { createReadStream, mkdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, resolve, sep } from 'node:path';

const BASE_DIR = import.meta.dirname;
const argv = process.argv.slice(2);

function arg(name, fallback) {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
}

const ROOT = resolve(BASE_DIR, arg('root', join('runtime', 'web')));
const PID_FILE = arg('pid-file', '');
const FIRST_PORT = Number(arg('port', '4180')) || 4180;
// 默认不换端口：数据按「浏览器 + 端口」隔离，换端口会让用户误以为数据丢了。
// 需要时可用 --tries 显式开启顺延。
const MAX_TRIES = Math.max(1, Number(arg('tries', '1')) || 1);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

/** 缓存策略：带 hash 的 assets 长缓存；入口与 Service Worker 不缓存，保证能收到更新。 */
function cacheControlFor(urlPath) {
  if (urlPath.startsWith('/assets/')) return 'public, max-age=31536000, immutable';
  if (urlPath === '/sw.js' || urlPath === '/manifest.webmanifest' || urlPath === '/index.html') {
    return 'no-cache';
  }
  if (urlPath.startsWith('/icons/')) return 'public, max-age=2592000';
  return 'no-cache';
}

function sendText(response, status, text) {
  response.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(text);
}

/** 把 URL 路径解析为 ROOT 内的真实文件路径，越界一律拒绝。 */
function resolveWithinRoot(urlPath) {
  const relative = urlPath.replace(/^[/\\]+/, '');
  const target = resolve(ROOT, relative);
  if (target !== ROOT && !target.startsWith(ROOT + sep)) return null;
  return target;
}

function handler(request, response) {
  if (!request.url) {
    sendText(response, 400, 'Bad Request');
    return;
  }

  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
  } catch {
    sendText(response, 400, 'Bad Request');
    return;
  }

  if (urlPath === '/__health') {
    response.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    response.end(JSON.stringify({ ok: true, root: ROOT }));
    return;
  }

  let filePath = resolveWithinRoot(urlPath === '/' ? '/index.html' : urlPath);
  if (!filePath) {
    sendText(response, 403, 'Forbidden');
    return;
  }

  let stats = null;
  try {
    stats = statSync(filePath);
  } catch {
    stats = null;
  }

  if (stats && stats.isDirectory()) {
    filePath = join(filePath, 'index.html');
    try {
      stats = statSync(filePath);
    } catch {
      stats = null;
    }
  }

  // Hash 路由下前端不依赖服务端 fallback；这里仍兜底一次，避免直接打开未知路径时 404。
  if ((!stats || !stats.isFile()) && !extname(urlPath)) {
    filePath = join(ROOT, 'index.html');
    try {
      stats = statSync(filePath);
    } catch {
      stats = null;
    }
  }

  if (!stats || !stats.isFile()) {
    sendText(response, 404, '未找到：' + urlPath);
    return;
  }

  const headers = {
    'Content-Type': MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': String(stats.size),
    'Cache-Control': cacheControlFor(urlPath),
    'Last-Modified': stats.mtime.toUTCString(),
    'X-Content-Type-Options': 'nosniff',
  };

  response.writeHead(200, headers);
  if (request.method === 'HEAD') {
    response.end();
    return;
  }

  const stream = createReadStream(filePath);
  stream.on('error', () => {
    response.destroy();
  });
  stream.pipe(response);
}

function writePidFile(port) {
  if (!PID_FILE) return;
  try {
    mkdirSync(dirname(PID_FILE), { recursive: true });
    writeFileSync(
      PID_FILE,
      JSON.stringify({ pid: process.pid, port, startedAt: new Date().toISOString() }, null, 2),
      'utf8',
    );
  } catch {
    // 写不进状态文件不影响服务本身
  }
}

function removePidFile() {
  if (!PID_FILE) return;
  try {
    unlinkSync(PID_FILE);
  } catch {
    // 已经不存在
  }
}

function start(port, attempt) {
  const server = createServer(handler);

  server.once('error', (error) => {
    if (error && error.code === 'EADDRINUSE' && attempt + 1 < MAX_TRIES) {
      start(port + 1, attempt + 1);
      return;
    }
    if (error && error.code === 'EADDRINUSE') {
      console.error(
        '端口 ' +
          port +
          ' 已被其他程序占用。请关闭占用该端口的程序（或双击「停止服务.exe」）后重试。',
      );
      removePidFile();
      // 用非 0 退出码让启动器知道服务没起来
      process.exit(2);
      return;
    }
    console.error('服务启动失败：' + String(error));
    removePidFile();
    process.exit(1);
  });

  server.listen(port, '127.0.0.1', () => {
    const actualPort = server.address().port;
    writePidFile(actualPort);
    console.log('日程轻量版服务已启动：http://127.0.0.1:' + actualPort + '/');
    console.log('数据保存在浏览器本机（IndexedDB），关闭此进程不会删除数据。');
  });

  const shutdown = () => {
    removePidFile();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('SIGHUP', shutdown);
  process.on('exit', removePidFile);
}

start(FIRST_PORT, 0);
