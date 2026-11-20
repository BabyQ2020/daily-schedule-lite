import type { Id } from '@/domain/types';
import { db, describeDatabaseError, type WorkbenchDatabase } from '@/db/db';
import { nowISOString, todayISO } from '@/lib/clock';
import { aggregateIssues, type AggregateIssue } from '@/services/long-tasks/guards';

export interface LongTaskDiagnosisEntry {
  taskId: Id;
  title: string;
  deleted: boolean;
  issues: AggregateIssue[];
}

export interface LongTaskDiagnosisReport {
  scannedAt: string;
  total: number;
  healthy: number;
  entries: LongTaskDiagnosisEntry[];
  orphanVersions: number;
  orphanExceptions: number;
  durationMs: number;
}

/**
 * 只读一致性扫描：不修复、不阻断启动。
 * 发现问题的聚合会在写入时被仓储拒绝，直到用户导出备份并修复数据。
 */
export async function diagnoseLongTasks(
  database: WorkbenchDatabase = db,
): Promise<LongTaskDiagnosisReport> {
  const startedAt = Date.now();
  const today = todayISO();

  const { tasks, versions, exceptions } = await database.transaction(
    'r',
    [database.longTasks, database.longTaskRuleVersions, database.longTaskExceptions],
    async () => ({
      tasks: await database.longTasks.toArray(),
      versions: await database.longTaskRuleVersions.toArray(),
      exceptions: await database.longTaskExceptions.toArray(),
    }),
  );

  const taskIds = new Set(tasks.map((task) => task.id));
  const versionsByTask = groupBy(versions, (item) => item.taskId);
  const exceptionsByTask = groupBy(exceptions, (item) => item.taskId);

  const entries: LongTaskDiagnosisEntry[] = [];
  for (const task of tasks) {
    const issues = aggregateIssues({
      task,
      versions: versionsByTask.get(task.id) ?? [],
      exceptions: exceptionsByTask.get(task.id) ?? [],
      today,
    });
    if (issues.length > 0) {
      entries.push({
        taskId: task.id,
        title: task.title,
        deleted: task.deletedAt !== null,
        issues,
      });
    }
  }

  entries.sort((left, right) => left.title.localeCompare(right.title, 'zh-Hans-CN'));

  return {
    scannedAt: nowISOString(),
    total: tasks.length,
    healthy: tasks.length - entries.length,
    entries,
    orphanVersions: versions.filter((item) => !taskIds.has(item.taskId)).length,
    orphanExceptions: exceptions.filter((item) => !taskIds.has(item.taskId)).length,
    durationMs: Date.now() - startedAt,
  };
}

/** 数据库不可用时把底层错误翻译成中文，供设置页直接展示。 */
export function describeDiagnosisError(error: unknown): string {
  return describeDatabaseError(error);
}

function groupBy<T>(items: T[], keyOf: (item: T) => Id): Map<Id, T[]> {
  const map = new Map<Id, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const bucket = map.get(key);
    if (bucket) {
      bucket.push(item);
    } else {
      map.set(key, [item]);
    }
  }
  return map;
}
