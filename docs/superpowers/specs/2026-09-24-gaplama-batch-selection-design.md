# Gaplama — partiýa saýlamak (batch selection) — design

**Date:** 2026-09-24
**Status:** approved in brainstorming, not implemented
**Supersedes parts of:** `2026-09-18-tir-takip-gaplama-design.md` (§3 carry-over, §4 window)

## Prerequisite

The Gaplama screen is **not on `main`**. It lives on `worktree-gaplama-screen`
(34 commits ahead of `main`, 4 behind). This work builds on that code, so either
it merges first or the implementation branches from it. Nothing here can land on
`main` alone.

## Problem

Two things the current screen gets wrong, reported by the owner 2026-09-24:

1. **The carry-over window is one global number.** `GreenhouseConfig.gaplama_carry_days`
   (`backend/apps/core/models/config.py:77`) defaults to 2 and applies to every block.
   In reality some blocks have cold storage and hold tomatoes for 3–4 days or a week.
2. **You cannot see or choose which remainder you are loading.** The truck form
   (`GaplamaTruckForm.tsx`) takes one kg figure per block; the server then consumes
   buckets oldest-first. An operator typing `16 000` from block A does not know they
   just sent the four-day-old crate. That matters because the export manager later
   routes the truck to a country whose transit takes days — old cargo will not survive
   a long haul.

A third, separate complaint: the screen is unreadable. 16 blocks × 7 days, up to four
unlabelled numbers per cell, two tables showing the same blocks, a hidden day filter,
and a `0 ⚠` glyph whose meaning lives only in the docs.

## Decisions taken

| Question | Answer |
|---|---|
| Does the system block an unsuitable batch? | **No. It shows, the human decides.** No shelf-life data, no validation, no refusal. |
| How is storage duration configured? | A field on the block. **Every block starts at 7 days.** No cold-storage flag, no per-variety rules. |
| What does "choosing a remainder" mean? | **Manual.** The operator types kg against each batch date. Not a FIFO preview. |
| Is the country shown in the truck form? | **No.** Gaplama prepares a supply draft; the export manager picks the destination later. |
| Is the export-manager side in scope? | **No — a later task.** See *Out of scope*. |

## Scope

**In:** the Gaplama board, the truck form, per-block carry days, batch-level recording.

**Out of scope, deliberately:**

- **The export manager's destination screen.** Cargo age only becomes actionable when
  the country is known, which happens on a different screen at a different time. Until
  that is built, batch selection records intent but nothing compares age to transit days.
  The owner accepted this sequencing.
- **Transit days.** `typical_transit_days` exists on `BorderPoint`
  (`backend/apps/core/models/geography.py:60`) — days to the border, not to the customer.
  Door-to-door days are not modelled anywhere. Both belong to the deferred task.
- Shelf life per variety, cold-storage as a separate location, automatic routing.

## 1. Data model

### 1.1 `GreenhouseBlock.carry_days`

```python
carry_days = models.PositiveSmallIntegerField(default=7)
```

Replaces `GreenhouseConfig.gaplama_carry_days` as the authority. Migration sets every
existing block to 7. The config field is left in place but stops being read by
`build_gaplama_board`; removing it is a separate cleanup.

### 1.2 `ShipmentBlockSource`: one row per batch

Today: `unique_together = [('shipment', 'block')]` (`backend/apps/export/models/shipment.py:445`).
One row per block means two batches from one block cannot be recorded.

Becomes `unique_together = [('shipment', 'block', 'harvest_date')]`.

`harvest_date` already exists on that model and already means "the date the tomatoes
from this block were harvested". A batch **is** a harvest date — no new identity is
needed. The field stops being typed by hand and becomes the batch the operator picked.

## 2. Server

### 2.1 Per-block window

`build_gaplama_board` walks from `2 × carry_days` before `from_date`. With per-block
values the walk starts at `from_date - 2 × max(carry_days)` over the active blocks;
each block then expires its own buckets at its own `carry_days`. A single walk start
keeps the query count unchanged. The existing §4 caveat about bounded approximation
still applies and is unchanged by this work.

### 2.2 Age in the breakdown

`carry_in_breakdown` already returns `{origin_date, kg}` per bucket. Add `age_days`
(`board_date − origin_date`) so the client does not recompute dates.

### 2.3 Consumption follows the operator, not FIFO

Today loads are consumed oldest-bucket-first. They must instead be attributed to the
bucket named by each `ShipmentBlockSource.harvest_date`.

**Fallback for unattributed load:** a row whose `harvest_date` is null, or points at a
date with no live bucket, is consumed FIFO exactly as today, and the existing
`over_kg = max(0, unconsumed_load − plan_kg)` clamp still applies. This keeps every
shipment created before this change computing the same numbers it does now.

## 3. The board

One table with two modes, replacing today's two tables.

- **`Gün` (default)** — what is now the summary table below the grid
  (`Blok | Plan | Ýüklenen | Boş`), promoted to the main view, always visible, plus two
  columns: `Geçen` (carry-in) and `Tir` (whole trucks available). Blocks with no
  remainder collapse into one `▸ ýene N blok — boş ýok` row.
- **`Hepde`** — today's week grid, behind the toggle, rendered for the selected blocks
  only. Unfiltered it is 16 rows again, which is the state being fixed.

The standalone summary table is deleted: it was a per-selected-day summary, and the day
is now the primary mode.

**Filter bar, full width, above the table:** location · blocks · day `◀ ▶` · `Gün / Hepde`
· `+ Tır Aç` on the right. The block filter exists today but is visually buried; the day
filter exists only as an undocumented click on a column header.

**Two colours, not four:** green = a whole truck is available, red = overloaded
(replacing `0 ⚠`). Everything else is unstyled. Thousands separators and `kg` throughout.
Weekday names and a highlighted today column in the week header — `today` is computed in
`GaplamaTab.tsx:35` and never used for styling.

**The rule is written on the screen,** not only in the docs:
`Boş = geçen + plan − ýüklenen`, plus the block's own carry window.

## 4. The truck form

Unchanged: `+ Blok goş` and the block picker, `Eksport kody`, `Ýygnaýyş ýagdaýy`,
`Sort`, the total, the buttons, and the draft it creates. The country is still absent.

Changed: the single kg field per block becomes **one kg field per batch**. Each block
card lists its live batches — harvest date, age, available kg, an input — and shows the
block's carry window in its header. The total gains `iň köne: N gün` (the oldest batch
being loaded).

The per-block cap (`capFor`) becomes a per-batch cap, and the block total stays capped
at the block's available kg.

## 5. Risks

1. **MSSQL treats NULL in a unique index differently from Postgres** — it permits only
   **one** NULL row per key combination. Existing `ShipmentBlockSource` rows have a
   nullable `harvest_date`, so adding `harvest_date` to `unique_together` will fail on
   any shipment/block pair with more than one null. The migration must backfill nulls
   before the constraint is applied. **Open decision:** backfill from
   `shipment.harvest_date` when set, else `shipment.date` — this writes a harvest date
   onto rows where the operator left it blank, which is visible on Sheet R39. Needs the
   owner's confirmation before implementation.
2. **Sheet block chips will render a block twice.** Anything that renders one chip per
   `block_sources` row shows block A twice for a two-batch truck. Display sites must
   group by block and sum. `SheetBlockSourceInlineSerializer` and its consumers are the
   places to audit.
3. **`normalize_block_sources`** (`backend/apps/export/management/commands/`) almost
   certainly assumes one row per block. Must be reviewed, possibly rewritten.

Checked and **not** a risk: no `.get(shipment=, block=)` and no `update_or_create` on
that pair exists anywhere in `backend/apps/`. All reads go through `many=True`
serializers, which handle multiple rows unchanged.

## 6. Testing

- Per-block carry days: a 7-day block still carries on day 6; a 2-day block does not.
- Batch consumption: loading the 24.09 batch leaves the 21.09 batch untouched and still
  available tomorrow.
- Fallback: a pre-existing shipment with a null `harvest_date` produces the same board
  numbers as before the change.
- Over-load clamp and `week_totals` semantics are unchanged — the existing assertions
  must keep passing untouched.
- The migration backfill runs on a copy of live data without violating the constraint.
- Frontend: the day mode renders without a truck present (today's summary table does not);
  the collapse row counts correctly; the per-batch cap refuses over-allocation.

## Open question for the owner

Risk 1's backfill rule — writing `shipment.date` into a blank `harvest_date` — changes
data an operator deliberately left empty. Confirm before the migration is written.
