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

A Bitrix-style **visual dashboard** (redesigned from an earlier plain table): a horizontal
ranking bar chart followed by a responsive grid of per-user KPI cards, one row's worth of
data per active user, ranked by tasks completed in a selectable period (`today` / `week` /
`month` / `season`, `Segmented` control, reflected in `?period=` via `useSearchParams`).

## Data Source

`useTeamKpi(period)` → `GET /api/v1/core/team-kpi/?period=`. Full response shape (including
the `trend` field), the `overdue_now` window-independence caveat, and the `trend`
fixed-14-day-window caveat are documented in `.claude/rules/api-contract.md` ("Team KPI
leaderboard") and `reference/api-endpoint-map.md`. Refetches every 60 s (`refetchInterval`),
matching the backend's 60 s cache.

## Layout

**Ranking bar chart** (`TeamRankingChart`, in a `Card` titled `team_kpi.ranking_title`):
horizontal bars, top 10 users by `completed`, single-hue (`COLORS.primary`, no legend — one
metric across users), direct value labels at the bar end, sorted descending. Rows with
`completed === 0` are excluded from the chart. The whole chart card is **hidden** when no
row in the current period has any completions (`hasCompletions` check in `TeamKpi.tsx`) —
there is nothing meaningful to rank.

**Per-user cards** (`TeamKpiCard`, one per active user, `repeat(auto-fill, minmax(240px,
1fr))` grid, ranked same order as the roster) — each card shows:

| Element | Source field | Notes |
|---|---|---|
| Rank / medal | row index | 🥇🥈🥉 for ranks 1-3, plain number otherwise |
| Avatar | `user_name` initials | Up to 2 letters, `COLORS.primary` background |
| Role tag | `role` | Translated via `roles.{role}` |
| Completed (headline number) | `completed` | Large number, `fontSize 28` |
| On-time meter | `on_time_rate` | `Progress` line + **always-visible `%` label** (never color-alone); green ≥80%, orange below; `—` when `null` (no deadline-bearing completions in window) |
| Overdue now | `overdue_now` | **Not** period-scoped — current overdue count by role; orange when >0, `—` when 0 |
| Active | `active_seconds` | Formatted `Nh Nm`; sums `WorkSessionDaily` over the same window; `—` when 0 |
| Trend sparkline | `trend` | Single-hue line+area sparkline, `decorative` (aria-hidden), no axes; only rendered when at least one of the 14 days is nonzero |

## Files

| File | Role |
|------|------|
| `backend/apps/core/views_team_kpi.py` | `TeamKpiView` — request handling + 60s cache |
| `backend/apps/core/services_team_kpi.py` | `compute_team_kpi` / `parse_period` / `period_window` — the aggregation, incl. the `trend` 14-day pivot |
| `backend/apps/core/tests_team_kpi.py` | Endpoint + service tests |
| `frontend/src/pages/team/TeamKpi.tsx` | Page component — period switcher, error state, ranking chart, card grid |
| `frontend/src/components/team/TeamRankingChart.tsx` | Horizontal ranking bar chart |
| `frontend/src/components/team/TeamKpiCard.tsx` | Per-user card (medal, avatar, meter, sparkline) |
| `frontend/src/hooks/useTeamKpi.ts` | TanStack Query hook |
| `frontend/src/types/teamKpi.ts` | `ITeamKpiRow` (incl. `trend: number[]`) / `ITeamKpiResponse` / `TeamKpiPeriod` |

## Related

- [[../processes/comments-tasks]] — `Task.completed_by`, the field this leaderboard's
  `completed`/`on_time_rate` columns are attributed by.
- [[../processes/worklog]] — the `active_seconds` source (`WorkSessionDaily`) and the
  precedent for the "everyone sees everyone" visibility rule.
