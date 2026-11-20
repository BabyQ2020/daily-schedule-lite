import { db } from '@/db/db';
import type { WorkbenchDatabase } from '@/db/db';
import type { Id, TaskPriority, TaskStatus } from '@/domain/types';
import { archiveTasks, deleteTasks, restoreTasks, updateTask } from '@/repositories/tasks';
import type { DeleteTasksResult } from '@/repositories/tasks';

/**
 * 批量操作的落点：界面只调用这里，不直接拼事务。
 * 单事务内逐条写入，任何一条失败整体回滚，避免「一半完成一半没动」。
 */
export async function batchSetStatus(
  ids: readonly Id[],
  status: TaskStatus,
  database: WorkbenchDatabase = db,
): Promise<number> {
  if (ids.length === 0) {
    return 0;
  }
  return database.transaction('rw', database.tasks, async () => {
    for (const id of ids) {
      await updateTask(id, { status }, database);
    }
    return ids.length;
  });
}

export async function batchSetPriority(
  ids: readonly Id[],
  priority: TaskPriority,
  database: WorkbenchDatabase = db,
): Promise<number> {
  if (ids.length === 0) {
    return 0;
  }
  return database.transaction('rw', database.tasks, async () => {
    for (const id of ids) {
      await updateTask(id, { priority }, database);
    }
    return ids.length;
  });
}

export async function batchAssignProject(
  ids: readonly Id[],
  projectId: Id | null,
  database: WorkbenchDatabase = db,
): Promise<number> {
  if (ids.length === 0) {
    return 0;
  }
  return database.transaction('rw', database.tasks, async () => {
    for (const id of ids) {
      await updateTask(id, { projectId }, database);
    }
    return ids.length;
  });
}

/** 追加标签（不覆盖已有标签）。 */
export async function batchAddTag(
  ids: readonly Id[],
  tagId: Id,
  database: WorkbenchDatabase = db,
): Promise<number> {
  if (ids.length === 0) {
    return 0;
  }
  return database.transaction('rw', database.tasks, async () => {
    let changed = 0;
    for (const id of ids) {
      const task = await database.tasks.get(id);
      if (!task || task.tags.includes(tagId)) {
        continue;
      }
      await updateTask(id, { tags: [...task.tags, tagId] }, database);
      changed += 1;
    }
    return changed;
  });
}

export async function batchArchive(
  ids: readonly Id[],
  archived: boolean,
  database: WorkbenchDatabase = db,
): Promise<number> {
  return archived ? archiveTasks(ids, database) : restoreTasks(ids, database);
}

export async function batchRemove(
  ids: readonly Id[],
  database: WorkbenchDatabase = db,
): Promise<DeleteTasksResult> {
  return deleteTasks(ids, database);
}
