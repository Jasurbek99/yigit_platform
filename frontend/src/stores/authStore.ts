import { create } from 'zustand';
import type { ICurrentUser } from '@/types';

interface IAuthState {
  user: ICurrentUser | null;
  setUser: (user: ICurrentUser | null) => void;
}

export const useAuthStore = create<IAuthState>((set) => ({
  user: null,
  setUser: (user) => set({ user }),
}));
