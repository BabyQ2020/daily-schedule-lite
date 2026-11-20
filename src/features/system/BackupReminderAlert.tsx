import { useState, type ReactNode } from 'react';
import { Alert, Space, Typography } from 'antd';
import { useLiveQuery } from 'dexie-react-hooks';

import { countCoreRecords } from '@/services/diagnostics';
import { formatDateTime } from '@/lib/format';
import { getLastBackupAt, loadSettings } from '@/services/settings';

const { Text } = Typography;

const DAY_MS = 24 * 60 * 60 * 1000;

interface ReminderState {
  visible: boolean;
  message: string;
  lastBackupAt: string | null;
}

async function loadReminder(): Promise<ReminderState> {
  const [settings, lastBackupAt, counts] = await Promise.all([
    loadSettings(),
    getLastBackupAt(),
    countCoreRecords(),
  ]);

  const hasData = counts.tasks > 0 || counts.logs > 0;
  if (!hasData) {
    return { visible: false, message: '', lastBackupAt };
  }

  if (lastBackupAt === null) {
    return {
      visible: true,
      message:
        '本机已有数据，但还没有导出过备份。建议现在导出一份完整 JSON 备份，避免误操作或换机时丢失记录。',
      lastBackupAt,
    };
  }

  const lastDate = new Date(lastBackupAt);
  if (Number.isNaN(lastDate.getTime())) {
    return { visible: false, message: '', lastBackupAt };
  }
  const days = Math.floor((Date.now() - lastDate.getTime()) / DAY_MS);
  if (days < settings.backupReminderDays) {
    return { visible: false, message: '', lastBackupAt };
  }

  return {
    visible: true,
    message: `距离上次导出备份已经 ${days} 天（提醒阈值 ${settings.backupReminderDays} 天）。建议导出新的完整备份。`,
    lastBackupAt,
  };
}

interface BackupReminderAlertProps {
  /** 右侧动作，例如「去备份」按钮；不传则只展示文字。 */
  action?: ReactNode;
}

/**
 * 备份提醒（D23）：只在打开应用时检查，不做系统通知、不做后台定时。
 * 关闭只对本次会话有效，刷新后会再次提醒，避免长期无备份。
 */
export function BackupReminderAlert({ action }: BackupReminderAlertProps) {
  const [dismissed, setDismissed] = useState(false);
  const reminder = useLiveQuery(() => loadReminder(), []);

  if (dismissed || !reminder || !reminder.visible) {
    return null;
  }

  return (
    <Alert
      type="warning"
      showIcon
      closable
      onClose={() => setDismissed(true)}
      message="该备份了"
      description={
        <Space direction="vertical" size={2}>
          <Text>{reminder.message}</Text>
          <Text type="secondary">
            最近一次备份：{formatDateTime(reminder.lastBackupAt)} · 数据只保存在本机
          </Text>
        </Space>
      }
      action={action}
    />
  );
}
