import { useQuery } from '@tanstack/react-query';
import api from '@/services/api';
import { useSelectedSeason } from '@/hooks/useSeasonParam';

// ─── Response interfaces ──────────────────────────────────────────────────────

export interface IDashboardSeason {
  id: number;
  name: string;
}

export interface IDashboardStatItem {
  value: number;
  delta_7d?: number;
}

export interface IDashboardStats {
  total: IDashboardStatItem;
  in_transit: IDashboardStatItem;
  selling: IDashboardStatItem;
  completed: IDashboardStatItem;
  no_report: IDashboardStatItem;
  quota_firms: IDashboardStatItem;
}

export interface IDashboardWeeklyPlan {
  week: number;
  tons: number;
  blocks: number;
}

export interface IDashboardAlerts {
  no_report_count: number;
  quota_exceeded_count: number;
  docs_pending_count: number;
  weekly_plan: IDashboardWeeklyPlan | null;
}

export interface IDashboardCity {
  city: string;
  trucks: number;
}

export interface IDashboardRoute {
  country_id: number;
  country_name: string;
  trucks: number;
  percent: number;
  cities: IDashboardCity[];
}

export interface IDashboardActiveShipment {
  id: number;
  shipment_code: string;
  customer_name: string;
  country_name: string;
  city_name: string;
  status_display: string;
  phase: string;
  weight_net: number;
  departed_at: string | null;
  location: string | null;
}

export interface IDashboardSummary {
  season: IDashboardSeason | null;
  stats: IDashboardStats;
  alerts: IDashboardAlerts;
  routes: IDashboardRoute[];
  active_shipments: IDashboardActiveShipment[];
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useDashboardSummary() {
  const { seasonId, isReady } = useSelectedSeason();
  return useQuery<IDashboardSummary>({
    queryKey: ['dashboard', 'summary', seasonId],
    queryFn: () =>
      api
        .get<IDashboardSummary>('/export/dashboard/summary/', {
          params: seasonId != null ? { season: seasonId } : {},
        })
        .then((r) => r.data),
    enabled: isReady,
    staleTime: 60_000,
  });
}
