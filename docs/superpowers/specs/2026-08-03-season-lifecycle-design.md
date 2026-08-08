# Season Lifecycle — Open, Close, Switch

**Date:** 2026-08-03
**Status:** Design proposed — pending review
**Related:** ADR-0005 (Operational/Archive split), AD-15 (admin role separation)

---

## Problem

`core.Season` exists today as little more than a label. It has `is_active`, and that single
boolean is doing two unrelated jobs:

1. **Write target** — which season new shipments get stamped with.
2. **Read scope** — which season's data an endpoint returns.

There is no way to close a season, no way to open the next one atomically, and no way for a
user to look back at a previous season. Closed-season data stays mixed into every board,
list, and dashboard forever.

We need:

- Close a season. Its data disappears from all default views and becomes read-only.
- Open a new season. New rows go to it.
- Switch to a past season and browse it, if permitted.

## Non-goals

- Retroactively season-stamping `Notification` rows (no shipment FK — see §5.3).
- Season-scoping `AuditLog` (generic `model_name`/`object_id`, no joinable FK — see §5.3).
- Migrating existing rows between seasons. Closing does not move data.
- Multi-season concurrent write. Exactly one season is writable at a time.

---

## 1. Decisions

| # | Question | Decision |
|---|---|---|
| D1 | What does "closed" mean? | **Frozen + hidden.** Hidden from all default views; visible when explicitly selected; every write blocked. |
| D2 | Unfinished rows at close time? | **Left as-is and hidden** with everything else. The close dialog warns with counts but does not block. |
| D3 | Who can view a closed season? | **Per-permission**, admin-configurable via the existing role/resource registry. |
| D4 | New `status` column? | **No.** State is derived from `is_active` + `closed_at`. A `status` property is exposed on the API only. |
| D5 | Relationship to `is_archived`? | **Orthogonal, with precedence.** Season scope applies first; inside a closed season the archive split is bypassed. |
| D6 | Is the selected season in the URL? | **Yes.** Zustand holds it, `useSearchParams` mirrors it, so deep links are honest. |
| D7 | What do lists return when NO season is active? | **Fail closed** — empty, with a "no active season" state. Added 2026-08-03 after implementation review; see §3.1. |
| D8 | Does browsing a closed season bypass `is_archived`? | **No — both permissions required.** Reverses the original §9 rule 3; see §9.1. |
| D10 | Should `QuotaIssuance` be covered by the freeze? | **Yes — add a `season` FK.** Added 2026-08-05 after Task 9's review found issuances stay editable after a close. ~~Freeze only: read-scoping stays off.~~ **Superseded by D11.** |
| D11 | Do quotas cross season boundaries at all? | **No — never.** Ruled 2026-08-06 during user testing, reversing D10's read-scoping exemption. Applies to **both** display and consumption: quota screens show only the selected season's issuances, **and** FIFO consumption stops at the season boundary — a shipment can only draw on its own season's quota. Leftover issuances simply expire with the season. See §4.7. |

### D3 implementation note

`RoleResourcePermission` has a fixed action vocabulary — `can_view`, `can_create`,
`can_edit`, `can_delete`. There is no room for a custom `view_closed` action without a
schema change. So the permission becomes a **new resource** in `RESOURCE_REGISTRY`:

```python
('closed_season', 'Browse closed seasons'),
```

`can_view` on that resource = may select a closed season in the switcher. The other three
actions are meaningless for it and are never granted (closed seasons are read-only by D1).

Seeded default: granted to `admin`, `director`, `boss`, `export_manager`, `finansist` —
matching the existing `_ARCHIVE_VIEW_ROLES` tuple at `apps/export/views.py:190`. Admins can
change it per role afterwards without a code change, which is the point of D3.

---

## 2. Model

`apps/core/models/products.py` — `Season` gains two fields:

```python
closed_at = models.DateTimeField(null=True, blank=True)
closed_by = models.ForeignKey(
    'core.User', on_delete=models.PROTECT, null=True, blank=True,
    related_name='closed_seasons',
)
```

State is derived, not stored:

| State | Condition | Meaning |
|---|---|---|
| `UPCOMING` | `closed_at IS NULL` and `is_active = False` | Created, not yet opened. No rows point at it. |
| `ACTIVE` | `is_active = True` | The write target. Exactly one at any time. |
| `CLOSED` | `closed_at IS NOT NULL` | Frozen and hidden. `is_active` is always `False` here. |

Exposed to the API as a read-only `status` property. No new column, so no ambiguity about
which of two flags wins.

### Single-active invariant

```python
class Meta:
    constraints = [
        models.UniqueConstraint(
            fields=['is_active'],
            condition=models.Q(is_active=True),
            name='uq_season_single_active',
        ),
    ]
```

Filtered unique indexes are already used against MSSQL in this codebase
(`apps/contracts/models/contract.py:155`, `apps/export/models/sheet_settings.py:474`), so
mssql-django emits this correctly. The ADR previously *assumed* one-active-season; this
makes it enforceable at the database.

`open_season()` still deactivates the incumbent inside the same transaction — the constraint
is the backstop, not the mechanism.

### DDL

`database/ygt_platform_ddl_v5_1.sql` is the schema source of truth per `CLAUDE.md`. It gets
a patch adding `closed_at`, `closed_by_id`, and the filtered index alongside the Django
migration.

---

## 3. `apps/core/seasons.py` — one home for season resolution

Today `Season.objects.filter(is_active=True)` appears in at least nine places, with
inconsistent tie-breaks (some add `.order_by('-start_date')`, some do not):

| File | Line | Job it is doing |
|---|---|---|
| `export/services/shipment.py` | 576 | write target |
| `export/views.py` | 1762 | write target |
| `export/management/commands/import_shipments.py` | 510–512 | write target |
| `export/views.py` | 1029 | read scope (sheet) |
| `export/views.py` | 3083 | read scope (board) |
| `export/views.py` | 3207–3208 | read scope (phase averages) |
| `export/services/dashboard_summary.py` | 34 | read scope |
| `export/services/boss_analytics.py` | 62 | read scope |
| `export/services_quota.py` | 413 | read scope |

All nine are replaced. `core/` is upstream of every other app, so this is the only legal
home for it.

```python
def get_active_season() -> Season | None:
    """The write target. Deterministic — the filtered unique index guarantees
    at most one row, so no tie-break is needed."""

def resolve_season(request) -> Season | None:
    """The read scope. Reads ?season=<id>; validates it exists and, if closed,
    that the user holds closed_season.can_view. Falls back to the active season."""

def can_view_closed(user) -> bool:
    """RoleResourcePermission(resource='closed_season').can_view, or superuser."""

def assert_season_open(season: Season | None) -> None:
    """Raise SeasonClosedError if the season is closed. Used by the write guards."""
```

Plus a viewset mixin:

```python
class SeasonScopedMixin:
    season_field = 'season'   # override per viewset, e.g. 'shipment__season'

    def apply_season_scope(self, qs):
        season = resolve_season(self.request)
        if season is None:
            return qs
        return qs.filter(**{self.season_field: season})
```

Hand-written `.filter(season_id=...)` per viewset is rejected: with ~20 endpoints, the one
you forget silently leaks closed-season data — which is precisely the requirement this
feature exists to satisfy.

### 3.1 No active season — fail closed (D7)

**Added 2026-08-03, after Task 5's implementation review exposed the gap.**

§6 covered the close→open interval for *writes* (`get_active_season()` returns `None` and
shipment creation fails with the existing error). It said nothing about *reads*, and the
naive reading — `resolve_season()` returns `None`, so apply no filter — fails **open**:
during the gap every closed season's data becomes visible to every user, regardless of
`closed_season.can_view`. That is the feature's core promise inverted, in exactly the state
an admin creates deliberately at end of season.

**Rule:** when `resolve_season()` returns `None`, a scoped list returns **nothing**, not
everything.

```python
def apply_season_scope(self, qs: QuerySet) -> QuerySet:
    season = resolve_season(self.request)
    if season is None:
        return qs.none()   # fail closed — never unfiltered
    return qs.filter(**{self.season_field: season})
```

Detail routes are unaffected: they bypass season scoping entirely (§4.5), so a direct link
still resolves during the gap. The switcher still works — a permitted user can select a
specific closed season by id and read it.

The frontend already has a `common.no_season` string in all three locales for the resulting
empty state.

`resolve_season` returning a 403 (rather than an empty queryset) when a user requests a
closed season without permission is a deliberate departure from the `?archived=true`
precedent at `views.py:270-278`. An empty list for a season the user can see in the
switcher would read as "this season has no data," which is a lie.

---

## 4. Endpoint classification

Every registered viewset falls into exactly one of three buckets. This table is the
implementation checklist for Phase 2 — an endpoint absent from it is a bug.

### 4.1 Scoped by direct season FK (`season_field = 'season'`)

| Route | Model | Note |
|---|---|---|
| `shipments` | `Shipment` | non-null FK |
| `harvest-plans` | `WeeklyHarvestPlan` | non-null FK |
| `day-entries` | `HarvestDayEntry` | non-null FK |
| `daily-plan` | `HarvestDayEntry` (board) | aggregate over day entries |
| `truck-allocations` | `TruckAllocation` | non-null FK |
| `truck-destination-selections` | `WeeklyDestinationSelection` | non-null FK |
| `local-sell-plans` | `WeeklyLocalSellPlan` | **nullable FK** — see §4.4 |
| `contracts` | `Contract` | **nullable FK** — see §4.4 |
| `harvest-plans/block-summary` | `HarvestDayEntry` (aggregate) | added 2026-08-03 — a sibling `@action`, ungated in the first pass; seasons run Sept→Aug so a past `(year, week)` **is** a closed-season request with no `?season=` needed |
| `shipments/overdue`, `shipments/my-sales-reports`, `shipments/my-pending-count` | `Shipment` | added 2026-08-03 per ruling — pre-existing, absent from the first pass; `overdue` calls `super().get_queryset()` and so bypasses the scoping block |
| `harvest-forecast/remaining/` | `HarvestDayEntry` (aggregate) | added 2026-08-07 — an `APIView`, so absent from the router-derived first pass. Filtered on `entry_date` alone; seasons run Sept→Aug so a past date **is** a closed-season request with no `?season=` needed — `block-summary` verbatim. See §4.9 |

`SalesRepCoverageViewSet` was listed here in the first draft and is **not** scopeable: its
`list()` builds rep→customer ownership inline from `User.objects.filter(role='sales_rep')` and
never calls `get_queryset()`. No season-bearing rows, nothing to scope.

### 4.2 Scoped by join (`season_field = 'shipment__season'`)

These have no season column of their own. They are the leak paths: skip one and closed-season
data stays visible through the child list.

| Route | Model | Anchor |
|---|---|---|
| `comments` | `ShipmentComment` | `shipment` |
| `tasks` | `Task` | `shipment` (`task.py:101`) |
| `quota-usage` | `QuotaUsageRecord` | `shipment` (`quota.py:238`) |
| `advances` | `FinansistAdvance` | `shipment` (`finance.py:66`) |
| `customs-expenses` | `CustomsExpense` | `shipment` (`finance.py:135`) |
| `sales` | `ContractSale` | `shipment` (nullable — legacy 2-Sales rows) |
| — | `Pallet` (`pallet.py:19`), `QualityDocument` (`quality.py:36`) | nested under shipment; inherit scope |

`sales-rep-coverage` and `clients-report` aggregate `Shipment` directly, so they belong to
§4.1 (`season_field = 'season'`) despite being report endpoints.

`ContractSale.shipment` is nullable for historical rows. Same treatment as §4.4.

### 4.3 Date-range endpoints

`dashboard`, `kpi`, `boss` already filter by explicit date ranges. They take the resolved
season's `start_date`/`end_date` as their default range instead of an ad-hoc
`is_active=True` lookup, then filter as they do today. No mixin.

`quota-dashboard` belongs to this bucket too (added 2026-08-07 — it was absent from the
original table). **A default is not enough here, and the distinction generalises to every
endpoint in this section:** where the client may also send `date_from`/`date_to`, the resolved
season must **clamp** the window, not merely seed it. See §4.9.

`kpi` (`KpiViewSet`, `views_kpi.py`) was never converted: its four actions use rolling
7/30-day windows rather than a season range, and `kpi_blocked_age()` has no window at all, so
a closed season's still-blocked tasks (D2 leaves them blocked) contribute to its aggregate. It
exposes counts and durations only — no season-identifiable row — and has no frontend consumer.
Left as-is pending the owner's own KPI testing; recorded here rather than silently omitted.

**`boss` is the exception, and the rule is precise:** the resolved season **parameterises**
the comparison rather than filtering it. `boss_analytics.py:325-355` returns `current_season`
*and* `previous_season` in one payload:

- `current_season` = the resolved season's date range.
- `previous_season` = the season immediately preceding the resolved one by `start_date`,
  **regardless of whether that season is closed**.

So selecting a closed 2025/2026 in the switcher makes it "current" and 2024/2025 "previous".
Applying the §4.1 mixin here would empty `previous_season` and silently break every
comparison chart, PDF, and Excel export downstream (`boss_pdf.py:273`,
`boss_excel.py:108/245`). See §4.5.

### 4.4 Nullable season FK

`Contract.season` and `LocalSellPlan.season` are `null=True`. `filter(season=X)` silently
drops nulls, so those rows would vanish from every view including the season they belong to.

**Phase 1 backfills them** from `start_date`/`end_date` against the row's own date field, then
the filter is strict. Rows whose date matches no season keep `season = NULL` and are surfaced
by a one-off management command report for manual assignment. The columns stay nullable —
making them non-null would require a data guarantee we do not have.

`ContractSale.shipment` is handled the same way (backfill where derivable, report the rest).

### 4.5 Explicit opt-out — must NOT be season-scoped

Scoping any of these breaks a working feature:

| Route / caller | Why |
|---|---|
| `boss` cross-season comparison | Parameterised, not filtered — see §4.3. The mixin must never be applied here; scoping it to one season empties `previous_season` and every comparison chart with it. |
| `admin/seasons` | The switcher's own data source. |
| `admin/firms`, `admin/import-firms`, `admin/users`, `admin/blocks`, `admin/truck-splits`, `admin/sheet-rows`, `admin/block-assignments` | Reference data. Season-independent. |
| `expense-categories`, `packing-templates`, `prices` | Reference data. `PriceEntry` is keyed `(date, city)` with no season. |
| ~~`quota-issuances`~~ | **Removed from the opt-out list by D11 (2026-08-06).** It is now season-scoped like any other direct-FK endpoint — see §4.7. |
| `domestic-sales` | No season FK; keyed by block/buyer/date. |
| Shipment detail-by-ID | Already bypasses season scoping at `views.py:1022`. A direct link must resolve. |

### 4.6 Structurally unscopeable — documented non-goals

| Route | Why it cannot be scoped |
|---|---|
| `notifications` | `Notification` has no shipment or season FK — only `user` and a `link` string (`notification.py:52-68`). |
| `audit-log` | `AuditLog` is generic: `model_name` + `object_id`, no FK (`audit.py:34-35`). Joining to season would require a per-model union. |

Consequence for notifications: a notification created before a season closed may link to a
shipment that now 403s. The link handler shows "This shipment belongs to a closed season"
rather than a bare error. Notifications are per-user and short-lived; a full retrofit is not
justified. **Revisit if operators report confusion.**

Consequence for audit-log: it is already management-only and is a compliance record. Leaving
it unscoped is arguably correct — an audit trail that hides itself is not an audit trail.

---

## 5. Write freeze

D1 makes a closed season immutable. Two layers, because not every write path goes through
DRF object permissions — the Sheet bulk-edit, the two-row Join, and status transitions all
bypass it.

**Layer 1 — DRF permission.** `SeasonNotClosed` in `apps/core/permissions.py`, applied to
mutating actions on every viewset in §4.1 and §4.2.

**Layer 2 — service guard.** `assert_season_open()` called inside:

- `Shipment.transition_to()` — catches every status change on every path.
- The Sheet bulk-update service.
- The two-row Join service.
- `create_shipment` / draft promotion.
- **Task and notification generators.** Per D2, unfinished tasks stay unfinished when a
  season closes, so `reconcile_tasks`, auto-close rules, and any poller over open tasks will
  otherwise keep emitting new rows about closed-season shipments. They skip shipments whose
  season is closed. Without this, `Notification` — which cannot be season-scoped (§4.6) —
  keeps surfacing links into hidden data indefinitely.

Layer 2 is what actually holds the invariant; layer 1 rejects earlier, before serializer
validation, so the user gets the state error rather than a field error. Both layers return
the same 409 below.

**Response contract:**

```json
409 Conflict
{"error": "season_closed", "season": "2025/2026", "closed_at": "2026-08-03T10:00:00Z"}
```

409 rather than 403: the request is well-formed and the user is authorised in principle —
it conflicts with the resource's state. This matches how the frontend needs to treat it
(show a banner, not a permission error).

---

## 6. `apps/core/services/season.py`

```python
def open_season(season: Season, user: User) -> None:
    """Make `season` the write target.

    Atomic: deactivates the incumbent and activates `season` in one transaction.
    Refuses if `season` is closed (reopening is not supported — see Rejected
    alternatives). Writes an AuditLog entry.
    """

def close_season(season: Season, user: User) -> None:
    """Freeze and hide `season`.

    Atomic: sets closed_at/closed_by, clears is_active. Writes an AuditLog entry.
    Does NOT touch any shipment, plan, or contract row (D2).
    Refuses if `season` is already closed.
    """

def close_preview(season: Season) -> dict:
    """Counts of rows that will be hidden, for the confirmation dialog.

    Returns {drafts, in_transit, open_tasks, unfinished_plans,
    draft_quota_usage}.
    Advisory only — never blocks the close (D2).
    """
```

Closing does not require a new season to exist. Between closing N and opening N+1 there is
no active season; `get_active_season()` returns `None` and shipment creation fails with the
existing "No active season found" error at `views.py:1763`. The frontend already has a
`no_season` string for this (`i18n/*.json`). This gap is legitimate — it is the state during
end-of-season bookkeeping.

---

## 7. API surface

**Season resource** — `SeasonViewSet` (`export/urls.py:76`, moving to core is out of scope):

| Endpoint | Permission | Purpose |
|---|---|---|
| `GET /api/v1/admin/seasons/` | `season.can_view` | + `status`, `closed_at`, `closed_by`, `is_active` |
| `GET /api/v1/admin/seasons/{id}/close-preview/` | `season.can_edit` | counts for the dialog |
| `POST /api/v1/admin/seasons/{id}/close/` | `season.can_edit` | freeze + hide |
| `POST /api/v1/admin/seasons/{id}/open/` | `season.can_edit` | make write target |

**Every scoped list endpoint** accepts `?season=<id>`. Omitted → active season. Closed +
no `closed_season.can_view` → 403.

**`GET /api/v1/auth/me/`** gains:

```json
{
  "active_season": {"id": 13, "name": "2026/2027", "status": "ACTIVE"},
  "can_view_closed_seasons": true
}
```

This is what seeds the frontend store on load, so it must come from `/me/` and not a second
request.

---

## 8. Frontend

**Store.** `useSeasonStore` (Zustand — cross-component UI state, per `frontend/CLAUDE.md`)
holding `selectedSeasonId`. Seeded from `/auth/me/` → `active_season.id`.

**URL reflection (D6).** A `useSeasonParam()` hook mirrors the store to `?season=` via
`useSearchParams`, and reads the URL on mount so a pasted link lands on the right season.
Without this, a shared link renders whatever season the recipient last selected — silently
wrong data with no visual difference.

**Query keys.** Every TanStack Query key gains `seasonId`. Non-negotiable: without it,
switching seasons renders the previous season's cached rows until refetch, which looks
exactly like the feature not working.

**Switcher.** In the header next to the locale switcher. Lists:
- the active season, always;
- upcoming seasons, never (nothing to show);
- closed seasons, only if `can_view_closed_seasons`.

**Read-only mode.** `useSeasonReadOnly()` returns true when the selected season is closed.
Drives:
- a persistent banner: *"Viewing closed season 2025/2026 — read-only"*;
- `disabled` on every create/edit/delete control;
- Sheet cells render non-editable.

The 409 handler is the safety net, not the mechanism — a user should never be able to click
something that 409s.

**Admin.** `SeasonsPage` (`frontend/src/pages/admin/SeasonsPage.tsx`) gains Close and Open
buttons, with a confirm modal showing `close-preview` counts:

> Closing 2025/2026 will hide 6 drafts, 14 shipments in transit, and 23 open tasks.
> They are not deleted and remain visible when this season is selected. Continue?

**i18n.** All new strings in `tk.json`, `ru.json`, `en.json`. Several keys already exist
(`common.no_season`, `seasons.*`) and are reused.

---

## 9. Interaction with `is_archived` (D5)

ADR-0005 already hides rows by default: the operational view is `is_archived=False`, and
`?archived=true` opens the archive behind a role gate (`views.py:268-281`). Season close adds
a second default-hide axis. Two independent hide filters that must both pass produce
"the row exists but nothing shows it" — the worst class of support bug.

**Rule:**

1. Season scope applies first — it answers *which season's data are we looking at*.
2. Inside the **active** season, the `is_archived` operational/archive split behaves exactly
   as it does today. No change.
3. Inside a **closed** season, the `is_archived` split is bypassed **only for users who also
   hold archive-view access**. Everyone else sees the non-archived rows of that season.

### 9.1 Why rule 3 requires BOTH permissions (D8)

**Revised 2026-08-03. The original rule 3 bypassed the archive split unconditionally; Task 5's
review showed that was wrong, and the ruling reversed it.**

The original text acknowledged one half of the coupling — that bypassing `is_archived` hands
archived rows to anyone with `closed_season.can_view` — and accepted it, mitigated by a warning
in the permission label.

The implementation review found the other half. Skipping the archive block skips **both** the
`_ARCHIVE_VIEW_ROLES` gate *and* the default `is_archived=False` filter
(`export/views.py:764-776`). So `closed_season.can_view` does not merely *imply* archive access —
it becomes a strict superset of the archive-view permission, silently, for any role it is
granted to.

That is unacceptable given D3. The entire point of making `closed_season` an admin-configurable
resource is that an admin can grant it to a sixth role later. Under the original rule, that
grant would quietly hand historical buyer prices to a role nobody decided should have them.

**Rule:** inside a closed season, archived rows are returned only if the user is ALSO in
`_ARCHIVE_VIEW_ROLES`. The two permissions stay genuinely distinct.

The cost is the "row exists but nothing shows it" confusion the original §9 was written to
avoid — a non-archive role browsing a closed season sees a partial view. That is the correct
trade: a partial view is a UI problem, a silent permission escalation is a security problem.
Mitigate it in the UI, not by widening the grant — when a closed season is selected and the
user lacks archive access, say so in the banner rather than leaving them to wonder.

The registry label still carries a warning, now accurate:

```python
('closed_season', 'Browse closed seasons (read-only)'),
```

**Kanban board consistency:** the board keeps `is_archived=False` unconditionally, so this rule
must be applied there too, or a closed season whose rows were archived renders a blank board.

---

## 10. Testing

**Phase 1**
- Filtered unique index rejects a second `is_active=True` row.
- `get_active_season()` returns `None` when no season is active.
- Backfill assigns `Contract.season` / `LocalSellPlan.season` by date; unmatched rows are
  reported, not silently dropped.

**Phase 2**
- For **each** endpoint in §4.1 and §4.2: closed-season rows absent by default; present with
  `?season=<closed id>` + permission; 403 with `?season=<closed id>` without permission.
  This is the table-driven test that makes the checklist real.
- Opt-out endpoints in §4.5 return identical results before and after a close.
- `boss` comparison still returns both `current_season` and `previous_season` after a close.
- Nullable-FK rows are not dropped from their own season.

**Phase 3**
- Every mutating verb on a closed-season row returns 409.
- `transition_to()` on a closed-season shipment raises.
- Sheet bulk-edit and Join reject closed-season rows.
- `close_season` does not modify any shipment row (D2) — assert row-level `updated_at`
  is untouched.
- `open_season` deactivates the incumbent atomically; failure rolls back both sides.

**Phase 4**
- Switching seasons refetches rather than serving cached rows.
- Deep link with `?season=` lands on that season.
- Read-only mode disables controls.

Suite gate: `python manage.py test apps.core apps.export apps.greenhouse apps.contracts`.
Note that `docs/PRE_EXISTING_TEST_FAILURES.md` records pre-existing failures — new failures
are judged against that baseline, not against zero.

---

## 11. Phasing

One commit per phase. Phases 1–3 are backend-only and ship independently; nothing is
user-visible until Phase 4.

| # | Scope | Ships |
|---|---|---|
| 1 | Model fields, migration, DDL patch, filtered index, `core/seasons.py`, replace 9 call sites, nullable backfill | No behaviour change |
| 2 | `SeasonScopedMixin` applied per §4.1–§4.3, opt-out list honoured, `?season=` param, table-driven tests | Read scoping live |
| 3 | Write freeze (both layers), `close`/`open`/`close-preview` endpoints, `closed_season` resource + seed, `/auth/me/` fields | Close/open usable via API |
| 4 | Switcher, store, URL param, query keys, read-only mode, SeasonsPage buttons, i18n | Feature visible |
| 5 | ADR entry (AD-16), `docs/obsidian/` updates, CHANGELOG, `BUILD_TEST_LOG.md` | Docs |

---

## 12. Rejected alternatives

**A `status` CharField alongside `is_active`.** Two columns encoding overlapping state means
a row can contradict itself (`status='CLOSED'` with `is_active=True`) and every reader must
know which wins. Deriving state from `is_active` + `closed_at` makes the contradiction
unrepresentable.

**Reusing `is_archived` as the close mechanism** (flip every shipment to archived on close).
Tempting — it merges the two hide axes rather than stacking them. Rejected because
`WeeklyHarvestPlan`, `HarvestDayEntry`, `TruckAllocation`, and `Contract` have no
`is_archived` column, so it only solves the problem for shipments; and `?archived=true`
cannot distinguish *which* closed season you are looking at, which is the actual request.

**Reopening a closed season.** Offered during design as a third option and not chosen. If it
is needed later, it is a small addition — an `open_season()` that clears `closed_at` behind
an admin-only permission plus an audit entry. Deliberately left out now: a season that can be
reopened is not frozen, and every downstream report would have to assume its inputs can still
change.

**Per-viewset hand-written `.filter(season_id=...)`.** ~20 endpoints; the one that gets
forgotten leaks exactly the data this feature hides. The mixin makes scoping the default and
opting out the explicit act, which is the correct direction for a safety property.

**Blocking close on unfinished rows.** Offered and not chosen (D2). Worth noting the
consequence honestly: closing a season with 14 trucks in transit makes them vanish from every
board at once. The `close-preview` dialog is the entire mitigation, so its copy matters more
than usual.

**Addendum 2026-08-08.** That claim had a hole while the §4.7 write-freeze correction was
being made: three of the four counters name work that is *hidden* and returns read-only, but a
`QuotaUsageRecord` still in `draft` becomes **permanently unapprovable** when its season closes
— approving is a write to frozen data and there is no unfreeze. The dialog said nothing about
it, at the one moment the decision turns irreversible. `close_preview()` now returns a fifth
key, `draft_quota_usage`, counted through `usage_season_q()` so no second "which season owns
this row" rule enters the codebase, and the modal renders a separate warning (not folded into
the body copy, which promises "nothing is deleted" — untrue of these rows). **The original four
keys stay a contract**: adding is safe, renaming or removing is not. On the dev database the
count is 151 for season 1 — 15 unlinked rows plus 136 linked to that season's shipments, the
latter already frozen-on-close before the §4.7 correction. Cost measured on live data: 9.5 ms
for the count, 41 ms for the whole preview.

---

## 4.7 Quotas never cross seasons (D11)

**Ruled 2026-08-06 during user testing. Supersedes D10's read-scoping exemption and the
`quota-issuances` row in §4.5.**

The original reasoning was that government quota issuances are consumed FIFO by date, so a
current-season shipment could legitimately draw down a prior-season issuance — and hiding
prior-season issuances would therefore break the balance the current season's usage records
were matched against.

The domain owner ruled otherwise: **quota never crosses a season boundary, in either
direction.** This applies to both halves:

1. **Display** — `quota-issuances` is season-scoped like any other direct-FK endpoint. The
   `season` FK added by D10 for the write freeze now also drives the read scope.
2. **Consumption** — FIFO matching stops at the season boundary. A shipment can only draw on
   an issuance belonging to its own season. Leftover issuance simply expires with the season
   rather than carrying forward.

**This changes numbers, not just visibility.** `compute_fifo_usage` and
`compute_firm_quota_balances` currently order by date with no season predicate; adding one
will shift existing balance figures wherever a shipment was previously matched against a
prior season's issuance. That is the intended correction, not a regression — but it means
quota balances computed before this change are not comparable with those computed after.

**Unlinked rows.** `QuotaUsageRecord.shipment` is nullable and 575 of 711 rows currently have
no shipment (they reach a season only through that link). Those rows need a season anchor of
their own under this rule.

**Correction (2026-08-06, during implementation): `QuotaUsageRecord` has no `issuance` FK.**
The paragraph above originally proposed backfilling from `issuance.issue_date`; there is no
such link. The model carries `usage_date` (non-null), `export_firm`, `kg_used`,
`product_type`, `notes`, a nullable `shipment`, and the approval/audit columns — nothing
else. The available signals are therefore `shipment.season` and `usage_date`, and the
implemented anchor (`services_quota.usage_season_q()`) uses them in that order of authority:
the shipment when linked — authoritative even when `usage_date` falls outside that season's
calendar range, which is real for 7 rows — and the date range otherwise. All 711 rows resolve
to the 2025-2026 season; none is left unassigned.

It is derived, not stored. A `season` column was considered and rejected: `freeze_season_of()`
reads `obj.season` **before** `obj.shipment.season`, so any creation site that failed to stamp
the new column would silently read a closed-season row as open, loosening the write freeze
D10 exists to provide. Deriving it leaves the freeze anchor exactly where it is.

**Correction (2026-08-08): deriving it for READS was not enough — the WRITE freeze had to be
taught the same derivation, and until this date it was not.** Reported by an automated
reviewer and reproduced: `freeze_season_of()` resolves `obj.season`, then `obj.shipment.season`,
and an unlinked `QuotaUsageRecord` has neither — so it returned `None`, which
`assert_season_open()` treats as *open*. Both layers of §5 were silent no-ops on the 575
unlinked rows:

```
POST   unlinked usage dated inside a CLOSED season  -> 201   (should be 409)
PATCH  moving an unlinked row into a CLOSED season  -> 200   (should be 409)
DELETE an unlinked row inside a CLOSED season       -> 204   (should be 409)
POST   /quota-usage/approve/ on such a row          -> 200   (should be 409)
```

Fixed by a `freeze_season` property on `QuotaUsageRecord` — the model hook `freeze_season_of()`
already supports, and the third user of it after `ContractSale` and `FinansistAdvance` — which
delegates to `season_of_usage()` rather than repeating the date-range lookup, keeping the
matched pair a pair. `approve` is the one path the property cannot reach (a raw id list never
calls `get_object()`); its generic `assert_bulk_seasons_open(qs, 'shipment__season')` resolved
through a NULL FK and matched no season, and is replaced by
`services_quota.assert_usage_batch_seasons_open(qs)`, which applies `usage_season_q()` once per
closed season and subsumes it. **Status codes are split deliberately**: a row that resolves to
**no** season stays a `400` on `usage_date` (a field problem — see the guard above), a row that
resolves to a **closed** season is the §5 `409 season_closed` (a state problem). Both are
reachable from the same POST, and the freeze guard runs first.

Operational note for the first close: 15 of the 575 unlinked rows on the dev database are still
`status='draft'`. Once their season closes they can never be approved — approve or delete them
before the close, alongside the straddling-advance check.

**Issuance rows that match no season are reported, not guessed** — the Task 4 precedent.
`QuotaIssuance#34` (25,000 kg, `issue_date` 2026-07-06, firm *Eziz Doganlar*) falls in the gap
between 2025-2026 (ends 2026-06-30) and 2026-2027 (starts **2026-08-01**, not 2026-09-01) and
keeps `season = NULL`. Under display scoping it is reachable by direct link only. Open
question for the owner: assign it to a season, or let it expire unassigned?

**Measured impact (live dev DB, 2026-08-06).** Consumption totals for the season that holds
the data are unchanged — 19,771,100 kg tomato and 144,000 kg pepper before and after — and no
firm's balance moves. The only ledger difference is that issuance #34's allocation leaves the
map, and it was already consuming 0 kg. The visible change is display: the active 2026-2027
season shows 0 issuances rather than all 25. `compute_firm_quota_balances` already returned
`{}` before this change (it date-ranged on the active season, which holds no quota yet), so
the "before" side of the balance comparison was already empty.

## 4.8 `/me/tasks/` is season-scoped (2026-08-06)

`TaskViewSet` was season-scoped during the original build, but the frontend never lists from
it — the My Tasks screen calls `/me/tasks/` (`frontend/src/hooks/useMyTasks.ts:20`, query key
`['my-tasks', role]`), which had no season filter and no `seasonId` in its key. Switching
seasons therefore left that screen unchanged. It is now scoped like every other
shipment-anchored list, and its query key carries `seasonId`.


## 4.9 A default window is not a bound (2026-08-07)

**Found by review of the `quota-dashboard` fix, and it is the general lesson of this
section.**

Routing `quota-dashboard` through `resolve_season()` gated *which season the caller names*.
It did not gate *which dates the caller asks for*. `_parse_date()` returned the client's
`?date_from=`/`?date_to=` verbatim — the resolved season supplied only the fallback — and
`build_quota_dashboard()` aggregates on dates alone. So the gate was bypassable without ever
touching `?season=`:

```
GET /quota-dashboard/?date_from=<closed season start>&date_to=<closed season end>
```

`resolve_season()` returns the ACTIVE season, the permission check passes, and the response
carries the closed season's aggregates — the exact payload the 403 exists to withhold. A role
holding `quota_issuance` but not `closed_season` (`document_team`) reaches it, and the page's
own `RangePicker` has no season bounds, so it is reachable from the UI.

**Rule:** on any endpoint in §4.3, the resolved season **clamps** the window:

```python
date_from = max(_parse_date(...), season.start_date)
date_to   = min(_parse_date(...), season.end_date)
```

Clamping rather than pushing a `season` FK into the aggregates is deliberate. It is
monotonically restrictive — no number changes for a window already inside the season — so it
needs no ruling on whether `build_quota_dashboard()` should become season-aware. That question
stays open. A window lying wholly outside the season inverts (`date_from > date_to`), which
every aggregate reads as empty: fail closed, which is the right answer for data the caller may
not see.

**And the sibling case:** an endpoint that takes no `?season=` at all is not thereby safe.
`harvest-forecast/remaining/` (§4.1) took only `?date=`, and since `HarvestDayEntry.season` is
non-null and seasons never overlap, a date inside a closed season *was* a closed-season read
with nothing for a permission check to attach to. The two write validators sharing that
service (`assert_draw_within_pool`, draft-create `validate()`) deliberately stay unscoped:
they check a draw against the shipment's own date on a path the write freeze already restricts
to an open season, so scoping them would change what a create is validated against rather than
gate a read.
