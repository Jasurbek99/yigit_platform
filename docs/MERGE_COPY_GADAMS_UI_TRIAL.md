# Trial merge: `Copy_Gadams_UI` → `main`

**Date:** 2026-09-22 · **Branch:** `merge/gadams-trial` (worktree `D:/projects/yigit_merge_trial`)
**Status:** resolved, verified, **NOT merged into `main`, NOT committed, NOT pushed.**

Scope: 28 commits, 70 files, +7298 lines. `main` was 15 commits ahead.

## Verdict

Mergeable. Zero merge-introduced test failures after the fixes below.

| Suite | clean `main` | merged |
|---|---|---|
| Backend (`greenhouse`+`export`+`core`) | 2026 tests — 13 failures, 4 errors | 2059 tests — **13 failures, 4 errors** (identical set) |
| Backend (`contracts`+`finance`+`transport`) | 494 tests — 1 error | 494 tests — **1 error** (same one) |
| Frontend (vitest) | 805 tests — 2 failed | 887 tests — **2 failed** (same 2) |
| `tsc --noEmit` | clean | **clean** |

The backend 13+4 are the pre-existing reds. The 2 frontend failures are
`SupplyDraftModal` timeouts that reproduce on clean `main` and pass in isolation
on both — load-induced flakes, not regressions.

## The 7 conflicts

| File | Resolution |
|---|---|
| `backend/config/settings.py` | **Union.** Both beat entries kept — `saturday-plan-summary` (Sat 09:00, from main) and `weekly-plan-setup` (daily 06:00, from Copy). Disjoint; neither dropped. |
| `backend/apps/export/tasks.py` | **Union** (add/add). Both branches created this file independently; both tasks kept. |
| `backend/apps/greenhouse/views.py` | Docstring union. The *code* auto-merged — see the real bug below. |
| `frontend/.../WeeklyPlanGrid.tsx` | Both intents merged: Copy's create-on-write payload branching + `${block}-${date}` saving key, with main's 202 / withdraw / range-error toasts. |
| `CHANGELOG.md`, `api-contract/SKILL.md`, `cron.md`, `weekly-harvest-planning.md` | Unions — purely additive on both sides. |

## Two real bugs the merge created (both auto-merged clean — no conflict marker)

**1. `write_cell` silently bypassed the ADR-024 approval gate.**
Copy's `write_cell` discarded `set_plan_value`'s return and ended with
`entry.refresh_from_db()`. Main's serializer reads `getattr(obj, 'pending_changes', None)`,
a `to_attr` prefetch. Merged as-is, a manager's in-week plan edit through the grid
returned **200 with `pending_change: null`** — no crash, no 202, approval workflow
skipped. `write_cell`'s own docstring promised "behaves identically to a PATCH".

Fixed: mirrors `partial_update` — captures `pending_change`, returns 202, re-fetches
through the prefetch-carrying queryset. Uses `self.queryset.all()` rather than
`get_queryset()`, which would also apply the `?block=`/`?date_from=` list filters
to the POST and drop the row just written.

**2. `HarvestCell` / `WeeklyPlanGrid` — the frontend mirror.**
Copy made `cellKey` a required prop; main's `HarvestCell.planChange.test.tsx` doesn't
pass it. 8 `tsc` errors. Fixed by supplying `cellKey` in the test's shared props.
Also corrected `cellKey`'s docstring, which claimed real entries key on
`String(entry.id)` — the grid passes `${block}-${date}` for every cell.

## Migrations

Both branches added a `core/0052` on top of `0051` → two leaf nodes, `migrate` refuses.
Created `core/0053_merge_tir_takip_perms_and_plan_change_cap` (graph-only, no schema ops).

**Both `0052`s are already applied on the live DB**, so `0053` is a no-op there.
**It has not been applied** — pending your decision on the merge.

## Decisions you may want to veto

**A. In-week create-on-write now needs approval.** Four of Copy's `write_cell` tests
asserted a manager's plan write lands directly at 200. Under ADR-024 a write into an
already-started week becomes a `PlanChangeRequest` (202) — including on a cell that did
not exist yet. This matches what `main`'s PATCH already does for an existing blank cell,
so the merged behaviour is consistent rather than new.

I retargeted those four tests at a *not-yet-started* week, which is where create-on-write
was actually meant to be exercised, and added
`test_in_week_create_routes_to_plan_change_request` to pin the in-week rule.

*Consequence:* on the Tır Takip Önümçilik grid, a manager filling a blank **current-week**
cell gets "sent for approval" rather than an immediate value. If that is not what you
want, the alternative is exempting first-fill (`plan_value is None`) from the approval
gate in `set_plan_value` — a change to `main`'s ADR-024 behaviour, not just to the merge.

**B. I changed a guard test.** `test_no_direct_is_active_lookups_outside_core_seasons`
flagged `greenhouse/services/legacy.py`. Its regex is `DOTALL` with `.*?`, so an innocent
date-range `Season.objects.filter(start_date__lte=…)` at line 124 matched forward across
statements to an unrelated `GreenhouseBlock…is_active=True` at line 136. The code does not
violate the rule. I bounded the pattern to the `filter()` call's own arguments
(`.*?` → `[^)]*?`); real violations still caught (verified both single- and multi-line forms).
Remaining hole: a violation written `filter(pk=f(), is_active=True)` would slip through.
I did **not** add the file to `ALLOWED`, which would have blinded the guard permanently.

## Docs updated with the merge

`write-cell` now shares PATCH's 202, so both docs that describe it say so:
`docs/obsidian/processes/weekly-harvest-planning.md` (the write-cell table row) and
`.claude/skills/api-contract/SKILL.md` (the ADR-024 section, which named only PATCH).
CHANGELOG and BUILD_TEST_LOG carry the reconciliation entry.

## Also verified

- `PAGE_REGISTRY` contains the 11 `tir_takip*` codes post-merge; with main's `1a0ec82c`
  (delete only registered codes) the `/admin/permissions` Save-wipe hazard is covered.
- `PRIVILEGED_ROLES` identical on merge-base, `main`, `Copy_Gadams_UI` and the merge —
  the `TestWritePathParity` reds are pre-existing and unrelated to the new write path.
- `apps.contracts` was checked specifically: Copy rewrote `ContractAttachmentPermissionTest`
  and the merge touches `permission_registry.py`, `seed_permissions.py`, `core/serializers.py`,
  `core/views.py` and `export/permissions.py`, all upstream of it. Same result both sides.
- The trial worktree has nothing untracked but the merge migration — `.env` and the
  `node_modules` junction are gitignored.

## Code review (two-axis, run 2026-09-22 after the fixes above)

### Standards — 4 hard findings, all pre-existing in `Copy_Gadams_UI`, none in the resolution
1. `pages/sera/` imports from `pages/export/` (4 sites) — breaks the frontend dependency direction.
2. `OnumcilikTab.tsx` is 941 lines in one function; limit is 150. `HarvestCell` (750) and
   `WeeklyPlanGrid` (954) were already over and grew.
3. `write_cell` is ~80 lines (limit 20) with parsing, dispatch and rollback policy in the view —
   `backend/CLAUDE.md` says business logic never lives in views.
4. **Duplicated code:** `write_cell`'s tail is a verbatim copy of `partial_update`, including the
   three `try/except (ValueError, PermissionError)` blocks. This is the exact drift that produced
   the 200-vs-202 bug. Extracting the shared dispatch into `greenhouse/services/` is the durable fix.

Clean: MSSQL rules, dependency direction (backend), no signals, migration `0053`.

### Spec — 1 blocking (fixed), 1 partial (open)

**Blocking, now fixed: the Önümçilik grid reported an unsaved plan as saved.**
`OnumcilikTab` is a *second* grid with its own `handleCellSave`; the earlier fix only covered
`WeeklyPlanGrid`. It fired `plan.toast_plan_saved` unconditionally and never read
`saved.pending_change` — nothing under `pages/sera/` referenced that field at all. In-week, a
manager saw "Plan saved" while the cell stayed empty and the request was invisible.
`onSuccess` now distinguishes sent-for-approval / withdrawn / saved.

**Open:** `OnumcilikCell` still renders no pending badge (`→ 11,500 (+15%) ⏳`), which the ADR-024
spec asks for. The toast is now honest; the visual indicator on that grid is not built.

### Two further corrections from the review
- The guard regex hole was wider than first stated: `[^)]*?` is blinded by **any** `)` in an earlier
  argument, and `Season.objects.filter(Q(...), is_active=True)` is far more reachable in Django than
  a function call. Rewritten to allow one level of nesting; 5 cases verified.
- Added the missing `plan_baseline_value` / `change_pct` NULL assertions to
  `test_in_week_create_routes_to_plan_change_request` (ADR-024 rule 3).

Final backend run after all review fixes: 2059 tests, 13 failures + 4 errors — **identical set to
clean `main`**. Frontend typecheck clean; sera + HarvestCell suites 82/82.

## To land it

```bash
# 1. commit or stash the 41 dirty files in the main tree (4 overlap the merge:
#    api-contract/SKILL.md, BUILD_TEST_LOG.md, CHANGELOG.md, api-endpoint-map.md)
cd D:/projects/yigit_merge_trial && git commit          # finish the merge on the trial branch
cd D:/projects/yigit_platform  && git merge merge/gadams-trial
cd backend && python manage.py migrate core             # applies 0053 (no-op)
```

Cleanup if you drop it:
```bash
git worktree remove D:/projects/yigit_merge_trial --force
git worktree remove D:/projects/yigit_merge_base  --force
git branch -D merge/gadams-trial
```
