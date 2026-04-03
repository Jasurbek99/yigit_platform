import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import type {
  ISeason,
  IExportFirm,
  IAdminUser,
  IApiListResponse,
  IGreenhouseBlock,
  IBlockAssignment,
  UserRole,
} from '@/types';

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

// ─── Greenhouse Blocks ────────────────────────────────────────────────────

export function useGreenhouseBlocks() {
  return useQuery({
    queryKey: ['admin-blocks'],
    queryFn: async (): Promise<IGreenhouseBlock[]> => {
      if (USE_MOCK) return [];
      const { data } = await api.get<IApiListResponse<IGreenhouseBlock> | IGreenhouseBlock[]>(
        '/core/blocks/',
      );
      return Array.isArray(data) ? data : data.results;
    },
    staleTime: 300_000,
  });
}

// ─── Block Assignments ────────────────────────────────────────────────────

export function useBlockAssignments(userId?: number) {
  return useQuery({
    queryKey: ['admin-block-assignments', userId],
    queryFn: async (): Promise<IBlockAssignment[]> => {
      if (USE_MOCK) return [];
      const url = userId
        ? `/export/admin/block-assignments/?user=${userId}`
        : '/export/admin/block-assignments/';
      const { data } = await api.get<IApiListResponse<IBlockAssignment> | IBlockAssignment[]>(url);
      return Array.isArray(data) ? data : data.results;
    },
    staleTime: 60_000,
  });
}

export function useCreateBlockAssignment(options: MutationOptions = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { user: number; block: number }) =>
      api.post<IBlockAssignment>('/export/admin/block-assignments/', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-block-assignments'] });
      options.onSuccess?.();
    },
    onError: options.onError,
  });
}

export function useDeleteBlockAssignment(options: MutationOptions = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete(`/export/admin/block-assignments/${id}/`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-block-assignments'] });
      options.onSuccess?.();
    },
    onError: options.onError,
  });
}

// ─── User Permissions ─────────────────────────────────────────────────────

export function useUpdateUserPermissions(options: MutationOptions = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { id: number; permissions: string[] }) => {
      if (USE_MOCK) return;
      await api.put(`/export/admin/users/${payload.id}/permissions/`, {
        permissions: payload.permissions,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      options.onSuccess?.();
    },
    onError: options.onError,
  });
}

// ─── Superuser-only mutations ─────────────────────────────────────────────

interface ICreateUserPayload {
  username: string;
  password: string;
  role: UserRole;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  is_active?: boolean;
}

export function useCreateUser(options: MutationOptions = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: ICreateUserPayload): Promise<IAdminUser> => {
      if (USE_MOCK) return Promise.resolve({ id: 0, username: payload.username, first_name: payload.first_name ?? '', last_name: payload.last_name ?? '', email: payload.email ?? '', phone: payload.phone ?? null, role: payload.role, is_active: payload.is_active ?? true });
      const { data } = await api.post<IAdminUser>('/export/admin/users/', payload);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      options.onSuccess?.();
    },
    onError: options.onError,
  });
}

export function useDeleteUser(options: MutationOptions = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number): Promise<void> => {
      if (USE_MOCK) return Promise.resolve();
      await api.delete(`/export/admin/users/${id}/`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      options.onSuccess?.();
    },
    onError: options.onError,
  });
}

export function useSetUserPassword(options: MutationOptions = {}) {
  return useMutation({
    mutationFn: async (payload: { id: number; password: string }): Promise<void> => {
      if (USE_MOCK) return Promise.resolve();
      await api.post(`/export/admin/users/${payload.id}/set-password/`, {
        password: payload.password,
      });
    },
    onSuccess: options.onSuccess,
    onError: options.onError,
  });
}
