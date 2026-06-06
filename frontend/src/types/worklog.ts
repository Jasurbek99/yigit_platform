// Worklog API shapes — mirror apps/core/views_worklog.py response payloads.

export interface IWorklogDayRow {
  id: string;
  user_id: number;
  user_name: string;
  role: string;
  work_date: string; // ISO date
  active_seconds: number;
  first_seen: string; // ISO datetime
  last_seen: string;  // ISO datetime
}

export interface IWorklogMeResponse {
  date_from: string;
  date_to: string;
  results: IWorklogDayRow[];
  total_active_seconds: number;
  today_active_seconds: number;
}

export interface IWorklogListResponse {
  date_from: string;
  date_to: string;
  results: IWorklogDayRow[];
}

export interface IWorklogTeamRow {
  user_id: number;
  user_name: string;
  role: string;
  active_seconds: number;
}

export interface IWorklogTeamResponse {
  date: string;
  results: IWorklogTeamRow[];
}
