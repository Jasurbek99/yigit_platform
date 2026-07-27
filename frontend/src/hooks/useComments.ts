import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import { MOCK_COMMENTS } from '@/mock/comments';
import { getShipmentDetailKey } from '@/hooks/useShipmentDetail';
import type { IShipmentComment } from '@/types';

const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true';

// ─── Filter interface ──────────────────────────────────────────────────────

interface ICommentListFilters {
  shipment?: number;
  field_key?: string;
  /** 'me' filters to current user's assigned tasks */
  assignee?: 'me' | number;
  is_done?: boolean;
  /** 'null' = root comments only */
  parent_comment?: 'null' | number;
}

// ─── List ──────────────────────────────────────────────────────────────────

export function useComments(filters: ICommentListFilters = {}) {
  return useQuery({
    queryKey: ['comments', filters],
    queryFn: async (): Promise<IShipmentComment[]> => {
      if (USE_MOCK) {
        let data = MOCK_COMMENTS;
        if (filters.field_key) {
          data = data.filter((c) => c.field_key === filters.field_key);
        }
        if (filters.parent_comment === 'null') {
          data = data.filter((c) => c.parent_comment === null);
        } else if (typeof filters.parent_comment === 'number') {
          data = data.filter((c) => c.parent_comment === filters.parent_comment);
        }
        if (filters.assignee === 'me') {
          data = data.filter((c) => c.assignee !== null && !c.is_done);
        }
        if (filters.is_done !== undefined) {
          data = data.filter((c) => c.is_done === filters.is_done);
        }
        return data;
      }

      const params: Record<string, string | number | boolean> = {};
      if (filters.shipment != null) params.shipment = filters.shipment;
      if (filters.field_key) params.field_key = filters.field_key;
      if (filters.assignee != null) params.assignee = filters.assignee;
      if (filters.is_done !== undefined) params.is_done = filters.is_done;
      if (filters.parent_comment != null) params.parent_comment = filters.parent_comment;

      const { data } = await api.get<{ results: IShipmentComment[] }>('/export/comments/', { params });
      return data.results;
    },
    enabled: USE_MOCK || filters.shipment != null,
    staleTime: 30_000,
  });
}

// ─── Create ────────────────────────────────────────────────────────────────

interface ICreateCommentPayload {
  shipment: number;
  content: string;
  field_key?: string | null;
  mentions?: number[];
  role_mentions?: string[];
  parent_comment?: number | null;
  assignee?: number | null;
}

export function useCreateComment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: ICreateCommentPayload) => {
      const { data } = await api.post<IShipmentComment>('/export/comments/', payload);
      return data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['comments'] });
      queryClient.invalidateQueries({ queryKey: ['shipments', 'sheet'] });
      // The Detail page's hero comment_count badge and per-field 💬 counts
      // (Task 9) come from the shipment-detail payload's nested `comments`
      // array, not from this ['comments'] query — without this, posting a
      // comment on Detail leaves both stale until the next full reload.
      // Scoped to the one shipment the comment was posted on (via
      // `variables.shipment`, available on every create payload) instead of
      // the bare `['shipment']` prefix, so posting a comment on one shipment
      // doesn't mark every other cached shipment-detail query stale too.
      queryClient.invalidateQueries({ queryKey: getShipmentDetailKey(variables.shipment) });
    },
  });
}

// ─── Update ────────────────────────────────────────────────────────────────

interface IUpdateCommentPayload {
  id: number;
  content: string;
}

export function useUpdateComment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, content }: IUpdateCommentPayload) => {
      const { data } = await api.patch<IShipmentComment>(`/export/comments/${id}/`, { content });
      return data;
    },
    onSuccess: () => {
      // Content-only edit — doesn't touch is_deleted/field_key, so it can't
      // change comment_count or the per-field counts; no ['shipment'] invalidation needed.
      queryClient.invalidateQueries({ queryKey: ['comments'] });
    },
  });
}

// ─── Delete ────────────────────────────────────────────────────────────────

export function useDeleteComment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/export/comments/${id}/`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['comments'] });
      queryClient.invalidateQueries({ queryKey: ['shipments', 'sheet'] });
      // Kept broad (bare ['shipment'] prefix): the delete payload is only the
      // comment id, with no shipment id to scope to. Narrowing this would
      // need a signature change (passing {id, shipment} instead of id) —
      // left as-is for this fix.
      queryClient.invalidateQueries({ queryKey: ['shipment'] });
    },
  });
}

// ─── Mark done ─────────────────────────────────────────────────────────────

export function useMarkTaskDone() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: number) => {
      const { data } = await api.post<IShipmentComment>(`/export/comments/${id}/done/`);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['comments'] });
      queryClient.invalidateQueries({ queryKey: ['shipments', 'sheet'] });
    },
  });
}

// ─── Reopen ────────────────────────────────────────────────────────────────

export function useReopenTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: number) => {
      const { data } = await api.post<IShipmentComment>(`/export/comments/${id}/reopen/`);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['comments'] });
      queryClient.invalidateQueries({ queryKey: ['shipments', 'sheet'] });
    },
  });
}
