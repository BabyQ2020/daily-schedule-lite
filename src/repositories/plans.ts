import type { WorkbenchDatabase } from '@/db/db';
import { db } from '@/db/db';
import type { DailyPlan, Id } from '@/domain/types';
import type { ISODate } from '@/lib/period';
import { isISODateString } from '@/domain/guards';
import { nowISOString } from '@/lib/clock';

import { ValidationError } from './errors';

export interface PlanUpdateInput {
  taskIds?: readonly Id[];
  extras?: readonly string[];
  note?: string;
  now?: string;
}

function requireDate(date: ISODate): ISODate {
  if (!isISODateString(date)) {
    throw new ValidationError(`日期格式不正确：${date}（应为 YYYY-MM-DD）。`);
  }
  return date;
}

function uniqueIds(ids: readonly Id[]): Id[] {
  return [...new Set(ids)];
}

export async function getPlan(
  date: ISODate,
  database: WorkbenchDatabase = db,
): Promise<DailyPlan | undefined> {
  return database.dailyPlans.get(date);
}

/** 读取或惰性创建当天计划；只在确实需要写入时调用。 */
export async function ensurePlan(
  date: ISODate,
  database: WorkbenchDatabase = db,
): Promise<DailyPlan> {
  const existing = await database.dailyPlans.get(date);
  if (existing) {
    return existing;
  }
  const now = nowISOString();
  const plan: DailyPlan = {
    date: requireDate(date),
    taskIds: [],
    extras: [],
    note: '',
    createdAt: now,
    updatedAt: now,
  };
  await database.dailyPlans.add(plan);
  return plan;
}

export async function upsertPlan(
  date: ISODate,
  patch: PlanUpdateInput,
  database: WorkbenchDatabase = db,
): Promise<DailyPlan> {
  const now = patch.now ?? nowISOString();
  const existing = await database.dailyPlans.get(date);
  const base: DailyPlan = existing ?? {
    date: requireDate(date),
    taskIds: [],
    extras: [],
    note: '',
    createdAt: now,
    updatedAt: now,
  };
  const next: DailyPlan = {
    ...base,
    date: base.date,
    ...(patch.taskIds !== undefined ? { taskIds: uniqueIds(patch.taskIds) } : {}),
    ...(patch.extras !== undefined
      ? { extras: patch.extras.map((item) => item.trim()).filter(Boolean) }
      : {}),
    ...(patch.note !== undefined ? { note: patch.note } : {}),
    updatedAt: now,
  };
  await database.dailyPlans.put(next);
  return next;
}

export async function setPlanTasks(
  date: ISODate,
  taskIds: readonly Id[],
  database: WorkbenchDatabase = db,
): Promise<DailyPlan> {
  return upsertPlan(date, { taskIds }, database);
}

export async function addTaskToPlan(
  date: ISODate,
  taskId: Id,
  database: WorkbenchDatabase = db,
): Promise<DailyPlan> {
  const plan = await ensurePlan(date, database);
  if (plan.taskIds.includes(taskId)) {
    return plan;
  }
  return upsertPlan(date, { taskIds: [...plan.taskIds, taskId] }, database);
}

export async function removeTaskFromPlan(
  date: ISODate,
  taskId: Id,
  database: WorkbenchDatabase = db,
): Promise<DailyPlan> {
  const plan = await getPlan(date, database);
  if (!plan) {
    return ensurePlan(date, database);
  }
  return upsertPlan(date, { taskIds: plan.taskIds.filter((id) => id !== taskId) }, database);
}

export async function addExtra(
  date: ISODate,
  text: string,
  database: WorkbenchDatabase = db,
): Promise<DailyPlan> {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    throw new ValidationError('补充事项不能为空。');
  }
  const plan = await ensurePlan(date, database);
  return upsertPlan(date, { extras: [...plan.extras, trimmed] }, database);
}

export async function removeExtra(
  date: ISODate,
  index: number,
  database: WorkbenchDatabase = db,
): Promise<DailyPlan> {
  const plan = await ensurePlan(date, database);
  return upsertPlan(
    date,
    { extras: plan.extras.filter((_, current) => current !== index) },
    database,
  );
}

/** 升序返回区间内的每日计划（含首尾）。 */
export async function listPlans(
  from: ISODate,
  to: ISODate,
  database: WorkbenchDatabase = db,
): Promise<DailyPlan[]> {
  return database.dailyPlans.where('date').between(from, to, true, true).toArray();
}
