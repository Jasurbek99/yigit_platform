import { create } from 'zustand';

interface IUiState {
  planPivotMode: boolean;
  setPlanPivotMode: (val: boolean) => void;
}

export const useUiStore = create<IUiState>((set) => ({
  planPivotMode: false,
  setPlanPivotMode: (val) => set({ planPivotMode: val }),
}));
