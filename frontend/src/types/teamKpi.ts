// Team KPI leaderboard API shapes — mirror apps/core/views_team_kpi.py.

export type TeamKpiPeriod = 'today' | 'week' | 'month' | 'season';

export interface ITeamKpiRow {
  user_id: number;
  user_name: string;
  role: string;
  completed: number;
  on_time_rate: number | null;
  overdue_now: number;
  active_seconds: number;
  trend: number[]; // 14-day daily completed count, oldest -> newest
}

export interface ITeamKpiResponse {
  period: TeamKpiPeriod;
  results: ITeamKpiRow[];
}
