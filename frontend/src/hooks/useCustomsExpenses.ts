import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '@/services/api';
import { IDEMPOTENCY_HEADER, useIdempotencyKey } from '@/hooks/useIdempotencyKey';
import { getShipmentDetailKey } from './useShipmentDetail';
import { useSelectedSeason } from '@/hooks/useSeasonParam';
import type { IApiListResponse } from '@/types';
import type {
  ICustomsExpense,
  ICustomsExpenseCategoryOption,
  ICustomsExpenseCategoryPayload,
  ICustomsExpensePayload,
  ICustomsExpenseFilters,
  ICustomsLedger,
} from '@/types';

// ─── List ─────────────────────────────────────────────────────────────────────

export function useCustomsExpenses(filters: ICustomsExpenseFilters = {}): ReturnType<typeof useQuery<IApiListResponse<ICustomsExpense>>> {
  const { seasonId, isReady } = useSelectedSeason();
  return useQuery({
    queryKey: ['customs-expenses', seasonId, filters],
    queryFn: async (): Promise<IApiListResponse<ICustomsExpense>> => {
      const params = new URLSearchParams();
      if (filters.page) params.set('page', String(filters.page));
      if (filters.page_size) params.set('page_size', String(filters.page_size));
      if (filters.category) params.set('category', filters.category);
      if (filters.currency) params.set('currency', filters.currency);
      if (filters.shipment) params.set('shipment', String(filters.shipment));
      if (filters.date_from) params.set('date_from', filters.date_from);
      if (filters.date_to) params.set('date_to', filters.date_to);
      if (filters.search) params.set('search', filters.search);
      if (seasonId != null) params.set('season', String(seasonId));

      const { data } = await api.get<IApiListResponse<ICustomsExpense>>(
        `/export/customs-expenses/?${params.toString()}`,
      );
      return data;
    },
    enabled: isReady,
    staleTime: 30_000,
  });
}

// ─── Categories ───────────────────────────────────────────────────────────────

const CATEGORIES_KEY = ['customs-expense-categories'];

export function useCustomsExpenseCategories(): ReturnType<typeof useQuery<ICustomsExpenseCategoryOption[]>> {
  return useQuery({
    queryKey: CATEGORIES_KEY,
    queryFn: async (): Promise<ICustomsExpenseCategoryOption[]> => {
      const { data } = await api.get<IApiListResponse<ICustomsExpenseCategoryOption>>(
        '/export/customs-expense-categories/?page_size=200',
      );
      return data.results;
    },
    staleTime: 300_000,
  });
}

export function useCreateCustomsExpenseCategory(): ReturnType<typeof useMutation<ICustomsExpenseCategoryOption, Error, ICustomsExpenseCategoryPayload>> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: ICustomsExpenseCategoryPayload): Promise<ICustomsExpenseCategoryOption> => {
      const { data } = await api.post<ICustomsExpenseCategoryOption>(
        '/export/customs-expense-categories/',
        payload,
      );
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CATEGORIES_KEY });
    },
  });
}

/**
 * Returns `(code, fallback?) => label`: the category's own name in the current
 * language, falling back to the Turkmen name. Codes missing from the active list
 * (deactivated) use the old i18n key, then `fallback` (server category_display).
 */
export function useCustomsExpenseCategoryLabel(): (code: string, fallback?: string) => string {
  const { t, i18n } = useTranslation();
  const { data: categories = [] } = useCustomsExpenseCategories();
  return (code, fallback) => {
    const row = categories.find((c) => c.code === code);
    if (row) {
      const localized = i18n.language.startsWith('ru')
        ? row.label_ru
        : i18n.language.startsWith('en') ? row.label_en : null;
      return localized || row.label_tk;
    }
    const key = `customs_expense.category.${code}`;
    return i18n.exists(key) ? t(key) : (fallback ?? code);
  };
}

// ─── Ledger summary ────────────────────────────────────────────────────────────

interface ILedgerFilters {
  date_from?: string;
  date_to?: string;
}

export function useCustomsLedger(dateRange: ILedgerFilters = {}): ReturnType<typeof useQuery<ICustomsLedger>> {
  const { seasonId, isReady } = useSelectedSeason();
  return useQuery({
    queryKey: ['customs-ledger', seasonId, dateRange],
    queryFn: async (): Promise<ICustomsLedger> => {
      const params = new URLSearchParams();
      if (dateRange.date_from) params.set('date_from', dateRange.date_from);
      if (dateRange.date_to) params.set('date_to', dateRange.date_to);
      if (seasonId != null) params.set('season', String(seasonId));

      const { data } = await api.get<ICustomsLedger>(
        `/export/customs-expenses/ledger/?${params.toString()}`,
      );
      return data;
    },
    enabled: isReady,
    staleTime: 30_000,
  });
}

// ─── Create ───────────────────────────────────────────────────────────────────

export function useCreateCustomsExpense(): ReturnType<typeof useMutation<ICustomsExpense, Error, ICustomsExpensePayload>> {
  const queryClient = useQueryClient();
  const idem = useIdempotencyKey();
  return useMutation({
    mutationFn: async (payload: ICustomsExpensePayload): Promise<ICustomsExpense> => {
      const { data } = await api.post<ICustomsExpense>(
        '/export/customs-expenses/',
        payload,
        { headers: { [IDEMPOTENCY_HEADER]: idem.key } },
      );
      return data;
    },
    onSuccess: (data) => {
      idem.reset();
      void queryClient.invalidateQueries({ queryKey: ['customs-expenses'] });
      void queryClient.invalidateQueries({ queryKey: ['customs-ledger'] });
      if (data.shipment) {
        void queryClient.invalidateQueries({
          queryKey: getShipmentDetailKey(data.shipment),
        });
      }
    },
  });
}

// ─── Update ───────────────────────────────────────────────────────────────────

interface IUpdateCustomsExpenseVars {
  id: number;
  payload: Partial<ICustomsExpensePayload>;
}

export function useUpdateCustomsExpense(): ReturnType<typeof useMutation<ICustomsExpense, Error, IUpdateCustomsExpenseVars>> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, payload }: IUpdateCustomsExpenseVars): Promise<ICustomsExpense> => {
      const { data } = await api.patch<ICustomsExpense>(
        `/export/customs-expenses/${id}/`,
        payload,
      );
      return data;
    },
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['customs-expenses'] });
      void queryClient.invalidateQueries({ queryKey: ['customs-ledger'] });
      if (data.shipment) {
        void queryClient.invalidateQueries({
          queryKey: getShipmentDetailKey(data.shipment),
        });
      }
    },
  });
}

// ─── Delete ───────────────────────────────────────────────────────────────────

export function useDeleteCustomsExpense(): ReturnType<typeof useMutation<void, Error, number>> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number): Promise<void> => {
      await api.delete(`/export/customs-expenses/${id}/`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['customs-expenses'] });
      void queryClient.invalidateQueries({ queryKey: ['customs-ledger'] });
      // We can't know the shipment id after deletion, so invalidate all shipment details
      void queryClient.invalidateQueries({ queryKey: ['shipment'] });
    },
  });
}
