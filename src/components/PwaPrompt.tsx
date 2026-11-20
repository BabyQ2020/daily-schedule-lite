import { useEffect } from 'react';

import { App as AntApp, Button } from 'antd';

import { activateUpdate, usePwaStore } from '@/app/pwa-state';

/**
 * 离线就绪与新版本提示。
 * - 离线就绪只提示一次；
 * - 新版本必须用户点「刷新以更新」，不做静默重载。
 */
export function PwaPrompt() {
  const { message } = AntApp.useApp();
  const needRefresh = usePwaStore((state) => state.needRefresh);
  const offlineReady = usePwaStore((state) => state.offlineReady);
  const setOfflineReady = usePwaStore((state) => state.setOfflineReady);

  useEffect(() => {
    if (!offlineReady) return;
    void message.success('已缓存到本机，断网后也能继续使用');
    setOfflineReady(false);
  }, [offlineReady, message, setOfflineReady]);

  if (!needRefresh) return null;

  return (
    <div className="pwa-banner" role="status">
      <span>有新版本可用。刷新后才会使用新版本，当前填写的内容请先保存。</span>
      <Button size="small" type="primary" onClick={activateUpdate}>
        刷新以更新
      </Button>
    </div>
  );
}
