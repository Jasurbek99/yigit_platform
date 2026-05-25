import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import type { INotification } from '@/types';

export function useNotifications() {
  return useQuery({
    queryKey: ['notifications'],
    queryFn: async (): Promise<INotification[]> => {
      const { data } = await api.get<{ results?: INotification[] } | INotification[]>(
        '/export/notifications/',
      );
      if (Array.isArray(data)) return data;
      return data.results ?? [];
    },
    // Polls app-wide (NotificationBell lives in AppLayout). 60s halves the
    // steady-state request rate vs 30s; v5 already pauses the interval while
    // the tab is backgrounded (refetchIntervalInBackground defaults to false).
    refetchInterval: 60_000,
    staleTime: 60_000,
  });
}

export function useMarkAllRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/export/notifications/read_all/'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });
}

export function useMarkOneRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.post(`/export/notifications/${id}/read/`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });
}
