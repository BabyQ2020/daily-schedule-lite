import type { ISODate, WeekStart } from '@/lib/period';

const pattern = /^\d{4}-\d{2}-\d{2}$/;

/** 严格校验 YYYY-MM-DD 且日期真实存在（2026-02-30 判为非法）。 */
export function isISODateString(value: string): value is ISODate {
  if (!pattern.test(value)) {
    return false;
  }
  const [year, month, day] = value.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined) {
    return false;
  }
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

export function isWeekStart(value: number): value is WeekStart {
  return Number.isInteger(value) && value >= 1 && value <= 7;
}

export function assertNever(value: never): never {
  throw new Error(`未处理的分支：${String(value)}`);
}
