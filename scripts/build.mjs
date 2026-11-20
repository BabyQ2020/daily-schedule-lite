/**
 * 构建包装器。
 *
 * 背景：本机系统临时目录（%TEMP%）中 esbuild 生成的临时文件无法被删除
 * （Windows 返回 EPERM / Access is denied），导致 `vite build` 在
 * vite:esbuild-transpile 阶段失败。把 TMP/TEMP 指向仓库内的 .tmp 目录后
 * 构建稳定通过，因此这里统一设置，避免每台机器手动 export 环境变量。
 *
 * 用法：npm run build（prebuild 会先跑 typecheck，然后执行本脚本）。
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const tmpDir = path.join(root, '.tmp');
mkdirSync(tmpDir, { recursive: true });

const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const result = spawnSync(process.execPath, [viteBin, 'build', ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, TMP: tmpDir, TEMP: tmpDir },
});

if (result.error) {
  console.error('[build] 无法启动 vite：', result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
