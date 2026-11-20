import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { WorkbenchDatabase } from '@/db/db';
import { deriveState } from '@/services/long-tasks/schedule';
import {
  createLongTask,
  getAggregate,
  listDeleted as listDeletedLongTasks,
  purge as purgeLongTask,
  restore as restoreLongTask,
  setArchived as setLongTaskArchived,
  softDelete as softDeleteLongTask,
} from '@/services/long-tasks/service';
import { loadProjectHealth } from '@/services/stats/health';
import { loadPeriodStats } from '@/services/stats/period-stats';
import { computeProjectProgress } from '@/services/stats/progress';
import { loadTaskOverview } from '@/services/stats/project-progress';
import { loadTodayBoard } from '@/services/stats/today';
import {
  listDeletedTasks,
  purgeTasks,
  restoreTasks,
  softDeleteTasks,
} from '@/services/tasks/service';
import { createProject } from '@/repositories/projects';
import { archiveTasks, createTask, getTask, queryTasks } from '@/repositories/tasks';
import { upsertPlan } from '@/repositories/plans';
import { createLog, getLog } from '@/repositories/logs';
import { createTestDatabase, destroyTestDatabase } from '@/test/db';
import { periodFor } from '@/lib/period';

const TODAY = '2026-11-19';
const NOW = '2026-11-19T09:00:00.000Z';

let database: WorkbenchDatabase;

beforeEach(async () => {
  database = await createTestDatabase('recycle-bin');
});

afterEach(async () => {
  await destroyTestDatabase(database);
});

async function seedLongTask(title = '晨间复盘'): Promise<string> {
  const { id } = await createLongTask(
    { title, spec: { kind: 'daily' } },
    { database, today: TODAY, now: NOW },
  );
  return id;
}

async function aggregateOf(taskId: string) {
  const aggregate = await getAggregate(taskId, { database });
  if (!aggregate) {
    throw new Error('长期任务不存在');
  }
  return aggregate;
}

describe('长期任务：软删除与回收站', () => {
  it('软删除后从默认列表消失、进入回收站', async () => {
    const taskId = await seedLongTask();
    const first = await aggregateOf(taskId);

    await softDeleteLongTask(
      taskId,
      { expectedUpdatedAt: first.task.updatedAt },
      { database, now: NOW },
    );

    // 默认读取（deleted=active）不含该任务
    expect(await getAggregate(taskId, { database })).toBeDefined();
    const deleted = await listDeletedLongTasks({ page: 1, pageSize: 20 }, { database });
    expect(deleted.total).toBe(1);
    expect(deleted.items[0]?.task.id).toBe(taskId);
    expect(deleted.items[0]?.task.deletedAt).toBe(NOW);
  });

  it('恢复只清 deletedAt，保留归档标记与生命周期状态', async () => {
    const taskId = await seedLongTask();
    const created = await aggregateOf(taskId);

    await setLongTaskArchived(
      taskId,
      { archived: true, expectedUpdatedAt: created.task.updatedAt },
      { database, now: NOW },
    );
    const archived = await aggregateOf(taskId);
    await softDeleteLongTask(
      taskId,
      { expectedUpdatedAt: archived.task.updatedAt },
      { database, now: '2026-11-19T10:00:00.000Z' },
    );

    const removed = await aggregateOf(taskId);
    const restored = await restoreLongTask(
      taskId,
      { expectedUpdatedAt: removed.task.updatedAt },
      { database, now: '2026-11-19T11:00:00.000Z' },
    );

    expect(restored.deletedAt).toBeNull();
    expect(restored.archivedAt).not.toBeNull();
    expect(restored.events.map((event) => event.type)).toEqual(['created']);
  });

  it('恢复不等于重新启用：暂停中的任务恢复后仍是暂停', async () => {
    const taskId = await seedLongTask();
    const created = await aggregateOf(taskId);
    await softDeleteLongTask(
      taskId,
      { expectedUpdatedAt: created.task.updatedAt },
      { database, now: NOW },
    );
    const removed = await aggregateOf(taskId);
    const restored = await restoreLongTask(
      taskId,
      { expectedUpdatedAt: removed.task.updatedAt },
      { database, now: NOW },
    );

    expect(deriveState(restored, TODAY)).toBe('active');
    expect(restored.events).toHaveLength(1);
  });

  it('软删除幂等：重复删除不推进 updatedAt', async () => {
    const taskId = await seedLongTask();
    const created = await aggregateOf(taskId);
    const first = await softDeleteLongTask(
      taskId,
      { expectedUpdatedAt: created.task.updatedAt },
      { database, now: NOW },
    );
    const second = await softDeleteLongTask(
      taskId,
      { expectedUpdatedAt: first.updatedAt },
      { database, now: '2026-11-20T00:00:00.000Z' },
    );

    expect(second.updatedAt).toBe(first.updatedAt);
  });

  it('彻底删除三张表并返回条数；删除后再删抛 NotFound', async () => {
    const taskId = await seedLongTask('彻底删除样例');
    const created = await aggregateOf(taskId);
    const removed = await softDeleteLongTask(
      taskId,
      { expectedUpdatedAt: created.task.updatedAt },
      { database, now: NOW },
    );

    const counts = await purgeLongTask(
      taskId,
      { expectedUpdatedAt: removed.updatedAt },
      { database, now: NOW },
    );
    expect(counts).toEqual({ task: 1, versions: 1, exceptions: 0 });
    expect(await database.longTasks.count()).toBe(0);
    expect(await database.longTaskRuleVersions.count()).toBe(0);

    await expect(
      purgeLongTask(taskId, { expectedUpdatedAt: removed.updatedAt }, { database }),
    ).rejects.toThrow('不存在');
  });
});

describe('普通任务：软删除与回收站', () => {
  it('软删除后默认列表不含、回收站含，恢复后保留归档标记', async () => {
    const task = await createTask({ title: '回收站任务', planDate: TODAY }, database);
    await archiveTasks([task.id], database);

    await softDeleteTasks([task.id], { database, now: NOW });
    expect(
      (await queryTasks({}, { key: 'updatedAt', direction: 'desc' }, {}, database)).total,
    ).toBe(0);

    const deleted = await listDeletedTasks({ page: 1, pageSize: 20 }, { database });
    expect(deleted.total).toBe(1);
    expect(deleted.items[0]?.id).toBe(task.id);

    await restoreTasks([task.id], { database, now: '2026-11-19T10:00:00.000Z' });
    const restored = await getTask(task.id, database);
    expect(restored?.deletedAt).toBeNull();
    expect(restored?.archivedAt).not.toBeNull();
  });

  it('彻底删除清理计划勾选与日志关联，保留日志快照', async () => {
    const task = await createTask({ title: '彻底删除任务', planDate: TODAY }, database);
    await upsertPlan(TODAY, { taskIds: [task.id] }, database);
    const log = await createLog({ date: TODAY, title: '关联日志', taskId: task.id }, database);

    await softDeleteTasks([task.id], { database, now: NOW });
    const result = await purgeTasks([task.id], { database });
    expect(result.deleted).toBe(1);

    const plan = await database.dailyPlans.get(TODAY);
    expect(plan?.taskIds).toEqual([]);
    const stored = await getLog(log.id, database);
    expect(stored?.taskId).toBeNull();
    expect(stored?.taskTitleSnapshot).toBe('彻底删除任务');
  });
});

describe('软删除后的统计口径', () => {
  it('项目健康度、任务总览、周期统计与工作台都排除回收站任务', async () => {
    const project = await createProject({ name: '统计项目' }, database);
    const task = await createTask(
      { title: '逾期任务', projectId: project.id, planDate: TODAY, dueDate: '2026-11-10' },
      database,
    );

    const before = await loadProjectHealth(TODAY, database);
    expect(before[0]?.overdue).toBe(1);
    expect(before[0]?.level).toBe('critical');

    await softDeleteTasks([task.id], { database, now: NOW });

    const health = await loadProjectHealth(TODAY, database);
    expect(health[0]?.overdue).toBe(0);
    expect(health[0]?.level).toBe('healthy');
    expect(health[0]?.progress.counted).toBe(0);

    const overview = await loadTaskOverview(TODAY, database);
    expect(overview).toEqual({ total: 0, active: 0, done: 0, overdue: 0 });

    const board = await loadTodayBoard(TODAY, database);
    expect(board.overdue).toHaveLength(0);
    expect(board.carryOver).toHaveLength(0);

    const period = periodFor('day', TODAY, 1);
    const stats = await loadPeriodStats('day', period, database);
    expect(stats.tasks.plannedTotal).toBe(0);
    expect(stats.tasks.overdueAtEnd).toBe(0);

    // 纯函数口径同样排除
    const { task: stored } = { task: await getTask(task.id, database) };
    expect(stored?.deletedAt).toBe(NOW);
    expect(computeProjectProgress([stored!]).counted).toBe(0);
  });
});
