import type { WorkbenchDatabase } from '@/db/db';
import { db } from '@/db/db';
import type { DailyPlan, Task, WorkLog } from '@/domain/types';
import type { ISODate } from '@/lib/period';
import { getPlan } from '@/repositories/plans';
import { queryLogs } from '@/repositories/logs';

import { isDeletedTask, isOverdue } from './progress';

/** 工作台需要的全部数据，一次查询组装完成，避免页面各区块各自扫表。 */
export interface TodayBoard {
  date: ISODate;
  plan: DailyPlan | undefined;
  /** 今日计划里的任务，保持计划中的顺序。 */
  planned: Task[];
  plannedOpen: Task[];
  plannedDone: Task[];
  /** 今天到期但不在今日计划里的任务。 */
  dueToday: Task[];
  /** 逾期：有截止日期、早于今天且未完成。 */
  overdue: Task[];
  /** 待结转：计划日期早于今天且未完成（已逾期的单独列出，不重复出现）。 */
  carryOver: Task[];
  /** 今天完成的任务（按完成时间倒序）。 */
  doneToday: Task[];
  /** 当天的快速日志。 */
  logs: WorkLog[];
  counts: TodayCounts;
}

export interface TodayCounts {
  /** 今日计划任务总数。 */
  planned: number;
  /** 今日计划里已完成的数量。 */
  plannedDone: number;
  dueToday: number;
  overdue: number;
  carryOver: number;
  /** 按完成时间统计的今日完成数（与计划完成率不是一个口径）。 */
  doneByCompletion: number;
}

/** 未完成、未取消、未归档、未删除——工作台里所有"还要做"的列表都用这一把尺子。 */
export function isOpenTask(task: Task): boolean {
  return (
    !isDeletedTask(task) &&
    task.archivedAt === null &&
    task.status !== 'done' &&
    task.status !== 'cancelled'
  );
}

export async function loadTodayBoard(
  today: ISODate,
  database: WorkbenchDatabase = db,
): Promise<TodayBoard> {
  const plan = await getPlan(today, database);
  const plannedIds = plan?.taskIds ?? [];
  const fetched = await database.tasks.bulkGet([...plannedIds]);
  // 已进入回收站的任务即使还挂在计划里，也不应再出现在工作台与统计里。
  const planned = fetched.filter(
    (task): task is Task => task !== undefined && !isDeletedTask(task),
  );

  const dueToday = (await database.tasks.where('dueDate').equals(today).toArray()).filter((task) =>
    isOpenTask(task),
  );

  const overdue = (await database.tasks.where('dueDate').below(today).toArray()).filter((task) =>
    isOverdue(task, today),
  );
  const overdueIds = new Set(overdue.map((task) => task.id));
  const plannedIdSet = new Set(planned.map((task) => task.id));

  const carryOver = (await database.tasks.where('planDate').below(today).toArray()).filter(
    (task) => isOpenTask(task) && !overdueIds.has(task.id) && !plannedIdSet.has(task.id),
  );

  const doneToday = (await database.tasks.where('completedAt').startsWith(today).toArray())
    .filter((task) => task.status === 'done' && !isDeletedTask(task))
    .sort((left, right) => (right.completedAt ?? '').localeCompare(left.completedAt ?? ''));

  const logs = await queryLogs(
    { dateFrom: today, dateTo: today },
    { page: 1, pageSize: 50 },
    database,
  );

  const plannedDone = planned.filter((task) => task.status === 'done');

  return {
    date: today,
    plan,
    planned,
    plannedOpen: planned.filter(isOpenTask),
    plannedDone,
    dueToday,
    overdue,
    carryOver,
    doneToday,
    logs: logs.items,
    counts: {
      planned: planned.length,
      plannedDone: plannedDone.length,
      dueToday: dueToday.length,
      overdue: overdue.length,
      carryOver: carryOver.length,
      doneByCompletion: doneToday.length,
    },
  };
}
