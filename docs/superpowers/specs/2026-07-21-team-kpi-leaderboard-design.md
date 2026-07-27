# Team KPI Leaderboard — Design Spec

**Date:** 2026-07-21
**Status:** Approved (design), pending implementation plan
**Author:** brainstormed with Claude Opus 4.8

## Summary

A public, Bitrix24-style per-user leaderboard ranking every user by **tasks completed**,
with on-time rate, current overdue count, and active hours as context. Lives on a new page
(`/team/kpi`) linked from the left sidebar next to Worklog. Visible to every authenticated
user ("radical transparency", the same policy already applied to the Worklog page).

This is the platform's **first per-user task metric.** Today all task metrics
(`/api/v1/me/kpi-today/`, `services/kpi.py`) aggregate by `assignee_role` only, and task
completion is completely anonymous. The core enabler is a new `Task.completed_by` field.

## Motivation

Task completion currently records no actor: `Task` has no `completed_by`, there is no task
audit log, and `assignee_user` is structurally NULL for every shipment task (no claim/pick-up
endpoint exists). A leaderboard of "tasks completed per user" therefore cannot be built from
existing data — the schema must change first.

## Key decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | **Add `Task.completed_by` FK**, populate at completion sites (not derive from AuditLog) | Only option where the number means what the label says. AuditLog-join is a fuzzy heuristic with no FK → miscounts on concurrent edits. |
| 2 | **Forward-only** — no backfill | Task completion was never attributed; there is no honest source to backfill from. Board starts empty and fills from first post-deploy completion. |
| 3 | **"No user in scope → counts toward nobody"** (`completed_by` stays null) | Honest over invented. Better to under-count than credit the wrong person on a public board. |
| 4 | **Fully public** (any authenticated user) | Consistent with the existing Worklog leaderboard's "radical transparency" policy. |
| 5 | **Flat ranked list**, all users, sorted by completed desc | User's explicit choice. (Trade-off acknowledged: task roles are unevenly sized, so cross-role comparison partly ranks role volume — mitigated by showing on-time % alongside.) |
| 6 | **Period switcher**: Today / Week / Month / Season | User's explicit choice. |
| 7 | **New page + sidebar entry**; Worklog kept as the daily drill-down; active hours shown as a secondary line on each row | Cards give the at-a-glance picture with work-hours context ("42 tasks in 31 h" reads very differently from "42 tasks in 8 h") without deleting Worklog's per-day view. |

## Attribution model (foundation)

New field on `Task` (`apps/export/models/task.py`):

```python
completed_by = models.ForeignKey(
    'core.User', on_delete=models.SET_NULL, null=True, blank=True,
    related_name='completed_tasks',
    help_text='User credited with completing this task; null when no user was in scope.',
)
```

Populated at the five sites that set `state=DONE`:

| Site (`apps/export/...`) | Credited user |
|---|---|
| `services/task_rules.py:resolve_for_shipment` (auto-complete on field fill — **the dominant path**) | `getattr(shipment, 'updated_by', None)` |
| `services/task_rules.py:close_sales_report_task` | the `user` arg already passed in |
| `views.py:TaskViewSet.complete` (manual "Done" button) | `request.user` |
| `services/weekly_plan_tasks.py:_resolve_task` | `task.assignee_user` (set at creation) else null |
| `services/local_sell_plan_tasks.py:_resolve_task` | `task.assignee_user` (always null today) else null |

**Verified precondition (the highest-risk assumption, confirmed before design sign-off):**
On the Sheet PATCH flow, the view calls `serializer.save(updated_by=request.user)`
(`views.py:461`) *before* `Shipment.save()` runs `resolve_for_shipment(self)`
(`shipment.py:345-348`). So `shipment.updated_by` is the editing user at the moment tasks
auto-complete. Precedent: `auto_advance_if_ready` already reads
`getattr(shipment, 'updated_by', None)` (`services/shipment.py:396`). The plumbing exists;
only the crediting assignment inside `resolve_for_shipment` is missing.

Each affected `task.save(update_fields=[...])` call must add `'completed_by'` to its
`update_fields` list, or the write is silently dropped.

## Data model changes

- `Task.completed_by` FK (above). One migration. No index needed initially — the leaderboard
  query groups by `completed_by` over a bounded date window; add an index only if the query
  proves slow at scale.
- No change to `ShipmentComment` — comment-tasks (`done_by`) are **out of scope** for v1. (They
  already carry an actor; folding them in is a possible v2, noted below.)

## API

### `GET /api/v1/core/team-kpi/?period=week`

`period` ∈ `today | week | month | season` (default `week`). Window computed in
`Asia/Ashgabat` (reuse the existing `_today_midnight_utc` helper pattern from `views_me.py`;
week = ISO week, season = active `Season` bounds).

Response:

```json
{
  "period": "week",
  "results": [
    {
      "user_id": 12,
      "user_name": "Soltanmyrat",
      "role": "loading_dept_head",
      "completed": 42,
      "on_time_rate": 0.88,
      "overdue_now": 3,
      "active_seconds": 111600
    }
  ]
}
```

- **`completed`** — `count(Task WHERE completed_by=user AND state=done AND completed_at ∈ window)`.
- **`on_time_rate`** — `count(completed_at <= deadline) / count(deadline IS NOT NULL)` within
  the same window; `null` when the user completed nothing with a deadline. Same formula as
  `views_me.py:_compute_kpi`.
- **`overdue_now`** — current-state, **window-independent**:
  `count(Task WHERE assignee_role ∈ task_roles_for(user.role) AND deadline < now AND state NOT IN (done, cancelled))`.
  (Overdue is a role-window concept — a task nobody has completed yet has no `completed_by` —
  so it is attributed by role, not by `completed_by`. This asymmetry is intentional and the
  column is labelled "Overdue now".)
- **`active_seconds`** — `Sum(WorkSessionDaily.active_seconds_total)` over the window, joined
  per user (reuse the Worklog aggregation).

**Roster:** all active users, including those with zero completions (LEFT side is the user
roster, like `WorklogTeamView`), sorted `(-completed, user_name)`. Zeros appear at the bottom.

**Query hygiene:** single grouped query for completions/on-time (group by `completed_by`),
single grouped query for overdue (group by role → mapped to users), single grouped query for
active_seconds. Merge in Python by user_id. No N+1. Cache 60 s, key
`team-kpi:{period}` (no per-user component — the board is identical for everyone).

**Access:** any authenticated user. No role gate (matches `WorklogTeamView`).

Route registered under `apps/core/urls/` alongside the worklog routes.

## Frontend

- **Page:** `frontend/src/pages/team/TeamKpi.tsx` (route `/team/kpi`), lazy-loaded like other
  pages.
- **Sidebar:** add an entry next to Worklog. i18n keys in all three files
  (`tk`/`ru`/`en`): `nav.team_kpi`, plus page keys (`team_kpi.title`, column headers,
  period-switcher labels).
- **Hook:** `frontend/src/hooks/useTeamKpi.ts` — TanStack Query, key
  `['team-kpi', period]`, 60 s `staleTime`/`refetchInterval` (mirrors `useWorklog`).
- **Layout:** antd `Table` following the Worklog page pattern
  (`pages/worklog/WorklogPage.tsx`) — `#` rank column, name + role `Tag`, `completed` as the
  bold headline number, `on_time_rate` rendered `Math.round(rate*100)%` colored
  `COLORS.success` if `>= 0.8` else `COLORS.orange` (`'—'` when null), `overdue_now`,
  `active_seconds` via `formatHm()`. `defaultSortOrder: 'descend'` on `completed`.
- **Period switcher:** antd `Segmented` (Today / Week / Month / Season) above the table,
  reflected in the URL via `useSearchParams` (`?period=`), consistent with existing filter
  conventions.
- All strings via `t('...')`; no hardcoded text (i18n rule).

## Out of scope (v1)

- Comment-task (`ShipmentComment.done_by`) completions folded into the count → **v2**.
- Per-role grouping / fair cross-role normalization → deliberately not done (user chose flat).
- Backfill of historical completions → impossible (no attributed source).
- Avg completion time on the card → excluded; `started_at` measures "first field touched",
  not effort, and misleads on a public board.
- Redirecting/retiring the Worklog page → kept as-is.

## Testing

- **Backend:** attribution tests — auto-complete via Sheet PATCH credits the editing user;
  manual `complete` credits `request.user`; "no user in scope → `completed_by` null"; each
  `update_fields` includes `completed_by`. API tests — period windowing (today/week/month/
  season), on-time formula incl. null case, overdue-now is role-based & window-independent,
  zero-completion users present and sorted last, cache key per period.
- **Frontend:** `npx tsc --noEmit --ignoreDeprecations 5.0` clean (the `type-check` script is
  broken — see memory). Render test of the table with mock data incl. null on-time and zero rows.

## Risks

1. **Auto-complete crediting** — mitigated/verified above; the only residual risk is a
   completion path where `shipment.updated_by` is genuinely null (e.g. a management-command
   reconcile with no user) → those correctly count toward nobody by design.
2. **Gameability** — raw completed count partly reflects truck throughput, not effort;
   on-time % on the same row is the counterweight. Accepted, documented, public policy.
3. **Bulk sheet-cell writes** (`views.py:2102, 2343`) bypass `Shipment.save()` and set
   `updated_by_id` directly — confirm during planning whether these paths run
   `resolve_for_shipment`; if they do, they must also carry the user into `completed_by`.
