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
per-block carry window and this board redesign — **its per-date batch-picking UI on the
truck form was itself removed the next day** (2026-09-25, "Per-date leftover picking
removed" below); the carry window and board arithmetic that spec introduced are unaffected.

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
each block tunes its own from there, **capped at 30** (`MaxValueValidator`, migration
`core/0061`, 2026-09-25) — the board's walk window is `2 × max(carry_days)` **across every
block**, and each block's own bucket list inside that window is bounded by its own value, so
cost is quadratic in this number and one block's mistake (API-settable only, no frontend field
yet — see below) slows the board for everyone, not just that block. 30 days is already generous
for a fresh tomato even under cold storage. `GreenhouseConfig.gaplama_carry_days` still exists as a
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

### Per-date leftover picking removed from the truck form (2026-09-25)

The 2026-09-24 batch-selection form let an operator pick which **day's** leftover to load —
one row per live `carry_in_breakdown` bucket, each with its own date, age and kg input. The
owner checked with the loading and packaging head: leftover crates are **physically mixed**
once consolidated in the hall — nobody labels them by harvest day — so those per-date rows
described a choice that has no counterpart in the building. Removed, frontend only; the
board's arithmetic, the per-block `carry_days` FIFO bucket, and the backend's named-batch
consumption (below) are all unchanged.

The truck form now shows **at most two rows per block** (`GaplamaTab.totals.ts`,
`buildBlockBatches`/`collapseCarryIn`): today's own plan (a real date, age 0 — omitted when
there's no plan today) and ONE **leftover** row summing every live carry-in bucket for that
block (omitted when there's nothing carried in). The leftover row's stated age is the
**oldest** live bucket's `age_days` — an upper bound ("leftover, up to N days"): honest,
because nothing older survives once a bucket exceeds `carry_days`, even though which crate
is unknown. Loading the leftover row writes its `ShipmentBlockSource.harvest_date` as an
explicit **null**, not omitted — `set_block_sources` treats an explicit key (even null) and
an omitted key as genuinely different requests (see "A known create/edit asymmetry" below);
`build_gaplama_board`'s existing null-`harvest_date` fallback (drain the FIFO pool
oldest-bucket-first, unchanged since 2026-09-24) is exactly the right consumption rule for a
row that represents a mixed pool, so no backend change was needed. `useUpdateTruckBlocks`
(`frontend/src/hooks/useGaplama.ts`) forwards `harvest_date` whenever the row object HAS the
key (`!== undefined`), null included — a truthy check would have silently omitted it and
sent the edit through `set_block_sources`'s preserve/proportional-split branch instead,
re-splitting across the shipment's *prior* per-date rows and undoing the fold on every save.

**Editing a truck saved by the old per-date form** folds every source row into the same two
buckets: a row whose real `harvest_date` equals the truck's own day is today's row; every
other row — one carrying a genuinely different (earlier) date, or an explicit null on a
*resolved* row — sums into the ONE leftover row (`foldEntriesByBlock`,
`GaplamaTruckForm.tsx`). Two or more pre-existing dated leftover rows on one truck fold
together, kilograms summed, not shown separately or dropped. The no-per-batch-data fallback
(`editingTruckBatches` unresolved — this truck wasn't found among the drafts, an edge case)
is a DIFFERENT, weaker signal: it has no per-row date at all, so it is pinned to the truck's
own day (today's bucket) instead — same as it always was before per-date rows existed — NOT
the leftover bucket. An explicit null only means "part of the leftover pool" when it comes
from a row whose per-batch data actually resolved; the fallback never gets that far.

**Fix round 1 (same-day review, `GaplamaTruckForm.tsx`).** Three cases where the collapse
above had stated something untrue or hidden something outright: (1) `effectiveBatches`'s
merge kept only the LIVE bucket's age on a collision, discarding a seeded row's genuinely
older age — a row holding kg picked 9 days before the truck's own day, merging into a live
bucket of age 2, rendered "up to 2 days" instead of "up to 9". The merge now keeps the OLDER
of the two, consistent with "leftover, up to N days" actually being an upper bound. (2) The
row tag could say "age unknown" while the total line beside it said "oldest: 0 d" — 0 reads
as fresh, the opposite of unknown, because `oldestAgeDays` never got the same unknown-age
treatment `leftoverAgeLabel` did. The total line now renders the same "age unknown" text
whenever its own computed max is 0 *and* that 0 came from a leftover row with no real age to
go on, rather than a genuine same-day freshness claim. (3) `foldEntriesByBlock` skipped any
source row with `weight_kg == null` entirely, so a block whose only row had no weight
assigned yet (a supply-first draft's source before a weight was set, `views.py:2231` — the
frontend type claims `number` but the API can send null) rendered no card at all; the
operator had no way to even see the block was on the truck. The block is now still
registered (a bucket is created for it) even though that null-weight row contributes nothing
to either total, and gets one empty row to fill. Also: the local `IGaplamaBatch` interface is
now a type alias of the exported `GaplamaTab.totals.ts`'s `IGaplamaFormBatch`, not a second
hand-kept copy of the same shape.

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
listing that block's **at most two rows** (see "Per-date leftover picking removed" above) —
today's own plan and/or the collapsed leftover, each with its date-or-`Galyndy` label, age
(`iň köne` / oldest-batch age shown beside the truck total via `oldestAgeDays`) and one kg
input. Two caps apply together (`rowInvalid`): each row is capped at that batch's own gross
`available_kg` (the leftover row's is the sum of every live carry-in bucket, snapshotted
**before** that day's own consumption — the same snapshot the board's tooltip shows), and
the block's row SUM is separately capped at `availableByBlock[blockId]`, the block-level net
figure the board itself reports. The per-row cap alone is not airtight: it is a gross,
point-in-time figure, so a second truck opened the same day can still show the same
leftover's full remaining kg even after a first truck already drew from it — the
block-level SUM cap is the actual backstop that stops the block from being oversold, per
`blockCapFor`'s own comment. The card header shows the block's own carry window
(`carry_days`). `+ Blok goş` adds another block; an export-code field, harvest-status select
and variety select sit below the block cards. Submitting
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

**A seeded edit row's own kg is a floor on its bucket's cap, not a ceiling (2026-09-25).**
Originally (same day, pre-leftover-collapse): every shipment on the live DB has
`harvest_date = NULL` on every `ShipmentBlockSource` row, so the seeded edit row fell back
onto the truck's own day — landing on the SAME date as that day's own-plan batch. Pre-fix the
row's kg (which may represent carry-in a legacy row can't attribute to one date) was measured
against that day's plan alone: a draft that had already loaded more than the day's own plan
opened with its row flagged invalid and Save disabled, before the operator touched anything. A
first fix special-cased only `harvest_date == null` — but `handleSubmit` writes back a real,
resolved date, so the SAME row looked ordinary (not null) on its next Üýtget and the bug came
back one save later. `computeOrphans` was widened to register **every** seeded row as an orphan
candidate, not gate on null-ness, closing that reopen path.

The leftover-picking removal later the same day (see above) simplified this further:
`null` is now the leftover bucket's own permanent, stable key — never resolved to a real date
on save — so the round-2 "reopens on the second edit" failure mode is structurally gone, not
just patched. `foldEntriesByBlock` (shared by `initialRowsFor` and `computeOrphans`, so the two
can never disagree) sums a truck's real source rows into at most two buckets per block —
today's (a real date, only rows dated exactly the truck's own day) and leftover (`null`,
everything else) — and `computeOrphans` still floors each bucket's cap at what it already
holds: `effectiveBatches` merges rather than replaces, `max(live cap, the bucket's own kg)`, so
kg already on the row is never flagged invalid while the live cap still applies above that
floor (raising it further can still go red).

**Asymmetric overdraw guard (owner's 2026-09-25 decision).** The orphan floor above stops a
seeded row from opening invalid; it does not by itself say what happens when the operator then
*edits* that row. `rowInvalid` gates on the row's own seeded kg (the value it held when the form
opened, `seededKg[blockId:harvestDate]`, computed once at mount the same way as `orphans`):
reducing a row, or leaving it untouched, is **always** allowed, even while its kg stays above
what the block genuinely has today — `if (row.kg <= seededKg) return false`, before either the
per-batch or the block-level check runs. Only an **increase** past that seeded floor is measured
against `max(seeded, liveCap)`; increasing past both is refused, with the row marked invalid
(`aria-invalid`, red `InputNumber` border) and Save blocked. The explanation is **not** repeated
per row — round 1 tried that (`.sera-gaplama-form-row-error`, 160px, next to the input) and it
became a wall of wrapped text once more than one row was over. The owner's text
(`tir_takip.gaplama.form.insufficient_harvest`) is one instruction meant to be read once, so it
now renders as a single notice (`.sera-gaplama-form-overdraw-notice`, same red as
`.sera-gaplama-cell-over`, room for 1-2 lines) above the Save/Cancel row, shown whenever any row
is over (`anyExceeds`) — the offending row(s) still carry their own red border on their own.

The gate also protects an **untouched sibling row in the same block**: before this fix, the
block-level SUM check (`blockTotal(blockId) > blockCapFor(...)`) fired uniformly across every row
in the block once the sum went over, so increasing one row painted a completely untouched row red
too; the per-row gate exempts any row at or below its own seeded value from that check as well, so
only the row actually increased is flagged. This is NOT a redundant belt-and-braces addition —
verified by reproducing the fixture against the pre-fix source (`git show 8a663684`) in an
isolated, throwaway test: pre-fix, the untouched sibling really does come back `aria-invalid`.
`blockCapFor`'s `own` (`props.editingTruck.block_sources.find(...)`) is always the truck's FULL
saved total for that block, never a partial one — `build_gaplama_board`'s truck-listing query
folds every `ShipmentBlockSource` row for a truck onto its parent block into one summed entry
(`gaplama.py`, the `existing_source.weight_kg += weight_kg` fold, "two different sub-blocks under
the same parent") before the frontend ever sees it — so `blockCapFor = base + own >= own =
seededBlockTotal` always, given `available_kg` is clamped at `max(0, ...)` server-side (`base >=
0` always). That makes a *block-level* floor formula (`max(seededBlockTotal, blockCapFor)`)
provably redundant on its own — the gate is what is actually load-bearing, because the pre-fix
block check applied to every row in the block uniformly, not just the one that moved. Tests:
`GaplamaTruckForm.test.tsx`, describe block `overdraw guard (seeded floor)` (7 cases, incl. one
edit-mode case where a row seeded below the live cap is raised within it — the create-mode
equivalent alone doesn't exercise the orphan-merged live cap at all).

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

**`harvest_date` is parsed to a real `date` before it keys the merge (2026-09-25).** An explicit
entry's `harvest_date` arrives as a raw request string; a *preserved* entry (the caller omitted
the key, so the endpoint reads the block's existing batches back from the DB) carries a real
`date` object. `merge_to_parent` keys on `(parent_id, harvest_date)`, and a str and a date naming
the same calendar day are different dict keys — reachable with a payload mixing a dated
sub-block entry and a bare sibling folding to the same parent (e.g. F1 dated, F2 bare, both →
F). Pre-fix the two never merged, both got written, and the `(shipment, block, harvest_date)`
unique index rejected the pair as an unhandled exception on the `bulk_create` (500). The explicit
value is now parsed with `django.utils.dateparse.parse_date`; an unparseable string, an
impossible calendar date (`parse_date` raises `ValueError`), or a non-string value (raises
`TypeError`) is a 400 naming `harvest_date` instead. `null`/`''` still means "clear to a
dateless row", unaffected.

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
| Pure arithmetic | `frontend/src/pages/sera/GaplamaTab.totals.ts` + `.test.ts` — incl. `collapseCarryIn`/`buildBlockBatches` (leftover collapse, 2026-09-25) |
| Hooks | `frontend/src/hooks/useGaplama.ts` — `useGaplamaBoard`, `useUpdateTruckBlocks` |
| Types | `frontend/src/types/index.ts` — `IGaplamaDay`, `IGaplamaTruck` |
| Endpoint | `backend/apps/export/views_gaplama.py` — `GaplamaBoardView` |
| Service | `backend/apps/export/services/gaplama.py` — `build_gaplama_board` |
| Permission | `backend/apps/export/permissions.py` — `CanViewTirGaplama` |
| Carry window | `backend/apps/core/models/greenhouse_block.py` — `GreenhouseBlock.carry_days` (default 7, capped at 30 via `MaxValueValidator`, per-block, migrations `core/0060` + `core/0061`). `GreenhouseConfig.gaplama_carry_days` (`backend/apps/core/models/config.py`, default 2) still exists but is no longer read anywhere. |
| Batch key | `backend/apps/export/models/shipment.py` — `ShipmentBlockSource`, `unique_together = ('shipment', 'block', 'harvest_date')` (migration `export/0077`, no backfill — see above) |
| Admin CRUD for blocks (incl. `carry_days`) | `backend/apps/greenhouse/views_admin.py` — `GreenhouseBlockAdminViewSet`, `PATCH /api/v1/greenhouse/admin/blocks/{id}/` (director only). `frontend/src/pages/admin/BlocksPage.tsx` has a `carry_days` field (`InputNumber`, required, `type: 'integer'` rule bounded 1–30) in the create/edit drawer since 2026-09-25 — new blocks default to 7; editing seeds the block's current value so an unrelated field edit can't reset it. `frontend/src/pages/admin/BlockDetailPage.tsx` (sub-blocks) and `frontend/src/pages/admin/shipment-settings/OptionListsTab.tsx` (quick block list) also call `useCreateBlock`/`useUpdateBlock` but have no `carry_days` UI — they send `carry_days: 7` only on create and omit the key entirely on update (the endpoint is a partial `PATCH`), so they can't silently reset an existing block's value either. |
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
