import { useEffect, useState } from 'react';
import { App as AntApp, Card, InputNumber, Segmented, Select, Space, Typography } from 'antd';
import { useLiveQuery } from 'dexie-react-hooks';

import type { ThemePreference } from '@/domain/types';
import { WEEK_START_OPTIONS, type WeekStart } from '@/lib/period';
import { loadSettings, saveSettings } from '@/services/settings';

const { Text } = Typography;

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
];

/** 偏好设置：周起始日、外观、备份提醒间隔；改动立即落库。 */
export function GeneralSettingsCard() {
  const { message } = AntApp.useApp();
  const settings = useLiveQuery(() => loadSettings(), []);
  const [reminderDays, setReminderDays] = useState<number | null>(null);

  useEffect(() => {
    if (settings) {
      setReminderDays(settings.backupReminderDays);
    }
  }, [settings]);

  async function save(patch: Parameters<typeof saveSettings>[0]) {
    try {
      await saveSettings(patch);
      message.success('设置已保存');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '设置保存失败');
    }
  }

  return (
    <Card title="偏好设置" size="small">
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <div className="settings-row">
          <div className="settings-row__label">
            <Text strong>每周起始日</Text>
            <Text type="secondary">影响周报周期、「本周计划」与日期区间计算。</Text>
          </div>
          <Select<WeekStart>
            aria-label="每周起始日"
            value={settings?.weekStart ?? 1}
            options={WEEK_START_OPTIONS.map((option) => ({
              value: option.value,
              label: option.label,
            }))}
            style={{ width: 140 }}
            loading={!settings}
            onChange={(value) => void save({ weekStart: value })}
          />
        </div>

        <div className="settings-row">
          <div className="settings-row__label">
            <Text strong>外观</Text>
            <Text type="secondary">深色外观属于 P1，当前两种选择都是浅色主题。</Text>
          </div>
          <Segmented<ThemePreference>
            aria-label="外观"
            value={settings?.theme ?? 'system'}
            options={THEME_OPTIONS}
            onChange={(value) => void save({ theme: value })}
          />
        </div>

        <div className="settings-row">
          <div className="settings-row__label">
            <Text strong>备份提醒</Text>
            <Text type="secondary">
              打开应用时，若超过该天数没有导出备份，会在设置页与仪表盘提示。提醒不可彻底关闭，避免长期无备份。
            </Text>
          </div>
          <InputNumber
            aria-label="备份提醒间隔（天）"
            min={1}
            max={365}
            value={reminderDays}
            suffix="天"
            style={{ width: 140 }}
            onChange={(value) => setReminderDays(typeof value === 'number' ? value : null)}
            onBlur={() => {
              if (reminderDays !== null && reminderDays !== settings?.backupReminderDays) {
                void save({ backupReminderDays: reminderDays });
              }
            }}
          />
        </div>
      </Space>
    </Card>
  );
}
