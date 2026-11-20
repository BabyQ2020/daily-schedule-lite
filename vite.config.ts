import { fileURLToPath, URL } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

const APP_NAME = '日程轻量版';
const APP_DESCRIPTION = 'Daily Schedule Lite：左侧日程 + 右侧长期任务，本地优先、离线可用';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // prompt：发现新版本时由应用内提示用户刷新，绝不静默接管页面。
      registerType: 'prompt',
      // 由 src/app/pwa.ts 手动注册，便于只在生产环境启用。
      injectRegister: false,
      includeAssets: ['favicon.svg', 'icons/icon-192.png', 'icons/icon-512.png'],
      manifest: {
        name: APP_NAME,
        short_name: APP_NAME,
        description: APP_DESCRIPTION,
        lang: 'zh-CN',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#f4f6fa',
        theme_color: '#2563eb',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // 预缓存全部构建产物，首次加载后断网可用。
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff,woff2}'],
        // Hash 路由始终落在 index.html 上，离线时也能拿到应用外壳。
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        // 主数据在 IndexedDB，这里不缓存任何接口请求（本项目也没有网络请求）。
        runtimeCaching: [],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '127.0.0.1',
    // 与旧版端口分开，新版独立源、独立 IndexedDB，互不影响
    port: 5180,
    strictPort: true,
    // .tmp 下有构建临时文件与无头浏览器 profile，监听它们会导致 EBUSY 崩溃
    watch: { ignored: ['**/.tmp/**'] },
  },
  preview: {
    host: '127.0.0.1',
    port: 4180,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      output: {
        // 把体积大且更新频率低的依赖拆成独立 chunk，利于浏览器缓存
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          antd: ['antd', '@ant-design/icons'],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    // 绝对路径，避免从父目录启动时被解析到旧工程的 setup 文件
    setupFiles: [fileURLToPath(new URL('./src/test/setup.ts', import.meta.url))],
    include: ['src/**/*.test.{ts,tsx}'],
    restoreMocks: true,
    css: false,
    // antd 表格 + 多个 Select 在 jsdom 里首次渲染接近 5s，放宽超时避免边界抖动。
    // 报告页与日程页在 jsdom 下渲染 antd 组件较慢，全量并行时给足余量。
    testTimeout: 30000,
  },
});
