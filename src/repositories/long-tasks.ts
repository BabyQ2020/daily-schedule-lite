import type { WorkbenchDatabase } from '@/db/db';
import { db } from '@/db/db';
import { TASK_PRIORITY_WEIGHT } from '@/domain/labels';
import type {
  EndCondition,
  ExceptionChangeKind,
  ExceptionState,
  LifecycleEvent,
  LongTask,
  LongTaskException,
  LongTaskRuleVersion,
  RecurrenceSpec,
} from '@/domain/long-task';
import type { Id, TaskPriority } from '@/domain/types';
import { nowISOString, todayISO } from '@/lib/clock';
import { createId } from '@/lib/id';
import { isRealIsoDate } from '@/lib/iso-date';
import type { ISODate } from '@/lib/period';
import {
  aggregateIssues,
  canEndOn,
  canPauseOn,
  canReopenOn,
  canResumeOn,
  validateExceptionWrite,
  validateLifecycleUpdate,
  validateLongTask,
  validateRuleVersion,
  type ScheduleIssue,
} from '@/services/long-tasks/guards';
import {
  activeVersionOf,
  compareIso,
  deriveState,
  describeSpecIssue,
  hardStopOf,
  minIso,
  slotOn,
} from '@/services/long-tasks/schedule';

import { ConflictError, NotFoundError, ValidationError } from './errors';
import {
  compareNullableText,
  directionFactor,
  nextUpdatedAt,
  paginate,
  type PageRequest,
  type PagedResult,
  type SortDirection,
} from './shared';

/** 聚合读取时的结构性异常标记；只描述读到的问题，绝不在读取阶段修复数据。 */
export type LongTaskAggregateIssueCode =
  | 'NO_VERSIONS'
  | 'VERSION_ORDER'
  | 'EXCEPTION_REVISION_GAP'
  | 'EXCEPTION_PREVIOUS_MISMATCH'
  | 'EXCEPTION_ORPHAN_BASE';

export interface LongTaskAggregateIssue {
  code: LongTaskAggregateIssueCode;
  message: string;
  /** 出问题的记录 id 或日期，便于定位。 */
  entityId?: Id;
}

/** 长期任务聚合根：主记录 + 全部规则版本 + 全部例外（不折叠修订链）。 */
export interface LongTaskAggregate {
  task: LongTask;
  versions: LongTaskRuleVersion[];
  exceptions: LongTaskException[];
  issues: LongTaskAggregateIssue[];
}

export type LongTaskDeletionScope = 'active' | 'deleted' | 'all';
export type LongTaskArchiveScope = 'active' | 'archived' | 'all';
export type LongTaskSortKey = 'updatedAt' | 'startDate' | 'priority' | 'title';

export interface LongTaskSort {
  key: LongTaskSortKey;
  direction: SortDirection;
}

export const DEFAULT_LONG_TASK_SORT: LongTaskSort = { key: 'updatedAt', direction: 'desc' };

export interface LongTaskFilter {
  /** 标题 / 描述 / 备注 的子串匹配（大小写不敏感）。 */
  keyword?: string;
  /** 默认 `active`：只返回未进回收站的长期任务。 */
  deleted?: LongTaskDeletionScope;
  /** 默认 `active`：只返回未归档的长期任务；恢复软删除不会自动取消归档。 */
  archived?: LongTaskArchiveScope;
  priorities?: readonly TaskPriority[];
  tagId?: Id | 'all';
  startFrom?: ISODate;
  startTo?: ISODate;
}

/** ISO 日期/时间字符串比较：两者都是定长文本，可直接按字典序比较。 */
function compareIsoText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareId(a: Id, b: Id): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * 历史数据或手工导入的记录可能缺 `deletedAt` / `archivedAt`。
 * 缺失一律视为「未删除、未归档」，绝不当成已删除处理。
 */
function normalizeLongTask(task: LongTask): LongTask {
  const needsDeleted = !Object.prototype.hasOwnProperty.call(task, 'deletedAt');
  const needsArchived = !Object.prototype.hasOwnProperty.call(task, 'archivedAt');
  if (!needsDeleted && !needsArchived) {
    return task;
  }
  return {
    ...task,
    deletedAt: needsDeleted ? null : task.deletedAt,
    archivedAt: needsArchived ? null : task.archivedAt,
  };
}

function matchesFilter(task: LongTask, filter: LongTaskFilter): boolean {
  const deleted = filter.deleted ?? 'active';
  if (deleted === 'active' && task.deletedAt !== null) {
    return false;
  }
  if (deleted === 'deleted' && task.deletedAt === null) {
    return false;
  }

  const archived = filter.archived ?? 'active';
  if (archived === 'active' && task.archivedAt !== null) {
    return false;
  }
  if (archived === 'archived' && task.archivedAt === null) {
    return false;
  }

  if (filter.priorities && filter.priorities.length > 0) {
    if (!filter.priorities.includes(task.priority)) {
      return false;
    }
  }

  if (filter.tagId && filter.tagId !== 'all' && !task.tags.includes(filter.tagId)) {
    return false;
  }

  if (filter.startFrom && task.startDate < filter.startFrom) {
    return false;
  }
  if (filter.startTo && task.startDate > filter.startTo) {
    return false;
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

/** 尽量走索引取候选集，无法索引时整表扫描（长期任务量级小，可接受）。 */
async function loadCandidates(
  database: WorkbenchDatabase,
  filter: LongTaskFilter,
): Promise<LongTask[]> {
  const keyword = filter.keyword?.trim();
  if (!keyword) {
    if (filter.tagId && filter.tagId !== 'all') {
      return database.longTasks.where('tags').equals(filter.tagId).toArray();
    }
    if (filter.priorities && filter.priorities.length === 1) {
      const only = filter.priorities[0];
      if (only) {
        return database.longTasks.where('priority').equals(only).toArray();
      }
    }
    if (filter.startFrom && filter.startTo) {
      return database.longTasks
        .where('startDate')
        .between(filter.startFrom, filter.startTo, true, true)
        .toArray();
    }
    if ((filter.deleted ?? 'active') === 'deleted') {
      // deletedAt 为 null 的记录不进索引，因此这里只能取「非空」区间。
      return database.longTasks.where('deletedAt').above('').toArray();
    }
  }
  return database.longTasks.toArray();
}

function compareLongTasks(a: LongTask, b: LongTask, sort: LongTaskSort): number {
  const { key, direction } = sort;
  let primary = 0;

  // 手动排序优先：长期任务面板允许用户拖动/上下移动，序号小的在上面。
  const orderDelta = (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
  if (orderDelta !== 0) {
    return orderDelta;
  }

  if (key === 'priority') {
    primary =
      (TASK_PRIORITY_WEIGHT[a.priority] - TASK_PRIORITY_WEIGHT[b.priority]) *
      directionFactor(direction);
  } else if (key === 'title') {
    primary = a.title.localeCompare(b.title, 'zh-Hans-CN') * directionFactor(direction);
  } else if (key === 'startDate') {
    primary = compareNullableText(a.startDate, b.startDate, direction);
  } else {
    primary = compareNullableText(a.updatedAt, b.updatedAt, direction);
  }

  if (primary !== 0) {
    return primary;
  }
  // 稳定兜底：同值时按 id 升序，保证翻页不抖动。
  return compareId(a.id, b.id);
}

function compareVersions(a: LongTaskRuleVersion, b: LongTaskRuleVersion): number {
  return (
    compareIsoText(a.effectiveFrom, b.effectiveFrom) ||
    a.versionNo - b.versionNo ||
    compareId(a.id, b.id)
  );
}

function compareExceptions(a: LongTaskException, b: LongTaskException): number {
  return (
    compareIsoText(a.occurrenceDate, b.occurrenceDate) ||
    a.revision - b.revision ||
    compareId(a.id, b.id)
  );
}

function collectIssues(
  taskId: Id,
  versions: LongTaskRuleVersion[],
  exceptions: LongTaskException[],
): LongTaskAggregateIssue[] {
  const issues: LongTaskAggregateIssue[] = [];

  if (versions.length === 0) {
    issues.push({
      code: 'NO_VERSIONS',
      message: '该长期任务没有任何规则版本，无法生成任何安排。',
      entityId: taskId,
    });
  }

  // versions 已按 effectiveFrom 升序；若 versionNo 不随之严格递增，说明数据被改乱。
  let previousVersionNo = 0;
  for (const version of versions) {
    if (version.versionNo <= previousVersionNo) {
      issues.push({
        code: 'VERSION_ORDER',
        message: `规则版本号与生效日期顺序不一致（生效日 ${version.effectiveFrom} 的版本号为 ${version.versionNo}）。`,
        entityId: version.id,
      });
      break;
    }
    previousVersionNo = version.versionNo;
  }

  const byDate = new Map<string, LongTaskException[]>();
  for (const exception of exceptions) {
    const list = byDate.get(exception.occurrenceDate);
    if (list) {
      list.push(exception);
    } else {
      byDate.set(exception.occurrenceDate, [exception]);
    }
  }

  for (const [date, list] of byDate) {
    const byRevision = new Map<number, LongTaskException>();
    for (const exception of list) {
      byRevision.set(exception.revision, exception);
    }
    const revisions = [...byRevision.keys()].sort((a, b) => a - b);
    const first = revisions[0];
    const last = revisions[revisions.length - 1];
    if (first === undefined || last === undefined) {
      continue;
    }

    if (first > 1) {
      issues.push({
        code: 'EXCEPTION_ORPHAN_BASE',
        message: `${date} 的例外修订从第 ${first} 条开始，缺少基础记录（revision 1）。`,
        entityId: date,
      });
    }

    const missing: number[] = [];
    for (let revision = first; revision <= last; revision += 1) {
      if (!byRevision.has(revision)) {
        missing.push(revision);
      }
    }
    if (missing.length > 0) {
      issues.push({
        code: 'EXCEPTION_REVISION_GAP',
        message: `${date} 的例外修订链缺少 revision ${missing.join('、')}。`,
        entityId: date,
      });
    }

    for (const exception of list) {
      if (exception.revision === 1) {
        if (exception.previousRevisionId !== null) {
          issues.push({
            code: 'EXCEPTION_PREVIOUS_MISMATCH',
            message: `${date} 的 revision 1 不应有前序记录，但记录指向 ${exception.previousRevisionId}。`,
            entityId: exception.id,
          });
          break;
        }
        continue;
      }
      const previous = byRevision.get(exception.revision - 1);
      if (!previous || exception.previousRevisionId !== previous.id) {
        issues.push({
          code: 'EXCEPTION_PREVIOUS_MISMATCH',
          message: `${date} 的 revision ${exception.revision} 的前序指向与实际链不一致。`,
          entityId: exception.id,
        });
        break;
      }
    }
  }

  return issues;
}

function buildAggregate(
  task: LongTask,
  rawVersions: LongTaskRuleVersion[],
  rawExceptions: LongTaskException[],
): LongTaskAggregate {
  const versions = rawVersions.slice().sort(compareVersions);
  const exceptions = rawExceptions.slice().sort(compareExceptions);
  return {
    task,
    versions,
    exceptions,
    issues: collectIssues(task.id, versions, exceptions),
  };
}

function groupByTaskId<T extends { taskId: Id }>(records: T[]): Map<Id, T[]> {
  const grouped = new Map<Id, T[]>();
  for (const record of records) {
    const list = grouped.get(record.taskId);
    if (list) {
      list.push(record);
    } else {
      grouped.set(record.taskId, [record]);
    }
  }
  return grouped;
}

/** 在已开启的只读事务内，为一批主记录组装聚合（2 次批量查询，非 N+1）。 */
async function assembleMany(
  tasks: LongTask[],
  database: WorkbenchDatabase,
): Promise<LongTaskAggregate[]> {
  if (tasks.length === 0) {
    return [];
  }
  const ids = tasks.map((task) => task.id);
  const [versions, exceptions] = await Promise.all([
    database.longTaskRuleVersions.where('taskId').anyOf(ids).toArray(),
    database.longTaskExceptions.where('taskId').anyOf(ids).toArray(),
  ]);
  const versionMap = groupByTaskId(versions);
  const exceptionMap = groupByTaskId(exceptions);
  return tasks.map((task) =>
    buildAggregate(task, versionMap.get(task.id) ?? [], exceptionMap.get(task.id) ?? []),
  );
}

function transactionTables(database: WorkbenchDatabase) {
  return [database.longTasks, database.longTaskRuleVersions, database.longTaskExceptions];
}

/**
 * 按 id 读取单个聚合。
 *
 * 与 `getTask` 语义一致：**不**按删除或归档状态过滤，调用方用
 * `task.deletedAt` / `task.archivedAt` 自行判断；不存在返回 `undefined`。
 */
export async function getLongTaskAggregate(
  id: Id,
  database: WorkbenchDatabase = db,
): Promise<LongTaskAggregate | undefined> {
  return database.transaction('r', transactionTables(database), async () => {
    const task = await database.longTasks.get(id);
    if (!task) {
      return undefined;
    }
    const [versions, exceptions] = await Promise.all([
      database.longTaskRuleVersions.where('taskId').equals(id).toArray(),
      database.longTaskExceptions.where('taskId').equals(id).toArray(),
    ]);
    return buildAggregate(normalizeLongTask(task), versions, exceptions);
  });
}

/**
 * 批量读取聚合：结果严格遵循输入顺序，重复 id 只返回一次，不存在的 id 跳过。
 *
 * 空数组直接返回 `[]`，不会触发任何查询。
 */
export async function getLongTaskAggregates(
  ids: readonly Id[],
  database: WorkbenchDatabase = db,
): Promise<LongTaskAggregate[]> {
  if (ids.length === 0) {
    return [];
  }
  const uniqueIds: Id[] = [];
  const seen = new Set<Id>();
  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id);
      uniqueIds.push(id);
    }
  }

  return database.transaction('r', transactionTables(database), async () => {
    const tasks = (await database.longTasks.bulkGet(uniqueIds))
      .filter((task): task is LongTask => task !== undefined)
      .map(normalizeLongTask);
    const byId = new Map(tasks.map((task) => [task.id, task]));
    // 按输入顺序重建，再一次性批量组装关联记录。
    const ordered = uniqueIds
      .map((id) => byId.get(id))
      .filter((task): task is LongTask => task !== undefined);
    const aggregates = await assembleMany(ordered, database);
    return aggregates;
  });
}

/**
 * 条件查询 + 排序 + 分页。
 *
 * 分页发生在聚合组装**之前**：只为本页主记录读取 versions / exceptions，
 * 但每个聚合内部的历史记录不截断。默认排除软删除与归档任务。
 */
export async function queryLongTaskAggregates(
  filter: LongTaskFilter = {},
  sort: LongTaskSort = DEFAULT_LONG_TASK_SORT,
  page: PageRequest = {},
  database: WorkbenchDatabase = db,
): Promise<PagedResult<LongTaskAggregate>> {
  return database.transaction('r', transactionTables(database), async () => {
    const candidates = (await loadCandidates(database, filter)).map(normalizeLongTask);
    const filtered = candidates.filter((task) => matchesFilter(task, filter));
    filtered.sort((a, b) => compareLongTasks(a, b, sort));

    const paged = paginate(filtered, page);
    const items = await assembleMany(paged.items, database);
    return {
      items,
      total: paged.total,
      page: paged.page,
      pageSize: paged.pageSize,
      totalPages: paged.totalPages,
    };
  });
}

/* ================================================================== *
 * 写入层（P3.2-S2.2）
 *
 * 约定：
 * - 一次事务只操作一个长期任务聚合；
 * - 读取主记录、乐观锁检查、读取历史、领域校验、写入全部在同一事务内；
 * - 版本 / 例外只追加，绝不覆盖或删除既有记录；
 * - 唯一索引冲突只能「事务外」重新开只读事务诊断，因为在已中止的事务里
 *   继续查询会抛 TransactionInactiveError；
 * - updatedAt 一律走 shared.nextUpdatedAt，禁止复制实现。
 * ================================================================== */

/** 写操作上下文：expectedUpdatedAt 是调用方读取聚合时拿到的版本标记。 */
export interface WriteContext {
  expectedUpdatedAt: string;
  now?: string;
  today?: ISODate;
}

/** 创建上下文：没有旧版本可比对，因此不需要 expectedUpdatedAt。 */
export interface CreateContext {
  now?: string;
  today?: ISODate;
}

export interface LongTaskCreateInput {
  title: string;
  description?: string;
  note?: string;
  priority?: TaskPriority;
  /** 首次计划日，同时也是首版规则的生效日与创建事件的日期。 */
  startDate: ISODate;
  endDate?: ISODate | null;
  endCondition?: EndCondition;
  tags?: readonly Id[];
  spec: RecurrenceSpec;
  changeNote?: string | null;
}

/** 基本信息白名单：受保护字段（startDate/endDate/endCondition/events…）不在其中。 */
export interface LongTaskInfoPatch {
  title?: string;
  description?: string;
  note?: string;
  priority?: TaskPriority;
  tags?: readonly Id[];
}

export interface LongTaskRuleVersionInput {
  effectiveFrom: ISODate;
  spec: RecurrenceSpec;
  changeNote?: string | null;
}

export interface LongTaskExceptionInput {
  occurrenceDate: ISODate;
  changeKind: Extract<ExceptionChangeKind, 'initial' | 'correction'>;
  state: Exclude<ExceptionState, { mode: 'rule' }>;
  reason?: string | null;
}

export interface LongTaskExceptionRevokeInput {
  occurrenceDate: ISODate;
  reason: string;
}

export interface LongTaskLifecycleInput {
  type: 'paused' | 'resumed' | 'ended';
  date: ISODate;
  note?: string | null;
}

export interface LongTaskReopenInput {
  date: ISODate;
  spec: RecurrenceSpec;
  effectiveFrom?: ISODate;
  changeNote?: string | null;
}

const INFO_FIELDS = new Set<string>(['title', 'description', 'note', 'priority', 'tags']);

function raiseIssues(issues: ScheduleIssue[]): never {
  const first = issues[0];
  throw new ValidationError(first?.message ?? '长期任务校验未通过。');
}

function requireTitle(title: string): string {
  const value = title.trim();
  if (value.length === 0) {
    throw new ValidationError('长期任务标题不能为空。');
  }
  if (value.length > 120) {
    throw new ValidationError('长期任务标题不能超过 120 个字符。');
  }
  return value;
}

function untilOf(condition: EndCondition): ISODate | null {
  return condition.type === 'until' ? condition.until : null;
}

function assertNotDeleted(task: LongTask): void {
  if (task.deletedAt !== null) {
    throw new ValidationError('该长期任务已在回收站中，请先恢复到正常列表后再修改。');
  }
}

function assertExpectedUpdatedAt(task: LongTask, expectedUpdatedAt: string): void {
  if (task.updatedAt !== expectedUpdatedAt) {
    throw new ConflictError('该长期任务已被其他操作修改，请刷新后重试。');
  }
}

/**
 * 版本链必须「版本号从 1 连续 + 生效日严格递增」。
 * 链已损坏时拒绝继续追加，避免在坏数据上再叠一层坏数据。
 */
function assertVersionChain(versions: LongTaskRuleVersion[]): LongTaskRuleVersion[] {
  const sorted = [...versions].sort(
    (a, b) => compareIso(a.effectiveFrom, b.effectiveFrom) || a.versionNo - b.versionNo,
  );
  sorted.forEach((version, index) => {
    if (version.versionNo !== index + 1) {
      raiseIssues([
        {
          code: 'CHAIN',
          message: '规则版本链已损坏（版本号必须从 1 开始连续），请先修复数据再追加。',
        },
      ]);
    }
    if (index > 0) {
      const previous = sorted[index - 1]!;
      if (compareIso(previous.effectiveFrom, version.effectiveFrom) >= 0) {
        raiseIssues([
          {
            code: 'CHAIN',
            message: '规则版本链已损坏（生效日必须严格递增），请先修复数据再追加。',
          },
        ]);
      }
    }
  });
  return sorted;
}

/**
 * 聚合已损坏时阻止写入：先导出备份、修复数据，再继续。
 * 删除/恢复类操作不经过这里，保证用户永远能把坏数据移走。
 */
function assertAggregateHealthy(
  task: LongTask,
  versions: LongTaskRuleVersion[],
  exceptions: LongTaskException[],
  today: ISODate,
): void {
  const issues = aggregateIssues({ task, versions, exceptions, today });
  if (issues.length > 0) {
    throw new ValidationError(
      `该长期任务的数据存在一致性问题：${issues[0]!.message} 已阻止写入，请先导出备份并修复数据。`,
    );
  }
}

function isConstraintError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const candidate = error as { name?: string; inner?: { name?: string } };
  return candidate.name === 'ConstraintError' || candidate.inner?.name === 'ConstraintError';
}

/**
 * 事务中止后的冲突诊断：新开只读事务，确认是哪条唯一索引挡住了写入。
 * 无法确认时抛出统一 ConflictError，绝不吞掉原始异常。
 */
async function diagnoseVersionConflict(
  taskId: Id,
  effectiveFrom: ISODate,
  database: WorkbenchDatabase,
): Promise<never> {
  const clash = await database.transaction('r', database.longTaskRuleVersions, async () =>
    database.longTaskRuleVersions
      .where('[taskId+effectiveFrom]')
      .equals([taskId, effectiveFrom])
      .first(),
  );
  throw new ConflictError(
    clash
      ? `生效日 ${effectiveFrom} 已被其他窗口写入规则版本，请刷新后重试。`
      : '规则版本写入冲突，请刷新后重试。',
  );
}

async function diagnoseExceptionConflict(
  taskId: Id,
  occurrenceDate: ISODate,
  database: WorkbenchDatabase,
): Promise<never> {
  const clash = await database.transaction('r', database.longTaskExceptions, async () =>
    database.longTaskExceptions
      .where('[taskId+occurrenceDate]')
      .equals([taskId, occurrenceDate])
      .last(),
  );
  throw new ConflictError(
    clash
      ? `${occurrenceDate} 的例外记录已被其他窗口写入，请刷新后重试。`
      : '例外记录写入冲突，请刷新后重试。',
  );
}

/** 创建长期任务：主记录 + 首版规则 + 创建事件在同一事务内写入。 */
export async function createLongTask(
  input: LongTaskCreateInput,
  context: CreateContext = {},
  database: WorkbenchDatabase = db,
): Promise<LongTaskAggregate> {
  const now = context.now ?? nowISOString();
  const today = context.today ?? todayISO();
  const title = requireTitle(input.title);
  const startDate = input.startDate;
  if (!isRealIsoDate(startDate)) {
    throw new ValidationError('首次计划日不是真实存在的日期。');
  }
  const endDate = input.endDate ?? null;
  const endCondition: EndCondition = input.endCondition ?? { type: 'never' };
  const existingOrders = await database.longTasks.toArray();
  const sortOrder =
    existingOrders.reduce((max, item) => Math.max(max, item.sortOrder ?? 0), -1) + 1;

  const task: LongTask = {
    id: createId('ltd'),
    title,
    description: input.description ?? '',
    note: input.note ?? '',
    priority: input.priority ?? 'medium',
    startDate,
    endDate,
    endCondition,
    tags: [...(input.tags ?? [])],
    events: [{ id: createId('lte'), type: 'created', date: startDate, note: null, createdAt: now }],
    deletedAt: null,
    archivedAt: null,
    sortOrder,
    createdAt: now,
    updatedAt: now,
  };

  const version: LongTaskRuleVersion = {
    id: createId('ltv'),
    taskId: task.id,
    versionNo: 1,
    effectiveFrom: startDate,
    spec: input.spec,
    changeNote: input.changeNote ?? null,
    createdAt: now,
  };

  // 完整领域校验：主记录（含结束条件、事件）+ 首版规则。
  // 首版允许「首次计划日已过去」（补录既有系列），因此历史保护的基准取 min(today, startDate)。
  const issues = [
    ...validateLongTask({ task, versions: [version], today }),
    ...validateRuleVersion({
      versions: [],
      effectiveFrom: startDate,
      spec: input.spec,
      today: compareIso(startDate, today) < 0 ? startDate : today,
      startDate,
    }),
  ];
  if (issues.length > 0) {
    raiseIssues(issues);
  }

  try {
    await database.transaction(
      'rw',
      [database.longTasks, database.longTaskRuleVersions],
      async () => {
        await database.longTasks.add(task);
        await database.longTaskRuleVersions.add(version);
      },
    );
  } catch (error) {
    if (isConstraintError(error)) {
      throw new ConflictError('创建冲突：该长期任务已存在，请重试。');
    }
    throw error;
  }

  return { task, versions: [version], exceptions: [], issues: [] };
}

/** 修改基本信息：只允许运行时白名单字段。 */
export async function updateLongTaskInfo(
  id: Id,
  patch: LongTaskInfoPatch,
  context: WriteContext,
  database: WorkbenchDatabase = db,
): Promise<LongTask> {
  const now = context.now ?? nowISOString();
  const unknown = Object.keys(patch).filter((key) => !INFO_FIELDS.has(key));
  if (unknown.length > 0) {
    throw new ValidationError(`不能在基本信息中修改这些字段：${unknown.join('、')}。`);
  }

  return database.transaction(
    'rw',
    [database.longTasks, database.longTaskRuleVersions, database.longTaskExceptions],
    async () => {
      const task = await database.longTasks.get(id);
      if (!task) {
        throw new NotFoundError('长期任务');
      }
      assertNotDeleted(task);
      assertExpectedUpdatedAt(task, context.expectedUpdatedAt);

      const versions = await database.longTaskRuleVersions.where('taskId').equals(id).toArray();
      const exceptions = await database.longTaskExceptions.where('taskId').equals(id).toArray();
      assertAggregateHealthy(task, versions, exceptions, context.today ?? todayISO());

      const next: LongTask = {
        ...task,
        ...(patch.title !== undefined ? { title: requireTitle(patch.title) } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.note !== undefined ? { note: patch.note } : {}),
        ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
        ...(patch.tags !== undefined ? { tags: [...patch.tags] } : {}),
        updatedAt: nextUpdatedAt(task.updatedAt, now),
      };
      await database.longTasks.put(next);
      return next;
    },
  );
}

/** 追加规则版本：版本号在事务内推算，已结束的任务必须走原子重开接口。 */
export async function appendLongTaskRuleVersion(
  id: Id,
  input: LongTaskRuleVersionInput,
  context: WriteContext,
  database: WorkbenchDatabase = db,
): Promise<{ task: LongTask; version: LongTaskRuleVersion }> {
  const now = context.now ?? nowISOString();
  const today = context.today ?? todayISO();

  try {
    return await database.transaction(
      'rw',
      [database.longTasks, database.longTaskRuleVersions, database.longTaskExceptions],
      async () => {
        const task = await database.longTasks.get(id);
        if (!task) {
          throw new NotFoundError('长期任务');
        }
        assertNotDeleted(task);
        assertExpectedUpdatedAt(task, context.expectedUpdatedAt);

        const versions = assertVersionChain(
          await database.longTaskRuleVersions.where('taskId').equals(id).toArray(),
        );
        const exceptions = await database.longTaskExceptions.where('taskId').equals(id).toArray();
        assertAggregateHealthy(task, versions, exceptions, today);
        if (deriveState(task, today) === 'ended') {
          raiseIssues([
            {
              code: 'R6',
              message:
                '长期任务已结束，不能直接追加规则版本；请使用「重新启用并设置新规则」同时写入重开事件与新版本。',
            },
          ]);
        }

        const issues = validateRuleVersion({
          versions,
          effectiveFrom: input.effectiveFrom,
          spec: input.spec,
          today,
          hardStop: hardStopOf(task),
          startDate: task.startDate,
        });
        if (issues.length > 0) {
          raiseIssues(issues);
        }

        const last = versions[versions.length - 1];
        const version: LongTaskRuleVersion = {
          id: createId('ltv'),
          taskId: id,
          versionNo: (last?.versionNo ?? 0) + 1,
          effectiveFrom: input.effectiveFrom,
          spec: input.spec,
          changeNote: input.changeNote ?? null,
          createdAt: now,
        };
        const next: LongTask = { ...task, updatedAt: nextUpdatedAt(task.updatedAt, now) };

        await database.longTaskRuleVersions.add(version);
        await database.longTasks.put(next);
        return { task: next, version };
      },
    );
  } catch (error) {
    if (isConstraintError(error)) {
      await diagnoseVersionConflict(id, input.effectiveFrom, database);
    }
    throw error;
  }
}

/** 规则覆盖：直接改写「当前生效版本」的规则，立即生效（不新增版本）。 */
export interface LongTaskRuleReplaceInput {
  spec: RecurrenceSpec;
  changeNote?: string | null;
}

export async function replaceLongTaskRuleVersion(
  id: Id,
  input: LongTaskRuleReplaceInput,
  context: WriteContext,
  database: WorkbenchDatabase = db,
): Promise<{ task: LongTask; version: LongTaskRuleVersion }> {
  const now = context.now ?? nowISOString();
  const today = context.today ?? todayISO();

  return database.transaction(
    'rw',
    [database.longTasks, database.longTaskRuleVersions, database.longTaskExceptions],
    async () => {
      const task = await database.longTasks.get(id);
      if (!task) {
        throw new NotFoundError('长期任务');
      }
      assertNotDeleted(task);
      assertExpectedUpdatedAt(task, context.expectedUpdatedAt);

      const versions = assertVersionChain(
        await database.longTaskRuleVersions.where('taskId').equals(id).toArray(),
      );
      const exceptions = await database.longTaskExceptions.where('taskId').equals(id).toArray();
      assertAggregateHealthy(task, versions, exceptions, today);

      if (deriveState(task, today) === 'ended') {
        raiseIssues([{ code: 'R7', message: '长期任务已结束，请先重新启用再调整规则。' }]);
      }

      const specIssue = describeSpecIssue(input.spec);
      if (specIssue) {
        raiseIssues([{ code: 'R0', message: specIssue }]);
      }

      const active = activeVersionOf(versions, today);
      if (!active) {
        raiseIssues([{ code: 'R8', message: '没有可覆盖的规则版本。' }]);
      }

      const version: LongTaskRuleVersion = {
        ...active,
        spec: input.spec,
        changeNote: input.changeNote ?? active.changeNote,
      };
      const next: LongTask = { ...task, updatedAt: nextUpdatedAt(task.updatedAt, now) };

      await database.longTaskRuleVersions.put(version);
      await database.longTasks.put(next);
      return { task: next, version };
    },
  );
}

export type LongTaskMoveDirection = 'up' | 'down';

/** 手动调整上下顺序：按当前顺序交换相邻两条，并把序号归一化为 0..n-1。 */
export async function moveLongTaskOrder(
  id: Id,
  direction: LongTaskMoveDirection,
  context: WriteContext,
  database: WorkbenchDatabase = db,
): Promise<LongTask[]> {
  const now = context.now ?? nowISOString();

  return database.transaction('rw', database.longTasks, async () => {
    const task = await database.longTasks.get(id);
    if (!task) {
      throw new NotFoundError('长期任务');
    }
    assertNotDeleted(task);
    assertExpectedUpdatedAt(task, context.expectedUpdatedAt);

    const all = (await database.longTasks.toArray()).filter((item) => item.deletedAt === null);
    all.sort(
      (a, b) =>
        (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
        compareIsoText(b.updatedAt, a.updatedAt) ||
        compareId(a.id, b.id),
    );

    const index = all.findIndex((item) => item.id === id);
    const target = direction === 'up' ? index - 1 : index + 1;
    if (index < 0 || target < 0 || target >= all.length) {
      return all;
    }

    const moved = all[index];
    all[index] = all[target] as LongTask;
    all[target] = moved as LongTask;

    const updated: LongTask[] = all.map((item, position) => ({ ...item, sortOrder: position }));
    updated[index] = {
      ...(updated[index] as LongTask),
      updatedAt: nextUpdatedAt((moved as LongTask).updatedAt, now),
    };
    await database.longTasks.bulkPut(updated);
    return updated;
  });
}

/** 追加单次例外：revision / previousRevisionId / baseOccurrence / before / after 全部仓储内算。 */
export async function appendLongTaskException(
  id: Id,
  input: LongTaskExceptionInput,
  context: WriteContext,
  database: WorkbenchDatabase = db,
): Promise<{ task: LongTask; exception: LongTaskException }> {
  const now = context.now ?? nowISOString();
  const today = context.today ?? todayISO();

  try {
    return await database.transaction(
      'rw',
      [database.longTasks, database.longTaskRuleVersions, database.longTaskExceptions],
      async () => {
        const task = await database.longTasks.get(id);
        if (!task) {
          throw new NotFoundError('长期任务');
        }
        assertNotDeleted(task);
        assertExpectedUpdatedAt(task, context.expectedUpdatedAt);

        const versions = assertVersionChain(
          await database.longTaskRuleVersions.where('taskId').equals(id).toArray(),
        );
        const exceptions = await database.longTaskExceptions.where('taskId').equals(id).toArray();
        assertAggregateHealthy(task, versions, exceptions, today);
        const chain = exceptions
          .filter((item) => item.occurrenceDate === input.occurrenceDate)
          .sort((a, b) => a.revision - b.revision);
        const latest = chain[chain.length - 1] ?? null;
        const revision = (latest?.revision ?? 0) + 1;
        const previousRevisionId = latest?.id ?? null;
        const before: ExceptionState = latest?.after ?? { mode: 'rule' };
        const after: ExceptionState =
          input.state.mode === 'skip'
            ? { mode: 'skip' }
            : { mode: 'override', patch: { ...input.state.patch } };

        const issues = validateExceptionWrite({
          task,
          versions,
          exceptions,
          occurrenceDate: input.occurrenceDate,
          changeKind: input.changeKind,
          after,
          reason: input.reason ?? null,
          today,
          revision,
          previousRevisionId,
        });
        if (issues.length > 0) {
          raiseIssues(issues);
        }

        // 槽位取「原始规则」：剔除这一天的全部例外后再展开，override 不会改变身份。
        const slot = slotOn(
          {
            task,
            versions,
            exceptions: exceptions.filter((item) => item.occurrenceDate !== input.occurrenceDate),
            dateUpper: input.occurrenceDate,
          },
          input.occurrenceDate,
        );
        if (!slot) {
          raiseIssues([
            { code: 'E3', message: `${input.occurrenceDate} 不是这个长期任务的执行日。` },
          ]);
        }

        const exception: LongTaskException = {
          id: createId('ltx'),
          taskId: id,
          occurrenceDate: input.occurrenceDate,
          revision,
          previousRevisionId,
          changeKind: input.changeKind,
          baseOccurrence: slot.base,
          before,
          after,
          reason: input.reason ?? null,
          createdAt: now,
        };
        const next: LongTask = { ...task, updatedAt: nextUpdatedAt(task.updatedAt, now) };

        await database.longTaskExceptions.add(exception);
        await database.longTasks.put(next);
        return { task: next, exception };
      },
    );
  } catch (error) {
    if (isConstraintError(error)) {
      await diagnoseExceptionConflict(id, input.occurrenceDate, database);
    }
    throw error;
  }
}

/** 撤销例外：追加一条 revocation，把该日恢复为原始规则安排。 */
export async function revokeLongTaskException(
  id: Id,
  input: LongTaskExceptionRevokeInput,
  context: WriteContext,
  database: WorkbenchDatabase = db,
): Promise<{ task: LongTask; exception: LongTaskException }> {
  const now = context.now ?? nowISOString();
  const today = context.today ?? todayISO();

  try {
    return await database.transaction(
      'rw',
      [database.longTasks, database.longTaskRuleVersions, database.longTaskExceptions],
      async () => {
        const task = await database.longTasks.get(id);
        if (!task) {
          throw new NotFoundError('长期任务');
        }
        assertNotDeleted(task);
        assertExpectedUpdatedAt(task, context.expectedUpdatedAt);

        const versions = assertVersionChain(
          await database.longTaskRuleVersions.where('taskId').equals(id).toArray(),
        );
        const exceptions = await database.longTaskExceptions.where('taskId').equals(id).toArray();
        assertAggregateHealthy(task, versions, exceptions, today);
        const chain = exceptions
          .filter((item) => item.occurrenceDate === input.occurrenceDate)
          .sort((a, b) => a.revision - b.revision);
        const latest = chain[chain.length - 1];
        if (!latest) {
          raiseIssues([{ code: 'E10', message: '该日期没有可撤销的例外记录。' }]);
        }
        if (latest.after.mode === 'rule') {
          throw new ConflictError('该日期已恢复原始规则安排，无需再次撤销。');
        }

        const revision = latest.revision + 1;
        const previousRevisionId = latest.id;
        const before = latest.after;
        const after: ExceptionState = { mode: 'rule' };

        const issues = validateExceptionWrite({
          task,
          versions,
          exceptions,
          occurrenceDate: input.occurrenceDate,
          changeKind: 'revocation',
          after,
          reason: input.reason,
          today,
          revision,
          previousRevisionId,
        });
        if (issues.length > 0) {
          raiseIssues(issues);
        }

        const exception: LongTaskException = {
          id: createId('ltx'),
          taskId: id,
          occurrenceDate: input.occurrenceDate,
          revision,
          previousRevisionId,
          changeKind: 'revocation',
          baseOccurrence: latest.baseOccurrence,
          before,
          after,
          reason: input.reason,
          createdAt: now,
        };
        const next: LongTask = { ...task, updatedAt: nextUpdatedAt(task.updatedAt, now) };

        await database.longTaskExceptions.add(exception);
        await database.longTasks.put(next);
        return { task: next, exception };
      },
    );
  } catch (error) {
    if (isConstraintError(error)) {
      await diagnoseExceptionConflict(id, input.occurrenceDate, database);
    }
    throw error;
  }
}

/** 追加生命周期事件：created 只能由创建接口写，reopened 只能由重开接口写。 */
export async function appendLongTaskLifecycleEvent(
  id: Id,
  input: LongTaskLifecycleInput,
  context: WriteContext,
  database: WorkbenchDatabase = db,
): Promise<LongTask> {
  const now = context.now ?? nowISOString();
  const today = context.today ?? todayISO();

  return database.transaction(
    'rw',
    [database.longTasks, database.longTaskRuleVersions, database.longTaskExceptions],
    async () => {
      const task = await database.longTasks.get(id);
      if (!task) {
        throw new NotFoundError('长期任务');
      }
      assertNotDeleted(task);
      assertExpectedUpdatedAt(task, context.expectedUpdatedAt);

      const versions = await database.longTaskRuleVersions.where('taskId').equals(id).toArray();
      const exceptions = await database.longTaskExceptions.where('taskId').equals(id).toArray();
      assertAggregateHealthy(task, versions, exceptions, today);

      const gate =
        input.type === 'paused'
          ? canPauseOn(input.date, task, today)
          : input.type === 'resumed'
            ? canResumeOn(input.date, task, today)
            : canEndOn(input.date, task, today);
      if (!gate.ok) {
        raiseIssues([{ code: 'L', message: gate.reason ?? '状态变更日期不合法。' }]);
      }

      const event: LifecycleEvent = {
        id: createId('lte'),
        type: input.type,
        date: input.date,
        note: input.note ?? null,
        createdAt: now,
      };
      const events = [...task.events, event];
      const issues = validateLifecycleUpdate(task.events, events, {
        startDate: task.startDate,
        today,
      });
      if (issues.length > 0) {
        raiseIssues(issues);
      }

      const next: LongTask = { ...task, events, updatedAt: nextUpdatedAt(task.updatedAt, now) };
      await database.longTasks.put(next);
      return next;
    },
  );
}

/**
 * 重新启用 + 新规则版本：两者必须同一事务提交，绝不允许拆成两次调用。
 * effectiveFrom 默认等于重开日；更晚时中间段按 DECISION-1 沿用上一版。
 */
export async function reopenLongTaskWithRuleVersion(
  id: Id,
  input: LongTaskReopenInput,
  context: WriteContext,
  database: WorkbenchDatabase = db,
): Promise<{ task: LongTask; version: LongTaskRuleVersion }> {
  const now = context.now ?? nowISOString();
  const today = context.today ?? todayISO();
  const effectiveFrom = input.effectiveFrom ?? input.date;

  try {
    return await database.transaction(
      'rw',
      [database.longTasks, database.longTaskRuleVersions, database.longTaskExceptions],
      async () => {
        const task = await database.longTasks.get(id);
        if (!task) {
          throw new NotFoundError('长期任务');
        }
        assertNotDeleted(task);
        assertExpectedUpdatedAt(task, context.expectedUpdatedAt);

        const gate = canReopenOn(input.date, task, today);
        if (!gate.ok) {
          raiseIssues([{ code: 'L', message: gate.reason ?? '重新启用的日期不合法。' }]);
        }
        if (compareIso(effectiveFrom, input.date) < 0) {
          throw new ValidationError(
            `新规则的生效日（${effectiveFrom}）不能早于重新启用日（${input.date}）。`,
          );
        }

        const versions = assertVersionChain(
          await database.longTaskRuleVersions.where('taskId').equals(id).toArray(),
        );
        const exceptions = await database.longTaskExceptions.where('taskId').equals(id).toArray();
        assertAggregateHealthy(task, versions, exceptions, today);
        // 重开时 hardStop 必须排除 ended，否则 R3 会把重开日永远判成「晚于结束日」。
        const baseHardStop = minIso(task.endDate, untilOf(task.endCondition));
        const issues = validateRuleVersion({
          versions,
          effectiveFrom,
          spec: input.spec,
          today,
          hardStop: baseHardStop,
          startDate: task.startDate,
        });
        if (issues.length > 0) {
          raiseIssues(issues);
        }

        const last = versions[versions.length - 1];
        const version: LongTaskRuleVersion = {
          id: createId('ltv'),
          taskId: id,
          versionNo: (last?.versionNo ?? 0) + 1,
          effectiveFrom,
          spec: input.spec,
          changeNote: input.changeNote ?? null,
          createdAt: now,
        };
        const reopened: LifecycleEvent = {
          id: createId('lte'),
          type: 'reopened',
          date: input.date,
          note: null,
          createdAt: now,
        };
        const events = [...task.events, reopened];
        const lifecycleIssues = validateLifecycleUpdate(task.events, events, {
          startDate: task.startDate,
          today,
        });
        if (lifecycleIssues.length > 0) {
          raiseIssues(lifecycleIssues);
        }

        const next: LongTask = { ...task, events, updatedAt: nextUpdatedAt(task.updatedAt, now) };

        await database.longTaskRuleVersions.add(version);
        await database.longTasks.put(next);
        return { task: next, version };
      },
    );
  } catch (error) {
    if (isConstraintError(error)) {
      await diagnoseVersionConflict(id, effectiveFrom, database);
    }
    throw error;
  }
}

/** 归档 / 取消归档：幂等，重复操作不写库、不推进 updatedAt。 */
export async function setLongTaskArchived(
  id: Id,
  archived: boolean,
  context: WriteContext,
  database: WorkbenchDatabase = db,
): Promise<LongTask> {
  const now = context.now ?? nowISOString();

  return database.transaction('rw', database.longTasks, async () => {
    const task = await database.longTasks.get(id);
    if (!task) {
      throw new NotFoundError('长期任务');
    }
    assertNotDeleted(task);
    assertExpectedUpdatedAt(task, context.expectedUpdatedAt);

    if (archived ? task.archivedAt !== null : task.archivedAt === null) {
      return task;
    }
    const next: LongTask = {
      ...task,
      archivedAt: archived ? now : null,
      updatedAt: nextUpdatedAt(task.updatedAt, now),
    };
    await database.longTasks.put(next);
    return next;
  });
}

/** 软删除：只设置 deletedAt，不动计划、日志与归档标记。 */
export async function softDeleteLongTask(
  id: Id,
  context: WriteContext,
  database: WorkbenchDatabase = db,
): Promise<LongTask> {
  const now = context.now ?? nowISOString();

  return database.transaction('rw', database.longTasks, async () => {
    const task = await database.longTasks.get(id);
    if (!task) {
      throw new NotFoundError('长期任务');
    }
    assertExpectedUpdatedAt(task, context.expectedUpdatedAt);
    if (task.deletedAt !== null) {
      return task;
    }
    const next: LongTask = {
      ...task,
      deletedAt: now,
      updatedAt: nextUpdatedAt(task.updatedAt, now),
    };
    await database.longTasks.put(next);
    return next;
  });
}

/** 从回收站恢复：只清 deletedAt，保留 archivedAt，也不自动重开已结束任务。 */
export async function restoreLongTask(
  id: Id,
  context: WriteContext,
  database: WorkbenchDatabase = db,
): Promise<LongTask> {
  const now = context.now ?? nowISOString();

  return database.transaction('rw', database.longTasks, async () => {
    const task = await database.longTasks.get(id);
    if (!task) {
      throw new NotFoundError('长期任务');
    }
    assertExpectedUpdatedAt(task, context.expectedUpdatedAt);
    if (task.deletedAt === null) {
      return task;
    }
    const next: LongTask = {
      ...task,
      deletedAt: null,
      updatedAt: nextUpdatedAt(task.updatedAt, now),
    };
    await database.longTasks.put(next);
    return next;
  });
}

/**
 * 彻底删除聚合：一个事务内删除主记录、全部规则版本与全部例外，
 * 并在删除后重新计数确认没有残留，否则整体回滚。
 */
export async function purgeLongTask(
  id: Id,
  context: WriteContext,
  database: WorkbenchDatabase = db,
): Promise<{ task: number; versions: number; exceptions: number }> {
  return database.transaction(
    'rw',
    [database.longTasks, database.longTaskRuleVersions, database.longTaskExceptions],
    async () => {
      const task = await database.longTasks.get(id);
      if (!task) {
        throw new NotFoundError('长期任务');
      }
      assertExpectedUpdatedAt(task, context.expectedUpdatedAt);

      const versions = await database.longTaskRuleVersions.where('taskId').equals(id).count();
      const exceptions = await database.longTaskExceptions.where('taskId').equals(id).count();

      await database.longTaskRuleVersions.where('taskId').equals(id).delete();
      await database.longTaskExceptions.where('taskId').equals(id).delete();
      await database.longTasks.delete(id);

      const remainingVersions = await database.longTaskRuleVersions
        .where('taskId')
        .equals(id)
        .count();
      const remainingExceptions = await database.longTaskExceptions
        .where('taskId')
        .equals(id)
        .count();
      if (remainingVersions !== 0 || remainingExceptions !== 0) {
        throw new Error('彻底删除后仍有残留记录，事务已中止。');
      }
      return { task: 1, versions, exceptions };
    },
  );
}
