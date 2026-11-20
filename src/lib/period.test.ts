import { describe, expect, it } from 'vitest';

import {
  addDays,
  addMonths,
  assertWeekStart,
  createDateContext,
  daysInPeriod,
  formatPeriodLabel,
  isDateInPeriod,
  isValidISODate,
  isoWeekday,
  parseISODate,
  periodFor,
  shiftPeriod,
  startOfWeek,
  toISODate,
  weekdayLabelOf,
} from '@/lib/period';

describe('toISODate / parseISODate', () => {
  it('补零输出本地日历字符串', () => {
    expect(toISODate(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(toISODate(new Date(2026, 10, 15))).toBe('2026-11-15');
  });

  it('解析后为当日 00:00，且可往返', () => {
    const date = parseISODate('2026-11-15');
    expect(date.getHours()).toBe(0);
    expect(toISODate(date)).toBe('2026-11-15');
  });

  it('非法格式与不存在的日期都抛错', () => {
    expect(() => parseISODate('2026-1-5')).toThrow(RangeError);
    expect(() => parseISODate('2026/11/15')).toThrow(RangeError);
    expect(() => parseISODate('2026-02-30')).toThrow(RangeError);
    expect(() => parseISODate('')).toThrow(RangeError);
  });

  it('isValidISODate 不抛错，只返回布尔值', () => {
    expect(isValidISODate('2024-02-29')).toBe(true);
    expect(isValidISODate('2025-02-29')).toBe(false);
    expect(isValidISODate('abc')).toBe(false);
  });
});

describe('星期与周区间', () => {
  it('ISO 星期编号：周一=1，周日=7', () => {
    expect(isoWeekday(parseISODate('2026-11-09'))).toBe(1);
    expect(isoWeekday(parseISODate('2026-11-15'))).toBe(7);
  });

  it('周起始日为周一时，周日归属上一周（2026-11-09 ~ 2026-11-15）', () => {
    const anchor = parseISODate('2026-11-15');
    expect(toISODate(startOfWeek(anchor, 1))).toBe('2026-11-09');
    expect(toISODate(addDays(startOfWeek(anchor, 1), 6))).toBe('2026-11-15');
  });

  it('周起始日为周日时，周日是本周第一天', () => {
    const anchor = parseISODate('2026-11-15');
    expect(toISODate(startOfWeek(anchor, 7))).toBe('2026-11-15');
    expect(toISODate(startOfWeek(parseISODate('2026-11-08'), 7))).toBe('2026-11-08');
    expect(toISODate(startOfWeek(parseISODate('2026-11-09'), 7))).toBe('2026-11-08');
  });

  it('跨年周：2026-01-01 属于 2025-12-29 ~ 2026-01-04', () => {
    const week = periodFor('week', '2026-01-01', 1);
    expect(week.start).toBe('2025-12-29');
    expect(week.end).toBe('2026-01-04');
    expect(daysInPeriod(week)).toBe(7);
  });

  it('周起始日非法时抛错', () => {
    expect(() => assertWeekStart(0)).toThrow(RangeError);
    expect(() => assertWeekStart(8)).toThrow(RangeError);
    expect(() => assertWeekStart(1.5)).toThrow(RangeError);
  });
});

describe('月份与周期计算', () => {
  it('月末收敛：1/31 + 1 月 = 2/28，闰年 2/29', () => {
    expect(toISODate(addMonths(new Date(2026, 0, 31), 1))).toBe('2026-02-28');
    expect(toISODate(addMonths(new Date(2024, 0, 31), 1))).toBe('2024-02-29');
  });

  it('月周期首尾正确（含闰年 2 月）', () => {
    expect(periodFor('month', '2026-11-15', 1)).toEqual({
      kind: 'month',
      start: '2026-11-01',
      end: '2026-11-30',
    });
    expect(periodFor('month', '2024-02-10', 1).end).toBe('2024-02-29');
    expect(periodFor('month', '2026-02-10', 1).end).toBe('2026-02-28');
  });

  it('日周期即当天', () => {
    expect(periodFor('day', '2026-11-15', 1)).toEqual({
      kind: 'day',
      start: '2026-11-15',
      end: '2026-11-15',
    });
  });

  it('shiftPeriod 前后翻页（含跨年周与月边界）', () => {
    const week = periodFor('week', '2025-12-29', 1);
    expect(shiftPeriod(week, 1)).toEqual({
      kind: 'week',
      start: '2026-01-05',
      end: '2026-01-11',
    });

    const month = periodFor('month', '2026-01-15', 1);
    expect(shiftPeriod(month, 1)).toEqual({
      kind: 'month',
      start: '2026-02-01',
      end: '2026-02-28',
    });
    expect(shiftPeriod(month, -1)).toEqual({
      kind: 'month',
      start: '2025-12-01',
      end: '2025-12-31',
    });

    const day = periodFor('day', '2026-12-31', 1);
    expect(shiftPeriod(day, 1).start).toBe('2027-01-01');
  });

  it('isDateInPeriod 含首含尾', () => {
    const week = periodFor('week', '2026-11-15', 1);
    expect(isDateInPeriod('2026-11-09', week)).toBe(true);
    expect(isDateInPeriod('2026-11-15', week)).toBe(true);
    expect(isDateInPeriod('2026-11-16', week)).toBe(false);
    expect(isDateInPeriod('2026-11-08', week)).toBe(false);
  });
});

describe('展示文案', () => {
  it('星期与周期标签', () => {
    expect(weekdayLabelOf('2026-11-15')).toBe('周日');
    expect(formatPeriodLabel(periodFor('day', '2026-11-15', 1))).toBe('2026-11-15（周日）');
    expect(formatPeriodLabel(periodFor('week', '2026-11-15', 1))).toBe('2026-11-09 ~ 2026-11-15');
    expect(formatPeriodLabel(periodFor('month', '2026-11-15', 1))).toBe('2026 年 11 月');
  });
});

describe('createDateContext', () => {
  it('通过注入时钟固定「今天」，并继承 weekStart', () => {
    const ctx = createDateContext({
      weekStart: 1,
      clock: () => new Date(2026, 10, 15, 10, 30, 0),
    });

    expect(ctx.today()).toBe('2026-11-15');
    expect(ctx.isToday('2026-11-15')).toBe(true);
    expect(ctx.isToday('2026-11-14')).toBe(false);
    expect(ctx.period('week')).toEqual({
      kind: 'week',
      start: '2026-11-09',
      end: '2026-11-15',
    });
    expect(ctx.label(ctx.period('week'))).toBe('2026-11-09 ~ 2026-11-15');
    expect(ctx.nowISOString()).toBe(new Date(2026, 10, 15, 10, 30, 0).toISOString());
  });

  it('周起始日可配置为周日', () => {
    const ctx = createDateContext({
      weekStart: 7,
      clock: () => new Date(2026, 10, 15),
    });
    expect(ctx.period('week').start).toBe('2026-11-15');
    expect(ctx.period('week').end).toBe('2026-11-21');
  });
});
