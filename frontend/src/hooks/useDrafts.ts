import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import api from '@/services/api';
import { MOCK_DRAFTS } from '@/mock/drafts';
import type {
  IShipmentDraft,
  IDraftCreatePayload,
  IDraftAssignPayload,
  IForecastRemaining,
  IForecastSubmitPayload,
  IForecastSubmitResult,
} from '@/types';


const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true';

// ─── Helpers ──────────────────────────────────────────────────────────────

function sortOldestFirst(drafts: IShipmentDraft[]): IShipmentDraft[] {
  return [...drafts].sort(
    (a, b) => dayjs(a.created_at).valueOf() - dayjs(b.created_at).valueOf(),
  );
}

// ─── useDrafts ────────────────────────────────────────────────────────────

/**
 * Fetches all shipments in DRAFT status, sorted oldest-first.
 * In mock mode returns MOCK_DRAFTS without any API call.
 */
export function useDrafts() {
  return useQuery({
    queryKey: ['drafts'],
    queryFn: async (): Promise<IShipmentDraft[]> => {
      if (USE_MOCK) return sortOldestFirst(MOCK_DRAFTS);

      const { data } = await api.get<{ results: IShipmentDraft[] }>(
        '/export/shipments/?status_code=draft&page_size=200&ordering=harvest_age_desc',
      );
      return data.results ?? [];
    },
    staleTime: 30_000,
  });
}

// ─── useCreateDraft ───────────────────────────────────────────────────────

/**
 * Creates a new DRAFT shipment with block_sources.
 * Returns the created IShipmentDraft on success.
 */
export function useCreateDraft() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: IDraftCreatePayload): Promise<IShipmentDraft> => {
      if (USE_MOCK) {
        // No-op in mock mode — optimistically return a stub.
        const stub: IShipmentDraft = {
          id: Date.now(),
          cargo_code: payload.cargo_code,
          date: payload.date,
          created_at: new Date().toISOString(),
          created_by_name: 'Mock User',
          weight_net: payload.block_sources.reduce((s, r) => s + r.weight_kg, 0),
          official_export_code: payload.official_export_code ?? null,
          previous_platform_id: null,
          harvest_age_days: 0,
          freshness: 'today',
          variety_confidence: 'none',
          block_sources: payload.block_sources.map((s) => ({
            block_id: s.block_id,
            block_code: `Block-${s.block_id}`,
            weight_kg: s.weight_kg,
          })),
        };
        return stub;
      }

      const { data } = await api.post<IShipmentDraft>('/export/shipments/', payload);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['drafts'] });
      queryClient.invalidateQueries({ queryKey: ['shipments'] });
      // Creating a draft draws down the forecast pool — refresh "remaining".
      queryClient.invalidateQueries({
        predicate: (q) => q.queryKey[0] === 'harvest-forecast-remaining',
      });
    },
  });
}

// ─── useAssignDraft ───────────────────────────────────────────────────────

interface IAssignDraftArgs {
  draftId: number;
  payload: IDraftAssignPayload;
}

/**
 * Assigns a draft to a destination (triggers draft → yuklenme lifecycle transition).
 * Returns the updated shipment detail.
 */
export function useAssignDraft() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ draftId, payload }: IAssignDraftArgs): Promise<{ id: number }> => {
      if (USE_MOCK) {
        // No-op in mock mode.
        return { id: draftId };
      }

      const { data } = await api.post<{ id: number }>(
        `/export/shipments/${draftId}/assign/`,
        payload,
      );
      return data;
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['drafts'] });
      queryClient.invalidateQueries({ queryKey: ['shipments'] });
      queryClient.invalidateQueries({ queryKey: ['shipment', String(vars.draftId)] });
    },
  });
}

// ─── useHarvestForecastRemaining ─────────────────────────────────────────

/**
 * Fetches remaining harvest pool per block for a given date.
 * Returns an empty array when no forecast has been entered for that date.
 * Decimals are returned as strings by the backend — use Number() when
 * performing arithmetic.
 */
export function useHarvestForecastRemaining(date: string) {
  return useQuery({
    queryKey: ['harvest-forecast-remaining', date],
    queryFn: async (): Promise<IForecastRemaining[]> => {
      if (USE_MOCK) return [];

      const { data } = await api.get<IForecastRemaining[]>(
        `/export/harvest-forecast/remaining/?date=${date}`,
      );
      return data;
    },
    enabled: Boolean(date),
    staleTime: 60_000,
  });
}

// ─── useSubmitForecast ────────────────────────────────────────────────────

/**
 * Submits (upserts) a harvest forecast for a given date.
 * On success, invalidates the remaining-pool cache so the composer
 * immediately reflects the new pool.
 */
export function useSubmitForecast() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: IForecastSubmitPayload): Promise<IForecastSubmitResult> => {
      if (USE_MOCK) {
        return {
          saved: payload.entries.length,
          date: payload.date,
          entries: payload.entries.map((e) => ({
            block_id: e.block_id,
            block_code: `Block-${e.block_id}`,
            forecast_kg: String(e.forecast_kg),
          })),
        };
      }

      const { data } = await api.post<IForecastSubmitResult>(
        '/export/harvest-forecast/',
        payload,
      );
      return data;
    },
    onSuccess: () => {
      // Invalidate all remaining-pool queries regardless of date.
      // ForecastEntryModal covers today and tomorrow; a single predicate
      // matching on key[0] is simpler and correct for both.
      queryClient.invalidateQueries({
        predicate: (q) => q.queryKey[0] === 'harvest-forecast-remaining',
      });
    },
  });
}

// ─── useCreateSupplyDraft ─────────────────────────────────────────────────

/**
 * Creates a SUPPLY draft (blocks + optional variety, NO destination).
 * Passes skip_forecast_check: true so the forecast-pool check is bypassed.
 * Invalidates sheet, drafts and shipments queries on success.
 */
export function useCreateSupplyDraft() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: IDraftCreatePayload): Promise<IShipmentDraft> => {
      if (USE_MOCK) {
        const stub: IShipmentDraft = {
          id: Date.now(),
          cargo_code: payload.cargo_code,
          date: payload.date,
          created_at: new Date().toISOString(),
          created_by_name: 'Soltanmyrat (mock)',
          weight_net: payload.block_sources.reduce((s, r) => s + r.weight_kg, 0),
          official_export_code: null,
          previous_platform_id: null,
          harvest_age_days: 0,
          freshness: 'today',
          variety_confidence: 'none',
          block_sources: payload.block_sources.map((s) => ({
            block_id: s.block_id,
            block_code: `Block-${s.block_id}`,
            weight_kg: s.weight_kg,
          })),
        };
        return stub;
      }

      const { data } = await api.post<IShipmentDraft>('/export/shipments/', {
        ...payload,
        is_draft: true,
        skip_forecast_check: true,
      });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['drafts'] });
      queryClient.invalidateQueries({ queryKey: ['shipments'] });
      queryClient.invalidateQueries({ queryKey: ['shipments', 'sheet'] });
      queryClient.invalidateQueries({
        predicate: (q) => q.queryKey[0] === 'harvest-forecast-remaining',
      });
    },
  });
}

// ─── useCreateDestinationDraft ────────────────────────────────────────────

/**
 * Creates a DESTINATION draft (country / customer / import_firm, NO blocks).
 * Invalidates sheet, drafts and shipments queries on success.
 */
export function useCreateDestinationDraft() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: IDraftCreatePayload): Promise<IShipmentDraft> => {
      if (USE_MOCK) {
        const stub: IShipmentDraft = {
          id: Date.now(),
          cargo_code: payload.cargo_code,
          date: payload.date,
          created_at: new Date().toISOString(),
          created_by_name: 'Gadam (mock)',
          weight_net: 0,
          official_export_code: null,
          previous_platform_id: null,
          harvest_age_days: 0,
          freshness: 'today',
          variety_confidence: 'none',
          block_sources: [],
        };
        return stub;
      }

      const { data } = await api.post<IShipmentDraft>('/export/shipments/', {
        ...payload,
        is_draft: true,
        block_sources: [],
      });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['drafts'] });
      queryClient.invalidateQueries({ queryKey: ['shipments'] });
      queryClient.invalidateQueries({ queryKey: ['shipments', 'sheet'] });
    },
  });
}

// ─── useJoinShipments ─────────────────────────────────────────────────────

interface IJoinShipmentsArgs {
  targetId: number;
  sourceId: number;
}

/**
 * Merges a supply draft (source, gets DELETED) into a destination draft
 * (target, SURVIVES). Returns the updated target shipment detail.
 *
 * Gates (enforced server-side):
 * - Caller must be export_manager / director
 * - Both must be draft; target has country+customer; target has NO blocks;
 *   source has ≥1 block source.
 */
export function useJoinShipments() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ targetId, sourceId }: IJoinShipmentsArgs): Promise<{ id: number }> => {
      if (USE_MOCK) {
        // No-op in mock mode — return the target id.
        return { id: targetId };
      }

      const { data } = await api.post<{ id: number }>(
        `/export/shipments/${targetId}/join/`,
        { source_id: sourceId },
      );
      return data;
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['drafts'] });
      queryClient.invalidateQueries({ queryKey: ['shipments'] });
      queryClient.invalidateQueries({ queryKey: ['shipments', 'sheet'] });
      queryClient.invalidateQueries({ queryKey: ['shipment', String(vars.targetId)] });
    },
  });
}

// ─── usePromoteFromDraft ──────────────────────────────────────────────────
//
// Wrapper around the same /assign/ endpoint, used from the Detail page's
// "Promote to Loading" button. Sends an empty body — the draft must already
// have its destination set, which is enforced upstream by
// can_promote_from_draft on the serializer.
//
// Invalidates the singular shipment detail query, the kanbans, and the
// task list so every consuming surface refreshes.

export function usePromoteFromDraft() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ shipmentId }: { shipmentId: number | string }): Promise<{ id: number }> => {
      const { data } = await api.post<{ id: number }>(
        `/export/shipments/${shipmentId}/assign/`,
        {},
      );
      return data;
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['shipment', String(vars.shipmentId)] });
      queryClient.invalidateQueries({ queryKey: ['shipments'] });
      queryClient.invalidateQueries({ queryKey: ['shipments', 'sheet'] });
      queryClient.invalidateQueries({ queryKey: ['shipments', 'board'] });
      queryClient.invalidateQueries({ queryKey: ['drafts'] });
      queryClient.invalidateQueries({ queryKey: ['my-tasks'] });
    },
  });
}
