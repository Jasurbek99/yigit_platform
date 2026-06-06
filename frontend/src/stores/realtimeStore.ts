// Cross-component realtime state. The WS singleton is the source of truth
// for incoming frames; this store fans the data out to React components.
//
// Only `status` and `sheetRoster` live here. Per-feature state should stay
// in feature stores or component state.

import { create } from 'zustand';
import type { IPresenceUser, IRealtimeStatus } from '@/types/presence';

interface IRealtimeState {
  status: IRealtimeStatus;
  sheetRoster: IPresenceUser[];
  setStatus: (s: IRealtimeStatus) => void;
  setSheetRoster: (users: IPresenceUser[]) => void;
}

export const useRealtimeStore = create<IRealtimeState>((set) => ({
  status: 'closed',
  sheetRoster: [],
  setStatus: (status) => set({ status }),
  setSheetRoster: (sheetRoster) => set({ sheetRoster }),
}));
