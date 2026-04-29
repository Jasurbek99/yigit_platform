import { useQuery } from '@tanstack/react-query';
import api from '@/services/api';

// ─── Period type ─────────────────────────────────────────────────────────────

export type BossPeriod = 'today' | 'week' | 'month' | 'season' | 'years5';

// ─── Response interfaces ──────────────────────────────────────────────────────

export interface IBossKpiCard {
  value: number;
  delta_pct: number | null;
  delta_abs: number | null;
  sparkline: number[];
  level?: 'ok' | 'warn' | 'alert';
  is_placeholder?: boolean;
}

export interface IBossKpis {
  revenue: IBossKpiCard;
  margin: IBossKpiCard;
  debt: IBossKpiCard;
  today_loaded: IBossKpiCard;
  in_transit: IBossKpiCard;
  quota_used: IBossKpiCard;
}

export interface IBossSummary {
  period: string;
  from: string;
  to: string;
  kpis: IBossKpis;
}

export interface IBossRevenuePoint {
  week_start: string;
  total_usd: number;
}

export interface IBossRevenue {
  current_season: IBossRevenuePoint[];
  previous_season: IBossRevenuePoint[];
}

export interface IBossDebtFirmAging {
  fresh: number;
  d30: number;
  d60: number;
  d90plus: number;
}

export interface IBossDebtFirm {
  firm_name: string;
  country: string;
  contracts: number;
  avg_days: number;
  aging: IBossDebtFirmAging;
  total_usd: number;
}

export interface IBossDebt {
  rows: IBossDebtFirm[];
  total_usd?: number;
  is_placeholder: boolean;
}

export interface IBossRouteRow {
  country_id: number | null;
  country_name: string;
  city_id: number | null;
  city: string;
  trucks: number;
  revenue_usd: number;
  cost_usd: number;
  margin_usd: number;
  margin_pct: number;
}

export interface IBossRoutePnl {
  rows: IBossRouteRow[];
  is_placeholder?: boolean;
}

export interface IBossCompliance {
  reports_overdue: number;
  quota_1_to_10: {
    compliant_firms: number;
    total_firms: number;
  };
  docs_by_13: {
    percent: number;
    ready: number;
    total: number;
  };
}

export interface IBossOpsPulse {
  en_route: number;
  at_border: number;
  in_market: number;
  loaded_today: number;
}

export interface IBossQuotaFirm {
  firm_id: number;
  firm_name: string;
  used_pct: number;
  level: 'ok' | 'warn' | 'alert';
}

export interface IBossQuotaGrid {
  rows: IBossQuotaFirm[];
}

export interface IBossBlock {
  block_code: string;
  block_name: string;
  plan_kg: number;
  actual_kg: number;
  pct: number;
  color_band: 'excellent' | 'good' | 'ok' | 'warn' | 'alert';
}

export interface IBossBlocksHeatmap {
  rows: IBossBlock[];
}

export interface IBossCustomerRow {
  customer_id: number;
  customer_name: string;
  country_name: string;
  trucks: number;
  revenue_usd: number;
  yoy_pct: number | null;
  is_rest?: boolean;
}

export interface IBossCustomerRest {
  trucks: number;
  revenue_usd: number;
  customer_count: number;
}

export interface IBossTopCustomers {
  top: IBossCustomerRow[];
  rest: IBossCustomerRest;
}

export interface IBossRiskFirm {
  firm_id: number;
  firm_name: string;
  debt_usd: number;
  debt_placeholder: boolean;
  bank_credit_usd: number;
  bank_credit_placeholder: boolean;
  quota_pct: number;
  risk_level: 'low' | 'med' | 'high';
}

export interface IBossRiskMatrix {
  rows: IBossRiskFirm[];
  is_placeholder?: boolean;
}

export interface IBossAlert {
  id: number;
  level: 'high' | 'med' | 'low';
  icon: string;
  /** i18n key for the localized title (e.g. boss_dashboard.alerts.kinds.quota_95) */
  title_key: string;
  /** raw notification kind code, used as a fallback if title_key is missing */
  kind: string;
  body: string;
  /** ISO-8601 timestamp; format relative to local clock + locale on the client */
  created_at: string;
  link: string | null;
}

export interface IBossAlerts {
  rows: IBossAlert[];
}

export interface IBossProductionRow {
  block_code: string;
  block_name: string;
  plan_kg: number;
  actual_kg: number;
  pct: number;
  monthly_plan_kg: number;
  monthly_actual_kg: number;
  monthly_pct: number;
}

export interface IBossProduction {
  rows: IBossProductionRow[];
  scope: 'daily' | 'seasonal';
}

export interface IBossExportMarketRow {
  block_code: string;
  export_kg: number;
  export_pct: number;
}

export interface IBossExportMarket {
  rows: IBossExportMarketRow[];
}

// ─── Fetcher ──────────────────────────────────────────────────────────────────

const fetcher = <T>(action: string, params: Record<string, string>): Promise<T> =>
  api.get<T>(`/export/boss/${action}/`, { params }).then((r) => r.data);

// ─── Hooks ────────────────────────────────────────────────────────────────────

export const useBossSummary = (period: BossPeriod) =>
  useQuery<IBossSummary>({
    queryKey: ['boss', 'summary', period],
    queryFn: () => fetcher<IBossSummary>('summary', { period }),
    staleTime: 60_000,
  });

export const useBossRevenue = (period: BossPeriod) =>
  useQuery<IBossRevenue>({
    queryKey: ['boss', 'revenue', period],
    queryFn: () => fetcher<IBossRevenue>('revenue', { period }),
    staleTime: 60_000,
  });

export const useBossDebt = (period: BossPeriod) =>
  useQuery<IBossDebt>({
    queryKey: ['boss', 'debt', period],
    queryFn: () => fetcher<IBossDebt>('debt', { period }),
    staleTime: 60_000,
  });

export const useBossRoutePnl = (period: BossPeriod) =>
  useQuery<IBossRoutePnl>({
    queryKey: ['boss', 'route_pnl', period],
    queryFn: () => fetcher<IBossRoutePnl>('route_pnl', { period }),
    staleTime: 60_000,
  });

export const useBossCompliance = (period: BossPeriod) =>
  useQuery<IBossCompliance>({
    queryKey: ['boss', 'compliance', period],
    queryFn: () => fetcher<IBossCompliance>('compliance', { period }),
    staleTime: 60_000,
  });

export const useBossOpsPulse = (period: BossPeriod) =>
  useQuery<IBossOpsPulse>({
    queryKey: ['boss', 'ops_pulse', period],
    queryFn: () => fetcher<IBossOpsPulse>('ops_pulse', { period }),
    staleTime: 60_000,
  });

export const useBossQuotaGrid = (period: BossPeriod) =>
  useQuery<IBossQuotaGrid>({
    queryKey: ['boss', 'quota_grid', period],
    queryFn: () => fetcher<IBossQuotaGrid>('quota_grid', { period }),
    staleTime: 60_000,
  });

export const useBossBlocksHeatmap = (period: BossPeriod) =>
  useQuery<IBossBlocksHeatmap>({
    queryKey: ['boss', 'blocks_heatmap', period],
    queryFn: () => fetcher<IBossBlocksHeatmap>('blocks_heatmap', { period }),
    staleTime: 60_000,
  });

export const useBossTopCustomers = (period: BossPeriod) =>
  useQuery<IBossTopCustomers>({
    queryKey: ['boss', 'top_customers', period],
    queryFn: () => fetcher<IBossTopCustomers>('top_customers', { period }),
    staleTime: 60_000,
  });

export const useBossRiskMatrix = (period: BossPeriod) =>
  useQuery<IBossRiskMatrix>({
    queryKey: ['boss', 'risk_matrix', period],
    queryFn: () => fetcher<IBossRiskMatrix>('risk_matrix', { period }),
    staleTime: 60_000,
  });

export const useBossAlerts = () =>
  useQuery<IBossAlerts>({
    queryKey: ['boss', 'alerts'],
    queryFn: () => fetcher<IBossAlerts>('alerts', {}),
    staleTime: 60_000,
  });

export const useBossProduction = (period: BossPeriod, scope: 'daily' | 'seasonal') =>
  useQuery<IBossProduction>({
    queryKey: ['boss', 'production', period, scope],
    queryFn: () => fetcher<IBossProduction>('production', { period, scope }),
    staleTime: 60_000,
  });

export const useBossExportMarket = (period: BossPeriod) =>
  useQuery<IBossExportMarket>({
    queryKey: ['boss', 'export_market', period],
    queryFn: () => fetcher<IBossExportMarket>('export_market', { period }),
    staleTime: 60_000,
  });
