import { useState } from 'react';

import { App, Button, Card, Collapse, Input, List, Space, Typography } from 'antd';

import type { WorkLog } from '@/domain/types';
import type { QuickLogInput } from '@/services/today-actions';

export interface QuickLogCardProps {
  logs: readonly WorkLog[];
  onSave: (input: QuickLogInput) => Promise<void>;
}

export function QuickLogCard({ logs, onSave }: QuickLogCardProps) {
  const { message } = App.useApp();
  const [content, setContent] = useState('');
  const [insight, setInsight] = useState('');
  const [problem, setProblem] = useState('');
  const [solution, setSolution] = useState('');
  const [saving, setSaving] = useState(false);

  const canSave = content.trim().length > 0;

  async function handleSave(): Promise<void> {
    if (!canSave) {
      return;
    }
    setSaving(true);
    try {
      await onSave({ content, insight, problem, solution });
      setContent('');
      setInsight('');
      setProblem('');
      setSolution('');
      message.success('已记录到今日日志');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存日志失败，请稍后重试。');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card
      title={
        <span>
          快速日志 <Typography.Text type="secondary">今天已记 {logs.length} 条</Typography.Text>
        </span>
      }
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Input.TextArea
          rows={4}
          aria-label="快速日志内容"
          placeholder="今天做了什么、遇到什么、怎么解决的（纯文本即可）"
          value={content}
          onChange={(event) => {
            setContent(event.target.value);
          }}
          maxLength={2000}
          showCount
        />

        <Collapse
          ghost
          size="small"
          items={[
            {
              key: 'extra',
              label: '补充：心得 / 问题 / 解决方案（可选）',
              children: (
                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                  <Input.TextArea
                    rows={2}
                    aria-label="心得"
                    placeholder="心得"
                    value={insight}
                    onChange={(event) => {
                      setInsight(event.target.value);
                    }}
                    maxLength={500}
                  />
                  <Input.TextArea
                    rows={2}
                    aria-label="问题"
                    placeholder="问题"
                    value={problem}
                    onChange={(event) => {
                      setProblem(event.target.value);
                    }}
                    maxLength={500}
                  />
                  <Input.TextArea
                    rows={2}
                    aria-label="解决方案"
                    placeholder="解决方案"
                    value={solution}
                    onChange={(event) => {
                      setSolution(event.target.value);
                    }}
                    maxLength={500}
                  />
                </Space>
              ),
            },
          ]}
        />

        <div>
          <Button
            type="primary"
            onClick={() => void handleSave()}
            disabled={!canSave}
            loading={saving}
          >
            保存日志
          </Button>
          <Typography.Text type="secondary" style={{ marginInlineStart: 12 }}>
            标题留空时自动记为「日期 随手记」，可在「工作日志」页补充标签与关联。
          </Typography.Text>
        </div>

        {logs.length > 0 ? (
          <List
            size="small"
            dataSource={logs.slice(0, 5)}
            renderItem={(log) => (
              <List.Item>
                <List.Item.Meta
                  title={log.title}
                  description={
                    <Typography.Paragraph
                      type="secondary"
                      ellipsis={{ rows: 2 }}
                      style={{ marginBottom: 0 }}
                    >
                      {log.content || '（无正文）'}
                    </Typography.Paragraph>
                  }
                />
              </List.Item>
            )}
          />
        ) : null}
      </Space>
    </Card>
  );
}
