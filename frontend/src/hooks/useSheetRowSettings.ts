import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import type { ISheetRowSetting } from '@/types';

interface MutationOptions {
  onSuccess?: () => void;
  onError?: (err: unknown) => void;
}

interface ISaveSheetRowPayload {
  field_key: string;
  triggered_role?: string;
  triggered_user?: number | null;
}

export function useSheetRowSettings() {
  return useQuery({
    queryKey: ['admin', 'sheet-rows'],
    queryFn: async (): Promise<ISheetRowSetting[]> => {
      const { data } = await api.get<ISheetRowSetting[]>('/export/admin/sheet-rows/');
      return Array.isArray(data) ? data : (data as { results: ISheetRowSetting[] }).results;
    },
    staleTime: 60_000,
  });
}

export function useSaveSheetRowSetting(options: MutationOptions = {}) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ field_key, triggered_role, triggered_user }: ISaveSheetRowPayload) => {
      const body: Record<string, unknown> = {};
      if (triggered_role !== undefined) body.triggered_role = triggered_role;
      if (triggered_user !== undefined) body.triggered_user = triggered_user;
      const { data } = await api.patch<ISheetRowSetting>(
        `/export/admin/sheet-rows/${field_key}/`,
        body,
      );
      return data;
    },
    onSuccess: () => {
      // Invalidate admin list AND live sheet so the trigger shows immediately.
      queryClient.invalidateQueries({ queryKey: ['admin', 'sheet-rows'] });
      queryClient.invalidateQueries({ queryKey: ['shipments', 'sheet'] });
      options.onSuccess?.();
    },
    onError: options.onError,
  });
}
