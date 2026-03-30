import { create } from 'zustand';

interface IAuthUiState {
  isLoggingOut: boolean;
  setIsLoggingOut: (val: boolean) => void;
}

export const useAuthStore = create<IAuthUiState>((set) => ({
  isLoggingOut: false,
  setIsLoggingOut: (val) => set({ isLoggingOut: val }),
}));
