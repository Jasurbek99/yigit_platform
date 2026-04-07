import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import type {
  ISeason,
  ICity,
  ICountry,
  IExportFirm,
  IImportFirm,
  IAdminUser,
  IApiListResponse,
  IGreenhouseBlock,
  IBlockAssignment,
  ILoadingLocation,
  ITomatoVariety,
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

export function useExportFirm(id: number | undefined) {
  return useQuery({
    queryKey: ['admin-firm', id],
    queryFn: async (): Promise<IExportFirm> => {
      const { data } = await api.get<IExportFirm>(`/export/admin/firms/${id}/`);
      return data;
    },
    enabled: id !== undefined,
    staleTime: 30_000,
  });
}

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
      queryClient.invalidateQueries({ queryKey: ['admin-firm'] });
      options.onSuccess?.();
    },
    onError: options.onError,
  });
}

export function useDeleteExportFirm(options: MutationOptions = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete(`/export/admin/firms/${id}/`),
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
    queryKey: ['core-blocks'],
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

export function useAdminBlocks() {
  return useQuery({
    queryKey: ['admin-blocks-full'],
    queryFn: async (): Promise<IGreenhouseBlock[]> => {
      if (USE_MOCK) return [];
      const { data } = await api.get<IApiListResponse<IGreenhouseBlock> | IGreenhouseBlock[]>(
        '/export/admin/blocks/',
      );
      return Array.isArray(data) ? data : data.results;
    },
    staleTime: 60_000,
  });
}

export function useAdminBlock(id: number | undefined) {
  return useQuery({
    queryKey: ['admin-block', id],
    queryFn: async (): Promise<IGreenhouseBlock> => {
      const { data } = await api.get<IGreenhouseBlock>(`/export/admin/blocks/${id}/`);
      return data;
    },
    enabled: id !== undefined,
    staleTime: 60_000,
  });
}

export function useCreateBlock(options: MutationOptions = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: Omit<IGreenhouseBlock, 'id' | 'manager_name'>) =>
      api.post<IGreenhouseBlock>('/export/admin/blocks/', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-blocks-full'] });
      queryClient.invalidateQueries({ queryKey: ['core-blocks'] });
      options.onSuccess?.();
    },
    onError: options.onError,
  });
}

export function useUpdateBlock(options: MutationOptions = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...payload }: Partial<IGreenhouseBlock> & { id: number }) =>
      api.patch<IGreenhouseBlock>(`/export/admin/blocks/${id}/`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-blocks-full'] });
      queryClient.invalidateQueries({ queryKey: ['core-blocks'] });
      options.onSuccess?.();
    },
    onError: options.onError,
  });
}

// ─── Loading Locations ────────────────────────────────────────────────────

export function useLoadingLocations() {
  return useQuery({
    queryKey: ['loading-locations'],
    queryFn: async (): Promise<ILoadingLocation[]> => {
      if (USE_MOCK) return [];
      const { data } = await api.get<IApiListResponse<ILoadingLocation> | ILoadingLocation[]>(
        '/core/loading-locations/',
      );
      return Array.isArray(data) ? data : data.results;
    },
    staleTime: 300_000,
  });
}

// ─── Tomato Varieties ─────────────────────────────────────────────────────

export function useTomatoVarieties() {
  return useQuery({
    queryKey: ['tomato-varieties'],
    queryFn: async (): Promise<ITomatoVariety[]> => {
      if (USE_MOCK) return [];
      const { data } = await api.get<IApiListResponse<ITomatoVariety> | ITomatoVariety[]>(
        '/core/tomato-varieties/',
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

// ─── Countries (read-only reference) ─────────────────────────────────────

export function useCountries() {
  return useQuery({
    queryKey: ['core-countries'],
    queryFn: async (): Promise<ICountry[]> => {
      if (USE_MOCK) return [];
      const { data } = await api.get<IApiListResponse<ICountry> | ICountry[]>(
        '/core/countries/?page_size=200',
      );
      return Array.isArray(data) ? data : data.results;
    },
    staleTime: 300_000,
  });
}

// ─── Cities (read-only reference) ────────────────────────────────────────

export function useCities(countryId?: number | null) {
  return useQuery({
    queryKey: ['core-cities', countryId],
    queryFn: async (): Promise<ICity[]> => {
      if (USE_MOCK) return [];
      const url = countryId
        ? `/core/cities/?country=${countryId}&page_size=500`
        : '/core/cities/?page_size=500';
      const { data } = await api.get<IApiListResponse<ICity> | ICity[]>(url);
      return Array.isArray(data) ? data : data.results;
    },
    staleTime: 300_000,
  });
}

export function useCreateCountry(options: MutationOptions = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { name_tk: string; name_ru?: string; name_en?: string; code?: string }) =>
      api.post<ICountry>('/core/countries/', payload).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['core-countries'] });
      options.onSuccess?.();
    },
    onError: options.onError,
  });
}

export function useCreateCity(options: MutationOptions = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { name: string; country: number; name_local?: string }) =>
      api.post<ICity>('/core/cities/', payload).then(r => r.data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['core-cities', data.country] });
      queryClient.invalidateQueries({ queryKey: ['core-cities', null] });
      options.onSuccess?.();
    },
    onError: options.onError,
  });
}

// ─── Import Firms ─────────────────────────────────────────────────────────

export function useImportFirm(id: number | undefined) {
  return useQuery({
    queryKey: ['admin-import-firm', id],
    queryFn: async (): Promise<IImportFirm> => {
      const { data } = await api.get<IImportFirm>(`/export/admin/import-firms/${id}/`);
      return data;
    },
    enabled: id !== undefined,
    staleTime: 30_000,
  });
}

export function useAdminImportFirms() {
  return useQuery({
    queryKey: ['admin-import-firms'],
    queryFn: async (): Promise<IImportFirm[]> => {
      if (USE_MOCK) return [];
      const { data } = await api.get<IApiListResponse<IImportFirm> | IImportFirm[]>(
        '/export/admin/import-firms/',
      );
      return Array.isArray(data) ? data : data.results;
    },
    staleTime: 60_000,
  });
}

type ImportFirmPayload = Omit<IImportFirm, 'id' | 'country_name' | 'city_name' | 'director_signature' | 'director_seal'>;

function buildImportFirmBody(
  payload: ImportFirmPayload,
  signatureFile?: File | null,
  sealFile?: File | null,
): FormData | ImportFirmPayload {
  if (!signatureFile && !sealFile) return payload;
  const fd = new FormData();
  Object.entries(payload).forEach(([k, v]) => { if (v != null) fd.append(k, String(v)); });
  if (signatureFile) fd.append('director_signature', signatureFile);
  if (sealFile) fd.append('director_seal', sealFile);
  return fd;
}

export function useCreateImportFirm(options: MutationOptions = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ signatureFile, sealFile, ...payload }: ImportFirmPayload & { signatureFile?: File | null; sealFile?: File | null }) =>
      api.post<IImportFirm>('/export/admin/import-firms/', buildImportFirmBody(payload, signatureFile, sealFile)).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-import-firms'] });
      options.onSuccess?.();
    },
    onError: options.onError,
  });
}

export function useUpdateImportFirm(options: MutationOptions = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, signatureFile, sealFile, ...payload }: { id: number; signatureFile?: File | null; sealFile?: File | null } & ImportFirmPayload) =>
      api.patch<IImportFirm>(`/export/admin/import-firms/${id}/`, buildImportFirmBody(payload, signatureFile, sealFile)).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-import-firms'] });
      queryClient.invalidateQueries({ queryKey: ['admin-import-firm'] });
      options.onSuccess?.();
    },
    onError: options.onError,
  });
}

export function useUploadImportFirmFile(options: MutationOptions = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, field, file }: { id: number; field: 'director_signature' | 'director_seal'; file: File }) => {
      const fd = new FormData();
      fd.append(field, file);
      return api.patch<IImportFirm>(`/export/admin/import-firms/${id}/`, fd).then(r => r.data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-import-firms'] });
      queryClient.invalidateQueries({ queryKey: ['admin-import-firm'] });
      options.onSuccess?.();
    },
    onError: options.onError,
  });
}

export function useDeleteImportFirm(options: MutationOptions = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete(`/export/admin/import-firms/${id}/`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-import-firms'] });
      options.onSuccess?.();
    },
    onError: options.onError,
  });
}
