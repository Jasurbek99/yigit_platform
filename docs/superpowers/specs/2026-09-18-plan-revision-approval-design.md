# Weekly Plan In-Week Revision Approval — Design

**Date:** 2026-09-18
**Status:** Approved in chat, spec pending review
**Module:** `greenhouse` (P3 weekly harvest plan), small touches in `core` + `export`

## Goal

Once a plan week has started, a greenhouse manager can still revise a day's plan, but:

1. the revision is capped at **±15%** of that cell's week-start baseline,
2. it only takes effect after an **export manager approves** it,
3. the approver sees the **± % change** before deciding,
4. every revision (pending / approved / rejected / superseded) is **recorded** in one place.

## Decisions (from Q&A, 2026-09-18)

| Question | Decision |
|---|---|
| When does approval start? | At **Monday 00:00 local** of the plan week. Before that, edits are free (today's behaviour). |
| What does "10–15%" mean? | Hard cap **±15%**, every in-week change needs approval, >15% refused. Cap lives in config. |
| Granularity | **Per cell** (one block, one day). |
| Value in use while pending | The **old approved value**. The new one is shown as pending. |
| % measured against | The cell's **week-start baseline**, cumulative (no ratcheting 15% at a time). |
| Empty cell filled in-week | Needs approval, **no % bound**. |
| Approvers | `export_manager`, `admin`, `boss`. Admin/boss direct edits need no approval. |
| Reason from the manager | Optional. |

## Relationship to ADR-017

ADR-017 removed the week-level approve/reject workflow ("submission is final"). This design does **not** bring
that back: first-time entry before the week starts stays final and unapproved. It adds approval only for
**in-week revisions**, at a different grain (per cell, per revision). Record it as **ADR-024**, which qualifies
ADR-017. Do not re-add the dropped `WeeklyHarvestPlan.status/approved_*/rejected_*` columns.

## Behaviour rules

1. **Mode switch, not a lock.** `_plan_edit_window_closed()` (open through the week's own Sunday 23:59:59) is
   unchanged. A new check `_plan_week_started(weekly_plan, now_utc)` (now ≥ Monday 00:00 local of the plan week)
   decides *how* a greenhouse manager's edit is applied: directly (not started) or as a change request (started).
   Past days of the current week stay editable, via the request path. A past week reopened with `grant-late-edit`
   also goes through the request path.
2. **Baseline is frozen lazily.** On the first in-week request for a cell, if `plan_baseline_value IS NULL` and
   `plan_value` is not NULL and not 0, copy `plan_value` into `plan_baseline_value`. A zero is not frozen, because
   it bounds nothing; the baseline re-derives from the next approved value. This is exact: after Monday 00:00 a
   manager's edit can't change `plan_value` without going through this path.
3. **Bound.** If the baseline is set and > 0: `|requested − baseline| / baseline ≤ plan_change_max_pct / 100`,
   otherwise `ValueError` → 400 (message names the allowed range, e.g. `8,500–11,500`).
   Baseline NULL (empty cell) or **0** (explicit zero): no bound and `change_pct = NULL`. A zero baseline gets no
   bound so a "no harvest" day can later get a harvest.
4. **One pending request per cell.** A new request marks the cell's existing pending request `superseded`.
5. **Withdraw.** If `requested == plan_value` (the currently approved value), the pending request is superseded
   and no new one is created.
6. **Clearing a cell in-week** (`plan_value: null`) is refused (400).
7. **Approve** (export_manager / admin / boss): writes `plan_value = requested_value`,
   `plan_submitted_at/by = request.requested_at/by`. `plan_state` is computed only if the cell was empty
   (first entry); a revision keeps its original `plan_state`. Writes an AuditLog `plan_value_set` row, marks the
   request `approved`, notifies the requester.
8. **Reject**: marks the request `rejected` with an optional note and notifies the requester. `plan_value` is untouched.
9. **Admin/boss direct edit in-week** (existing override-with-reason path): after writing, set
   `plan_baseline_value = value` and supersede any pending request on that cell.
10. Approving/rejecting is **not time-gated**: a request can be decided after its week ends. Closed-season writes
    still get 409 via `SeasonNotClosed`.
11. **Out of this flow:** `import_weekly_plan` / `import_harvest_plans` (admin tools that write `plan_value`
    directly) and the Daily Harvest Board (writes `forecast_value`, not plan).

## Data model

### New: `greenhouse.PlanChangeRequest`
File `backend/apps/greenhouse/models/plan_change_request.py`, re-exported in `models/__init__.py`.
Table `schema_table('export', 'plan_change_requests')` (same schema as the other plan tables).

| Field | Type | Notes |
|---|---|---|
| `entry` | FK `HarvestDayEntry`, CASCADE, `related_name='change_requests'` | |
| `baseline_value` | Decimal(10,2) null | Snapshot of the baseline at request time; NULL = empty cell |
| `current_value` | Decimal(10,2) null | `plan_value` at request time |
| `requested_value` | Decimal(10,2) | CheckConstraint ≥ 0 |
| `change_pct` | Decimal(6,2) null | `(requested − baseline) / baseline × 100`; NULL when there's no bound |
| `status` | CharField(12) | `pending` / `approved` / `rejected` / `superseded`, default `pending` |
| `reason` | CharField(500) blank, `**cyrillic_collation()` | Manager's optional reason |
| `requested_by` | FK User, SET_NULL, null, `related_name='+'` | |
| `requested_at` | DateTimeField, `default=timezone.now` | |
| `decided_by` | FK User, SET_NULL, null, `related_name='+'` | Also set on `superseded` (the user whose action superseded it) |
| `decided_at` | DateTimeField null | |
| `decision_note` | CharField(500) blank, `**cyrillic_collation()` | |

Constraints and indexes:
- `UniqueConstraint(fields=['entry'], condition=Q(status='pending'), name='uq_pcr_one_pending')`.
  **Verify it generates a filtered unique index on MSSQL** (mssql-django). If not, drop the constraint
  and rely on `select_for_update()` on the entry inside the service's `transaction.atomic()`.
- `Index(fields=['status', 'requested_at'])`. `ordering = ['-requested_at']`.

### Changed: `HarvestDayEntry`
- `plan_baseline_value` Decimal(10,2) null, CheckConstraint NULL or ≥ 0. Migration `greenhouse.0007`.

### Changed: `core.GreenhouseConfig`
- `plan_change_max_pct` Decimal(5,2), default `15.00`. Exposed on `GET/PATCH /core/greenhouse-config/`
  (admin PATCH, as for the other config fields).

### Changed: `export.Notification.KIND_CHOICES`
- Add `plan_change_requested`, `plan_change_approved`, `plan_change_rejected`.
  greenhouse already imports `Notification` under the documented temporary exception; no new reverse import.

## Service layer — `greenhouse/services/plan_change_service.py`

| Function | Purpose |
|---|---|
| `plan_week_start_utc(weekly_plan, tz) -> datetime` | Monday 00:00 local → aware UTC (mirrors `plan_week_cutoff_utc`) |
| `_plan_week_started(weekly_plan, now_utc) -> bool` | Mode switch for rule 1 |
| `request_plan_change(entry, value, user, reason='') -> PlanChangeRequest \| None` | Rules 2–6; notifies active `export_manager` users. Returns `None` on withdraw |
| `approve_plan_change(change, user, note='') -> PlanChangeRequest` | Rule 7; role check, `status == pending` check, atomic + `select_for_update` |
| `reject_plan_change(change, user, note='') -> PlanChangeRequest` | Rule 8 |
| `_supersede_pending(entry, user) -> None` | Used by rules 4, 5, 9 |

`set_plan_value()` stays the **only** runtime write path. In its `greenhouse_manager` branch, after the
existing assignment and window checks, `if _plan_week_started(...): return request_plan_change(...)`.
Its return type becomes `PlanChangeRequest | None`. The admin-like branch gains rule 9.
Notifications copy the `_notify_late_plan_submission` shape. Link:
`/export/plan?week={w}&year={y}&block={block_id}&changes=1`.

## API

All under `/api/v1/greenhouse/`. Decimals arrive as **strings** (model/declared `DecimalField`); the frontend
coerces them in the hook `queryFn`.

### `PATCH /day-entries/{id}/` (changed)
- Greenhouse manager, week started → **202 Accepted**, body = the entry (same shape as 200) with
  `pending_change` filled. Withdraw → 200 with `pending_change: null`.
- Out-of-bound / clearing → 400 `{"plan_value": "…allowed range 8,500–11,500…"}` (existing error shape).

### `HarvestDayEntrySerializer` (changed, read-only additions)
```json
{
  "plan_baseline_value": "10000.00",
  "pending_change": {
    "id": 41, "requested_value": "11500.00", "change_pct": "15.00",
    "requested_by_name": "Myrat", "requested_at": "2026-09-22T09:10:00+05:00"
  }
}
```
`pending_change` is `null` when there's no pending request. The list endpoint loads it with
`Prefetch('change_requests', queryset=…filter(status='pending').select_related('requested_by'), to_attr='pending_changes')`
so there's no N+1 (pinned by an `assertNumQueries` test).

### `GET /plan-change-requests/` (new)
Season-scoped (`SeasonScopedMixin`, anchor `entry__season`). Filters: `?status=`, `?year=`, `?week=`
(via `entry__weekly_plan`), `?block=`. Standard pagination. Reads: any authenticated user, like day-entries.
```json
{
  "id": 41, "entry": 1203, "block": 5, "block_code": "F", "entry_date": "2026-09-23", "weekday": 1,
  "baseline_value": "10000.00", "current_value": "10000.00", "requested_value": "11500.00",
  "change_pct": "15.00", "status": "pending", "reason": "",
  "requested_by": 17, "requested_by_name": "Myrat", "requested_at": "2026-09-22T09:10:00+05:00",
  "decided_by": null, "decided_by_name": null, "decided_at": null, "decision_note": ""
}
```

### `POST /plan-change-requests/{id}/approve/` and `/reject/` (new)
Body `{"note": "..."}` (optional). 200 → the updated item.
403 `{"error": ...}` for roles other than export_manager/admin/boss (superusers allowed).
400 `{"error": "Request is no longer pending."}`. 409 `season_closed` via `SeasonNotClosed`.

## Frontend

- **Types** (`types/index.ts`): `IPlanChangeRequest`, `PlanChangeStatus`; `IHarvestDayEntry` gains
  `plan_baseline_value` + `pending_change`; `IGreenhouseConfig` gains `plan_change_max_pct`.
- **Hooks** (`usePlanning.ts`): `usePlanChangeRequests({status, year, week})`, `useApprovePlanChange`,
  `useRejectPlanChange` (invalidate day-entries + plan-change-requests). `useUpsertDayEntry` shows an info
  toast "Sent for approval" on 202.
- **`HarvestCell` `planOnly` branch**: a pending badge `→ 11,500 (+15%) ⏳` (yellow) under the value.
  For a greenhouse manager on a started week, the edit input shows the allowed range and checks it client-side
  (the server stays authoritative). Extend `HarvestCell.planOnly.test.tsx`; its existing cases must stay green.
- **Change log (UI placement):** `WeeklyPlanGrid` has no tabs today, so the "Plan changes" view is a
  **toolbar button with a pending-count badge that opens a Drawer** (`components/PlanChangeRequestsDrawer.tsx`),
  not a tab. Columns: block, day, baseline, current, requested, ±% (green up / red down), requested by, reason,
  status, decided by / at, note. Default filter: `pending`, current week; can switch to all statuses / all weeks.
  Approve / Reject buttons (Reject opens an optional note) are shown only to export_manager / admin / boss;
  everyone else sees it read-only. `?changes=1` in the URL (the notification link) opens the drawer.
- Est. Trucks, totals and truck allocation keep reading `plan_value` (the approved value). No change.
- i18n keys in `en.json`, `ru.json`, `tk.json`.

## Known consequences

- A pending request on an **empty** cell keeps that manager's `weekly_plan` board task open until it's approved
  (ADR-021 checks for no blank `plan_value`).
- In-week revisions no longer fire `plan_late` / `plan_critical_late` notifications (the manager's edit doesn't
  write `plan_value`); `plan_change_requested` replaces them for that path.

## Testing

Backend — `apps/greenhouse/tests/test_plan_change_requests.py`:
- before Monday: a manager's edit writes directly, no request
- in-week: a request is created, `plan_value` is unchanged, baseline is frozen
- bound: +15% ok, −15% ok, +15.01% → 400; cumulative (approved 11,500 on a 10,000 baseline, then 12,000 → 400)
- empty cell and zero baseline: no bound, `change_pct` NULL
- a second request supersedes the first; `requested == current` withdraws; `null` in-week → 400
- approve by export_manager / admin / boss writes value + AuditLog + notification; GM / director → 403;
  approving a non-pending request → 400
- reject leaves `plan_value` and notifies
- admin direct in-week edit resets the baseline and supersedes pending
- regression: a GM can still revise past days of the **current** week (via request); a fully-past week is still
  locked; with `grant-late-edit` it goes through the request path
- list filters; day-entries list `assertNumQueries` with pending changes
- migration check that the filtered unique index exists (MSSQL)

Frontend: `HarvestCell` pending badge + range hint; drawer buttons by role; `planOnly` suite green.
Use `npx tsc --noEmit --ignoreDeprecations 5.0` (`npm run type-check` is broken).

## Docs to update

- `docs/ADR.md` — ADR-024 (qualifies ADR-017)
- `docs/obsidian/processes/weekly-harvest-planning.md` — rules, model, endpoints, roles table (export_manager: approver)
- `docs/obsidian/reference/api-endpoint-map.md`
- `.claude/skills/api-contract/SKILL.md` — the new endpoint section + the 202 on day-entries PATCH
- `CHANGELOG.md`, `BUILD_TEST_LOG.md`

## Out of scope (YAGNI)

Bulk approve, a weekly-total bound, Telegram/SMS notifications, auto-expiring stale pending requests.
