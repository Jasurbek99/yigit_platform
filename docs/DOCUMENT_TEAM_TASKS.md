# Document team (Şirin / Sulgun) — tasks & triggers

Re-checked against the code on **2026-10-01**. The first version of this file
(2026-09-22) is obsolete — the PREP/DOCS task chain landed in between. What
changed is in §4.

Sources: `backend/apps/export/management/commands/seed_task_rules.py`,
`backend/apps/export/models/task.py`, `backend/apps/export/services/task_chain.py`,
`backend/apps/export/sheet_rows.py`, `backend/apps/core/views_me.py`.

Catalog totals: **48 rules, of which 21 belong to document_team** (16 active,
5 retired). Next largest owner: sales_rep with 13.

## 1. Active document_team tasks — `draft`

| Task (`title_key`) | After (`depends_on`) | Closes on | Deadline |
|---|---|---|---|
| `tasks.pick_export_firms` | `tasks.set_destination` | `firm_splits` filled (ANY) | 24h after status |
| `tasks.assign_driver` | `tasks.set_destination` | `driver_name` + `driver_phone` + `truck_plate` (ALL) | — |

`assign_driver` is conditional: `is_gapy_satys=True` only. For a normal export
truck the same task belongs to `transport`.

## 2. Active document_team tasks — `gumruk_girish` (the document chain)

All 13 are `CONFIRM`: a button on the task card, and each one **holds the step**
(`gates_step=True`). They open in dependency order, not all at once:

```
pick_export_firms ─┬─> prepare_contract ──────────────┐
                   └─> fill_gross_net ────────────────┤
choose_truck + assign_driver ─> prepare_transport_docs ┴─> print_cmr ─┬─> print_ct1 ─> print_phyto ─┐
                                                                     │                             ├─> ct1_phyto_sent ─┐
                                                                     └─> print_customs_request ────────────────────────┴─> docs_to_stamp
                                                                                                                              │
          give_advance (finansist) ─┐                                                                                         v
                                    ├─> docs_to_customs                             prepare_declaration <─ docs_from_stamp <───┘
          prepare_declaration ──────┘
```

| # | Task | After | Note |
|---|---|---|---|
| 1 | `tasks.prepare_contract` | `pick_export_firms` | closes when the agreements are downloaded |
| 2 | `tasks.fill_gross_net` | `pick_export_firms` | closes on `packing_template` (ALL_FIELDS_FILLED, not a button) |
| 3 | `tasks.prepare_transport_docs` | `choose_truck`, `assign_driver` | |
| 4 | `tasks.print_cmr` | 1, 2, 3 | closes on download |
| 5 | `tasks.print_tir` | 3 | closes on download |
| 6 | `tasks.print_ct1` | 4 | closes on download |
| 7 | `tasks.print_phyto` | 6 | closes on download |
| 8 | `tasks.ct1_phyto_sent` | 6, 7 | |
| 9 | `tasks.print_customs_request` | 4 | closes on download |
| 10 | `tasks.docs_to_stamp` | 8, 9 | |
| 11 | `tasks.docs_from_stamp` | 10 | |
| 12 | `tasks.prepare_declaration` | 11 | |
| 13 | `tasks.docs_to_customs` | `give_advance` (finansist), 12 | effect: clears `documents_reset_at` |

## 3. Active document_team task — `gumruk_chykysh`

| Task | Closes on | Effect |
|---|---|---|
| `tasks.docs_from_customs` | `customs_exit_at` filled | writes `documents_status` (audited) |

## 4. What changed since the 2026-09-22 version of this file

- **6 rules → 21.** The whole `gumruk_girish` document chain (§2) is new.
- **New machinery that did not exist then:** `TaskRule.depends_on` (CSV of
  `title_key`s — "after N"), `gates_step`, `effective_from`, the `CONFIRM` and
  `FIELD_SET` completion rules, and `services/task_chain.py`
  (`spawn_ready_tasks` / `after_task_done` / per-task effects).
- **§3 of the old file is mostly answered.** Contract generation, CMR, TIR, CT-1,
  phyto, customs request, declaration and the stamping round-trip all reach the
  board now. They are shipment tasks with `CONFIRM` — no new `TaskKind` was
  needed. (`TaskKind` did grow by 5: `alloc_review`, `transport_plan`,
  `daily_loading`, `daily_export`, `gate` — none of them document_team's.)
- **The `trigger_departure` question is settled:** that task is now `garawul`
  (gate guard), not document_team.
- **5 rules were retired** (`is_active=False`, kept as rows so old shipments
  keep their history): `give_documents_gapy`, `start_documents_prep`,
  `trigger_customs_exit`, `send_documents_to_customs`, `docs_back_to_office`.
  The work they stood for is now done by the §2 chain.
- **Board scoping** (`views_me.py`): document_team is still carved out of
  `_SUPERVISOR_ROLES`, so /me shows only their own queue. Unchanged, still correct.

## 5. Still open

1. **Şirin vs Sulgun share one queue.** `TaskRule` has `assignee_role` only —
   no `assignee_user`. `Task.assignee_user` exists but is used by weekly-plan
   tasks, never by the shipment engine. Both see all 21. Splitting them is a
   model change (a second role code, or per-rule user assignment). **Decision
   needed.**
2. **Three owned fields still have no task** (unchanged since 09-22):
   `customs_clearance_planned_day` (R45), `transport_docs_given_at` (R4),
   `document_note` (R18). R45 is the one worth adding — the v1 rule required it
   and the v2 rewrite dropped it. Add it as MANUAL_DONE or `gates_step=False`:
   a plain gating rule at `draft` would freeze trucks until the day is picked.
3. **Quota usage approval** (`services_quota.py` — records stay draft until
   document_team approves) and **passport / scan uploads** still have no task of
   any kind. These are the only §3 items from the old file that remain unbuilt.
4. **Deploy note:** none of §2 exists on a server until `seed_task_rules` runs
   there.
