import { useEffect, useState } from 'react';
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Descriptions,
  Input,
  Modal,
  Space,
  Tag,
  Typography,
} from 'antd';
import { ReloadOutlined } from '@ant-design/icons';

import { formatBytes, formatDateTime } from '@/lib/format';
import {
  clearAllData,
  collectDiagnostics,
  runWriteProbe,
  type DataDiagnostics,
} from '@/services/diagnostics';
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

const CLEAR_PHRASE = '清空全部数据';

/** 存储与数据自检：各表条数、结构版本、存储用量、写入回读、清空数据。 */
export function StorageCard() {
  const { message, modal } = AntApp.useApp();
  const version = useDataRefreshStore((state) => state.version);
  const bump = useDataRefreshStore((state) => state.bump);
  const [diagnostics, setDiagnostics] = useState<DataDiagnostics | null>(null);
  const [loading, setLoading] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearPhrase, setClearPhrase] = useState('');
  const [clearing, setClearing] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      setDiagnostics(await collectDiagnostics());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [version]);

  async function handleProbe() {
    const result = await runWriteProbe();
    if (result.ok) {
      message.success(result.message);
    } else {
      modal.error({ title: '写入自检未通过', content: result.message, okText: '我知道了' });
    }
  }

  async function handleClear() {
    setClearing(true);
    try {
      await clearAllData();
      setClearOpen(false);
      setClearPhrase('');
      bump();
      message.success('本机数据已全部清空');
    } catch (error) {
      modal.error({
        title: '清空失败',
        content: error instanceof Error ? error.message : '未知错误',
        okText: '我知道了',
      });
    } finally {
      setClearing(false);
    }
  }

  return (
    <Card
      title="存储与数据"
      size="small"
      extra={
        <Button
          size="small"
          icon={<ReloadOutlined />}
          loading={loading}
          onClick={() => void refresh()}
        >
          刷新
        </Button>
      }
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        {diagnostics?.error ? <Alert type="error" showIcon message={diagnostics.error} /> : null}

        <Descriptions size="small" column={2} bordered>
          <Descriptions.Item label="结构版本">
            IndexedDB v{diagnostics?.dbVersion ?? '—'} · schema v{diagnostics?.schemaVersion ?? '—'}
          </Descriptions.Item>
          <Descriptions.Item label="记录总数">
            {diagnostics?.totalRecords ?? '—'} 条
          </Descriptions.Item>
          <Descriptions.Item label="已用存储">
            {formatBytes(diagnostics?.storage.usage ?? null)}
            {diagnostics?.storage.quota ? ` / 上限 ${formatBytes(diagnostics.storage.quota)}` : ''}
          </Descriptions.Item>
          <Descriptions.Item label="最近备份">
            {formatDateTime(diagnostics?.lastBackupAt ?? null)}
          </Descriptions.Item>
        </Descriptions>

        <Space wrap size={[8, 8]}>
          {diagnostics
            ? Object.entries(diagnostics.counts).map(([table, count]) => (
                <Tag key={table}>
                  {TABLE_LABELS[table] ?? table} {count}
                </Tag>
              ))
            : null}
        </Space>

        <Space wrap size={8}>
          <Button onClick={() => void handleProbe()}>写入回读自检</Button>
          <Button danger onClick={() => setClearOpen(true)}>
            清空全部数据
          </Button>
        </Space>
        <Text type="secondary">
          清空会删除本机 IndexedDB 中的全部 8 张表，且不可撤销。请先在上方导出完整备份。
        </Text>
      </Space>

      <Modal
        open={clearOpen}
        title="清空全部数据"
        okText="确认清空"
        cancelText="取消"
        okButtonProps={{ danger: true, disabled: clearPhrase !== CLEAR_PHRASE }}
        confirmLoading={clearing}
        onOk={() => void handleClear()}
        onCancel={() => {
          setClearOpen(false);
          setClearPhrase('');
        }}
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Alert
            type="error"
            showIcon
            message="此操作不可撤销"
            description="任务、项目、日志、报告、标签与设置都会被删除。建议先取消，导出完整备份后再回来。"
          />
          <Text>请输入「{CLEAR_PHRASE}」以确认：</Text>
          <Input
            aria-label="清空确认文本"
            value={clearPhrase}
            placeholder={CLEAR_PHRASE}
            onChange={(event) => setClearPhrase(event.target.value)}
          />
        </Space>
      </Modal>
    </Card>
  );
}
