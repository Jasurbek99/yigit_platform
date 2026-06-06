import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import type { IApiListResponse } from '@/types';
import type {
  IInvoice,
  IInvoiceDetail,
  IInvoiceCreatePayload,
  IInvoiceUpdatePayload,
  InvoiceStatus,
} from '@/types/invoice';

// ─── Param types ─────────────────────────────────────────────────────────────

export interface IInvoiceFilters {
  contractId?: number;
  status?: InvoiceStatus;
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

interface IInvoiceListResult {
  results: IInvoice[];
  count: number;
}

// ─── List ─────────────────────────────────────────────────────────────────────

export function useInvoices(params: IInvoiceFilters = {}) {
  return useQuery({
    queryKey: ['invoices', 'list', params] as const,
    queryFn: async (): Promise<IInvoiceListResult> => {
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

      const { data } = await api.get<IApiListResponse<IInvoice>>(
        `/contracts/invoices/?${p.toString()}`,
      );
      return { results: data.results, count: data.count };
    },
    staleTime: 30_000,
    enabled: params.contractId !== undefined ? params.contractId > 0 : true,
  });
}

// ─── Detail ───────────────────────────────────────────────────────────────────

export function useInvoice(id: number) {
  return useQuery({
    queryKey: ['invoices', 'detail', id] as const,
    queryFn: async (): Promise<IInvoiceDetail> => {
      const { data } = await api.get<IInvoiceDetail>(
        `/contracts/invoices/${id}/`,
      );
      return data;
    },
    staleTime: 30_000,
    enabled: id > 0,
  });
}

// ─── Create ───────────────────────────────────────────────────────────────────

export function useCreateInvoice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: IInvoiceCreatePayload): Promise<IInvoice> => {
      const { data } = await api.post<IInvoice>(
        '/contracts/invoices/',
        payload,
      );
      return data;
    },
    onSuccess: () => {
      // Invalidate entire families — detail rollup changes on the parent contract
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['contracts'] });
    },
  });
}

// ─── Update (PATCH) ───────────────────────────────────────────────────────────

export function useUpdateInvoice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      payload,
    }: {
      id: number;
      payload: IInvoiceUpdatePayload;
    }): Promise<IInvoice> => {
      const { data } = await api.patch<IInvoice>(
        `/contracts/invoices/${id}/`,
        payload,
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['contracts'] });
    },
  });
}

// ─── Delete ───────────────────────────────────────────────────────────────────

export function useDeleteInvoice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number): Promise<void> => {
      await api.delete(`/contracts/invoices/${id}/`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['contracts'] });
    },
  });
}
