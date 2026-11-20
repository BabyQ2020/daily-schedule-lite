import type { WorkbenchDatabase } from '@/db/db';
import { db } from '@/db/db';
import type { Id, Task, WorkLog } from '@/domain/types';
import type { ISODate } from '@/lib/period';
import { NotFoundError } from '@/repositories/errors';
import { createLog } from '@/repositories/logs';
import { addTaskToPlan, removeTaskFromPlan } from '@/repositories/plans';
import { setTaskStatus, updateTask } from '@/repositories/tasks';

/** 快速日志标题留空时的默认标题，方便在日志页按天找回。 */
export function defaultQuickLogTitle(today: ISODate): string {
  return `${today} 随手记`;
}

async function requireTask(taskId: Id, database: WorkbenchDatabase): Promise<Task> {
  const task = await database.tasks.get(taskId);
  if (!task) {
    throw new NotFoundError('任务');
  }
  return task;
}

/**
 * 加入今日计划：写 dailyPlans.taskIds 同时把 planDate 设为今天，
 * 保证「在今日计划里」与「计划日期是今天」不会互相矛盾。
 */
export async function addTaskToToday(
  taskId: Id,
  today: ISODate,
  database: WorkbenchDatabase = db,
): Promise<Task> {
  return database.transaction('rw', database.dailyPlans, database.tasks, async () => {
    const task = await requireTask(taskId, database);
    await addTaskToPlan(today, taskId, database);
    if (task.planDate === today) {
      return task;
    }
    return updateTask(taskId, { planDate: today }, database);
  });
}

/** 移出今日计划：只摘掉计划条目，不改任务的计划日期（由用户显式改期或保持原样）。 */
export async function removeTaskFromToday(
  taskId: Id,
  today: ISODate,
  database: WorkbenchDatabase = db,
): Promise<void> {
  await removeTaskFromPlan(today, taskId, database);
}

/** 待结转任务一键改到今日：只改 planDate，不动截止日期。 */
export async function moveTaskToToday(
  taskId: Id,
  today: ISODate,
  database: WorkbenchDatabase = db,
): Promise<Task> {
  return updateTask(taskId, { planDate: today }, database);
}

export async function toggleTaskDone(task: Task, database: WorkbenchDatabase = db): Promise<Task> {
  return setTaskStatus(task.id, task.status === 'done' ? 'todo' : 'done', database);
}

export interface QuickLogInput {
  title?: string;
  content?: string;
  insight?: string;
  problem?: string;
  solution?: string;
  projectId?: Id | null;
  taskId?: Id | null;
}

export async function saveQuickLog(
  today: ISODate,
  input: QuickLogInput,
  database: WorkbenchDatabase = db,
): Promise<WorkLog> {
  return createLog(
    {
      date: today,
      title: input.title?.trim() || defaultQuickLogTitle(today),
      content: input.content ?? '',
      insight: input.insight ?? '',
      problem: input.problem ?? '',
      solution: input.solution ?? '',
      projectId: input.projectId ?? null,
      taskId: input.taskId ?? null,
    },
    database,
  );
}
