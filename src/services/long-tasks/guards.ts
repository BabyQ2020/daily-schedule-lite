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
import type { ISODate } from '@/lib/period';
import { isRealIsoDate } from '@/lib/iso-date';

import { compareIso, deriveState, describeSpecIssue, slotOn, transitionsOf } from './schedule';

/** 统一的问题结构：界面直接展示 message。 */
export interface ScheduleIssue {
  code: string;
  message: string;
}

export interface DateGate {
  ok: boolean;
  reason?: string;
}

const OK: DateGate = { ok: true };
const fail = (reason: string): DateGate => ({ ok: false, reason });

function createdEventOf(events: LifecycleEvent[]): LifecycleEvent | null {
  return events.find((event) => event.type === 'created') ?? null;
}

function lastTransition(events: LifecycleEvent[]): LifecycleEvent | null {
  const transitions = transitionsOf(events);
  return transitions[transitions.length - 1] ?? null;
}

/* ------------------------------------------------------------------ *
 * 生命周期校验
 * L0 唯一 created 且 date === startDate
 * L1 transitions 严格递增、同日不允许两条
 * L2 首个 transition.date >= created.date
 * L3 写入时 transition.date >= today（历史保护）
 * L4 暂停/恢复/结束/重开的顺序必须合法
 * ------------------------------------------------------------------ */

export interface ValidateLifecycleOptions {
  startDate: ISODate;
  today: ISODate;
  enforceHistory?: boolean;
}

export function validateLifecycle(
  events: LifecycleEvent[],
  { startDate, today, enforceHistory = true }: ValidateLifecycleOptions,
): ScheduleIssue[] {
  const issues: ScheduleIssue[] = [];
  const created = events.filter((event) => event.type === 'created');
  if (created.length !== 1) {
    issues.push({ code: 'L0', message: '创建事件必须且只能有一条。' });
  }
  for (const event of created) {
    if (event.date !== startDate) {
      issues.push({ code: 'L0', message: '创建事件的日期必须等于首次计划日。' });
    }
  }

  const transitions = transitionsOf(events);
  let previous: LifecycleEvent | null = null;
  for (const event of transitions) {
    if (previous) {
      const order = compareIso(previous.date, event.date);
      if (order === 0) {
        issues.push({ code: 'L1', message: `同一日期（${event.date}）只能有一次状态转换。` });
      } else if (order > 0) {
        issues.push({ code: 'L1', message: '状态转换必须按日期从早到晚排列。' });
      }
    }
    previous = event;
  }

  const first = transitions[0] ?? null;
  const createdEvent = created[0] ?? null;
  if (first && createdEvent && compareIso(first.date, createdEvent.date) < 0) {
    issues.push({ code: 'L2', message: '状态转换不能早于创建日。' });
  }

  if (enforceHistory) {
    for (const event of transitions) {
      if (compareIso(event.date, today) < 0) {
        issues.push({
          code: 'L3',
          message: `状态变更只能从今天（${today}）或更晚生效，不能倒填到 ${event.date}。`,
        });
      }
    }
  }

  let state: 'active' | 'paused' | 'ended' = 'active';
  for (const event of transitions) {
    if (event.type === 'paused') {
      if (state !== 'active') {
        issues.push({ code: 'L4', message: '只有进行中的长期任务才能暂停。' });
      }
      state = 'paused';
      continue;
    }
    if (event.type === 'resumed') {
      if (state !== 'paused') {
        issues.push({ code: 'L4', message: '只有暂停中的长期任务才能恢复。' });
      }
      state = 'active';
      continue;
    }
    if (event.type === 'ended') {
      if (state === 'ended') {
        issues.push({ code: 'L4', message: '长期任务已经结束，不能重复结束。' });
      }
      state = 'ended';
      continue;
    }
    if (event.type === 'reopened') {
      if (state !== 'ended') {
        issues.push({ code: 'L4', message: '只有已结束的长期任务才能重新启用。' });
      }
      state = 'active';
    }
  }

  return issues;
}

/* ------------------------------------------------------------------ *
 * 规则版本校验
 * ------------------------------------------------------------------ */

export interface ValidateRuleVersionOptions {
  versions: LongTaskRuleVersion[];
  effectiveFrom: ISODate;
  spec: RecurrenceSpec;
  today: ISODate;
  hardStop?: ISODate | null;
  /** 首次计划日（用于校验生效日不得早于系列起点）。 */
  startDate?: ISODate;
}

export function validateRuleVersion({
  versions,
  effectiveFrom,
  spec,
  today,
  hardStop = null,
  startDate,
}: ValidateRuleVersionOptions): ScheduleIssue[] {
  const issues: ScheduleIssue[] = [];
  const specIssue = describeSpecIssue(spec);
  if (specIssue) issues.push({ code: 'R0', message: specIssue });

  if (!isRealIsoDate(effectiveFrom)) {
    issues.push({ code: 'R4', message: '规则生效日不是真实存在的日期。' });
  }

  if (startDate && isRealIsoDate(effectiveFrom) && compareIso(effectiveFrom, startDate) < 0) {
    issues.push({
      code: 'R5',
      message: `规则生效日不能早于首次计划日（${startDate}）。`,
    });
  }

  if (compareIso(effectiveFrom, today) < 0) {
    issues.push({
      code: 'R1',
      message: `规则只能从今天（${today}）或更晚生效，不能修改已经过去的安排。历史调整请用「仅修改本次」。`,
    });
  }

  const latest = versions.reduce<LongTaskRuleVersion | null>((acc, version) => {
    if (!acc) return version;
    return compareIso(version.effectiveFrom, acc.effectiveFrom) > 0 ? version : acc;
  }, null);

  if (latest && compareIso(effectiveFrom, latest.effectiveFrom) <= 0) {
    issues.push({
      code: 'R2',
      message: `新规则的生效日必须晚于上一次调整（上一次：${latest.effectiveFrom}）。同一天只能有一个规则版本。`,
    });
  }

  if (hardStop && compareIso(effectiveFrom, hardStop) > 0) {
    issues.push({ code: 'R3', message: `规则生效日不能晚于结束日（${hardStop}）。` });
  }

  return issues;
}

/* ------------------------------------------------------------------ *
 * 全入口日期守卫：UI 的 disabledDate 与仓储 assert 共用同一套函数。
 * ------------------------------------------------------------------ */

export function canChangeRuleOn(
  date: ISODate,
  {
    versions,
    today,
    hardStop = null,
  }: { versions: LongTaskRuleVersion[]; today: ISODate; hardStop?: ISODate | null },
): DateGate {
  if (compareIso(date, today) < 0) return fail(`规则只能从今天（${today}）起调整。`);
  const latest = versions.reduce<ISODate | null>(
    (acc, version) =>
      acc === null || compareIso(version.effectiveFrom, acc) > 0 ? version.effectiveFrom : acc,
    null,
  );
  if (latest && compareIso(date, latest) <= 0) {
    return fail(`生效日必须晚于上一次调整（${latest}），同一天只能有一个规则版本。`);
  }
  if (hardStop && compareIso(date, hardStop) > 0)
    return fail(`生效日不能晚于结束日（${hardStop}）。`);
  return OK;
}

export function canPauseOn(date: ISODate, task: LongTask, today: ISODate): DateGate {
  if (compareIso(date, today) < 0) return fail(`暂停只能从今天（${today}）或更晚生效。`);
  if (deriveState(task, today) !== 'active') return fail('只有进行中的长期任务才能暂停。');
  const last = lastTransition(task.events);
  const created = createdEventOf(task.events);
  if (
    last ? compareIso(date, last.date) <= 0 : created ? compareIso(date, created.date) < 0 : false
  ) {
    return fail(`暂停日期必须晚于最近一次状态变更（${last?.date ?? created?.date ?? '创建日'}）。`);
  }
  return OK;
}

export function canResumeOn(date: ISODate, task: LongTask, today: ISODate): DateGate {
  if (compareIso(date, today) < 0) return fail(`恢复只能从今天（${today}）或更晚生效。`);
  if (deriveState(task, today) !== 'paused') return fail('只有暂停中的长期任务才能恢复。');
  const lastPause = [...transitionsOf(task.events)]
    .reverse()
    .find((event) => event.type === 'paused');
  if (lastPause && compareIso(date, lastPause.date) <= 0) {
    return fail(`恢复日期必须晚于暂停日期（${lastPause.date}）。`);
  }
  return OK;
}

export function canEndOn(date: ISODate, task: LongTask, today: ISODate): DateGate {
  if (compareIso(date, today) < 0) return fail(`结束只能从今天（${today}）或更晚生效。`);
  if (deriveState(task, today) === 'ended') return fail('长期任务已经结束。');
  const last = lastTransition(task.events);
  if (last && compareIso(date, last.date) <= 0) {
    return fail(`结束日期必须晚于最近一次状态变更（${last.date}）。`);
  }
  return OK;
}

export function canReopenOn(date: ISODate, task: LongTask, today: ISODate): DateGate {
  if (compareIso(date, today) < 0) return fail(`重新启用只能从今天（${today}）或更晚生效。`);
  if (deriveState(task, today) !== 'ended') return fail('只有已结束的长期任务才能重新启用。');
  const ended = [...transitionsOf(task.events)].reverse().find((event) => event.type === 'ended');
  if (ended && compareIso(date, ended.date) <= 0) {
    return fail(`重新启用日期必须晚于结束日期（${ended.date}）。`);
  }
  return OK;
}

/**
 * 单次例外：今天及未来可直接写；过去日期必须走 correction 模式并给出原因。
 * 传入 task/versions 时，同时校验这一天确实是该任务的执行槽位。
 */
export function canExceptionOn(
  date: ISODate,
  {
    today,
    task,
    versions,
    exceptions = [],
  }: {
    today: ISODate;
    task?: LongTask;
    versions?: LongTaskRuleVersion[];
    exceptions?: LongTaskException[];
  },
): DateGate & { requiresCorrection: boolean } {
  const requiresCorrection = compareIso(date, today) < 0;
  if (!isRealIsoDate(date)) {
    return { ok: false, reason: '日期不是真实存在的日期。', requiresCorrection };
  }
  if (task && versions) {
    const slot = slotOn({ task, versions, exceptions, dateUpper: date }, date);
    if (!slot) {
      return {
        ok: false,
        reason: `${date} 不是这个长期任务的执行日，不能单独修改。`,
        requiresCorrection,
      };
    }
  }
  return { ok: true, requiresCorrection };
}

export function validateCorrection(reason: string | null): ScheduleIssue[] {
  if (!reason || reason.trim().length === 0) {
    return [{ code: 'E1', message: '修改过去的安排必须填写原因。' }];
  }
  return [];
}

/* ------------------------------------------------------------------ *
 * 生命周期增量校验（编辑任务时使用）
 *
 * - 既有事件必须原样保留（不可原地改日期/类型，也不可删除）；
 * - 只对「本次新增」的状态转换做历史保护（date >= today）；
 * - 整条链仍然做结构校验，不能靠增量校验绕过既有历史合法性。
 * ------------------------------------------------------------------ */

export function validateLifecycleUpdate(
  existing: LifecycleEvent[],
  next: LifecycleEvent[],
  { startDate, today }: { startDate: ISODate; today: ISODate },
): ScheduleIssue[] {
  const issues: ScheduleIssue[] = [];

  // 1) 结构完整性（历史日期先放过，下一步只对新事件做守卫）
  issues.push(...validateLifecycle(next, { startDate, today, enforceHistory: false }));

  // 2) 既有事件不可变
  for (const item of existing) {
    const kept = next.find((event) => event.id === item.id);
    if (!kept) {
      issues.push({
        code: 'L5',
        message: `已有的状态事件（${item.type} ${item.date}）不能删除。`,
      });
      continue;
    }
    if (kept.type !== item.type || kept.date !== item.date) {
      issues.push({
        code: 'L5',
        message: `已有的状态事件（${item.type} ${item.date}）不能修改；历史修正请通过 correction 记录完成。`,
      });
    }
  }

  // 3) 新增的状态转换必须从今天或更晚生效（created 不算状态转换）
  const existingIds = new Set(existing.map((event) => event.id));
  for (const event of next) {
    if (existingIds.has(event.id) || event.type === 'created') continue;
    if (compareIso(event.date, today) < 0) {
      issues.push({
        code: 'L3',
        message: `状态变更只能从今天（${today}）或更晚生效，不能倒填到 ${event.date}。`,
      });
    }
  }

  return issues;
}

/* ------------------------------------------------------------------ *
 * 聚合校验：写入仓储层前的最后一道关
 * ------------------------------------------------------------------ */

export interface LongTaskAggregateInput {
  task: Pick<LongTask, 'startDate' | 'endDate' | 'endCondition' | 'events'>;
  versions: LongTaskRuleVersion[];
  today: ISODate;
  /** 传入时一并校验例外修订链（重复 id、修订号断档、前序指向错误）。 */
  exceptions?: LongTaskException[];
}

export function validateEndCondition(condition: EndCondition, startDate: ISODate): ScheduleIssue[] {
  const issues: ScheduleIssue[] = [];
  if (condition.type === 'count') {
    if (!Number.isInteger(condition.count) || condition.count < 1) {
      issues.push({ code: 'A3', message: '执行次数必须是大于 0 的整数。' });
    }
    return issues;
  }
  if (condition.type === 'until') {
    if (!isRealIsoDate(condition.until)) {
      issues.push({ code: 'A6', message: '重复结束日不是真实存在的日期。' });
    } else if (compareIso(condition.until, startDate) < 0) {
      issues.push({ code: 'A4', message: '重复结束日不能早于首次计划日。' });
    }
  }
  return issues;
}

export function validateLongTask({
  task,
  versions,
  today,
  exceptions = [],
}: LongTaskAggregateInput): ScheduleIssue[] {
  const issues: ScheduleIssue[] = [];

  if (!isRealIsoDate(task.startDate)) {
    issues.push({ code: 'A1', message: '首次计划日不是真实存在的日期。' });
  }

  if (task.endDate !== null) {
    if (!isRealIsoDate(task.endDate)) {
      issues.push({ code: 'A6', message: '截止日不是真实存在的日期。' });
    } else if (isRealIsoDate(task.startDate) && compareIso(task.endDate, task.startDate) < 0) {
      issues.push({ code: 'A4', message: '截止日不能早于首次计划日。' });
    }
  }

  if (task.endDate !== null && task.endCondition.type === 'until') {
    issues.push({
      code: 'A2',
      message: '「截止日」与「重复结束日」只能设置其中一个。',
    });
  }

  issues.push(...validateEndCondition(task.endCondition, task.startDate));

  if (versions.length === 0) {
    issues.push({ code: 'A5', message: '长期任务至少需要一个重复规则版本。' });
  }

  const sorted = versions.slice().sort((a, b) => compareIso(a.effectiveFrom, b.effectiveFrom));
  for (let index = 0; index < sorted.length; index += 1) {
    const current = sorted[index];
    if (!current) continue;

    if (!isRealIsoDate(current.effectiveFrom)) {
      issues.push({ code: 'A6', message: '规则生效日不是真实存在的日期。' });
    } else if (
      isRealIsoDate(task.startDate) &&
      compareIso(current.effectiveFrom, task.startDate) < 0
    ) {
      issues.push({
        code: 'A7',
        message: `规则生效日（${current.effectiveFrom}）不能早于首次计划日（${task.startDate}）。`,
      });
    }

    const specIssue = describeSpecIssue(current.spec);
    if (specIssue) issues.push({ code: 'A10', message: specIssue });

    const previous = sorted[index - 1] ?? null;
    if (previous) {
      if (compareIso(previous.effectiveFrom, current.effectiveFrom) >= 0) {
        issues.push({
          code: 'A8',
          message: '规则版本必须严格递增：同一日期只能有一个版本。',
        });
      }
      if (current.versionNo <= previous.versionNo) {
        issues.push({ code: 'A9', message: '版本号必须随生效日一起递增。' });
      }
    }
  }

  issues.push(
    ...validateLifecycle(task.events, {
      startDate: task.startDate,
      today,
      enforceHistory: false,
    }),
  );

  issues.push(...validateExceptionChain(exceptions));

  return issues;
}

/* ------------------------------------------------------------------ *
 * 例外修订链校验
 * ------------------------------------------------------------------ */

export function validateExceptionChain(exceptions: LongTaskException[]): ScheduleIssue[] {
  const issues: ScheduleIssue[] = [];
  const seenIds = new Set<string>();
  const byDate = new Map<ISODate, LongTaskException[]>();

  for (const item of exceptions) {
    if (!isRealIsoDate(item.occurrenceDate)) {
      issues.push({ code: 'E4', message: '例外日期不是真实存在的日期。' });
    }
    if (seenIds.has(item.id)) {
      issues.push({ code: 'E5', message: `例外记录 id 重复：${item.id}。` });
    }
    seenIds.add(item.id);
    if (!Number.isInteger(item.revision) || item.revision < 1) {
      issues.push({ code: 'E6', message: '例外修订号必须是大于 0 的整数。' });
    }
    const list = byDate.get(item.occurrenceDate) ?? [];
    list.push(item);
    byDate.set(item.occurrenceDate, list);
  }

  for (const [date, list] of byDate) {
    const sorted = list.slice().sort((a, b) => a.revision - b.revision);
    let previous: LongTaskException | null = null;
    for (let index = 0; index < sorted.length; index += 1) {
      const item = sorted[index];
      if (!item) continue;
      if (item.revision !== index + 1) {
        issues.push({
          code: 'E7',
          message: `${date} 的例外修订号不连续（期望 ${index + 1}，实际 ${item.revision}）。`,
        });
      }
      const expectedPrevious = previous?.id ?? null;
      if (item.previousRevisionId !== expectedPrevious) {
        issues.push({
          code: 'E8',
          message: `${date} 的例外修订链断裂：第 ${item.revision} 条的前序记录不正确。`,
        });
      }
      previous = item;
    }
  }

  return issues;
}

/* ------------------------------------------------------------------ *
 * 例外写入校验：槽位真实性 + 修订链完整性 + correction 语义
 * ------------------------------------------------------------------ */

export interface ExceptionWriteInput {
  task: LongTask;
  versions: LongTaskRuleVersion[];
  exceptions: LongTaskException[];
  occurrenceDate: ISODate;
  changeKind: ExceptionChangeKind;
  after: ExceptionState;
  reason: string | null;
  today: ISODate;
  /** 本次要写入的修订号：首版必须 1，之后必须等于上一版 + 1。 */
  revision: number;
  /** 上一版记录的 id：首版必须 null，之后必须指向当前链尾。 */
  previousRevisionId: string | null;
}

export function validateExceptionWrite({
  task,
  versions,
  exceptions,
  occurrenceDate,
  changeKind,
  after,
  reason,
  today,
  revision,
  previousRevisionId,
}: ExceptionWriteInput): ScheduleIssue[] {
  const issues: ScheduleIssue[] = [];

  if (!isRealIsoDate(occurrenceDate)) {
    return [{ code: 'E4', message: '例外日期不是真实存在的日期。' }];
  }

  const chain = exceptions
    .filter((item) => item.occurrenceDate === occurrenceDate)
    .slice()
    .sort((a, b) => a.revision - b.revision);
  const latest = chain[chain.length - 1] ?? null;

  issues.push(...validateExceptionChain(chain));

  // 修订号与前序指针必须由调用方按链尾推算，守卫层再核一遍，
  // 防止 UI 或仓储直接传一个跳号/错指的记录把链写断。
  const expectedRevision = latest ? latest.revision + 1 : 1;
  if (!Number.isInteger(revision) || revision !== expectedRevision) {
    issues.push({
      code: 'E15',
      message: `本次修订号应为 ${expectedRevision}，实际是 ${revision}。`,
    });
  }
  const expectedPrevious = latest?.id ?? null;
  if (previousRevisionId !== expectedPrevious) {
    issues.push({
      code: 'E15',
      message: '修订链的前序记录必须指向当前最后一条记录。',
    });
  }

  // 槽位必须来自「原始规则」：先剔除这一天的例外再展开，避免 override 改变身份。
  const slot = slotOn(
    {
      task,
      versions,
      exceptions: exceptions.filter((item) => item.occurrenceDate !== occurrenceDate),
      dateUpper: occurrenceDate,
    },
    occurrenceDate,
  );
  if (!slot) {
    issues.push({
      code: 'E3',
      message: `${occurrenceDate} 不是这个长期任务的执行日（可能被暂停、结束、次数用尽或规则不匹配）。`,
    });
  }

  if (changeKind === 'initial' && latest) {
    issues.push({ code: 'E9', message: '该日期已有例外记录，请追加 correction 修订。' });
  }
  if (changeKind !== 'initial' && !latest) {
    issues.push({ code: 'E10', message: '该日期没有可修订的例外记录。' });
  }
  if (changeKind !== 'initial') {
    issues.push(...validateCorrection(reason));
  }
  if (changeKind === 'initial' && compareIso(occurrenceDate, today) < 0) {
    issues.push({
      code: 'E11',
      message: '修改过去的安排必须使用 correction 模式并填写原因。',
    });
  }
  if (changeKind === 'revocation' && after.mode !== 'rule') {
    issues.push({ code: 'E12', message: '撤销例外的结果必须是恢复原始规则安排。' });
  }
  if (changeKind !== 'revocation' && after.mode === 'rule') {
    issues.push({ code: 'E13', message: '只有撤销修订才能恢复原始规则安排。' });
  }
  if (after.mode === 'override' && Object.keys(after.patch).length === 0) {
    issues.push({ code: 'E14', message: '单次修改至少要改动一个字段。' });
  }
  if (
    after.mode === 'override' &&
    after.patch.dueDate !== undefined &&
    after.patch.dueDate !== null &&
    !isRealIsoDate(after.patch.dueDate)
  ) {
    issues.push({ code: 'E16', message: '单次截止日不是真实存在的日期。' });
  }

  return issues;
}

/* ------------------------------------------------------------------ *
 * 聚合一致性
 * ------------------------------------------------------------------ */

export interface AggregateIssue {
  code: string;
  message: string;
}

export interface AggregateCheckInput {
  task: LongTask;
  versions: LongTaskRuleVersion[];
  exceptions: LongTaskException[];
  today: ISODate;
}

/**
 * 聚合一致性检查：诊断与写入前校验共用同一套判定。
 * 「诊断说不健康、写入却放行」是最糟糕的组合，必须只有一个真相。
 */
export function aggregateIssues({
  task,
  versions,
  exceptions,
  today,
}: AggregateCheckInput): AggregateIssue[] {
  const issues: AggregateIssue[] = [
    ...validateLongTask({ task, versions, today }),
    ...validateExceptionChain(exceptions),
  ].map((issue) => ({ code: issue.code, message: issue.message }));

  // 版本号连续性：validateLongTask 只校验严格递增，断档要靠这里兜住。
  const ordered = [...versions].sort((left, right) => left.versionNo - right.versionNo);
  ordered.forEach((version, index) => {
    if (version.versionNo !== index + 1) {
      issues.push({
        code: 'A11',
        message: `规则版本号必须从 1 开始连续递增，发现 v${version.versionNo}。`,
      });
    }
  });

  return issues;
}
