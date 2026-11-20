// 生成 Windows 用的 .ico（多尺寸，内嵌 PNG），供启动器 exe 设置图标。
// 复用 app 图标的绘制逻辑（圆角蓝底 + 白色对勾），不引入图像处理依赖。
// 运行：node packaging/make-ico.mjs
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const SIZES = [16, 24, 32, 48, 64, 128, 256];

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
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0;
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

function roundedRectSdf(px, py, cx, cy, halfW, halfH, radius) {
  const qx = Math.abs(px - cx) - (halfW - radius);
  const qy = Math.abs(py - cy) - (halfH - radius);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  return outside + Math.min(Math.max(qx, qy), 0) - radius;
}

function segmentSdf(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const t = clamp01((apx * abx + apy * aby) / (abx * abx + aby * aby));
  return Math.hypot(apx - abx * t, apy - aby * t);
}

const mix = (a, b, t) => a + (b - a) * t;

function drawIcon(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const radius = size * 0.22;
  const glyphScale = 0.82;
  const offset = (size * (1 - glyphScale)) / 2;
  const g = (value) => offset + value * size * glyphScale;
  const strokeWidth = size * 0.078;
  const bars = [
    [g(0.2), g(0.52), g(0.42), g(0.74)],
    [g(0.42), g(0.74), g(0.8), g(0.26)],
  ];

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;

      const shape = roundedRectSdf(px, py, size / 2, size / 2, size / 2, size / 2, radius);
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
        pixels[index + channel] = Math.round(mix(bg[channel], 255, glyphAlpha));
      }
      pixels[index + 3] = Math.round(255 * shapeAlpha);
    }
  }

  return encodePng(size, pixels);
}

/** ICO 头 + 目录项 + 内嵌 PNG（Vista 起支持 PNG 条目）。 */
function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  const directory = Buffer.alloc(16 * images.length);
  let offset = 6 + 16 * images.length;

  images.forEach((image, index) => {
    const entry = index * 16;
    directory[entry] = image.size >= 256 ? 0 : image.size;
    directory[entry + 1] = image.size >= 256 ? 0 : image.size;
    directory[entry + 2] = 0;
    directory[entry + 3] = 0;
    directory.writeUInt16LE(1, entry + 4);
    directory.writeUInt16LE(32, entry + 6);
    directory.writeUInt32LE(image.png.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += image.png.length;
  });

  return Buffer.concat([header, directory, ...images.map((image) => image.png)]);
}

const images = SIZES.map((size) => ({ size, png: drawIcon(size) }));
const ico = buildIco(images);

const output = join(import.meta.dirname, 'app.ico');
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, ico);
console.log(`written ${output} (${SIZES.join('/')} px, ${ico.length} bytes)`);
