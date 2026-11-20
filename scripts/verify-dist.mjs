// 构建产物自检：确认 PWA 三件套齐全、预缓存覆盖首屏所有资源。
// 用法：node scripts/verify-dist.mjs（先 npm run build）
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dist = join(process.cwd(), 'dist');
const failures = [];

function check(condition, message) {
  if (condition) {
    console.log(`  ok   ${message}`);
  } else {
    failures.push(message);
    console.log(`  FAIL ${message}`);
  }
}

console.log('构建产物自检');

const required = [
  'index.html',
  'sw.js',
  'manifest.webmanifest',
  'favicon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
];
for (const file of required) {
  check(existsSync(join(dist, file)), `存在 ${file}`);
}

const manifest = JSON.parse(readFileSync(join(dist, 'manifest.webmanifest'), 'utf8'));
check(manifest.name === '日程轻量版', `manifest 名称正确（${manifest.name}）`);
check(manifest.lang === 'zh-CN', 'manifest 语言为 zh-CN');
check(manifest.display === 'standalone', 'manifest 可独立安装（standalone）');
check(manifest.start_url === '/', 'manifest start_url 为 /');
const iconSizes = manifest.icons.map((icon) => icon.sizes);
check(iconSizes.includes('192x192'), 'manifest 含 192 图标');
check(iconSizes.includes('512x512'), 'manifest 含 512 图标');
check(
  manifest.icons.some((icon) => icon.purpose === 'maskable'),
  'manifest 含 maskable 图标',
);

const serviceWorker = readFileSync(join(dist, 'sw.js'), 'utf8');
const precached = new Set(
  [...serviceWorker.matchAll(/url:\s*"([^"]+)"/g)].map((match) => match[1]),
);
check(precached.size > 10, `预缓存条目数量合理（${precached.size}）`);
check(precached.has('index.html'), '预缓存包含 index.html');
check(precached.has('manifest.webmanifest'), '预缓存包含 manifest');
check(precached.has('favicon.svg'), '预缓存包含 favicon');

const html = readFileSync(join(dist, 'index.html'), 'utf8');
const referenced = [...html.matchAll(/(?:src|href)="\/([^"]+)"/g)]
  .map((match) => match[1])
  .filter((path) => !path.startsWith('http'));

const uncovered = referenced.filter((path) => !precached.has(path));
check(
  uncovered.length === 0,
  uncovered.length === 0
    ? `index.html 引用的 ${referenced.length} 个资源全部已预缓存（离线首屏可用）`
    : `未预缓存的资源：${uncovered.join(', ')}`,
);

const scriptAssets = [...precached].filter((path) => path.endsWith('.js'));
check(scriptAssets.length >= 8, `预缓存覆盖各页面 chunk（js ${scriptAssets.length} 个）`);

if (failures.length > 0) {
  console.error(`\n自检失败 ${failures.length} 项`);
  process.exit(1);
}
console.log('\n全部通过');
