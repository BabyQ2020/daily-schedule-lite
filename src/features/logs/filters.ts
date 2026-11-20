import { create } from 'zustand';

import type { LogFilter } from '@/services/logs/service';

export interface LogQueryState {
  keyword: string;
  projectId: LogFilter['projectId'];
  taskId: LogFilter['taskId'];
  tagId: LogFilter['tagId'];
  dateFrom: string | null;
  dateTo: string | null;
  page: number;
  pageSize: number;
}

const initialState: LogQueryState = {
  keyword: '',
  projectId: 'all',
  taskId: 'all',
  tagId: 'all',
  dateFrom: null,
  dateTo: null,
  page: 1,
  pageSize: 20,
};

interface LogQueryActions {
  /** 任何筛选变化都要回到第一页，否则会停在越界页码显示空列表。 */
  patch: (partial: Partial<LogQueryState>) => void;
  setPage: (page: number) => void;
  setPageSize: (pageSize: number) => void;
  reset: () => void;
  focusProject: (projectId: string | 'none' | 'all') => void;
}

export const useLogQueryStore = create<LogQueryState & LogQueryActions>()((set) => ({
  ...initialState,
  patch: (partial) => set((state) => ({ ...state, ...partial, page: 1 })),
  setPage: (page) => set({ page }),
  setPageSize: (pageSize) => set({ pageSize, page: 1 }),
  reset: () => set({ ...initialState }),
  focusProject: (projectId) => set((state) => ({ ...state, projectId, page: 1 })),
}));

/** 界面状态 → 仓储筛选条件；'all' 与空值一律省略，避免无意义过滤。 */
export function toLogFilter(state: LogQueryState): LogFilter {
  const keyword = state.keyword.trim();
  return {
    keyword: keyword.length > 0 ? keyword : undefined,
    projectId: state.projectId ?? 'all',
    taskId: state.taskId ?? 'all',
    tagId: state.tagId ?? 'all',
    dateFrom: state.dateFrom ?? undefined,
    dateTo: state.dateTo ?? undefined,
  };
}

/** 区分「一条日志都没有」与「筛选后没匹配到」。 */
export function hasActiveLogFilters(state: LogQueryState): boolean {
  return (
    state.keyword.trim().length > 0 ||
    (state.projectId ?? 'all') !== 'all' ||
    (state.taskId ?? 'all') !== 'all' ||
    state.tagId !== 'all' ||
    state.dateFrom !== null ||
    state.dateTo !== null
  );
}
