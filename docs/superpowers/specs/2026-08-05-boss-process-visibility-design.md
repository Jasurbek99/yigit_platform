# Boss Process Visibility — Design

**Date:** 2026-08-05
**Status:** Draft — awaiting review
**Author:** Claude (brainstormed with Jasurbek)

---

## Problem

The boss reports he cannot see the operational process in the YGT Platform. To follow a truck
from plan to payment he would have to log in as each role in turn. He cited `sera-butce-web`
(`data/sera-butce-web`, vibe-coded by an export manager) as showing "more process" than ours.

### Why sera looks better

`sera` puts the entire process on **one page with nine tabs** in process order
(`App.jsx:13362` — "Maşyn Yzarlamasy"):

```
Önümçilik → Gaplama → Tırlar → Export Raporu → Hasabat
→ Gümrük Ewraklary → Kwota Takibi → Yurtdışı Sertnamaları → Datalar
```

It also tracks four truck stages: `loadingStart → loadingEnd → customsExit → arrival`.

**sera can do this because it has no roles at all.** One operator does everything, so the whole
process fits one screen. The YGT Platform deliberately splits the same process across ~20
role-gated screens — that split is what buys audit trails and accountability. The fix is to
*reassemble* the process for the boss, not to remove the split for everyone.

### Root causes (verified in code, not assumed)

| # | Cause | Evidence |
|---|-------|----------|
| 1 | Boss has only 3 pages | `seed_permissions.py:131` — `PAGE_DEFAULTS['boss']` = `analytics.boss`, `analytics.clients`, `director.stuck_shipments` + universal. Registry holds 42 page codes. |
| 2 | Boss is read-only on every resource | `seed_permissions.py:251` — `'boss': {r: _VIEW for r in _ALL_RESOURCES}` |
| 3 | Boss cannot move a shipment through statuses | `export/services/shipment.py:41` — `PRIVILEGED_ROLES = {'export_manager', 'director'}`; `boss` absent. `transition_to()` raises `PermissionError`. This is a **code** gate, not config. |
| 4 | Sidebar is grouped by module, not by process | `AppLayout.tsx:166` — 8 groups: main / analytics / export / contracts / management / system / team / feedback |
| 5 | Five registered pages have no sidebar entry at all | In `ROUTE_PAGE_MAP` but missing from `allMenuGroups`: `export.prices`, `export.trucks`, `export.domestic_sales`, `export.drafts`, `export.assign` |

Causes 1 and 2 are pure configuration. Causes 3, 4 and 5 need code changes.

---

## What already exists (do not rebuild)

- **`ShipmentBoard`** (`pages/export/ShipmentBoard.tsx`) — kanban across the 7 canonical phases
  `PLAN → PREP → DOCS → LOAD → TRANSIT → DEST → CLOSE`, with average time per phase.
  The boss simply lacks the `export.shipments.board` permission.
- **`StuckShipments`** (`pages/director/StuckShipments.tsx`) — code, status, **days stuck**,
  country, customer, last touched. Missing only "who is holding it".
- **Permission admin UI** at `/admin/permissions` — role × page and role × resource matrices are
  editable in the browser.
- **Permission choke points** — `canSeePage()`, `canDo()`, `canEditField()` in
  `utils/permissions.ts`.

  **CORRECTION (2026-08-05, final review).** This section originally claimed "grep confirms no
  component reads `resource_permissions` directly, so these three functions are the only frontend
  gates." **That was false**, and Deliverables 2 and 3b were reasoned on top of it. A re-run of the
  grep across all of `frontend/src` found two classes of bypass:

  1. `pages/contracts/ContractDetail.tsx:68` read `user?.resource_permissions?.contract` directly
     and used it for `canUpload` / `canDelete`, so contract document upload and delete stayed live
     for the boss in **Просмотр** mode. Now routed through `canDo()`.
  2. `utils/sheetPermissions.ts` `isCellEditable()` never reaches `canDo` / `canEditField` at all:
     the Sheet payload carries a pre-computed `can_current_user_edit` bool per row
     (`export/views.py:1418`, `:1440`) which the helper trusts, so the whole grid — inline edit plus
     Ctrl+C / Ctrl+X / Ctrl+V / Delete — bypassed both guards. Now has its own boss guard, placed
     above the backend-decision read.

  Two more gates are role-list based and never touch the matrix at all, so they are outside the
  three helpers by construction: `ShipmentDetailHero.tsx` (`CANCEL_ROLES`, `canPromote`) and
  `AdvancesTracker.tsx` (`CAN_CREATE_ROLES`).

  The correct statement is therefore: **`canDo()` / `canEditField()` cover only the callers that
  actually call them.** Any new guard must be verified per screen, not inferred from these two
  functions.

No new process screen is built in this phase.

---

## Approach

Chosen: **process-ordered sidebar + boss elevated under his own login, with a view/edit toggle.**

Rejected:

- **One tabbed "Process" page (sera clone)** — duplicates screens already built, and fixes
  navigation for nobody except the boss. Debt without payoff.
- **Impersonation ("log in as role X")** — the most literal reading of the request, but it
  destroys audit attribution: the log can no longer say who actually pressed the button.
  The boss said "without leaving my login", which is elevated own-role access, not impersonation.

---

## Deliverable 1 — Sidebar reordered by process

`allMenuGroups` in `AppLayout.tsx` is one global array. The per-role filter at lines 301–320
decides **visibility only** — it never reorders. Empty groups collapse (line 313).

**Decision (approved 2026-08-05): one process order for all roles.** Each role sees its own
slice of that order; a loading dept head sees "3. Погрузка" and learns where they sit in the
chain. Per-role configurable ordering is deferred (see Phase 2).

Numbered groups mark the process itself. Unnumbered groups are supporting.

| Group | Items (route keys) |
|-------|--------------------|
| **Обзор** | `/`, `/boss/dashboard`, `/me/board`, `/director/stuck-shipments` |
| **1. Планирование** | `/export/plan`, `/export/harvest-board`, `/export/trucks` ⁺, `/export/quota`, `/export/blocks` |
| **2. Подготовка** | `/export/drafts` ⁺, `/export/assign` ⁺, `/export/weightmaster` |
| **3. Отгрузка** | `/export/shipments`, `/export/shipments/sheet`, `/export/shipments/board`, `/export/shipments/dashboard` |
| **4. Документы и таможня** | `/documents`, `/admin/packing-templates` |
| **5. Продажа и контракты** | `/contracts`, `/sales`, `/export/my-reports`, `/export/domestic-sales` ⁺, `/export/prices` ⁺ |
| **6. Финансы** | `/export/advances`, `/export/overdue`, `/admin/expense-template` |
| **Аналитика** | `/analytics/clients-report`, `/team/kpi`, `/worklog` |
| **Справочники** | `/admin/seasons`, `/admin/firms`, `/admin/import-firms`, `/admin/customers`, `/admin/blocks`, `/admin/truck-destinations` |
| **Система** | `/admin/users`, `/admin/permissions`, `/admin/staff-access`, `/admin/shipment-settings`, `/admin/sales-rep-coverage`, `/admin/audit-log` |
| **Обратная связь** | `/feedback/submit`, `/feedback/my-tickets`, `/feedback/public`, `/admin/feedback` |

⁺ = new sidebar entry (page exists and is permission-registered, but was unreachable from the menu).

Nothing is removed. Every existing item keeps its route, icon and page code; only grouping and
order change, plus five additions.

**i18n:** each new group label needs a key in `i18n/tk.json`, `ru.json` and `en.json`
(`nav.group_overview`, `nav.group_planning`, `nav.group_prep`, `nav.group_shipping`,
`nav.group_docs`, `nav.group_sales`, `nav.group_finance`, `nav.group_reference`). Existing group
keys that survive are reused. Five new item labels need keys too (`nav.trucks`, `nav.drafts`,
`nav.assign`, `nav.domestic_sales`, `nav.prices`) — check whether they already exist before adding.

---

## Deliverable 2 — Boss permissions

Two edits in `backend/apps/core/management/commands/seed_permissions.py`:

```python
# PAGE_DEFAULTS — boss sees every registered page except the permission matrix.
# _ALL_PAGES already exists at line 28 of this file — reuse it.
'boss': _ALL_PAGES - {'admin.permissions'},   # was: 3 codes | _UNIVERSAL

# RESOURCE_DEFAULTS — boss gets full CRUD, minus three carve-outs
'boss': {
    **{r: _VCRUD for r in _ALL_RESOURCES},
    'closed_season': _VIEW,          # D1
    'truck_split_default': _VIEW,    # Gap 7 / ADR-016 — director-only constants
    'sale': _VCE,                    # sale DELETE is admin-only; it re-rolls Contract totals
},                                   # was: _VIEW on all
```

Plus a `FIELD_DEFAULTS['boss']` entry — without it `canEditField()` returns `false` and the boss
sees editable resources with every field locked. Use the comprehension form, **not** admin's
hand-enumerated list, so nothing is missed when a resource is added later:

```python
FIELD_DEFAULTS['boss'] = {r: ['*'] for r in _ALL_RESOURCES}
```

Two checked facts about `_ALL_PAGES`:

- `_UNIVERSAL` (`me.board` + the three non-admin feedback pages) is a **subset** of `_ALL_PAGES` —
  verified against `PAGE_REGISTRY`. The boss loses nothing he has today by switching to
  `set(_ALL_PAGES)`.
- `_ALL_PAGES` **includes `admin.permissions`**, which this deliverable now subtracts.
  `_AdminOnlyPermission` (`core/views_permissions.py:31-44`) rejects **every** method including GET
  for non-admins per AD-15, so granting the page produced a nav entry whose every API call 403s —
  a dead menu item, not "the boss can widen his own access" as this spec first claimed. Excluded
  (2026-08-05 final review).

**Applied by a data migration, not by re-running the seed command.**
`seed_permissions` uses `get_or_create(..., defaults={...})` and `defaults` applies only on INSERT,
so on any database seeded before this branch the boss's 42 page rows and 25 resource rows already
exist and re-running the command changes nothing. `core/migrations/0033_boss_process_visibility_perms.py`
does the `.update()`. The seed dicts and that migration must stay in sync; both carry a comment
saying so. The existing `/admin/permissions` UI can narrow this later without a deploy.

**Deliberately unchanged:** `closed_season` stays read-only for boss, matching the D1 rule that
already carves `admin` out. A closed season must stay closed for everyone.

---

## Deliverable 3 — Boss can act on the process

### 3a. Status transitions

`export/services/shipment.py:41`:

```python
PRIVILEGED_ROLES = {'export_manager', 'director', 'boss'}
```

This is the only change needed — `transition_to()` already skips the per-edge role check for
privileged roles. `assert_season_open()` still runs first, so closed seasons remain frozen.

Note for the implementer: a second `PRIVILEGED_ROLES` exists in `core/roles.py:54` with a
different membership (`admin`, `export_manager`, `director`). The two are already divergent.
**Change only the `export/services/shipment.py` one.** Reconciling them is out of scope here.

Task actions need no change — `export/permissions.py:11` already lists `boss` in
`_SUPERVISOR_ROLES`.

### 3b. View / Edit toggle

A segmented control in the app header, rendered only when `user.role === 'boss'`:

```
[ 👁 Просмотр ] [ ✏ Редактирование ]
```

- State lives in `stores/uiStore.ts` (`bossEditMode: boolean`, default `false`). This is UI state,
  so Zustand is correct per `frontend/CLAUDE.md`.
- **Not persisted.** `uiStore` is a plain `create()` with no `persist` middleware today, and adding
  one just for this would be the wrong trade: the mode resetting to **Просмотр** on every reload is
  the safer default. The boss opts into editing deliberately, each session.
- `canDo()` and `canEditField()` gain one guard each:

  ```ts
  // MUST sit ABOVE the `if (user.is_superuser) return true` line (permissions.ts:103 / :120).
  // A boss account that is also a superuser would otherwise short-circuit past the toggle
  // and stay editable in Просмотр mode.
  if (user.role === 'boss' && !useUiStore.getState().bossEditMode) return false;
  ```

  These two functions cover every caller *that calls them* — which is not the whole app. See the
  CORRECTION under "What already exists": `ContractDetail.tsx` read `resource_permissions` directly
  and `sheetPermissions.ts` trusts a backend-computed bool instead, so both needed their own guard.
  A third guard therefore lives in `isCellEditable()`, above the backend-decision read.
- Every switch into **Редактирование** shows a confirm dialog: *"Вы будете вносить изменения от
  своего имени. Все правки записываются в журнал аудита как `boss`."* Confirming on each switch
  rather than once per session avoids tracking extra state, and the switch is rare enough that the
  friction is negligible. Switching back to **Просмотр** is immediate, no dialog.
- A persistent amber tag in the header while edit mode is on, so the boss always knows the mode.

**This toggle is a guard against accidental clicks, not a security boundary.** The backend accepts
boss writes in both modes. Anyone who calls the API directly bypasses it. The real boundary is the
role permission matrix from Deliverable 2. Stated here so nobody later mistakes it for enforcement.

**It is also not complete UI coverage.** Only the ~17 files that call `canDo` / `canEditField`
respond to the toggle. Screens that render forms without consulting either helper stay editable in
**Просмотр** mode. Do not test one screen in Просмотр and conclude the whole app is locked. Closing
that gap across every screen is a larger sweep, deliberately not in this phase.

---

## Testing

Backend:
- `transition_to()` with a `boss` user succeeds on an edge whose canonical role is
  `loading_dept_head` — RED before the `PRIVILEGED_ROLES` change.
- `transition_to()` with a `boss` user on a **closed** season still raises `SeasonClosedError`.
- After `seed_permissions`, `RolePagePermission.objects.filter(role='boss', is_visible=True).count()`
  equals the registry size.
- A non-boss role's permission rows are unchanged by the reseed (regression guard).

Frontend:
- `canDo(bossUser, 'shipment', 'edit')` returns `false` when `bossEditMode` is `false`, `true` when
  it is `true`.
- `canDo(exportManagerUser, ...)` is unaffected by `bossEditMode` in either position.
- The sidebar renders groups in the declared order for a boss; renders only groups 2 and 3 for a
  `loading_dept_head` (empty-group collapse still works).
- Every new i18n key exists in all three locale files.

Run before handing over: `python manage.py test apps.export apps.core` and
`npx tsc --noEmit --ignoreDeprecations 5.0` (the plain `type-check` script is broken with TS5103).

---

## Risks

1. **AD-1 fallout.** Seven of the eight shipment lifecycle timestamps are now operator-entered and
   are null on new shipments. `ShipmentBoard` and `StuckShipments` lean on `updated_at` and status
   history rather than those timestamps, so they should still populate — but the boss may see
   sparse time data on recent trucks and read it as broken. Worth showing him the board on real
   data before declaring it done. **Do not build a stage-timeline widget on those timestamps.**
2. **The reorder touches every role's menu.** Accepted explicitly by the user. Watch for a role
   whose daily screen moves somewhere unexpected; expect a day of "where did X go".
3. **Boss with full CRUD can break data.** The audit log records him as `boss`, and `transition_to()`
   still validates transition legality, so damage is traceable and bounded — but it is real. The
   `/admin/permissions` UI can narrow specific resources without a deploy if it proves too broad.
4. **Five newly-surfaced pages get real traffic for the first time.** They were reachable only by
   typing the URL. Their permission defaults for non-boss roles should be sanity-checked, not
   assumed correct.

---

## Out of scope

- Any new "Process" page or sera-style tabbed screen.
- Impersonation / "act as role X".
- Adding "who is holding it" to `StuckShipments` — a good idea, tracked separately.
- Reconciling the two divergent `PRIVILEGED_ROLES` constants.

## Phase 2 — deferred

**Per-role configurable sidebar order.** Agreed on 2026-08-05: ship the single global process
order first; if it proves wrong for some role, build a configurable order then. That would need a
new table (role × page_code × sort_order), an admin UI with drag-and-drop, and a fallback to the
global default when a role has no override. Not built now — nothing speculative.
