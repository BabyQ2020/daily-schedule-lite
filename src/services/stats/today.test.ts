import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { WorkbenchDatabase } from '@/db/db';
import { createLog } from '@/repositories/logs';
import { addTaskToPlan } from '@/repositories/plans';
import { archiveTasks, createTask, setTaskStatus } from '@/repositories/tasks';
import { createTestDatabase, destroyTestDatabase } from '@/test/db';

import { loadTodayBoard } from './today';

const TODAY = '2026-11-15';

describe('loadTodayBoard', () => {
  let database: WorkbenchDatabase;

  beforeEach(() => {
    database = createTestDatabase('today-service');
  });

  afterEach(async () => {
    await destroyTestDatabase(database);
  });

  it('把今日计划、到期、逾期、待结转、今日完成分别归类', async () => {
    const plannedOpen = await createTask({ title: '写周报', planDate: TODAY }, database);
    const plannedDone = await createTask(
      { title: '开站会', planDate: TODAY, status: 'done', now: '2026-11-15T01:00:00.000Z' },
      database,
    );
    const dueToday = await createTask({ title: '今天到期未安排', dueDate: TODAY }, database);
    const overdue = await createTask(
      { title: '逾期任务', dueDate: '2026-11-10', planDate: '2026-11-10' },
      database,
    );
    const carryOver = await createTask({ title: '昨天没做完', planDate: '2026-11-12' }, database);
    const doneByCompletion = await createTask(
      {
        title: '昨天计划今天完成',
        planDate: '2026-11-14',
        status: 'done',
        now: '2026-11-15T03:00:00.000Z',
      },
      database,
    );
    await addTaskToPlan(TODAY, plannedOpen.id, database);
    await addTaskToPlan(TODAY, plannedDone.id, database);
    await createLog({ date: TODAY, title: '随手记', content: '今天状态一般' }, database);

    const board = await loadTodayBoard(TODAY, database);

    expect(board.planned.map((task) => task.id)).toEqual([plannedOpen.id, plannedDone.id]);
    expect(board.plannedOpen.map((task) => task.id)).toEqual([plannedOpen.id]);
    expect(board.plannedDone.map((task) => task.id)).toEqual([plannedDone.id]);
    expect(board.dueToday.map((task) => task.id)).toEqual([dueToday.id]);
    expect(board.overdue.map((task) => task.id)).toEqual([overdue.id]);
    expect(board.carryOver.map((task) => task.id)).toEqual([carryOver.id]);
    expect(board.doneToday.map((task) => task.id)).toEqual([doneByCompletion.id, plannedDone.id]);
    expect(board.logs).toHaveLength(1);
    expect(board.counts).toEqual({
      planned: 2,
      plannedDone: 1,
      dueToday: 1,
      overdue: 1,
      carryOver: 1,
      doneByCompletion: 2,
    });
  });

  it('待结转不重复列出已逾期任务，也不包含今日计划内的任务', async () => {
    await createTask(
      { title: '逾期且计划过期', dueDate: '2026-11-09', planDate: '2026-11-09' },
      database,
    );
    const inPlan = await createTask({ title: '今天是计划日', planDate: TODAY }, database);
    await addTaskToPlan(TODAY, inPlan.id, database);
    await createTask({ title: '无截止日期只过期', planDate: '2026-11-13' }, database);

    const board = await loadTodayBoard(TODAY, database);

    expect(board.overdue).toHaveLength(1);
    expect(board.carryOver.map((task) => task.title)).toEqual(['无截止日期只过期']);
  });

  it('归档与取消的任务不进入任何待办列表', async () => {
    const archived = await createTask({ title: '归档任务', planDate: '2026-11-10' }, database);
    await archiveTasks([archived.id], database);
    await createTask({ title: '取消任务', planDate: '2026-11-11', status: 'cancelled' }, database);
    await createTask(
      { title: '今日到期的取消任务', dueDate: TODAY, status: 'cancelled' },
      database,
    );

    const board = await loadTodayBoard(TODAY, database);

    expect(board.carryOver).toEqual([]);
    expect(board.dueToday).toEqual([]);
    expect(board.counts.planned).toBe(0);
  });

  it('今日计划按计划顺序返回，任务完成后从 plannedOpen 移到 plannedDone', async () => {
    const first = await createTask({ title: '第一项', planDate: TODAY }, database);
    const second = await createTask({ title: '第二项', planDate: TODAY }, database);
    await addTaskToPlan(TODAY, second.id, database);
    await addTaskToPlan(TODAY, first.id, database);

    const before = await loadTodayBoard(TODAY, database);
    expect(before.planned.map((task) => task.id)).toEqual([second.id, first.id]);

    await setTaskStatus(second.id, 'done', database);

    const after = await loadTodayBoard(TODAY, database);
    expect(after.plannedOpen.map((task) => task.id)).toEqual([first.id]);
    expect(after.plannedDone.map((task) => task.id)).toEqual([second.id]);
    expect(after.counts.plannedDone).toBe(1);
  });

  it('没有计划、没有日志时返回空数组而不是 undefined', async () => {
    const board = await loadTodayBoard(TODAY, database);
    expect(board.plan).toBeUndefined();
    expect(board.planned).toEqual([]);
    expect(board.logs).toEqual([]);
    expect(board.counts.planned).toBe(0);
  });
});
