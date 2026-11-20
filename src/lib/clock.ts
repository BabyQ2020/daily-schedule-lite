import { toISODate } from '@/lib/period';

/** 当前时刻（ISO 字符串），用于 createdAt / updatedAt。 */
export function nowISOString(): string {
  return new Date().toISOString();
}

/** 今天（本地日历串）。 */
export function todayISO(): string {
  return toISODate(new Date());
}

export type Clock = () => string;

/** 供服务层注入时钟，测试里替换为固定值。 */
export const systemClock: Clock = () => new Date().toISOString();
