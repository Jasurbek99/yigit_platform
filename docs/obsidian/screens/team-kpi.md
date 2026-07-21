---
title: Team KPI Leaderboard
tags: [screen, frontend, tasks, kpi, team-kpi]
related: [[../processes/comments-tasks]], [[../processes/worklog]], [[../screens/self-board]]
---

# Team KPI Leaderboard

## What Is This Screen?

Route: `/team/kpi`. Nav label `nav.team_kpi` (Trophy icon), visible to every role — same
**radical-transparency** rule as the [[../processes/worklog|Worklog]] page: everyone sees
everyone's numbers, including their own.

A Bitrix-style leaderboard: one row per active user, ranked by tasks completed in a
selectable period (`today` / `week` / `month` / `season`, `Segmented` control, reflected in
`?period=` via `useSearchParams`).

## Data Source

`useTeamKpi(period)` → `GET /api/v1/core/team-kpi/?period=`. Full response shape and the
`overdue_now` window-independence caveat are documented in `.claude/rules/api-contract.md`
("Team KPI leaderboard") and `reference/api-endpoint-map.md`. Refetches every 60 s
(`refetchInterval`), matching the backend's 60 s cache.

## Columns

| Column | Source field | Notes |
|---|---|---|
| # | row index | Rank within the current sort |
| User | `user_name` | |
| Role | `role` | Rendered as a `Tag`, translated via `roles.{role}` |
| Completed | `completed` | Default sort, descending; `—` when 0 |
| On-time % | `on_time_rate` | `—` when `null` (no deadline-bearing completions in window); green ≥80%, orange below |
| Overdue now | `overdue_now` | **Not** period-scoped — current overdue count by role, orange when >0 |
| Active | `active_seconds` | Formatted `Nh Nm`; sums `WorkSessionDaily` over the same window |

## Files

| File | Role |
|------|------|
| `backend/apps/core/views_team_kpi.py` | `TeamKpiView` — request handling + 60s cache |
| `backend/apps/core/services_team_kpi.py` | `compute_team_kpi` / `parse_period` / `period_window` — the aggregation |
| `backend/apps/core/tests_team_kpi.py` | Endpoint + service tests |
| `frontend/src/pages/team/TeamKpi.tsx` | Page component |
| `frontend/src/hooks/useTeamKpi.ts` | TanStack Query hook |
| `frontend/src/types/teamKpi.ts` | `ITeamKpiRow` / `ITeamKpiResponse` / `TeamKpiPeriod` |

## Related

- [[../processes/comments-tasks]] — `Task.completed_by`, the field this leaderboard's
  `completed`/`on_time_rate` columns are attributed by.
- [[../processes/worklog]] — the `active_seconds` source (`WorkSessionDaily`) and the
  precedent for the "everyone sees everyone" visibility rule.
