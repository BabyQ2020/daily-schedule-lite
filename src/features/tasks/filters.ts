import { create } from 'zustand';

import type { TaskFilter, TaskSort, TaskSortKey } from '@/services/tasks/service';
import type { TaskPriority, TaskStatus } from '@/domain/types';

export type ArchiveView = 'active' | 'archived' | 'all';

export interface TaskQueryState {
  keyword: string;
  projectId: TaskFilter['projectId'];
  status: TaskStatus | 'all';
  priorities: TaskPriority[];
  tagId: string | 'all';
  dueFrom: string | null;
  dueTo: string | null;
  archived: ArchiveView;
  sortKey: TaskSortKey;
  sortDirection: 'asc' | 'desc';
  page: number;
  pageSize: number;
}

const initialState: TaskQueryState = {
  keyword: '',
  projectId: 'all',
  status: 'all',
  priorities: [],
  tagId: 'all',
  dueFrom: null,
  dueTo: null,
  archived: 'active',
  sortKey: 'updatedAt',
  sortDirection: 'desc',
  page: 1,
  pageSize: 20,
};

interface TaskQueryActions {
  /** 任何筛选变化都要回到第一页，否则会停在越界页码显示空表。 */
  patch: (partial: Partial<TaskQueryState>) => void;
  setPage: (page: number) => void;
  setPageSize: (pageSize: number) => void;
  setSort: (sortKey: TaskSortKey, sortDirection: 'asc' | 'desc') => void;
  reset: () => void;
  focusProject: (projectId: string | 'none' | 'all') => void;
}

export const useTaskQueryStore = create<TaskQueryState & TaskQueryActions>()((set) => ({
  ...initialState,
  patch: (partial) => set((state) => ({ ...state, ...partial, page: 1 })),
  setPage: (page) => set({ page }),
  setPageSize: (pageSize) => set({ pageSize, page: 1 }),
  setSort: (sortKey, sortDirection) => set({ sortKey, sortDirection, page: 1 }),
  reset: () => set({ ...initialState }),
  focusProject: (projectId) => set((state) => ({ ...state, projectId, page: 1 })),
}));

/** 把界面状态转换成仓储层筛选条件：'all' 与空数组一律省略，避免无意义过滤。 */
export function toTaskFilter(state: TaskQueryState): TaskFilter {
  const keyword = state.keyword.trim();
  return {
    keyword: keyword.length > 0 ? keyword : undefined,
    projectId: state.projectId ?? 'all',
    status: state.status,
    priorities: state.priorities.length > 0 ? state.priorities : undefined,
    tagId: state.tagId,
    dueFrom: state.dueFrom ?? undefined,
    dueTo: state.dueTo ?? undefined,
    archived: state.archived,
  };
}

export function toTaskSort(state: TaskQueryState): TaskSort {
  return { key: state.sortKey, direction: state.sortDirection };
}

/** 是否处于「筛选后为空」的状态，用于区分「一条任务都没有」和「没匹配到」。 */
export function hasActiveFilters(state: TaskQueryState): boolean {
  return (
    state.keyword.trim().length > 0 ||
    (state.projectId ?? 'all') !== 'all' ||
    state.status !== 'all' ||
    state.priorities.length > 0 ||
    state.tagId !== 'all' ||
    state.dueFrom !== null ||
    state.dueTo !== null ||
    state.archived !== 'active'
  );
}
