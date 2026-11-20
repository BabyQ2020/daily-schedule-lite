import type { WorkbenchDatabase } from '@/db/db';
import { db } from '@/db/db';
import type { Id, Project, Task } from '@/domain/types';
import type { ISODate } from '@/lib/period';
import { addDays, parseISODate, toISODate } from '@/lib/period';

import {
  accumulateProgress,
  createProgressCounts,
  finalizeProgress,
  isDeletedTask,
  isOverdue,
  type ProjectProgress,
} from './progress';

/**
 * 项目健康度（G-1）：只做「红 / 黄 / 绿」三档，判定阈值集中在这里，便于以后调整与解释。
 * - 红：存在逾期任务，或存在未解决的高风险；
 * - 黄：进度低于 30% 且 14 天内到期，或存在未解决的中风险；
 * - 绿：其余情况。
 * 归档项目、已完成项目不参与（不制造无意义的告警）。
 */
export const HEALTH_THRESHOLDS = {
  lowProgressPercent: 30,
  endingWithinDays: 14,
} as const;

export type HealthLevel = 'healthy' | 'warning' | 'critical';

export interface ProjectHealth {
  projectId: Id;
  name: string;
  level: HealthLevel;
  progress: ProjectProgress;
  /** 逾期任务数（口径与任务页一致）。 */
  overdue: number;
  openHighRisks: number;
  openMediumRisks: number;
  /** 是否在阈值天数内到期。 */
  endingSoon: boolean;
  /** 命中的原因，直接展示给用户，避免"为什么是红的"说不清。 */
  reasons: string[];
}

export const HEALTH_LEVEL_LABELS: Record<HealthLevel, { label: string; color: string }> = {
  healthy: { label: '健康', color: 'green' },
  warning: { label: '需关注', color: 'gold' },
  critical: { label: '有风险', color: 'red' },
};

/** 参与健康度评估的项目：进行中或已暂停，且未被归档；归档与已完成不参与。 */
export function isHealthProject(project: Project): boolean {
  if (project.archivedAt !== null) {
    return false;
  }
  return project.status === 'active' || project.status === 'paused';
}

export function assessProjectHealth(
  project: Project,
  tasks: readonly Task[],
  today: ISODate,
): ProjectHealth {
  const counts = createProgressCounts();
  let overdue = 0;
  for (const task of tasks) {
    accumulateProgress(counts, task);
    if (isOverdue(task, today)) {
      overdue += 1;
    }
  }
  const progress = finalizeProgress(counts);

  const openHighRisks = project.risks.filter(
    (risk) => risk.level === 'high' && risk.status !== 'resolved',
  ).length;
  const openMediumRisks = project.risks.filter(
    (risk) => risk.level === 'medium' && risk.status !== 'resolved',
  ).length;

  const endingLimit = toISODate(addDays(parseISODate(today), HEALTH_THRESHOLDS.endingWithinDays));
  const endingSoon =
    project.endDate !== null && project.endDate >= today && project.endDate <= endingLimit;

  const reasons: string[] = [];
  let level: HealthLevel = 'healthy';

  if (overdue > 0) {
    level = 'critical';
    reasons.push(`${overdue} 个任务已逾期`);
  }
  if (openHighRisks > 0) {
    level = 'critical';
    reasons.push(`${openHighRisks} 个高风险未解决`);
  }

  const lowProgress =
    progress.percent !== null && progress.percent < HEALTH_THRESHOLDS.lowProgressPercent;
  if (level !== 'critical') {
    if (lowProgress && endingSoon) {
      level = 'warning';
      reasons.push(`进度 ${progress.percent}% 且 ${HEALTH_THRESHOLDS.endingWithinDays} 天内到期`);
    }
    if (openMediumRisks > 0) {
      level = 'warning';
      reasons.push(`${openMediumRisks} 个中风险未解决`);
    }
  }

  if (reasons.length === 0) {
    reasons.push('没有逾期任务与未解决风险');
  }

  return {
    projectId: project.id,
    name: project.name,
    level,
    progress,
    overdue,
    openHighRisks,
    openMediumRisks,
    endingSoon,
    reasons,
  };
}

const LEVEL_WEIGHT: Record<HealthLevel, number> = { critical: 0, warning: 1, healthy: 2 };

/** 读取所有进行中/暂停项目并按健康度排序（有风险在前）。 */
export async function loadProjectHealth(
  today: ISODate,
  database: WorkbenchDatabase = db,
): Promise<ProjectHealth[]> {
  const [projects, tasks] = await Promise.all([
    database.projects.toArray(),
    database.tasks.toArray(),
  ]);

  const buckets = new Map<Id, Task[]>();
  for (const task of tasks) {
    if (task.projectId === null || isDeletedTask(task)) {
      continue;
    }
    const bucket = buckets.get(task.projectId);
    if (bucket) {
      bucket.push(task);
    } else {
      buckets.set(task.projectId, [task]);
    }
  }

  return projects
    .filter(isHealthProject)
    .map((project) => assessProjectHealth(project, buckets.get(project.id) ?? [], today))
    .sort((left, right) => {
      const byLevel = LEVEL_WEIGHT[left.level] - LEVEL_WEIGHT[right.level];
      return byLevel !== 0 ? byLevel : left.name.localeCompare(right.name, 'zh-CN');
    });
}
