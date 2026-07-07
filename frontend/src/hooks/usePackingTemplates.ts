import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import type { IApiListResponse } from '@/types';
import type { IPackingTemplate, IPackingTemplatePayload } from '@/types/packingTemplate';

const QUERY_KEY = ['packing-templates'] as const;

interface IMutationOptions {
  onSuccess?: () => void;
  onError?: (err: unknown) => void;
}

/** Active templates for the panel picker. */
export function usePackingTemplates() {
  return useQuery({
    queryKey: [...QUERY_KEY, 'active'],
    queryFn: async (): Promise<IPackingTemplate[]> => {
      const { data } = await api.get<IApiListResponse<IPackingTemplate>>(
        '/export/packing-templates/?is_active=true&ordering=sort_order&page_size=200',
      );
      return data.results;
    },
    staleTime: 5 * 60_000,
  });
}

/** All templates (incl. inactive) for the admin page. */
export function usePackingTemplatesAll() {
  return useQuery({
    queryKey: [...QUERY_KEY, 'all'],
    queryFn: async (): Promise<IPackingTemplate[]> => {
      const { data } = await api.get<IApiListResponse<IPackingTemplate>>(
        '/export/packing-templates/?ordering=sort_order&page_size=200',
      );
      return data.results;
    },
    staleTime: 60_000,
  });
}

export function useCreatePackingTemplate(options: IMutationOptions = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: IPackingTemplatePayload) =>
      api.post<IPackingTemplate>('/export/packing-templates/', payload),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: QUERY_KEY }); options.onSuccess?.(); },
    onError: options.onError,
  });
}

export function useUpdatePackingTemplate(options: IMutationOptions = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...payload }: Partial<IPackingTemplatePayload> & { id: number }) =>
      api.patch<IPackingTemplate>(`/export/packing-templates/${id}/`, payload),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: QUERY_KEY }); options.onSuccess?.(); },
    onError: options.onError,
  });
}

export function useDeletePackingTemplate(options: IMutationOptions = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete(`/export/packing-templates/${id}/`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: QUERY_KEY }); options.onSuccess?.(); },
    onError: options.onError,
  });
}
