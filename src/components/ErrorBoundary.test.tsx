import type { ReactNode } from 'react';

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorBoundary } from '@/components/ErrorBoundary';

let shouldThrow = true;

function FlakyChild(): ReactNode {
  if (shouldThrow) {
    throw new Error('渲染期异常');
  }
  return <p>内容恢复正常</p>;
}

describe('ErrorBoundary', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    shouldThrow = true;
    // React 会把捕获的错误打到 console.error，测试中静音以免污染输出
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
    shouldThrow = true;
  });

  it('子组件抛错时降级为错误面板，而不是白屏', () => {
    render(
      <ErrorBoundary>
        <FlakyChild />
      </ErrorBoundary>,
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('页面出现异常');
    expect(alert).toHaveTextContent('渲染期异常');
    expect(screen.getByRole('button', { name: /刷新页面/ })).toBeInTheDocument();
  });

  it('点击重试后重新渲染子组件', () => {
    render(
      <ErrorBoundary>
        <FlakyChild />
      </ErrorBoundary>,
    );

    shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: /重\s*试/ }));

    expect(screen.getByText('内容恢复正常')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('正常情况下透传子组件', () => {
    shouldThrow = false;
    render(
      <ErrorBoundary>
        <FlakyChild />
      </ErrorBoundary>,
    );

    expect(screen.getByText('内容恢复正常')).toBeInTheDocument();
    expect(consoleError).not.toHaveBeenCalled();
  });
});
