import type { ISODate } from './period';

/**
 * 真实日历日期校验。
 *
 * 只靠 TS 的 `string` 类型或正则 `\d{4}-\d{2}-\d{2}` 无法拦住 2026-02-30，
 * 因此凡是写入或从外部读取的日期，都必须过这一关（含闰年判断）。
 */
export function isRealIsoDate(value: unknown): value is ISODate {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1) return false;

  return day <= daysInMonth(year, month);
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  if (month === 4 || month === 6 || month === 9 || month === 11) return 30;
  return 31;
}
