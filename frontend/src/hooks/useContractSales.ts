import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import type { IApiListResponse } from '@/types';
import type {
  IContractSale,
  IContractSaleDetail,
  IContractSaleCreatePayload,
  IContractSaleUpdatePayload,
  ContractSaleStatus,
} from '@/types/contractSale';

// ─── Param types ─────────────────────────────────────────────────────────────

export interface IContractSaleFilters {
  contractId?: number;
  status?: ContractSaleStatus;
  exportFirm?: number;
  importFirm?: number;
  /** Inclusive lower bound on invoice_date, YYYY-MM-DD. */
  dateFrom?: string;
  /** Inclusive upper bound on invoice_date, YYYY-MM-DD. */
  dateTo?: string;
  /** Server-side icontains on passport_sdelka and contract_number. */
  search?: string;
  page?: number;
  pageSize?: number;
}

interface IContractSaleListResult {
  results: IContractSale[];
  count: number;
}

// ─── List ─────────────────────────────────────────────────────────────────────

export function useContractSales(params: IContractSaleFilters = {}) {
  return useQuery({
    queryKey: ['sales', 'list', params] as const,
    queryFn: async (): Promise<IContractSaleListResult> => {
      const p = new URLSearchParams();

      if (params.contractId) p.set('contract', String(params.contractId));
      if (params.status) p.set('status', params.status);
      if (params.exportFirm != null) p.set('export_firm', String(params.exportFirm));
      if (params.importFirm != null) p.set('import_firm', String(params.importFirm));
      if (params.dateFrom) p.set('date_from', params.dateFrom);
      if (params.dateTo) p.set('date_to', params.dateTo);
      if (params.search) p.set('search', params.search);
      if (params.page) p.set('page', String(params.page));
      if (params.pageSize) p.set('page_size', String(params.pageSize));

      const { data } = await api.get<IApiListResponse<IContractSale>>(
        `/contracts/sales/?${p.toString()}`,
      );
      return { results: data.results, count: data.count };
    },
    staleTime: 30_000,
    enabled: params.contractId !== undefined ? params.contractId > 0 : true,
  });
}

// ─── Detail ───────────────────────────────────────────────────────────────────

export function useContractSale(id: number) {
  return useQuery({
    queryKey: ['sales', 'detail', id] as const,
    queryFn: async (): Promise<IContractSaleDetail> => {
      const { data } = await api.get<IContractSaleDetail>(
        `/contracts/sales/${id}/`,
      );
      return data;
    },
    staleTime: 30_000,
    enabled: id > 0,
  });
}

// ─── Create ───────────────────────────────────────────────────────────────────

export function useCreateContractSale() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: IContractSaleCreatePayload): Promise<IContractSale> => {
      const { data } = await api.post<IContractSale>(
        '/contracts/sales/',
        payload,
      );
      return data;
    },
    onSuccess: () => {
      // Invalidate entire families — detail rollup changes on the parent contract
      queryClient.invalidateQueries({ queryKey: ['sales'] });
      queryClient.invalidateQueries({ queryKey: ['contracts'] });
    },
  });
}

// ─── Update (PATCH) ───────────────────────────────────────────────────────────

export function useUpdateContractSale() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      payload,
    }: {
      id: number;
      payload: IContractSaleUpdatePayload;
    }): Promise<IContractSale> => {
      const { data } = await api.patch<IContractSale>(
        `/contracts/sales/${id}/`,
        payload,
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sales'] });
      queryClient.invalidateQueries({ queryKey: ['contracts'] });
    },
  });
}

// ─── Delete ───────────────────────────────────────────────────────────────────

export function useDeleteContractSale() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number): Promise<void> => {
      await api.delete(`/contracts/sales/${id}/`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sales'] });
      queryClient.invalidateQueries({ queryKey: ['contracts'] });
    },
  });
}
