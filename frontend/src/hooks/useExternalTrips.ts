import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import type { ICandidateShipment, IExternalTrip, ITripSyncState } from '@/types/externalTrip';

const BASE = '/transport/external-trips/';
export const TRIPS_KEY = ['transport', 'external-trips'] as const;

export function useExternalTrips(params: { free?: boolean; linked?: boolean } = {}) {
  return useQuery({
    queryKey: [...TRIPS_KEY, params],
    queryFn: async (): Promise<IExternalTrip[]> => {
      const { data } = await api.get<IExternalTrip[]>(BASE, {
        params: { free: params.free ? 1 : undefined, linked: params.linked ? 1 : undefined },
      });
      return data;
    },
    refetchInterval: 60_000,
  });
}

export function useCandidateShipments() {
  return useQuery({
    queryKey: [...TRIPS_KEY, 'candidates'],
    queryFn: async (): Promise<ICandidateShipment[]> => (await api.get(`${BASE}candidate-shipments/`)).data,
  });
}

export function useTripSyncState() {
  return useQuery({
    queryKey: [...TRIPS_KEY, 'sync-state'],
    queryFn: async (): Promise<ITripSyncState> => (await api.get(`${BASE}sync-state/`)).data,
    refetchInterval: 60_000,
  });
}

function useTripAction<TVars>(path: (vars: TVars) => string, body: (vars: TVars) => object) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: TVars): Promise<IExternalTrip> => (await api.post(path(vars), body(vars))).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: TRIPS_KEY });
      queryClient.invalidateQueries({ queryKey: ['shipments'] });
    },
  });
}

export function useAssignTrip() {
  return useTripAction<{ tripId: number; shipmentId: number; confirmUnknownCountry?: boolean }>(
    (v) => `${BASE}${v.tripId}/assign/`,
    (v) => ({ shipment_id: v.shipmentId, confirm_unknown_country: !!v.confirmUnknownCountry }),
  );
}

export function useUnassignTrip() {
  return useTripAction<{ tripId: number }>((v) => `${BASE}${v.tripId}/unassign/`, () => ({}));
}

export function tripDocumentUrl(tripId: number): string {
  const base = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';
  return `${base}${BASE}${tripId}/document/`;
}
