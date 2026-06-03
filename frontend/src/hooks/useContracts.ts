import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import type { IApiListResponse } from '@/types';
import type { IContract, IContractDetail, IContractCreatePayload, ContractStatus } from '@/types/contract';

// ─── Param types ─────────────────────────────────────────────────────────────

export interface IContractFilters {
  includeEnded?: boolean;
  exportFirm?: number;
  importFirm?: number;
  season?: number;
  status?: ContractStatus;
  page?: number;
  pageSize?: number;
}

// ─── List ─────────────────────────────────────────────────────────────────────

export function useContracts(params: IContractFilters = {}) {
  return useQuery({
    queryKey: ['contracts', 'list', params] as const,
    queryFn: async (): Promise<IApiListResponse<IContract>> => {
      const p = new URLSearchParams();

      if (params.includeEnded) p.set('include_ended', 'true');
      if (params.exportFirm) p.set('export_firm', String(params.exportFirm));
      if (params.importFirm) p.set('import_firm', String(params.importFirm));
      if (params.season) p.set('season', String(params.season));
      if (params.status) p.set('status', params.status);
      if (params.page) p.set('page', String(params.page));
      if (params.pageSize) p.set('page_size', String(params.pageSize));

      const { data } = await api.get<IApiListResponse<IContract>>(
        `/contracts/contracts/?${p.toString()}`,
      );
      return data;
    },
    staleTime: 30_000,
  });
}

// ─── Detail ───────────────────────────────────────────────────────────────────

export function useContract(id: number) {
  return useQuery({
    queryKey: ['contracts', 'detail', id] as const,
    queryFn: async (): Promise<IContractDetail> => {
      const { data } = await api.get<IContractDetail>(
        `/contracts/contracts/${id}/`,
      );
      return data;
    },
    staleTime: 30_000,
    enabled: id > 0,
  });
}

// ─── Create ───────────────────────────────────────────────────────────────────

export function useCreateContract() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: IContractCreatePayload): Promise<IContractDetail> => {
      const { data } = await api.post<IContractDetail>(
        '/contracts/contracts/',
        payload,
      );
      return data;
    },
    onSuccess: () => {
      // Invalidate the entire contracts list family
      queryClient.invalidateQueries({ queryKey: ['contracts', 'list'] });
    },
  });
}
