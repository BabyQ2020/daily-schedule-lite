import type { WorkbenchDatabase } from '@/db/db';
import { db } from '@/db/db';
import type { Id, Report, ReportKind, ReportMetrics } from '@/domain/types';
import type { ISODate } from '@/lib/period';
import { isISODateString } from '@/domain/guards';
import { nowISOString } from '@/lib/clock';
import { createId } from '@/lib/id';

import { ConflictError, NotFoundError, ValidationError } from './errors';

export interface ReportCreateInput {
  kind: ReportKind;
  periodStart: ISODate;
  periodEnd: ISODate;
  metrics: ReportMetrics;
  body: string;
  isEdited?: boolean;
  generatedAt?: string;
  now?: string;
}

export interface ReportFilter {
  kind?: ReportKind | 'all';
  from?: ISODate;
  to?: ISODate;
  snapshotsOnly?: boolean;
}

export async function listReports(
  filter: ReportFilter = {},
  database: WorkbenchDatabase = db,
): Promise<Report[]> {
  const candidates =
    filter.kind && filter.kind !== 'all'
      ? await database.reports.where('kind').equals(filter.kind).toArray()
      : await database.reports.toArray();
  return candidates
    .filter((report) => {
      if (filter.from && report.periodStart < filter.from) {
        return false;
      }
      if (filter.to && report.periodStart > filter.to) {
        return false;
      }
      if (filter.snapshotsOnly && !report.isSnapshot) {
        return false;
      }
      return true;
    })
    .sort((left, right) => {
      if (left.periodStart !== right.periodStart) {
        return left.periodStart < right.periodStart ? 1 : -1;
      }
      if (left.version !== right.version) {
        return right.version - left.version;
      }
      return left.id < right.id ? 1 : -1;
    });
}

export async function getReport(
  id: Id,
  database: WorkbenchDatabase = db,
): Promise<Report | undefined> {
  return database.reports.get(id);
}

/** 同一 kind + periodStart 下的最新版本（可能被后续编辑覆盖或成为快照）。 */
export async function getLatestReport(
  kind: ReportKind,
  periodStart: ISODate,
  database: WorkbenchDatabase = db,
): Promise<Report | undefined> {
  const versions = await database.reports
    .where('[kind+periodStart]')
    .equals([kind, periodStart])
    .toArray();
  if (versions.length === 0) {
    return undefined;
  }
  return versions.reduce((latest, current) =>
    current.version > latest.version ? current : latest,
  );
}

export async function listReportVersions(
  kind: ReportKind,
  periodStart: ISODate,
  database: WorkbenchDatabase = db,
): Promise<Report[]> {
  const versions = await database.reports
    .where('[kind+periodStart]')
    .equals([kind, periodStart])
    .toArray();
  return versions.sort((left, right) => right.version - left.version);
}

function assertPeriod(kind: ReportKind, start: ISODate, end: ISODate): void {
  if (!isISODateString(start) || !isISODateString(end)) {
    throw new ValidationError('报告周期日期格式不正确（应为 YYYY-MM-DD）。');
  }
  if (start > end) {
    throw new ValidationError('报告周期的开始日期不能晚于结束日期。');
  }
  if (kind !== 'day' && start === end && kind === 'week') {
    throw new ValidationError('周报周期至少需要一天以上。');
  }
}

/** 新增一版报告：版本号在同一 kind + periodStart 内自增。 */
export async function createReport(
  input: ReportCreateInput,
  database: WorkbenchDatabase = db,
): Promise<Report> {
  assertPeriod(input.kind, input.periodStart, input.periodEnd);
  const now = input.now ?? nowISOString();

  return database.transaction('rw', [database.reports], async () => {
    const latest = await getLatestReport(input.kind, input.periodStart, database);
    const report: Report = {
      id: createId('report'),
      kind: input.kind,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      generatedAt: input.generatedAt ?? now,
      metrics: input.metrics,
      body: input.body,
      isEdited: input.isEdited ?? false,
      isSnapshot: false,
      version: (latest?.version ?? 0) + 1,
      createdAt: now,
      updatedAt: now,
    };
    await database.reports.add(report);
    return report;
  });
}

export interface ReportPatch {
  body?: string;
  metrics?: ReportMetrics;
  isEdited?: boolean;
  isSnapshot?: boolean;
  now?: string;
}

/** 更新报告草稿。已快照（isSnapshot=true）的报告不可再改（D14）。 */
export async function updateReport(
  id: Id,
  patch: ReportPatch,
  database: WorkbenchDatabase = db,
): Promise<Report> {
  const existing = await database.reports.get(id);
  if (!existing) {
    throw new NotFoundError('报告');
  }
  if (existing.isSnapshot) {
    throw new ConflictError('该报告已保存为快照，不能再修改。如需调整请重新生成。');
  }
  const now = patch.now ?? nowISOString();
  const next: Report = {
    ...existing,
    ...(patch.body !== undefined ? { body: patch.body } : {}),
    ...(patch.metrics !== undefined ? { metrics: patch.metrics } : {}),
    ...(patch.isEdited !== undefined ? { isEdited: patch.isEdited } : {}),
    ...(patch.isSnapshot !== undefined ? { isSnapshot: patch.isSnapshot } : {}),
    updatedAt: now,
  };
  await database.reports.put(next);
  return next;
}

/** 保存快照：冻结当前版本，此后任何重新生成都不会覆盖它。 */
export async function saveReportSnapshot(
  id: Id,
  database: WorkbenchDatabase = db,
): Promise<Report> {
  return updateReport(id, { isSnapshot: true, isEdited: true }, database);
}

export async function deleteReport(id: Id, database: WorkbenchDatabase = db): Promise<void> {
  await database.reports.delete(id);
}
