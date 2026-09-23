---
title: Gaplama — packing view over the Weekly Plan (tab + standalone page)
date: 2026-09-18
updated: 2026-09-23
branch: Copy_Gadams_UI
status: design approved in chat 2026-09-23 — spec awaiting owner review
research: docs/TIR_TAKIP_GAPLAMA_VS_FORECAST_DRAFTS.md
plain: 2026-09-18-tir-takip-gaplama-plain-ru.md (RU, current), -plain.md (EN, regenerate after freeze)
---

# Gaplama — packing view over the Weekly Plan

## 1. Goal

**How the owner works.** Each day the loading department head opens packaging drafts
(trucks) from the **Weekly Plan** of the blocks. One draft can take kg from several blocks.
The Gaplama screen is a copy of the plan that **goes down** as drafts are opened, so the
head sees what is still left to pack per block and day. Nobody types kg into the grid.

**A Gaplama draft is a plan for the day, not packed goods** (owner, 2026-09-23). Until it is
joined to a destination and its documents are started, it can still be changed.

It ships in **two places**: the `gaplama` tab of `/tir-takip`, and its own sidebar entry and
route. Both mount the same component under the same page code.

| sera | platform |
|---|---|
| gaplama kg per block-day (falls back to the Önümçilik plan) | `HarvestDayEntry.plan_value`, read-only |
| Tır Aç (block/kg rows) | draft shipment with `ShipmentBlockSource(block, weight_kg)` |
| Tıra giden | Σ `ShipmentBlockSource.weight_kg` of non-cancelled shipments on that `date` |
| Bakiye | plan + carry-in − loaded, never negative |

## 2. Decisions

| # | decision |
|---|---|
| D1 | The grid shows **Weekly Plan** kg (`plan_value`), **read-only** for every role. |
| D2 | The Gaplama figures are **calculated, not stored**. Plan edits flow through. |
| D3 | **No negative anywhere.** The form refuses more than available; a cell that would go negative shows **0 + ⚠** with the excess. |
| D4 | **Partial trucks allowed**, tagged "partial". |
| D5 | **No export-code generator**; `shipment_code` left to the server. |
| D6 | **ISO week** (Mon–Sun), the same navigation as Önümçilik. |
| D7 | Page code **`tir_takip.gaplama`**; the body also requires `export.plan`, and the endpoint checks the same pair. |
| D8 | **The whole calculation lives on the server** (§4), because the over-load check (D14) must use the same carry-over rule the screen shows. The frontend renders and sums; it does not own the rule. |
| D9 | **No delete button.** Only admin can delete a draft; editing kg (D13) covers the daily case. |
| D10 | **Two entry points**, one component, **the same page code** (§8). |
| D11 | A truck is opened **for today only** — the day is baked into `shipment_code`. |
| D12 | **Positive remainder carries forward** for `gaplama_carry_days` days, FIFO oldest-first. New `GreenhouseConfig.gaplama_carry_days`, **default 2**, changeable without a deploy. A negative never carries. |
| D13 | **A supply draft stays editable from this screen** while it is still a supply row (§3 ⑤). |
| D14 | An over-loaded block-day **notifies export_manager, admin and director**, and gives the **loading head a notification *and* a task** (auto-closed when the over-load is gone). |
| D15 | **A daily task** "open today's trucks" for the loading head, one per day, **closed manually** (owner, 2026-09-23) — not auto-closed on a kg threshold. |
| D16 | The grid shows **per-location subtotals** (Dusak / Kaka / Owadandepe). 20 000 kg left as 10 000 + 10 000 in two locations is not a truck, and only a per-location view shows that. |

## 3. The screen

`frontend/src/pages/sera/GaplamaTab.tsx`.

**Header.** Title, `◀ Öňki hepde · Şu hepde · Indiki hepde ▶`, the ISO week's range, a
caption line, and `BlockFilterSelect` (already on the branch).

### ① Grid — blocks × Mon…Sun + JEMI

Rows are every active top-level block, **grouped by location** with a subtotal row per
location (D16) and a grand total. Per cell, straight from the server (§4):

- **large:** `available` (already clamped at 0).
- **small, grey:** `plan N`, when something was loaded or carried.
- **`+2 000`** when kg were carried in, tooltip naming the origin day.
- **`2 000 →`** when this cell's remainder moves on — *moved*, not *unpacked*.
- **⚠** when `over_kg > 0`; the cell shows 0 and the tooltip says by how much.

Footer rows: **JEMI plan**, **Tır sany** (per location, ÷ `truck_capacity_kg`, 2 decimals),
**📦 Açylan tırlar** (chips per day + week count), **Düýnki galyndy** (carried in),
**Galan** (Σ available).

Clicking a day header selects it and filters ④⑤; clicking again clears. View state only.

### ② Tır Aç form

Shown when `canDoBackendGated(user, 'shipment', 'create')` — the Sheet "+" button's check,
held by both loading-head roles on the live DB (verified 2026-09-18). Hidden on a read-only
season; disabled when the browsed week does not contain today.

- **Day: today, fixed** (D11). `generate_shipment_code()` takes no argument and stamps DDMM
  from the **creation day** (`services/shipment.py:575-584`); the actuals rollup groups by
  that code's date (`greenhouse/services/actual_rollup.py:96-110`); `Shipment.date` is not in
  `_ALL_PATCHABLE_FIELDS`. A truck opened Wednesday for Friday would sit on Friday here, roll
  up into Wednesday, and be fixable only in Django admin.
- **Rows** — `[block ▾] [kg]`, `✕`, `+ Blok goş`. Each row shows that block's available kg
  and its carry-in breakdown (`12 000 (2 000 ýaňky günden)`), and **refuses more than
  available** (D3).
- **Export kody** — optional, `OfficialCodeEditor`.
- **Ýygym ýagdaýy** — optional, `useShipmentOptions('harvest_status')`.
- **Pomidoryň görnüşi** — optional, `VarietySelect`, sent as `varieties: [id]`.
- **Jemi** — Σ kg, `partial` tag below capacity.
- Submit disabled when no row has kg > 0 or any row exceeds available.

Payload through the existing `useCreateDraft`, with **no** `shipment_code`:

```json
{ "is_draft": true, "date": "<today>", "skip_forecast_check": true,
  "block_sources": [{"block_id": 5, "weight_kg": 12000}, {"block_id": 6, "weight_kg": 6500}],
  "weight_net": 18500,
  "export_code": "…", "harvest_status": "…", "varieties": [3] }
```

**This is the same supply draft the Sheet already makes** (`SupplyDraftModal` →
`useCreateSupplyDraft`), so it lands on the Sheet as a supply column and the export manager
joins it as usual. Therefore **`block_sources` fills Sheet row 8 "Ýygylan bölümi"**
(`sheet_rows.py:89-97`), and **`weight_net` = Σ of the rows** — the declared total
`_execute_join` keeps as its fallback (`views.py:2530`). Duplicate blocks are merged
client-side (`ShipmentBlockSource` is unique on shipment+block).

### ③ Haftalyk Özet

Per block: Plan | Tıra giden | Galan (+ ⚠), subtotalled per location, plus JEMI.

### ④ Açylan tırlar — with edit (D13)

Newest first: code, blocks as `A (12 000 kg) + B (6 500 kg)`, kg, status, date, **Üýtget**.

Edit re-opens the form with the truck's rows and saves through
`POST /shipments/{id}/block-sources/` (its role gate already covers the loading heads),
then `PATCH`es `weight_net` to the new Σ. The truck's own current kg count as available, so
lowering is always possible.

**Üýtget shows only while the draft is still a supply row** — `status_code == 'draft'`, no
country, no customer. After the join the row is edited on the Sheet. No delete (D9).

## 4. Backend — the Gaplama board

One service owns the rule (D8): `export/services/gaplama.py`.

```
build_gaplama_board(date_from, date_to, season) -> {days: [...], trucks: [...]}
```

Per (block, date), walking days in order per block:

```
loaded(d)      = Σ ShipmentBlockSource.weight_kg, shipment.date == d, status != cancelled
buckets        = positive remainders of earlier days, each live for gaplama_carry_days days
consume(d)     = loaded(d) takes from the OLDEST live bucket first, then from plan(d)
available(d)   = max(0, plan(d) + live buckets − loaded(d))
over_kg(d)     = max(0, loaded(d) − (plan(d) + live buckets))
carried_in(d)  = Σ live buckets at the start of d
```

`days[]` rows carry `date, block_id, block_code, location, plan_kg, loaded_kg, carried_in_kg,
available_kg, over_kg`. `trucks[]` carries `id, shipment_code, export_code, date, status,
status_code, status_display, country, customer, block_sources[{block_id, block_code,
weight_kg}]` — `country`/`customer` so ④ can decide whether **Üýtget** shows. Every decimal
is a **string**; the hook converts with `Number()` in its `queryFn`.

`GET /api/v1/export/gaplama/board/?from_date=&to_date=[&season=]`

- **Permission:** `CanViewTirGaplama`, `PAGE_CODES = ('tir_takip.gaplama', 'export.plan')`,
  copying `CanViewTirHasabat`. Both codes exist; nothing is added to `PAGE_REGISTRY`.
- **Season:** `resolve_season()` — 404 unknown, 403 closed without `closed_season.can_view`,
  `[]` during the close→open gap.
- **Window:** both dates required; inverted → 400; over 31 days → 400; **clamped to the
  season**. The client asks for **Monday − `gaplama_carry_days`** through Sunday so the
  week's first carry-in is real; the server still returns rows only for the asked range, with
  the carry-in already folded in.
- **Carry-over lookback cut-off.** The FIFO walk needs earlier days to seed the first
  returned day's buckets, which regresses indefinitely if left open-ended. Fixed rule: the
  server walks from **`from_date − gaplama_carry_days`** through `to_date`; the walk's
  **first day always starts with zero carry-in**, whatever it actually was. This bounds the
  error to buckets older than `gaplama_carry_days` before the requested window, which are
  buckets that would have expired by then in any case. Only `days[]` rows inside
  `[from_date, to_date]` are returned; the lookback days exist purely to seed buckets and are
  computed but not emitted.
- **Queries:** one `HarvestDayEntry` read and one `ShipmentBlockSource` read, both grouped in
  the DB; `select_related('status')` + `prefetch_related('block_sources__block')` for trucks.
  Predicate identical to `get_remaining_for_date` (cancelled excluded), so Gaplama and
  `/export/drafts` count the same trucks.

## 5. Backend — config, tasks and notifications

**Config (D12).** `GreenhouseConfig.gaplama_carry_days` — `PositiveSmallIntegerField`,
default 2, beside `truck_capacity_kg`, exposed on the config serializer `useGreenhouseConfig`
reads. One `core` migration.

**Task model.** Add `Task.scope_date = DateField(null=True, blank=True, db_index=True)` — the
daily task needs day identity and only `scope_year`/`scope_week` exist today. Two new
`TaskKind` values: `GAPLAMA_DAILY`, `GAPLAMA_OVERLOAD`. One `export` migration for both, plus
a `Notification.KIND_CHOICES` entry `gaplama_overload`.

**Daily task (D15).** `export/services/gaplama_tasks.py`, Celery beat each working morning
(Asia/Ashgabat), mirroring `truck_allocation_tasks.generate_truck_allocation_task`:
`Task(shipment=None, kind=GAPLAMA_DAILY, assignee_role='loading_dept_head',
completion_rule=MANUAL_DONE, scope_date=today, link='/export/gaplama')`. Idempotent per
`(kind, scope_date)`. **No auto-close** — the head marks it done.

**Over-load (D14).** The same beat run calls `build_gaplama_board` for the current and next
week and collects `over_kg > 0`:
- **Notification** `gaplama_overload` to export_manager, admin, director **and** the loading
  head, de-duplicated per (block, date, excess) so a standing over-load is announced once and
  again only if it grows;
- **Task** `GAPLAMA_OVERLOAD` for `loading_dept_head`, `scope_block` + `scope_date` set,
  idempotent per (kind, block, date). It **auto-closes** when `over_kg` returns to 0, through
  a `resolve_gaplama_overload_tasks()` called from the same beat run and lazily from
  `MeTaskListView`, exactly as `resolve_truck_allocation_tasks` is.

**Why a scheduled job and not a hook on the plan edit:** the dependency rule is
`core ← greenhouse ← export`; `Notification` and `Task` live in `export`, while
`set_plan_value` and the plan-change approval live in `greenhouse`, which may not import
`export`. Django signals are forbidden. Precedent: `_notify_forecast_handoff` fires from
`export`. Beat entries go in `CELERY_BEAT_SCHEDULE`, never a crontab.

## 6. Frontend files

| file | what |
|---|---|
| `pages/sera/GaplamaTab.tsx` | the screen (§3) |
| `pages/sera/GaplamaTab.totals.ts` | **display sums only** — per-location and per-day totals, truck counts, chip grouping. The carry-over rule is not here (D8). |
| `pages/sera/GaplamaTruckForm.tsx` | Tır Aç / Üýtget (create and edit share it) |
| `pages/sera/GaplamaPage.tsx` | standalone page: `.sera-page` + the `export.plan` check + `<GaplamaTab />` |
| `pages/sera/TirTakip.tsx` | `TAB_BODIES` entry `gaplama: { requires: 'export.plan', node: <GaplamaTab /> }` |
| `App.tsx` | route `export/gaplama` → `<ProtectedRoute pageCode="tir_takip.gaplama"><GaplamaPage /></ProtectedRoute>` |
| `utils/permissions.ts` | `ROUTE_PAGE_MAP['/export/gaplama'] = 'tir_takip.gaplama'` |
| `components/AppLayout.tsx` | nav item (no `roles` array — see the `/tir-takip` comment), beside `/tir-takip` in `nav.group_shipping` and `nav.group_export`; `isSeraPage` extended |
| `pages/sera/sera.css` | new `.sera-*` classes under `.sera-page` |
| `hooks/useGaplama.ts` | `useGaplamaBoard(from, to)` and `useUpdateTruckBlocks()` (block-sources POST + `weight_net` PATCH), both invalidating `['gaplama-board']` |
| `types/index.ts` | `IGaplamaDay`, `IGaplamaTruck`, `IGaplamaTruckSource`; `IDraftCreatePayload.shipment_code` optional |
| `i18n/{tk,ru,en}.json` | `tir_takip.gaplama.*`, `nav.gaplama`, the two task titles, the notification copy |
| `components/PlanTaskCard` / `SelfBoard` / `NotificationBell` | the two new task kinds and the new notification kind, as the truck-allocation task did |

Reused: `useGreenhouseBlocks`, `useGreenhouseConfig`, `useCreateDraft`, `BlockFilterSelect`,
`OfficialCodeEditor`, `VarietySelect`, `useShipmentOptions('harvest_status')`,
`useSeasonReadOnly`. `useDayEntries` is **not** needed — plan kg come from the board.

## 7. Testing

**Backend**
- `test_gaplama_board.py`: loaded per block-day; cancelled excluded; null-kg supply rows
  excluded; carry-over FIFO oldest-first; a bucket expiring after `gaplama_carry_days`;
  `available` clamped at 0 with `over_kg` set; a negative never carries; per-location grouping;
  400 on missing/inverted/over-31-day windows; season clamp; 404/403/`[]`; 403 without either
  page code; flat query count as trucks grow.
- `test_gaplama_tasks.py`: the daily task is created once per day and is **not** auto-closed;
  an over-load creates one task per (block, date) and notifies export_manager, admin, director
  and the loading head; a repeat run with the same excess notifies nobody; a grown excess does;
  the task auto-closes when the over-load is gone.
- Config: `gaplama_carry_days` defaults to 2 and reaches the config endpoint.

**Frontend** (vitest)
- `GaplamaTab.totals.test.ts`: per-location subtotals, day totals, truck counts, chips.
- `GaplamaTruckForm.test.tsx`: a row cannot exceed available; submit disabled while it does;
  create payload carries `skip_forecast_check`, today's `date`, `weight_net` = Σ, no
  `shipment_code`, `harvest_status`/`varieties` only when filled; duplicates merged; edit mode
  adds the truck's own kg back into what it may take.
- `GaplamaTab.test.tsx`: no grid inputs for any role; ⚠ rendering; day-column click filters
  ③④; Üýtget hidden once the draft has a country or customer; no Tır Aç without
  `shipment.create`, on a read-only season, or when the week has no today; `['gaplama-board']`
  invalidated after create and edit.
- `GaplamaPage.test.tsx` + `TirTakip.test.tsx`: the same screen behind both entries; no-access
  panel without `export.plan`.
- `AppLayout`: the nav item follows `tir_takip.gaplama`.

## 8. The two entry points

| | tab | standalone page |
|---|---|---|
| where | `/tir-takip`, tab `gaplama` | `/export/gaplama`, own sidebar item |
| page code | `tir_takip.gaplama` | **the same** |
| second gate | `export.plan` (TAB_BODIES `requires`) | `export.plan`, checked in `GaplamaPage` |

Owner decision: the same page code. Nothing to seed or migrate, and no new row for an
`/admin/permissions` Save from `main` to wipe — but an admin **cannot** grant the page without
the tab. That would take a new page code plus a seeding migration.

## 9. Out of scope

- **Soft-deleted drafts still count** in the pool predicate (`cancelled` only). Pre-existing;
  mirrored here on purpose.
- Typing plan kg in the grid (D1); a stored copy of the plan (D2); deleting a truck (D9); an
  export-code generator (D5).
- A per-truck 18 500 kg cap; `skip_forecast_check` also skips the server's per-row cap, as in
  sera — the form only tags partials.
- A **server-side** guard on draft create. The form enforces D3; another screen can still
  create a truck beyond the plan, which surfaces as ⚠ plus the D14 task and notification.
- Fixing the Sheet R8 kg-wipe or the rollup's code-date grouping (§10).
- Per-crop truck capacity; Aktar / Ayyr (the Tırlar tab's Join covers it).

## 10. Risks

- **The Sheet can silently change these numbers.** `POST /shipments/{id}/block-sources/`
  replaces all rows and the Sheet R8 multiselect sends only `{block_id}`
  (`SheetCellEditor.tsx:684-691`), so re-picking blocks **wipes the per-block kg** and
  re-splits `weight_net` evenly (`views.py:3111-3136`). Our edit path always sends kg.
- **Weighing rewrites the split.** `close_pallet_manifest` (`services/shipment.py:765-886`)
  rebuilds `ShipmentBlockSource` from pallet net weights; blocks with no pallets disappear and
  their kg return to available. A past day becomes the real weighed figures.
- **Gaplama drafts shrink the Drafts page forecast pool** for that day — the same trucks.
- **Plan edits can leave a day over-loaded**; D14 is the mitigation, and it fires on a beat
  tick, not instantly.
- **Two task kinds add to an already busy board.** The daily task is manual-close (D15), so a
  forgotten one stays open; `reconcile_tasks` does not know these kinds.
- **Permission wipe.** A Save on `/admin/permissions` from a server running `main` deletes the
  `tir_takip.*` rows, hiding the tab, the nav item and the route and 403-ing the endpoint.

## 11. Where and how it ships

- **`Copy_Gadams_UI` is obsolete — it is now an ancestor of `main`** (merged
  2026-09-22, `afab39f4`; `main..Copy_Gadams_UI` is empty). Tır Takip, including the
  `gaplama` placeholder tab and this design's own docs (committed 2026-09-22,
  `fe118db1`), already live on `main`.
- Build on **`main`**, in its own **git worktree** (`superpowers:using-git-worktrees`).
  The shared `main` working tree carries ~37 unrelated uncommitted files from other
  sessions (quality_inspector, task rules, driver passports) as of 2026-09-23,
  several already `git add`-staged — a worktree gives a private index, not just a
  clean one (see `project_shared_worktree_sessions`).
- **Next migration numbers, verified off `main` HEAD, not the working tree:**
  `backend/apps/core/migrations/0059_*`, `backend/apps/export/migrations/0077_*`. Do
  not reuse a number an uncommitted file in the shared tree happens to hold (that
  tree's own next export number, `0077_gapy_driver_passports.py`, is itself
  untracked).
- Migrations applied immediately after `makemigrations`, confirmed with
  `showmigrations`.
- Expect a merge conflict on `frontend/src/types/index.ts` and the three i18n files
  — another session is also editing them. Not a blocker; resolve at merge time.
- Docs updated with the code: `docs/obsidian/screens/gaplama.md` (new),
  `docs/obsidian/screens/tir-takip.md`, `docs/obsidian/reference/api-endpoint-map.md`, the
  `api-contract` skill, `CHANGELOG.md`, `BUILD_TEST_LOG.md`.
- No commit without the owner's explicit "commit".
