import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import { MOCK_PALLETS } from '@/mock/pallets';
import type { IPallet, IPalletUpsertRow } from '@/types';

const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true';

// ─── usePallets ───────────────────────────────────────────────────────────

/**
 * Fetches all pallets for a given shipment.
 * Returns an empty array until shipmentId is provided.
 * In mock mode returns MOCK_PALLETS filtered by shipment id (id 1 matches all mocks).
 */
export function usePallets(shipmentId: number | null) {
  return useQuery({
    queryKey: ['pallets', shipmentId],
    queryFn: async (): Promise<IPallet[]> => {
      if (USE_MOCK) {
        // Mock pallets all belong to shipment 1
        return MOCK_PALLETS.filter((p) => p.shipment === (shipmentId ?? 1));
      }
      const { data } = await api.get<IPallet[]>(
        `/export/shipments/${shipmentId}/pallets/`,
      );
      return data;
    },
    enabled: shipmentId != null,
    staleTime: 30_000,
  });
}

// ─── useUpsertPallets ─────────────────────────────────────────────────────

/**
 * Bulk-upserts all pallets for a shipment (replaces the full list).
 * Invalidates ['pallets', shipmentId] and ['shipment', shipmentId] on success
 * so variety_confidence and weight fields refresh in ShipmentDetail.
 */
export function useUpsertPallets(shipmentId: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (pallets: IPalletUpsertRow[]): Promise<IPallet[]> => {
      if (USE_MOCK) {
        // No-op — return the mock list unchanged
        return MOCK_PALLETS;
      }
      const { data } = await api.post<IPallet[]>(
        `/export/shipments/${shipmentId}/pallets/`,
        { pallets },
      );
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['pallets', shipmentId] });
      void queryClient.invalidateQueries({ queryKey: ['shipment', String(shipmentId)] });
    },
  });
}

// ─── useCloseManifest ─────────────────────────────────────────────────────

/**
 * Closes the pallet manifest:
 *   - Runs variety roll-up → sets varieties_dominant, variety_confidence='high'
 *   - Sets shipment.weight_net and weight_gross from pallet aggregates
 * Invalidates both pallets and shipment-detail queries on success.
 */
export function useCloseManifest(shipmentId: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (): Promise<void> => {
      if (USE_MOCK) return;
      await api.post(`/export/shipments/${shipmentId}/manifest/close/`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['pallets', shipmentId] });
      void queryClient.invalidateQueries({ queryKey: ['shipment', String(shipmentId)] });
    },
  });
}

// ─── useOverrideVarieties ─────────────────────────────────────────────────

/**
 * Manual override of dominant varieties (warehouse_chief / export_manager only).
 * variety_confidence stays 'high' after override.
 * Invalidates shipment-detail query so the confidence badge refreshes.
 */
export function useOverrideVarieties(shipmentId: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (varietyIds: number[]): Promise<void> => {
      if (USE_MOCK) return;
      await api.post(`/export/shipments/${shipmentId}/varieties/override/`, {
        variety_ids: varietyIds,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['shipment', String(shipmentId)] });
    },
  });
}
