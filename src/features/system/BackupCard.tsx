import { useState } from 'react';
import { App as AntApp, Button, Card, Descriptions, Modal, Space, Typography, Upload } from 'antd';
import { DownloadOutlined, UploadOutlined } from '@ant-design/icons';
import { useLiveQuery } from 'dexie-react-hooks';

import { downloadTextFile } from '@/lib/download';
import { formatDateTime } from '@/lib/format';
import {
  applyBackup,
  describeImportError,
  exportBackup,
  inspectBackupText,
  type BackupInspection,
} from '@/services/backup';
import { getLastBackupAt, markBackupCompleted } from '@/services/settings';
import { useDataRefreshStore } from '@/features/system/data-refresh';

const { Text } = Typography;

const TABLE_LABELS: Record<string, string> = {
  projects: '项目',
  tags: '标签',
  tasks: '任务',
  dailyPlans: '每日计划',
  workLogs: '工作日志',
  reports: '报告',
  settings: '设置',
  meta: '元数据',
};

/** 完整 JSON 备份：导出、导入前校验、覆盖式恢复。 */
export function BackupCard() {
  const { message, modal } = AntApp.useApp();
  const bump = useDataRefreshStore((state) => state.bump);
  const lastBackupAt = useLiveQuery(() => getLastBackupAt(), []);
  const [exporting, setExporting] = useState(false);
  const [inspection, setInspection] = useState<BackupInspection | null>(null);
  const [applying, setApplying] = useState(false);

  async function handleExport() {
    setExporting(true);
    try {
      const { envelope, text, fileName } = await exportBackup({ now: new Date() });
      downloadTextFile(text, fileName, 'application/json;charset=utf-8');
      await markBackupCompleted(envelope.exportedAt);
      bump();
      message.success(`备份已导出：${fileName}`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '备份导出失败');
    } finally {
      setExporting(false);
    }
  }

  async function handleFile(file: File): Promise<boolean> {
    try {
      const text = await file.text();
      const result = inspectBackupText(text);
      setInspection(result);
    } catch (error) {
      modal.error({
        title: '备份文件无法导入',
        content: describeImportError(error),
        okText: '我知道了',
      });
    }
    return false;
  }

  async function handleConfirmImport() {
    if (!inspection) {
      return;
    }
    setApplying(true);
    try {
      const result = await applyBackup(inspection);
      bump();
      setInspection(null);
      message.success(`已恢复 ${result.totalRecords} 条记录`);
    } catch (error) {
      modal.error({
        title: '恢复失败',
        content: describeImportError(error),
        okText: '我知道了',
      });
    } finally {
      setApplying(false);
    }
  }

  const counts = inspection?.counts;

  return (
    <Card title="完整备份与恢复" size="small">
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Text type="secondary">
          备份是一个带 schema 版本号的 JSON
          文件，包含任务、项目、每日计划、日志、报告、标签与设置。恢复会覆盖本机现有数据，不会与现有数据合并。
        </Text>
        <Text>
          最近一次备份：<Text strong>{formatDateTime(lastBackupAt)}</Text>
          {lastBackupAt === null ? '（还没有导出过备份）' : ''}
        </Text>

        <Space wrap size={8}>
          <Button
            type="primary"
            icon={<DownloadOutlined />}
            loading={exporting}
            onClick={() => void handleExport()}
          >
            导出完整备份
          </Button>
          <Upload
            accept=".json,application/json"
            showUploadList={false}
            beforeUpload={(file) => {
              void handleFile(file as unknown as File);
              return false;
            }}
          >
            <Button icon={<UploadOutlined />}>导入备份</Button>
          </Upload>
        </Space>

        <Text type="secondary">
          导入前会先做格式、版本、校验和与引用完整性检查；任何一步不通过都会报错且不写入任何数据。建议导入前先导出当前备份。
        </Text>
      </Space>

      <Modal
        open={inspection !== null}
        title="确认覆盖本机数据"
        okText="覆盖并恢复"
        cancelText="取消"
        okButtonProps={{ danger: true, loading: applying }}
        onOk={() => void handleConfirmImport()}
        onCancel={() => setInspection(null)}
      >
        {inspection ? (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Text>
              即将用备份文件覆盖本机全部数据，共 {inspection.totalRecords} 条记录。此操作不可撤销。
            </Text>
            <Descriptions size="small" column={1} bordered>
              <Descriptions.Item label="备份导出时间">
                {formatDateTime(inspection.exportedAt)}
              </Descriptions.Item>
              <Descriptions.Item label="schema 版本">
                {inspection.envelope.schemaVersion}
                {inspection.migratedFrom !== null
                  ? `（导入时将从 v${inspection.migratedFrom} 迁移）`
                  : ''}
              </Descriptions.Item>
              {counts
                ? Object.entries(counts).map(([table, count]) => (
                    <Descriptions.Item key={table} label={TABLE_LABELS[table] ?? table}>
                      {count}
                    </Descriptions.Item>
                  ))
                : null}
            </Descriptions>
            <Text type="danger">建议先点「导出完整备份」保存当前数据，再进行覆盖恢复。</Text>
          </Space>
        ) : null}
      </Modal>
    </Card>
  );
}
