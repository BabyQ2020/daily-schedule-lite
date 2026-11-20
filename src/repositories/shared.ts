export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 200;

export interface PageRequest {
  page?: number;
  pageSize?: number;
}

export interface NormalizedPage {
  page: number;
  pageSize: number;
  offset: number;
}

export interface PagedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export function normalizePage(request: PageRequest = {}): NormalizedPage {
  const rawPage = Number.isFinite(request.page) ? Math.floor(request.page ?? 1) : 1;
  const rawSize = Number.isFinite(request.pageSize)
    ? Math.floor(request.pageSize ?? DEFAULT_PAGE_SIZE)
    : DEFAULT_PAGE_SIZE;
  const page = Math.max(1, rawPage);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, rawSize));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export function paginate<T>(items: readonly T[], request: PageRequest = {}): PagedResult<T> {
  const { page, pageSize, offset } = normalizePage(request);
  const total = items.length;
  return {
    items: items.slice(offset, offset + pageSize),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export type SortDirection = 'asc' | 'desc';

/** ISO 日期/时间字符串的比较；null 恒排在最后（与方向无关）。 */
export function compareNullableText(
  a: string | null,
  b: string | null,
  direction: SortDirection,
): number {
  if (a === b) {
    return 0;
  }
  if (a === null) {
    return 1;
  }
  if (b === null) {
    return -1;
  }
  const result = a < b ? -1 : 1;
  return direction === 'asc' ? result : -result;
}

export function directionFactor(direction: SortDirection): number {
  return direction === 'asc' ? 1 : -1;
}

const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * 严格递增的更新时间：`max(now, previous + 1ms)`。
 *
 * 同一毫秒内连续两次写入、或传入的 `now` 早于记录当前时间时，仍然保证
 * `Date.parse(结果) > Date.parse(previous)`，用于乐观锁与审计排序。
 * 所有写 Task.updatedAt 的仓储操作必须走这里，不得各自实现。
 */
export function nextUpdatedAt(previousUpdatedAt: string, now: string): string {
  if (!ISO_TIMESTAMP_PATTERN.test(previousUpdatedAt)) {
    throw new Error(`updatedAt 不是合法的 ISO 时间：${previousUpdatedAt}`);
  }
  if (!ISO_TIMESTAMP_PATTERN.test(now)) {
    throw new Error(`now 不是合法的 ISO 时间：${now}`);
  }
  const previous = Date.parse(previousUpdatedAt);
  const current = Date.parse(now);
  if (Number.isNaN(previous) || Number.isNaN(current)) {
    throw new Error(`无法解析时间：previous=${previousUpdatedAt} now=${now}`);
  }
  return new Date(Math.max(current, previous + 1)).toISOString();
}
