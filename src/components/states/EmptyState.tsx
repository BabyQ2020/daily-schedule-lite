import type { ReactNode } from 'react';

import { InboxOutlined } from '@ant-design/icons';

import { StatePanel } from '@/components/states/StatePanel';

export interface EmptyStateProps {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
  compact?: boolean;
}

export function EmptyState({
  title,
  description,
  actions,
  icon = <InboxOutlined />,
  compact = false,
}: EmptyStateProps) {
  return (
    <StatePanel
      title={title}
      description={description}
      actions={actions}
      icon={icon}
      compact={compact}
    />
  );
}
