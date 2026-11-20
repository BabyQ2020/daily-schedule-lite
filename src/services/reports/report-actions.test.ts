import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { WorkbenchDatabase } from '@/db/db';
import {
  getReport,
  listReportVersions,
  saveReportSnapshot,
  updateReport,
} from '@/repositories/reports';
import { createLog } from '@/repositories/logs';
import { createTask } from '@/repositories/tasks';
import { createTestDatabase, destroyTestDatabase } from '@/test/db';

import { exportReportMarkdown, findMissingReportPeriod, generateReport } from './report-actions';

const ANCHOR = '2026-11-11'; // 周一 2026-11-09 ~ 周日 2026-11-15

describe('generateReport', () => {
  let database: WorkbenchDatabase;

  beforeEach(async () => {
    database = createTestDatabase('report-actions');
    await createTask(
      {
        title: '写离线缓存',
        planDate: '2026-11-10',
        status: 'done',
        now: '2026-11-10T02:00:00.000Z',
      },
      database,
    );
    await createLog(
      { date: '2026-11-10', title: '注册了 SW', content: '记录', tags: [] },
      database,
    );
  });

  afterEach(async () => {
    await destroyTestDatabase(database);
  });

  it('首次生成新建 v1 草稿', async () => {
    const result = await generateReport('week', ANCHOR, database);

    expect(result.mode).toBe('created');
    expect(result.report.version).toBe(1);
    expect(result.report.isSnapshot).toBe(false);
    expect(result.report.isEdited).toBe(false);
    expect(result.report.periodStart).toBe('2026-11-09');
    expect(result.report.periodEnd).toBe('2026-11-15');
    expect(result.report.body).toContain('写离线缓存');
    expect(result.draft.body).toBe(result.report.body);
  });

  it('未人工编辑时再次生成就地更新，不堆叠版本', async () => {
    const first = await generateReport('week', ANCHOR, database);
    const second = await generateReport('week', ANCHOR, database);

    expect(second.mode).toBe('updated');
    expect(second.report.id).toBe(first.report.id);
    expect(second.report.version).toBe(1);
  });

  it('人工编辑后重新生成另存新版本，旧版本保留', async () => {
    const first = await generateReport('week', ANCHOR, database);
    await updateReport(first.report.id, { body: '这是我手写的周报正文', isEdited: true }, database);

    const second = await generateReport('week', ANCHOR, database);

    expect(second.mode).toBe('versioned');
    expect(second.report.version).toBe(2);
    expect(second.report.id).not.toBe(first.report.id);

    const versions = await listReportVersions('week', '2026-11-09', database);
    expect(versions).toHaveLength(2);
    const edited = await getReport(first.report.id, database);
    expect(edited?.body).toBe('这是我手写的周报正文');
    expect(edited?.isEdited).toBe(true);
  });

  it('快照不会被重新生成覆盖', async () => {
    const first = await generateReport('week', ANCHOR, database);
    const snapshot = await saveReportSnapshot(first.report.id, database);
    expect(snapshot.isSnapshot).toBe(true);

    const second = await generateReport('week', ANCHOR, database);

    expect(second.mode).toBe('versioned');
    expect(second.report.version).toBe(2);
    const frozen = await getReport(first.report.id, database);
    expect(frozen?.isSnapshot).toBe(true);
    expect(frozen?.body).toBe(first.report.body);
  });

  it('不同周期的报告互不影响', async () => {
    const week1 = await generateReport('week', ANCHOR, database);
    const week2 = await generateReport('week', '2026-11-18', database);

    expect(week1.report.version).toBe(1);
    expect(week2.report.version).toBe(1);
    expect(week2.report.periodStart).toBe('2026-11-16');
  });

  it('导出 Markdown 带类型、周期、版本与正文', async () => {
    const { report } = await generateReport('week', ANCHOR, database);
    const markdown = exportReportMarkdown(report);

    expect(markdown.startsWith('> 周报 · 周期 2026-11-09 ~ 2026-11-15 · 草稿 v1 · 自动生成')).toBe(
      true,
    );
    expect(markdown).toContain(report.body.trim());
    expect(markdown).toContain('生成时间：');
    expect(markdown.endsWith('\n')).toBe(true);
  });
});

describe('findMissingReportPeriod', () => {
  let database: WorkbenchDatabase;

  beforeEach(() => {
    database = createTestDatabase('missing-report');
  });

  afterEach(async () => {
    await destroyTestDatabase(database);
  });

  it('上周没有报告时提示补生成', async () => {
    const missing = await findMissingReportPeriod('week', '2026-11-16', database);
    expect(missing).toEqual({ periodStart: '2026-11-09', periodEnd: '2026-11-15' });
  });

  it('上周已有报告时不再提示', async () => {
    await generateReport('week', '2026-11-11', database);
    const missing = await findMissingReportPeriod('week', '2026-11-16', database);
    expect(missing).toBeNull();
  });
});
