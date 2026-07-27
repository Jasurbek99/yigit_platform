# "My tasks" role filter — design

**Date:** 2026-07-16
**Status:** approved, pending implementation plan
**Scope:** the **My tasks** page, `/api/v1/me/tasks/`, `/api/v1/me/kpi-today/`

## Naming — read this first

This codebase has two similarly-named pages. Confusing them sends the work to the wrong
screen, which already happened once while writing this spec:

| Menu label (what users say) | Route | File | In scope? |
|---|---|---|---|
| **My tasks** | `/me/board` | `pages/me/SelfBoard.tsx` | **YES** — this spec |
| **Board** | `/export/shipments/board` | `pages/export/ShipmentBoard.tsx` | No — untouched |

**My tasks** is per-user task kanban (`me.nav.board` → `"My tasks"`). **Board** is
shipments-by-status. The file name `SelfBoard` does not match its menu label; always
refer to the page as **My tasks**.

## Problem

Supervisors (`export_manager`, `boss`, `admin`, `director`, superusers) already receive
every role's tasks from `/api/v1/me/tasks/` — `views_me.py` skips the
`assignee_role=role` filter for them. But those tasks land in one undifferentiated
kanban with no way to tell whose work is whose. An admin cannot answer "what is the
warehouse team sitting on right now?"

There is a second, load-bearing problem. `useMyTasks` requests `page_size=1000`; its
comment states the cap was sized for **one role's** per-season backlog. Measured
2026-07-16:

| Scope | Count |
|-------|-------|
| All tasks | 1270 |
| Live (shipment not soft-deleted) | 1213 |
| `document_team` | 574 |
| `transport` | 339 |
| `warehouse_chief` | 148 |
| `export_manager` | 139 |
| `greenhouse_manager` | 61 |
| `sales_rep` | 8 |
| `seller` | 1 |

A supervisor's payload is **already truncated** — 1270 rows into a 1000-row cap,
ordered by `deadline, created_at`, so the tail silently drops. Every single role fits
comfortably under the cap on its own (largest: 574).

## Decision: filter server-side

`?assignee_role=<role>` on `/me/tasks/`, honored for supervisors only.

A client-side filter was rejected: it would slice an already-truncated set, showing
whichever of a role's tasks survived the global cut with no indication that any were
missing. A filter that lies is worse than no filter.

Raising the cap to 2000 was also rejected: 1270 is one season's growth from the cliff,
and it makes the board slower for everyone to paper over a problem the role filter
solves properly.

Server-side filtering means a selected role's tasks are fetched as their own query
(`assignee_role=X`, ~574 rows at worst) instead of being sliced out of a truncated
all-roles payload. The filtered view is therefore **complete**. That is the design's
actual value: not nicer filtering, but the only way to see a truthful picture of one
role.

**Precise semantic — the supervisor view is a superset, not a mirror.** A supervisor
filtering by role X gets `assignee_role=X` with no `assignee_user` clause. A regular user
of role X additionally filters `assignee_user IS NULL OR = self`, so they do *not* see
role-X tasks another user has personally picked up. The supervisor sees those too. This
is the intended oversight semantic — a supervisor asking "what is this role sitting on?"
wants picked-up work included — but it means the view is **not** identical to that role's
own screen. In practice the gap is small: `assignee_user` is null for most tasks.

### Explicit non-goal

The default "no role selected" view stays as-is: all roles, still truncated at 1000.
That is a pre-existing issue, out of scope here, and the role filter must not be
described as fixing it. When a role **is** selected, the view is correct.

## Components

### Backend — `apps/core/views_me.py`

`MeTaskListView.get`: read `assignee_role` from query params. Apply only when the caller
is a supervisor or superuser — the existing `is_supervisor` flag already computes this.
Regular users keep their hard `assignee_role=role` lock; the param is ignored for them,
never widening their view. Validate against `ROLE_CHOICES`; unknown role → 400.

`MeKpiTodayView.get`: accept the same `assignee_role` param under the same supervisor
gate, replacing the hardcoded `assignee_role=user.role` in `_compute_kpi`. The cache key
must include the effective role (`me:kpi-today:{user.id}:{role}`) — otherwise an admin
switching roles poisons their own cached tiles for 60s, and the tiles show a different
role's numbers than the columns below.

### Frontend — the My tasks page (`pages/me/SelfBoard.tsx`)

A role `Select` in the existing toolbar, beside the current phase filter (mirror that
component's props and sizing). Rendered **only** for supervisors — a regular user can
only ever see their own role, so the control would be a dead input. `allowClear`; cleared
= current all-roles behavior.

`useMyTasks(role)` and `useMyKpiToday(role)` take the role and include it in the
TanStack Query key, so each role caches independently and switching back is instant. The
60s `refetchInterval` is unchanged.

Options come from the existing `ROLE_CHOICES` (`constants/roles.ts`), which already
carries `labelKey` → `roles.*` i18n keys for all 14 roles. Only the filter's own
label/placeholder need new keys, in all three of `tk.json` / `ru.json` / `en.json`.

## Data flow

```
admin selects "warehouse_chief"
  → useMyTasks('warehouse_chief')  → GET /me/tasks/?page_size=1000&assignee_role=warehouse_chief
  → useMyKpiToday('warehouse_chief') → GET /me/kpi-today/?assignee_role=warehouse_chief
  → 148 tasks, complete (well under cap) → existing column split unchanged
```

The kanban columns, drag-drop, drawer, and history split are untouched — they consume
`ITaskListItem[]` exactly as today. `assignee_role` already exists on that type
(`types/index.ts:1563`), so no type changes.

## Error handling

- Unknown/invalid role → 400, standard `{ "error": ... }` shape.
- Non-supervisor sending `?assignee_role=` → silently ignored, own-role lock holds.
  Not an error: the param is meaningless rather than forbidden for them.
- Role with zero tasks → empty columns, existing empty state. Not an error.

## Testing

Backend (`apps/core` or `apps/export/tests_task_api.py`, following existing layout):
- supervisor + `?assignee_role=X` → only X's tasks
- supervisor, no param → all roles (unchanged behavior)
- **non-supervisor + `?assignee_role=X` → still only their own role** — the security-
  relevant case; the param must not widen a regular user's view
- unknown role → 400
- KPI honors the param for supervisors, ignores it for regular users
- KPI cache key varies by role — two sequential requests with different roles return
  different payloads

Frontend: role `Select` renders for supervisor, absent for regular user.

## Out of scope

- **The Board page** (`/export/shipments/board`, `ShipmentBoard.tsx`) — untouched.
  Confirmed with the user 2026-07-16: My tasks only.
- Fixing the all-roles truncation (see non-goal above)
- Any TaskRule config UI
- Grouping/swimlanes by role on one screen — this is a filter, one role at a time
