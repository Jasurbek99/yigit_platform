import { useQuery } from '@tanstack/react-query';
import api from '@/services/api';
import type { ShipmentPhase } from '@/types';

export interface IBoardItem {
  id: number;
  cargo_code: string;
  phase: ShipmentPhase;
  owner_role: string | null;
  time_in_phase_seconds: number | null;
  tasks_done: number;
  tasks_total: number;
  late_count: number;
  in_progress_count: number;
  blocked_count: number;
}

export interface IBoardResponse {
  phases: ShipmentPhase[];
  columns: Partial<Record<ShipmentPhase, IBoardItem[]>>;
  phase_avg_seconds: Partial<Record<ShipmentPhase, number | null>>;
}

export interface IBoardFilters {
  country?: number;
  customer?: number;
  gapy_satys?: boolean;
  owner_role?: string;
  search?: string;
}

export function useShipmentBoard(filters: IBoardFilters = {}) {
  return useQuery<IBoardResponse>({
    queryKey: ['shipments', 'board', filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.country != null) params.set('country', String(filters.country));
      if (filters.customer != null) params.set('customer', String(filters.customer));
      if (filters.gapy_satys != null) params.set('gapy_satys', String(filters.gapy_satys));
      if (filters.owner_role) params.set('owner_role', filters.owner_role);
      if (filters.search) params.set('search', filters.search);
      const { data } = await api.get<IBoardResponse>(
        `/export/shipments/board/?${params.toString()}`,
      );
      return data;
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}
