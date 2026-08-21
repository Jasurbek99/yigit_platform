# Boss Process Page — one page, tabs in process order

**Date:** 2026-08-20
**Status:** design approved, not yet implemented
**Approach:** C — the sera-style single working page
**Builds on:** `2026-08-05-boss-process-visibility-design.md` — that design's
deliverables stay in place. The process-ordered menu and the boss's widened
permissions are **not** reverted; this page is added alongside them and depends on
the permission work having already shipped.

---

## 1. Problem

The boss reports, repeatedly, that he "does not see the export process — who does
what and where it is." He wants to run the whole lifecycle himself, from his own
login, in order: initialize the week, then allocate, then enter, and onward.

**This is the third attempt.** The first two shipped and neither resolved it:

| Attempt | What shipped | Result |
|---|---|---|
| 2026-08-05 D1 | Menu reordered by process lifecycle (`BOSS_MENU_GROUPS`, `AppLayout.tsx`) | complaint unchanged |
| 2026-08-05 D2/D3 | Boss granted every page + full CRUD + status transitions | complaint unchanged |
| earlier | Six process documents in `docs/how_works/` (BPMN, swimlanes, walkthrough), click-through via `ProcessNodeLink` | complaint unchanged |

The 2026-08-05 spec explicitly **rejected** building a single process page:

> *One tabbed "Process" page (sera clone) — duplicates screens already built, and
> fixes navigation for nobody except the boss. Debt without payoff.*

Its alternative shipped and the complaint did not move. Decision 2026-08-20: build
the rejected option. The "duplicates screens" objection is addressed in §4 — this
design **mounts** the existing screens rather than reimplementing them.

### Why the previous attempts missed

Every one of them delivers the *shape* of the process — an ordered menu, a diagram,
a permission set. None delivers **state and action in one place**: where this week
actually stands, and the control that advances it, without navigating away. The
boss's own reference point makes that explicit (§2).

Supporting evidence (measured 2026-08-20): the weekly chain currently breaks after
step 1 — harvest plans exist through week 33, but `WeeklyTruckAllocation` and
`WeeklyDestinationSelection` stop at week 29.

---

## 2. The reference: `sera-butce-web`

The boss cited `data/sera-butce-web` (vibe-coded by an export manager) as showing
"more process" than the platform. The screen he means is **Maşyn Yzarlamasy**
(`client/src/App.jsx:13357`):

- one `PageHeader`
- **nine tabs in process order** — Önümçilik · Gaplama · Tırlar · 📦 Export Raporu ·
  📊 Hasabat · Gümrük Ewraklary · Kwota Takibi · Yurtdışı Sertnamaları · Datalar
- a **week switcher** shared across tabs — `◀ Öňki hepde | Şu hepde | Indiki hepde ▶`
  with the Mon–Sun range printed under it
- the first tab is a weekly grid with plan kg (read-only) beside actual kg (editable
  in place)

sera can put everything on one screen because it has **no roles** — one operator
does everything. The platform splits the same process across ~20 role-gated screens,
and that split buys the audit trail. This design reassembles the process **for the
boss only**, without removing the split for anyone else.

---

## 3. Goal / non-goals

**Goal.** One page in the boss's account where he can see where the week stands and
perform every step of the export lifecycle in order, without navigating away.

**Non-goals.**
- Not offered to other roles in v1. Every other role keeps its current screens; the
  page is permission-gated to boss/director/admin.
- Does not remove or change any existing screen.
- Does not fix the separate "tasks name a department, not a person" gap.
- Does not clean up the backlog of open steps from June.
- No impersonation — the boss acts as himself, so audit attribution stays correct
  (this constraint carries over from 2026-08-05 and is non-negotiable).

---

## 4. Architecture — mount, do not rewrite

The 2026-08-05 objection ("duplicates screens already built") is valid against a
rewrite and is answered by composition:

```
ProcessPage.tsx                    ← new shell: header, week switcher, tabs
├─ ProcessStateStrip               ← new: this tab's steps + their live state
└─ <tab content>                   ← EXISTING components, mounted as-is
   ├─ WeeklyPlanGrid               (already a page component)
   ├─ TruckAllocationTable         (already props-driven: ITruckAllocationTableProps)
   ├─ DraftPool / AssignmentBoard  (page components)
   ├─ ShipmentBoard                (page component)
   └─ …
```

Only the shell and the state strip are new code. A tab whose screen is already a
props-driven component takes props; a tab whose screen is a page component is
mounted inside the shell's router context.

**Search-param interaction — verified 2026-08-20, smaller than first assumed.**

| Screen | Reads | Writes | Navigates out |
|---|---|---|---|
| `WeeklyPlanGrid` | `week`, `year`, `block` | none (`const [searchParams] =`) | yes — `/greenhouse/fallback-forecast` |
| `AssignmentBoard` | `draftId` | none | yes — `/shipments/:id` |

Both are **read-only** on the query string, and `WeeklyPlanGrid` reads exactly the
`week` / `year` the shell owns. They therefore *agree* rather than collide: the
shell publishing `?year=&week=` drives the mounted grid for free, with no adapter
needed for tab 1 or tab 2.

Rules for this build:

1. **The shell owns `?tab=`, `?year=`, `?week=`.** A mounted screen reading those is
   a feature, not a conflict — it is how the week switcher reaches the grid.
2. **Never introduce a shell param that a mounted screen *writes*.** Check each
   screen for a `setSearchParams` before mounting it; where one exists, give the
   component an explicit prop instead and thread the value through.
3. **Do not use `MemoryRouter` for isolation.** Both phase-1/2 screens call
   `useNavigate()` and must keep the outer router — isolating them would silently
   send their navigation nowhere. Where a screen genuinely cannot share the URL, add
   a prop to it; it is code we own.
4. **Forking a screen is prohibited.** A fork is exactly the "debt without payoff"
   the previous spec warned about, and preventing it is why this section exists.

---

## 5. Tab map

Nine tabs, mirroring sera's shape, covering all 20 `ProcessNodeLink` nodes.

| # | Tab | Nodes covered | Mounts |
|---|---|---|---|
| 1 | Planlaşdyryş | `em_weekly`, `load_fc` | `WeeklyPlanGrid`, `TruckAllocationTable` |
| 2 | Draftlar | `destB`, `supplyA`, `transA`, `join` | `DraftPool`, `AssignmentBoard` |
| 3 | Ýükleme | `loadtruck` | weightmaster / `PalletManifest` |
| 4 | Gümrük & Dokumentler | `customs`, `docgen`, `invoice` | documents page, sheet customs columns |
| 5 | Ýolda | `departed`, `border`, `destcust`, `peregruz`, `arrived` | `ShipmentBoard` (filtered) |
| 6 | Satuw | `sell`, `report`, `accept` | `SalesReportPage` / my-reports |
| 7 | Kontraktlar | `onetime` | contracts |
| 8 | Kwota | — (tracking view) | `QuotaDashboard` |
| 9 | Maliýe | `fin_close` | `AdvancesTracker` |

Tab membership is stored on the node registry (§6) rather than hardcoded, so the
grouping can change without a deploy — the same reasoning that already puts `route`
in the database.

---

## 6. Data model change

`ProcessNodeLink` (`backend/apps/export/models/process_node_link.py`) already holds
the 20 nodes with Turkmen labels and routes. Add three fields:

| Field | Type | Purpose |
|---|---|---|
| `sort_order` | `PositiveSmallIntegerField(default=0)` | true process order |
| `level` | `CharField(max_length=8, choices=WEEK/TRUCK, default='TRUCK')` | week-wide step vs per-truck step |
| `tab_key` | `CharField(max_length=24, blank=True, default='')` | which tab the node belongs to |

`Meta.ordering` becomes `['sort_order', 'node_id']`.

Migration adds the three fields and backfills from the ordered `_LINKS` array in
`0060_seed_process_node_links.py`, numbering by tens so a node can be inserted later
without renumbering.

MSSQL compliance: scalar columns with explicit sizes, no JSONField, no ArrayField;
the migration updates 20 rows individually (no `bulk_create`).

### Node order, level and tab

| sort_order | node_id | level | tab_key |
|---|---|---|---|
| 10 | `em_weekly` | WEEK | planning |
| 20 | `load_fc` | WEEK | planning |
| 30 | `destB` | WEEK | drafts |
| 40 | `supplyA` | WEEK | drafts |
| 50 | `transA` | WEEK | drafts |
| 60 | `join` | WEEK | drafts |
| 70 | `onetime` | TRUCK | contracts |
| 80 | `invoice` | TRUCK | customs |
| 90 | `docgen` | TRUCK | customs |
| 100 | `customs` | TRUCK | customs |
| 110 | `loadtruck` | TRUCK | loading |
| 120 | `departed` | TRUCK | transit |
| 130 | `border` | TRUCK | transit |
| 140 | `destcust` | TRUCK | transit |
| 150 | `peregruz` | TRUCK | transit |
| 160 | `arrived` | TRUCK | transit |
| 170 | `sell` | TRUCK | sales |
| 180 | `report` | TRUCK | sales |
| 190 | `accept` | TRUCK | sales |
| 200 | `fin_close` | TRUCK | finance |

---

## 7. State service

The state layer is what none of the three previous attempts provided, and the tabs
are useless without it. New service
`backend/apps/export/services/week_process.py`, read-only, no writes:

```python
get_week_process(season, year, week_number) -> dict
```

### 7.1 Week bounds and timezone

The week is an ISO week. Mon–Sun bounds are computed in the configured timezone
(`GreenhouseConfig.get_solo().timezone_name`), matching `run_weekly_plan_setup`.
Do **not** use `timezone.now().date()` — a UTC date shifts the week boundary for
operators in TM.

### 7.2 WEEK node states

`DONE` · `TODO` · `WAITING` · `NA`

- `DONE` — the rule below holds.
- `TODO` — not satisfied, and every lower-`sort_order` WEEK node is `DONE`.
- `WAITING` — not satisfied, and an earlier WEEK node is not `DONE`.
- `NA` — the week falls entirely outside the season's date range. This is the only
  case producing `NA` for a WEEK node in v1.

| node_id | DONE when |
|---|---|
| `em_weekly` | ≥1 `WeeklyTruckAllocation` for (season, year, week_number) |
| `load_fc` | ≥1 `HarvestDayEntry` in the week's range with `forecast_value` non-null |
| `destB` | ≥1 `WeeklyDestinationSelection` for (season, year, week_number) |
| `supplyA` | ≥1 draft `Shipment` with `date` in the week's range |
| `transA` | ≥1 draft in the week AND no draft missing `driver_name` or a truck |
| `join` | no *unjoined* draft remains in the week |

**Unjoined draft** (per the two-row join flow): a draft with supply but no
destination (`block_sources` present, `country_id` null), or with a destination but
no supply (`country_id` set, no `block_sources`). `join` is `DONE` when the week has
zero of either.

Each rule also returns a short `detail` string for the UI ("14 trucks allocated").

### 7.3 TRUCK node counts

Per TRUCK node, over shipments whose `date` falls in the week: `count` (at or past
that node) and `overdue_count` (carrying an overdue open Task at that step).

**Status-backed** — `count` = shipments with `status.step_order >=` the mapped
status's `step_order`:

| node_id | status | step_order |
|---|---|---|
| `loadtruck` | `yuklenme` | 1 |
| `customs` | `gumruk_girish` | 2 |
| `departed` | `yola_chykdy` | 4 |
| `border` | `serhet_gechdi` | 6 |
| `destcust` | `barysh_gumrugi` | 7 |
| `arrived` | `bardy` | 9 |
| `sell` | `satylyar` | 10 |
| `report` | `hasabat` | 12 |
| `fin_close` | `tamamlandy` | 13 |

**Artifact-backed** — `count` = shipments satisfying a predicate:

| node_id | predicate |
|---|---|
| `onetime` | a `ContractSale` row references the shipment |
| `docgen` | `documents_status` in (`'ready'`, `'ok'`) |
| `peregruz` | `has_peregruz` true — informational, never blocks |

**Not tracked in v1** — returned with `tracked: false` so the UI greys them honestly
instead of showing a false zero:

| node_id | why |
|---|---|
| `invoice` | no Invoice model exists; invoices are generated documents, not rows |
| `accept` | no field records report acceptance — see O2 |

### 7.4 Ordering the truck steps

Truck steps order by the **status machine's `step_order`**, not the kanban
`PHASE_ORDER` in `services/phases.py`. The two genuinely differ — the kanban
deliberately places DOCS before LOAD for visualization, while the state machine has
`yuklenme`=1 before `gumruk_girish`=2. Mixing them is a known trap. See O1.

---

## 8. Endpoint

```
GET /api/v1/export/boss/week-process/?year=<int>&week=<int>
```

- Both params optional; default to the current ISO week of the active season in the
  configured timezone.
- Season-scoped via `resolve_season(request)`; empty step list when the season
  cannot be resolved (fail-closed, matching the board).
- `GET` only, read-only.

```json
{
  "year": 2026, "week_number": 34,
  "week_start": "2026-08-17", "week_end": "2026-08-23",
  "steps": [
    { "node_id": "em_weekly", "label": "Hepdelik maşyn planlamak",
      "level": "WEEK", "tab_key": "planning", "sort_order": 10,
      "route": "/export/plan", "state": "DONE",
      "detail": "14 trucks allocated",
      "count": null, "overdue_count": null, "tracked": true }
  ]
}
```

WEEK rows carry `state` + `detail`, null counts. TRUCK rows carry `count` +
`overdue_count`, null `state`.

**Query budget:** one query for the registry, one per WEEK rule (6), aggregates for
truck counts. Target ≤ 15 queries regardless of week size, asserted by test. No
per-shipment loops.

---

## 9. Frontend

New page `frontend/src/pages/export/ProcessPage.tsx`, route `/export/process`,
guarded by `<ProtectedRoute pageCode="export.process">`. Nav entry pinned at the top
of the boss's `nav.group_overview`.

**Shell layout**

- Header: title, and the week switcher — `◀ previous | this week | next ▶` with the
  Mon–Sun range beneath, mirroring sera.
- Tab bar: the nine tabs in process order, from `tab_key`.
- `ProcessStateStrip`: for the active tab, its nodes with state pills (WEEK) or
  counts with overdue badges (TRUCK). This is the "where are we" answer and appears
  on every tab **that owns at least one node**. Tab 8 (Kwota) owns no lifecycle node
  — it is a tracking view — so it renders no strip. It is the only such tab.
- Tab body: the mounted component(s) per §5.

**URL state:** `?tab=&year=&week=` — owned by the shell alone (§4).

**i18n:** shell chrome keys in `en.json` / `ru.json` / `tk.json`. Node labels come
from the database and are already Turkmen; not translated in v1.

---

## 10. Permissions

New page code `export.process` in `permission_registry.py`, granted in
`seed_permissions.py` to `boss`, `director`, `admin`. The boss receives
`_ALL_PAGES - _BOSS_DEAD_PAGES` so he picks it up automatically; director and admin
need explicit entries.

Per the 2026-08-05 final-review correction, **frontend permission gates must be
verified per mounted screen, not inferred** — `canDo()` / `canEditField()` cover
only the callers that actually invoke them, and both `sheetPermissions.ts` and
role-list gates (`ShipmentDetailHero`, `AdvancesTracker`) bypass them. Every screen
mounted into a tab gets its gate checked as part of that tab's task.

---

## 11. Phasing

Nine tabs is too large for one change. Ship in this order, each independently
usable, each its own commit:

| Phase | Tabs | Why first |
|---|---|---|
| **0** | shell + week switcher + state strip over **all 20 nodes**, tab bodies as plain links to the existing screens | the cheapest possible test of the shape — a day or two, no screen mounting. Show the boss this before building anything else. |
| 1 | tab 1 Planlaşdyryş mounted for real | the chain demonstrably breaks here (stalled at week 29) |
| 2 | tab 2 Draftlar | the next broken link |
| 3 | tab 5 Ýolda | where 199 overdue steps sit |
| 4 | tabs 3, 4 | loading and customs |
| 5 | tabs 6, 7, 9 | sales, contracts, finance |
| 6 | tab 8 Kwota | pure tracking view, no ordering dependency |

**Show the boss after phase 0.** If the shape is wrong, that is the cheapest point
to find out — this is attempt three, and the previous two were both discovered wrong
only after shipping in full. Phase 0 deliberately contains the two parts nothing in
the system has today (the ordered frame and the live state); mounting real screens
starts only once he confirms the shape is what he meant.

---

## 12. Testing

**Backend**
- Each of the six WEEK rules: empty week → step 1 `TODO`, 2–6 `WAITING`; full week →
  all `DONE`; partial week → exactly one `TODO`.
- `NA` when the week is outside the season range.
- Unjoined-draft detection in both directions (supply-only, destination-only).
- Truck counts for status- and artifact-backed nodes, including `step_order` ties
  (`serhet_gechdi`/`dest_entry` both 6, `yolda`/`transshipment` both 8).
- Endpoint: season scoping, fail-closed with no season, permission denial for a
  non-granted role, `assertNumQueries` bound.
- Timezone: week bounds resolve against the configured TZ, not UTC.

**Frontend**
- Shell: tab switching and week switching update only the shell's own params.
- State strip renders each of the four WEEK states and the TRUCK count/overdue form.
- An untracked node renders without a count.
- Per phase: the mounted screen still works inside the shell, including its own
  permission gate.

---

## 13. Risks and open questions

- **R1 — search-param collision** (§4). The main technical risk. Mitigation is the
  shell-owns-params rule plus props; `MemoryRouter` isolation as the fallback.
  Forking a screen is prohibited.
- **R2 — this is attempt three.** Two prior designs shipped against this same
  complaint and neither moved it. Phase 1 exists to test the shape before the other
  eight tabs are built.
- **R3 — the page only helps if data is entered, and entry has stopped.** Measured
  2026-08-20. The `admin` account is the developer's maintenance login, not an
  operator, so it is excluded below. Status updates by actual export staff:

  | | June | July | August |
  |---|---|---|---|
  | all accounts | 428 | 22 | 12 |
  | **export staff only** | **401** | **12** | **0** |

  No member of the export team has recorded a single status update in August. A
  better screen does not by itself restart data entry — if entry does not resume,
  this page renders an empty frame. Tracked separately; it is the largest risk to
  this work paying off.
- **O1 — customs before loading?** The seeded node order puts `customs` before
  `loadtruck`, but the status machine has `yuklenme`=1 before `gumruk_girish`=2. The
  diagram author and the state machine disagree. Truck steps follow `step_order`;
  confirm with the boss which matches reality.
- **O2 — what records report acceptance?** `accept` has no backing field. Either add
  one or fold the node into `report`. Ships untracked until decided.
- **O3 — invoice tracking.** No Invoice model exists. Separate work if it matters.

---

## 14. Out of scope

Named owners on tasks; the June backlog cleanup; offering the page to non-boss
roles; making the BPMN diagram live (it can later become a second view over the
same endpoint).
