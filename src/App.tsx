import { HashRouter } from 'react-router-dom';

import { AppRoutes } from '@/app/router';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { PwaPrompt } from '@/components/PwaPrompt';

/**
 * 应用根组件。
 * 使用 HashRouter：本地静态服务器无需配置 SPA fallback，刷新任意页面都不会 404。
 */
export function App() {
  return (
    <ErrorBoundary>
      <HashRouter>
        <PwaPrompt />
        <AppRoutes />
      </HashRouter>
    </ErrorBoundary>
  );
}
