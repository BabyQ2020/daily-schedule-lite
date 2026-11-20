import type { WorkbenchDatabase } from '@/db/db';
import { db } from '@/db/db';
import type { Id, Project, ReportKind, Task, WorkLog } from '@/domain/types';
import type { ISODate, Period } from '@/lib/period';
import { toISODate } from '@/lib/period';

import {
  accumulateProgress,
  createProgressCounts,
  finalizeProgress,
  isDeletedTask,
  type ProjectProgress,
} from './progress';

/** 单个任务集的统计结果，字段名即报告里出现的口径名。 */
export interface PeriodTaskStats {
  /** 计划日期落在周期内的任务数（不含归档）。 */
  plannedTotal: number;
  /** 上述计划任务中当前已完成的数量。 */
  plannedDone: number;
  /** 计划完成率（百分比，四舍五入）；没有计划任务时为 null。 */
  completionRate: number | null;
  /** 完成时间落在周期内的任务数——与计划完成率是不同口径，报告需同时列出。 */
  completedByCompletion: number;
  /** 周期结束时仍逾期（截止日期早于期末且未完成）的任务数。 */
  overdueAtEnd: number;
  /** 计划日期在周期内、期末仍未完成（不含已逾期）的任务数，等下期结转。 */
  carryOverAtEnd: number;
  /** 周期内新建的任务数。 */
  created: number;
}

export interface PeriodLogStats {
  total: number;
  daysWithLogs: number;
}

export interface PeriodProjectTouch {
  id: Id;
  name: string;
  progress: ProjectProgress;
}

export interface PeriodStats {
  kind: ReportKind;
  period: Period;
  tasks: PeriodTaskStats;
  logs: PeriodLogStats;
  projects: {
    touched: PeriodProjectTouch[];
    active: number;
  };
  /** 周期内按完成时间完成的任务（正文「完成任务」段用）。 */
  completedTasks: Task[];
  /** 期末仍未完成的计划任务（正文「下期计划」段用）。 */
  carriedTasks: Task[];
  /** 周期内的日志（正文「工作日志」段用）。 */
  logEntries: WorkLog[];
}

function isOpen(task: Task): boolean {
  return task.status !== 'done' && task.status !== 'cancelled' && task.archivedAt === null;
}

/** completedAt 是 ISO 时间戳，按本地日历取日期，避免时区把完成时间算到隔天。 */
function completedDateOf(task: Task): ISODate | null {
  if (task.completedAt === null) {
    return null;
  }
  const parsed = new Date(task.completedAt);
  return Number.isNaN(parsed.getTime()) ? null : toISODate(parsed);
}

function inPeriod(date: ISODate | null, period: Period): boolean {
  return date !== null && date >= period.start && date <= period.end;
}

/** 按周期汇总任务、日志与项目进展；纯读取，不写库。 */
export async function loadPeriodStats(
  kind: ReportKind,
  period: Period,
  database: WorkbenchDatabase = db,
): Promise<PeriodStats> {
  const [allTasks, logEntries, projects] = await Promise.all([
    database.tasks.toArray(),
    database.workLogs.where('date').between(period.start, period.end, true, true).toArray(),
    database.projects.toArray(),
  ]);
  // 回收站里的任务不参与任何周期统计（计划数、完成数、逾期、新建）。
  const tasks = allTasks.filter((task) => !isDeletedTask(task));

  const planned = tasks.filter((task) => inPeriod(task.planDate, period));
  const plannedOpen = planned.filter(isOpen);
  const plannedDone = planned.filter((task) => task.status === 'done').length;
  const completedTasks = tasks
    .filter((task) => task.status === 'done' && inPeriod(completedDateOf(task), period))
    .sort((left, right) => ((left.completedAt ?? '') < (right.completedAt ?? '') ? 1 : -1));

  // 待结转＝计划在期内、期末仍未完成，且不算逾期（无截止日期，或截止日期在期末之后）。
  const carryOver = plannedOpen.filter(
    (task) => task.dueDate === null || task.dueDate >= period.end,
  );
  // 逾期＝截止日期早于期末且期末未完成；当天到期不算逾期。
  const overdueAtEnd = plannedOpen.filter(
    (task) => task.dueDate !== null && task.dueDate < period.end,
  ).length;
  const created = tasks.filter((task) =>
    inPeriod(toISODate(new Date(task.createdAt)), period),
  ).length;

  const projectNames = new Map(projects.map((project) => [project.id, project] as const));
  const progressByProject = new Map<Id, ReturnType<typeof createProgressCounts>>();
  for (const task of tasks) {
    if (!task.projectId) {
      continue;
    }
    const counts = progressByProject.get(task.projectId) ?? createProgressCounts();
    accumulateProgress(counts, task);
    progressByProject.set(task.projectId, counts);
  }

  const touchedIds = new Set<Id>();
  for (const task of [...planned, ...completedTasks]) {
    if (task.projectId && projectNames.has(task.projectId)) {
      touchedIds.add(task.projectId);
    }
  }
  for (const log of logEntries) {
    if (log.projectId && projectNames.has(log.projectId)) {
      touchedIds.add(log.projectId);
    }
  }

  const touched: PeriodProjectTouch[] = [...touchedIds]
    .map((id) => {
      const project = projectNames.get(id) as Project;
      const counts = progressByProject.get(id) ?? createProgressCounts();
      return { id, name: project.name, progress: finalizeProgress(counts) };
    })
    .sort((left, right) => left.name.localeCompare(right.name, 'zh-Hans-CN'));

  const daysWithLogs = new Set(logEntries.map((log) => log.date)).size;

  return {
    kind,
    period,
    tasks: {
      plannedTotal: planned.length,
      plannedDone,
      completionRate:
        planned.length === 0 ? null : Math.round((plannedDone / planned.length) * 100),
      completedByCompletion: completedTasks.length,
      overdueAtEnd,
      carryOverAtEnd: carryOver.length,
      created,
    },
    logs: { total: logEntries.length, daysWithLogs },
    projects: {
      touched,
      active: projects.filter(
        (project) => project.status === 'active' && project.archivedAt === null,
      ).length,
    },
    completedTasks,
    carriedTasks: carryOver,
    logEntries: logEntries.sort((left, right) =>
      left.date === right.date
        ? left.createdAt < right.createdAt
          ? 1
          : -1
        : left.date < right.date
          ? 1
          : -1,
    ),
  };
}
