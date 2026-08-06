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
| D10 | Should `QuotaIssuance` be covered by the freeze? | **Yes — add a `season` FK.** Added 2026-08-05 after Task 9's review found issuances stay editable after a close. **Freeze only: read-scoping stays off** (§4.5) because issuances are consumed FIFO across seasons. |

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
| `quota-issuances` | Keyed by period, not season. Government quotas do not follow the export season boundary, and issuances are consumed **FIFO across seasons** — hiding a prior season's issuances would break the balance the current season's usage records are matched against. **Read-scoping stays off even though `QuotaIssuance` gained a `season` FK (D10); that FK exists for the write freeze only.** |
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

    Returns {drafts, in_transit, open_tasks, unfinished_plans}.
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
