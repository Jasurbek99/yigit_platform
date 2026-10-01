import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import { useSelectedSeason } from '@/hooks/useSeasonParam';
import { isAxiosError } from 'axios';
import type { ICandidateShipment, IExternalTrip, ITripSyncState } from '@/types/externalTrip';
import { MOCK_CANDIDATE_SHIPMENTS, MOCK_EXTERNAL_TRIPS, MOCK_TRIP_SYNC_STATE } from '@/mock/externalTrips';

const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true';
const BASE = '/transport/external-trips/';
export const TRIPS_KEY = ['transport', 'external-trips'] as const;

export function useExternalTrips(params: { free?: boolean; linked?: boolean } = {}) {
  return useQuery({
    queryKey: [...TRIPS_KEY, params],
    queryFn: async (): Promise<IExternalTrip[]> => {
      if (USE_MOCK) {
        return MOCK_EXTERNAL_TRIPS.filter((trip) => (params.linked ? !!trip.shipment : !params.free || !trip.shipment));
      }
      const { data } = await api.get<IExternalTrip[]>(BASE, {
        params: { free: params.free ? 1 : undefined, linked: params.linked ? 1 : undefined },
      });
      return data;
    },
    refetchInterval: 60_000,
  });
}

/** Preparation shipments still needing a truck, in the season browsed in the header. */
export function useCandidateShipments() {
  const { seasonId, isReady } = useSelectedSeason();
  return useQuery({
    queryKey: [...TRIPS_KEY, 'candidates', seasonId],
    queryFn: async (): Promise<ICandidateShipment[]> => {
      if (USE_MOCK) return MOCK_CANDIDATE_SHIPMENTS;
      const params = seasonId != null ? { season: seasonId } : undefined;
      return (await api.get(`${BASE}candidate-shipments/`, { params })).data;
    },
    enabled: USE_MOCK || isReady,
  });
}

export function useTripSyncState() {
  return useQuery({
    queryKey: [...TRIPS_KEY, 'sync-state'],
    queryFn: async (): Promise<ITripSyncState> =>
      USE_MOCK ? MOCK_TRIP_SYNC_STATE : (await api.get(`${BASE}sync-state/`)).data,
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
      // Shipment detail keys are ['shipment', id] — trip_id and the transport fields changed.
      queryClient.invalidateQueries({ queryKey: ['shipment'] });
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

export function useAcceptTripChange() {
  return useTripAction<{ tripId: number }>((v) => `${BASE}${v.tripId}/accept-change/`, () => ({}));
}

export function useMoveTrip() {
  return useTripAction<{ tripId: number; shipmentId: number; confirmUnknownCountry?: boolean }>(
    (v) => `${BASE}${v.tripId}/move/`,
    (v) => ({ shipment_id: v.shipmentId, confirm_unknown_country: !!v.confirmUnknownCountry }),
  );
}

/** The Planning trip on one shipment — open to every role (shipment page banner). */
export function useShipmentTrip(shipmentId: number) {
  return useQuery({
    queryKey: [...TRIPS_KEY, 'by-shipment', shipmentId],
    queryFn: async (): Promise<IExternalTrip | null> => {
      if (USE_MOCK) return MOCK_EXTERNAL_TRIPS.find((trip) => trip.shipment === shipmentId) ?? null;
      try {
        return (await api.get<IExternalTrip>(`/transport/shipments/${shipmentId}/trip/`)).data;
      } catch (err) {
        if (isAxiosError(err) && err.response?.status === 404) return null;
        throw err;
      }
    },
  });
}

const BLOB_URL_LIFETIME_MS = 60_000;

/** Fetch the trip's A4 PDF and show it; throws so the caller can show the translated error.
 *
 * The tab is opened synchronously, inside the click, and pointed at the PDF
 * once it arrives — opening it after the await gets it popup-blocked. */
export async function openTripDocument(tripId: number): Promise<void> {
  const tab = window.open('', '_blank');
  try {
    const { data } = await api.get<Blob>(`${BASE}${tripId}/document/`, { responseType: 'blob' });
    const url = URL.createObjectURL(data);
    if (tab) tab.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), BLOB_URL_LIFETIME_MS);
  } catch (err) {
    tab?.close();
    throw err;
  }
}
