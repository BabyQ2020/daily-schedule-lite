/**
 * 日期与周期服务 —— 全应用唯一的日期口径来源。
 *
 * 约定：
 * 1) 日期一律使用「本地日历字符串」YYYY-MM-DD，避免 UTC 偏移把「今天」算错；
 * 2) 所有「今天 / 现在」都来自注入的时钟，便于测试与后续调整；
 * 3) 周起始日可配置（1=周一 … 7=周日），一处配置全局生效；
 * 4) 页面与业务代码不得自行拼接日期区间，必须调用本模块。
 */

export type ISODate = string;

export type PeriodKind = 'day' | 'week' | 'month';

/** 周起始日：1=周一 … 7=周日（与 ISO 星期编号一致）。 */
export type WeekStart = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface Period {
  readonly kind: PeriodKind;
  readonly start: ISODate;
  readonly end: ISODate;
}

export const DEFAULT_WEEK_START: WeekStart = 1;

export const WEEK_START_OPTIONS: readonly { readonly value: WeekStart; readonly label: string }[] =
  [
    { value: 1, label: '周一' },
    { value: 2, label: '周二' },
    { value: 3, label: '周三' },
    { value: 4, label: '周四' },
    { value: 5, label: '周五' },
    { value: 6, label: '周六' },
    { value: 7, label: '周日' },
  ];

const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const;

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 把 Date 转成本地日历字符串。 */
export function toISODate(date: Date): ISODate {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** 解析本地日历字符串为当日 00:00 的 Date；非法格式或非法日期直接抛错。 */
export function parseISODate(value: ISODate): Date {
  const matched = ISO_DATE_PATTERN.exec(value);
  if (!matched) {
    throw new RangeError(`日期格式非法（应为 YYYY-MM-DD）：${value}`);
  }
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    throw new RangeError(`日期不存在：${value}`);
  }
  date.setHours(0, 0, 0, 0);
  return date;
}

export function isValidISODate(value: string): boolean {
  try {
    parseISODate(value);
    return true;
  } catch {
    return false;
  }
}

/** 当日 00:00。 */
export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date: Date, amount: number): Date {
  const next = startOfDay(date);
  next.setDate(next.getDate() + amount);
  return next;
}

/** 加减月份，日期超出目标月天数时收敛到月末（1/31 + 1 月 = 2/28）。 */
export function addMonths(date: Date, amount: number): Date {
  const year = date.getFullYear();
  const month = date.getMonth() + amount;
  const day = date.getDate();
  const lastDayOfTargetMonth = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(day, lastDayOfTargetMonth));
}

/** ISO 星期编号：周一=1 … 周日=7。 */
export function isoWeekday(date: Date): number {
  const weekday = date.getDay();
  return weekday === 0 ? 7 : weekday;
}

export function assertWeekStart(value: number): asserts value is WeekStart {
  if (!Number.isInteger(value) || value < 1 || value > 7) {
    throw new RangeError(`周起始日必须是 1–7 的整数：${String(value)}`);
  }
}

export function startOfWeek(date: Date, weekStart: WeekStart): Date {
  assertWeekStart(weekStart);
  const offset = (isoWeekday(date) - weekStart + 7) % 7;
  return addDays(startOfDay(date), -offset);
}

export function endOfWeek(date: Date, weekStart: WeekStart): Date {
  return addDays(startOfWeek(date, weekStart), 6);
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

/** 给定周期类型与锚点日期，返回该周期的起止（含首含尾）。 */
export function periodFor(kind: PeriodKind, anchor: ISODate, weekStart: WeekStart): Period {
  const date = parseISODate(anchor);
  switch (kind) {
    case 'day':
      return { kind, start: toISODate(date), end: toISODate(date) };
    case 'week':
      return {
        kind,
        start: toISODate(startOfWeek(date, weekStart)),
        end: toISODate(endOfWeek(date, weekStart)),
      };
    case 'month':
      return {
        kind,
        start: toISODate(startOfMonth(date)),
        end: toISODate(endOfMonth(date)),
      };
  }
}

/** 前后翻页：日 ±1 天、周 ±7 天、月 ±1 月（月份锚定到月初，避免 31 日溢出）。 */
export function shiftPeriod(period: Period, delta: number): Period {
  switch (period.kind) {
    case 'day': {
      const target = toISODate(addDays(parseISODate(period.start), delta));
      return { kind: 'day', start: target, end: target };
    }
    case 'week': {
      const start = addDays(parseISODate(period.start), delta * 7);
      return { kind: 'week', start: toISODate(start), end: toISODate(addDays(start, 6)) };
    }
    case 'month': {
      const start = startOfMonth(addMonths(parseISODate(period.start), delta));
      return { kind: 'month', start: toISODate(start), end: toISODate(endOfMonth(start)) };
    }
  }
}

/** ISO 日期字符串按字典序比较即等价于时间先后。 */
export function isDateInPeriod(date: ISODate, period: Period): boolean {
  return date >= period.start && date <= period.end;
}

export function daysInPeriod(period: Period): number {
  const start = parseISODate(period.start);
  const end = parseISODate(period.end);
  return Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
}

export function weekdayLabelOf(date: ISODate): string {
  return WEEKDAY_LABELS[parseISODate(date).getDay()] ?? '';
}

export function formatPeriodLabel(period: Period): string {
  switch (period.kind) {
    case 'day':
      return `${period.start}（${weekdayLabelOf(period.start)}）`;
    case 'week':
      return `${period.start} ~ ${period.end}`;
    case 'month': {
      const start = parseISODate(period.start);
      return `${start.getFullYear()} 年 ${start.getMonth() + 1} 月`;
    }
  }
}

export const PERIOD_KIND_LABELS: readonly { readonly value: PeriodKind; readonly label: string }[] =
  [
    { value: 'day', label: '日报' },
    { value: 'week', label: '周报' },
    { value: 'month', label: '月报' },
  ];

export interface DateContext {
  readonly weekStart: WeekStart;
  /** 当前时刻（每次调用重新取值）。 */
  now(): Date;
  /** 今天，YYYY-MM-DD。 */
  today(): ISODate;
  /** 当前时刻 ISO 字符串，用于 createdAt / updatedAt。 */
  nowISOString(): string;
  /** 以某天为锚点取周期，缺省锚点为今天。 */
  period(kind: PeriodKind, anchor?: ISODate): Period;
  shift(period: Period, delta: number): Period;
  isToday(date: ISODate): boolean;
  label(period: Period): string;
}

export interface DateContextOptions {
  readonly weekStart: WeekStart;
  readonly clock?: () => Date;
}

/**
 * 创建日期上下文。生产环境由设置注入 weekStart，测试用 clock 注入固定时间。
 */
export function createDateContext(options: DateContextOptions): DateContext {
  const { weekStart } = options;
  assertWeekStart(weekStart);
  const clock = options.clock ?? (() => new Date());

  const today = (): ISODate => toISODate(clock());

  return {
    weekStart,
    now: clock,
    today,
    nowISOString: () => clock().toISOString(),
    period: (kind, anchor) => periodFor(kind, anchor ?? today(), weekStart),
    shift: (period, delta) => shiftPeriod(period, delta),
    isToday: (date) => date === today(),
    label: formatPeriodLabel,
  };
}
