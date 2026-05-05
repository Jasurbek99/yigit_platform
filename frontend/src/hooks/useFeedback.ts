import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import { useAuth } from '@/hooks/useAuth';
import type {
  IFeedbackTicket,
  IFeedbackTicketDetail,
  IFeedbackTicketCreate,
  IFeedbackReplyCreate,
  IFeedbackFilters,
  IApiListResponse,
} from '@/types';

// ─── Query key factory ────────────────────────────────────────────────────────

const feedbackKeys = {
  all: ['feedback'] as const,
  tickets: (filters: IFeedbackFilters) => ['feedback', 'tickets', filters] as const,
  ticket: (id: number) => ['feedback', 'ticket', id] as const,
  adminUnread: ['feedback', 'admin', 'unread_count'] as const,
};

// ─── List ─────────────────────────────────────────────────────────────────────

export function useFeedbackTickets(filters: IFeedbackFilters = {}) {
  return useQuery({
    queryKey: feedbackKeys.tickets(filters),
    queryFn: async (): Promise<IApiListResponse<IFeedbackTicket>> => {
      const params: Record<string, string> = {};
      if (filters.scope) params.scope = filters.scope;
      if (filters.status) params.status = filters.status;
      if (filters.category) params.category = filters.category;
      if (filters.author) params.author = String(filters.author);
      if (filters.search) params.search = filters.search;
      if (filters.date_from) params.date_from = filters.date_from;
      if (filters.date_to) params.date_to = filters.date_to;
      if (filters.page && filters.page > 1) params.page = String(filters.page);
      const { data } = await api.get<IApiListResponse<IFeedbackTicket>>(
        '/feedback/tickets/',
        { params },
      );
      return data;
    },
  });
}

// ─── Detail ──────────────────────────────────────────────────────────────────

export function useFeedbackTicketDetail(id: number | null) {
  return useQuery({
    queryKey: feedbackKeys.ticket(id ?? 0),
    queryFn: async (): Promise<IFeedbackTicketDetail> => {
      const { data } = await api.get<IFeedbackTicketDetail>(
        `/feedback/tickets/${id}/`,
      );
      return data;
    },
    enabled: !!id,
  });
}

// ─── Create ticket ────────────────────────────────────────────────────────────

export function useCreateFeedbackTicket() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: IFeedbackTicketCreate): Promise<IFeedbackTicketDetail> => {
      const formData = new FormData();
      formData.append('category', payload.category);
      formData.append('title', payload.title);
      formData.append('description', payload.description);
      formData.append('submitted_from_path', payload.submitted_from_path);
      formData.append('user_agent', payload.user_agent);
      for (const file of payload.attachments) {
        formData.append('attachments', file);
      }
      const { data } = await api.post<IFeedbackTicketDetail>(
        '/feedback/tickets/',
        formData,
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: feedbackKeys.all });
    },
  });
}

// ─── Reply to ticket ─────────────────────────────────────────────────────────

export function useReplyToTicket(ticketId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: IFeedbackReplyCreate) => {
      const formData = new FormData();
      formData.append('content', payload.content);
      formData.append('mode', payload.mode);
      for (const file of payload.attachments) {
        formData.append('attachments', file);
      }
      const { data } = await api.post(
        `/feedback/tickets/${ticketId}/reply/`,
        formData,
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: feedbackKeys.all });
    },
  });
}

// ─── Update ticket status (admin) ─────────────────────────────────────────────

export function useUpdateTicketStatus(ticketId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (status: string) => {
      const { data } = await api.patch(`/feedback/tickets/${ticketId}/`, { status });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: feedbackKeys.all });
    },
  });
}

// ─── Reopen ticket (author) ───────────────────────────────────────────────────

export function useReopenTicket(ticketId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data } = await api.post(`/feedback/tickets/${ticketId}/reopen/`);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: feedbackKeys.all });
    },
  });
}

// ─── Admin unread count ────────────────────────────────────────────────────────

export function useFeedbackAdminUnreadCount() {
  const { user } = useAuth();
  return useQuery({
    queryKey: feedbackKeys.adminUnread,
    queryFn: async (): Promise<number> => {
      const { data } = await api.get<{ count: number }>(
        '/feedback/tickets/admin_unread_count/',
      );
      return data.count;
    },
    refetchInterval: 60_000,
    staleTime: 60_000,
    enabled: user?.role === 'admin',
  });
}
