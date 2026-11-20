import type {
  BaseOccurrence,
  EndCondition,
  ExceptionState,
  LifecycleEvent,
  LongTask,
  LongTaskException,
  LongTaskRuleVersion,
  MonthlyRecurrence,
  RecurrenceSpec,
} from '@/domain/long-task';
import type { ISODate } from '@/lib/period';

const DAY_MS = 86_400_000;

/* ------------------------------------------------------------------ *
 * 纯日期工具：全部按 UTC 计算，避免本地时区把 2026-11-01 挪成 10-31。
 * 输出始终是 YYYY-MM-DD 本地日历串，与本项目其余日期口径一致。
 * ------------------------------------------------------------------ */

export function isoToUtc(iso: ISODate): number {
  const [year, month, day] = iso.split('-').map(Number) as [number, number, number];
  return Date.UTC(year, month - 1, day);
}

export function utcToIso(ms: number): ISODate {
  const date = new Date(ms);
  const year = String(date.getUTCFullYear()).padStart(4, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}` as ISODate;
}

export function addDaysIso(iso: ISODate, days: number): ISODate {
  return utcToIso(isoToUtc(iso) + days * DAY_MS);
}

/** ISO 星期：周一 1 … 周日 7。 */
export function isoWeekday(iso: ISODate): number {
  const weekday = new Date(isoToUtc(iso)).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

/** month 为 1-12。 */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function compareIso(a: ISODate, b: ISODate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 取较早日期；null 视为「无此边界」。 */
export function minIso(a: ISODate | null, b: ISODate | null): ISODate | null {
  if (a === null) return b;
  if (b === null) return a;
  return compareIso(a, b) <= 0 ? a : b;
}

export function maxIso(a: ISODate, b: ISODate): ISODate {
  return compareIso(a, b) >= 0 ? a : b;
}

export function eachDate(from: ISODate, to: ISODate): ISODate[] {
  const dates: ISODate[] = [];
  const end = isoToUtc(to);
  for (let cursor = isoToUtc(from); cursor <= end; cursor += DAY_MS) {
    dates.push(utcToIso(cursor));
  }
  return dates;
}

/* ------------------------------------------------------------------ *
 * 月度规则：保留原始 day（1-31 / -1），生成时按当月天数收敛。
 * 31 在 30 天的月份 → 30；在 2 月 → 月末；30 在 2 月 → 月末；
 * 29 在平年 2 月 → 28；-1 恒为当月最后一天。收敛后去重排序。
 * ------------------------------------------------------------------ */

export function resolveMonthDays(spec: MonthlyRecurrence, year: number, month: number): number[] {
  const last = daysInMonth(year, month);
  const resolved = new Set<number>();
  for (const day of spec.monthDays) {
    if (day === -1) {
      resolved.add(last);
      continue;
    }
    resolved.add(Math.min(day, last));
  }
  return [...resolved].sort((a, b) => a - b);
}

function matchesSpec(spec: RecurrenceSpec, iso: ISODate): boolean {
  if (spec.kind === 'daily') return true;
  if (spec.kind === 'weekly') return spec.weekdays.includes(isoWeekday(iso));
  const [year, month, day] = iso.split('-').map(Number) as [number, number, number];
  return resolveMonthDays(spec, year, month).includes(day);
}

/** 规则说明是否可用（写入前校验，返回中文错误）。 */
export function describeSpecIssue(spec: RecurrenceSpec): string | null {
  if (spec.kind === 'daily') return null;
  if (spec.kind === 'weekly') {
    if (spec.weekdays.length === 0) return '每周重复至少要选一个星期。';
    const valid = spec.weekdays.every((d) => Number.isInteger(d) && d >= 1 && d <= 7);
    return valid ? null : '星期取值必须是 1（周一）到 7（周日）。';
  }
  if (spec.monthDays.length === 0) return '每月重复至少要选一个日期。';
  const valid = spec.monthDays.every(
    (d) => Number.isInteger(d) && (d === -1 || (d >= 1 && d <= 31)),
  );
  return valid ? null : '每月日期必须是 1 到 31，或 -1（每月最后一天）。';
}

/* ------------------------------------------------------------------ *
 * 生命周期 → 暂停区间（半开 [from, to)）
 * ------------------------------------------------------------------ */

export interface Suspension {
  from: ISODate;
  /** null 表示至今仍暂停。 */
  to: ISODate | null;
}

export function transitionsOf(events: LifecycleEvent[]): LifecycleEvent[] {
  return events
    .filter((event) => event.type !== 'created')
    .slice()
    .sort((a, b) => compareIso(a.date, b.date));
}

export function suspensionsOf(events: LifecycleEvent[]): Suspension[] {
  const result: Suspension[] = [];
  let openFrom: ISODate | null = null;

  for (const event of transitionsOf(events)) {
    if (event.type === 'paused') {
      if (openFrom === null) openFrom = event.date;
      continue;
    }
    if (event.type === 'resumed' || event.type === 'ended') {
      if (openFrom !== null) {
        result.push({ from: openFrom, to: event.date });
        openFrom = null;
      }
    }
  }

  if (openFrom !== null) result.push({ from: openFrom, to: null });
  return result;
}

export function isPausedOn(suspensions: Suspension[], date: ISODate): boolean {
  return suspensions.some(
    (item) =>
      compareIso(item.from, date) <= 0 && (item.to === null || compareIso(date, item.to) < 0),
  );
}

/** 由 events 推导「今天」的状态。 */
export function deriveState(task: LongTask, today: ISODate): 'active' | 'paused' | 'ended' {
  let state: 'active' | 'paused' | 'ended' = 'active';
  for (const event of transitionsOf(task.events)) {
    if (compareIso(event.date, today) > 0) break;
    if (event.type === 'paused') state = 'paused';
    if (event.type === 'resumed' || event.type === 'reopened') state = 'active';
    if (event.type === 'ended') state = 'ended';
  }
  return state;
}

/* ------------------------------------------------------------------ *
 * 结束边界
 * ------------------------------------------------------------------ */

/**
 * 当前生效的 ended 事件日期（第一天不再执行）。
 * 之后若出现 reopened，则结束边界失效（重新启用必须另起新版本）。
 */
export function endedOnOf(events: LifecycleEvent[]): ISODate | null {
  let ended: ISODate | null = null;
  for (const event of transitionsOf(events)) {
    if (event.type === 'ended') ended = event.date;
    if (event.type === 'reopened') ended = null;
  }
  return ended;
}

/**
 * ended → reopened 形成的「不执行区间」（半开 [ended, reopened)）；
 * 末尾没有 reopened 的 ended 记为 [ended, null)，表示到此为止。
 */
export function endedGapsOf(events: LifecycleEvent[]): Suspension[] {
  const gaps: Suspension[] = [];
  let openFrom: ISODate | null = null;
  for (const event of transitionsOf(events)) {
    if (event.type === 'ended') {
      if (openFrom === null) openFrom = event.date;
      continue;
    }
    if (event.type === 'reopened' && openFrom !== null) {
      gaps.push({ from: openFrom, to: event.date });
      openFrom = null;
    }
  }
  if (openFrom !== null) gaps.push({ from: openFrom, to: null });
  return gaps;
}

export function isEndedOn(gaps: Suspension[], date: ISODate): boolean {
  return gaps.some(
    (gap) => compareIso(gap.from, date) <= 0 && (gap.to === null || compareIso(date, gap.to) < 0),
  );
}

/**
 * 生成上界（含当日）。
 *
 * 三个边界的语义不同，不能混用：
 * - `endDate`：系列结束日，**包含当天**；
 * - `endCondition.until`：重复结束日，**包含当天**；
 * - `ended` 事件：effectiveDate 是**第一天不再执行**，因此要减一天再取交集。
 * 若 ended 之后又有 reopened，则这段不执行区间由 endedGapsOf 处理，不进入 hardStop。
 */
export function hardStopOf(task: LongTask): ISODate | null {
  const until = task.endCondition.type === 'until' ? task.endCondition.until : null;
  const ended = endedOnOf(task.events);
  const endedUpper = ended === null ? null : addDaysIso(ended, -1);
  return minIso(minIso(task.endDate, until), endedUpper);
}

/**
 * count 上限：非法值（0/负数/小数）一律按 0 处理，供引擎做防御性空结果。
 * 正常写入路径必须先用守卫拒绝这些值。
 */
function countLimitOf(condition: EndCondition): number | null {
  if (condition.type !== 'count') return null;
  const value = condition.count;
  if (!Number.isInteger(value) || value < 1) return 0;
  return value;
}

/**
 * 某一天生效的规则版本：取 `effectiveFrom <= date` 中最大的那个。
 *
 * 选版只看日期，不看版本号——版本号仅用于审计排序，避免「versionNo 大者
 * 覆盖同日规则」这类静默改写历史的行为。若 date 早于所有版本则返回 null。
 */
export function activeVersionOf(
  versions: LongTaskRuleVersion[],
  date: ISODate,
): LongTaskRuleVersion | null {
  let active: LongTaskRuleVersion | null = null;
  for (const version of versions) {
    if (compareIso(version.effectiveFrom, date) > 0) continue;
    if (active === null || compareIso(version.effectiveFrom, active.effectiveFrom) > 0) {
      active = version;
    }
  }
  return active;
}

/* ------------------------------------------------------------------ *
 * 例外：同一日期取 revision 最大的那条的 after
 * ------------------------------------------------------------------ */

export function effectiveException(
  exceptions: LongTaskException[],
  date: ISODate,
): LongTaskException | null {
  let latest: LongTaskException | null = null;
  for (const item of exceptions) {
    if (item.occurrenceDate !== date) continue;
    if (latest === null || item.revision > latest.revision) latest = item;
  }
  return latest;
}

/**
 * 一次性把例外摊平成「日期 → 当前状态」，避免展开时对每个候选日
 * 都线性扫描全部例外（5 年 × 数百条例外会变成百万级比较）。
 */
function exceptionStatesOf(exceptions: LongTaskException[]): Map<ISODate, ExceptionState> {
  const states = new Map<ISODate, ExceptionState>();
  const revisions = new Map<ISODate, number>();
  for (const item of exceptions) {
    const current = revisions.get(item.occurrenceDate);
    if (current === undefined || item.revision > current) {
      revisions.set(item.occurrenceDate, item.revision);
      states.set(item.occurrenceDate, item.after);
    }
  }
  return states;
}

export function baseOccurrenceOf(
  task: LongTask,
  version: LongTaskRuleVersion,
  date: ISODate,
  slotIndex: number,
): BaseOccurrence {
  return {
    date,
    slotIndex,
    versionId: version.id,
    title: task.title,
    description: task.description,
    note: task.note,
    priority: task.priority,
    // 单次安排默认没有截止日；系列 endDate 只控制生成边界，绝不复制到每一次。
    dueDate: null,
    tags: [...task.tags],
  };
}

/* ------------------------------------------------------------------ *
 * 核心：把「规则版本 + 生命周期 + 例外」展开成槽位
 *
 * 关键口径（P1.3.1）：
 * - slotIndex 从系列起点 1 开始累计，跨版本连续，count 用它判定；
 * - 每个版本只负责 [effectiveFrom, 下一版 effectiveFrom - 1]；
 * - 再与 hardStop（endDate / until 取较早者）取交集；
 * - 暂停区间内的候选日不占槽位（不计次）；
 * - skip 例外仍占槽位（计次）但不产生可见安排；
 * - 查询窗口只过滤结果，不参与计数。
 * ------------------------------------------------------------------ */

export interface ScheduleSlot {
  date: ISODate;
  slotIndex: number;
  versionId: string;
  base: BaseOccurrence;
  state: ExceptionState;
}

export interface ComputeSlotsOptions {
  task: LongTask;
  versions: LongTaskRuleVersion[];
  exceptions: LongTaskException[];
  /** 计算上界（含）。必须有，避免无终止条件时无限展开。 */
  dateUpper: ISODate;
}

export function computeSlots({
  task,
  versions,
  exceptions,
  dateUpper,
}: ComputeSlotsOptions): ScheduleSlot[] {
  const sorted = versions.slice().sort((a, b) => compareIso(a.effectiveFrom, b.effectiveFrom));
  if (sorted.length === 0) return [];

  const suspensions = suspensionsOf(task.events);
  const endedGaps = endedGapsOf(task.events);
  const exceptionStates = exceptionStatesOf(exceptions);
  const hardStop = hardStopOf(task);
  const countLimit = countLimitOf(task.endCondition);
  // 防御性处理：非法 count（0/负数/小数）一律不产生安排，写入前守卫会直接拒绝。
  if (countLimit !== null && countLimit < 1) return [];

  const upper = minIso(dateUpper, hardStop);
  if (upper === null || compareIso(task.startDate, upper) > 0) return [];

  const slots: ScheduleSlot[] = [];
  const seen = new Set<ISODate>();
  let slotIndex = 0;

  for (let index = 0; index < sorted.length; index += 1) {
    const version = sorted[index];
    if (!version) continue;
    const next = sorted[index + 1] ?? null;

    const segFrom = maxIso(version.effectiveFrom, task.startDate);
    const versionEnd = next ? addDaysIso(next.effectiveFrom, -1) : upper;
    const segTo = minIso(versionEnd, upper);
    if (segTo === null || compareIso(segFrom, segTo) > 0) continue;

    for (const date of eachDate(segFrom, segTo)) {
      if (!matchesSpec(version.spec, date)) continue;
      if (isPausedOn(suspensions, date)) continue;
      if (isEndedOn(endedGaps, date)) continue;
      if (seen.has(date)) continue;
      if (countLimit !== null && slotIndex >= countLimit) return slots;
      seen.add(date);

      slotIndex += 1;
      slots.push({
        date,
        slotIndex,
        versionId: version.id,
        base: baseOccurrenceOf(task, version, date, slotIndex),
        state: exceptionStates.get(date) ?? { mode: 'rule' },
      });
    }
  }

  return slots;
}

export function slotsInRange(
  options: ComputeSlotsOptions,
  from: ISODate,
  to: ISODate,
): ScheduleSlot[] {
  return computeSlots({ ...options, dateUpper: to }).filter(
    (slot) => compareIso(slot.date, from) >= 0 && compareIso(slot.date, to) <= 0,
  );
}

/** 右侧卡片「未来 5 次」：跳过 skip 例外，只给可见安排。 */
export function upcomingSlots(
  options: ComputeSlotsOptions,
  from: ISODate,
  limit = 5,
  horizonDays = 400,
): ScheduleSlot[] {
  const to = addDaysIso(from, horizonDays);
  return computeSlots({ ...options, dateUpper: to })
    .filter((slot) => compareIso(slot.date, from) >= 0 && slot.state.mode !== 'skip')
    .slice(0, limit);
}

/** 某天是否是该长期任务的有效安排日（skip 视为无安排）。 */
export function isPlannedOccurrence(options: ComputeSlotsOptions, date: ISODate): boolean {
  const slots = slotsInRange(options, date, date);
  return slots.some((slot) => slot.state.mode !== 'skip');
}

/** 该日期的槽位（含 skip），用于「仅修改本次」定位。 */
export function slotOn(options: ComputeSlotsOptions, date: ISODate): ScheduleSlot | null {
  const slots = slotsInRange(options, date, date);
  return slots[0] ?? null;
}

/** 展开为可渲染的安排（应用 override 后）。 */
export interface ResolvedOccurrence {
  date: ISODate;
  slotIndex: number;
  title: string;
  description: string;
  note: string;
  priority: BaseOccurrence['priority'];
  dueDate: ISODate | null;
  tags: string[];
  overridden: boolean;
}

export function resolveOccurrence(slot: ScheduleSlot): ResolvedOccurrence | null {
  if (slot.state.mode === 'skip') return null;
  if (slot.state.mode === 'rule') {
    return {
      date: slot.date,
      slotIndex: slot.slotIndex,
      title: slot.base.title,
      description: slot.base.description,
      note: slot.base.note,
      priority: slot.base.priority,
      dueDate: slot.base.dueDate,
      tags: slot.base.tags,
      overridden: false,
    };
  }
  const patch = slot.state.patch;
  return {
    date: slot.date,
    slotIndex: slot.slotIndex,
    title: patch.title ?? slot.base.title,
    description: patch.description ?? slot.base.description,
    note: patch.note ?? slot.base.note,
    priority: patch.priority ?? slot.base.priority,
    dueDate: patch.dueDate === undefined ? slot.base.dueDate : patch.dueDate,
    tags: patch.tags ?? slot.base.tags,
    overridden: true,
  };
}
