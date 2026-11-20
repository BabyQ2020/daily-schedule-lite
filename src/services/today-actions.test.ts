import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { WorkbenchDatabase } from '@/db/db';
import { getPlan } from '@/repositories/plans';
import { createTask, getTask } from '@/repositories/tasks';
import { createTestDatabase, destroyTestDatabase } from '@/test/db';

import {
  addTaskToToday,
  defaultQuickLogTitle,
  moveTaskToToday,
  removeTaskFromToday,
  saveQuickLog,
  toggleTaskDone,
} from './today-actions';

const TODAY = '2026-11-15';

describe('today-actions', () => {
  let database: WorkbenchDatabase;

  beforeEach(() => {
    database = createTestDatabase('today-actions');
  });

  afterEach(async () => {
    await destroyTestDatabase(database);
  });

  it('加入今日计划时同时把计划日期改成今天', async () => {
    const task = await createTask({ title: '写周报', planDate: '2026-11-12' }, database);

    const updated = await addTaskToToday(task.id, TODAY, database);

    expect(updated.planDate).toBe(TODAY);
    const plan = await getPlan(TODAY, database);
    expect(plan?.taskIds).toEqual([task.id]);
    expect((await getTask(task.id, database))?.planDate).toBe(TODAY);
  });

  it('重复加入不会产生重复条目，也不会改动计划日期', async () => {
    const task = await createTask({ title: '写周报', planDate: TODAY }, database);

    await addTaskToToday(task.id, TODAY, database);
    await addTaskToToday(task.id, TODAY, database);

    const plan = await getPlan(TODAY, database);
    expect(plan?.taskIds).toEqual([task.id]);
  });

  it('移出今日计划只摘掉条目，保留任务原有计划日期', async () => {
    const task = await createTask({ title: '写周报', planDate: '2026-11-12' }, database);
    await addTaskToToday(task.id, TODAY, database);

    await removeTaskFromToday(task.id, TODAY, database);

    const plan = await getPlan(TODAY, database);
    expect(plan?.taskIds).toEqual([]);
    expect((await getTask(task.id, database))?.planDate).toBe(TODAY);
  });

  it('待结转任务改到今天只改计划日期，不写入今日计划', async () => {
    const task = await createTask({ title: '旧任务', planDate: '2026-11-10' }, database);

    const updated = await moveTaskToToday(task.id, TODAY, database);

    expect(updated.planDate).toBe(TODAY);
    expect((await getPlan(TODAY, database))?.taskIds ?? []).toEqual([]);
  });

  it('完成任务时写入完成时间，重新打开时清空', async () => {
    const task = await createTask({ title: '写周报' }, database);

    const done = await toggleTaskDone(task, database);
    expect(done.status).toBe('done');
    expect(done.completedAt).not.toBeNull();

    const reopened = await toggleTaskDone(done, database);
    expect(reopened.status).toBe('todo');
    expect(reopened.completedAt).toBeNull();
  });

  it('快速日志标题留空时使用默认标题，并保留补充字段', async () => {
    expect(defaultQuickLogTitle(TODAY)).toBe('2026-11-15 随手记');

    const log = await saveQuickLog(
      TODAY,
      {
        content: '写了工作台',
        insight: '模板要可配置',
        problem: '统计口径',
        solution: '单一口径服务',
      },
      database,
    );

    expect(log.title).toBe('2026-11-15 随手记');
    expect(log.content).toBe('写了工作台');
    expect(log.insight).toBe('模板要可配置');
    expect(log.date).toBe(TODAY);
  });

  it('快速日志手动填写标题时保留用户标题', async () => {
    const log = await saveQuickLog(TODAY, { title: '  架构讨论  ', content: '定下分层' }, database);
    expect(log.title).toBe('架构讨论');
  });
});
