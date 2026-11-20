import type { ReactNode } from 'react';

import { ExclamationCircleOutlined } from '@ant-design/icons';
import { Button } from 'antd';

import { StatePanel } from '@/components/states/StatePanel';

export interface ErrorStateProps {
  title?: string;
  description?: ReactNode;
  onRetry?: () => void;
  actions?: ReactNode;
  compact?: boolean;
}

export function ErrorState({
  title = '数据加载失败',
  description,
  onRetry,
  actions,
  compact = false,
}: ErrorStateProps) {
  const fallbackActions = onRetry ? <Button onClick={onRetry}>重试</Button> : null;

  return (
    <StatePanel
      tone="error"
      icon={<ExclamationCircleOutlined />}
      title={title}
      description={description}
      actions={actions ?? fallbackActions}
      compact={compact}
    />
  );
}
