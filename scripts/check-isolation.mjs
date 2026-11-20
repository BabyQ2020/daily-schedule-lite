#!/usr/bin/env node
/**
 * 新旧工程隔离检查 + 源码哈希基线。
 *
 * 背景：新版工程位于旧工程目录内部，旧工程根目录执行 `npm run format`
 * 会递归改写本目录。旧工程不允许改动，因此这里提供两道保险：
 *   1. 身份检查：包名 / 端口 / 数据库名 / 备份格式 / 禁用旧标识；
 *   2. 哈希基线：记录源码哈希，任何被外部工具改写的情况都能被发现。
 *
 * 用法：
 *   node scripts/check-isolation.mjs          # 校验（有漂移则退出码 1）
 *   node scripts/check-isolation.mjs --write  # 写入/更新基线
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const BASELINE = join(ROOT, 'docs', 'isolation', 'source-hashes.json');
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.tmp',
  'release',
  '.npm-cache',
  'coverage',
  '.git',
]);
const HASH_ROOTS = ['src', 'scripts', 'packaging'];
const HASH_FILES = [
  'package.json',
  'vite.config.ts',
  'index.html',
  'tsconfig.json',
  'tsconfig.node.json',
  'eslint.config.js',
  '.npmrc',
];
const TEXT_EXTENSIONS = new Set(['.ts', '.tsx', '.mjs', '.js', '.json', '.cs', '.html', '.md']);
const FORBIDDEN = ['personal-workbench', '4173', '5173', '个人工作台'];
const SELF = relative(ROOT, join(import.meta.dirname, 'check-isolation.mjs'))
  .split(sep)
  .join('/');

const failures = [];
const check = (ok, message) => {
  if (!ok) failures.push(message);
  console.log(`${ok ? '  ok ' : ' FAIL'}  ${message}`);
};

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function listHashTargets() {
  const files = HASH_ROOTS.flatMap((name) => walk(join(ROOT, name)));
  for (const name of HASH_FILES) {
    const full = join(ROOT, name);
    if (existsSync(full)) files.push(full);
  }
  return files
    .map((full) => relative(ROOT, full).split(sep).join('/'))
    .filter((rel) => rel !== SELF)
    .sort();
}

const packageJson = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const viteConfig = readFileSync(join(ROOT, 'vite.config.ts'), 'utf8');
const dbSource = readFileSync(join(ROOT, 'src', 'db', 'db.ts'), 'utf8');
const backupSource = readFileSync(join(ROOT, 'src', 'services', 'backup.ts'), 'utf8');
const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');

console.log('== 身份检查 ==');
check(
  packageJson.name === 'daily-schedule-lite',
  `包名是 daily-schedule-lite（当前：${packageJson.name}）`,
);
check(packageJson.version === '1.0.0', `版本号是 1.0.0（当前：${packageJson.version}）`);
check(/server:\s*\{[^}]*port:\s*5180/s.test(viteConfig), '开发端口为 5180');
check(/preview:\s*\{[^}]*port:\s*4180/s.test(viteConfig), '预览端口为 4180');
check(/DB_NAME\s*=\s*'daily-schedule-lite'/.test(dbSource), '数据库名为 daily-schedule-lite');
check(/DB_VERSION\s*=\s*2\b/.test(dbSource), 'DB_VERSION 为 2（P3.2-S1 起 11 表结构）');
check(
  /SCHEMA_VERSION\s*=\s*2\b/.test(dbSource),
  'SCHEMA_VERSION 为 2（tasks.deletedAt + 长期任务三表）',
);
check(/'daily-schedule-lite\/backup'/.test(backupSource), '备份格式为 daily-schedule-lite/backup');
check(/daily-schedule-lite-backup-/.test(backupSource), '备份文件名前缀已切换');
check(readme.includes('日程轻量版'), 'README 使用新版名称');
check(!readme.includes('personal-workbench'), 'README 不含旧库名');

console.log('== 旧标识扫描 ==');
let leaked = 0;
for (const rel of listHashTargets()) {
  if (rel === SELF) continue;
  const ext = rel.slice(rel.lastIndexOf('.'));
  if (!TEXT_EXTENSIONS.has(ext)) continue;
  const text = readFileSync(join(ROOT, rel), 'utf8');
  for (const token of FORBIDDEN) {
    if (text.includes(token)) {
      leaked += 1;
      console.log(` FAIL  ${rel} 含旧标识「${token}」`);
    }
  }
}
check(leaked === 0, `源码/脚本/配置中无旧标识（命中 ${leaked} 处）`);

const targets = listHashTargets();
const hashes = {};
for (const rel of targets) {
  hashes[rel] = createHash('sha256')
    .update(readFileSync(join(ROOT, rel)))
    .digest('hex');
}

if (process.argv.includes('--write')) {
  mkdirSync(dirname(BASELINE), { recursive: true });
  writeFileSync(
    BASELINE,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), files: hashes }, null, 2)}\n`,
    'utf8',
  );
  console.log(`\n已写入基线：${relative(ROOT, BASELINE)}（${targets.length} 个文件）`);
  if (failures.length > 0) {
    console.error(`\n隔离检查失败：${failures.length} 项`);
    process.exit(1);
  }
  process.exit(0);
}

if (!existsSync(BASELINE)) {
  console.error(`\n缺少基线文件：${relative(ROOT, BASELINE)}`);
  console.error('先运行 npm run isolation:baseline 生成基线。');
  process.exit(1);
}

const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
const before = baseline.files ?? {};
const changed = [];
const added = [];
const removed = [];
for (const [rel, hash] of Object.entries(hashes)) {
  if (!(rel in before)) added.push(rel);
  else if (before[rel] !== hash) changed.push(rel);
}
for (const rel of Object.keys(before)) {
  if (!(rel in hashes)) removed.push(rel);
}

console.log('== 源码哈希基线 ==');
if (changed.length === 0 && added.length === 0 && removed.length === 0) {
  console.log(`  ok   ${targets.length} 个文件与基线一致`);
} else {
  for (const rel of changed) console.log(` CHANGED  ${rel}`);
  for (const rel of added) console.log(` ADDED    ${rel}`);
  for (const rel of removed) console.log(` REMOVED  ${rel}`);
  failures.push('源码与哈希基线不一致（可能被外部工具改写）');
}

if (failures.length > 0) {
  console.error(`\n隔离检查失败：${failures.length} 项`);
  process.exit(1);
}
console.log('\n隔离检查通过。');
