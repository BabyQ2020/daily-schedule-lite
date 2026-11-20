import { CopyOutlined } from '@ant-design/icons';
import { Alert, App, Button, Card, Descriptions, Space, Tag, Typography } from 'antd';

import type { DailyDraft } from '@/services/reports/daily-draft';

export interface DailyDraftCardProps {
  draft: DailyDraft;
}

export function DailyDraftCard({ draft }: DailyDraftCardProps) {
  const { message } = App.useApp();

  async function handleCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(draft.body);
      message.success('草稿已复制到剪贴板');
    } catch {
      message.error('复制失败，请手动选择文本复制。');
    }
  }

  return (
    <Card
      title="日报草稿预览"
      extra={
        <Button icon={<CopyOutlined />} size="small" onClick={() => void handleCopy()}>
          复制草稿
        </Button>
      }
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="草稿按当前模板实时生成，不会写入数据库"
        description="阶段 F 将支持编辑并保存报告快照；当前可以先复制到任意编辑器里使用。"
      />

      <Space size={[8, 8]} wrap style={{ marginBottom: 12 }}>
        <Tag>计划 {draft.metrics.planned} 项</Tag>
        <Tag color="green">计划完成 {draft.metrics.plannedDone} 项</Tag>
        <Tag>
          完成率{' '}
          {draft.metrics.completionRate === null ? '—' : `${String(draft.metrics.completionRate)}%`}
        </Tag>
        <Tag color="red">逾期 {draft.metrics.overdue}</Tag>
        <Tag color="orange">待结转 {draft.metrics.carryOver}</Tag>
        <Tag>按完成时间 {draft.metrics.doneByCompletion} 项</Tag>
      </Space>

      <Descriptions size="small" column={1} style={{ marginBottom: 8 }}>
        <Descriptions.Item label="标题">{draft.title}</Descriptions.Item>
      </Descriptions>

      <Typography.Text type="secondary">正文</Typography.Text>
      <pre className="draft-preview" aria-label="日报草稿正文">
        {draft.body}
      </pre>
    </Card>
  );
}
