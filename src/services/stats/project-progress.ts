import { db } from '@/db/db';
import type { WorkbenchDatabase } from '@/db/db';
import type { Id, Task } from '@/domain/types';
import {
  accumulateProgress,
  createProgressCounts,
  finalizeProgress,
  isDeletedTask,
  isOverdue,
} from '@/services/stats/progress';
import type { ProjectProgress } from '@/services/stats/progress';

/**
 * 项目进度只读聚合。
 * 1 万任务规模下不把整表读进内存再二次遍历，直接流式累加，界面只拿 Map<projectId, 进度>。
 */
export async function loadProjectProgress(
  database: WorkbenchDatabase = db,
): Promise<Map<Id, ProjectProgress>> {
  const buckets = new Map<Id, ReturnType<typeof createProgressCounts>>();

  await database.tasks.each((task) => {
    if (isDeletedTask(task) || !task.projectId) {
      return;
    }
    const bucket = buckets.get(task.projectId) ?? createProgressCounts();
    accumulateProgress(bucket, task);
    buckets.set(task.projectId, bucket);
  });

  const result = new Map<Id, ProjectProgress>();
  for (const [projectId, counts] of buckets) {
    result.set(projectId, finalizeProgress(counts));
  }
  return result;
}

export interface TaskOverview {
  total: number;
  active: number;
  done: number;
  overdue: number;
}

/** 任务总览：全部任务口径，不受筛选影响。 */
export async function loadTaskOverview(
  today: string,
  database: WorkbenchDatabase = db,
): Promise<TaskOverview> {
  const overview: TaskOverview = { total: 0, active: 0, done: 0, overdue: 0 };

  await database.tasks.each((task: Task) => {
    if (isDeletedTask(task)) {
      return;
    }
    overview.total += 1;
    const closed = task.status === 'done' || task.status === 'cancelled';
    if (!closed && task.archivedAt === null) {
      overview.active += 1;
    }
    if (task.status === 'done') {
      overview.done += 1;
    }
    if (isOverdue(task, today)) {
      overview.overdue += 1;
    }
  });

  return overview;
}
