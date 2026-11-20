import { useState } from 'react';

import { ReloadOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Descriptions, Empty, List, Space, Tag, Typography } from 'antd';

import {
  describeDiagnosisError,
  diagnoseLongTasks,
  type LongTaskDiagnosisReport,
} from '@/services/long-tasks/diagnose';

function formatScannedAt(value: string): string {
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) {
    return value;
  }
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${time.getFullYear()}-${pad(time.getMonth() + 1)}-${pad(time.getDate())} ${pad(
    time.getHours(),
  )}:${pad(time.getMinutes())}:${pad(time.getSeconds())}`;
}

/**
 * 只读一致性诊断：不自动修复，也不阻断启动。
 * 坏掉的聚合会在写入时被拒绝，用户需要先导出备份再处理数据。
 */
export function LongTaskDiagnosticsCard() {
  const [report, setReport] = useState<LongTaskDiagnosisReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function scan() {
    setLoading(true);
    setError(null);
    try {
      setReport(await diagnoseLongTasks());
    } catch (caught) {
      setError(describeDiagnosisError(caught));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card
      title={
        <Space>
          <SafetyCertificateOutlined />
          长期任务一致性诊断
        </Space>
      }
      extra={
        <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void scan()}>
          开始扫描
        </Button>
      }
    >
      <Typography.Paragraph type="secondary">
        只读扫描全部长期任务（含回收站）。发现问题的任务不会被自动修改，也不能继续编辑；请先导出备份再修复数据。
      </Typography.Paragraph>

      {error ? <Alert type="error" showIcon message="扫描失败" description={error} /> : null}

      {report ? (
        <>
          <Descriptions size="small" column={2} bordered>
            <Descriptions.Item label="扫描时间">
              {formatScannedAt(report.scannedAt)}
            </Descriptions.Item>
            <Descriptions.Item label="耗时">{report.durationMs} ms</Descriptions.Item>
            <Descriptions.Item label="长期任务总数">{report.total}</Descriptions.Item>
            <Descriptions.Item label="健康数量">{report.healthy}</Descriptions.Item>
            <Descriptions.Item label="问题数量">
              {report.entries.length > 0 ? (
                <Tag color="red">{report.entries.length}</Tag>
              ) : (
                <Tag color="green">0</Tag>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="孤儿记录">
              <Space size={4}>
                <Tag color={report.orphanVersions > 0 ? 'orange' : 'default'}>
                  版本 {report.orphanVersions}
                </Tag>
                <Tag color={report.orphanExceptions > 0 ? 'orange' : 'default'}>
                  例外 {report.orphanExceptions}
                </Tag>
              </Space>
            </Descriptions.Item>
          </Descriptions>

          {report.entries.length > 0 ? (
            <List
              className="diagnosis-list"
              dataSource={report.entries}
              renderItem={(entry) => (
                <List.Item>
                  <Space direction="vertical" size={4} style={{ width: '100%' }}>
                    <Space>
                      <Typography.Text strong>{entry.title}</Typography.Text>
                      {entry.deleted ? <Tag>回收站</Tag> : null}
                    </Space>
                    {entry.issues.map((issue) => (
                      <Typography.Text
                        key={`${entry.taskId}-${issue.code}-${issue.message}`}
                        type="danger"
                      >
                        {issue.code} · {issue.message}
                      </Typography.Text>
                    ))}
                  </Space>
                </List.Item>
              )}
            />
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有发现一致性问题" />
          )}
        </>
      ) : null}
    </Card>
  );
}
