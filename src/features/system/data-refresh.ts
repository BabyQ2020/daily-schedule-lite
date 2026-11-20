import { create } from 'zustand';

interface DataRefreshState {
  /** 每次导入/清空后自增，用来让自检面板重新读取 IndexedDB。 */
  version: number;
  bump: () => void;
}

export const useDataRefreshStore = create<DataRefreshState>((set) => ({
  version: 0,
  bump: () => set((state) => ({ version: state.version + 1 })),
}));
