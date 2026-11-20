import { Button, Card, Empty, Input, Space, Tag, Typography } from 'antd';
import {
  CameraOutlined,
  DownloadOutlined,
  EditOutlined,
  ReloadOutlined,
  SaveOutlined,
} from '@ant-design/icons';
import type { ReactNode } from 'react';

import type { Report } from '@/domain/types';
import { REPORT_KIND_LABELS } from '@/domain/labels';

interface ReportEditorProps {
  report: Report | null;
  body: string;
  dirty: boolean;
  busy: boolean;
  onBodyChange: (value: string) => void;
  onSave: () => void;
  onSnapshot: () => void;
  onExport: () => void;
  onRegenerate: () => void;
  onGenerate: () => void;
}

function statusTags(report: Report): ReactNode {
  return (
    <>
      <Tag color="blue">
        {REPORT_KIND_LABELS[report.kind].short}报 v{report.version}
      </Tag>
      {report.isSnapshot ? <Tag color="purple">快照</Tag> : <Tag>草稿</Tag>}
      {report.isEdited ? <Tag color="orange">已人工编辑</Tag> : null}
    </>
  );
}

/** 报告正文编辑器：草稿可改，快照只读——历史报告不随原始数据变化。 */
export function ReportEditor({
  report,
  body,
  dirty,
  busy,
  onBodyChange,
  onSave,
  onSnapshot,
  onExport,
  onRegenerate,
  onGenerate,
}: ReportEditorProps) {
  if (report === null) {
    return (
      <Card size="small" title="报告正文">
        <Empty description="本期还没有报告">
          <Button type="primary" icon={<EditOutlined />} onClick={onGenerate}>
            生成报告草稿
          </Button>
        </Empty>
      </Card>
    );
  }

  const readOnly = report.isSnapshot;

  return (
    <Card
      size="small"
      title={<Space size={6}>报告正文 {statusTags(report)}</Space>}
      extra={
        readOnly ? (
          <Button size="small" icon={<DownloadOutlined />} onClick={onExport}>
            导出 Markdown
          </Button>
        ) : (
          <Space wrap size={8}>
            <Button
              size="small"
              type="primary"
              icon={<SaveOutlined />}
              loading={busy}
              disabled={!dirty}
              onClick={onSave}
            >
              保存修改
            </Button>
            <Button size="small" icon={<CameraOutlined />} loading={busy} onClick={onSnapshot}>
              保存快照
            </Button>
            <Button size="small" icon={<DownloadOutlined />} onClick={onExport}>
              导出 Markdown
            </Button>
            <Button size="small" icon={<ReloadOutlined />} loading={busy} onClick={onRegenerate}>
              重新生成
            </Button>
          </Space>
        )
      }
    >
      {readOnly ? (
        <>
          <Typography.Text type="secondary">
            快照是冻结的版本，如果你想继续修改，请先「重新生成」得到新草稿。
          </Typography.Text>
          <pre className="report-body" aria-label="报告正文">
            {report.body}
          </pre>
        </>
      ) : (
        <>
          {dirty ? (
            <Typography.Text type="secondary" className="report-dirty-hint">
              正文已修改，保存后本版本会标记为「已人工编辑」。
            </Typography.Text>
          ) : null}
          <Input.TextArea
            aria-label="报告正文"
            value={body}
            onChange={(event) => onBodyChange(event.target.value)}
            autoSize={{ minRows: 16, maxRows: 40 }}
            className="report-editor"
          />
        </>
      )}
    </Card>
  );
}
