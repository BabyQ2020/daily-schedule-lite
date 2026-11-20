import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { WorkbenchDatabase } from '@/db/db';
import { createLog } from '@/repositories/logs';
import { addTaskToPlan, getPlan } from '@/repositories/plans';
import { nextUpdatedAt } from '@/repositories/shared';
import {
  archiveTasks,
  createTask,
  deleteTasks,
  getTask,
  listTasks,
  purgeTasks,
  queryTasks,
  restoreDeletedTasks,
  restoreTasks,
  softDeleteTasks,
  updateTask,
} from '@/repositories/tasks';
import { createTestDatabase, destroyTestDatabase } from '@/test/db';

const T0 = '2026-11-19T10:00:00.000Z';

let database: WorkbenchDatabase;

beforeEach(() => {
  database = createTestDatabase('tasks-deletion');
});

afterEach(async () => {
  await destroyTestDatabase(database);
});

describe('Task.deletedAt 写入与类型', () => {
  it('新建任务显式写入 deletedAt=null', async () => {
    const task = await createTask({ title: '新任务' }, database);
    expect(task.deletedAt).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(task, 'deletedAt')).toBe(true);
  });

  it('历史缺字段记录按未删除读取，不被当成已删除', async () => {
    // 模拟 v1 旧版本写入的行：没有 deletedAt 字段。
    // 这里刻意用断言制造旧数据，仅用于验证读取归一化，不代表生产代码存在类型逃逸。
    const legacy = {
      id: 'legacy-task',
      title: '旧版本任务',
      description: '',
      projectId: null,
      status: 'todo',
      priority: 'medium',
      planDate: null,
      dueDate: null,
      completedAt: null,
      parentId: null,
      tags: [],
      note: '',
      archivedAt: null,
      createdAt: T0,
      updatedAt: T0,
    } as unknown as Parameters<typeof database.tasks.add>[0];
    await database.tasks.add(legacy);

    const fetched = await getTask('legacy-task', database);
    expect(fetched?.deletedAt).toBeNull();
    expect((await listTasks({}, database)).map((task) => task.id)).toEqual(['legacy-task']);
  });
});

describe('查询的删除范围过滤', () => {
  it('默认查询排除软删除任务，回收站只返回软删除任务', async () => {
    const kept = await createTask({ title: '保留' }, database);
    const removed = await createTask({ title: '进回收站' }, database);
    await softDeleteTasks([removed.id], { now: T0 }, database);

    const active = await queryTasks({}, undefined, {}, database);
    expect(active.items.map((task) => task.id)).toEqual([kept.id]);

    const recycled = await queryTasks({ deletion: 'deleted' }, undefined, {}, database);
    expect(recycled.items.map((task) => task.id)).toEqual([removed.id]);

    const all = await queryTasks({ deletion: 'all' }, undefined, {}, database);
    expect(all.total).toBe(2);
  });

  it('归档与软删除互相独立：二者可同时存在', async () => {
    const task = await createTask({ title: '又归档又删除' }, database);
    await archiveTasks([task.id], database);
    await softDeleteTasks([task.id], { now: T0 }, database);

    const stored = await database.tasks.get(task.id);
    expect(stored?.archivedAt).not.toBeNull();
    expect(stored?.deletedAt).toBe(T0);

    // 归档筛选只看 archivedAt，删除维度单独生效
    expect((await queryTasks({ archived: 'archived' }, undefined, {}, database)).total).toBe(0);
    expect(
      (await queryTasks({ archived: 'archived', deletion: 'all' }, undefined, {}, database)).total,
    ).toBe(1);
  });

  it('getTask 保持既有语义：软删除任务仍可读取', async () => {
    const task = await createTask({ title: '可读' }, database);
    await softDeleteTasks([task.id], { now: T0 }, database);
    expect((await getTask(task.id, database))?.id).toBe(task.id);
  });
});

describe('软删除与恢复', () => {
  it('软删除保留 archivedAt、保留每日计划引用、不动日志', async () => {
    const task = await createTask({ title: '待软删' }, database);
    await archiveTasks([task.id], database);
    const log = await createLog(
      { date: '2026-11-19', title: '相关日志', taskId: task.id },
      database,
    );
    await addTaskToPlan('2026-11-19', task.id, database);

    const changed = await softDeleteTasks([task.id], { now: T0 }, database);
    expect(changed).toBe(1);

    const stored = await database.tasks.get(task.id);
    expect(stored?.deletedAt).toBe(T0);
    expect(stored?.archivedAt).not.toBeNull();

    const plan = await getPlan('2026-11-19', database);
    expect(plan?.taskIds).toEqual([task.id]);

    const storedLog = await database.workLogs.get(log.id);
    expect(storedLog?.taskId).toBe(task.id);
  });

  it('重复软删除幂等，返回 0 且不改 updatedAt', async () => {
    const task = await createTask({ title: '重复删除' }, database);
    await softDeleteTasks([task.id], { now: T0 }, database);
    const afterFirst = await database.tasks.get(task.id);

    const second = await softDeleteTasks([task.id], { now: '2026-11-20T10:00:00.000Z' }, database);
    expect(second).toBe(0);

    const afterSecond = await database.tasks.get(task.id);
    expect(afterSecond?.updatedAt).toBe(afterFirst?.updatedAt);
    expect(afterSecond?.deletedAt).toBe(T0);
  });

  it('恢复只清 deletedAt，保留 archivedAt', async () => {
    const task = await createTask({ title: '恢复我' }, database);
    await archiveTasks([task.id], database);
    await softDeleteTasks([task.id], { now: T0 }, database);

    const restored = await restoreDeletedTasks(
      [task.id],
      { now: '2026-11-20T10:00:00.000Z' },
      database,
    );
    expect(restored).toBe(1);

    const stored = await database.tasks.get(task.id);
    expect(stored?.deletedAt).toBeNull();
    expect(stored?.archivedAt).not.toBeNull();
  });

  it('对未删除任务执行恢复不产生写入', async () => {
    const task = await createTask({ title: '本来就没删' }, database);
    const before = await database.tasks.get(task.id);

    expect(await restoreDeletedTasks([task.id], { now: T0 }, database)).toBe(0);

    const after = await database.tasks.get(task.id);
    expect(after?.updatedAt).toBe(before?.updatedAt);
  });
});

describe('updatedAt 严格递增', () => {
  it('nextUpdatedAt：now 早于、等于、晚于旧值都严格递增', () => {
    const previous = '2026-11-19T10:00:00.000Z';

    expect(nextUpdatedAt(previous, '2026-11-19T09:00:00.000Z')).toBe('2026-11-19T10:00:00.001Z');
    expect(nextUpdatedAt(previous, previous)).toBe('2026-11-19T10:00:00.001Z');
    expect(nextUpdatedAt(previous, '2026-11-19T11:00:00.000Z')).toBe('2026-11-19T11:00:00.000Z');
  });

  it('同一毫秒连续更新仍严格递增', async () => {
    const task = await createTask({ title: '连续改', now: T0 }, database);
    const first = await updateTask(task.id, { title: '第一次', now: T0 }, database);
    const second = await updateTask(task.id, { title: '第二次', now: T0 }, database);

    expect(Date.parse(first.updatedAt)).toBeGreaterThan(Date.parse(task.updatedAt));
    expect(Date.parse(second.updatedAt)).toBeGreaterThan(Date.parse(first.updatedAt));
  });

  it('注入早于旧值的时间也不会倒退', async () => {
    const task = await createTask({ title: '倒退测试', now: T0 }, database);
    const updated = await updateTask(
      task.id,
      { title: '改一下', now: '2026-11-19T09:00:00.000Z' },
      database,
    );
    expect(Date.parse(updated.updatedAt)).toBeGreaterThan(Date.parse(task.updatedAt));
  });

  it('批量归档/软删除时每条任务各自严格递增', async () => {
    const a = await createTask({ title: 'A', now: T0 }, database);
    const b = await createTask({ title: 'B', now: '2026-11-19T10:00:01.000Z' }, database);

    await archiveTasks([a.id, b.id], database, { now: '2026-11-19T10:00:02.000Z' });
    const archived = [await database.tasks.get(a.id), await database.tasks.get(b.id)];
    expect(Date.parse(archived[0]!.updatedAt)).toBeGreaterThan(Date.parse(a.updatedAt));
    expect(Date.parse(archived[1]!.updatedAt)).toBeGreaterThan(Date.parse(b.updatedAt));

    await restoreTasks([a.id, b.id], database, { now: '2026-11-19T10:00:02.000Z' });
    await softDeleteTasks([a.id, b.id], { now: '2026-11-19T10:00:02.000Z' }, database);
    const deleted = [await database.tasks.get(a.id), await database.tasks.get(b.id)];
    expect(Date.parse(deleted[0]!.updatedAt)).toBeGreaterThan(Date.parse(archived[0]!.updatedAt));
    expect(Date.parse(deleted[1]!.updatedAt)).toBeGreaterThan(Date.parse(archived[1]!.updatedAt));
  });
});

describe('彻底删除的事务原子性', () => {
  async function seed() {
    const task = await createTask({ title: '会被彻底删除' }, database);
    const log = await createLog(
      { date: '2026-11-19', title: '相关日志', taskId: task.id },
      database,
    );
    await addTaskToPlan('2026-11-19', task.id, database);
    return { task, log };
  }

  it('A. dailyPlans 更新失败时整体回滚', async () => {
    const { task, log } = await seed();
    const hook = (): never => {
      throw new Error('inject: dailyPlans 更新失败');
    };
    database.dailyPlans.hook('updating').subscribe(hook);
    try {
      await expect(deleteTasks([task.id], database)).rejects.toThrow('inject');
    } finally {
      database.dailyPlans.hook('updating').unsubscribe(hook);
    }

    // 必须用新事务重新读取（原事务已 abort）
    expect(await database.tasks.get(task.id)).toBeDefined();
    expect((await getPlan('2026-11-19', database))?.taskIds).toEqual([task.id]);
    expect((await database.workLogs.get(log.id))?.taskId).toBe(task.id);
  });

  it('B. workLogs 更新失败时三张表全部回滚', async () => {
    const { task, log } = await seed();
    const before = await database.workLogs.get(log.id);
    const hook = (): never => {
      throw new Error('inject: workLogs 更新失败');
    };
    database.workLogs.hook('updating').subscribe(hook);
    try {
      await expect(deleteTasks([task.id], database)).rejects.toThrow('inject');
    } finally {
      database.workLogs.hook('updating').unsubscribe(hook);
    }

    expect(await database.tasks.get(task.id)).toBeDefined();
    expect((await getPlan('2026-11-19', database))?.taskIds).toEqual([task.id]);
    const storedLog = await database.workLogs.get(log.id);
    expect(storedLog?.taskId).toBe(task.id);
    expect(storedLog?.taskTitleSnapshot).toBe(before?.taskTitleSnapshot);
  });

  it('C. 正常彻底删除：记录消失、计划摘除、日志置空并保留快照', async () => {
    const { task, log } = await seed();

    const result = await purgeTasks([task.id], database);
    expect(result).toEqual({ deleted: 1, detachedLogs: 1, updatedPlans: 1 });

    expect(await database.tasks.get(task.id)).toBeUndefined();
    expect((await getPlan('2026-11-19', database))?.taskIds).toEqual([]);

    const storedLog = await database.workLogs.get(log.id);
    expect(storedLog?.taskId).toBeNull();
    expect(storedLog?.taskTitleSnapshot).toBe('会被彻底删除');
  });

  it('彻底删除不存在的 id 返回 0，且不影响有效 id', async () => {
    const { task } = await seed();
    const result = await purgeTasks(['missing', task.id], database);
    expect(result.deleted).toBe(1);
  });
});

describe('API 兼容性', () => {
  it('updateTask(id, patch, database) 旧调用方式继续可用', async () => {
    const task = await createTask({ title: '旧调用' }, database);
    const updated = await updateTask(task.id, { title: '新标题' }, database);
    expect(updated.title).toBe('新标题');
  });

  it('archiveTasks / restoreTasks 的 database 参数位置不变', async () => {
    const task = await createTask({ title: '归档兼容' }, database);
    expect(await archiveTasks([task.id], database)).toBe(1);
    expect(await restoreTasks([task.id], database)).toBe(1);
  });

  it('deleteTasks 保持彻底删除语义', async () => {
    const task = await createTask({ title: '直接删除' }, database);
    const result = await deleteTasks([task.id], database);
    expect(result.deleted).toBe(1);
    expect(await database.tasks.get(task.id)).toBeUndefined();
  });
});
