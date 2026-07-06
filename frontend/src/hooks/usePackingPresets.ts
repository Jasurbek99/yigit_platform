import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import type { IApiListResponse } from '@/types';
import type {
  IPackingPreset,
  IPackingPresetCreatePayload,
  IPackingPresetUpdatePayload,
  PackingProductType,
} from '@/types/packingPreset';

const QUERY_KEY = ['packing-presets'] as const;

interface IListParams {
  product_type?: PackingProductType;
  is_active?: boolean;
}

interface IMutationOptions {
  onSuccess?: () => void;
  onError?: (err: unknown) => void;
}

/**
 * Fetches active packing presets for form selects.
 * Supports an optional product_type filter for contextual selects.
 */
export function usePackingPresets(params: IListParams = {}) {
  const searchParams = new URLSearchParams();
  searchParams.set('is_active', String(params.is_active ?? true));
  searchParams.set('ordering', 'sort_order');
  searchParams.set('page_size', '200');
  if (params.product_type) searchParams.set('product_type', params.product_type);

  return useQuery({
    queryKey: [...QUERY_KEY, params],
    queryFn: async (): Promise<IPackingPreset[]> => {
      const { data } = await api.get<IApiListResponse<IPackingPreset>>(
        `/export/packing-presets/?${searchParams.toString()}`,
      );
      return data.results;
    },
    staleTime: 5 * 60_000, // 5 min — catalog changes rarely
  });
}

/**
 * Fetches ALL packing presets (including inactive) for the admin page.
 */
export function usePackingPresetsAll() {
  return useQuery({
    queryKey: [...QUERY_KEY, 'all'],
    queryFn: async (): Promise<IPackingPreset[]> => {
      const { data } = await api.get<IApiListResponse<IPackingPreset>>(
        '/export/packing-presets/?ordering=sort_order&page_size=200',
      );
      return data.results;
    },
    staleTime: 60_000,
  });
}

export function useCreatePackingPreset(options: IMutationOptions = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: IPackingPresetCreatePayload) =>
      api.post<IPackingPreset>('/export/packing-presets/', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      options.onSuccess?.();
    },
    onError: options.onError,
  });
}

export function useUpdatePackingPreset(options: IMutationOptions = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...payload }: IPackingPresetUpdatePayload & { id: number }) =>
      api.patch<IPackingPreset>(`/export/packing-presets/${id}/`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      options.onSuccess?.();
    },
    onError: options.onError,
  });
}

export function useDeletePackingPreset(options: IMutationOptions = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete(`/export/packing-presets/${id}/`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      options.onSuccess?.();
    },
    onError: options.onError,
  });
}
