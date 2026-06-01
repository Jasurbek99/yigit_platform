import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import { MOCK_SHIPMENTS_RESPONSE } from '@/mock/shipments';
import type { IApiListResponse, ICancelShipmentResponse, IShipmentListItem } from '@/types';

const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true';

export interface IShipmentFilters {
  page?: number;
  page_size?: number;
  status?: number;
  country?: number;
  customer?: number;
  export_firm?: number;
  phase?: string;
  my_work?: boolean;
  pending_my_fields?: boolean;
  search?: string;
  /** Inclusive lower bound, ISO date YYYY-MM-DD. */
  date_after?: string;
  /** Inclusive upper bound, ISO date YYYY-MM-DD. */
  date_before?: string;
  /**
   * Phase 3 archive view (ADR-0005). Default (undefined / false) returns
   * operational shipments only — is_archived=False rows.
   * `true` returns is_archived=True rows; the backend gates this to
   * admin / director / export_manager / finansist / boss. Other roles
   * silently get an empty page.
   */
  archived?: boolean;
  /**
   * Phase 4a stuck dashboard. `true` returns operational, not-yet-closed
   * shipments untouched for ≥4 days, oldest first. Backend gates to
   * admin / director / boss; other roles silently get an empty page.
   */
  stuck?: boolean;
  /**
   * When `true`, include cancelled shipments in the results.
   * Default (undefined / false) excludes the `cancelled` status so the
   * active list stays uncluttered. The user must explicitly enable this
   * filter to see cancelled records.
   *
   * NOTE: the backend does not yet have a dedicated `show_cancelled` param.
   * This flag maps to `?show_cancelled=true` which the backend should
   * implement to exclude status__code='cancelled' by default.  Until that
   * backend param lands, a `?phase=CANCELLED` workaround is used
   * client-side to show only cancelled when the user requests it, and
   * nothing is sent for the default-exclude case (the backend already
   * excludes CANCELLED from operational views). Track as a follow-up.
   */
  show_cancelled?: boolean;
  /**
   * Admin-only soft-delete view. `true` returns ONLY soft-deleted shipments
   * (deleted_at IS NOT NULL) so admins can find and restore them. Backend
   * gates this to admin / superuser; other roles silently get an empty page.
   * Default (undefined / false) excludes soft-deleted rows from every list.
   */
  show_deleted?: boolean;
}

export function useShipments(filters: IShipmentFilters = {}) {
  return useQuery({
    queryKey: ['shipments', filters],
    queryFn: async (): Promise<IApiListResponse<IShipmentListItem>> => {
      if (USE_MOCK) return MOCK_SHIPMENTS_RESPONSE;

      const params = new URLSearchParams();
      if (filters.page) params.set('page', String(filters.page));
      if (filters.page_size) params.set('page_size', String(filters.page_size));
      if (filters.status) params.set('status', String(filters.status));
      if (filters.country) params.set('country', String(filters.country));
      if (filters.customer) params.set('customer', String(filters.customer));
      if (filters.export_firm) params.set('export_firm', String(filters.export_firm));
      if (filters.phase) params.set('phase', filters.phase);
      if (filters.my_work) params.set('my_work', 'true');
      if (filters.pending_my_fields) params.set('pending_my_fields', 'true');
      if (filters.search) params.set('search', filters.search);
      if (filters.date_after) params.set('date_after', filters.date_after);
      if (filters.date_before) params.set('date_before', filters.date_before);
      if (filters.archived) params.set('archived', 'true');
      if (filters.stuck) params.set('stuck', 'true');
      if (filters.show_cancelled) params.set('show_cancelled', 'true');
      if (filters.show_deleted) params.set('show_deleted', 'true');

      const { data } = await api.get<IApiListResponse<IShipmentListItem>>(
        `/export/shipments/?${params.toString()}`,
      );
      return data;
    },
    staleTime: 30_000,
  });
}

interface ICancelVariables {
  id: number;
  reason: string;
}

/**
 * Mutation: POST /api/v1/export/shipments/{id}/cancel/
 * Restricted to export_manager and director roles (server enforces this;
 * the frontend hides the button for other roles but does not rely solely
 * on the client-side gate for security).
 */
export function useCancelShipment() {
  const queryClient = useQueryClient();

  return useMutation<ICancelShipmentResponse, unknown, ICancelVariables>({
    mutationFn: async ({ id, reason }) => {
      const { data } = await api.post<ICancelShipmentResponse>(
        `/export/shipments/${id}/cancel/`,
        { reason },
      );
      return data;
    },
    onSuccess: () => {
      // Invalidate all shipment-related queries so the detail page,
      // list view, board, sheet, and task inbox all reflect the new status.
      queryClient.invalidateQueries({ queryKey: ['shipment'] });
      queryClient.invalidateQueries({ queryKey: ['shipments'] });
      queryClient.invalidateQueries({ queryKey: ['my-tasks'] });
    },
  });
}

/**
 * Mutation: POST /api/v1/export/shipments/{id}/soft-delete/
 * Admin-only "trash" flag — distinct from cancel (which writes a lifecycle
 * transition + reason). Soft-deleted rows are hidden from every list/sheet
 * but kept in the DB; admins can list them via show_deleted=true and restore.
 */
export function useSoftDeleteShipment() {
  const queryClient = useQueryClient();

  return useMutation<unknown, unknown, { id: number }>({
    mutationFn: async ({ id }) => {
      const { data } = await api.post(`/export/shipments/${id}/soft-delete/`);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shipment'] });
      queryClient.invalidateQueries({ queryKey: ['shipments'] });
      queryClient.invalidateQueries({ queryKey: ['shipments', 'sheet'] });
    },
  });
}

/** Mutation: POST /api/v1/export/shipments/{id}/restore/ — admin only. */
export function useRestoreShipment() {
  const queryClient = useQueryClient();

  return useMutation<unknown, unknown, { id: number }>({
    mutationFn: async ({ id }) => {
      const { data } = await api.post(`/export/shipments/${id}/restore/`);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shipment'] });
      queryClient.invalidateQueries({ queryKey: ['shipments'] });
      queryClient.invalidateQueries({ queryKey: ['shipments', 'sheet'] });
    },
  });
}

export function useMyPendingCount() {
  return useQuery({
    queryKey: ['shipments', 'my_pending_count'],
    queryFn: async (): Promise<number> => {
      if (USE_MOCK) return 0;
      const { data } = await api.get<{ count: number }>('/export/shipments/my-pending-count/');
      return data.count;
    },
    refetchInterval: 30_000,
    staleTime: 30_000,
  });
}
