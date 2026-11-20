import { useState } from 'react';
import { App as AntApp, Button, Card, Space, Typography } from 'antd';
import { FileExcelOutlined } from '@ant-design/icons';

import { downloadTextFile } from '@/lib/download';
import { exportLogsCsv, exportTasksCsv } from '@/services/exporters';

const { Text } = Typography;

/** CSV 导出：任务与日志各一个文件，UTF-8 BOM，Excel 打开不乱码。 */
export function ExportCard() {
  const { message } = AntApp.useApp();
  const [busy, setBusy] = useState<'tasks' | 'logs' | null>(null);

  async function handleExportTasks() {
    setBusy('tasks');
    try {
      const result = await exportTasksCsv();
      downloadTextFile(result.text, result.fileName, 'text/csv;charset=utf-8');
      message.success(`已导出 ${result.rowCount} 条任务`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '任务导出失败');
    } finally {
      setBusy(null);
    }
  }

  async function handleExportLogs() {
    setBusy('logs');
    try {
      const result = await exportLogsCsv();
      downloadTextFile(result.text, result.fileName, 'text/csv;charset=utf-8');
      message.success(`已导出 ${result.rowCount} 条日志`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '日志导出失败');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card title="导出与迁移" size="small">
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Text type="secondary">
          CSV 适合在 Excel 中查看或交给其他工具处理；完整迁移请使用上方的 JSON 备份。报告正文的
          Markdown 在「统计与报告」页按版本导出。
        </Text>
        <Space wrap size={8}>
          <Button
            icon={<FileExcelOutlined />}
            loading={busy === 'tasks'}
            onClick={() => void handleExportTasks()}
          >
            导出任务 CSV
          </Button>
          <Button
            icon={<FileExcelOutlined />}
            loading={busy === 'logs'}
            onClick={() => void handleExportLogs()}
          >
            导出日志 CSV
          </Button>
        </Space>
        <Text type="secondary">
          两个文件都带 UTF-8 BOM，字段固定；以 = + - @ 开头的文本会自动加单引号，防止被 Excel
          当作公式执行。
        </Text>
      </Space>
    </Card>
  );
}
