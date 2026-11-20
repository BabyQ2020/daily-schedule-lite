import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { WorkbenchDatabase } from '@/db/db';
import { upsertPlan } from '@/repositories/plans';
import { createLog } from '@/repositories/logs';
import { createTask } from '@/repositories/tasks';
import { createTestDatabase, destroyTestDatabase } from '@/test/db';

import { loadDashboard } from './dashboard';

const TODAY = '2026-11-16'; // 周一，本周 2026-11-16 ~ 2026-11-22

describe('loadDashboard', () => {
  let database: WorkbenchDatabase;

  beforeEach(() => {
    database = createTestDatabase('dashboard');
  });

  afterEach(async () => {
    await destroyTestDatabase(database);
  });

  it('今日计划只取未完成任务', async () => {
    const open = await createTask({ title: '未完成任务', planDate: TODAY }, database);
    const done = await createTask(
      { title: '已完成任务', planDate: TODAY, status: 'done' },
      database,
    );
    await upsertPlan(TODAY, { taskIds: [open.id, done.id] }, database);

    const data = await loadDashboard(TODAY, 1, database);

    expect(data.plannedOpen.map((task) => task.id)).toEqual([open.id]);
    expect(data.today.planned).toBe(2);
    expect(data.today.plannedDone).toBe(1);
  });

  it('逾期列表最多 5 条并按截止日期升序，同时给出总数', async () => {
    for (let index = 1; index <= 7; index += 1) {
      await createTask({ title: `逾期 ${index}`, dueDate: `2026-11-0${index}` }, database);
    }

    const data = await loadDashboard(TODAY, 1, database);

    expect(data.overdueTotal).toBe(7);
    expect(data.overdue).toHaveLength(5);
    expect(data.overdue.map((task) => task.dueDate)).toEqual([
      '2026-11-01',
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
    ]);
  });

  it('本周计划合并计划日期与截止日期并去重，按截止日期升序', async () => {
    const both = await createTask(
      { title: '既计划又截止', planDate: '2026-11-17', dueDate: '2026-11-18' },
      database,
    );
    const planOnly = await createTask({ title: '只有计划日期', planDate: '2026-11-16' }, database);
    const dueOnly = await createTask({ title: '只有截止日期', dueDate: '2026-11-17' }, database);
    await createTask({ title: '下周任务', planDate: '2026-11-23' }, database);
    await createTask({ title: '本周已完成', planDate: '2026-11-16', status: 'done' }, database);

    const data = await loadDashboard(TODAY, 1, database);
    const ids = data.week.map((task) => task.id);

    expect(ids.filter((id) => id === both.id)).toHaveLength(1);
    expect(ids).toContain(planOnly.id);
    expect(ids).toContain(dueOnly.id);
    expect(ids[0]).toBe(dueOnly.id); // 2026-11-17 截止在前
    expect(data.weekPeriod.start).toBe('2026-11-16');
    expect(data.weekPeriod.end).toBe('2026-11-22');
  });

  it('最近日志最多 5 条并按日期倒序', async () => {
    for (let index = 1; index <= 6; index += 1) {
      await createLog(
        {
          date: `2026-11-1${index - 1}`,
          title: `日志 ${index}`,
          content: '正文',
          tags: [],
        },
        database,
      );
    }

    const data = await loadDashboard(TODAY, 1, database);

    expect(data.recentLogs).toHaveLength(5);
    expect(data.recentLogs[0]?.title).toBe('日志 6');
  });
});
