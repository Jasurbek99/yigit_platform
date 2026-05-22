import { create } from 'zustand';

interface IUiState {
  planPivotMode: boolean;
  setPlanPivotMode: (val: boolean) => void;
  // Sunday is rarely used and widens the weekly-plan grid, so it's hidden by
  // default and revealed on demand via a toolbar toggle.
  planShowSunday: boolean;
  setPlanShowSunday: (val: boolean) => void;
}

export const useUiStore = create<IUiState>((set) => ({
  planPivotMode: false,
  setPlanPivotMode: (val) => set({ planPivotMode: val }),
  planShowSunday: false,
  setPlanShowSunday: (val) => set({ planShowSunday: val }),
}));
