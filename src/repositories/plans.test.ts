import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { WorkbenchDatabase } from '@/db/db';
import {
  addExtra,
  addTaskToPlan,
  ensurePlan,
  getPlan,
  listPlans,
  removeExtra,
  removeTaskFromPlan,
  setPlanTasks,
  upsertPlan,
} from '@/repositories/plans';
import { createTestDatabase, destroyTestDatabase } from '@/test/db';

let database: WorkbenchDatabase;

beforeEach(() => {
  database = createTestDatabase('plans');
});

afterEach(async () => {
  await destroyTestDatabase(database);
});

describe('每日计划仓储', () => {
  it('同一天只创建一条计划', async () => {
    const first = await ensurePlan('2026-11-16', database);
    const second = await ensurePlan('2026-11-16', database);
    expect(second.createdAt).toBe(first.createdAt);
    expect(await database.dailyPlans.count()).toBe(1);
  });

  it('写入任务时去重并按天保存', async () => {
    await setPlanTasks('2026-11-16', ['task_a', 'task_b', 'task_a'], database);
    const plan = await getPlan('2026-11-16', database);
    expect(plan?.taskIds).toEqual(['task_a', 'task_b']);

    await addTaskToPlan('2026-11-16', 'task_b', database);
    expect((await getPlan('2026-11-16', database))?.taskIds).toEqual(['task_a', 'task_b']);

    await removeTaskFromPlan('2026-11-16', 'task_a', database);
    expect((await getPlan('2026-11-16', database))?.taskIds).toEqual(['task_b']);
  });

  it('补充事项过滤空值并可按下标删除', async () => {
    await addExtra('2026-11-16', '  临时沟通  ', database);
    await expect(addExtra('2026-11-16', '   ', database)).rejects.toThrow('补充事项不能为空');

    let plan = await getPlan('2026-11-16', database);
    expect(plan?.extras).toEqual(['临时沟通']);
    expect(plan?.taskIds).toEqual([]);

    await addExtra('2026-11-16', '写文档', database);
    plan = await removeExtra('2026-11-16', 0, database);
    expect(plan.extras).toEqual(['写文档']);
  });

  it('区间查询包含首尾日期', async () => {
    await upsertPlan('2026-11-15', { note: '周日' }, database);
    await upsertPlan('2026-11-16', { note: '周一' }, database);
    await upsertPlan('2026-11-17', { note: '周二' }, database);

    const plans = await listPlans('2026-11-15', '2026-11-16', database);
    expect(plans.map((plan) => plan.date)).toEqual(['2026-11-15', '2026-11-16']);
  });

  it('非法日期直接报错', async () => {
    await expect(ensurePlan('2026-02-30', database)).rejects.toThrow('日期格式不正确');
  });
});
