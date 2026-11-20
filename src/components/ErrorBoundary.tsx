import type { ErrorInfo, ReactNode } from 'react';
import { Component } from 'react';

import { ReloadOutlined } from '@ant-design/icons';
import { Button } from 'antd';

import { ErrorState } from '@/components/states/ErrorState';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * 全局错误边界：任何渲染期异常都不允许出现白屏。
 * 数据保存在本机，刷新不会丢失，因此降级动作以「重试 / 刷新」为主。
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[未捕获异常]', error, info.componentStack);
  }

  private readonly handleReset = (): void => {
    this.setState({ error: null });
  };

  private readonly handleReload = (): void => {
    window.location.reload();
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) {
      return this.props.children;
    }

    return (
      <div style={{ padding: 24 }}>
        <ErrorState
          title="页面出现异常"
          description={`错误信息：${error.message}。可先重试；若仍失败请刷新页面。你的数据保存在本机，刷新不会丢失。`}
          actions={
            <>
              <Button onClick={this.handleReset}>重试</Button>
              <Button type="primary" icon={<ReloadOutlined />} onClick={this.handleReload}>
                刷新页面
              </Button>
            </>
          }
        />
      </div>
    );
  }
}
