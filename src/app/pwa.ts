import { registerSW } from 'virtual:pwa-register';

import { setUpdateHandler, usePwaStore } from '@/app/pwa-state';

let registered = false;

/** 只在生产构建注册；开发与测试环境保持无 Service Worker，便于热更新。 */
export function registerAppServiceWorker(): void {
  if (registered) return;
  if (!import.meta.env.PROD) return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

  registered = true;

  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      usePwaStore.getState().setNeedRefresh(true);
    },
    onOfflineReady() {
      usePwaStore.getState().setOfflineReady(true);
    },
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      // 每小时检查一次更新，且只在页面可见时检查，避免后台空转。
      setInterval(
        () => {
          if (document.visibilityState === 'visible') void registration.update();
        },
        60 * 60 * 1000,
      );
    },
    onRegisterError(error) {
      console.warn('[PWA] Service Worker 注册失败，离线能力不可用', error);
    },
  });

  setUpdateHandler(() => {
    void updateSW(true);
  });
}
