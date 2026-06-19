import { useQuery } from '@tanstack/react-query';
import api from '@/services/api';

// ─── Response interfaces ──────────────────────────────────────────────────────

export interface IClientsReportMonth {
  /** 'YYYY-MM' — matches the keys in each row's `monthly` map */
  key: string;
  year: number;
  /** 1-12 — frontend localizes the label from this + year */
  month: number;
}

export interface IClientsReportCell {
  trucks: number;
  /** tonnes (already divided by 1000 on the backend) */
  tonnage: number;
}

export interface IClientsReportRow {
  customer_id: number;
  customer_name: string;
  country_id: number | null;
  country_name: string;
  /** keyed by month 'YYYY-MM' */
  monthly: Record<string, IClientsReportCell>;
  total_trucks: number;
  total_tonnage: number;
  /** share of total trucks, percent (0-100, 1 decimal) */
  pct: number;
}

export interface IClientsReportTotals {
  monthly: Record<string, IClientsReportCell>;
  total_trucks: number;
  total_tonnage: number;
}

export interface IClientsReportBreakdown {
  name: string;
  trucks: number;
  tonnage: number;
}

export interface IClientsReportResponse {
  season: { id: number; name: string } | null;
  months: IClientsReportMonth[];
  clients: IClientsReportRow[];
  totals: IClientsReportTotals;
  by_country: IClientsReportBreakdown[];
  by_city: IClientsReportBreakdown[];
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export const useClientsReport = () =>
  useQuery<IClientsReportResponse>({
    queryKey: ['clients-report'],
    queryFn: () =>
      api.get<IClientsReportResponse>('/export/clients-report/').then((r) => r.data),
    staleTime: 60_000,
  });
