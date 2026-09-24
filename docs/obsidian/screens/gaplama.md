---
title: Gaplama
tags: [screen, export, sera-design, tir-takip]
related: [[tir-takip]], [[../processes/weekly-harvest-planning]], [[../reference/api-endpoint-map]]
---

# Gaplama — packing view over the Weekly Plan

Two entry points, one screen: the `gaplama` tab of `/tir-takip` (`TirTakip.tsx`'s
`TAB_BODIES`) and its own route at `/export/gaplama` (`GaplamaPage.tsx`, sidebar entry
under the export group). Both mount `frontend/src/pages/sera/GaplamaTab.tsx` unmodified —
`GaplamaPage` is a thin `.sera-page` wrapper around it, nothing else. Both are gated on
the **same pair of page codes**: `tir_takip.gaplama` (the entry point's own code, shared
by design between the tab and the standalone route) and `export.plan` (the audience of
the Weekly Plan data the board reads). The tab checks the pair through
`TAB_BODIES.gaplama.requires`; the standalone route checks `tir_takip.gaplama` in the
router (`<ProtectedRoute pageCode="tir_takip.gaplama">`) and `export.plan` itself via
`canSeePage()`. The API enforces the identical pair server-side
(`CanViewTirGaplama`, superuser bypass) — so neither entry point can be widened by
forgetting a check on one side only.

## What it shows

One table, not a fixed week grid — a `Gün` (day) / `Hepde` (week) toggle in the filter bar
switches between a single-day view (default, `mode === 'day'`) and the week view the old
grid used to be the only option for (`GaplamaTab.tsx`). Both modes read the same
`GET /api/v1/export/gaplama/board/` response and group rows by `GreenhouseBlock.location_name`
(Dusak / Kaka / Owadandepe), each group with its own subtotal row; a block with no location
falls into a trailing group labelled `tir_takip.gaplama.location_other`. Backed by
`backend/apps/export/services/gaplama.py` (`build_gaplama_board`) — see
`docs/superpowers/specs/2026-09-18-tir-takip-gaplama-design.md` for the original design
(D1-D16) and `docs/superpowers/specs/2026-09-24-gaplama-batch-selection-design.md` for the
per-block carry window, batch selection, and this board redesign.

**Day view** is one row per block: `available`, `plan`, `loaded`, carried-in, carried-out, and
a truck-count column (`⌊available_kg / truck_capacity_kg⌋`) — what used to be the separate
bottom summary table, now the whole screen when `Gün` is selected; that old two-table layout
(week grid above, day-filtered summary below) is gone. A footer below the table lists the
day's actually-opened trucks (code + kg) and a truck-count-by-location total, unchanged from
the old summary table's own footer. **Two colours only**, replacing the old `0 ⚠` glyph: a
cell is green
(`sera-gaplama-cell-full`) when `available_kg` covers at least one whole truck
(`available_kg >= truck_capacity_kg`), red (`sera-gaplama-cell-over`) when the day is
over-loaded (`over_kg > 0`), plain otherwise. An over-loaded cell's own text becomes the
tooltip string `over_tooltip` ("N kg artyk / over"), not the number. A block with nothing to
show today — no row, or a row with both `available_kg` and `over_kg` at zero — folds
(`isEmptyToday`) into **one single expandable `folded_blocks` row for the whole table**
(not one per location), listing each folded block's name with its location in parentheses
when expanded; an over-loaded block never folds, since that is the alert this screen exists
to surface. A location group whose blocks are *all* folded disappears from view entirely —
its own header row and subtotal row are skipped, not just its blocks — since its blocks are
still reachable inside the one global fold row. **Week view** is the old
week grid unchanged in shape: one row per block, one column per day, a `week_total` column —
with per-cell detail (plan hint, carry-in origins, carry-out) moved into a hover `title`
instead of stacked numbers, since the redesign keeps the week grid to one number per cell.

Filters — the location `Select`, `BlockFilterSelect`, and the `◀`/`▶` day stepper — sit in one
bar above the table (`stepDay`, `GaplamaTab.tsx`). The day stepper moves one day at a time in
`Gün` mode and one full week at a time in `Hepde` mode; there is no separate week
prev/this-week/next control. Filtering (location or block) narrows the grid, footer, and
location subtotals together — every aggregate reads from the same filtered `boardDays`/`blocks`
rather than the raw board, so nothing can desync. The truck form is the one place that
deliberately reads the **unfiltered** board (`capForBlockDate` reads `board.days`, not
`boardDays`), since a truck sourced from a block the current filter hides must still be
editable.

### The carry-over rule (no negative numbers)

`available_kg = max(0, carried_in_kg + plan_kg - loaded_kg)`. A day that gets loaded past
its own plan plus its carry-in never goes negative on screen — the overshoot is clamped to
0 and reported separately as `over_kg = max(0, unconsumed_load - plan_kg)`. A day that
finishes with plan left over seeds a **FIFO bucket**, one per block, consumable for
**`GreenhouseBlock.carry_days`** days after it was created — **per block**, not global
(2026-09-24; replaces the single `GreenhouseConfig.gaplama_carry_days`, which used to apply
2 days to every block regardless of whether it has cold storage). Default `carry_days` is 7;
each block tunes its own from there. `GreenhouseConfig.gaplama_carry_days` still exists as a
model field but is no longer read anywhere — its removal is a separate cleanup, not done here.
A bucket created on day D is live through day `D + carry_days` and expired from `D + carry_days
+ 1` onward (`(d - origin).days > carry_days` in `build_gaplama_board`) — e.g. a `carry_days=2`
block's leftover from Monday is still available Wednesday, gone Thursday. A negative remainder
never carries forward; only a positive one does. Each day's leftover also carries a small `N →`
marker (the day's own fresh remainder moving on), and a `+N` badge tooltips the origin day(s)
it came from (`carry_in_breakdown`, which now also carries each bucket's `age_days`) — both
added 2026-09-23.

**A load drains the bucket the operator named, not always the oldest one** (2026-09-24, batch
selection). `ShipmentBlockSource.harvest_date` identifies which batch — which day that block
was picked — a load came from; `build_gaplama_board` matches it against the live bucket with
that same origin date and drains that one first. Three cases fall back to plain oldest-bucket-first
FIFO instead: a load with no `harvest_date` at all (every row written before batch selection
shipped); a load naming a `harvest_date` that matches no live bucket, because that bucket has
since expired or never existed; and any portion of a load that exceeds what its named bucket
still holds — the excess rejoins the FIFO pool rather than being lost or driving the bucket
negative. Every shipment created before this change has `harvest_date = NULL` on every row, so
it is drained the same relative way it always was — oldest bucket first, unchanged. **This is
about drain order only, not about the numbers a historical week reports matching exactly**: a
past week's `available_kg`/`over_kg` recomputed on this branch can differ from what it showed
before, because `GreenhouseBlock.carry_days` defaults to 7 where `GreenhouseConfig.gaplama_carry_days`
defaulted to 2 — a separate change (per-block carry windows) shipped in the same branch, not
something the FIFO fallback offsets. The two claims are independent: FIFO attribution is
unchanged; the carry window's length is not.

**The client asks for exactly the displayed week (Monday–Sunday), no widening** — fixed
2026-09-23, since widening used to inflate `week_totals`' summed fields with days outside
the week shown. Getting the first displayed day's carry-in right is entirely the server's
job: `build_gaplama_board` walks from `2×` the **widest `carry_days` in the whole
`GreenhouseBlock` table** before `from_date` (not `1×`, and no longer a single global value —
each block still expires on its own `carry_days` inside that shared window, but the window
itself must be sized by whichever block carries the longest). The lookback query
(`GreenhouseBlock.objects.values_list('id', 'carry_days')`) is unfiltered — it covers inactive
blocks and sub-blocks too, not just the active top-level blocks that actually get a `days[]`
row, so an unusually large `carry_days` on a block the board never displays can still widen
the window for every block that is displayed. At the everyone-starts-at-7 default, that
lookback is 14 days, not the 4 days it was under the old global 2-day config. A single `carry_days` of lookback only protects
`from_date`'s own zero-seed boundary, not the correctness of the day that WOULD have been that
boundary under the old 1x rule, which itself needs `carry_days` of visibility to compute right
before it can forward that correctness to Monday. Those lookback days are computed but never
emitted in `days[]`. **This is a bounded approximation, not a proof for arbitrarily long
chains** — see `build_gaplama_board`'s own docstring and the design spec's §4 Window note for
the exact caveat and a residual-error example. **This caveat is unchanged by the 2026-09-24
batch-selection work** — it is about the depth of the lookback window, not about which bucket
a load drains.

**Week totals are not a client-side sum.** `week_totals[]` on the board response gives
`plan_kg`/`loaded_kg`/`over_kg` as real sums (each day's figure is independent) and
`available_kg` as the **last day's** value in the window — summing `available_kg` across
days would double-count a remainder that stays live for several days. In `Hepde` mode,
`GaplamaTab.tsx`'s week-aggregate cells — the per-block `week_total` column and each
location subtotal row's own week-total cell — read this array rather than summing
`available_kg` client-side. Day mode has no such aggregate to get wrong: `available_kg` is
read straight off the single selected day's row.

## Opening a truck

The **+ Tır Aç** button is shown to any role holding `shipment.create`
(`canDoBackendGated(user, 'shipment', 'create')`) in a season that isn't read-only, same
gate the Sheet's own supply drafts use. It is **disabled unless the displayed week
contains today** — that gate is unchanged — but the truck's date is no longer pinned to
the calendar's real today. It is fixed to whichever day the operator has navigated to
with the day stepper (`selectedDay` in `Gün` mode; `props.today` passed into
`GaplamaTruckForm`, "the day being VIEWED … not real 'today'" per the 2026-09-24 fix in
`GaplamaTab.tsx`). So an operator can page the day stepper to Wednesday while staying
inside the current week, click **+ Tır Aç**, and open a truck dated Wednesday. The button
itself still exists on every week for layout consistency and only does anything when that
week contains today.

Clicking it opens `GaplamaTruckForm` in place of the button: one card per block, each
listing that block's **batches** — the live carry-in buckets plus the day's own fresh plan,
each with its harvest date and age (`iň köne` / oldest-batch age shown beside the truck
total via `oldestAgeDays`) — one kg input per batch. Two caps apply together
(`rowInvalid`): each batch row is capped at that batch's own gross `available_kg` (its
`carry_in_breakdown` figure, snapshotted **before** that day's own consumption — the same
snapshot the board's tooltip shows), and the block's row SUM is separately capped at
`availableByBlock[blockId]`, the block-level net figure the board itself reports. The
per-batch cap alone is not airtight: it is a gross, point-in-time figure, so a second truck
opened the same day can still show the same batch's full remaining kg even after a first
truck already drew from it — the block-level SUM cap is the actual backstop that stops the
block from being oversold, per `blockCapFor`'s own comment. The card header shows the
block's own carry window (`carry_days`). `+ Blok goş` adds another block; an export-code
field, harvest-status select and variety select sit below the block cards. Submitting
creates a draft the same
way the Sheet's own supply composer does —
`{ is_draft: true, date: <the day being viewed>, skip_forecast_check: true,
block_sources: [{ block_id, weight_kg, harvest_date }, ...], weight_net: totalKg,
export_code?, harvest_status?, varieties? }` via `useCreateDraft` — each `block_sources`
entry now carries the `harvest_date` of the batch it was drawn from, so the load drains
that named bucket on the board (see the carry-over rule above). The new truck appears on
the Sheet as an ordinary supply column and is joined to a destination there as usual, the
same as any supply-first draft. The kg total is compared against
`GreenhouseConfig.truck_capacity_kg` (default 18 500) purely to tag the truck **Partial**
(`isPartialTruck`) — under-filling a truck is allowed, not blocked.

## Editing a truck (Üýtget)

Shown only while the truck is still a bare supply row — `status_code === 'draft'` **and**
`country == null` **and** `customer == null`. The moment it is joined to a destination it
drops off this list's edit affordance and is edited on the Sheet like any other row
instead.

Clicking **Üýtget** swaps the create button/form for the same `GaplamaTruckForm`, pre-filled
from the **drafts endpoint** (`useDrafts()`), not the board's own `trucks[]` — the board
response carries no `harvest_date` per block source, only the drafts list
(`DraftBlockSourceInlineSerializer`) does, and the form needs each batch's date to seed its
per-batch rows correctly. The block-level SUM cap (`blockCapFor`, see above) adds the truck's
own current total **in that block** (summed across whichever batches it already holds there,
from the board's `trucks[].block_sources` — block grain, not per-batch) back onto
`availableByBlock` — so the truck's own existing kg is never counted against itself as
"unavailable" when editing. Saving calls `useUpdateTruckBlocks`, which
is **two calls**, not one: `POST /export/shipments/{id}/block-sources/` with
`{ blocks: [{ block_id, weight_kg, harvest_date? }] }` (body key is `blocks`, not
`block_sources`; `harvest_date` is forwarded per row when the batch has one — verified against
`ShipmentViewSet.set_block_sources`), then `PATCH /export/shipments/{id}/` with the new
`weight_net` total. Both are calls the Sheet's own editors already make; nothing new was added
to the backend transport for this screen, though `set_block_sources` itself gained batch
handling — see the asymmetry note below.

`DraftBlockSourceInlineSerializer` — the same serializer backing this pre-fill — stays
per-row on purpose rather than grouping by block the way the Sheet's own
`ShipmentSheetSerializer.get_block_sources` now does (see "Sheet chip grouping" below): this
form's edit pre-fill needs each batch's own `harvest_date`, which a grouped/summed shape
would lose. The cost is cosmetic and lives on a different screen — the DraftPool `DraftCard`
still shows one block chip per batch, so a multi-batch block's card can show the same block
chip twice.

### A known create/edit asymmetry (not fixed here, on purpose)

Creating a shipment (`ShipmentCreateSerializer.validate`, `backend/apps/export/serializers.py`)
**rejects** two `block_sources` entries that share a `(block, harvest_date)` key — including
two entries that both omit the date, which are treated as an indistinguishable accidental
duplicate — with a 400 naming the conflict. `set_block_sources` (the edit endpoint the Sheet's
R8 block editor and `GaplamaTruckForm`'s Üýtget both call) has **no uniqueness check at all**:
it builds a flat list of entries and hands them to `write_block_sources` →
`services/block_sources.py::merge_to_parent`, which silently **sums** any two entries that land
on the same `(parent_block, harvest_date)` key and returns 200. For a block with no prior rows,
the exact same operator input — two batches, same date, same block — is refused on the create
path and quietly merged into one row on the edit path. This is not new: edit's merge-not-reject
design predates the 2026-09-24 batch-selection work, which only widened the key both paths
already partially enforced. It is left alone on purpose here: making edit reject would change
an endpoint the Sheet's R8 block editor depends on for its own (unrelated) merge behaviour, and
making create merge would discard the duplicate-submission protection create currently has. The
next person touching either path should know about the other before "fixing" just one.

### Remount-on-edit-target-change

`GaplamaTruckForm` is given a `key` prop that changes with the edit target — `edit-<id>`
for a specific truck, `create-<selectedDay>` otherwise — set in `GaplamaTab.tsx`. Without
that key, clicking **Üýtget** on truck B while truck A's edit (or an unsubmitted create) is
still open in the form would change the `mode`/`editingTruck` props but React would keep the
same component instance — the form's own `useState(initialRowsFor(props))` never re-runs on
a prop change, so it would silently keep showing the previous truck's rows while claiming to
edit the new one. The key forces a full remount on every switch between create, and each
distinct truck's edit, so the rows always start from that target's own data. The create key
also carries `selectedDay` (2026-09-24) — stepping the day stepper while an unsubmitted create
form is open must not leave it showing the previous day's batch rows and caps against the
newly-viewed day.

### Why old rows don't need a `harvest_date` backfill

`ShipmentBlockSource` is keyed `(shipment, block, harvest_date)` since export migration
`0077_block_source_batch_key`, widened from `(shipment, block)`. That migration ships with
**no data backfill**, and the spec that preceded it (`docs/superpowers/specs/2026-09-24-gaplama-batch-selection-design.md`,
Risk 1) was wrong about why one would be needed: it assumed MSSQL permits only one `NULL` per
unique key, which is true of a plain unique constraint or index but **not** of the index
`mssql-django` actually generates for a nullable `unique_together` — a **filtered** index,
`CREATE UNIQUE INDEX ... WHERE [shipment_id] IS NOT NULL AND [block_id] IS NOT NULL AND
[harvest_date] IS NOT NULL` (reproduce with `python manage.py sqlmigrate export 0077`). A
filtered index excludes any row with a null `harvest_date` from the index entirely, so any
number of `(shipment, block, NULL)` rows coexist without conflict — there was nothing for a
backfill to protect against. `.claude/rules/mssql-compat.md` states the one-NULL-per-key rule
in general terms (correct for an ordinary unique index); it does not cover this filtered case,
so don't re-derive a backfill requirement from it for this migration. A backfill was tried and
rejected anyway on separate grounds: `Shipment.harvest_date` (R39) is a free-text `CharField`
with ranges and non-ISO formats, not a parseable date. Every row written before 2026-09-24 has
`harvest_date = NULL`, stays legal, and is consumed FIFO by the board's fallback — see the
carry-over rule above.

## Sheet chip grouping

The Sheet (outside this screen, but affected by the same batch-selection change) shows one
chip per block per truck. Now that a block can hold two `ShipmentBlockSource` rows — two
batches, different `harvest_date` — `ShipmentSheetSerializer.block_sources`
(`backend/apps/export/serializers.py`) is a `SerializerMethodField` (`get_block_sources`)
that groups the prefetched rows by block and sums `weight_kg`, so a truck that took two
batches from one block still paints a single chip carrying the combined weight, not two
chips for the same block. `harvest_date` is dropped from this grouped shape — ambiguous
once summed, and no Sheet component reads it (R39 reads the scalar `Shipment.harvest_date`
instead, not `ShipmentBlockSource.harvest_date` despite what that field's own model comment
says — see the note below). Per-batch detail belongs on this screen, not the Sheet.

**Stale model comment:** `ShipmentBlockSource.harvest_date`'s docstring
(`backend/apps/export/models/shipment.py`) still calls it "the primary source for Sheet
R39"; as of the grouping above, R39 reads `Shipment.harvest_date` and the Sheet never reads
`ShipmentBlockSource.harvest_date` at all.

## Not built in this screen

Task and notification wiring for a daily "open today's trucks" reminder and an over-load
alert (D14/D15 in the design spec) is a separate, deferred feature — see
`docs/superpowers/plans/2026-09-23-gaplama-tasks.md`. Undo/redo and multi-row selection are
not part of this screen at all (that is the Sheet's clipboard feature, unrelated).

## Files

| Role | Path |
|---|---|
| Tab body | `frontend/src/pages/sera/GaplamaTab.tsx` + `.test.tsx` |
| Standalone page | `frontend/src/pages/sera/GaplamaPage.tsx` + `.test.tsx` |
| Truck form | `frontend/src/pages/sera/GaplamaTruckForm.tsx` + `.test.tsx` |
| Pure arithmetic | `frontend/src/pages/sera/GaplamaTab.totals.ts` + `.test.ts` |
| Hooks | `frontend/src/hooks/useGaplama.ts` — `useGaplamaBoard`, `useUpdateTruckBlocks` |
| Types | `frontend/src/types/index.ts` — `IGaplamaDay`, `IGaplamaTruck` |
| Endpoint | `backend/apps/export/views_gaplama.py` — `GaplamaBoardView` |
| Service | `backend/apps/export/services/gaplama.py` — `build_gaplama_board` |
| Permission | `backend/apps/export/permissions.py` — `CanViewTirGaplama` |
| Carry window | `backend/apps/core/models/greenhouse_block.py` — `GreenhouseBlock.carry_days` (default 7, per-block, migration `core/0060`). `GreenhouseConfig.gaplama_carry_days` (`backend/apps/core/models/config.py`, default 2) still exists but is no longer read anywhere. |
| Batch key | `backend/apps/export/models/shipment.py` — `ShipmentBlockSource`, `unique_together = ('shipment', 'block', 'harvest_date')` (migration `export/0077`, no backfill — see above) |
| Admin CRUD for blocks (incl. `carry_days`) | `backend/apps/greenhouse/views_admin.py` — `GreenhouseBlockAdminViewSet`, `PATCH /api/v1/greenhouse/admin/blocks/{id}/` (director only). No frontend field for `carry_days` yet — `frontend/src/pages/admin/BlocksPage.tsx` doesn't send or edit it. |
| Config | `backend/apps/core/models/config.py` — `.truck_capacity_kg` (default 18 500) |
| Tests | `backend/apps/export/tests_gaplama_board.py`, `tests_gaplama_batch_consumption.py`, `tests_gaplama_carry_days.py`, `tests_block_source_batches.py`, `backend/apps/core/tests_block_carry_days.py`, `backend/apps/greenhouse/tests_block_admin_carry_days.py` |
| Route | `frontend/src/App.tsx` — `export/gaplama`, `pageCode="tir_takip.gaplama"` |
| Nav | `frontend/src/components/AppLayout.tsx` — `nav.gaplama` |
| i18n | `frontend/src/i18n/{tk,ru,en}.json` — `tir_takip.gaplama.*`, `nav.gaplama` |
| CSS | `frontend/src/pages/sera/sera.css` — `.sera-gaplama-*` |
| Design spec | `docs/superpowers/specs/2026-09-18-tir-takip-gaplama-design.md` (original board), `docs/superpowers/specs/2026-09-24-gaplama-batch-selection-design.md` (carry-days per block, batch selection, this board redesign) |

## Migrations not yet applied to the shared dev database

`core/0060_greenhouseblock_carry_days` and `export/0077_block_source_batch_key` are on this
branch (`feat/gaplama-batches`) but have **deliberately not been run** against the shared
development database — every worktree in this repo points at the same DB, and applying a
branch's migrations there breaks every other session's code that doesn't know about the new
column/constraint yet (an earlier attempt on this branch did exactly that with a NOT NULL
column). **Whoever merges this branch must run `migrate core` and `migrate export`** before
this screen's per-block carry window or batch selection can be exercised against real data.
Remove this section once that migrate has happened — it describes a temporary state of the
shared dev DB, not a permanent property of the feature.
