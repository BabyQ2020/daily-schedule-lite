import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { WorkbenchDatabase } from '@/db/db';
import { createTask } from '@/repositories/tasks';
import { createProject } from '@/repositories/projects';
import { createLog } from '@/repositories/logs';
import { periodFor } from '@/lib/period';
import { createTestDatabase, destroyTestDatabase } from '@/test/db';

import { loadPeriodStats } from './period-stats';

const PERIOD = periodFor('week', '2026-11-11', 1); // 2026-11-09 ~ 2026-11-15

describe('loadPeriodStats', () => {
  let database: WorkbenchDatabase;

  beforeEach(() => {
    database = createTestDatabase('period-stats');
  });

  afterEach(async () => {
    await destroyTestDatabase(database);
  });

  async function seedTask(overrides: Parameters<typeof createTask>[0]) {
    return createTask(overrides, database);
  }

  it('按计划日期统计计划任务与完成率', async () => {
    await seedTask({
      title: 'A',
      planDate: '2026-11-09',
      status: 'done',
      now: '2026-11-10T02:00:00.000Z',
    });
    await seedTask({ title: 'B', planDate: '2026-11-10' });
    await seedTask({
      title: 'C',
      planDate: '2026-11-15',
      status: 'done',
      now: '2026-11-15T09:00:00.000Z',
    });
    // 计划日期在周期外，不计入计划任务
    await seedTask({ title: 'D', planDate: '2026-11-16' });

    const stats = await loadPeriodStats('week', PERIOD, database);

    expect(stats.tasks.plannedTotal).toBe(3);
    expect(stats.tasks.plannedDone).toBe(2);
    expect(stats.tasks.completionRate).toBe(67);
  });

  it('区分「按完成时间完成的」与「计划完成的」两个口径', async () => {
    // 本期完成，但计划日期在上期
    await seedTask({
      title: '上期计划本期完成',
      planDate: '2026-11-02',
      status: 'done',
      now: '2026-11-11T03:00:00.000Z',
    });
    // 本期计划，但完成时间是下期
    await seedTask({
      title: '本期计划下期完成',
      planDate: '2026-11-09',
      status: 'done',
      now: '2026-11-20T03:00:00.000Z',
    });

    const stats = await loadPeriodStats('week', PERIOD, database);

    expect(stats.tasks.plannedDone).toBe(1);
    expect(stats.tasks.completedByCompletion).toBe(1);
    expect(stats.completedTasks.map((task) => task.title)).toEqual(['上期计划本期完成']);
  });

  it('统计期末逾期与待结转，且两者不重叠', async () => {
    await seedTask({ title: '逾期', planDate: '2026-11-09', dueDate: '2026-11-12' });
    await seedTask({ title: '结转', planDate: '2026-11-13' });
    await seedTask({ title: '期末后到期', planDate: '2026-11-14', dueDate: '2026-11-30' });
    await seedTask({
      title: '已完成',
      planDate: '2026-11-10',
      dueDate: '2026-11-11',
      status: 'done',
    });
    await seedTask({ title: '取消', planDate: '2026-11-09', status: 'cancelled' });

    const stats = await loadPeriodStats('week', PERIOD, database);

    expect(stats.tasks.overdueAtEnd).toBe(1);
    expect(stats.tasks.carryOverAtEnd).toBe(2);
    expect(stats.carriedTasks.map((task) => task.title).sort()).toEqual(['期末后到期', '结转']);
  });

  it('统计日志条数、覆盖天数与项目进展', async () => {
    const project = await createProject({ name: '离线改造' }, database);
    await seedTask({
      title: '任务一',
      planDate: '2026-11-09',
      projectId: project.id,
      status: 'done',
    });
    await seedTask({ title: '任务二', planDate: '2026-11-10', projectId: project.id });
    await createLog(
      { date: '2026-11-09', title: '日志一', content: '内容', projectId: project.id, tags: [] },
      database,
    );
    await createLog({ date: '2026-11-09', title: '日志二', content: '内容', tags: [] }, database);
    await createLog(
      { date: '2026-11-16', title: '周期外日志', content: '内容', tags: [] },
      database,
    );

    const stats = await loadPeriodStats('week', PERIOD, database);

    expect(stats.logs.total).toBe(2);
    expect(stats.logs.daysWithLogs).toBe(1);
    expect(stats.logEntries.map((log) => log.title)).toEqual(['日志二', '日志一']);
    expect(stats.projects.touched).toHaveLength(1);
    expect(stats.projects.touched[0]).toMatchObject({
      name: '离线改造',
      progress: { percent: 50 },
    });
  });

  it('没有计划任务时完成率为 null，而不是 0', async () => {
    const stats = await loadPeriodStats('week', PERIOD, database);
    expect(stats.tasks.completionRate).toBeNull();
    expect(stats.tasks.plannedTotal).toBe(0);
  });
});
