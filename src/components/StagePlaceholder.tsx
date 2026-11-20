import { Alert, Tag } from 'antd';

import { PageContainer } from '@/components/PageContainer';
import { PendingAction } from '@/components/PendingAction';
import { EmptyState } from '@/components/states/EmptyState';

export interface StagePlaceholderProps {
  title: string;
  description: string;
  stage: string;
  features: readonly string[];
  emptyTitle: string;
  emptyDescription: string;
}

/**
 * 阶段 A 的页面骨架：统一说明「本页何时交付什么」，
 * 空状态与占位动作保持真实反馈，不做假交互。
 */
export function StagePlaceholder({
  title,
  description,
  stage,
  features,
  emptyTitle,
  emptyDescription,
}: StagePlaceholderProps) {
  return (
    <PageContainer
      title={title}
      description={description}
      extra={<Tag color="blue">阶段 A 骨架 · 计划 {stage} 交付</Tag>}
    >
      <Alert
        type="info"
        showIcon
        message={`本页已接入路由与布局，业务能力计划在${stage}交付`}
        description={
          <ul className="plan-list">
            {features.map((feature) => (
              <li key={feature}>{feature}</li>
            ))}
          </ul>
        }
      />
      <EmptyState
        title={emptyTitle}
        description={emptyDescription}
        actions={<PendingAction hint={`${stage}接入后可用`}>新建</PendingAction>}
      />
    </PageContainer>
  );
}
