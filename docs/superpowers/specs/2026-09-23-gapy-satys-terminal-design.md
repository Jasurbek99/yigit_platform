# Gapy-Satyş ends at greenhouse departure

**Date**: 2026-09-23
**Status**: Design approved, not implemented
**Module**: P3 Export — shipment lifecycle

## Problem

`Gapy Satyş` ("gate sale") is a **domestic** sale: the buyer takes the goods at the greenhouse.
No border is crossed, no destination customs is cleared, nothing arrives anywhere, and there is
no sales report from a foreign market.

The 13-step state machine has **zero** gapy branching. A gapy shipment is therefore walked
through `yola_chykdy` → `serhet_gechdi` → `dest_entry` → `barysh_gumrugi` → `bardy` →
`satylyar` → `satyldy` → `tamamlandy` exactly like a truck bound for Moscow.

In practice it cannot: the auto-advance trigger for `yola_chykdy` is `border_crossed_at` (R30),
which is `gapy_hidden=True` — the operator has no UI to fill it. A gapy shipment that reaches
`yola_chykdy` **jams there**. The only way past is a privileged role (`export_manager` /
`director` / `boss`) hand-clicking through three steps that describe events which never happened,
because `transition_to()` guards role and the draft join, not trigger fields.

This was never decided — it is an accident of the chain having no gapy branch.

## Decision

**A Gapy-Satyş shipment's lifecycle ends when the truck leaves the greenhouse.**

"Ýyladyşhanadan çykdy" is sheet row **R21 `departed_at`** (`sheet.row.greenhouse_departure`),
the trigger that today moves `yuklenme` → `yola_chykdy`.

For gapy, that same trigger moves `yuklenme` → **`tamamlandy`** (Completed), which is terminal.

### Why reuse `tamamlandy` rather than add a 14th status

Considered and rejected: a new terminal status `gapy_satyldy`.

- `is_gapy_satys` already marks these shipments. A dedicated status would carry no information
  the flag does not, while every kanban phase map, archive query, dashboard KPI, status filter
  and three i18n files would have to learn about it.
- `tamamlandy` is `phase='COMPLETE'`, so archiving (`archive_shipments`), board grouping and
  every "done" count keep working unchanged.
- The mechanism already exists: `TRANSITIONS` supports a predicate fork (`barysh_gumrugi`
  picks `transshipment` vs `bardy` on `has_peregruz`). This is the same shape.

**Accepted cost, stated rather than hidden**: `tamamlandy` is labelled "Tamamlandy / Report
received & Completed". A gapy shipment reaches it without a sales report, so for gapy rows the
"report received" half of that label is not true. The `is_gapy_satys` flag is what distinguishes
them. If this becomes confusing in operation, the label is the thing to change, not the status.

**Second accepted cost**: `_compute_status_avg_seconds` (serializers.py) averages
seconds-in-status across `tamamlandy` shipments. Gapy rows will now enter that population with
data for `draft` / `gumruk_girish` / `gumruk_chykysh` / `yuklenme` only. They contribute real
measurements for the steps they did pass through, so the averages stay honest; they simply
widen the sample. No change made here.

## Changes

### 1. State machine — `backend/apps/export/services/shipment.py`

`TRANSITIONS['yuklenme']` becomes a predicate fork:

```python
# Conditional fork: a Gapy-Satyş shipment is a domestic gate sale — it is
# complete the moment it leaves the greenhouse. There is no road, no border,
# no destination and no foreign sales report, so it goes straight to the
# terminal status instead of yola_chykdy.
'yuklenme': [
    ('tamamlandy',  ['document_team'], lambda s: bool(getattr(s, 'is_gapy_satys', False))),
    ('yola_chykdy', ['document_team'], lambda s: not bool(getattr(s, 'is_gapy_satys', False))),
    ('cancelled',   list(CANCEL_ROLES)),
],
```

**Edge order is load-bearing.** `_resolve_next_status()` returns the first edge whose predicate
is True *or which has no predicate at all* — so `cancelled` must stay last, exactly as in the
`barysh_gumrugi` fork, or every auto-advance from `yuklenme` would cancel the shipment.

The edge role stays `document_team` on both branches: the same person who closes loading closes
a gapy truck.

### 2. `allowed_transitions` becomes predicate-aware — `backend/apps/export/serializers.py:1507`

Today `get_allowed_transitions()` maps `_edge_to` over every edge and filters out only
`cancelled`. Predicates are ignored, so it already over-reports: a `barysh_gumrugi` shipment is
offered **both** `transshipment` and `bardy`, whichever `has_peregruz` says. Left alone, a gapy
shipment at `yuklenme` would likewise be offered `tamamlandy` **and** `yola_chykdy` — the exact
dead end this spec exists to remove.

Fix: skip an edge whose predicate is False for this shipment.

```python
return [
    _edge_to(edge)
    for edge in TRANSITIONS.get(current_code, [])
    if _edge_to(edge) != 'cancelled'
    and (_edge_predicate(edge) is None or _edge_predicate(edge)(obj))
]
```

This is a deliberate in-scope fix to code being changed, not unrelated refactoring — the
`has_peregruz` over-report is the same defect and cannot be left behind a green test.

`transition_to()`'s own validation (`allowed_codes`) is **not** made predicate-aware. Manual
transitions ignoring predicates is existing documented behaviour ("the user picks explicitly"),
and tightening it would silently change `has_peregruz` semantics for privileged roles. The UI no
longer offers the wrong branch, which is the operational fix.

### 3. Sheet rows hidden for gapy — `backend/apps/export/sheet_rows.py`

Six rows describe events after departure that a gapy shipment can never have. Add
`'gapy_hidden': True` to each:

| Row | Field | Why |
|-----|-------|-----|
| R33 | `has_peregruz` | No road, no transshipment |
| R34 | `peregruz_date` | ditto |
| R35 | `arrived_at` | Nothing to arrive at |
| R41 | `sale_started_at` | Sale happened at the gate, before departure |
| R42 | `sale_ended_at` | ditto |
| R43 | `sales_report_date` | No foreign sales report |

These join the four already hidden: R29 `border_point`, R30 `border_crossed_at`,
R31 `dest_entry_at`, R32 `customs_entry_at`.

`gapy_hidden` is **frontend-only**: `SheetCell.tsx` renders the cell blank and non-editable,
`SheetGrid.tsx` skips it in keyboard navigation. The backend does not reject writes to a hidden
field. That is the existing pattern and is not changed here.

**Deliberately NOT hidden**: R12 `city`. It is the destination-block field the draft join guard
and `import_shipments` already handle for gapy (gapy rows carry customer `ÝGT Gapy Satyş` and no
city), and it sits above departure in the identity block rather than after it.

**Safety check against the `set_border_point` lesson**: hiding a row is only safe when no
auto-resolving `TaskRule` targets it for gapy. None of the six do — every rule that reads them
sits on `yola_chykdy` or later, and a gapy shipment never enters those steps. So no gapy row can
acquire a permanently unresolvable gating task.

### 4. Task rules — no change

`backend/apps/export/management/commands/seed_task_rules.py` is untouched. Gapy clears the
existing `yuklenme` gate (`shipment_code`, `block_sources`, `variety`, `weight_net`, then
`departed_at`) and the rules on `yola_chykdy` → `satyldy` simply never instantiate for it, since
tasks are created per step on entry. `tasks.submit_sales_report` (on `yola_chykdy`) is one of
them — a gapy shipment gets no report task. Intended.

`tamamlandy` has no rules and no outgoing edge, so the auto-advance cascade stops there.

### 5. Data — no migration

Live database at the time of writing: **4** gapy shipments, all still in `draft`
(`Shipment.objects.filter(is_gapy_satys=True, deleted_at__isnull=True)`). Nothing is mid-chain,
so there is nothing to backfill or re-point. Re-check this count before implementing; if any
gapy shipment has moved past `yuklenme` by then, that is a new decision, not a silent fixup.

## Tests

Written first (TDD). New file `backend/apps/export/tests_gapy_terminal.py`:

1. **Gapy completes at departure** — gapy shipment in `yuklenme` with the loading fields filled;
   set `departed_at` → status is `tamamlandy`, in one save.
2. **Non-gapy is unchanged** — identical shipment with `is_gapy_satys=False` → `yola_chykdy`.
3. **One hop, not a cascade artefact** — exactly one `ShipmentStatusLog` row written
   (`is_auto=True`), `yuklenme` → `tamamlandy`, no intermediate rows. A plain model `save()` is
   enough to exercise this: `auto_advance_if_ready()` is called from `Shipment.save()`
   (`models/shipment.py:437`), not from the viewset.
4. **Terminal** — `allowed_transitions` on the completed gapy shipment is `[]`.
   `TRANSITIONS['tamamlandy']` is an explicit empty list (`services/shipment.py:109`): a
   completed shipment has no outgoing edge at all, **not even `cancelled`**.
5. **UI offers one branch** — gapy shipment in `yuklenme` → `allowed_transitions == ['tamamlandy']`;
   non-gapy → `['yola_chykdy']`.
6. **Regression on the fork fix** — `barysh_gumrugi` with `has_peregruz=True` →
   `['transshipment']`, with False → `['bardy']`. Checked: `tests_cancel.py` test 9 asserts only
   `isinstance(list)`, `'cancelled' not in`, and `len >= 1`, all of which a narrowed one-element
   list satisfies. **No edit to that test is needed** — if you find yourself editing it,
   something beyond this spec has changed.
7. **Manual transition still permissive** — a privileged role may still drive
   `barysh_gumrugi` → either branch via `/transition/`, pinning that `transition_to()` was not
   tightened.

Existing suites to re-run: `tests_auto_advance`, `tests_cancel`, `tests_draft_promote`,
`tests_task_api`. Report which pass by name — the suite has 71 known pre-existing failures in 4
buckets, so "all green" is not the bar; "no *new* failures" is.

## Docs to update

- `docs/obsidian/processes/shipment-lifecycle.md` — the step table (step 3 gains a fork), the
  mermaid chart, and a short "Gapy-Satyş ends early" note.
- `docs/obsidian/screens/shipment-sheet.md` — the six newly hidden rows.
- `docs/ADR.md` — **ADR-025** (the file uses `## ADR-NNN`; last entry is ADR-024) recording the
  decision and the rejected 14th-status option.
- `CHANGELOG.md` — `Changed` entry.
- `BUILD_TEST_LOG.md` — `- [ ] 2026-09-23 — Gapy-Satyş ends at greenhouse departure — NEEDS TEST`.

## Flipping the flag late — accepted, unguarded

R47 `is_gapy_satys` is an ordinary editable dropdown owned by `gadam`. Nothing stops someone
setting it to True on a shipment that is already past `yuklenme` — sitting in `dest_entry`, say.
That shipment does **not** retroactively complete; it keeps walking the export chain while six
of its cells go blank.

This is accepted as operator error with **no guard added**. A guard would mean either refusing
the edit after `yuklenme` (which blocks a legitimate correction of a row mistyped at draft) or
force-completing a truck that is demonstrably abroad (worse). The flag is a shipment-type
declaration and belongs at draft; the realistic fix if it happens is cancel and re-create.

Worth naming because it is downstream of *this* change, not pre-existing: before the fork, a
late flag flip was harmless, since gapy had no branch to diverge into.

## Out of scope

- Whether a gapy shipment should consume government quota. `docs/ADR.md` records this as an open
  question referred to the business; it is untouched here and gapy keeps consuming quota exactly
  as it does today.
- Where the gate sale's money is recorded. This spec removes the `sale_*` sheet rows from the
  gapy column; it does not add a replacement. If finance needs a figure for gate sales, that is
  a separate request.
- Renaming or re-labelling `tamamlandy`.

## Observation, not fixed here

`sheet_rows.py` uses `row_number: 47` twice — once for `firm_contracts` and once for
`is_gapy_satys`. Pre-existing, unrelated to this change, flagged so it is not mistaken for
something this work introduced.
