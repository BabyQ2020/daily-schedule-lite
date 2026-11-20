import type { WorkbenchDatabase } from '@/db/db';
import { db } from '@/db/db';
import type { Report, ReportKind } from '@/domain/types';
import { REPORT_KIND_LABELS } from '@/domain/labels';
import type { ISODate } from '@/lib/period';
import { formatPeriodLabel, periodFor, shiftPeriod } from '@/lib/period';
import { nowISOString } from '@/lib/clock';
import { createReport, getLatestReport, updateReport } from '@/repositories/reports';
import { loadSettings } from '@/services/settings';

import { loadReportDraft, type ReportDraft } from './report-builder';

export type GenerateMode = 'created' | 'updated' | 'versioned';

export interface GenerateReportResult {
  report: Report;
  draft: ReportDraft;
  mode: GenerateMode;
  /** 同一周期下已有的历史版本数（生成前）。 */
  previousVersions: number;
}

/**
 * 生成当期报告（D14 策略）：
 * - 没有历史版本 → 新建 v1；
 * - 有未人工编辑、未快照的草稿 → 就地更新（避免堆积重复版本）；
 * - 已人工编辑或已快照 → 另存新版本，旧版本原样保留。
 */
export async function generateReport(
  kind: ReportKind,
  anchor: ISODate,
  database: WorkbenchDatabase = db,
): Promise<GenerateReportResult> {
  const draft = await loadReportDraft(kind, anchor, database);
  const latest = await getLatestReport(kind, draft.period.start, database);

  if (!latest) {
    const report = await createReport(
      {
        kind,
        periodStart: draft.period.start,
        periodEnd: draft.period.end,
        metrics: draft.metrics,
        body: draft.body,
      },
      database,
    );
    return { report, draft, mode: 'created', previousVersions: 0 };
  }

  const versions = await database.reports
    .where('[kind+periodStart]')
    .equals([kind, draft.period.start])
    .count();

  if (!latest.isEdited && !latest.isSnapshot) {
    const report = await updateReport(
      latest.id,
      { body: draft.body, metrics: draft.metrics, isEdited: false },
      database,
    );
    return { report, draft, mode: 'updated', previousVersions: versions };
  }

  const report = await createReport(
    {
      kind,
      periodStart: draft.period.start,
      periodEnd: draft.period.end,
      metrics: draft.metrics,
      body: draft.body,
    },
    database,
  );
  return { report, draft, mode: 'versioned', previousVersions: versions };
}

/** 报告导出为 Markdown：元信息头 + 正文（正文本身已是 Markdown）。 */
export function exportReportMarkdown(report: Report): string {
  const kindLabel = REPORT_KIND_LABELS[report.kind].label;
  const periodLabel = formatPeriodLabel({
    kind: report.kind,
    start: report.periodStart,
    end: report.periodEnd,
  });
  const flags = [
    report.isSnapshot ? `快照 v${String(report.version)}` : `草稿 v${String(report.version)}`,
    report.isEdited ? '已人工编辑' : '自动生成',
  ].join(' · ');
  const header = [
    `> ${kindLabel} · 周期 ${periodLabel} · ${flags}`,
    `> 生成时间：${report.generatedAt}（导出时间：${nowISOString()}）`,
  ].join('\n');
  return `${header}\n\n${report.body.trim()}\n`;
}

export function reportMarkdownFileName(report: Report): string {
  const kindLabel = REPORT_KIND_LABELS[report.kind].label;
  const from = report.periodStart;
  const to = report.periodEnd;
  const range = from === to ? from : `${from}至${to}`;
  return `daily-schedule-lite-${kindLabel}-${range}-v${String(report.version)}.md`;
}

/** 周期结束后的首次进入提示：返回最近一个已结束、但还没有任何报告的周期。 */
export async function findMissingReportPeriod(
  kind: ReportKind,
  today: ISODate,
  database: WorkbenchDatabase = db,
): Promise<{ periodStart: ISODate; periodEnd: ISODate } | null> {
  const settings = await loadSettings(database);
  const previous = shiftPeriod(periodFor(kind, today, settings.weekStart), -1);
  const existing = await getLatestReport(kind, previous.start, database);
  if (existing) {
    return null;
  }
  return { periodStart: previous.start, periodEnd: previous.end };
}
