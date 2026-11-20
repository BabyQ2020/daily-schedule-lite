import '@testing-library/jest-dom/vitest';
// IndexedDB 在 jsdom 中不存在：用 fake-indexeddb 提供实现，测试直接跑真实 Dexie 代码。
import 'fake-indexeddb/auto';

import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
});

/**
 * jsdom 未实现 matchMedia，而 Ant Design 的响应式栅格（Grid.useBreakpoint）依赖它。
 * 这里让 min-width 查询默认命中，使测试运行在「桌面端」布局下（侧栏可见）。
 */
function createMatchMedia(query: string): MediaQueryList {
  const list = {
    matches: !query.includes('max-width'),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => false),
  };
  return list as unknown as MediaQueryList;
}

if (typeof window !== 'undefined') {
  window.matchMedia = (query: string) => createMatchMedia(query);

  class ResizeObserverMock {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }

  globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;

  window.scrollTo = (() => {}) as unknown as typeof window.scrollTo;
  window.HTMLElement.prototype.scrollIntoView = function scrollIntoView(): void {};

  // jsdom 的 getComputedStyle 不支持伪元素参数，rc-table 会传它来测量滚动条，直接忽略该参数。
  const nativeGetComputedStyle = window.getComputedStyle.bind(window);
  window.getComputedStyle = ((element: Element) =>
    nativeGetComputedStyle(element)) as typeof window.getComputedStyle;
}
