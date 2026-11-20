import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { WorkbenchDatabase } from '@/db/db';
import { createLog } from '@/repositories/logs';
import { addTaskToPlan, getPlan } from '@/repositories/plans';
import { createProject } from '@/repositories/projects';
import {
  archiveTasks,
  createTask,
  deleteTasks,
  queryTasks,
  restoreTasks,
  setTaskStatus,
  updateTask,
} from '@/repositories/tasks';
import { createTestDatabase, destroyTestDatabase } from '@/test/db';

let database: WorkbenchDatabase;

beforeEach(() => {
  database = createTestDatabase('tasks');
});

afterEach(async () => {
  await destroyTestDatabase(database);
});

describe('任务仓储', () => {
  it('创建任务时补齐默认值并去除标题空白', async () => {
    const task = await createTask({ title: '  写周报  ' }, database);
    expect(task.title).toBe('写周报');
    expect(task.status).toBe('todo');
    expect(task.priority).toBe('medium');
    expect(task.completedAt).toBeNull();
    expect(task.archivedAt).toBeNull();
    expect(await database.tasks.count()).toBe(1);
  });

  it('拒绝空标题', async () => {
    await expect(createTask({ title: '   ' }, database)).rejects.toThrow('任务标题不能为空');
  });

  it('完成与重新打开保持 completedAt 一致', async () => {
    const task = await createTask({ title: '任务 A' }, database);
    const completed = await setTaskStatus(task.id, 'done', database);
    expect(completed.status).toBe('done');
    expect(completed.completedAt).not.toBeNull();

    const reopened = await setTaskStatus(task.id, 'todo', database);
    expect(reopened.completedAt).toBeNull();
  });

  it('按状态、项目、关键词筛选并分页', async () => {
    const project = await createProject({ name: '项目甲' }, database);
    await createTask({ title: '甲任务 1', projectId: project.id, status: 'done' }, database);
    await createTask({ title: '甲任务 2', projectId: project.id }, database);
    await createTask({ title: '无关任务' }, database);

    const byProject = await queryTasks({ projectId: project.id }, undefined, {}, database);
    expect(byProject.total).toBe(2);

    const done = await queryTasks({ status: 'done' }, undefined, {}, database);
    expect(done.items.map((task) => task.title)).toEqual(['甲任务 1']);

    const keyword = await queryTasks({ keyword: '无关' }, undefined, {}, database);
    expect(keyword.total).toBe(1);

    const paged = await queryTasks(
      {},
      { key: 'title', direction: 'asc' },
      { page: 2, pageSize: 2 },
      database,
    );
    expect(paged.total).toBe(3);
    expect(paged.totalPages).toBe(2);
    expect(paged.items).toHaveLength(1);
  });

  it('按截止日排序时无截止日的任务排在最后', async () => {
    await createTask({ title: '无截止' }, database);
    await createTask({ title: '晚截止', dueDate: '2026-12-31' }, database);
    await createTask({ title: '早截止', dueDate: '2026-11-20' }, database);

    const result = await queryTasks({}, { key: 'dueDate', direction: 'asc' }, {}, database);
    expect(result.items.map((task) => task.title)).toEqual(['早截止', '晚截止', '无截止']);
  });

  it('归档任务从默认列表消失，可恢复', async () => {
    const task = await createTask({ title: '待归档' }, database);
    await archiveTasks([task.id], database);

    expect((await queryTasks({}, undefined, {}, database)).total).toBe(0);
    expect((await queryTasks({ archived: 'archived' }, undefined, {}, database)).total).toBe(1);

    await restoreTasks([task.id], database);
    expect((await queryTasks({}, undefined, {}, database)).total).toBe(1);
  });

  it('更新任务时校验存在性', async () => {
    await expect(updateTask('missing', { title: 'x' }, database)).rejects.toThrow('不存在');
  });

  it('删除任务时同步清理每日计划并保留日志快照', async () => {
    const task = await createTask({ title: '会被删除的任务' }, database);
    const log = await createLog(
      { date: '2026-11-16', title: '相关日志', taskId: task.id },
      database,
    );
    await addTaskToPlan('2026-11-16', task.id, database);

    const result = await deleteTasks([task.id], database);
    expect(result.deleted).toBe(1);
    expect(result.detachedLogs).toBe(1);
    expect(result.updatedPlans).toBe(1);

    const plan = await getPlan('2026-11-16', database);
    expect(plan?.taskIds).toEqual([]);

    const detached = await database.workLogs.get(log.id);
    expect(detached?.taskId).toBeNull();
    expect(detached?.taskTitleSnapshot).toBe('会被删除的任务');
  });
});
