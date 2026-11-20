import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App as AntApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';

import { App } from '@/App';
import { themeConfig } from '@/design/tokens';

import '@/styles/global.css';

dayjs.locale('zh-cn');

const container = document.getElementById('root');
if (!container) {
  throw new Error('找不到 #root 挂载点，index.html 可能被破坏');
}

createRoot(container).render(
  <StrictMode>
    <ConfigProvider locale={zhCN} theme={themeConfig}>
      <AntApp>
        <App />
      </AntApp>
    </ConfigProvider>
  </StrictMode>,
);

// 仅生产构建注册 Service Worker；动态导入避免把 virtual 模块带进测试环境。
if (import.meta.env.PROD) {
  void import('@/app/pwa').then((module) => module.registerAppServiceWorker());
}
