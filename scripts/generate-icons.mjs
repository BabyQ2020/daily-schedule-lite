// 生成 PWA 图标（PNG）与 favicon，避免引入图像处理依赖。
// 产物：public/icons/icon-192.png、icon-512.png、icon-maskable-512.png、public/favicon.svg
// 运行：node scripts/generate-icons.mjs
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const iconsDir = join(root, 'public', 'icons');
mkdirSync(iconsDir, { recursive: true });

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

function encodePng(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const clamp01 = (value) => Math.min(1, Math.max(0, value));

/** 圆角矩形有向距离：内部为负。 */
function roundedRectSdf(px, py, cx, cy, halfW, halfH, radius) {
  const qx = Math.abs(px - cx) - (halfW - radius);
  const qy = Math.abs(py - cy) - (halfH - radius);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  return outside + Math.min(Math.max(qx, qy), 0) - radius;
}

/** 线段有向距离，用于绘制描边。 */
function segmentSdf(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const t = clamp01((apx * abx + apy * aby) / (abx * abx + aby * aby));
  return Math.hypot(apx - abx * t, apy - aby * t);
}

function mix(a, b, t) {
  return a + (b - a) * t;
}

/**
 * 绘制图标：圆角矩形（渐变蓝）+ 白色对勾。
 * maskable 版本铺满画布且图形收进安全区，避免被系统裁切。
 */
function drawIcon(size, { maskable = false } = {}) {
  const pixels = Buffer.alloc(size * size * 4);
  const radius = maskable ? 0 : size * 0.22;
  const glyphScale = maskable ? 0.66 : 0.82;
  const offset = (size * (1 - glyphScale)) / 2;
  const g = (value) => offset + value * size * glyphScale;

  const strokeWidth = size * (maskable ? 0.062 : 0.078);
  const bars = [
    [g(0.2), g(0.52), g(0.42), g(0.74)],
    [g(0.42), g(0.74), g(0.8), g(0.26)],
  ];

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;

      const shape = maskable
        ? -1e9
        : roundedRectSdf(px, py, size / 2, size / 2, size / 2, size / 2, radius);
      const shapeAlpha = clamp01(0.5 - shape);

      const t = y / size;
      const bg = [mix(37, 30, t), mix(99, 64, t), mix(235, 175, t)];

      let glyphAlpha = 0;
      for (const [ax, ay, bx, by] of bars) {
        const distance = segmentSdf(px, py, ax, ay, bx, by);
        glyphAlpha = Math.max(glyphAlpha, clamp01(0.5 + (strokeWidth / 2 - distance)));
      }

      const index = (y * size + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        const base = bg[channel];
        pixels[index + channel] = Math.round(mix(base, 255, glyphAlpha));
      }
      pixels[index + 3] = Math.round(255 * shapeAlpha);
    }
  }

  return encodePng(size, pixels);
}

const targets = [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['icon-maskable-512.png', 512, { maskable: true }],
];

for (const [name, size, options] of targets) {
  const file = join(iconsDir, name);
  writeFileSync(file, drawIcon(size, options));
  console.log(`written ${file}`);
}

const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="日程轻量版">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2563eb" />
      <stop offset="1" stop-color="#1e40af" />
    </linearGradient>
  </defs>
  <rect width="64" height="64" rx="14" fill="url(#g)" />
  <path d="M17 33.5 L27 44 L47 20" fill="none" stroke="#ffffff" stroke-width="6"
        stroke-linecap="round" stroke-linejoin="round" />
</svg>
`;
writeFileSync(join(root, 'public', 'favicon.svg'), favicon);
console.log(`written ${join(root, 'public', 'favicon.svg')}`);
