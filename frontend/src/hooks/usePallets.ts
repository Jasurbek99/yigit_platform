import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import { MOCK_PALLETS } from '@/mock/pallets';
import type {
  IBlockBreakdown,
  IPallet,
  IPalletUpsertRow,
  IWeightmasterPreview,
} from '@/types';

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
      void queryClient.invalidateQueries({ queryKey: ['block-breakdown', shipmentId] });
    },
  });
}

// ─── useBlockBreakdown ────────────────────────────────────────────────────

/**
 * Fetches the per (parent block x variety) net-weight breakdown from the saved
 * pallet manifest (sub-blocks F1/F2 summed into F). Feeds the sales report's
 * block section. Refetches when pallets change.
 */
export function useBlockBreakdown(shipmentId: number | null) {
  return useQuery({
    queryKey: ['block-breakdown', shipmentId],
    queryFn: async (): Promise<IBlockBreakdown> => {
      const { data } = await api.get<IBlockBreakdown>(
        `/export/shipments/${shipmentId}/block-breakdown/`,
      );
      return data;
    },
    enabled: shipmentId != null,
    staleTime: 30_000,
  });
}

// ─── useImportWeightmaster ────────────────────────────────────────────────

/**
 * Uploads a weightmaster loading-detail .xlsx and returns a DRY-RUN preview
 * (parsed pallet rows + warnings). Does NOT save — the caller loads the rows
 * into the editable grid and the user saves via useUpsertPallets.
 */
export function useImportWeightmaster(shipmentId: number) {
  return useMutation({
    mutationFn: async (file: File): Promise<IWeightmasterPreview> => {
      const form = new FormData();
      form.append('file', file);
      const { data } = await api.post<IWeightmasterPreview>(
        `/export/shipments/${shipmentId}/pallets/import-weightmaster/`,
        form,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      );
      return data;
    },
  });
}

// ─── useCloseManifest ─────────────────────────────────────────────────────

/**
 * Closes the pallet manifest:
 *   - Runs variety roll-up → sets varieties_dominant, variety_confidence='high'
 *   - Sets shipment.weight_net and weight_gross from pallet aggregates
 *   - Writes parent-grain block_sources from pallet net weights
 * Invalidates pallets, shipment-detail and block-breakdown queries on success.
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
      void queryClient.invalidateQueries({ queryKey: ['block-breakdown', shipmentId] });
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
