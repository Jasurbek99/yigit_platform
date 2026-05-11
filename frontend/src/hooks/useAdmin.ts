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
  ICustomer,
  ITruckDestination,
  IBorderPoint,
  IShipmentStatusType,
  IShipmentOptionType,
  ICrateType,
  ITruckSplitDefault,
  IAuditLog,
  AuditAction,
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
        '/greenhouse/admin/blocks/',
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
      const { data } = await api.get<IGreenhouseBlock>(`/greenhouse/admin/blocks/${id}/`);
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
      api.post<IGreenhouseBlock>('/greenhouse/admin/blocks/', payload),
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
      api.patch<IGreenhouseBlock>(`/greenhouse/admin/blocks/${id}/`, payload),
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
        ? `/greenhouse/admin/block-assignments/?user=${userId}`
        : '/greenhouse/admin/block-assignments/';
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
      api.post<IBlockAssignment>('/greenhouse/admin/block-assignments/', payload),
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
    mutationFn: (id: number) => api.delete(`/greenhouse/admin/block-assignments/${id}/`),
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
      if (USE_MOCK) return Promise.resolve({ id: 0, username: payload.username, first_name: payload.first_name ?? '', last_name: payload.last_name ?? '', email: payload.email ?? '', phone: payload.phone ?? null, role: payload.role, is_active: payload.is_active ?? true, permissions: [] });
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
    enabled: !!countryId,
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

export function useCustomers() {
  return useQuery({
    queryKey: ['core-customers'],
    queryFn: async (): Promise<{ id: number; name: string }[]> => {
      if (USE_MOCK) {
        const { MOCK_CUSTOMERS } = await import('@/mock/customers');
        return MOCK_CUSTOMERS.map((c) => ({ id: c.id, name: c.name }));
      }
      const { data } = await api.get<IApiListResponse<{ id: number; name: string }> | { id: number; name: string }[]>(
        '/core/customers/?fields=minimal&page_size=500',
      );
      return Array.isArray(data) ? data : data.results;
    },
    staleTime: 300_000,
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

// ─── Truck Destinations ──────────────────────────────────────────────────

export function useAdminTruckDestinations() {
  return useQuery({
    queryKey: ['admin-truck-destinations'],
    queryFn: async (): Promise<ITruckDestination[]> => {
      if (USE_MOCK) return [];
      const { data } = await api.get<ITruckDestination[] | IApiListResponse<ITruckDestination>>(
        '/core/truck-destinations/',
      );
      return Array.isArray(data) ? data : data.results;
    },
    staleTime: 60_000,
  });
}

export function useCreateTruckDestination(options: MutationOptions = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { name: string; country?: number | null; sort_order?: number }) =>
      api.post<ITruckDestination>('/core/truck-destinations/', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-truck-destinations'] });
      queryClient.invalidateQueries({ queryKey: ['truck-destinations'] });
      options.onSuccess?.();
    },
    onError: options.onError,
  });
}

export function useUpdateTruckDestination(options: MutationOptions = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...payload }: { id: number; name?: string; country?: number | null; sort_order?: number; is_active?: boolean }) =>
      api.patch<ITruckDestination>(`/core/truck-destinations/${id}/`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-truck-destinations'] });
      queryClient.invalidateQueries({ queryKey: ['truck-destinations'] });
      options.onSuccess?.();
    },
    onError: options.onError,
  });
}

export function useDeleteTruckDestination(options: MutationOptions = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete(`/core/truck-destinations/${id}/`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-truck-destinations'] });
      queryClient.invalidateQueries({ queryKey: ['truck-destinations'] });
      options.onSuccess?.();
    },
    onError: options.onError,
  });
}

// ─── Customers ──────────────────────────────────────────────────────────

export function useAdminCustomers() {
  return useQuery({
    queryKey: ['admin-customers'],
    queryFn: async (): Promise<ICustomer[]> => {
      if (USE_MOCK) {
        const { MOCK_CUSTOMERS } = await import('@/mock/customers');
        return MOCK_CUSTOMERS;
      }
      const { data } = await api.get<ICustomer[] | IApiListResponse<ICustomer>>(
        '/core/customers/?page_size=500',
      );
      return Array.isArray(data) ? data : data.results;
    },
    staleTime: 60_000,
  });
}

type CustomerPayload = {
  name: string;
  phone?: string | null;
  default_country?: number | null;
  default_city?: number | null;
  import_firms?: number[];
  is_active?: boolean;
};

export function useCreateCustomer(options: MutationOptions = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CustomerPayload) =>
      api.post<ICustomer>('/core/customers/', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-customers'] });
      queryClient.invalidateQueries({ queryKey: ['core-customers'] });
      options.onSuccess?.();
    },
    onError: options.onError,
  });
}

export function useUpdateCustomer(options: MutationOptions = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...payload }: { id: number } & Partial<CustomerPayload>) =>
      api.patch<ICustomer>(`/core/customers/${id}/`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-customers'] });
      queryClient.invalidateQueries({ queryKey: ['core-customers'] });
      options.onSuccess?.();
    },
    onError: options.onError,
  });
}

export function useDeleteCustomer(options: MutationOptions = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete(`/core/customers/${id}/`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-customers'] });
      queryClient.invalidateQueries({ queryKey: ['core-customers'] });
      options.onSuccess?.();
    },
    onError: options.onError,
  });
}

// ─── Dynamic Permission Matrices ────────────────────────────────────────

interface IPagePermMatrixResponse {
  roles: string[];
  pages: { code: string; label: string }[];
  matrix: Record<string, Record<string, boolean>>;
}

export function usePagePermissions() {
  return useQuery({
    queryKey: ['admin-page-permissions'],
    queryFn: async (): Promise<IPagePermMatrixResponse> => {
      const { data } = await api.get<IPagePermMatrixResponse>('/core/admin/page-permissions/');
      return data;
    },
    staleTime: 30_000,
  });
}

export function useSavePagePermissions(options: MutationOptions = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (matrix: Record<string, Record<string, boolean>>) =>
      api.put('/core/admin/page-permissions/', { matrix }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-page-permissions'] });
      queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
      options.onSuccess?.();
    },
    onError: options.onError,
  });
}

interface IResourcePermMatrixResponse {
  roles: string[];
  resources: { code: string; label: string }[];
  matrix: Record<string, Record<string, { view: boolean; create: boolean; edit: boolean; delete: boolean }>>;
}

export function useResourcePermissions() {
  return useQuery({
    queryKey: ['admin-resource-permissions'],
    queryFn: async (): Promise<IResourcePermMatrixResponse> => {
      const { data } = await api.get<IResourcePermMatrixResponse>('/core/admin/resource-permissions/');
      return data;
    },
    staleTime: 30_000,
  });
}

export function useSaveResourcePermissions(options: MutationOptions = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (matrix: Record<string, Record<string, { view: boolean; create: boolean; edit: boolean; delete: boolean }>>) =>
      api.put('/core/admin/resource-permissions/', { matrix }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-resource-permissions'] });
      queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
      options.onSuccess?.();
    },
    onError: options.onError,
  });
}

interface IFieldPermMatrixResponse {
  roles: string[];
  resource_fields: Record<string, string[]>;
  matrix: Record<string, Record<string, string[]>>;
}

export function useFieldPermissions(resource?: string) {
  return useQuery({
    queryKey: ['admin-field-permissions', resource],
    queryFn: async (): Promise<IFieldPermMatrixResponse> => {
      const params = resource ? `?resource=${resource}` : '';
      const { data } = await api.get<IFieldPermMatrixResponse>(`/core/admin/field-permissions/${params}`);
      return data;
    },
    staleTime: 30_000,
  });
}

export function useSaveFieldPermissions(options: MutationOptions = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { resource: string; matrix: Record<string, string[]> }) =>
      api.put('/core/admin/field-permissions/', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-field-permissions'] });
      queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
      options.onSuccess?.();
    },
    onError: options.onError,
  });
}


// ─── Border Points ──────────────────────────────────────────────────────

export function useBorderPoints() {
  return useQuery({
    queryKey: ['core-border-points'],
    queryFn: async (): Promise<IBorderPoint[]> => {
      if (USE_MOCK) return [];
      const { data } = await api.get<IApiListResponse<IBorderPoint> | IBorderPoint[]>(
        '/core/border-points/',
      );
      return Array.isArray(data) ? data : data.results;
    },
    staleTime: 300_000,
  });
}

export function useCreateBorderPoint(options: MutationOptions = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: Partial<IBorderPoint>) => api.post('/core/border-points/', payload),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['core-border-points'] }); options.onSuccess?.(); },
    onError: options.onError,
  });
}

export function useUpdateBorderPoint(options: MutationOptions = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...payload }: { id: number } & Partial<IBorderPoint>) => api.patch(`/core/border-points/${id}/`, payload),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['core-border-points'] }); options.onSuccess?.(); },
    onError: options.onError,
  });
}

export function useDeleteBorderPoint(options: MutationOptions = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete(`/core/border-points/${id}/`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['core-border-points'] }); options.onSuccess?.(); },
    onError: options.onError,
  });
}


// ─── Shipment Status Types ──────────────────────────────────────────────

export function useShipmentStatuses() {
  return useQuery({
    queryKey: ['core-status-types'],
    queryFn: async (): Promise<IShipmentStatusType[]> => {
      if (USE_MOCK) return [];
      const { data } = await api.get<IApiListResponse<IShipmentStatusType> | IShipmentStatusType[]>('/core/status-types/');
      return Array.isArray(data) ? data : data.results;
    },
    staleTime: 300_000,
  });
}

export function useUpdateShipmentStatus(options: MutationOptions = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...payload }: { id: number } & Partial<IShipmentStatusType>) => api.patch(`/core/status-types/${id}/`, payload),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['core-status-types'] }); options.onSuccess?.(); },
    onError: options.onError,
  });
}


// ─── Shipment Option Types (configurable dropdowns) ─────────────────────

export function useShipmentOptions(category?: string) {
  return useQuery({
    queryKey: ['core-shipment-options', category],
    queryFn: async (): Promise<IShipmentOptionType[]> => {
      if (USE_MOCK) return [];
      const url = category ? `/core/shipment-options/?category=${category}` : '/core/shipment-options/';
      const { data } = await api.get<IApiListResponse<IShipmentOptionType> | IShipmentOptionType[]>(url);
      return Array.isArray(data) ? data : data.results;
    },
    staleTime: 300_000,
  });
}

export function useCreateShipmentOption(options: MutationOptions = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: Partial<IShipmentOptionType>) => api.post('/core/shipment-options/', payload),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['core-shipment-options'] }); options.onSuccess?.(); },
    onError: options.onError,
  });
}

export function useUpdateShipmentOption(options: MutationOptions = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...payload }: { id: number } & Partial<IShipmentOptionType>) => api.patch(`/core/shipment-options/${id}/`, payload),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['core-shipment-options'] }); options.onSuccess?.(); },
    onError: options.onError,
  });
}

export function useDeleteShipmentOption(options: MutationOptions = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete(`/core/shipment-options/${id}/`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['core-shipment-options'] }); options.onSuccess?.(); },
    onError: options.onError,
  });
}

// ─── Crate Types (Phase 2 — Pallet Manifest) ────────────────────────────

export function useCrateTypes() {
  return useQuery({
    queryKey: ['core-crate-types'],
    queryFn: async (): Promise<ICrateType[]> => {
      if (USE_MOCK) {
        const { MOCK_CRATE_TYPES } = await import('@/mock/pallets');
        return MOCK_CRATE_TYPES;
      }
      const { data } = await api.get<IApiListResponse<ICrateType> | ICrateType[]>(
        '/core/crate-types/',
      );
      return Array.isArray(data) ? data : data.results;
    },
    staleTime: 300_000,
  });
}

// ─── Audit Log (read-only — admin / director / export_manager) ─────────

export interface IAuditLogFilters {
  page?: number;
  page_size?: number;
  model_name?: string;
  action?: AuditAction | '';
  object_id?: number | '';
}

export function useAuditLog(filters: IAuditLogFilters = {}) {
  const params = new URLSearchParams();
  if (filters.page) params.set('page', String(filters.page));
  if (filters.page_size) params.set('page_size', String(filters.page_size));
  if (filters.model_name) params.set('model_name', filters.model_name);
  if (filters.action) params.set('action', filters.action);
  if (filters.object_id !== undefined && filters.object_id !== '') {
    params.set('object_id', String(filters.object_id));
  }
  const qs = params.toString();

  return useQuery({
    queryKey: ['admin-audit-log', filters],
    queryFn: async (): Promise<IApiListResponse<IAuditLog>> => {
      if (USE_MOCK) return { count: 0, next: null, previous: null, results: [] };
      const { data } = await api.get<IApiListResponse<IAuditLog>>(
        `/export/audit-log/${qs ? `?${qs}` : ''}`,
      );
      return data;
    },
    staleTime: 30_000,
  });
}

// ─── Truck Split Defaults (Gap 7 — official kg per firm count) ──────────

export function useTruckSplits() {
  return useQuery({
    queryKey: ['admin-truck-splits'],
    queryFn: async (): Promise<ITruckSplitDefault[]> => {
      if (USE_MOCK) return [];
      const { data } = await api.get<IApiListResponse<ITruckSplitDefault> | ITruckSplitDefault[]>(
        '/export/admin/truck-splits/',
      );
      return Array.isArray(data) ? data : data.results;
    },
    staleTime: 60_000,
  });
}

type TruckSplitPayload = {
  num_firms: number;
  kg_per_firm: string;
  notes?: string | null;
};

export function useCreateTruckSplit(options: MutationOptions = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: TruckSplitPayload) =>
      api.post<ITruckSplitDefault>('/export/admin/truck-splits/', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-truck-splits'] });
      options.onSuccess?.();
    },
    onError: options.onError,
  });
}

export function useUpdateTruckSplit(options: MutationOptions = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...payload }: { id: number } & Partial<TruckSplitPayload>) =>
      api.patch<ITruckSplitDefault>(`/export/admin/truck-splits/${id}/`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-truck-splits'] });
      options.onSuccess?.();
    },
    onError: options.onError,
  });
}

export function useDeleteTruckSplit(options: MutationOptions = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete(`/export/admin/truck-splits/${id}/`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-truck-splits'] });
      options.onSuccess?.();
    },
    onError: options.onError,
  });
}
