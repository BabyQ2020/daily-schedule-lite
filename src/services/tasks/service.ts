import { db, type WorkbenchDatabase } from '@/db/db';
import type { Task } from '@/domain/types';
import { nowISOString } from '@/lib/clock';
import {
  DEFAULT_TASK_SORT,
  archiveTasks as archiveTaskRecords,
  createTask as createTaskRecord,
  deleteTasks as deleteTaskRecords,
  getTask as getTaskRecord,
  purgeTasks as purgeTaskRecords,
  queryTasks as queryTaskRecords,
  restoreDeletedTasks as restoreDeletedTaskRecords,
  restoreTasks as unarchiveTaskRecords,
  setTaskStatus as setTaskStatusRecord,
  softDeleteTasks as softDeleteTaskRecords,
  updateTask as updateTaskRecord,
  type DeleteTasksResult,
  type TaskCreateInput,
  type TaskFilter,
  type TaskSort,
  type TaskSortKey,
  type TaskUpdateInput,
} from '@/repositories/tasks';
import type { PageRequest, PagedResult } from '@/repositories/shared';

/**
 * 普通任务应用服务。
 *
 * 页面与特性层只依赖本模块：CRUD 直通函数在这里集中导出，
 * 软删除/回收站语义在本层注入时钟与默认分页，事务与引用清理仍在 Repository。
 */

export interface TaskServiceDeps {
  database?: WorkbenchDatabase;
  /** 测试注入：ISO 时间戳。 */
  now?: string;
}

interface ResolvedDeps {
  database: WorkbenchDatabase;
  now: string;
}

function resolveDeps(deps: TaskServiceDeps = {}): ResolvedDeps {
  return {
    database: deps.database ?? db,
    now: deps.now ?? nowISOString(),
  };
}

/* ------------------------------------------------------------------ *
 * CRUD（直通）
 * ------------------------------------------------------------------ */

export const createTask = createTaskRecord;
export const getTask = getTaskRecord;
export const updateTask = updateTaskRecord;
export const queryTasks = queryTaskRecords;
export const setTaskStatus = setTaskStatusRecord;
export const archiveTasks = archiveTaskRecords;
export const deleteTasks = deleteTaskRecords;

/** 取消归档（与回收站「恢复」不是一回事，单独命名避免误用）。 */
export const unarchiveTasks = unarchiveTaskRecords;

export { DEFAULT_TASK_SORT };
export type { TaskCreateInput, TaskFilter, TaskSort, TaskSortKey, TaskUpdateInput };

/* ------------------------------------------------------------------ *
 * 软删除 / 回收站
 * ------------------------------------------------------------------ */

/** 软删除：进回收站，保留计划勾选与日志关联（彻底删除时才清理）。 */
export async function softDeleteTasks(
  ids: readonly string[],
  deps: TaskServiceDeps = {},
): Promise<number> {
  const { database, now } = resolveDeps(deps);
  return softDeleteTaskRecords(ids, { now }, database);
}

/** 恢复：只清 `deletedAt`，保留 `archivedAt`。 */
export async function restoreTasks(
  ids: readonly string[],
  deps: TaskServiceDeps = {},
): Promise<number> {
  const { database, now } = resolveDeps(deps);
  return restoreDeletedTaskRecords(ids, { now }, database);
}

/** 彻底删除：物理删除并摘除计划勾选、日志任务关联（保留标题快照）。 */
export async function purgeTasks(
  ids: readonly string[],
  deps: TaskServiceDeps = {},
): Promise<DeleteTasksResult> {
  const { database } = resolveDeps(deps);
  return purgeTaskRecords(ids, database);
}

/** 回收站列表：只列已软删除的任务，按更新时间倒序。 */
export async function listDeletedTasks(
  page: PageRequest = {},
  deps: TaskServiceDeps = {},
): Promise<PagedResult<Task>> {
  const { database } = resolveDeps(deps);
  // 回收站要显示「删除前已归档」的任务，因此归档维度必须放开为 all。
  return queryTaskRecords(
    { deletion: 'deleted', archived: 'all' },
    DEFAULT_TASK_SORT,
    page,
    database,
  );
}
