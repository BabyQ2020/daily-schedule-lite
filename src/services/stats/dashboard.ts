import type { WorkbenchDatabase } from '@/db/db';
import { db } from '@/db/db';
import type { Task, WorkLog } from '@/domain/types';
import type { ISODate, Period, WeekStart } from '@/lib/period';
import { periodFor } from '@/lib/period';
import { queryLogs } from '@/repositories/logs';

import { loadProjectHealth, type ProjectHealth } from './health';
import { isOpenTask, loadTodayBoard, type TodayCounts } from './today';

/** 仪表盘一次加载所需的全部数据。 */
export interface DashboardData {
  date: ISODate;
  weekPeriod: Period;
  today: TodayCounts;
  /** 今日计划里还没完成的任务（按计划顺序）。 */
  plannedOpen: Task[];
  /** 逾期任务，最多 5 条（按截止日期升序）。 */
  overdue: Task[];
  /** 逾期任务总数，用于「查看全部」。 */
  overdueTotal: number;
  /** 本周计划：计划日期或截止日期落在本周的未完成任务（G-2）。 */
  week: Task[];
  /** 本周计划任务总数（列表只展示前 8 条）。 */
  weekTotal: number;
  health: ProjectHealth[];
  /** 最近 5 条日志（G-3）。 */
  recentLogs: WorkLog[];
}

const DASHBOARD_LIMITS = {
  overdue: 5,
  week: 8,
  recentLogs: 5,
} as const;

function compareWeekTasks(left: Task, right: Task): number {
  // 截止日期优先（没有截止的排后面），再按计划日期，最后按优先级权重。
  const leftDue = left.dueDate ?? '9999-12-31';
  const rightDue = right.dueDate ?? '9999-12-31';
  if (leftDue !== rightDue) {
    return leftDue < rightDue ? -1 : 1;
  }
  const leftPlan = left.planDate ?? '9999-12-31';
  const rightPlan = right.planDate ?? '9999-12-31';
  if (leftPlan !== rightPlan) {
    return leftPlan < rightPlan ? -1 : 1;
  }
  return left.title.localeCompare(right.title, 'zh-CN');
}

export async function loadDashboard(
  today: ISODate,
  weekStart: WeekStart,
  database: WorkbenchDatabase = db,
): Promise<DashboardData> {
  const weekPeriod = periodFor('week', today, weekStart);

  const [board, byPlan, byDue, health, logs] = await Promise.all([
    loadTodayBoard(today, database),
    database.tasks
      .where('planDate')
      .between(weekPeriod.start, weekPeriod.end, true, true)
      .toArray(),
    database.tasks.where('dueDate').between(weekPeriod.start, weekPeriod.end, true, true).toArray(),
    loadProjectHealth(today, database),
    queryLogs({}, { page: 1, pageSize: DASHBOARD_LIMITS.recentLogs }, database),
  ]);

  const seen = new Set<string>();
  const week: Task[] = [];
  for (const task of [...byPlan, ...byDue]) {
    if (!isOpenTask(task) || seen.has(task.id)) {
      continue;
    }
    seen.add(task.id);
    week.push(task);
  }
  week.sort(compareWeekTasks);

  const overdue = [...board.overdue].sort((left, right) =>
    (left.dueDate ?? '').localeCompare(right.dueDate ?? ''),
  );

  return {
    date: today,
    weekPeriod,
    today: board.counts,
    plannedOpen: board.plannedOpen,
    overdue: overdue.slice(0, DASHBOARD_LIMITS.overdue),
    overdueTotal: overdue.length,
    week: week.slice(0, DASHBOARD_LIMITS.week),
    weekTotal: week.length,
    health,
    recentLogs: logs.items,
  };
}
