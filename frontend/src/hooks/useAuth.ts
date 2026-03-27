import { useQuery } from '@tanstack/react-query';
import api from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import type { ICurrentUser } from '@/types';

export function useAuth() {
  const setUser = useAuthStore((s) => s.setUser);
  const user = useAuthStore((s) => s.user);

  const query = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: async () => {
      const { data } = await api.get<ICurrentUser>('/auth/me/');
      setUser(data);
      return data;
    },
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  return { user: user ?? query.data ?? null, isLoading: query.isLoading, isError: query.isError };
}
