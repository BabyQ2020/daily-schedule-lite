import { create } from 'zustand';

interface PwaState {
  needRefresh: boolean;
  offlineReady: boolean;
  setNeedRefresh: (value: boolean) => void;
  setOfflineReady: (value: boolean) => void;
}

/**
 * Service Worker 的状态容器（不依赖 virtual 模块，测试与 UI 可直接引用）。
 * 更新提示由用户点击触发，不做静默刷新——避免打断正在填写的表单。
 */
export const usePwaStore = create<PwaState>((set) => ({
  needRefresh: false,
  offlineReady: false,
  setNeedRefresh: (value) => set({ needRefresh: value }),
  setOfflineReady: (value) => set({ offlineReady: value }),
}));

let updateHandler: (() => void) | null = null;

/** 由 pwa.ts 在注册成功后注入实际的更新函数。 */
export function setUpdateHandler(handler: (() => void) | null): void {
  updateHandler = handler;
}

/** 用户确认更新：让新 SW 接管并重载页面。 */
export function activateUpdate(): void {
  updateHandler?.();
}
