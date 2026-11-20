import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { WorkbenchDatabase } from '@/db/db';
import {
  createReport,
  getLatestReport,
  listReports,
  saveReportSnapshot,
  updateReport,
} from '@/repositories/reports';
import { createTestDatabase, destroyTestDatabase } from '@/test/db';

let database: WorkbenchDatabase;

beforeEach(() => {
  database = createTestDatabase('reports');
});

afterEach(async () => {
  await destroyTestDatabase(database);
});

const baseInput = {
  kind: 'day' as const,
  periodStart: '2026-11-16',
  periodEnd: '2026-11-16',
  metrics: { planned: 3, completed: 2 },
  body: '# 日报草稿',
};

describe('报告仓储', () => {
  it('同一周期重复生成时版本号递增', async () => {
    const first = await createReport(baseInput, database);
    expect(first.version).toBe(1);
    expect(first.isSnapshot).toBe(false);

    const second = await createReport({ ...baseInput, body: '# 日报（第二次）' }, database);
    expect(second.version).toBe(2);

    const latest = await getLatestReport('day', '2026-11-16', database);
    expect(latest?.id).toBe(second.id);
  });

  it('不同周期的版本号互不影响', async () => {
    await createReport(baseInput, database);
    const other = await createReport(
      { ...baseInput, periodStart: '2026-11-17', periodEnd: '2026-11-17' },
      database,
    );
    expect(other.version).toBe(1);
  });

  it('编辑草稿会保留人工编辑标记', async () => {
    const report = await createReport(baseInput, database);
    const edited = await updateReport(
      report.id,
      {
        body: '# 人工修改后',
        isEdited: true,
      },
      database,
    );
    expect(edited.body).toBe('# 人工修改后');
    expect(edited.isEdited).toBe(true);
  });

  it('保存快照后不可再修改', async () => {
    const report = await createReport(baseInput, database);
    const snapshot = await saveReportSnapshot(report.id, database);
    expect(snapshot.isSnapshot).toBe(true);
    expect(snapshot.isEdited).toBe(true);

    await expect(updateReport(report.id, { body: '再改一次' }, database)).rejects.toThrow(
      '已保存为快照',
    );
  });

  it('按类型与快照状态筛选报告', async () => {
    const day = await createReport(baseInput, database);
    await createReport(
      { ...baseInput, kind: 'week', periodStart: '2026-11-16', periodEnd: '2026-11-22' },
      database,
    );
    await saveReportSnapshot(day.id, database);

    expect((await listReports({ kind: 'day' }, database)).length).toBe(1);
    expect((await listReports({ snapshotsOnly: true }, database)).length).toBe(1);
  });

  it('周期开始晚于结束时报错', async () => {
    await expect(
      createReport({ ...baseInput, periodStart: '2026-11-20', periodEnd: '2026-11-10' }, database),
    ).rejects.toThrow('不能晚于结束日期');
  });
});
