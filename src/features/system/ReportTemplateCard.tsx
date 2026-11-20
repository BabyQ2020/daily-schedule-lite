import { useEffect, useState } from 'react';
import { App as AntApp, Button, Card, Input, Space, Tabs, Typography } from 'antd';
import { useLiveQuery } from 'dexie-react-hooks';

import type { ReportKind } from '@/domain/types';
import { REPORT_KIND_LABELS } from '@/domain/labels';
import { DEFAULT_REPORT_TEMPLATES, loadSettings, saveSettings } from '@/services/settings';

const { Text } = Typography;

const KINDS: ReportKind[] = ['day', 'week', 'month'];

const PLACEHOLDER_HINT =
  '可用占位符：{{period}} 周期标题、{{summary}} 概览统计、{{tasks}} 任务清单、{{logs}} 日志摘要、{{projects}} 项目进展（仅月报模板）、{{next}} 下期计划。';

/** 报告模板：按日/周/月分别编辑，保存后影响之后生成的草稿，已保存的报告不变。 */
export function ReportTemplateCard() {
  const { message } = AntApp.useApp();
  const settings = useLiveQuery(() => loadSettings(), []);
  const [kind, setKind] = useState<ReportKind>('week');
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (settings) {
      setDraft(settings.reportTemplates[kind]);
    }
  }, [settings, kind]);

  async function handleSave() {
    if (!settings) {
      return;
    }
    if (draft.trim().length === 0) {
      message.error('模板不能为空');
      return;
    }
    setSaving(true);
    try {
      await saveSettings({
        reportTemplates: { ...settings.reportTemplates, [kind]: draft },
      });
      message.success(`${REPORT_KIND_LABELS[kind].label}模板已保存`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '模板保存失败');
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    setDraft(DEFAULT_REPORT_TEMPLATES[kind]);
    message.info('已恢复为默认模板，记得点「保存模板」');
  }

  return (
    <Card title="报告模板" size="small">
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Text type="secondary">
          模板只影响之后新生成的草稿；已保存的报告与快照不会因为改模板而变化。
        </Text>
        <Tabs
          activeKey={kind}
          onChange={(key) => setKind(key as ReportKind)}
          items={KINDS.map((item) => ({ key: item, label: REPORT_KIND_LABELS[item].label }))}
        />
        <Input.TextArea
          aria-label="报告模板"
          value={draft}
          rows={12}
          spellCheck={false}
          onChange={(event) => setDraft(event.target.value)}
        />
        <Text type="secondary">{PLACEHOLDER_HINT}</Text>
        <Space size={8}>
          <Button type="primary" loading={saving} onClick={() => void handleSave()}>
            保存模板
          </Button>
          <Button onClick={handleReset}>恢复默认</Button>
        </Space>
      </Space>
    </Card>
  );
}
