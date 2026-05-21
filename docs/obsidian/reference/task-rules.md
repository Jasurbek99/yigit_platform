# Task Rules Reference

The Self Board (`/me/board`) generates **tasks** automatically as a shipment moves through its lifecycle. Each task is created when the shipment **enters a status**, is owned by a **role**, and completes in one of two ways.

> Source of truth: `backend/apps/export/management/commands/seed_task_rules.py` (seeds the `TaskRule` rows). Live rules live in the `export_taskrule` table.

## Two kinds of completion

- **Auto** — the task is tied to one or more shipment **fields**. The moment the responsible person fills those field(s), the task auto-closes (no button). Implemented by `resolve_for_shipment()` in `apps/export/services/task_rules.py`, invoked from `Shipment.save()`.
- **Mark Done** (`manual_done`) — the task represents a **physical / process action** with no data field to watch (handing over papers, sending docs to customs, finalizing a sale). The responsible person confirms it with the **Mark Done** button in the drawer.

Completion rules: `all_fields_filled` (all listed fields set), `any_field_filled` (≥1 set), `field_equals` (a field equals a value), `manual_done` (button only).

## Who can act

The assigned role acts on its own tasks. **Supervisors** (`export_manager`, `boss`, `admin`, `director`) can act on **any** task — mirrors `IsTaskActor` in `apps/export/permissions.py`.

## Full task list

| Opens when shipment enters… | Task | Responsible role | Completes by |
|---|---|---|---|
| **Draft** | Set destination | export_manager | auto: `country` + `customer` + `import_firm` |
| | Pick export firms | document_team | auto: add a firm split |
| | Assign driver | transport | auto: `driver_name` — *only if not gapy-satys* |
| | Give documents | transport | **Mark Done** — *only if not gapy-satys* |
| | Give documents (gapy) | export_manager | **Mark Done** — *only if gapy-satys* |
| | Start documents prep | document_team | auto: `documents_status` = `in_progress` |
| **Customs entry (TM)** `gumruk_girish` | Send documents to customs | document_team | **Mark Done** |
| | Trigger customs exit | document_team | auto: `customs_exit_at` |
| **Customs exit (TM)** `gumruk_chykysh` | Documents back to office | document_team | **Mark Done** |
| | Trigger loading start | warehouse_chief | auto: `loading_started_at` |
| **Loading** `yuklenme` | Fill loading data | warehouse_chief | auto: `cargo_code` + `block_sources` + `variety` + `weight_net` + `weight_gross` |
| | Quality inspection | greenhouse_manager | auto: 4 quality checks |
| | Trigger departure | document_team | auto: `departed_at` |
| **Departed** `yola_chykdy` | Trigger border crossing | transport | auto: `border_crossed_at` |
| **Border crossed** `serhet_gechdi` | Trigger dest. entry | sales_rep | auto: `dest_entry_at` |
| **Dest. entry** `dest_entry` | Trigger dest. customs | sales_rep | auto: `customs_entry_at` |
| **Dest. customs** `barysh_gumrugi` | Trigger transshipment | sales_rep | auto: `peregruz_date` — *only if has transshipment* |
| | Trigger arrival (direct) | sales_rep | auto: `arrived_at` — *only if no transshipment* |
| **Transshipment** `transshipment` | Trigger arrival | sales_rep | auto: `arrived_at` |
| **Arrived** `bardy` | Confirm destination | sales_rep | auto: `city` |
| | Trigger sale start | sales_rep | auto: `sale_started_at` |
| **Selling** `satylyar` | Trigger sale end | sales_rep | auto: `sale_ended_at` |
| **Sold** `satyldy` | Finalize sale | sales_rep | **Mark Done** |
| | Trigger report received | sales_rep | auto: `sales_report_date` |
| **Report** `hasabat` | Submit sales report | sales_rep | **Mark Done** *(currently inactive)* |

## Maintenance note

Each `Task` row **snapshots** its watched fields from the rule at creation time. If you edit a `TaskRule`'s `target_fields` / `completion_rule`, existing open tasks keep the old values and won't auto-close. After changing rules run:

```
python manage.py reconcile_tasks --dry-run   # preview
python manage.py reconcile_tasks             # apply + re-resolve
```

`seed_task_rules` calls the reconcile automatically after upserting rules.
