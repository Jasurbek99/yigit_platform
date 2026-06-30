import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import { SHEET_QUERY_KEY } from '@/hooks/useShipmentSheet';
import {
  MOCK_ADVANCES_RESPONSE,
  MOCK_ADVANCE_DETAILS,
} from '@/mock/advances';
import type {
  IApiListResponse,
  IFinansistAdvanceListItem,
  IFinansistAdvanceDetail,
} from '@/types';

const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true';

/**
 * DRF serializes DecimalField as a string ("35640.00"). The UI types these as
 * `number` and does arithmetic (sum, `>` comparisons) + `.toLocaleString()` on
 * them, so coerce the money fields once here — otherwise `sum + total_amount`
 * concatenates strings and the summary cards show glued-together digits.
 */
function normalizeAdvance(
  item: IFinansistAdvanceListItem,
): IFinansistAdvanceListItem {
  return {
    ...item,
    total_amount: Number(item.total_amount ?? 0),
    allocated_total: Number(item.allocated_total ?? 0),
  };
}

export interface IAdvanceFilters {
  page?: number;
  page_size?: number;
  reconciled?: boolean;
  search?: string;
}

export function useAdvances(filters: IAdvanceFilters = {}) {
  return useQuery({
    queryKey: ['advances', filters],
    queryFn: async (): Promise<IApiListResponse<IFinansistAdvanceListItem>> => {
      if (USE_MOCK) {
        const results =
          filters.reconciled === undefined
            ? MOCK_ADVANCES_RESPONSE.results
            : MOCK_ADVANCES_RESPONSE.results.filter(
                (a) => a.reconciled === filters.reconciled,
              );
        return { ...MOCK_ADVANCES_RESPONSE, results, count: results.length };
      }

      const params = new URLSearchParams();
      if (filters.page) params.set('page', String(filters.page));
      if (filters.page_size) params.set('page_size', String(filters.page_size));
      if (filters.reconciled !== undefined)
        params.set('reconciled', String(filters.reconciled));
      if (filters.search) params.set('search', filters.search);

      const { data } = await api.get<IApiListResponse<IFinansistAdvanceListItem>>(
        `/export/advances/?${params.toString()}`,
      );
      return { ...data, results: data.results.map(normalizeAdvance) };
    },
    staleTime: 30_000,
  });
}

export function useAdvanceDetail(id: number) {
  return useQuery({
    queryKey: ['advances', id],
    queryFn: async (): Promise<IFinansistAdvanceDetail> => {
      if (USE_MOCK) {
        const detail = MOCK_ADVANCE_DETAILS[id];
        if (!detail) throw new Error(`Advance ${id} not found`);
        return detail;
      }
      const { data } = await api.get<IFinansistAdvanceDetail>(
        `/export/advances/${id}/`,
      );
      return data;
    },
    staleTime: 30_000,
  });
}

export function useReconcileAdvance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number): Promise<IFinansistAdvanceDetail> => {
      const { data } = await api.patch<IFinansistAdvanceDetail>(
        `/export/advances/${id}/reconcile/`,
      );
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['advances'] });
      queryClient.setQueryData(['advances', data.id], data);
    },
  });
}

export interface ICreateAdvancePayload {
  batch_code?: string | null;
  advance_date: string;
  total_amount: number;
  currency: string;
  purpose?: string | null;
  notes?: string | null;
  shipment_ids?: number[];
}

export function useCreateAdvance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      payload: ICreateAdvancePayload,
    ): Promise<IFinansistAdvanceDetail> => {
      const { data } = await api.post<IFinansistAdvanceDetail>(
        '/export/advances/',
        payload,
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['advances'] });
      // Linked shipments flip the Sheet's R24 "Resminama pul berildi" cell.
      queryClient.invalidateQueries({ queryKey: SHEET_QUERY_KEY });
    },
  });
}

export interface ILinkShipmentPayload {
  advanceId: number;
  shipment_id: number;
  allocated_amount?: number | null;
}

export function useLinkShipmentToAdvance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      advanceId,
      shipment_id,
      allocated_amount,
    }: ILinkShipmentPayload): Promise<IFinansistAdvanceDetail> => {
      const { data } = await api.post<IFinansistAdvanceDetail>(
        `/export/advances/${advanceId}/link-shipment/`,
        { shipment_id, allocated_amount: allocated_amount ?? null },
      );
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['advances'] });
      queryClient.setQueryData(['advances', data.id], data);
      // A new link flips the Sheet's R24 "Resminama pul berildi" cell to ✓.
      queryClient.invalidateQueries({ queryKey: SHEET_QUERY_KEY });
    },
  });
}

export function useUnlinkShipmentFromAdvance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      advanceId,
      shipmentId,
    }: {
      advanceId: number;
      shipmentId: number;
    }): Promise<IFinansistAdvanceDetail> => {
      const { data } = await api.delete<IFinansistAdvanceDetail>(
        `/export/advances/${advanceId}/unlink-shipment/${shipmentId}/`,
      );
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['advances'] });
      queryClient.setQueryData(['advances', data.id], data);
      // Removing the last link flips the Sheet's R24 cell back to ✗.
      queryClient.invalidateQueries({ queryKey: SHEET_QUERY_KEY });
    },
  });
}
