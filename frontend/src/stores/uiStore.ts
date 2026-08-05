import { create } from 'zustand';

interface IUiState {
  planPivotMode: boolean;
  setPlanPivotMode: (val: boolean) => void;
  // Sunday is rarely used and widens the weekly-plan grid, so it's hidden by
  // default and revealed on demand via a toolbar toggle.
  planShowSunday: boolean;
  setPlanShowSunday: (val: boolean) => void;
  // Boss view/edit toggle (2026-08-05). The boss holds full CRUD in the
  // permission matrix, so this guards against accidental edits while he browses
  // the process. Deliberately NOT persisted — every session starts read-only.
  // This is a UI guard, not a security boundary: the backend accepts boss
  // writes in both positions.
  bossEditMode: boolean;
  setBossEditMode: (val: boolean) => void;
}

export const useUiStore = create<IUiState>((set) => ({
  planPivotMode: false,
  setPlanPivotMode: (val) => set({ planPivotMode: val }),
  planShowSunday: false,
  setPlanShowSunday: (val) => set({ planShowSunday: val }),
  bossEditMode: false,
  setBossEditMode: (val) => set({ bossEditMode: val }),
}));
