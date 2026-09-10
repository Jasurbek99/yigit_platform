import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import type { IFleetDocument } from '@/components/fleet/FleetDocumentsPanel';
import type { ITruckHead, ITrailer, IDriver } from '@/hooks/useFleet';

export type { IDriver };

// The list endpoint (see backend TruckHeadSerializer) also returns
// owner_name/capacity/is_active, which aren't on the shared ITruckHead type
// (that type is scoped to what the shipment-truck selector needs). Extend
// here rather than widening the shared hook's type.
export interface IAdminTruckHead extends ITruckHead {
  owner_name?: string | null;
  /** Vehicle make and model, free text — e.g. 'MAN TGX'. */
  truck_model?: string;
  /** How many tech passport scans are attached. A count is not sensitive,
   *  so it rides on the shared picker serializer. */
  document_count?: number;
  capacity?: number | string | null;
  is_active: boolean;
}

export function useAdminTruckHeads() {
  return useQuery<IAdminTruckHead[]>({
    queryKey: ['transport', 'admin-truck-heads'],
    queryFn: async () => {
      const { data } = await api.get<IAdminTruckHead[]>('/transport/truck-heads/', {
        params: { include_inactive: 'true' },
      });
      return data;
    },
  });
}

export function useAdminTrailers() {
  return useQuery<ITrailer[]>({
    queryKey: ['transport', 'admin-trailers'],
    queryFn: async () => {
      const { data } = await api.get<ITrailer[]>('/transport/trailers/', {
        params: { include_inactive: 'true' },
      });
      return data;
    },
  });
}

interface ITruckHeadPatch { id: number; plate_number?: string; owner_type?: string; owner_name?: string; truck_model?: string; status?: string; capacity?: number | null; is_active?: boolean; }
interface ITrailerPatch { id: number; plate_number?: string; owner_type?: string; status?: string; is_active?: boolean; }

interface ITruckHeadCreate {
  plate_number: string;
  owner_type?: string;
  owner_name?: string;
  truck_model?: string;
  capacity?: number | string | null;
  is_active?: boolean;
}
interface ITrailerCreate { plate_number: string; owner_type?: string; is_active?: boolean; }

export function useAdminCreateTruckHead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: ITruckHeadCreate) => {
      const { data } = await api.post<ITruckHead>('/transport/truck-heads/', payload);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transport', 'admin-truck-heads'] });
      qc.invalidateQueries({ queryKey: ['transport', 'truck-heads'] });
    },
  });
}

export function useAdminCreateTrailer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: ITrailerCreate) => {
      const { data } = await api.post<ITrailer>('/transport/trailers/', payload);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transport', 'admin-trailers'] });
      qc.invalidateQueries({ queryKey: ['transport', 'trailers'] });
    },
  });
}

export function useUpdateTruckHead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }: ITruckHeadPatch) => {
      const { data } = await api.patch<ITruckHead>(`/transport/truck-heads/${id}/`, payload);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transport', 'admin-truck-heads'] });
      qc.invalidateQueries({ queryKey: ['transport', 'truck-heads'] });
    },
  });
}

export function useUpdateTrailer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }: ITrailerPatch) => {
      const { data } = await api.patch<ITrailer>(`/transport/trailers/${id}/`, payload);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transport', 'admin-trailers'] });
      qc.invalidateQueries({ queryKey: ['transport', 'trailers'] });
    },
  });
}

// ── Drivers ───────────────────────────────────────────────────────────
interface IDriverCreate {
  name: string;
  phone?: string | null;
  passport_serial?: string;
  passport_issue_date?: string | null;
  is_active?: boolean;
}
interface IDriverPatch {
  id: number;
  name?: string;
  phone?: string | null;
  passport_serial?: string;
  passport_issue_date?: string | null;
  is_active?: boolean;
}

export function useAdminDrivers() {
  return useQuery<IDriver[]>({
    queryKey: ['transport', 'admin-drivers'],
    queryFn: async () => {
      const { data } = await api.get<IDriver[]>('/transport/drivers/', {
        params: { include_inactive: 'true' },
      });
      return data;
    },
  });
}

export function useAdminCreateDriver() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: IDriverCreate) => {
      const { data } = await api.post<IDriver>('/transport/drivers/', payload);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transport', 'admin-drivers'] });
      qc.invalidateQueries({ queryKey: ['transport', 'drivers'] });
    },
  });
}

export function useUpdateDriver() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }: IDriverPatch) => {
      const { data } = await api.patch<IDriver>(`/transport/drivers/${id}/`, payload);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transport', 'admin-drivers'] });
      qc.invalidateQueries({ queryKey: ['transport', 'drivers'] });
    },
  });
}

// ── Driver passport documents ─────────────────────────────────────────────
// Driver passports and truck tech passports have the same wire shape; the
// shared panel that renders both is typed on it.
export type IDriverDocument = IFleetDocument;

/**
 * Browser-openable URL for a passport scan. The auth cookie is httpOnly and
 * same-origin, so the browser sends it automatically — opening this in a new
 * tab previews the JPG or PDF. There is no /media/ path to link to on purpose:
 * nginx serves that directory with no auth, and this is an identity document.
 */
export function driverDocumentUrl(driverId: number, documentId: number): string {
  return `${api.defaults.baseURL}/transport/drivers/${driverId}/documents/${documentId}/download/`;
}

export function useDriverDocuments(driverId: number | null) {
  return useQuery<IDriverDocument[]>({
    queryKey: ['transport', 'driver-documents', driverId],
    // A file needs an existing driver row to hang off, so the create form has
    // no id yet and this stays idle until the modal is editing one.
    enabled: driverId != null,
    queryFn: async () => {
      const { data } = await api.get<IDriverDocument[]>(
        `/transport/drivers/${driverId}/documents/`,
      );
      return data;
    },
  });
}

/**
 * Upload one or more passport scans.
 *
 * The driver id travels in the mutate variables rather than as a hook argument,
 * because the Add dialog only learns it from the create response: a hook bound
 * at render time would still be holding `null` when the upload fires.
 */
export function useUploadDriverDocuments() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ driverId, files }: { driverId: number; files: File[] }) => {
      const form = new FormData();
      files.forEach((f) => form.append('files', f));
      const { data } = await api.post<IDriverDocument[]>(
        `/transport/drivers/${driverId}/documents/`,
        form,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      );
      return data;
    },
    onSuccess: (_data, { driverId }) => {
      qc.invalidateQueries({ queryKey: ['transport', 'driver-documents', driverId] });
      // document_count rides on the driver row, so the table is stale too.
      qc.invalidateQueries({ queryKey: ['transport', 'admin-drivers'] });
    },
  });
}

export function useDeleteDriverDocument(driverId: number | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (documentId: number) => {
      await api.delete(`/transport/drivers/${driverId}/documents/${documentId}/`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transport', 'driver-documents', driverId] });
      qc.invalidateQueries({ queryKey: ['transport', 'admin-drivers'] });
    },
  });
}

// ── Truck head tech passport documents ────────────────────────────────────
export type ITruckHeadDocument = IFleetDocument;

/**
 * Browser-openable URL for a tech passport scan. Same reasoning as
 * `driverDocumentUrl`: the auth cookie is httpOnly and same-origin, and there
 * is no /media/ path to link to because nginx serves that directory with no
 * auth.
 */
export function truckHeadDocumentUrl(truckHeadId: number, documentId: number): string {
  return `${api.defaults.baseURL}/transport/truck-heads/${truckHeadId}/documents/${documentId}/download/`;
}

export function useTruckHeadDocuments(truckHeadId: number | null) {
  return useQuery<ITruckHeadDocument[]>({
    queryKey: ['transport', 'truck-head-documents', truckHeadId],
    // A file needs an existing truck row to hang off, so the create form has no
    // id yet and this stays idle until the modal is editing one.
    enabled: truckHeadId != null,
    queryFn: async () => {
      const { data } = await api.get<ITruckHeadDocument[]>(
        `/transport/truck-heads/${truckHeadId}/documents/`,
      );
      return data;
    },
  });
}

/**
 * Upload one or more tech passport scans.
 *
 * The truck id travels in the mutate variables rather than as a hook argument,
 * because the Add dialog only learns it from the create response: a hook bound
 * at render time would still be holding `null` when the upload fires.
 */
export function useUploadTruckHeadDocuments() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ truckHeadId, files }: { truckHeadId: number; files: File[] }) => {
      const form = new FormData();
      files.forEach((f) => form.append('files', f));
      const { data } = await api.post<ITruckHeadDocument[]>(
        `/transport/truck-heads/${truckHeadId}/documents/`,
        form,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      );
      return data;
    },
    onSuccess: (_data, { truckHeadId }) => {
      qc.invalidateQueries({ queryKey: ['transport', 'truck-head-documents', truckHeadId] });
      // document_count rides on the truck row, so the table is stale too.
      qc.invalidateQueries({ queryKey: ['transport', 'admin-truck-heads'] });
    },
  });
}

export function useDeleteTruckHeadDocument(truckHeadId: number | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (documentId: number) => {
      await api.delete(`/transport/truck-heads/${truckHeadId}/documents/${documentId}/`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transport', 'truck-head-documents', truckHeadId] });
      qc.invalidateQueries({ queryKey: ['transport', 'admin-truck-heads'] });
    },
  });
}
