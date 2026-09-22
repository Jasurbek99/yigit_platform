# Document team (Şirin / Sulgun) — tasks & triggers

Status: inventory + proposals. Nothing below is implemented by this document.
Sources: `backend/apps/export/management/commands/seed_task_rules.py`,
`backend/apps/export/sheet_rows.py`, `backend/apps/core/views_me.py`,
`backend/apps/export/models/task.py`.

## 0. Board scoping — already fixed

`views_me.py:31` carves `document_team` out of `_SUPERVISOR_ROLES`, so
`/api/v1/me/tasks/` returns only document_team's own queue, not every role's.
That closes the "My tasks shows all tasks" report. No action needed.

Open limit: `TaskRule` has `assignee_role` only — there is **no per-user
assignment for shipment tasks**. Şirin and Sulgun are separated on the Sheet by
`who_key`, but on /me they both see the entire document_team queue. Splitting
them = model change (`TaskRule.assignee_user` or a second role code). **Decision
needed.**

## 1. What already generates today (6 rules)

| # | Step (status) | Task (`title_key`) | Trigger field(s) | Completion rule | Deadline | Condition | Gates auto-advance? |
|---|---|---|---|---|---|---|---|
| 1 | `draft` | `tasks.pick_export_firms` | `firm_splits` | ANY_FIELD_FILLED | 24h after status | — | Yes |
| 2 | `draft` | `tasks.assign_driver` | `driver_name`, `driver_phone`, `truck_plate` | ALL_FIELDS_FILLED | 24h after status | `is_gapy_satys=True` | Yes (gapy only) |
| 3 | `draft` | `tasks.give_documents_gapy` | — | MANUAL_DONE | Friday EOW | `is_gapy_satys=True` | No |
| 4 | `draft` | `tasks.start_documents_prep` | `documents_status` | FIELD_EQUALS `ready` | 24h after status | — | Yes |
| 5 | `gumruk_girish` | `tasks.trigger_customs_exit` | `customs_exit_at` | ALL_FIELDS_FILLED | 13:00 same day | — | Yes |
| 6 | `yuklenme` | `tasks.trigger_departure` | `departed_at` | ALL_FIELDS_FILLED | 24h after status | — | Yes |

Rules 4, 5, 6 are the lifecycle triggers: they move the truck
`draft → gumruk_girish → gumruk_chykysh` and `yuklenme → yola_chykdy`.

**Question on #6:** `departed_at` is Sheet row 21, whose owner is Mergen →
`transport` per `WHO_TO_ROLE` in `backfill_sheet_row_defaults.py`. The task rule
says `document_team`. Rule and row owner disagree — which is correct?

## 2. Fields document_team owns with NO task rule

These are Sheet rows whose `default_who_key` is `sirin` / `sulgun` but which
never produce a Task. Each proposal is one row added to `TASK_RULES` in
`seed_task_rules.py` + one i18n key — no new machinery.

| Field (Sheet row) | Proposed step | Proposed completion rule | Gating? | Note |
|---|---|---|---|---|
| `customs_clearance_planned_day` (R45) | `draft` | MANUAL_DONE reminder | No | **Regression.** The v1 rule required this field; the v2 rewrite of `start_documents_prep` dropped it (see the comment in `seed_task_rules.py`). Re-adding it as ALL_FIELDS_FILLED would restore the gate and freeze drafts — keep it MANUAL_DONE. |
| `transport_docs_given_at` (R4) | `draft` | MANUAL_DONE reminder | No | "Transport handed over the docs at <time>". As ALL_FIELDS_FILLED it becomes a new precondition for leaving `draft`. |
| `document_note` (R18) | — | — | — | Freeform note. No task; nothing to complete. |

**Gating rule (why the column above matters):** every non-MANUAL_DONE task on a
step is a precondition for `auto_advance_if_ready`. Add an auto-resolving rule
and the truck cannot leave that step until the field is filled. The seed file
records this failure twice (`submit_sales_report`, the v1→v2
`start_documents_prep` rewrite). Default every new *reminder* to MANUAL_DONE.
For any FIELD_EQUALS rule, point `target_value` at the **terminal** enum value —
operators walk `pending → in_progress → ready` and a mid-value target can never
re-fire.

## 3. Work that cannot reach the board at all today

`TaskKind` = `shipment | weekly_plan | local_sell_plan | truck_allocation`, and
the shipment rule engine fires only on status entry. The following document-team
work has **no path onto /me** and needs new machinery (a new `TaskKind` + a
generator service + a resolver, in the pattern of
`services/truck_allocation_tasks.py`):

| Work | Where it lives now | What it would need |
|---|---|---|
| Contract generation (per firm split) | `contracts/services/shipment_firm_contracts.py` | New `TaskKind`, generator keyed on contract-missing firm splits |
| Invoice / CMR / TIR carnet / packing list render | `contracts/services/document_render.py` | Same; "documents rendered" has no stored state to resolve against |
| Quota usage approval (draft → approved) | `export/services_quota.py:687` | New `TaskKind`, resolver on `QuotaUsageRecord.status` |
| Passport / scan uploads | `contracts/models/attachment.py` | Attachment-exists resolver |

Estimated effort: rows in §2 ≈ a seed edit + `seed_task_rules` re-run.
Each row in §3 ≈ a vertical slice (model choice, service, resolver, tests).

## Open decisions

1. Per-person boards (Şirin vs Sulgun) — accept the shared queue, or change the model?
2. `trigger_departure` owner — `document_team` or `transport`?
3. Which §3 items are actually wanted, and in what order?
