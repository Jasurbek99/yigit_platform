# Task Rules Reference

The Self Board (`/me/board`) generates **tasks** automatically as a shipment moves through its lifecycle. Each task is created when the shipment **enters a status**, is owned by a **role**, and completes in one of two ways.

> Source of truth: `backend/apps/export/management/commands/seed_task_rules.py` (seeds the `TaskRule` rows). Live rules live in the `export_taskrule` table.
>
> The same catalog is readable **in the app** at `/export/task-rules` ([[../screens/task-rules]]),
> rendered straight from those rows. For the system behind it — the four task kinds, the
> deadline grammar, the lifecycle — see [[task]].

## Two kinds of completion

- **Auto** — the task is tied to one or more shipment **fields**. The moment the responsible person fills those field(s), the task auto-closes (no button). Implemented by `resolve_for_shipment()` in `apps/export/services/task_rules.py`, invoked from `Shipment.save()`.
- **Mark Done** (`manual_done`) — the task represents a **physical / process action** with no data field to watch (handing over papers, sending docs to customs, finalizing a sale). The responsible person confirms it with the **Mark Done** button in the drawer.

Completion rules: `all_fields_filled` (all listed fields set), `any_field_filled` (≥1 set), `field_equals` (a field equals a value), `manual_done` (button only).

## Who can act

The assigned role acts on its own tasks. **Supervisors** (`export_manager`, `boss`, `admin`, `director`) can act on **any** task — mirrors `IsTaskActor` in `apps/export/permissions.py`.

### Role equivalence (deputies)

`Task.assignee_role` holds **one** role, but some roles are operationally the same team.
`task_roles_for(role)` in `apps/core/roles.py` is the **single source of truth**: it expands
a role to the set whose tasks it may see and act on. Roles with no declared equivalent map
to themselves, so it is safe to call unconditionally.

Current map (`TASK_ROLE_EQUIVALENTS`) — deliberately narrow:

| Role | Also sees/acts on |
|---|---|
| `loading_dept_head` | `loading_dept_head_deputy` |
| `loading_dept_head_deputy` | `loading_dept_head` |

Rationale: a deputy acts with identical authority to their head (stakeholder decision,
June 2026), so a task assigned to `loading_dept_head` (Soltanmyrat) is also the work of his
5 deputies.

**Three call sites must always use this helper** or visibility and permission drift apart —
a user would see a card they cannot touch:
1. `MeTaskListView` — visibility (`assignee_role__in=`)
2. `IsTaskActor` — actions (start/block/complete)
3. `MeKpiTodayView._compute_kpi` — the "Done today" tiles

The frontend mirrors it in `constants/roles.ts` (`taskRolesFor`), used by
`SelfBoardTaskDrawer` to decide the editable-vs-read-only view.

**Do NOT** derive this from `MANAGEABLE_BY_ROLE` in the same file. That is a *management*
hierarchy and includes `weight_master` (21 users), who must not receive the loading
department's tasks.

## Full task list

| Opens when shipment enters… | Task | Responsible role | Completes by |
|---|---|---|---|
| **Draft** | Set destination | export_manager | auto: `country` + `customer` + `import_firm` |
| | Pick export firms | document_team | auto: add a firm split |
| | Assign driver | transport | auto: `driver_name` + `driver_phone` + `truck_plate` — *only if not gapy-satys* |
| | Give documents | transport | **Mark Done** — *only if not gapy-satys* |
| | Give documents (gapy) | document_team | **Mark Done** — *only if gapy-satys* |
| | Assign driver (gapy) | document_team | auto: `driver_name` + `driver_phone` + `truck_plate` — *only if gapy-satys* |
| | Start documents prep | document_team | auto: `documents_status` = `ready` |
| **Customs entry (TM)** `gumruk_girish` | Trigger customs exit | document_team | auto: `customs_exit_at` |
| **Customs exit (TM)** `gumruk_chykysh` | Trigger loading start | loading_dept_head | auto: `loading_started_at` |
| **Loading** `yuklenme` | Fill loading data | loading_dept_head | auto: `shipment_code` + `block_sources` + `variety` + `weight_net` |
| | **Quality inspection** | quality_inspector | **Mark Done** *(non-gating reminder — 4 quality certificates + `transit_days` + `transport_temp_c` + `shelf_life_days`; see below)* |
| | Trigger departure | document_team | auto: `departed_at` |
| **Departed** `yola_chykdy` | Trigger border crossing | transport | auto: `border_crossed_at` |
| | **Submit sales report** | sales_rep | **Mark Done** *(non-gating reminder — closed when the SalesReport is saved; see below)* |
| **Border crossed** `serhet_gechdi` | Trigger dest. entry | sales_rep | auto: `dest_entry_at` |
| **Dest. entry** `dest_entry` | Trigger dest. customs | sales_rep | auto: `customs_entry_at` |
| **Dest. customs** `barysh_gumrugi` | Trigger transshipment | sales_rep | auto: `peregruz_date` — *only if has transshipment* |
| | Trigger arrival (direct) | sales_rep | auto: `arrived_at` — *only if no transshipment* |
| **Transshipment** `transshipment` | Trigger arrival | sales_rep | auto: `arrived_at` |
| **Arrived** `bardy` | Confirm destination | sales_rep | auto: `city` |
| | Trigger sale start | sales_rep | auto: `sale_started_at` |
| **Selling** `satylyar` | Trigger sale end | sales_rep | auto: `sale_ended_at` |
| **Sold** `satyldy` | Trigger report received | sales_rep | auto: `sales_report` *(report-existence — retargeted from the old `sales_report_date` date field)* |

`hasabat` was retired in state machine v2 (merged into `tamamlandy`) and has no rules. `tamamlandy` and
`cancelled` are terminal and generate no tasks.

**Mark Done tasks never gate auto-advance.** `auto_advance_if_ready()` checks only the non-`MANUAL_DONE`
tasks on the step, so *Give documents*, *Submit sales report* and *Quality inspection* are reminders — a shipment moves on
without them. See [[../processes/shipment-lifecycle#Sheet-Driven Auto-Advance (v2)]].

## Sales-report task wiring

The sales report is fillable from **step 4 (`yola_chykdy`, departed)** onward — the
truck usually sells before the system status catches up. Two rules cooperate:

- **Step 4 reminder** (`tasks.submit_sales_report`, sales_rep, `MANUAL_DONE`): appears the
  moment the truck departs so the rep sees "fill the report" on the board early. It **must**
  be `MANUAL_DONE` — a field-based (auto-resolving) task on step 4 would gate auto-advance
  and freeze the truck at step 4 until the report is filled (weeks later). `MANUAL_DONE`
  tasks are exempt from `is_step_trigger_satisfied`, so this stays a non-gating reminder.
- **Step 11 trigger** (`satyldy` → `tamamlandy`, target `sales_report`): closes the lifecycle
  when the SalesReport **row exists** (retargeted from the old `sales_report_date` date field).
  `_resolve_value` returns the report on existence / `None` when absent, so `ALL_FIELDS_FILLED`
  resolves the instant a report exists.

**Close link:** the engine never auto-resolves `MANUAL_DONE`, so saving the report closes the
reminder via `close_sales_report_task(shipment, user)` (`services/task_rules.py`), called from
the `set_sales_report` endpoint. That helper (1) marks the reminder DONE and (2) runs
`shipment.save()` so the step-11 report-existence trigger resolves and auto-advances to
`tamamlandy` — on the **common early-fill path** it resolves on satyldy entry; on **late-fill**
(report saved while already at satyldy) it resolves right away.

**Backfill:** rules only generate on transition INTO a step, so departed shipments that
predate the reminder rule need `python manage.py backfill_sales_report_tasks` (run
`seed_task_rules` first). It creates the reminder for step-4+ shipments lacking a report and
advances `satyldy`-with-report shipments to `tamamlandy`. Supports `--dry-run` / `--limit` /
`--skip-advance`.

## Maintenance note

Each `Task` row **snapshots** its watched fields from the rule at creation time. If you edit a `TaskRule`'s `target_fields` / `completion_rule`, existing open tasks keep the old values and won't auto-close. After changing rules run:

```
python manage.py reconcile_tasks --dry-run   # preview
python manage.py reconcile_tasks             # apply + re-resolve
```

`seed_task_rules` calls the reconcile automatically after upserting rules.

## Quality inspection (`yuklenme`) — why it is Mark Done

This rule has been created twice. The first version (2026-06) was
`ALL_FIELDS_FILLED` over the four quality-certificate flags and assigned to
`greenhouse_manager`. It was soft-disabled the same month (commit `84f1a98`)
after it froze real trucks: the flags gated `yuklenme → yola_chykdy`, and the
greenhouse team tracked quality documents outside the Sheet, so nobody with the
task had a UI path to clear it.

Re-enabled 2026-09-22 with both causes fixed:

- **Owner** — [[quality-inspector]] now exists and holds the `quality_document`
  resource plus the three transit readings.
- **Gating** — `MANUAL_DONE`, so it can never hold a departure. Deliberate: the
  task carries `transit_days` and `transport_temp_c`, which are not knowable at
  loading time. A field-based rule would sit open for days and block the truck
  the whole while. `deadline_rule` is blank for the same reason.

**Trigger chain.** Filling Sheet R19 "Ýükleme başlady" (`loading_started_at`)
resolves *Trigger loading start* on `gumruk_chykysh`, which auto-advances the
shipment into `yuklenme` — where this rule generates the task. The field is not
a `yuklenme` trigger itself; it is the preceding step's.

**Card behaviour.** The three plain shipment fields are editable inline on the
task card. The four `quality.*` entries are dotted paths, and
`fieldKeyToConfig()` returns `null` for any dotted key, so they render read-only
there; the certificates themselves are UPLOADED in the ShipmentDetail quality
section (`POST /export/shipments/{id}/quality-certificates/`).

The rule's `target_fields` still name the four booleans rather than the
certificate rows. That is deliberate, not a leftover: the booleans are derived
from the scans, so they remain an honest "is this done" display, and the rule
is MANUAL_DONE so nothing resolves off them.

**Not retroactive.** Reactivating a rule does not backfill tasks. Shipments that
were already at `yuklenme` on 2026-09-22 have no quality task; only shipments
entering the step afterwards get one.
