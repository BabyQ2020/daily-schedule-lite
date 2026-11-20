import type { WorkbenchDatabase } from '@/db/db';
import { db } from '@/db/db';
import { TASK_PRIORITY_WEIGHT } from '@/domain/labels';
import type { Id, Task, TaskPriority, TaskStatus } from '@/domain/types';
import type { ISODate } from '@/lib/period';
import { nowISOString } from '@/lib/clock';
import { createId } from '@/lib/id';

import { NotFoundError, ValidationError } from './errors';
import {
  compareNullableText,
  nextUpdatedAt,
  paginate,
  type PageRequest,
  type PagedResult,
  type SortDirection,
} from './shared';

export type TaskSortKey = 'updatedAt' | 'createdAt' | 'dueDate' | 'planDate' | 'priority' | 'title';

export interface TaskSort {
  key: TaskSortKey;
  direction: SortDirection;
}

export const DEFAULT_TASK_SORT: TaskSort = { key: 'updatedAt', direction: 'desc' };

/** 删除状态筛选维度；与 `archived`（归档）相互独立。 */
export type DeletionScope = 'active' | 'deleted' | 'all';

export interface TaskFilter {
  keyword?: string;
  projectId?: Id | 'all' | 'none';
  status?: TaskStatus | 'all';
  priorities?: readonly TaskPriority[];
  tagId?: Id | 'all';
  planFrom?: ISODate;
  planTo?: ISODate;
  dueFrom?: ISODate;
  dueTo?: ISODate;
  archived?: 'active' | 'archived' | 'all';
  /** 默认 `active`：只返回未进回收站的任务，无论是否归档。 */
  deletion?: DeletionScope;
}

export interface TaskCreateInput {
  title: string;
  description?: string;
  projectId?: Id | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  planDate?: ISODate | null;
  dueDate?: ISODate | null;
  parentId?: Id | null;
  tags?: readonly Id[];
  note?: string;
  now?: string;
}

export interface TaskUpdateInput {
  title?: string;
  description?: string;
  projectId?: Id | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  planDate?: ISODate | null;
  dueDate?: ISODate | null;
  parentId?: Id | null;
  tags?: readonly Id[];
  note?: string;
  now?: string;
}

const SORTABLE_TEXT_FIELDS = new Set<TaskSortKey>([
  'updatedAt',
  'createdAt',
  'dueDate',
  'planDate',
]);

function requireTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length === 0) {
    throw new ValidationError('任务标题不能为空。');
  }
  return trimmed;
}

/** 完成时间与状态保持一致：进入 done 时补时间，离开 done 时清空。 */
function resolveCompletion(
  status: TaskStatus,
  completedAt: string | null,
  now: string,
): string | null {
  if (status === 'done') {
    return completedAt ?? now;
  }
  return null;
}

/**
 * 历史异常记录可能缺 `deletedAt` 字段（v2 升级已回填，但不依赖它）。
 * 缺失一律视为「未删除」，绝不当成已删除处理。
 */
function normalizeTask(task: Task): Task {
  if (Object.prototype.hasOwnProperty.call(task, 'deletedAt')) {
    return task;
  }
  return { ...task, deletedAt: null };
}

function matchesDeletion(task: Task, scope: DeletionScope): boolean {
  if (scope === 'all') {
    return true;
  }
  return scope === 'deleted' ? task.deletedAt !== null : task.deletedAt === null;
}

function matchesFilter(task: Task, filter: TaskFilter): boolean {
  if (!matchesDeletion(task, filter.deletion ?? 'active')) {
    return false;
  }

  const archived = filter.archived ?? 'active';
  if (archived === 'active' && task.archivedAt !== null) {
    return false;
  }
  if (archived === 'archived' && task.archivedAt === null) {
    return false;
  }

  if (filter.projectId && filter.projectId !== 'all') {
    if (filter.projectId === 'none') {
      if (task.projectId !== null) {
        return false;
      }
    } else if (task.projectId !== filter.projectId) {
      return false;
    }
  }

  if (filter.status && filter.status !== 'all' && task.status !== filter.status) {
    return false;
  }

  if (
    filter.priorities &&
    filter.priorities.length > 0 &&
    !filter.priorities.includes(task.priority)
  ) {
    return false;
  }

  if (filter.tagId && filter.tagId !== 'all' && !task.tags.includes(filter.tagId)) {
    return false;
  }

  if (filter.planFrom || filter.planTo) {
    if (task.planDate === null) {
      return false;
    }
    if (filter.planFrom && task.planDate < filter.planFrom) {
      return false;
    }
    if (filter.planTo && task.planDate > filter.planTo) {
      return false;
    }
  }

  if (filter.dueFrom || filter.dueTo) {
    if (task.dueDate === null) {
      return false;
    }
    if (filter.dueFrom && task.dueDate < filter.dueFrom) {
      return false;
    }
    if (filter.dueTo && task.dueDate > filter.dueTo) {
      return false;
    }
  }

  const keyword = filter.keyword?.trim().toLowerCase();
  if (keyword) {
    const haystack = `${task.title} ${task.description} ${task.note}`.toLowerCase();
    if (!haystack.includes(keyword)) {
      return false;
    }
  }

  return true;
}

/** 尽量走索引取候选集，只在无法索引时整表扫描（10k 量级仍可接受）。 */
async function loadCandidates(database: WorkbenchDatabase, filter: TaskFilter): Promise<Task[]> {
  const keyword = filter.keyword?.trim();
  if (!keyword) {
    if (filter.projectId && filter.projectId !== 'all' && filter.projectId !== 'none') {
      return database.tasks.where('projectId').equals(filter.projectId).toArray();
    }
    if (filter.status && filter.status !== 'all') {
      return database.tasks.where('status').equals(filter.status).toArray();
    }
    if (filter.tagId && filter.tagId !== 'all') {
      return database.tasks.where('tags').equals(filter.tagId).toArray();
    }
  }
  return database.tasks.toArray();
}

function compareTasks(a: Task, b: Task, sort: TaskSort): number {
  const { key, direction } = sort;

  if (SORTABLE_TEXT_FIELDS.has(key)) {
    const left = a[key as 'updatedAt' | 'createdAt' | 'dueDate' | 'planDate'];
    const right = b[key as 'updatedAt' | 'createdAt' | 'dueDate' | 'planDate'];
    const primary = compareNullableText(left, right, direction);
    if (primary !== 0) {
      return primary;
    }
  } else if (key === 'priority') {
    const primary =
      (TASK_PRIORITY_WEIGHT[a.priority] - TASK_PRIORITY_WEIGHT[b.priority]) *
      (direction === 'asc' ? 1 : -1);
    if (primary !== 0) {
      return primary;
    }
  } else {
    const primary = a.title.localeCompare(b.title, 'zh-Hans-CN');
    if (primary !== 0) {
      return direction === 'asc' ? primary : -primary;
    }
  }

  // 稳定排序：同值时按创建时间倒序，再按 id，避免翻页抖动
  if (a.createdAt !== b.createdAt) {
    return a.createdAt < b.createdAt ? 1 : -1;
  }
  return a.id < b.id ? -1 : 1;
}

export async function queryTasks(
  filter: TaskFilter = {},
  sort: TaskSort = DEFAULT_TASK_SORT,
  page: PageRequest = {},
  database: WorkbenchDatabase = db,
): Promise<PagedResult<Task>> {
  const candidates = (await loadCandidates(database, filter)).map(normalizeTask);
  const filtered = candidates.filter((task) => matchesFilter(task, filter));
  filtered.sort((a, b) => compareTasks(a, b, sort));
  return paginate(filtered, page);
}

export async function listTasks(
  filter: TaskFilter = {},
  database: WorkbenchDatabase = db,
): Promise<Task[]> {
  const candidates = (await loadCandidates(database, filter)).map(normalizeTask);
  return candidates.filter((task) => matchesFilter(task, filter));
}

/**
 * 按 id 读取任务。
 *
 * 语义保持与既有调用一致：**不**按删除状态过滤，软删除的任务也能取到，
 * 供回收站与「编辑已删除任务」等场景使用；列表查询才是过滤入口。
 */
export async function getTask(id: Id, database: WorkbenchDatabase = db): Promise<Task | undefined> {
  const task = await database.tasks.get(id);
  return task ? normalizeTask(task) : undefined;
}

export async function createTask(
  input: TaskCreateInput,
  database: WorkbenchDatabase = db,
): Promise<Task> {
  const now = input.now ?? nowISOString();
  const status = input.status ?? 'todo';
  const task: Task = {
    id: createId('task'),
    title: requireTitle(input.title),
    description: input.description ?? '',
    projectId: input.projectId ?? null,
    status,
    priority: input.priority ?? 'medium',
    planDate: input.planDate ?? null,
    dueDate: input.dueDate ?? null,
    completedAt: resolveCompletion(status, null, now),
    parentId: input.parentId ?? null,
    tags: [...(input.tags ?? [])],
    note: input.note ?? '',
    archivedAt: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  await database.tasks.add(task);
  return task;
}

/**
 * 更新任务。
 *
 * 签名保持既有顺序 `updateTask(id, patch, database)`，第三个参数仍是数据库实例，
 * 旧调用点（service 层传独立测试库）无需修改。`updatedAt` 走严格递增规则。
 */
export async function updateTask(
  id: Id,
  patch: TaskUpdateInput,
  database: WorkbenchDatabase = db,
): Promise<Task> {
  // 读-算-写必须在同一个 rw 事务内：并发调用时才不会基于同一个旧快照覆盖。
  return database.transaction('rw', database.tasks, async () => {
    const stored = await database.tasks.get(id);
    if (!stored) {
      throw new NotFoundError('任务');
    }
    const existing = normalizeTask(stored);
    const now = patch.now ?? nowISOString();
    const nextStatus = patch.status ?? existing.status;
    const next: Task = {
      ...existing,
      ...(patch.title !== undefined ? { title: requireTitle(patch.title) } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.projectId !== undefined ? { projectId: patch.projectId } : {}),
      ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
      ...(patch.planDate !== undefined ? { planDate: patch.planDate } : {}),
      ...(patch.dueDate !== undefined ? { dueDate: patch.dueDate } : {}),
      ...(patch.parentId !== undefined ? { parentId: patch.parentId } : {}),
      ...(patch.tags !== undefined ? { tags: [...patch.tags] } : {}),
      ...(patch.note !== undefined ? { note: patch.note } : {}),
      status: nextStatus,
      completedAt: resolveCompletion(nextStatus, existing.completedAt, now),
      updatedAt: nextUpdatedAt(existing.updatedAt, now),
    };
    await database.tasks.put(next);
    return next;
  });
}

export async function setTaskStatus(
  id: Id,
  status: TaskStatus,
  database: WorkbenchDatabase = db,
): Promise<Task> {
  return updateTask(id, { status }, database);
}

export interface ArchiveOptions {
  /** 注入时钟，便于测试严格递增；默认取当前时间。 */
  now?: string;
}

export async function archiveTasks(
  ids: readonly Id[],
  database: WorkbenchDatabase = db,
  options: ArchiveOptions = {},
): Promise<number> {
  if (ids.length === 0) {
    return 0;
  }
  const now = options.now ?? nowISOString();
  return database.transaction('rw', database.tasks, async () => {
    const tasks = await database.tasks.bulkGet([...ids]);
    const existing = tasks.filter((task): task is Task => task !== undefined).map(normalizeTask);
    if (existing.length === 0) {
      return 0;
    }
    await database.tasks.bulkPut(
      existing.map((task) => ({
        ...task,
        archivedAt: now,
        updatedAt: nextUpdatedAt(task.updatedAt, now),
      })),
    );
    return existing.length;
  });
}

export async function restoreTasks(
  ids: readonly Id[],
  database: WorkbenchDatabase = db,
  options: ArchiveOptions = {},
): Promise<number> {
  if (ids.length === 0) {
    return 0;
  }
  const now = options.now ?? nowISOString();
  return database.transaction('rw', database.tasks, async () => {
    const tasks = await database.tasks.bulkGet([...ids]);
    const existing = tasks.filter((task): task is Task => task !== undefined).map(normalizeTask);
    if (existing.length === 0) {
      return 0;
    }
    await database.tasks.bulkPut(
      existing.map((task) => ({
        ...task,
        archivedAt: null,
        updatedAt: nextUpdatedAt(task.updatedAt, now),
      })),
    );
    return existing.length;
  });
}

/**
 * 软删除：只写 `deletedAt` 与严格递增的 `updatedAt`。
 *
 * 刻意**不**触碰 `dailyPlans`、`workLogs` 与 `archivedAt`——计划引用保留，
 * 彻底删除（`purgeTasks`）才做引用清理。已删除的行保持原样，保证幂等。
 */
export async function softDeleteTasks(
  ids: readonly Id[],
  options: ArchiveOptions = {},
  database: WorkbenchDatabase = db,
): Promise<number> {
  if (ids.length === 0) {
    return 0;
  }
  const now = options.now ?? nowISOString();
  return database.transaction('rw', database.tasks, async () => {
    const tasks = await database.tasks.bulkGet([...ids]);
    const targets = tasks
      .filter((task): task is Task => task !== undefined)
      .map(normalizeTask)
      .filter((task) => task.deletedAt === null);
    if (targets.length === 0) {
      return 0;
    }
    await database.tasks.bulkPut(
      targets.map((task) => ({
        ...task,
        deletedAt: now,
        updatedAt: nextUpdatedAt(task.updatedAt, now),
      })),
    );
    return targets.length;
  });
}

/**
 * 从回收站恢复：只把 `deletedAt` 置回 `null`，保留 `archivedAt` 与其它字段。
 * 对未删除的任务不产生任何写入，返回值是实际恢复的条数。
 */
export async function restoreDeletedTasks(
  ids: readonly Id[],
  options: ArchiveOptions = {},
  database: WorkbenchDatabase = db,
): Promise<number> {
  if (ids.length === 0) {
    return 0;
  }
  const now = options.now ?? nowISOString();
  return database.transaction('rw', database.tasks, async () => {
    const tasks = await database.tasks.bulkGet([...ids]);
    const targets = tasks
      .filter((task): task is Task => task !== undefined)
      .map(normalizeTask)
      .filter((task) => task.deletedAt !== null);
    if (targets.length === 0) {
      return 0;
    }
    await database.tasks.bulkPut(
      targets.map((task) => ({
        ...task,
        deletedAt: null,
        updatedAt: nextUpdatedAt(task.updatedAt, now),
      })),
    );
    return targets.length;
  });
}

export interface DeleteTasksResult {
  deleted: number;
  detachedLogs: number;
  updatedPlans: number;
}

/**
 * 彻底删除（回收站「彻底删除」与既有「删除」共用）。
 *
 * 与软删除是两个独立语义：这里才清理 `dailyPlans.taskIds` 与 `workLogs.taskId`。
 */
export async function purgeTasks(
  ids: readonly Id[],
  database: WorkbenchDatabase = db,
): Promise<DeleteTasksResult> {
  return deleteTasks(ids, database);
}

/**
 * 删除任务（硬删，D19）。
 * 同一事务内完成三件事，避免留下悬空引用：
 * 1) 删除任务；
 * 2) 从每日计划的 taskIds 中移除；
 * 3) 关联日志置空 taskId，并补上标题快照（保留可读历史）。
 */
export async function deleteTasks(
  ids: readonly Id[],
  database: WorkbenchDatabase = db,
): Promise<DeleteTasksResult> {
  if (ids.length === 0) {
    return { deleted: 0, detachedLogs: 0, updatedPlans: 0 };
  }
  const now = nowISOString();
  const idSet = new Set(ids);

  return database.transaction(
    'rw',
    [database.tasks, database.dailyPlans, database.workLogs],
    async () => {
      const tasks = await database.tasks.bulkGet([...ids]);
      const existing = tasks.filter((task): task is Task => task !== undefined);
      const titleById = new Map(existing.map((task) => [task.id, task.title]));

      await database.tasks.bulkDelete([...idSet]);

      const plans = await database.dailyPlans.toArray();
      const plansToUpdate = plans.filter((plan) =>
        plan.taskIds.some((taskId) => idSet.has(taskId)),
      );
      await database.dailyPlans.bulkPut(
        plansToUpdate.map((plan) => ({
          ...plan,
          taskIds: plan.taskIds.filter((taskId) => !idSet.has(taskId)),
          updatedAt: now,
        })),
      );

      const logs = await database.workLogs
        .where('taskId')
        .anyOf([...idSet])
        .toArray();
      await database.workLogs.bulkPut(
        logs.map((log) => ({
          ...log,
          taskId: null,
          taskTitleSnapshot: log.taskTitleSnapshot ?? titleById.get(log.taskId ?? '') ?? null,
          updatedAt: now,
        })),
      );

      return {
        deleted: existing.length,
        detachedLogs: logs.length,
        updatedPlans: plansToUpdate.length,
      };
    },
  );
}
