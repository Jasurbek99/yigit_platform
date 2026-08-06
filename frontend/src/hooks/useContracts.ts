import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import { useSelectedSeason } from '@/hooks/useSeasonParam';
import type { IApiListResponse } from '@/types';
import type {
  IContract,
  IContractAttachment,
  IContractDetail,
  IContractCreatePayload,
  ContractStatus,
} from '@/types/contract';

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
  const { seasonId, isReady } = useSelectedSeason();
  // `params.season` (an explicit caller override, unused by any current call
  // site) wins over the global switcher; otherwise default to it — the same
  // `?season=` param resolve_season() reads for scoping (Contract.season is
  // the SeasonScopedMixin-managed FK, not a plain filterset field).
  const effectiveSeason = params.season ?? seasonId;
  return useQuery({
    queryKey: ['contracts', 'list', effectiveSeason, params] as const,
    queryFn: async (): Promise<IApiListResponse<IContract>> => {
      const p = new URLSearchParams();

      if (params.includeEnded) p.set('include_ended', 'true');
      if (params.exportFirm) p.set('export_firm', String(params.exportFirm));
      if (params.importFirm) p.set('import_firm', String(params.importFirm));
      if (effectiveSeason != null) p.set('season', String(effectiveSeason));
      if (params.status) p.set('status', params.status);
      if (params.page) p.set('page', String(params.page));
      if (params.pageSize) p.set('page_size', String(params.pageSize));

      const { data } = await api.get<IApiListResponse<IContract>>(
        `/contracts/contracts/?${p.toString()}`,
      );
      return data;
    },
    staleTime: 30_000,
    enabled: isReady,
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

// ─── Attachments ────────────────────────────────────────────────────────────

/**
 * Browser-openable URL for an attachment. The auth cookie is httpOnly and
 * same-origin, so the browser sends it automatically — opening this URL in a
 * new tab previews the PDF inline.
 */
export function contractAttachmentUrl(contractId: number, attachmentId: number): string {
  return `${api.defaults.baseURL}/contracts/contracts/${contractId}/attachments/${attachmentId}/download/`;
}

export function useUploadContractAttachments(contractId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (files: File[]): Promise<IContractAttachment[]> => {
      const form = new FormData();
      files.forEach((f) => form.append('files', f));
      const { data } = await api.post<IContractAttachment[]>(
        `/contracts/contracts/${contractId}/attachments/`,
        form,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contracts', 'detail', contractId] });
    },
  });
}

export function useDeleteContractAttachment(contractId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (attachmentId: number): Promise<void> => {
      await api.delete(
        `/contracts/contracts/${contractId}/attachments/${attachmentId}/`,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contracts', 'detail', contractId] });
    },
  });
}
