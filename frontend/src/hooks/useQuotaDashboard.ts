import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import { useSelectedSeason } from '@/hooks/useSeasonParam';
import type { IQuotaDashboardResponse, IQuotaIssuance, IApiListResponse } from '@/types';

export interface IQuotaDashboardFilters {
  season: number;
  date_from?: string;
  date_to?: string;
  product_type?: string;
}

export function useQuotaDashboard(
  filters: IQuotaDashboardFilters,
  options: { enabled?: boolean } = {},
) {
  const { enabled = true } = options;
  return useQuery({
    queryKey: ['quota-dashboard', filters],
    queryFn: async (): Promise<IQuotaDashboardResponse> => {
      const params = new URLSearchParams();
      params.set('season', String(filters.season));
      if (filters.date_from) params.set('date_from', filters.date_from);
      if (filters.date_to) params.set('date_to', filters.date_to);
      if (filters.product_type) params.set('product_type', filters.product_type);
      const { data } = await api.get<IQuotaDashboardResponse>(`/export/quota-dashboard/?${params}`);
      return data;
    },
    // Gate by season AND quota access: a seller reaches this page only for the
    // local-sell tab and has no quota_issuance perm, so firing the dashboard
    // query would 403 and surface the error banner. The caller passes enabled.
    enabled: !!filters.season && enabled,
    staleTime: 60_000,
  });
}

/**
 * Quota issuances for the selected season. Season-scoped since D11 — quota
 * never crosses a season boundary, so `seasonId` is in the key or a switch
 * renders the previous season's cached issuances.
 */
export function useQuotaIssuances(
  filters: { product_type?: string; date_from?: string; date_to?: string } = {},
) {
  const { seasonId, isReady } = useSelectedSeason();
  return useQuery({
    queryKey: ['quota-issuances', seasonId, filters],
    queryFn: async (): Promise<IQuotaIssuance[]> => {
      const params = new URLSearchParams();
      if (filters.product_type) params.set('product_type', filters.product_type);
      if (filters.date_from) params.set('date_from', filters.date_from);
      if (filters.date_to) params.set('date_to', filters.date_to);
      if (seasonId != null) params.set('season', String(seasonId));
      const qs = params.toString() ? `?${params}` : '';
      const { data } = await api.get<IApiListResponse<IQuotaIssuance> | IQuotaIssuance[]>(
        `/export/quota-issuances/${qs}`,
      );
      const rows = Array.isArray(data) ? data : data.results;
      // DRF serializes DecimalField as a string ("100000.00"), so summing the
      // allocations concatenated instead of adding. Normalize at the boundary.
      return rows.map((iss) => ({
        ...iss,
        allocations: iss.allocations.map((a) => ({
          ...a,
          kg_quota: Number(a.kg_quota) || 0,
          used_kg: Number(a.used_kg) || 0,
        })),
      }));
    },
    enabled: isReady,
    staleTime: 60_000,
  });
}

export interface IFirmQuotaBalance {
  issued_kg: number;
  used_kg: number;
  remaining_kg: number;
}

/**
 * Per-firm remaining quota (issued − committed) for the SELECTED season, keyed
 * by export_firm id (as a string). Firms absent from the map have no allocation
 * → treat as zero remaining. Powers the firm-split editor's soft "no quota"
 * warning. Gated by quota_issuance view on the backend, so only the roles that
 * can edit firm splits fetch it (others pass enabled=false).
 *
 * Season-scoped since D11: a season's leftover quota expires with it rather
 * than carrying forward, so the balance shown must be the selected season's.
 */
export function useQuotaFirmBalances(
  productType: string,
  options: { enabled?: boolean } = {},
) {
  const { enabled = true } = options;
  const { seasonId, isReady } = useSelectedSeason();
  return useQuery({
    queryKey: ['quota-firm-balances', seasonId, productType],
    queryFn: async (): Promise<Record<string, IFirmQuotaBalance>> => {
      const params = new URLSearchParams({ product_type: productType });
      if (seasonId != null) params.set('season', String(seasonId));
      const { data } = await api.get<Record<string, IFirmQuotaBalance>>(
        `/export/quota-firm-balances/?${params.toString()}`,
      );
      return data;
    },
    enabled: enabled && isReady,
    staleTime: 60_000,
  });
}

export interface IQuotaFirmSummaryRow {
  export_firm: number;
  export_firm_name: string;
  active_issuance_count: number;
  issued_kg: number;
  used_kg: number;
  remaining_kg: number;
  /** ISO date (YYYY-MM-DD) of the earliest still-spendable allocation, or null. */
  nearest_expiry: string | null;
}

/**
 * "Which firm holds how much quota right now" — one row per export firm, for
 * the dashboard's Firm Quota tab. Same `remaining_kg` the firm-split hard block
 * reads, from the same backend service, so the tab and the gate agree.
 *
 * Takes `seasonId` as a PARAMETER and deliberately does NOT call
 * `useSelectedSeason()` like `useQuotaFirmBalances` above: the quota page owns
 * its own season dropdown, and mixing the two sources is exactly the split-
 * season bug commit 92480a9 fixed on the Firm Breakdown tab. Do not "tidy" this
 * into the global switcher.
 *
 * No date_from/date_to on purpose — quota lives roughly a month, so a period
 * filter would hide the live balance this tab exists to show.
 */
export function useQuotaFirmSummary(
  seasonId: number | undefined,
  productType: string,
  options: { enabled?: boolean } = {},
) {
  const { enabled = true } = options;
  return useQuery({
    queryKey: ['quota-firm-summary', seasonId, productType],
    queryFn: async (): Promise<IQuotaFirmSummaryRow[]> => {
      const params = new URLSearchParams({ product_type: productType });
      params.set('season', String(seasonId));
      const { data } = await api.get<IQuotaFirmSummaryRow[]>(
        `/export/quota-firm-summary/?${params.toString()}`,
      );
      // DRF renders DecimalField as a JSON number here, but the sibling quota
      // reads normalize defensively and summing a string would concatenate.
      return data.map((row) => ({
        ...row,
        active_issuance_count: Number(row.active_issuance_count) || 0,
        issued_kg: Number(row.issued_kg) || 0,
        used_kg: Number(row.used_kg) || 0,
        remaining_kg: Number(row.remaining_kg) || 0,
      }));
    },
    // Without this the first render sends `?season=undefined`, which
    // `resolve_season()` answers with a 404 — an error banner before the
    // seasons list has even resolved.
    enabled: !!seasonId && enabled,
    staleTime: 60_000,
  });
}

export interface ICreateIssuancePayload {
  issue_date: string;
  product_type: string;
  validity: string;
  notes?: string;
  allocations: Array<{ export_firm: number; kg_quota: number }>;
}

export function useCreateQuotaIssuance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: ICreateIssuancePayload): Promise<IQuotaIssuance> => {
      const { data } = await api.post<IQuotaIssuance>('/export/quota-issuances/', payload);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quota-issuances'] });
      qc.invalidateQueries({ queryKey: ['quota-dashboard'] });
      // Sheet firm-split editor reads these to hard-block no-quota firms; a new
      // issuance raises a firm's remaining, so refetch or it stays unselectable.
      qc.invalidateQueries({ queryKey: ['quota-firm-balances'] });
      qc.invalidateQueries({ queryKey: ['quota-firm-summary'] });
    },
  });
}

export function useDeleteQuotaIssuance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/export/quota-issuances/${id}/`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quota-issuances'] });
      qc.invalidateQueries({ queryKey: ['quota-dashboard'] });
      // Deleting a firm's only issuance drops its remaining to 0 → it must go
      // back to unselectable on the Sheet; refetch the balances.
      qc.invalidateQueries({ queryKey: ['quota-firm-balances'] });
      qc.invalidateQueries({ queryKey: ['quota-firm-summary'] });
    },
  });
}
