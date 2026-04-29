import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import api from '@/services/api';
import { MOCK_MENTIONABLES } from '@/mock/comments';
import type { IMentionable } from '@/types';

const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true';

/**
 * Debounced search hook for @mention autocomplete.
 * Empty query returns top users + all roles.
 * query should already be debounced by the caller (150ms recommended).
 */
export function useMentionable(query: string) {
  const trimmed = query.trim();

  const result = useQuery({
    queryKey: ['mentionable', trimmed],
    queryFn: async (): Promise<IMentionable[]> => {
      if (USE_MOCK) {
        const q = trimmed.toLowerCase();
        return MOCK_MENTIONABLES.filter((m) => {
          if (m.type === 'user') return !q || m.name.toLowerCase().includes(q);
          return !q || m.label.toLowerCase().includes(q) || m.code.toLowerCase().includes(q);
        });
      }

      const params: Record<string, string> = { limit: '10' };
      if (trimmed) params.q = trimmed;

      const { data } = await api.get<IMentionable[]>('/core/users/mentionable/', { params });
      return data;
    },
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });

  const users = useMemo(
    () => (result.data ?? []).filter((m): m is Extract<IMentionable, { type: 'user' }> => m.type === 'user'),
    [result.data],
  );

  const roles = useMemo(
    () => (result.data ?? []).filter((m): m is Extract<IMentionable, { type: 'role' }> => m.type === 'role'),
    [result.data],
  );

  return { ...result, users, roles };
}
