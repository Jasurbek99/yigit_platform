import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import type { ISeason, IExportFirm, IAdminUser, IApiListResponse } from '@/types';

const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true';

// ─── Seasons ─────────────────────────────────────────────────────────────

export function useSeasons() {
  return useQuery({
    queryKey: ['admin-seasons'],
    queryFn: async (): Promise<ISeason[]> => {
      if (USE_MOCK) return [];
      const { data } = await api.get<IApiListResponse<ISeason> | ISeason[]>(
        '/export/admin/seasons/',
      );
      return Array.isArray(data) ? data : data.results;
    },
    staleTime: 60_000,
  });
}

interface MutationOptions {
  onSuccess?: () => void;
  onError?: (err: unknown) => void;
}

export function useCreateSeason(options: MutationOptions = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: Omit<ISeason, 'id'>) =>
      api.post<ISeason>('/export/admin/seasons/', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-seasons'] });
      options.onSuccess?.();
    },
    onError: options.onError,
  });
}

export function useUpdateSeason(options: MutationOptions = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...payload }: Partial<ISeason> & { id: number }) =>
      api.patch<ISeason>(`/export/admin/seasons/${id}/`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-seasons'] });
      options.onSuccess?.();
    },
    onError: options.onError,
  });
}

export function useDeleteSeason(options: MutationOptions = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete(`/export/admin/seasons/${id}/`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-seasons'] });
      options.onSuccess?.();
    },
    onError: options.onError,
  });
}

// ─── Export Firms ─────────────────────────────────────────────────────────

export function useAdminFirms() {
  return useQuery({
    queryKey: ['admin-firms'],
    queryFn: async (): Promise<IExportFirm[]> => {
      if (USE_MOCK) return [];
      const { data } = await api.get<IApiListResponse<IExportFirm> | IExportFirm[]>(
        '/export/admin/firms/',
      );
      return Array.isArray(data) ? data : data.results;
    },
    staleTime: 60_000,
  });
}

export function useCreateFirm(options: MutationOptions = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: Omit<IExportFirm, 'id'>) =>
      api.post<IExportFirm>('/export/admin/firms/', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-firms'] });
      options.onSuccess?.();
    },
    onError: options.onError,
  });
}

export function useUpdateFirm(options: MutationOptions = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...payload }: Partial<IExportFirm> & { id: number }) =>
      api.patch<IExportFirm>(`/export/admin/firms/${id}/`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-firms'] });
      options.onSuccess?.();
    },
    onError: options.onError,
  });
}

// ─── Users ────────────────────────────────────────────────────────────────

export function useAdminUsers() {
  return useQuery({
    queryKey: ['admin-users'],
    queryFn: async (): Promise<IAdminUser[]> => {
      if (USE_MOCK) return [];
      const { data } = await api.get<IApiListResponse<IAdminUser> | IAdminUser[]>(
        '/export/admin/users/',
      );
      return Array.isArray(data) ? data : data.results;
    },
    staleTime: 60_000,
  });
}

export function useUpdateUserRole(options: MutationOptions = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      role,
      is_active,
    }: {
      id: number;
      role?: IAdminUser['role'];
      is_active?: boolean;
    }) => api.patch<IAdminUser>(`/export/admin/users/${id}/`, { role, is_active }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      options.onSuccess?.();
    },
    onError: options.onError,
  });
}
