import { create } from 'zustand';

// Cross-component UI state — which season the app is currently browsing.
// NOT server data (that's the season list, fetched via useSeasons()), so it
// does not belong in TanStack Query. Mirrored to `?season=` by
// useSeasonParam() so a shared link reproduces the same view.
interface ISeasonState {
  selectedSeasonId: number | null;
  setSelectedSeasonId: (id: number | null) => void;
}

export const useSeasonStore = create<ISeasonState>((set) => ({
  selectedSeasonId: null,
  setSelectedSeasonId: (id) => set({ selectedSeasonId: id }),
}));
