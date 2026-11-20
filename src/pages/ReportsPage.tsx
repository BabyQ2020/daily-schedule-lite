import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  DatePicker,
  Segmented,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd';
import { FileTextOutlined, ReloadOutlined } from '@ant-design/icons';
import { useLiveQuery } from 'dexie-react-hooks';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';

import { PageContainer } from '@/components/PageContainer';
import { EmptyState } from '@/components/states/EmptyState';
import { LoadingState } from '@/components/states/LoadingState';
import type { Report, ReportKind } from '@/domain/types';
import { REPORT_KIND_LABELS } from '@/domain/labels';
import { todayISO } from '@/lib/clock';
import { downloadTextFile } from '@/lib/download';
import { formatPeriodLabel, periodFor } from '@/lib/period';
import {
  deleteReport,
  listReportVersions,
  saveReportSnapshot,
  updateReport,
} from '@/services/reports/service';
import { loadSettings } from '@/services/settings';
import { loadPeriodStats } from '@/services/stats/period-stats';
import {
  exportReportMarkdown,
  findMissingReportPeriod,
  generateReport,
  reportMarkdownFileName,
} from '@/services/reports/report-actions';
import { ReportEditor } from '@/features/reports/ReportEditor';
import { ReportMetricsCards } from '@/features/reports/ReportMetricsCards';
import { ReportVersionList } from '@/features/reports/ReportVersionList';

const KIND_OPTIONS: { label: string; value: ReportKind }[] = [
  { label: '日报', value: 'day' },
  { label: '周报', value: 'week' },
  { label: '月报', value: 'month' },
];

/** 统计与报告：周期选择 + 指标核对 + 草稿编辑 + 版本列表。 */
export function ReportsPage() {
  const { message, modal } = AntApp.useApp();

  const [kind, setKind] = useState<ReportKind>('week');
  const [anchor, setAnchor] = useState<string>(todayISO());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  const settings = useLiveQuery(() => loadSettings(), []);
  const period = useMemo(
    () => (settings ? periodFor(kind, anchor, settings.weekStart) : null),
    [settings, kind, anchor],
  );

  const versions = useLiveQuery(
    () =>
      period === null ? Promise.resolve<Report[]>([]) : listReportVersions(kind, period.start),
    [kind, period?.start],
  );

  const stats = useLiveQuery(
    () => (period === null ? Promise.resolve(null) : loadPeriodStats(kind, period)),
    [kind, period?.start, period?.end],
  );

  const missing = useLiveQuery(() => findMissingReportPeriod(kind, todayISO()), [kind]);

  const current: Report | null =
    versions === undefined
      ? null
      : (versions.find((item) => item.id === selectedId) ?? versions[0] ?? null);

  useEffect(() => {
    setSelectedId(null);
  }, [kind, anchor]);

  useEffect(() => {
    setBody(current?.body ?? '');
    // 版本切换或版本内容变化后同步编辑区（current.body 只在保存/生成后变化）
  }, [current?.id, current?.updatedAt, current?.body]);

  const dirty = current !== null && body !== current.body;

  async function handleGenerate(targetAnchor = anchor) {
    setBusy(true);
    try {
      const result = await generateReport(kind, targetAnchor);
      setSelectedId(result.report.id);
      setBody(result.report.body);
      if (result.mode === 'updated') {
        message.success('已更新本期草稿（未人工编辑，就地更新）');
      } else if (result.mode === 'versioned') {
        message.success(`已生成新版本 v${result.report.version}，旧版本保留`);
      } else {
        message.success('已生成报告草稿');
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : '生成报告失败');
    } finally {
      setBusy(false);
    }
  }

  async function handleSave() {
    if (current === null) {
      return;
    }
    setBusy(true);
    try {
      await updateReport(current.id, { body, isEdited: true });
      message.success('已保存修改，本版本标记为「已人工编辑」');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存失败');
    } finally {
      setBusy(false);
    }
  }

  function handleSnapshot() {
    if (current === null) {
      return;
    }
    modal.confirm({
      title: '保存为快照？',
      content: '快照会冻结当前正文，之后原始数据变化也不会影响它；再次生成会另存新版本。',
      okText: '保存快照',
      cancelText: '取消',
      onOk: async () => {
        try {
          await saveReportSnapshot(current.id);
          message.success('已保存快照');
        } catch (error) {
          message.error(error instanceof Error ? error.message : '保存快照失败');
        }
      },
    });
  }

  function handleExport() {
    if (current === null) {
      return;
    }
    downloadTextFile(
      exportReportMarkdown(current),
      reportMarkdownFileName(current),
      'text/markdown;charset=utf-8',
    );
    message.success('已导出 Markdown');
  }

  async function handleDelete(report: Report) {
    try {
      await deleteReport(report.id);
      setSelectedId(null);
      message.success('已删除该版本');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '删除失败');
    }
  }

  function handleMissingGo(periodStart: string) {
    setAnchor(periodStart);
    message.info('已切换到上一周期，点击「生成报告」补齐');
  }

  const periodLabel = period === null ? '—' : formatPeriodLabel(period);

  return (
    <PageContainer
      title="统计与报告"
      description="自动统计本周期的计划完成率、逾期与待结转，生成可编辑的模板草稿，并保存快照。"
      extra={
        <Button
          type="primary"
          icon={<FileTextOutlined />}
          loading={busy}
          onClick={() => void handleGenerate()}
        >
          生成{REPORT_KIND_LABELS[kind].label}
        </Button>
      }
    >
      <Card size="small" className="toolbar-card">
        <Space wrap size={12} align="center">
          <Segmented<ReportKind>
            options={KIND_OPTIONS}
            value={kind}
            onChange={(value) => setKind(value)}
            aria-label="报告类型"
          />
          <DatePicker
            value={dayjs(anchor)}
            allowClear={false}
            onChange={(date: Dayjs | null) => {
              if (date) {
                setAnchor(date.format('YYYY-MM-DD'));
              }
            }}
            aria-label="周期参考日期"
          />
          <Tag color="blue">周期 {periodLabel}</Tag>
          <Button size="small" icon={<ReloadOutlined />} onClick={() => setSelectedId(null)}>
            刷新数据
          </Button>
        </Space>
      </Card>

      {missing ? (
        <Alert
          type="info"
          showIcon
          message={`上一周期（${missing.periodStart} ~ ${missing.periodEnd}）还没有${REPORT_KIND_LABELS[kind].label}`}
          description="周期结束后首次进入统计页会提示补写，不会在后台自动生成。"
          action={
            <Button size="small" onClick={() => handleMissingGo(missing.periodStart)}>
              去补写
            </Button>
          }
        />
      ) : null}

      {stats === undefined ? (
        <LoadingState tip="正在统计本周期数据…" />
      ) : (
        <ReportMetricsCards stats={stats} />
      )}

      <div className="report-layout">
        <div className="report-layout__main">
          {versions === undefined ? (
            <LoadingState tip="正在读取报告版本…" />
          ) : (
            <ReportEditor
              report={current}
              body={body}
              dirty={dirty}
              busy={busy}
              onBodyChange={setBody}
              onSave={() => void handleSave()}
              onSnapshot={handleSnapshot}
              onExport={handleExport}
              onRegenerate={() => void handleGenerate()}
              onGenerate={() => void handleGenerate()}
            />
          )}
        </div>
        <aside className="report-layout__side">
          <Card size="small" title="版本记录">
            {versions === undefined ? (
              <Spin size="small" />
            ) : (
              <ReportVersionList
                versions={versions}
                selectedId={current?.id ?? null}
                onSelect={(report) => setSelectedId(report.id)}
                onDelete={(report) => void handleDelete(report)}
              />
            )}
            <Typography.Paragraph type="secondary" className="report-note">
              未编辑的草稿会被重新生成就地覆盖；已编辑或已保存快照的版本只增不改。
            </Typography.Paragraph>
          </Card>
          {versions !== undefined && versions.length === 0 ? (
            <EmptyState
              title="还没有版本记录"
              description="生成报告后会在这里列出每个版本，快照与草稿都会保留。"
            />
          ) : null}
        </aside>
      </div>
    </PageContainer>
  );
}
