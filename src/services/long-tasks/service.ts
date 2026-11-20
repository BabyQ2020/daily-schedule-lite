import { db, type WorkbenchDatabase } from '@/db/db';
import type {
  LifecycleEvent,
  LongTask,
  LongTaskException,
  LongTaskRuleVersion,
} from '@/domain/long-task';
import { nowISOString, todayISO } from '@/lib/clock';
import type { ISODate } from '@/lib/period';
import {
  DEFAULT_LONG_TASK_SORT,
  appendLongTaskException,
  appendLongTaskLifecycleEvent,
  appendLongTaskRuleVersion,
  createLongTask as createLongTaskRecord,
  getLongTaskAggregate,
  purgeLongTask,
  queryLongTaskAggregates,
  reopenLongTaskWithRuleVersion,
  restoreLongTask,
  revokeLongTaskException,
  setLongTaskArchived,
  softDeleteLongTask,
  updateLongTaskInfo,
  replaceLongTaskRuleVersion,
  moveLongTaskOrder,
  type LongTaskAggregate,
  type LongTaskCreateInput,
  type LongTaskExceptionInput,
  type LongTaskExceptionRevokeInput,
  type LongTaskInfoPatch,
  type LongTaskLifecycleInput,
  type LongTaskMoveDirection,
  type LongTaskReopenInput,
  type LongTaskRuleReplaceInput,
  type LongTaskRuleVersionInput,
} from '@/repositories/long-tasks';
import type { PageRequest, PagedResult } from '@/repositories/shared';
import { NotFoundError, ValidationError } from '@/repositories/errors';
import {
  compareIso,
  computeSlots,
  resolveOccurrence,
  type ResolvedOccurrence,
} from '@/services/long-tasks/schedule';

/** 供 UI 层使用的类型出口：页面不直接 import 仓储层。 */
export type { LongTaskAggregate } from '@/repositories/long-tasks';
export type { ResolvedOccurrence } from '@/services/long-tasks/schedule';
export { queryLongTaskAggregates } from '@/repositories/long-tasks';
export type { LongTaskFilter, LongTaskSort } from '@/repositories/long-tasks';

/**
 * 长期任务应用服务（P3.2-S3）。
 *
 * 职责边界：
 * - 页面/特性只调用本模块，不直接接触 Repository 与 Dexie；
 * - 服务负责注入 `now`/`today`、默认首次计划日、把「聚合 + 规则版本 + 例外」展开成可渲染安排；
 * - 事务、乐观锁、守卫、唯一索引冲突翻译仍然留在 Repository（S2.2），服务不重复实现。
 *
 * 本阶段（S4）在 S3 的 7 写入 + 2 查询之上，补齐归档、软删除、恢复、彻底删除与回收站查询。
 */

export interface ServiceDeps {
  database?: WorkbenchDatabase;
  /** 测试注入：ISO 时间戳。 */
  now?: string;
  /** 测试注入：本地日历日。 */
  today?: ISODate;
}

/** 归档 / 取消归档。 */
export interface ArchiveRequest {
  archived: boolean;
  expectedUpdatedAt: string;
}

/** 软删除 / 恢复 / 彻底删除共用：只带乐观锁。 */
export interface DeleteRequest {
  expectedUpdatedAt: string;
}

/** 创建：`startDate` 省略时取今天，便于「新建即生效」。 */
export interface CreateLongTaskRequest extends Omit<LongTaskCreateInput, 'startDate'> {
  startDate?: ISODate;
}

export interface UpdateInfoRequest {
  patch: LongTaskInfoPatch;
  expectedUpdatedAt: string;
}

export interface AppendRuleVersionRequest extends LongTaskRuleVersionInput {
  expectedUpdatedAt: string;
}

export interface WriteExceptionRequest extends LongTaskExceptionInput {
  expectedUpdatedAt: string;
}

export interface RevokeExceptionRequest extends LongTaskExceptionRevokeInput {
  expectedUpdatedAt: string;
}

export interface LifecycleRequest extends LongTaskLifecycleInput {
  expectedUpdatedAt: string;
}

export interface ReopenRequest extends LongTaskReopenInput {
  expectedUpdatedAt: string;
}

interface ResolvedDeps {
  database: WorkbenchDatabase;
  now: string;
  today: ISODate;
}

function resolveDeps(deps: ServiceDeps = {}): ResolvedDeps {
  return {
    database: deps.database ?? db,
    now: deps.now ?? nowISOString(),
    today: deps.today ?? todayISO(),
  };
}

function requireAggregate(
  aggregate: LongTaskAggregate | null | undefined,
  taskId: string,
): LongTaskAggregate {
  if (!aggregate) {
    throw new NotFoundError(`长期任务 ${taskId}`);
  }
  return aggregate;
}

/* ------------------------------------------------------------------ *
 * 7 个写入
 * ------------------------------------------------------------------ */

export async function createLongTask(
  input: CreateLongTaskRequest,
  deps: ServiceDeps = {},
): Promise<{ id: string }> {
  const { database, now, today } = resolveDeps(deps);
  const aggregate = await createLongTaskRecord(
    { ...input, startDate: input.startDate ?? today },
    { now, today },
    database,
  );
  return { id: aggregate.task.id };
}

export async function updateLongTaskInfoById(
  taskId: string,
  input: UpdateInfoRequest,
  deps: ServiceDeps = {},
): Promise<LongTask> {
  const { database, now, today } = resolveDeps(deps);
  return updateLongTaskInfo(
    taskId,
    input.patch,
    { expectedUpdatedAt: input.expectedUpdatedAt, now, today },
    database,
  );
}

export async function appendRuleVersion(
  taskId: string,
  input: AppendRuleVersionRequest,
  deps: ServiceDeps = {},
): Promise<LongTaskRuleVersion> {
  const { database, now, today } = resolveDeps(deps);
  const { expectedUpdatedAt, ...rest } = input;
  const result = await appendLongTaskRuleVersion(
    taskId,
    rest,
    { expectedUpdatedAt, now, today },
    database,
  );
  return result.version;
}

export async function writeException(
  taskId: string,
  input: WriteExceptionRequest,
  deps: ServiceDeps = {},
): Promise<LongTaskException> {
  const { database, now, today } = resolveDeps(deps);
  const { expectedUpdatedAt, ...rest } = input;
  const result = await appendLongTaskException(
    taskId,
    rest,
    { expectedUpdatedAt, now, today },
    database,
  );
  return result.exception;
}

export async function revokeException(
  taskId: string,
  input: RevokeExceptionRequest,
  deps: ServiceDeps = {},
): Promise<LongTaskException> {
  const { database, now, today } = resolveDeps(deps);
  const { expectedUpdatedAt, ...rest } = input;
  const result = await revokeLongTaskException(
    taskId,
    rest,
    { expectedUpdatedAt, now, today },
    database,
  );
  return result.exception;
}

export async function addLifecycleEvent(
  taskId: string,
  input: LifecycleRequest,
  deps: ServiceDeps = {},
): Promise<LifecycleEvent> {
  const { database, now, today } = resolveDeps(deps);
  const { expectedUpdatedAt, ...rest } = input;
  const task = await appendLongTaskLifecycleEvent(
    taskId,
    rest,
    { expectedUpdatedAt, now, today },
    database,
  );
  const created = task.events[task.events.length - 1];
  if (!created) {
    throw new ValidationError('生命周期事件写入失败。');
  }
  return created;
}

export async function reopenWithRuleVersion(
  taskId: string,
  input: ReopenRequest,
  deps: ServiceDeps = {},
): Promise<LongTaskRuleVersion> {
  const { database, now, today } = resolveDeps(deps);
  const { expectedUpdatedAt, ...rest } = input;
  const result = await reopenLongTaskWithRuleVersion(
    taskId,
    rest,
    { expectedUpdatedAt, now, today },
    database,
  );
  return result.version;
}

/* ------------------------------------------------------------------ *
 * 2 个查询
 * ------------------------------------------------------------------ */

export async function getAggregate(
  taskId: string,
  deps: ServiceDeps = {},
): Promise<LongTaskAggregate | null> {
  const { database } = resolveDeps(deps);
  return (await getLongTaskAggregate(taskId, database)) ?? null;
}

/**
 * 展开 `[from, to]` 内的可见安排（skip 不返回）。
 *
 * 计数口径由 `computeSlots` 保证：槽位始终从系列起点累计，窗口只做过滤，
 * 因此分窗查询的结果与整段查询一致。
 */
export async function listOccurrences(
  taskId: string,
  from: ISODate,
  to: ISODate,
  deps: ServiceDeps = {},
): Promise<ResolvedOccurrence[]> {
  if (compareIso(from, to) > 0) {
    throw new ValidationError('查询区间无效：开始日期不能晚于结束日期。');
  }
  const { database } = resolveDeps(deps);
  const aggregate = requireAggregate(await getLongTaskAggregate(taskId, database), taskId);

  const slots = computeSlots({
    task: aggregate.task,
    versions: aggregate.versions,
    exceptions: aggregate.exceptions,
    dateUpper: to,
  });

  return slots
    .filter((slot) => compareIso(slot.date, from) >= 0)
    .map((slot) => resolveOccurrence(slot))
    .filter((occurrence): occurrence is ResolvedOccurrence => occurrence !== null);
}

/* ------------------------------------------------------------------ *
 * S4：归档、软删除、恢复、彻底删除、回收站
 * ------------------------------------------------------------------ */

/** 归档/取消归档；幂等（目标状态已满足时不写库、不推进 updatedAt）。 */
export async function setArchived(
  taskId: string,
  input: ArchiveRequest,
  deps: ServiceDeps = {},
): Promise<LongTask> {
  const { database, now, today } = resolveDeps(deps);
  return setLongTaskArchived(
    taskId,
    input.archived,
    { expectedUpdatedAt: input.expectedUpdatedAt, now, today },
    database,
  );
}

/** 软删除：进回收站，不追加生命周期事件，保留规则版本与例外。 */
export async function softDelete(
  taskId: string,
  input: DeleteRequest,
  deps: ServiceDeps = {},
): Promise<LongTask> {
  const { database, now, today } = resolveDeps(deps);
  return softDeleteLongTask(
    taskId,
    { expectedUpdatedAt: input.expectedUpdatedAt, now, today },
    database,
  );
}

/** 恢复：只清 `deletedAt`，保留 `archivedAt` 与生命周期状态（恢复 ≠ 重新启用）。 */
export async function restore(
  taskId: string,
  input: DeleteRequest,
  deps: ServiceDeps = {},
): Promise<LongTask> {
  const { database, now, today } = resolveDeps(deps);
  return restoreLongTask(
    taskId,
    { expectedUpdatedAt: input.expectedUpdatedAt, now, today },
    database,
  );
}

/** 彻底删除：同事务删除主记录、全部规则版本与例外，返回删除条数。 */
export async function purge(
  taskId: string,
  input: DeleteRequest,
  deps: ServiceDeps = {},
): Promise<{ task: number; versions: number; exceptions: number }> {
  const { database, now, today } = resolveDeps(deps);
  return purgeLongTask(
    taskId,
    { expectedUpdatedAt: input.expectedUpdatedAt, now, today },
    database,
  );
}

/** 回收站列表：只列已软删除的长期任务，按更新时间倒序。 */
export async function listDeleted(
  page: PageRequest = {},
  deps: ServiceDeps = {},
): Promise<PagedResult<LongTaskAggregate>> {
  const { database } = resolveDeps(deps);
  return queryLongTaskAggregates(
    { deleted: 'deleted', archived: 'all' },
    DEFAULT_LONG_TASK_SORT,
    page,
    database,
  );
}

export interface ReplaceRuleRequest extends LongTaskRuleReplaceInput {
  expectedUpdatedAt: string;
}

/** 规则覆盖：直接改写当前生效版本，立即生效（不产生新版本）。 */
export async function replaceRule(
  taskId: string,
  input: ReplaceRuleRequest,
  deps: ServiceDeps = {},
): Promise<LongTaskRuleVersion> {
  const { database, now, today } = resolveDeps(deps);
  const { expectedUpdatedAt, ...rest } = input;
  const result = await replaceLongTaskRuleVersion(
    taskId,
    rest,
    { expectedUpdatedAt, now, today },
    database,
  );
  return result.version;
}

export interface MoveRequest {
  expectedUpdatedAt: string;
}

/** 手动调整上下顺序（up/down）。 */
export async function move(
  taskId: string,
  direction: LongTaskMoveDirection,
  input: MoveRequest,
  deps: ServiceDeps = {},
): Promise<void> {
  const { database, now, today } = resolveDeps(deps);
  await moveLongTaskOrder(
    taskId,
    direction,
    { expectedUpdatedAt: input.expectedUpdatedAt, now, today },
    database,
  );
}
