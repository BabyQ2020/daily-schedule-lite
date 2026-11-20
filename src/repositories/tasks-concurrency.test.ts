import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { WorkbenchDatabase } from '@/db/db';
import { createTag, deleteTag } from '@/repositories/tags';
import { archiveTasks, createTask, softDeleteTasks, updateTask } from '@/repositories/tasks';
import { createTestDatabase, destroyTestDatabase } from '@/test/db';

const T0 = '2026-11-19T10:00:00.000Z';

let database: WorkbenchDatabase;

beforeEach(() => {
  database = createTestDatabase('tasks-concurrency');
});

afterEach(async () => {
  await destroyTestDatabase(database);
});

/** 事务结束后用新的只读事务重读，避免读到被 abort 的旧事务快照。 */
async function readTask(id: string) {
  return database.transaction('r', database.tasks, async () => database.tasks.get(id));
}

describe('并发写入（真实 Promise.all，非串行）', () => {
  it('A. 同一任务两个并发 updateTask：两个字段都保留，updatedAt 严格递增', async () => {
    const task = await createTask({ title: '并发任务', now: T0 }, database);

    const [first, second] = await Promise.all([
      updateTask(task.id, { title: '并发标题' }, database),
      updateTask(task.id, { note: '并发备注' }, database),
    ]);

    const stored = await readTask(task.id);
    expect(stored?.title).toBe('并发标题');
    expect(stored?.note).toBe('并发备注');
    expect(Date.parse(stored?.updatedAt ?? '')).toBeGreaterThan(Date.parse(T0));
    expect(Date.parse(second.updatedAt)).toBeGreaterThan(Date.parse(first.updatedAt));
    expect(stored?.updatedAt).toBe(second.updatedAt);
  });

  it('B. 同一任务 archiveTasks 与 softDeleteTasks 并发：archivedAt 与 deletedAt 互不覆盖', async () => {
    const task = await createTask({ title: '并发归档删除', now: T0 }, database);

    await Promise.all([
      archiveTasks([task.id], database, { now: '2026-11-19T10:01:00.000Z' }),
      softDeleteTasks([task.id], { now: '2026-11-19T10:01:00.000Z' }, database),
    ]);

    const stored = await readTask(task.id);
    expect(stored?.archivedAt).toBe('2026-11-19T10:01:00.000Z');
    expect(stored?.deletedAt).toBe('2026-11-19T10:01:00.000Z');
    expect(Date.parse(stored?.updatedAt ?? '')).toBeGreaterThan(Date.parse(T0));
  });
});

describe('批量写入中途失败：整个事务回滚', () => {
  /** 在第 nth 条真实写入时抛错（hooks 是真实持久化阶段，不是参数校验）。 */
  function failOnNthUpdate(nth: number) {
    let seen = 0;
    const hook = (): never | void => {
      seen += 1;
      if (seen === nth) {
        throw new Error(`inject: 第 ${nth} 条写入失败`);
      }
    };
    database.tasks.hook('updating').subscribe(hook);
    return {
      seen: () => seen,
      unsubscribe: () => database.tasks.hook('updating').unsubscribe(hook),
    };
  }

  async function seedThree() {
    const tasks = [];
    for (const title of ['任务一', '任务二', '任务三']) {
      tasks.push(await createTask({ title, now: T0 }, database));
    }
    return tasks;
  }

  it('C. 批量软删除第 3 条失败：前两条也回滚，deletedAt 与 updatedAt 全部保持原值', async () => {
    const tasks = await seedThree();
    const ids = tasks.map((task) => task.id);
    const before = await database.tasks.bulkGet(ids);

    const injection = failOnNthUpdate(3);
    try {
      await expect(
        softDeleteTasks(ids, { now: '2026-11-19T11:00:00.000Z' }, database),
      ).rejects.toThrow();
    } finally {
      injection.unsubscribe();
    }

    expect(injection.seen()).toBe(3);
    const after = await database.tasks.bulkGet(ids);
    after.forEach((task, index) => {
      expect(task?.deletedAt).toBeNull();
      expect(task?.updatedAt).toBe(before[index]?.updatedAt);
    });
  });

  it('D. 批量归档第 3 条失败：前两条归档也回滚，archivedAt 与 updatedAt 全部保持原值', async () => {
    const tasks = await seedThree();
    const ids = tasks.map((task) => task.id);
    const before = await database.tasks.bulkGet(ids);

    const injection = failOnNthUpdate(3);
    try {
      await expect(
        archiveTasks(ids, database, { now: '2026-11-19T11:00:00.000Z' }),
      ).rejects.toThrow();
    } finally {
      injection.unsubscribe();
    }

    expect(injection.seen()).toBe(3);
    const after = await database.tasks.bulkGet(ids);
    after.forEach((task, index) => {
      expect(task?.archivedAt).toBeNull();
      expect(task?.updatedAt).toBe(before[index]?.updatedAt);
    });
  });
});

describe('标签删除的 updatedAt 单调性', () => {
  it('E. 系统时间早于 Task.updatedAt 时，删标签仍严格递增', async () => {
    const task = await createTask({ title: '标签任务', now: T0 }, database);
    const tag = await createTag({ name: '待删标签', now: T0 }, database);

    // 把任务时间推到未来，保证 deleteTag 内部取到的“当前时间”早于它。
    const future = '2030-01-01T00:00:00.000Z';
    const updated = await updateTask(task.id, { tags: [tag.id], now: future }, database);
    expect(updated.updatedAt).toBe(future);

    await deleteTag(tag.id, database);

    const stored = await readTask(task.id);
    expect(stored?.tags).toEqual([]);
    expect(Date.parse(stored?.updatedAt ?? '')).toBeGreaterThan(Date.parse(future));
  });
});
