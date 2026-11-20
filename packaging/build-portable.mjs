// 构建 Windows 便携版：一个文件夹 + 两个 exe（启动器 / 停止服务），双击即用。
// 前置：先 `npm run build` 产出 dist。
// 运行：node packaging/build-portable.mjs
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const distDir = join(root, 'dist');
const releaseDir = join(root, 'release');
const packageName = '日程轻量版便携版';
const targetDir = join(releaseDir, packageName);
const zipPath = join(releaseDir, `${packageName}.zip`);
const iconFile = join(root, 'packaging', 'app.ico');

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

function ok(message) {
  console.log(`✓ ${message}`);
}

function sizeOf(path) {
  let total = 0;
  const stack = [path];
  while (stack.length > 0) {
    const current = stack.pop();
    const stats = statSync(current);
    if (stats.isDirectory()) {
      for (const entry of readdirSync(current)) stack.push(join(current, entry));
    } else {
      total += stats.size;
    }
  }
  return total;
}

console.log('== 构建便携版 ==');

if (!existsSync(join(distDir, 'index.html'))) {
  fail('找不到 dist/index.html，请先执行：npm run build');
}

// 1. 清空并建立目标目录
rmSync(targetDir, { recursive: true, force: true });
mkdirSync(join(targetDir, 'runtime'), { recursive: true });
ok(`目标目录 ${targetDir}`);

// 2. 拷贝构建产物
cpSync(distDir, join(targetDir, 'runtime', 'web'), { recursive: true });
ok('已拷贝 dist → runtime/web');

// 3. 拷贝静态服务器
copyFileSync(join(root, 'packaging', 'server.mjs'), join(targetDir, 'server.mjs'));
ok('已拷贝 server.mjs');

// 4. 拷贝 node 运行时
const nodeExe = process.execPath;
copyFileSync(nodeExe, join(targetDir, 'runtime', 'node.exe'));
ok(`已拷贝 node 运行时（${(statSync(nodeExe).size / 1024 / 1024).toFixed(1)} MB）`);

// 5. 启动脚本：全部用 %~dp0 相对定位，避免把中文路径写死进 cmd
const startCmd = [
  '@echo off',
  'setlocal',
  'chcp 65001 >nul',
  'cd /d "%~dp0.."',
  'if not exist "%~dp0..\\state" mkdir "%~dp0..\\state"',
  '"%~dp0node.exe" server.mjs --root "%~dp0web" --port 4180 --pid-file "%~dp0..\\state\\server.json" >> "%~dp0..\\state\\server.log" 2>&1',
  'exit /b %ERRORLEVEL%',
  '',
].join('\r\n');
writeFileSync(join(targetDir, 'runtime', 'start.cmd'), startCmd, 'utf8');
ok('已写入 runtime/start.cmd');

// 6. 图标
const iconResult = spawnSync(process.execPath, [join(root, 'packaging', 'make-ico.mjs')], {
  cwd: root,
  stdio: 'inherit',
});
if (iconResult.status !== 0 || !existsSync(iconFile)) {
  fail('生成 app.ico 失败');
}

// 7. 编译两个 exe（.NET Framework 自带 csc，无需安装任何 SDK）
const cscCandidates = [
  'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',
  'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe',
];
const csc = cscCandidates.find((candidate) => existsSync(candidate));
if (!csc) {
  fail('找不到 csc.exe（.NET Framework 4.x），无法编译启动器');
}

function compile(args) {
  const result = spawnSync(
    csc,
    [
      '/nologo',
      '/target:winexe',
      '/platform:anycpu',
      '/codepage:65001',
      `/win32icon:${iconFile}`,
      ...args,
    ],
    {
      cwd: root,
      stdio: 'inherit',
    },
  );
  if (result.status !== 0) {
    fail(`编译失败：${args.filter((arg) => arg.endsWith('.cs')).join(' ')}`);
  }
}

compile([
  `/out:${join(targetDir, '日程轻量版.exe')}`,
  '/r:System.Windows.Forms.dll',
  join(root, 'packaging', 'launcher', 'Launcher.cs'),
]);
ok('已编译 日程轻量版.exe');

compile([
  `/out:${join(targetDir, '停止服务.exe')}`,
  '/r:System.Windows.Forms.dll',
  '/r:System.Management.dll',
  join(root, 'packaging', 'stopper', 'Stopper.cs'),
]);
ok('已编译 停止服务.exe');

// 8. 使用说明（带 BOM，避免记事本按 GBK 打开乱码）
const guide = `日程轻量版 便携版 · 使用说明
======================================

一、怎么用
1. 把整个「${packageName}」文件夹复制到电脑上任意位置（可放桌面、U 盘），
   请勿只复制其中的 exe，否则启动器会提示不完整。
2. 双击「日程轻量版.exe」。它会先在本机启动一个只监听 127.0.0.1 的小服务，
   然后自动用默认浏览器打开 http://127.0.0.1:4180/
   首次启动约需 3–10 秒，请等待浏览器自动弹出，不要连续双击。
3. 日常使用中浏览器页面保持打开即可。用完可以只关浏览器页面，
   也可以双击「停止服务.exe」彻底关掉后台服务。

二、数据存在哪里
- 数据保存在浏览器本机（IndexedDB），不联网、不上传、无遥测。
- 关闭页面、关闭服务、重启电脑都不会丢数据。
- 数据跟着「浏览器 + 这个地址」走，请固定用同一个浏览器打开。
  换浏览器（例如 Chrome 换 Edge）会看到一份空数据。
- 换电脑：在「数据」抽屉里导出完整备份 JSON，在新电脑导入即可。

三、常见问题
1. 双击没反应或提示「便携包不完整」：说明 exe 被单独复制出来了，请复制整个文件夹。
2. 提示服务没能启动：查看日志 state\\server.log（就在本文件夹的 state 目录里）。
   最常见原因是端口 4180 被其他程序占用——先关掉占用该端口的程序，或双击
   「停止服务.exe」清理残留后再试。安全软件拦截 node.exe 也会导致同样现象。
3. 浏览器没自动打开：手动访问 http://127.0.0.1:4180/
4. 页面提示「有新版本可用」：便携版不联网更新，可以忽略该提示（不影响使用）。
5. 想更像本地应用：在 Chrome/Edge 地址栏右侧点「安装」图标，可装成桌面应用。

四、给维护者
- 重新构建：源码目录执行 npm run build，再 node packaging/build-portable.mjs
- 服务端口固定 4180（故意不自动顺延：数据按「浏览器 + 端口」隔离，换端口会像丢数据）。
  被占用时服务会退出并写日志，不会静默换端口。
- 运行状态：state\\server.json；日志：state\\server.log；启动器日志：state\\launcher.log。
  若程序所在目录不可写（例如放进 C:\\Program Files），会自动改用
  %LOCALAPPDATA%\\DailyScheduleLite\\。
`;
writeFileSync(`${join(targetDir, '使用说明.txt')}`, `\uFEFF${guide}`, 'utf8');
ok('已写入 使用说明.txt');

// 9. 打 zip，方便整包拷贝到另一台电脑
if (existsSync(zipPath)) rmSync(zipPath, { force: true });
const zipResult = spawnSync(
  'powershell.exe',
  [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `Compress-Archive -LiteralPath '${targetDir}' -DestinationPath '${zipPath}' -CompressionLevel Optimal -Force`,
  ],
  { cwd: root, stdio: 'inherit' },
);
if (zipResult.status !== 0) {
  fail('打包 zip 失败（文件夹已生成，可手动压缩）');
}
ok(`已打包 ${zipPath}`);

const dirSize = sizeOf(targetDir);
console.log('');
console.log('== 完成 ==');
console.log(`文件夹：${targetDir}（${(dirSize / 1024 / 1024).toFixed(1)} MB）`);
console.log(`压缩包：${zipPath}（${(statSync(zipPath).size / 1024 / 1024).toFixed(1)} MB）`);
console.log('下一步：双击「日程轻量版.exe」试跑。');
