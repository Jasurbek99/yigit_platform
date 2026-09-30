---
title: Gaplama — stored, editable leftover (Düýnki galyndy)
date: 2026-09-30
status: design approved in chat, spec awaiting review
related: [[../../obsidian/screens/gaplama]], 2026-09-18-tir-takip-gaplama-design.md, 2026-09-24-gaplama-batch-selection-design.md
---

# Gaplama — stored, editable leftover

## 1. Problem

Gaplama's leftover (carry-in) is **calculated, never stored** (D2 of the 2026-09-18 design).
Two things go wrong with that in practice:

1. The real stock differs from the calculation — crates recounted in the hall, goods spoiled.
   Nobody can correct the number; there is no field for it.
2. The number moves after the fact. Any later edit or weighing of a past day's truck silently
   rewrites every carry-in after it.

The daily harvest board (`/export/harvest-board`) has a hand-typed «Düýnki galyndy» field
(`HarvestDayEntry.yesterday_rest_value`), but Gaplama never reads it and nothing fills it.

## 2. Decisions (owner, 2026-09-30)

| # | Decision |
|---|---|
| S1 | When a day ends, each block's leftover is **stored in the DB as one number**, and that number becomes the next day's starting leftover in Gaplama. |
| S2 | Reason to edit: **both** — recounts/spoilage, and stopping the number from moving after the fact. |
| S3 | The day closes **automatically at midnight** (Celery beat). Nobody presses anything. |
| S4 | A stored number changes **only by hand**. No automatic recompute — not after weighing, not after an earlier day is corrected. |
| S5 | Editable in **both** places: harvest-board «Düýnki galyndy» and Gaplama. One DB field. |
| S6 | **No reason** required on an edit. The existing audit entry (who, when, old → new) is enough. |
| S7 | The 49 existing `yesterday_rest_value` values (2026-06-01 … 2026-08-21, test data) are **cleared** once. |

S1 supersedes D2 of the 2026-09-18 design for the carry-in only; plan, loaded and over stay
calculated.

## 3. The stored value

**Field:** `HarvestDayEntry.yesterday_rest_value` — no new column, no schema migration.

**Meaning, exactly:** the value on day *d*'s row is **day d's starting leftover after expiry** —
the same figure Gaplama already shows as `carried_in_kg` for day *d*. In plain words: what was
left when day *d−1* closed, minus anything older than the block's `carry_days`. This is the
number a person counting crates in the morning would write down, and it is the cell the user
edits in Gaplama (§6), so what they type is what they see.

(The chat wording «end of D stored on the D+1 row» describes the same thing; storing it
*after* expiry is what keeps an auto snapshot from ever reading as an increase — see §4.)

**Readers today:** only the harvest-board (backend `views_daily_board.py` / `services/daily_board.py`,
frontend `DailyHarvestBoard.tsx`, `useDailyBoard.ts`). No report, dashboard or sera copy reads it
(grep, 2026-09-30).

## 4. Board calculation change (`build_gaplama_board`)

The existing HarvestDayEntry read (`plan_rows`) also returns `yesterday_rest_value` per
(block, date) — one entry per block/date per season, so no extra query.

In the per-block walk, for each day *d*, **after** the expiry `popleft()` loop and **before** the
`carried_in_kg` / `carry_in_breakdown` snapshot:

```
S = Σ buckets                      # calculated carry-in (after expiry)
R = stored yesterday_rest_value for (block, d), or None
if R is not None and R != S:
    if R < S: drain (S − R) from the OLDEST buckets first; drop emptied buckets
    if R > S: append bucket [R − S, d − 1]     # newest, so deque order holds
carried_in_kg = R if R is not None else S
```

Rules:

- **Decrease → oldest first.** Spoilage and miscounts are attributed to the oldest goods, the
  same order the FIFO drains in.
- **Increase → new bucket dated d−1.** Found crates have no known age; they are treated as
  yesterday's and expire on that block's normal `carry_days` from there.
- Expiry runs *before* the reconcile, and the stored value is post-expiry (§3), so an untouched
  auto snapshot always equals S and the reconcile is a no-op. It can never resurrect expired kg.
- Everything after the reconcile (today's bucket, named-batch drain, FIFO drain, `over_kg`,
  `carried_out_kg`, `week_totals`) is unchanged.

**New fields on each `days[]` row:**

| field | value |
|---|---|
| `rest_stored_kg` | R as a decimal string, or `null` when nothing is stored |
| `rest_calc_kg` | S as a decimal string — what the carry-in would be without the stored value |

The frontend shows «hasap: X» when `rest_stored_kg` is not null and differs from `rest_calc_kg`.
Under S4 that hint is the **only** signal that a later change (weighing, a corrected earlier day)
has left a stored number stale.

## 5. Midnight job

**Task:** `apps.export.tasks.snapshot_gaplama_leftovers` (export may import greenhouse —
`core ← greenhouse ← export`). **Beat:** `crontab(hour=0, minute=5)`, `expires=3600`, in
`CELERY_BEAT_SCHEDULE` (`CELERY_TIMEZONE = Asia/Ashgabat`). Not crontab on the host.

At run time *T* (today), with the active season (none → log and return):

```
for d in [T−3, T−2, T−1, T] (oldest first):
    board = build_gaplama_board(d, d, season)
    for row in board['days']:
        entry = get-or-create HarvestDayEntry(block=row.block_id, entry_date=d)
        if entry.yesterday_rest_value is None:
            entry.yesterday_rest_value = row.carried_in_kg
            entry.save(update_fields=['yesterday_rest_value'])
```

- **Same calculation as the screen.** It calls `build_gaplama_board`, not a second formula.
- **Only empty fields are written.** A hand-typed value is never overwritten, and a rerun or a
  duplicate beat is harmless (idempotent).
- **Catch-up of 3 days.** Covers missed nights (celery down, not yet rebuilt after a deploy).
  Oldest first, because each day's carry-in depends on the days before it.
- **No person stamped.** The job writes the field directly — not through `upsert_daily_board`,
  which needs a user, sets `daily_entered_by/at` (the harvest-board would then show a person as
  author) and writes an audit entry. So on the harvest-board an auto value has an empty author;
  a hand-typed one has a name.
- **Row creation** reuses the existing public `get_or_create_day_entry(block_id, entry_date)`
  (`apps/greenhouse/services/legacy.py`, exported from `apps.greenhouse.services`) — the
  "system-created container" path, `entered_by=NULL`, active season only. For the current week the rows normally already exist:
  `weekly-plan-setup` (06:00) initialises the current and next week. Writes 0 as well as
  positive values — a 0 is a frozen value too (S4).

## 6. Editing

### Harvest-board — no code change

«Düýnki galyndy» is already editable (`POST /api/v1/greenhouse/daily-plan/`,
`{block, date, yesterday_rest}`), audited, and gated by `page_write_permission('export.harvest_board')`.
It now shows the nightly values too. Clearing the cell (null) returns that day to the calculated
value.

### Gaplama — day view (`Gün`) only

- The `carried_in_kg` cell becomes editable (click → kg input, commit on Enter/blur).
- **Allowed when:** `canSeePage(user, 'export.harvest_board')` (the same gate as the harvest-board,
  so the same people edit in both places; a `greenhouse_manager` only on their own
  `managed_block_ids`, exactly as the harvest-board and its backend enforce), the season is not read-only, and the viewed day
  is **today or earlier**. Future days are read-only in Gaplama. (The harvest-board still allows
  future dates, as today — such a value becomes that date's stored number.)
- **Save** uses the existing `useUpsertDailyBoard` (`frontend/src/hooks/useDailyBoard.ts`) —
  no new endpoint. Its `onSuccess` also invalidates `['gaplama-board']`, so an edit on either
  screen refreshes Gaplama.
- A block folded into the «folded blocks» row (nothing available, nothing over) still gets the
  editable carry-in cell when expanded — found crates on an empty block must be enterable.
- Clearing the input sends `yesterday_rest: null` → back to calculated.
- The «hasap: X» hint (§4) shows under the cell when stored ≠ calculated.
- **Week view (`Hepde`) stays read-only.**

### Permissions dependency (not in scope)

On the shared DB, `tir_takip.gaplama` is visible only to `quality_inspector`, who lacks
`export.plan`, so today only superusers can open Gaplama at all. The Gaplama edit reaches real
users only once `tir_takip.gaplama` is restored for the right roles — a separate fix.

## 7. Data cleanup (S7)

One-off, on the shared dev/beta DB, run once after the owner's go-ahead (given 2026-09-30):

```python
HarvestDayEntry.objects.filter(
    yesterday_rest_value__isnull=False, entry_date__lte=date(2026, 8, 21),
).update(yesterday_rest_value=None)   # expected: 49 rows
```

Not a migration. A migration would also run against any future separate production DB, where
such rows could be real. Recount before running; stop if the count is not 49.

## 8. Consequences to know

1. **Weighing after midnight stays out.** If trucks are weighed after the day closed, the stored
   number is the pre-weighing one and stays so until someone edits it (S4). The «hasap: X» hint
   shows the gap.
2. **No cascade.** Correcting Monday does not fix Tuesday's stored number. Tuesday shows the hint
   and is corrected by hand.
3. **Beta shares the DB and runs old code.** Beta's harvest-board will show the nightly values,
   and anything typed there on beta becomes the stored leftover for the new code too.
4. **Clearing a recent value refills it.** A value cleared for a date inside the 3-day catch-up
   window is re-snapshotted (calculated) at the next midnight run — effectively «reset to calc,
   then freeze».
5. The board's lookback window (2 × max `carry_days`) is unchanged; stored values inside it simply
   anchor the walk.

## 9. Out of scope

- Reason codes for edits (S6), a separate spoilage report.
- Automatic recompute or cascade of stored values (S4).
- A `source` (auto/manual) column — the harvest-board author field and the «hasap» hint cover it.
- Editing in the week view.
- Restoring `tir_takip.gaplama` permissions.

## 10. Tests

Backend (`backend/apps/export/tests_gaplama_stored_leftover.py` for the board, 1–5;
`backend/apps/export/tests_gaplama_snapshot.py` for the job, 6–9):

1. Stored R < calculated S → carry-in = R, drained from the oldest bucket first.
2. Stored R > S → carry-in = R, the extra is a bucket dated d−1 that expires on `carry_days`.
3. **Expiry with auto snapshots:** `carry_days=2`, Monday leftover L, no loads, snapshots on
   Tue/Wed/Thu → Tue = L, Wed = L, Thu = 0 (nothing resurrected).
4. No stored value → numbers identical to today's board (regression).
5. `rest_stored_kg` / `rest_calc_kg` present and correct; hint condition holds.
6. Job writes only empty fields; a hand-typed value survives; running twice changes nothing.
7. Job catch-up: missing T−2 and T−1 get filled, oldest first.
8. Job does not set `daily_entered_by/at` and writes no audit entry.
9. Job with no active season → no writes, no error.

Frontend:

- `GaplamaTab.test.tsx`: carry-in cell editable for today/past with `export.harvest_board`,
  read-only for future days, without the page, in a read-only season, and in `Hepde`;
  save calls the daily-plan POST; the hint renders only when stored ≠ calculated.
- `useGaplama` coercion of the two new decimal fields.

## 11. Files

| Area | Path |
|---|---|
| Board calc | `backend/apps/export/services/gaplama.py` |
| Job | `backend/apps/export/tasks.py`, `backend/config/settings.py` (`CELERY_BEAT_SCHEDULE`) |
| Job logic | `backend/apps/export/services/gaplama_snapshot.py` (new) — uses `apps.greenhouse.services.get_or_create_day_entry` |
| Types / hook | `frontend/src/types/index.ts` (`IGaplamaDay`), `frontend/src/hooks/useGaplama.ts` |
| UI | `frontend/src/pages/sera/GaplamaTab.tsx`, `sera.css` |
| i18n | `frontend/src/i18n/{tk,ru,en}.json` — `tir_takip.gaplama.rest_calc_hint` |
| Docs | `docs/obsidian/screens/gaplama.md`, harvest-board doc, `CHANGELOG.md`, `BUILD_TEST_LOG.md` |

## 12. Deploy

1. Deploy code; rebuild `celery-worker` and `celery-beat` (new beat entry).
2. Run the §7 cleanup once (count first).
3. The first midnight run fills T−3…T; check the harvest-board next morning shows values with an
   empty author.
