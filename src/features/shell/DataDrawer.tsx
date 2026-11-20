import { useCallback, useEffect, useState } from 'react';

import { App, Button, Descriptions, Drawer, Space, Tag, Upload, type UploadProps } from 'antd';
import { ExportOutlined, ImportOutlined, ReloadOutlined } from '@ant-design/icons';

import { formatBytes, formatDateTime } from '@/lib/format';
import { downloadTextFile } from '@/lib/download';
import {
  applyBackup,
  describeImportError,
  exportBackup,
  inspectBackupText,
  type BackupInspection,
} from '@/services/backup';
import { collectDiagnostics, type DataDiagnostics } from '@/services/diagnostics';
import { getLastBackupAt, markBackupCompleted } from '@/services/settings';

/**
 * 数据抽屉：备份导出/导入、存储占用与最近备份。
 * 只调用 services，不直接接触 Dexie；导入必须先只读校验并展示摘要。
 */
export function DataDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { message, modal } = App.useApp();
  const [diagnostics, setDiagnostics] = useState<DataDiagnostics | null>(null);
  const [lastBackupAt, setLastBackupAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [report, backupAt] = await Promise.all([collectDiagnostics(), getLastBackupAt()]);
      setDiagnostics(report);
      setLastBackupAt(backupAt);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '读取存储信息失败。');
    }
  }, [message]);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  async function handleExport() {
    setBusy(true);
    try {
      const { envelope, text, fileName } = await exportBackup();
      downloadTextFile(text, fileName, 'application/json;charset=utf-8');
      await markBackupCompleted(envelope.exportedAt);
      message.success('备份已导出，请在浏览器下载列表里确认。');
      await refresh();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '导出失败。');
    } finally {
      setBusy(false);
    }
  }

  const beforeUpload: UploadProps['beforeUpload'] = async (file) => {
    setBusy(true);
    try {
      const text = await file.text();
      const inspection: BackupInspection = await inspectBackupText(text);
      modal.confirm({
        title: '确认用这份备份覆盖本机数据？',
        content: (
          <div>
            <p>
              导出于 {formatDateTime(inspection.exportedAt)}，结构版本{' '}
              {inspection.envelope.schemaVersion}，共 {inspection.totalRecords} 条记录。
            </p>
            {inspection.migratedFrom !== null ? (
              <p>该备份来自旧结构（v{inspection.migratedFrom}），导入时会自动升级。</p>
            ) : null}
            <p>覆盖后当前数据将被替换，无法撤销；建议先导出一份当前备份。</p>
          </div>
        ),
        okText: '覆盖导入',
        okType: 'danger',
        cancelText: '取消',
        onOk: async () => {
          try {
            await applyBackup(inspection);
            message.success('备份已恢复。');
            await refresh();
          } catch (error) {
            modal.error({ title: '恢复失败', content: describeImportError(error) });
          }
        },
      });
    } catch (error) {
      modal.error({ title: '备份无法导入', content: describeImportError(error) });
    } finally {
      setBusy(false);
    }
    return Upload.LIST_IGNORE;
  };

  const storage = diagnostics?.storage;

  return (
    <Drawer title="数据" placement="right" width="min(94vw, 520px)" open={open} onClose={onClose}>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <div className="data-block">
          <h3 className="data-block__title">完整备份</h3>
          <p className="list-hint">
            备份包含普通任务、长期任务、规则版本与例外记录（含已删除内容），是唯一可完整还原的数据。
          </p>
          <Space wrap>
            <Button
              type="primary"
              icon={<ExportOutlined />}
              loading={busy}
              onClick={() => void handleExport()}
            >
              导出备份 JSON
            </Button>
            <Upload beforeUpload={beforeUpload} showUploadList={false} accept=".json">
              <Button icon={<ImportOutlined />} loading={busy}>
                导入备份
              </Button>
            </Upload>
          </Space>
        </div>

        <div className="data-block">
          <h3 className="data-block__title">本机存储</h3>
          <Descriptions size="small" column={1} bordered>
            <Descriptions.Item label="数据库版本">
              <Tag bordered={false}>schema v{diagnostics?.schemaVersion ?? '—'}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="记录总数">
              {diagnostics?.totalRecords ?? '—'}
            </Descriptions.Item>
            <Descriptions.Item label="占用空间">
              {formatBytes(storage?.usage ?? null)}
            </Descriptions.Item>
            <Descriptions.Item label="最近备份">
              {lastBackupAt ? formatDateTime(lastBackupAt) : '还没有导出过备份'}
            </Descriptions.Item>
          </Descriptions>
          <Button type="text" size="small" icon={<ReloadOutlined />} onClick={() => void refresh()}>
            刷新
          </Button>
        </div>

        <p className="list-hint">
          高级设置（周起始日、标签、报告模板、诊断、清空数据）在「系统设置」里。
        </p>
        <Button href="#/settings" onClick={onClose}>
          打开系统设置
        </Button>
      </Space>
    </Drawer>
  );
}
