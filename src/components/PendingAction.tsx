import type { ReactNode } from 'react';

import { PlusOutlined } from '@ant-design/icons';
import { Button, Tooltip } from 'antd';

export interface PendingActionProps {
  children: ReactNode;
  hint?: string;
  icon?: ReactNode;
}

/**
 * 阶段 A 的占位动作按钮：功能尚未接入时禁用并说明原因，
 * 避免出现「点了没反应」的假交互。
 */
export function PendingAction({
  children,
  hint = '阶段 B 数据层接入后可用',
  icon = <PlusOutlined />,
}: PendingActionProps) {
  return (
    <Tooltip title={hint}>
      <span style={{ display: 'inline-flex' }}>
        <Button type="primary" icon={icon} disabled>
          {children}
        </Button>
      </span>
    </Tooltip>
  );
}
