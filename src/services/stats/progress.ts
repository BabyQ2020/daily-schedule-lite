import type { Project, Task } from '@/domain/types';

/**
 * 项目进度口径（D5 + Q2/D16）：
 * - 分母 = 关联任务总数 − 归档任务 − 已取消任务；
 * - 分子 = 上述有效任务中状态为「已完成」的数量；
 * - 分母为 0 时进度为 null（界面显示「—」，不谎报 0% 或 100%）。
 * P1 的手动覆盖只在 progressMode==='manual' 且 manualProgress 有效时生效，首版不启用。
 */
export interface ProjectProgress {
  /** 全部关联任务数（含归档、取消）。 */
  total: number;
  /** 参与计算的有效任务数，即进度分母。 */
  counted: number;
  /** 有效任务中已完成的数量。 */
  done: number;
  /** 0–100 的整数；分母为 0 时为 null。 */
  percent: number | null;
  /** 被排除的归档任务数。 */
  archived: number;
  /** 被排除的已取消任务数。 */
  cancelled: number;
}

/** 已进入回收站（软删除）的任务：任何统计、生成、逾期判断都必须排除。 */
export function isDeletedTask(task: Task): boolean {
  return task.deletedAt !== null && task.deletedAt !== undefined;
}

/** 任务是否计入项目进度分母。 */
export function isCountedTask(task: Task): boolean {
  if (isDeletedTask(task) || task.archivedAt !== null) {
    return false;
  }
  return task.status !== 'cancelled';
}

export function computeProjectProgress(tasks: readonly Task[]): ProjectProgress {
  const counts = createProgressCounts();
  for (const task of tasks) {
    accumulateProgress(counts, task);
  }
  return finalizeProgress(counts);
}

/** 增量累加器：项目进度按项目分组流式统计时避免把全部任务读进内存两次。 */
export interface ProgressCounts {
  total: number;
  archived: number;
  cancelled: number;
  counted: number;
  done: number;
}

export function createProgressCounts(): ProgressCounts {
  return { total: 0, archived: 0, cancelled: 0, counted: 0, done: 0 };
}

export function accumulateProgress(counts: ProgressCounts, task: Task): void {
  if (isDeletedTask(task)) {
    return;
  }
  counts.total += 1;
  if (task.archivedAt !== null) {
    counts.archived += 1;
    return;
  }
  if (task.status === 'cancelled') {
    counts.cancelled += 1;
    return;
  }
  counts.counted += 1;
  if (task.status === 'done') {
    counts.done += 1;
  }
}

export function finalizeProgress(counts: ProgressCounts): ProjectProgress {
  const percent = counts.counted === 0 ? null : Math.round((counts.done / counts.counted) * 100);
  return {
    total: counts.total,
    counted: counts.counted,
    done: counts.done,
    percent,
    archived: counts.archived,
    cancelled: counts.cancelled,
  };
}

/** 手动覆盖的进度：仅在 P1 启用，这里先统一收口，避免以后各页面各写一套。 */
export function effectiveProjectPercent(
  project: Project,
  progress: ProjectProgress,
): number | null {
  if (project.progressMode === 'manual' && project.manualProgress !== null) {
    return Math.min(100, Math.max(0, Math.round(project.manualProgress)));
  }
  return progress.percent;
}

/**
 * 逾期判定（D8）：有截止日期、截止日期早于今天、且任务未完成、未被取消、未归档。
 * 没有截止日期的任务永远不会逾期。
 */
export function isOverdue(task: Task, today: string): boolean {
  if (isDeletedTask(task) || task.dueDate === null || task.archivedAt !== null) {
    return false;
  }
  if (task.status === 'done' || task.status === 'cancelled') {
    return false;
  }
  return task.dueDate < today;
}
