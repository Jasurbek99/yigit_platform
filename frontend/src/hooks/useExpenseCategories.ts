import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import type { IExpenseCategory, IApiListResponse } from '@/types';

const QUERY_KEY = ['expense-categories'] as const;

interface IMutationOptions {
  onSuccess?: () => void;
  onError?: (err: unknown) => void;
}

/**
 * Fetches active expense categories for the sales report form.
 * GET /api/v1/export/expense-categories/?is_active=true&ordering=sort_order
 * Returns only active categories, ordered by sort_order.
 */
export function useExpenseCategories() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: async (): Promise<IExpenseCategory[]> => {
      const { data } = await api.get<IApiListResponse<IExpenseCategory>>(
        '/export/expense-categories/?is_active=true&ordering=sort_order&page_size=100',
      );
      return data.results;
    },
    staleTime: 5 * 60_000, // 5 min — template changes rarely
  });
}

/**
 * Fetches ALL expense categories (including inactive) for the admin management screen.
 * GET /api/v1/export/expense-categories/?ordering=sort_order
 */
export function useExpenseCategoriesAll() {
  return useQuery({
    queryKey: [...QUERY_KEY, 'all'],
    queryFn: async (): Promise<IExpenseCategory[]> => {
      const { data } = await api.get<IApiListResponse<IExpenseCategory>>(
        '/export/expense-categories/?ordering=sort_order&page_size=200',
      );
      return data.results;
    },
    staleTime: 60_000,
  });
}

interface ICreateExpenseCategoryPayload {
  code: string;
  name_tk: string;
  name_ru: string;
  name_en: string;
  logo_code?: string | null;
  sort_order?: number;
  is_active?: boolean;
}

interface IUpdateExpenseCategoryPayload {
  id: number;
  name_tk?: string;
  name_ru?: string;
  name_en?: string;
  logo_code?: string | null;
  sort_order?: number;
  is_active?: boolean;
}

export function useCreateExpenseCategory(options: IMutationOptions = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: ICreateExpenseCategoryPayload) =>
      api.post<IExpenseCategory>('/export/expense-categories/', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      options.onSuccess?.();
    },
    onError: options.onError,
  });
}

export function useUpdateExpenseCategory(options: IMutationOptions = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...payload }: IUpdateExpenseCategoryPayload) =>
      api.patch<IExpenseCategory>(`/export/expense-categories/${id}/`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      options.onSuccess?.();
    },
    onError: options.onError,
  });
}

export function useDeleteExpenseCategory(options: IMutationOptions = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete(`/export/expense-categories/${id}/`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      options.onSuccess?.();
    },
    onError: options.onError,
  });
}
