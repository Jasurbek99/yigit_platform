# Task Rules Reference

The Self Board (`/me/board`) generates **tasks** automatically as a shipment moves through its lifecycle. Each task is created when the shipment **enters a status**, is owned by a **role**, and completes in one of two ways.

> Source of truth: `backend/apps/export/management/commands/seed_task_rules.py` (seeds the `TaskRule` rows). Live rules live in the `export_taskrule` table.
>
> The same catalog is readable **in the app** at `/export/task-rules` ([[../screens/task-rules]]),
> rendered straight from those rows. For the system behind it — the four task kinds, the
> deadline grammar, the lifecycle — see [[task]].

## Two kinds of completion

> **`field_set`** (2026-09-29): a fourth auto rule — the target has *any* value, an explicit
> `False` included. Used for yes/no questions (`has_peregruz`), where `all_fields_filled` would
> read «No» as empty (`_is_filled(False)` is False).

- **Auto** — the task is tied to one or more shipment **fields**. The moment the responsible person fills those field(s), the task auto-closes (no button). Implemented by `resolve_for_shipment()` in `apps/export/services/task_rules.py`, invoked from `Shipment.save()`.
- **Mark Done** (`manual_done`) — the task represents a **physical / process action** with no data field to watch (handing over papers, sending docs to customs, finalizing a sale). The responsible person confirms it with the **Mark Done** button in the drawer.

Completion rules: `all_fields_filled` (all listed fields set), `any_field_filled` (≥1 set), `field_equals` (a field equals a value), `manual_done` (button only), `confirm` (button only, **but holds the step** — 2026-09-30, see [[#PREP / DOCS chain (2026-09-30)]]).

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
| **Draft** (PREP) | 5b Set destination «Eksport maglumatlaryny dolduryň» | export_manager | auto: `country` + `customer` + `import_firm` |
| | 6 Join supply «Ýükleme bölek birikdir» — *after 5b* | export_manager | auto: `block_sources` (packing joined; card links to the Assignment board). **Does not hold the step** |
| | 7 Pick export firms — *after 5b* | document_team | auto: add a firm split |
| | 8.1 Choose truck «Maşyn saýla» — *after 5b, only if not gapy-satys* | export_manager | auto: `trip_id` — a Planning trip joined on the Truck Board (PR #24 rule, kept at the merge 2026-09-30) |
| | 8.2 Assign driver (gapy) «Transport maglumatlaryny dolduryň» — *after 5b, only if gapy-satys* | document_team | auto: `driver_name` + `truck_plate` + `driver_phone` |
| **Customs entry (TM)** `gumruk_girish` (DOCS) | 9 Prepare contract — *after 7* | document_team | `confirm` button, or closes itself once every firm on the truck has a non-void sale whose contract's agreement was downloaded |
| | 10 Fill gross/net — *after 7* | document_team | auto: `packing_template` chosen |
| | 11 Prepare transport docs «Taýýarladym» — *after 8* | document_team | `confirm`; sets R6 «Resminamalar 13:00» to `in_progress` |
| | 12 Print CMR — *after 9, 10, 11* | document_team | CMR downloaded, or `confirm` |
| | 13 Print TIR — *after 11* | document_team | TIR downloaded, or `confirm` |
| | 14 Print CT-1 — *after 12* | document_team | CT-1 letter downloaded, or `confirm` |
| | 15 Print phyto — *after 14* | document_team | fito letter downloaded, or `confirm` |
| | 16 CT-1 and phyto sent «Ugradyldy» — *after 14, 15* | document_team | `confirm` |
| | 17 Customs letter «Gümrük haty» — *after 12* | document_team | `customs_tk` downloaded, or `confirm` |
| | 18 Sent to stamp «Peçada ugradyldy» — *after 16, 17* | document_team | `confirm` |
| | 19 Back from stamp «Peçatdan geldi» — *after 18* | document_team | `confirm` |
| | 20 Give advance «Awans ber» | finansist | auto: `has_current_advance` — an advance is linked; after a truck-change rollback only a NEW advance (created after `documents_reset_at`) counts, the old link stays. The card links to the Advances page (2026-10-01) |
| | 21a Prepare declaration — *after 19* | document_team | `confirm` |
| | 21b Sent to customs «Gümrüge ugradyldy» — *after 20, 21a* | document_team | `confirm` — the last task; the step advances when it closes |
| **Customs exit (TM)** `gumruk_chykysh` | 22 Back from customs «Gümrükden geldi» | document_team | auto: `customs_exit_at`; sets R6 to the «Gümrükden geldi» option |
| | 24 Trigger loading start «Ýükleme başlady» — *after 23, the garawul's arrival* (`depends_on='tasks.gate_arrive'`, 2026-10-01) | loading_dept_head | auto: `loading_started_at`. The gate no longer writes R19; see [[../processes/gate#Loading starts after the arrival]] |
| **Loading** `yuklenme` | Fill loading data | loading_dept_head | auto: `shipment_code` + `block_sources` + `variety` + `weight_net` |
| | 26 **Loading ended** «Ýükleme gutardy» (`tasks.loading_ended`, 2026-09-30) — *after Fill loading data* (2026-10-01) | loading_dept_head | auto: `loading_ended_at` (R20). Holds the step: a truck the garawul already let out (`departed_at`) waits in `yuklenme` until it is filled, then auto-advances (gapy → `tamamlandy`). New-in-catalog: trucks already loading at deploy leave as before |
| | **Quality inspection** | quality_inspector | **Mark Done** *(non-gating reminder — 4 quality certificates + `transit_days` + `transport_temp_c` + `shelf_life_days`; see below)* |
| | Trigger departure (27 «Ýyladyşhanadan çykdy») | **garawul** (since 2026-09-30; was document_team) | auto: `departed_at` — written by the guard's gate «Çykdy» mark. Shows on nobody's My Tasks (a guard sees only his location's gate tasks); it stays as the step's gate |
| **Departed** `yola_chykdy` | Trigger border crossing | transport | auto: `border_crossed_at` |
| **Border crossed** `serhet_gechdi` | Trigger dest. entry | sales_rep | auto: `dest_entry_at` |
| **Dest. entry** `dest_entry` | Trigger dest. customs (30 «Gümrük işleri») | sales_rep | auto: `customs_entry_at` — ONE moment: when the destination customs work was done (owner 2026-09-30; UI says «Таможня пройдена», the column name stays) |
| | **Peregruz barmy?** (`tasks.ask_peregruz`, 2026-09-29) — *after 30* (2026-10-01) | sales_rep | auto (`field_set`): `has_peregruz` answered — «No» counts. The truck stays at `dest_entry` until answered, so the barysh_gumrugi fork always runs on a real answer |
| **Dest. customs** `barysh_gumrugi` | Trigger transshipment | sales_rep | auto: `peregruz_date` — *only if has transshipment* |
| | Trigger arrival (direct) | sales_rep | auto: `arrived_at` — *only if no transshipment* |
| **Transshipment** `transshipment` | Trigger arrival | sales_rep | auto: `arrived_at` |
| **Arrived** `bardy` | Trigger sale start (34) | sales_rep | auto: `sale_started_at` — the pallet QR scan records it |
| | Confirm destination — *after 34* (2026-10-01) | sales_rep | auto: `city`. Not before 34: the QR scan records only the open task's timestamp and the city is not scannable |
| **Selling** `satylyar` | Trigger sale end | sales_rep | auto: `sale_ended_at` |
| | **Submit sales report** (36 «Hasabat doldur») | sales_rep | auto: `sales_report` (the report is saved), `gates_step=False` — one card from the sale start to the saved report; no button (2026-09-30). On `yola_chykdy` until 2026-10-01 (owner: one task at a time); a report saved earlier closes it at creation |
| **Sold** `satyldy` | ~~Trigger report received~~ | sales_rep | **inactive since 2026-09-30** — a second card for the same report; `approve_sales_report` needs the report anyway |
| | **Approve the report** (`tasks.approve_sales_report`, 2026-09-29) | export_manager (either; admin / boss / director may too) | auto: `sales_report.approved_at` — set by `POST /shipments/{id}/sales-report/approve/`. The shipment closes only after approval; approve only, no reject. Since 2026-10-01 `depends_on=tasks.submit_sales_report` (created once the report is saved) and the card carries the «Утвердить отчёт» button |

`hasabat` was retired in state machine v2 (merged into `tamamlandy`) and has no rules. `tamamlandy` and
`cancelled` are terminal and generate no tasks.

**`gate` (garawul) is not in this table.** It is code-driven like `weekly_plan` / `local_sell_plan`
/ `truck_allocation` — see [[task#The nine task kinds]]. Two steps, `gate_arrive` and `gate_depart`,
each scoped to one `LoadingLocation` via `Task.scope_location` rather than gated by status.
`MANUAL_DONE`, but not through `/complete/`: `TaskViewSet.complete` refuses `kind='gate'`
(`gate_task_needs_mark`) so only `POST /export/gate/{id}/arrive\|depart/` can close it. Synced
lazily by `sync_gate_tasks()` — on every gate list read, on `MeTaskListView` for a guard, and inside
each gate action.

**Mark Done tasks never gate auto-advance.** `auto_advance_if_ready()` checks only the non-`MANUAL_DONE`
tasks on the step, so *Give documents*, *Submit sales report* and *Quality inspection* are reminders — a shipment moves on
without them. See [[../processes/shipment-lifecycle#Sheet-Driven Auto-Advance (v2)]].

## PREP / DOCS chain (2026-09-30)

Owner's catalog, `docs/Tasks.md` items 5b–22. Spec:
`docs/superpowers/specs/2026-09-30-prep-docs-tasks-design.md`. Engine: `apps/export/services/task_chain.py`.

- **`depends_on`** (CSV of `title_key`s) — "task after N". The task is **not created** at step
  entry; `spawn_ready_tasks()` creates it once every prerequisite is satisfied. A prerequisite
  is satisfied when no task with that title is still active, and — if there is no such task at
  all — no applicable, effective rule for it exists on the **current** step. A prerequisite
  from an earlier step with no task (a shipment that crossed the deploy, or a variant that
  does not apply) counts as satisfied, so nothing deadlocks.
- **A pending dependent holds the step** (E3): `is_step_trigger_satisfied()` is False while a
  gating dependent of the current step is still waiting to be created.
- **`gates_step`** (default True). `False` = the task never holds the step, open or pending —
  `join_supply` only, so documents can start before the packing is joined.
- **`confirm`** — a button task that holds the step. The card shows the task's own button text
  (`tasks.button.*`: «Çap etdim», «Ugradyldy», «Taýýarladym»…). `POST /tasks/{id}/complete/`
  accepts it, then spawns what is due and runs auto-advance.
- **`effective_from`** — set once by `seed_task_rules` when a `new_in_catalog` row is first
  created. A rule applies only to shipments that entered its step at or after it (step entry =
  `status_changed_at`, written only by `transition_to` / `create_shipment`, else `created_at`),
  so a shipment already in «Подготовка» or at customs at deploy finishes the step on its old
  tasks. Not the status log: join / swap / unjoin append same-status rows to it.
- **Ordering in `Shipment.save()`**: resolve → spawn the tasks now due (only when something
  closed) → auto-advance.
- **Promote** (`can_promote_from_draft` on the detail serializer) follows the same gate: an
  open `join_supply` does not block it, a PREP task still waiting to be created does.
- **Closing paths outside `save()`**: document downloads (`ShipmentDocumentDownload`;
  CMR/TIR/packet/letter endpoints close the print task now, or when it is created later);
  contract readiness (contracts registers `contracts_ready` for `prepare_contract`; checked on
  sale create/update, firm-contract link and agreement download); advances (create + link-shipment);
  join / swap packing (closes `join_supply` only — **a packing move never moves the truck**).
  A closed season changes nothing.
- **Truck-change rollback** (PR #24, `services/rollback.py`; owner 2026-09-30): the shipment
  goes back to «Подготовка», `documents_reset_at` is stamped, and the DONE tasks of 11–21b, 22 and
  20 (advance) are reopened — the truck is printed on the transport documents and everything
  built on them; the contract (9) and gross/net (10) stay done. Downloads and advances from
  before the stamp do not count (a second advance is needed; the first stays linked). The
  reopened tasks are all open at once — the redo is not re-sequenced. The stamp is cleared when
  «Gümrüge ugradyldy» (21b) closes again. While it is set the Sheet, «Подготовка», the shipment
  card, My tasks (reopened tasks only) and the Truck Board show an orange «Maşyn üýtgedi» mark —
  see [[../processes/truck-board#Reaction to a Planning change]].
- **Legacy duplicates** (2026-09-30): `send_documents_to_customs`, `docs_back_to_office`, `finalize_sale`
  lived only in the DB, so seeding never turned them off; the seed now lists them inactive and
  `python manage.py cancel_retired_duplicate_tasks [--dry-run]` cancels their open cards once.
- **Junction writes** (firm splits, block sources) run the same task refresh as a save, so
  `pick_export_firms` / `join_supply` close the moment the split is saved.
- **Deactivated** (rows kept, `is_active=False`): `set_border_point`, `give_documents`,
  `give_documents_gapy`, `start_documents_prep`, the transport `assign_driver`,
  `trigger_customs_exit`. Their open tasks on in-flight shipments still close as before.

## Packing parts get no tasks

Owner, 2026-09-29: a draft with **no destination** (country and customer both empty) is the
packing part — a Gaplama «Tır Aç» / supply truck, or a composer draft not yet assigned. It
must not show up in anyone's tasks, so **no draft-step rule applies to it**
(`task_rules._rule_applies`). Every task path goes through that check: creation
(`generate_tasks_for_status`, so also `transition_to` and `backfill_tasks`) and the
condition reconciler (a Gapy flip on a packing part creates nothing).

- **Destination set** (Sheet/Detail PATCH or a swap of `country`/`customer`):
  `sync_draft_tasks_with_destination()` runs from `reconcile_shipment_tasks`. A draft with no
  draft-step task rows gets them generated; one whose tasks this rule cancelled gets them
  reopened. A draft that already has its tasks gets nothing new, so a country edit cannot
  emit a rule it was exempted from (see Border point below).
- **Destination cleared**: the active draft-step tasks are cancelled with `rule_mismatch`, so
  they come back when a destination is set again. DONE is never touched.
- **Join**: nothing to do — the supply row is deleted and its tasks with it.
- **My Tasks** (`GET /me/tasks/`, `core/views_me.py`) excludes every task on a packing part, in
  every state — the pre-rule tasks were cancelled, and SelfBoard's History column lists cancelled.
- **Promote**: `can_promote_from_draft` is False for a packing part; with zero tasks the
  "all auto tasks done" check would otherwise call it ready.
- **Before 2026-09-29** every draft got the tasks at creation. `python manage.py
  cancel_packing_part_tasks [--dry-run]` cancels the active ones on no-destination drafts
  (196 on 39 trucks on the dev DB). Run it once after deploy.

## Border point (Serhet nokady)

> **Inactive since 2026-09-30** — replaced by the PREP chain above. Kept for the shipments that
> still carry the task and for history.

`Set border point` is a **gating** draft task: `border_point` feeds the TIR carnet and the
CMR overlay (`_border_point_name()` in `contracts/services/document_context.py`), so transport
picks it while the documents are still being prepared rather than after they are printed.

Three things about it:

- **It often closes itself.** Since 2026-09-23 a destination country can carry a default
  crossing (`Country.border_point`, edited on the Truck Destinations page — see
  [[truck-allocation]]). `Shipment.save()` copies it into an empty `border_point` when the
  country changes, before `resolve_for_shipment()` runs, so for a country that has one the
  task is created and resolved in the same request. Transport still owns R29 and can change
  the value; a country with no default leaves the task as a real gate.
- **Gapy shipments never get it.** R29 carries `gapy_hidden=True`, so a gapy draft has no UI
  path to the field; an unconditional rule would hang an unresolvable gating task on every
  gapy draft. The seed row therefore carries `condition_field='is_gapy_satys'` / `'False'`.
- **It was NOT backfilled.** When the rule shipped (2026-09-23) 69 of the 70 open non-gapy
  drafts had no border point. Those drafts have no `Task` row for the rule and are not gated —
  `is_step_trigger_satisfied()` reads Task rows, and `reconcile_tasks` is a mutator that never
  emits new tasks. Running `backfill_tasks` would gate all of them at once. The country
  default does not backfill them either — it fires only on a country *change*, so those
  drafts keep their empty border point until someone re-routes or fills them.

It does not block document generation itself: the TIR carnet dialog accepts a typed border
point, which is used only when the shipment has none.

## Sales-report task wiring

The sales report is fillable from **step 4 (`yola_chykdy`, departed)** onward — the
truck usually sells before the system status catches up. Two rules cooperate:

- **Report reminder** (`tasks.submit_sales_report`, sales_rep): appears when the sale starts
  (`satylyar`, since 2026-10-01 — it appeared at departure before, next to every other rep
  task; `cancel_retired_duplicate_tasks` cancels the old step-4 cards on trucks not selling
  yet). The report can still be saved any time; then the card closes at creation. Since 2026-09-30 (owner, item
  36 — one card) it is `ANY_FIELD_FILLED` on `sales_report` with **`gates_step=False`**: it
  closes only when the report is saved (no "Mark Done" button), and it never holds a step, so
  the truck is not frozen at step 4 for the weeks the sale takes. Before, it was `MANUAL_DONE`
  for the same non-gating reason.
- **Step 11 approval** (since 2026-09-29, `tasks.approve_sales_report`, target
  `sales_report.approved_at`): the report alone no longer closes the shipment — it waits at
  `satyldy` until an export manager approves it (`POST /shipments/{id}/sales-report/approve/`,
  which sets `approved_at` / `approved_by` and saves the shipment to fire auto-advance).
  Since 2026-10-01 (E2E finding) the card is **created only after the report is saved**
  (`depends_on=tasks.submit_sales_report`; `close_sales_report_task` runs `after_task_done`
  so it spawns) — before, a truck that reached `satyldy` first gave the export manager an
  «approve» card with nothing to approve. While pending it still holds `satyldy` (E3). The
  card itself has the approve button (`SalesReportApproval`), not only a pointer to the page.
- ~~**Step 11 trigger**~~ (`tasks.trigger_report_received`) — **inactive since 2026-09-30**:
  on a late fill it put a second card for the same report next to the reminder, and the
  approval task already needs the report. Open ones on in-flight shipments still close when
  the report is saved.

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

## Condition re-evaluation

Tasks are created once, when the shipment enters a step, from the rules whose
condition matched at that moment. But `is_gapy_satys` and `has_peregruz` are
edited on the Sheet long after step entry, and the rules that key off them are
paired — one variant for `True`, one for `False`. Until 2026-09-24 that meant a
manager ticking Gapy Satyş on a draft left the Regular tasks OPEN forever **and**
the Gapy tasks were never created at all.

`reconcile_shipment_tasks()` (`services/task_rules.py`) closes that gap. It runs
on every shipment PATCH whose changed fields (value before ≠ after — resubmitting an
unchanged checkbox does not count) include a field some active rule
conditions on — an ordinary weight or date edit costs one small query and no
writes.

**No longer runs on a swap (2026-09-29).** The old field-picking `/swap/` could
exchange `has_peregruz`, so `reconcile_shipment_tasks()` used to also run on
both shipments after it, inside the same transaction, so the swapped values and
both task sets committed together or not at all. `/swap/` is removed; its
replacement, `POST /shipments/{a}/swap-packaging/`, only exchanges packing
(`block_sources`, `export_code`, `variety`, `varieties_dominant`,
`harvest_date`, `harvest_status`, `weight_to_load_kg`) — `has_peregruz` is not
among them, so swap-packaging never calls `reconcile_shipment_tasks()` and
cannot flip a shipment between its Regular and Gapy task sets. See
[[../processes/draft-shipments#Late join, detach, swap (2026-09-29)]].

**One task per (shipment, rule), enforced by the database.** The generators
check for an existing task and then create one, so two concurrent requests could
both insert. The filtered unique index `export_task_one_per_shipment_rule`
(migration 0080; only rows with both `shipment` and `rule` set — ad-hoc and weekly
tasks are exempt) refuses the second insert, and `create_rule_task()` treats that
as "already there".

**It only ever looks at conditioned rules whose field actually changed.** An
unconditional rule is not a condition question, and neither is a rule keyed on a
field nobody touched. This matters: without that filter the function would emit a
task for every rule with no row — i.e. it would be `backfill_tasks` with no
opt-out, and it would gate the 69 legacy non-gapy drafts on
`tasks.set_border_point`, which the 2026-09-23 decision deliberately exempted.

Per active rule in scope, one outcome:

| Rule matches? | Existing task | Outcome |
|---|---|---|
| yes | none | created |
| yes | `CANCELLED` / `rule_mismatch` | reopened |
| no | `OPEN` / `IN_PROGRESS` / `BLOCKED` | cancelled, reason `rule_mismatch` |
| either | `DONE` | untouched — the work was really done |
| either | `CANCELLED`, any other reason | untouched — never resurrected |

Scope is every step that has a non-terminal task on the shipment, plus the
shipment's current step, so a long-lived earlier-step task
(`tasks.submit_sales_report`, created at `satylyar` — `yola_chykdy` before 2026-10-01) is covered.

**It never calls `auto_advance_if_ready()`.** Cancelling the last open auto-task
at a step makes that step trigger-satisfied, and advancing from here would let a
checkbox move a truck through every pre-satisfied step at once. The shipment
advances on its next ordinary save **that resolves a task** — so a cancel-only
reconcile can leave a truck eligible-but-parked. That is deliberate and safe; the
reconciler logs a WARNING naming each step that lost its last open auto-task, so
the situation is visible in the log rather than silent.

A **reopened** task gets a freshly computed deadline and its `started_at`
cleared, so it never comes back already overdue. The reconcile runs inside the PATCH's
`transaction.atomic()` block, so the field write and the task churn commit
together.

Affected roles get a `tasks_changed` notification: the roles owning the created /
cancelled / reopened tasks, union `STATUS_NOTIFY_ROLES` for the current step. For
a Gapy flip on a draft that is `transport`, `document_team` and `export_manager`.
A completed Gapy-Satyş truck does not add `finansist` from `tamamlandy` — the same
`_step_notify_roles()` suppression `_notify_action_required` uses (ADR-025).
The notification is sent **outside** the transaction — nobody should be told about
a change that then rolled back.

### `Task.cancelled_reason`

| Value | Written by |
|---|---|
| `manual` | `TaskViewSet.cancel` — a person cancelled it |
| `shipment_cancelled` | `_cancel_open_tasks` — the whole shipment was cancelled |
| `rule_mismatch` | `reconcile_shipment_tasks` — the only value it will reopen |
| `rule_deactivated` | reserved for the rule editor; nothing writes it yet |

Blank means either "never cancelled" or "cancelled before 2026-09" — treat `''`
as unknown in any analytics, not as `manual`.

### One hazard worth knowing

`condition_value` is compared as a string: `str(shipment.is_gapy_satys) == rule.condition_value`.
A rule written with `'true'` instead of `'True'` matches **nothing**, so every task
at that step is cancelled and none created — which also leaves the step
auto-advance eligible. The reconciler logs a WARNING when it cancels tasks at a
step and creates none; that warning is the only defence.

### Repairing history

`python manage.py reconcile_tasks --dry-run` now reports a **second** pass: tasks
that a condition change stranded. Read the dry run first — cancelling a stale task
can leave a step auto-advance eligible on that shipment's next save.

By default the repair pass **only cancels**; it never emits a task for a matching
rule that has no row. That is what keeps `reconcile_tasks` a mutator rather than a
backfill, and it is why running it can never retroactively gate a shipment. Add
`--create-missing` to opt in, and read the dry run of *that* before you do.

## Maintenance note

Each `Task` row **snapshots** its watched fields from the rule at creation time. If you edit a `TaskRule`'s `target_fields` / `completion_rule`, existing open tasks keep the old values and won't auto-close. After changing rules run:

```
python manage.py reconcile_tasks --dry-run   # preview
python manage.py reconcile_tasks             # apply + re-resolve
```

`seed_task_rules` calls the reconcile automatically after upserting rules.

That is the **drift** pass (a task's snapshot vs its rule). Since 2026-09-24 the
same command also runs a **condition** pass — see [[#Condition re-evaluation]].

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

## Assignees (2026-10-05)

`export_task_rule_assignee` (`TaskRuleAssignee`: `rule` FK CASCADE, `user` FK CASCADE,
unique pair). No rows = the whole role owns the rule (the default, and the state of
every rule until an admin picks someone). With rows, only those users see the rule's
tasks under My tasks; the rest of the role see them under «Задачи коллег» — see
[[task]] → *mine vs colleagues*.

- `GET /export/task-rules/` rows carry `assignees: [{id, full_name}]`.
- `PUT /export/task-rules/{id}/assignees/` body `{"user_ids": [..]}` replaces the list
  (`[]` clears it). Allowed: superuser, `admin`, `director`
  (`CanEditTaskRuleAssignees`). Each user must be active and in
  `task_roles_for(rule.assignee_role)` or the call is a 400; every change writes an
  `AuditLog` row (`model_name='TaskRule'`, `field_name='assignees'`).
- `GET /export/task-rules/{id}/assignee-candidates/` → `[{id, full_name, role}]`, same
  permission, feeds the picker.

`seed_task_rules` uses `update_or_create`, so a reseed keeps assignees; only
`seed_task_rules --reset` (delete all rules) wipes them through CASCADE.
