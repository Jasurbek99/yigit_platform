import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import type { IApiListResponse } from '@/types';
import type {
  ISplitTemplate,
  ISplitTemplateCreatePayload,
  ISplitTemplateUpdatePayload,
} from '@/types/splitTemplate';

const QUERY_KEY = ['split-templates'] as const;

interface IMutationOptions {
  onSuccess?: () => void;
  onError?: (err: unknown) => void;
}

/** Active split templates for the panel picker. */
export function useSplitTemplates() {
  return useQuery({
    queryKey: [...QUERY_KEY, 'active'],
    queryFn: async (): Promise<ISplitTemplate[]> => {
      const { data } = await api.get<IApiListResponse<ISplitTemplate>>(
        '/export/split-templates/?is_active=true&ordering=sort_order&page_size=200',
      );
      return data.results;
    },
    staleTime: 5 * 60_000,
  });
}

/** All split templates (incl. inactive) for the admin page. */
export function useSplitTemplatesAll() {
  return useQuery({
    queryKey: [...QUERY_KEY, 'all'],
    queryFn: async (): Promise<ISplitTemplate[]> => {
      const { data } = await api.get<IApiListResponse<ISplitTemplate>>(
        '/export/split-templates/?ordering=sort_order&page_size=200',
      );
      return data.results;
    },
    staleTime: 60_000,
  });
}

export function useCreateSplitTemplate(options: IMutationOptions = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: ISplitTemplateCreatePayload) =>
      api.post<ISplitTemplate>('/export/split-templates/', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      options.onSuccess?.();
    },
    onError: options.onError,
  });
}

export function useUpdateSplitTemplate(options: IMutationOptions = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...payload }: ISplitTemplateUpdatePayload & { id: number }) =>
      api.patch<ISplitTemplate>(`/export/split-templates/${id}/`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      options.onSuccess?.();
    },
    onError: options.onError,
  });
}

export function useDeleteSplitTemplate(options: IMutationOptions = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete(`/export/split-templates/${id}/`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      options.onSuccess?.();
    },
    onError: options.onError,
  });
}
