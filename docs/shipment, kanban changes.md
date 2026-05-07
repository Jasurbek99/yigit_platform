# YGT P3 — Tasks, Dual Kanbans, KPI Refactor

A complete record of what shipped in the 10-commit refactor on branch `refactor/collapse-schemas-to-dbo` (commits `845a93c` through `0f19c48`). No code in this doc — only the logic and architecture, what each piece does, and how backend and frontend cooperate.

---

## Table of contents

1. [Why we did this](#why-we-did-this)
2. [The shape of the refactor](#the-shape-of-the-refactor)
3. [Stream A — cleanup](#stream-a--cleanup)
4. [Stream B — task system (3 sub-PRs)](#stream-b--task-system-3-sub-prs)
5. [Stream C — phase grouping](#stream-c--phase-grouping)
6. [Stream D1 — Detail page rewrite](#stream-d1--detail-page-rewrite)
7. [Stream D2 — Self Kanban](#stream-d2--self-kanban-meboard)
8. [Stream D3 — Shipment Kanban](#stream-d3--shipment-kanban-exportshipmentsboard)
9. [Stream E — KPI layer](#stream-e--kpi-layer)
10. [How the pieces talk to each other](#how-the-pieces-talk-to-each-other)
11. [Known limits and follow-ups](#known-limits-and-follow-ups)
12. [Test surface](#test-surface)

---

## Why we did this

Before this refactor:
- "Things that need doing" on a shipment lived as ad-hoc fields (an `is_done` boolean on `ShipmentComment`) plus implicit knowledge — Soltanmyrat just *knew* he had to fill weight fields when a shipment hit yuklenme.
- The Detail page was a 4-tab UI that mixed read-only data, edit forms, and timelines into one screen. Every role saw the same layout regardless of what they actually had to do.
- There was no per-role kanban, no cycle-time KPIs, no deadline tracking.
- Phase ("Loading", "Customs", "Transit", "Destination") was an inline string here and there — there was no canonical mapping.

After:
- The **Task** is the unit of work. Every "X needs to fill Y on shipment Z" becomes a row in a real table, generated automatically when a shipment enters a status.
- The **Detail page** focuses each operator on their one current task on this shipment. Other roles' tasks are visible as a read-only summary.
- A **Self Kanban** (`/me/board`) shows one user's tasks across every shipment.
- A **Shipment Kanban** (`/export/shipments/board`) shows shipments grouped into phase columns with task progress per card.
- A **KPI layer** aggregates throughput, cycle time, on-time rate, and stuck shipments — feeds dashboards and per-screen widgets.

---

## The shape of the refactor

Five streams, ten commits. Order is enforced by dependency, not size.

| Order | Stream | Commit | What it ships |
|---|---|---|---|
| 1 | A1 | 845a93c | Drop dead Shipment columns, add export_manager_note |
| 2 | A2 | 3d449e5 | Add customs_clearance_planned_day |
| 3 | B-models | a2c2924 | Task and TaskRule Django models |
| 4 | B-engine | 6666e58 | Generation + auto-resolution + seed/backfill commands |
| 5 | B-api | 81994c5 | Task REST API + /me/... endpoints |
| 6 | C | 2d156e1 | Canonical phase grouping |
| 7 | D1 | (same window) | Detail page rewrite + serializer extension |
| 8 | D2 | 61c5481 | Self Kanban at /me/board |
| 9 | D3 | 62072cf | Shipment Kanban + board endpoint |
| 10 | E | 0f19c48 | KPI layer + Shipment.status_changed_at |

Test count: 289 backend tests pass on MSSQL across the full task + phase + board + detail + KPI suite. Frontend TypeScript clean.

---

## Stream A — cleanup

### A1: drop dead fields, add Gadam's note row

The problem. Three Sheet rows had no business reason to exist anymore:
- route_note (a free-text "transport route" textarea) duplicated information already captured by destination + AD-1 timestamps.
- customs_clearance (a 3-state status code: ✓ approved / → in progress / — not started) duplicated the AD-1 timestamps customs_entry_at and customs_exit_at. The presence of those timestamps is the canonical signal of customs status.
- cmr_status was a Sheet-only readonly orphan — it had a row in the Sheet config but no corresponding column on the Shipment model. It rendered as an empty cell.

The change.
- Two real columns dropped from the Shipment model.
- The orphan cmr_status Sheet row config deleted.
- A new column added: export_manager_note — a Cyrillic-collation TextField owned by Gadam (the export manager). It replaces the free-text noise of the three dropped slots with a single explicit "Gadam's note" Sheet row.

Backend — how it works. A single migration (0008_drop_legacy_fields_add_manager_note) does three things in one step: removes the two columns, adds the new one, and runs a Python-level data migration that:
1. Deletes any SheetRowSetting rows configured for the three dead field_keys. This automatically cascades to UserSheetRowPref (per-user hide/reorder preferences) and to SheetRowRoleTrigger / SheetRowUserPermission via existing CASCADE FKs.
2. Demotes any ShipmentComment cell-anchored to a dead key — it sets field_key = NULL, turning a cell-comment into a shipment-level comment. This preserves history; we don't delete the comments themselves.

Permissions wiring. The role-permission registry (apps/core/permission_registry.py) and the seed_permissions command both lose entries for the dropped fields and gain export_manager_note under the export_manager group.

Frontend — how it works.
- The TypeScript types for IShipmentDetail and IShipmentSheetItem lose the dead fields and gain export_manager_note: string | null.
- Mock data files updated for offline development.
- SheetCell.tsx loses the render branches for the dead fields and gains a textarea-style branch for the new one (sharing the existing notes / vehicle_condition_note textarea pattern).
- The admin Option Lists tab loses its customs_clearance category.
- Three i18n locale files (tk/ru/en) lose 4 dead keys and gain sheet.row.export_manager_note.

### A2: add the planned customs day

The problem. Sirin's "documents preparation" task needs a planned target — a weekday by which she expects to finish prep and hand papers to customs. Before A2 there was no field for this; she communicated it verbally.

The change. A single new column customs_clearance_planned_day on Shipment. It's a CharField with seven explicit weekday choices (mon/tue/wed/thu/fri/sat/sun). Owned by document_team (Sirin).

Why a CharField with choices instead of a real date? Sirin plans by weekday, not date. "Documents will be ready by Friday this week" is the natural unit. A real date column would force her to pick "April 28" when she actually means "the upcoming Friday." Choices keep the data model honest about how the operation actually works.

Backend — how it works. Migration 0009_add_customs_planned_day is a pure AddField. The field flows through the same wiring as every other Shipment field: serializer fields, patchable-fields whitelist, sheet row config, permission registry.

Frontend — how it works.
- New "weekdays" OptionsSource in the edit-config union, with a hardcoded 7-item options list (it's not admin-managed because weekdays are universal).
- The Sheet cell renderer maps the stored code ("wed") to the localized label (t("weekday.wed")).
- Edit drawer option_select field config added to the "Status" group near documents_status.
- New i18n keys in three locales for the row label and seven weekday names.

Why this matters for Stream B. The seed task tasks.start_documents_prep (Sirin) targets two fields: documents_status and customs_clearance_planned_day. Without A2, that task would be impossible to satisfy — its target field wouldn't exist.

---

## Stream B — task system (3 sub-PRs)

This is the foundation. Everything in D1/D2/D3/E rides on top of it. Split into three sub-PRs to keep each reviewable.

### B-models: the schema

Two new models.

TaskRule is a recipe. One row says "when a shipment enters status X, generate one Task assigned to role Y, targeting fields a/b/c, with completion rule Z and deadline rule W, but only if condition F=V."

Fields on TaskRule:
- step — the status code that triggers the rule.
- title_key — an i18n key that names the task (e.g. tasks.fill_loading_data).
- assignee_role — which role owns the generated tasks by default.
- target_fields — comma-separated list of Shipment field paths the task is "about." Stored as CSV in a CharField, NOT a JSONField (per project MSSQL rules — JSONField is forbidden).
- completion_rule — one of three values: all_fields_filled, any_field_filled, manual_done.
- deadline_rule — a small grammar string (24h_after_status, 13:00_same_day, friday_eow, etc.) parsed by the engine.
- condition_field and condition_value — two scalar columns that gate generation. If condition_field is empty, the rule is unconditional. Otherwise the engine compares str(getattr(shipment, condition_field)) to condition_value. One condition per rule — multi-condition cases are written as multiple rules. (Replaces a forbidden JSON dict.)
- is_active — soft-disable.

Task is the unit of work — one row per (shipment, rule) pair, plus optional ad-hoc tasks (not used in the seed).

Fields on Task:
- shipment (FK), step (the status the task belongs to), rule (the TaskRule that generated it).
- title_key, assignee_role, assignee_user — copied from rule at generation time so editing a rule later doesn't rewrite history.
- target_fields — same CSV format.
- completion_rule, deadline_rule, deadline — deadline is the absolute datetime computed at generation time from the deadline_rule.
- state — one of five: open, in_progress, blocked, done, cancelled.
- blocked_reason — text the user provides when blocking.
- blocked_by — self-referential M2M for "this task is waiting on these other tasks." (Defined; not heavily used yet.)
- created_at, started_at, completed_at — the three timestamps that drive duration metrics.

Indexes on (shipment, state), (assignee_role, state), (state, deadline). These keep the kanban + self-board queries cheap regardless of table size.

Helper properties on the Task instance:
- target_field_list — parses the CSV into a clean Python list, trimming whitespace and dropping empties.
- is_overdue — true when deadline < now() AND state isn't terminal.
- duration_seconds — completed_at - started_at if both exist, else None.

Why integer (BigAutoField) PKs and not UUIDs. The plan originally used UUIDs. UUIDs as MSSQL clustered indexes fragment the page tree because uuid4() is random. The whole rest of the codebase uses BigAutoField; we matched the idiom.

### B-engine: how tasks are born and how they die

The engine is one Python module — apps/export/services/task_rules.py. It exposes three public functions and a deadline parser. Auto-resolution does NOT use Django signals (forbidden by project rules); instead it's an explicit Shipment.save() override.

Generation — generate_tasks_for_status(shipment, new_status_code).

Called from transition_to() after the status update writes (and after the ShipmentStatusLog row is created so the audit trail captures the transition before tasks appear).

Logic:
1. Find every active TaskRule for the new status code.
2. For each rule: check if a Task already exists for (shipment, rule). If so, skip — the function is idempotent.
3. Evaluate the rule's condition (if any) against the shipment.
4. Compute the deadline by parsing the deadline rule string.
5. Insert one Task row.
6. After all generations, call resolve_for_shipment(shipment) once. This is important: a newly-entered status might generate a task whose target fields are already filled (e.g. tasks.confirm_destination targets city on a shipment that already has a destination). Without this final resolve, the task would sit OPEN until the next unrelated save.

Auto-resolution — resolve_for_shipment(shipment).

Called from a Shipment.save() override. After every shipment write, the resolver looks at every open/in-progress task on this shipment and asks: "is your completion rule satisfied by the shipment's current state?"

For each task:
- If completion_rule == manual_done, never resolves automatically. It needs a /complete/ API call.
- Otherwise, walk every entry in target_fields. Each entry can be a simple field name (weight_net) OR a dotted path (quality.azyk_maglumatnama). The walker handles three cases:
  - Plain attribute access for scalars.
  - OneToOne related (e.g. the quality field walks into a QualityDocument row). If the related row doesn't exist, the value is treated as "not filled."
  - Reverse-FK / M2M managers at leaf position (e.g. firm_splits, block_sources). The walker calls .exists() and uses the boolean.
- A value is "filled" if it's not None, not empty string, not False. Numeric 0 IS filled (a weight of 0 kg is a valid entry; refusing to resolve a weight task because the value happens to be 0 would surprise operators).
- For all_fields_filled, all targets must be filled. For any_field_filled, at least one.
- If satisfied: state → done, completed_at = now(), started_at = now() if missing.

Why Shipment.save() and not a signal. Project rules forbid Django signals — they're invisible to the reader and hard to debug. The save() override is one explicit call site. It catches every code path that goes through a Django serializer or admin write. Bulk operations (QuerySet.update(), bulk_update()) bypass it — that's a known limit; current write paths all go through serializer.save() so it's not a problem in practice. Documented in the model docstring.

Started-at signal — mark_started_for_changed_fields(shipment, changed_field_keys).

Called from the Sheet/Detail PATCH viewset, AFTER serializer.save(). The model can't see what changed — only the viewset has the diff. So:
- The viewset captures the set of field keys from the validated request payload BEFORE save.
- After save, it calls this function with the changed-field set.
- The function finds open tasks on this shipment whose target_fields intersect the changed set, and flips them to in_progress with started_at = now() (only if started_at is missing).

This separation — model.save() handles "did this satisfy completion?", viewset handles "did the user start work?" — keeps each call site doing one thing.

Deadline grammar.

The parser is a small dispatcher. Six forms:
- Empty string or "none" → no deadline.
- 13:00_same_day — today at 13:00 in Asia/Ashgabat.
- 13:00_next_business_day — next Mon–Fri at 13:00 (Fri→Mon, Sat→Mon, Sun→Mon).
- Nh_after_status for any positive integer N (e.g. 4h_after_status, 24h_after_status) — reference + N hours.
- friday_eow — coming Friday at 18:00 TM (same-day if reference is Friday).
- Anything else → log a warning and return None. The engine never crashes on a bad deadline string.

All datetime calculations are anchored to Asia/Ashgabat. This is the operational timezone of the warehouse and the Turkmen export firms; a deadline of "13:00 same day" means 13:00 Ashgabat regardless of the requesting user's clock.

The 13 seed rules (in seed_task_rules command, idempotent on (step, title_key)):

| Status | Title key | Role | Targets | Completion | Deadline | Condition |
|---|---|---|---|---|---|---|
| draft | tasks.set_destination | export_manager | country, customer, import_firm | all | 24h | — |
| draft | tasks.pick_export_firms | document_team | firm_splits | any | 24h | — |
| draft | tasks.assign_driver | transport | driver_id | all | 24h | not gapy_satys |
| draft | tasks.give_documents | transport | (manual) | manual | friday_eow | not gapy_satys |
| draft | tasks.give_documents_gapy | export_manager | (manual) | manual | friday_eow | gapy_satys |
| draft | tasks.start_documents_prep | document_team | documents_status, customs_clearance_planned_day | all | 24h | — |
| yuklenme | tasks.fill_loading_data | warehouse_chief | cargo_code, block_sources, variety, weight_net, weight_gross | all | 4h | — |
| yuklenme | tasks.quality_inspection | greenhouse_manager | quality.* (4 docs) | all | 4h | — |
| gumruk_girish | tasks.send_documents_to_customs | document_team | (manual) | manual | 13:00_same_day | — |
| gumruk_chykysh | tasks.docs_back_to_office | document_team | (manual) | manual | 24h | — |
| bardy | tasks.confirm_destination | sales_rep | city | all | 24h | — |
| satyldy | tasks.finalize_sale | sales_rep | (manual) | manual | 24h | — |
| hasabat | tasks.submit_sales_report | sales_rep | (manual) | manual | friday_eow | — |

Backfill command — backfill_tasks.

For shipments that existed before the engine shipped. Walks every shipment in the DB, calls generate_tasks_for_status(shipment, current_status). Idempotent (the engine skips existing). Pre-fetches all active rules grouped by step before the loop to avoid per-shipment queries. Flags: --dry-run (lists candidates without writing), --limit N (test on a small batch).

### B-api: the REST surface

The API surface that the upcoming kanban and detail pages consume. All endpoints use cookie-based JWT auth and PageNumberPagination.

Read-only Task endpoints.

GET /api/v1/export/tasks/ — list. Filterable by assignee_role, assignee_user, state, shipment, step, plus a special ?overdue=true filter (deadline past AND state not terminal). Default order: deadline asc nulls last, created_at asc. The queryset uses select_related("shipment", "rule", "assignee_user") to bound the list query at 2 SQL hits regardless of result size.

GET /api/v1/export/tasks/:id/ — detail. Same shape plus blocked_reason, blocked_by, duration_seconds.

Action endpoints — all POST, all return the updated task as TaskDetailSerializer.

- /start/ — OPEN → IN_PROGRESS, sets started_at if missing. Idempotent for IN_PROGRESS. Rejects from BLOCKED with 400 (the documented recovery path is /unblock/, which clears blocked_reason; we don't want /start/ to silently bypass that).
- /block/ — body {reason}. Any non-terminal state → BLOCKED. Reason is required.
- /unblock/ — BLOCKED → IN_PROGRESS, clears blocked_reason.
- /complete/ — only valid for manual_done tasks. Returns 400 with explanation for auto-resolving rules ("use field edits, not /complete/"). Sets state=done, completed_at=now(), started_at=now() if missing.
- /cancel/ — admin/director only. Anywhere → CANCELLED.

IsTaskActor permission class gates every action: request.user.role == task.assignee_role OR role in {export_manager, boss, admin, director}. Cancel restricts further to admin/director only. Anonymous → 401, wrong role → 403.

Per-shipment list endpoint.

GET /api/v1/export/shipments/:id/tasks/ — returns tasks grouped by step. Useful for any page that wants to render a shipment's task graph as a step → tasks tree.

Me endpoints (in apps/core/views_me.py).

GET /api/v1/me/tasks/ — current user's tasks. Filtered automatically by request.user.role UNLESS the user is a supervisor (export_manager/boss/admin/director), in which case they see all. Same query params as the main list endpoint.

GET /api/v1/me/kpi-today/ — done_count, avg_duration_seconds, on_time_rate. The on-time rate is (tasks where completed_at <= deadline) / (tasks with deadline set); returns null when the denominator is 0. Cached for 60 seconds — avoids re-running the query on every kanban poll cycle.

---

## Stream C — phase grouping

A small but cross-cutting stream. Defines the canonical mapping from status codes to higher-level phase codes used by every screen and the KPI layer.

Why phases. Status codes are too granular for high-level reporting. "What share of our shipments are stuck?" is a phase question, not a status question. There are 14 statuses but only 7 phases. A shipment in serhet_tm and a shipment in yolda are both "in transit" — they should count together for time-in-transit averages.

The mapping.

| Status codes | Phase |
|---|---|
| draft | PREP |
| yuklenme | LOAD |
| gumruk_girish, gumruk_chykysh | DOCS |
| yola_chykdy, serhet_tm, serhet_gechdi, barysh_gumrugi, yolda | TRANSIT |
| bardy, satylyar, satyldy, hasabat | DEST |
| tamamlandy | CLOSE |

Plus a virtual PLAN phase at the front of PHASE_ORDER. No shipment row ever has phase=PLAN — the column on the Shipment Kanban is reserved for a future "demand cards" model that hasn't shipped yet. For now it's a placeholder column.

Operational order vs status order. The kanban column order is PLAN → PREP → DOCS → LOAD → TRANSIT → DEST → CLOSE, which has DOCS before LOAD. That looks weird if you assume the order matches status step numbers — it doesn't. Operationally, Sirin's documents preparation begins in draft (PREP) and continues through to "Tayyar" before the truck physically loads. By the time a shipment is in yuklenme, its documents are already in motion. The kanban order reflects what feels right to operators; the underlying state machine in transition_to is unchanged.

How it's wired.

- A single small module apps/export/services/phases.py exposes PHASE_MAP, PHASE_ORDER, PHASE_LABELS, and get_phase(code).
- Three serializers gain a phase SerializerMethodField: ShipmentListSerializer, ShipmentSheetSerializer, TaskListSerializer. ShipmentDetailSerializer inherits the field through serializer extension.
- The Task serializer has to read the shipment's status code to compute its phase, so every Task queryset gains select_related("shipment__status") to keep the join free.
- Frontend gets a ShipmentPhase literal-union TypeScript type ("PLAN" | "PREP" | "DOCS" | "LOAD" | "TRANSIT" | "DEST" | "CLOSE") and a 7-key phase.* i18n namespace in tk/ru/en.

Why a literal union and not just string. TypeScript will refuse to render phase.unknown if a typo creeps in, instead of silently failing at runtime.

---

## Stream D1 — Detail page rewrite

The biggest visible change. The 4-tab Detail UI (Overview / Document / Finance / Changes) is gone. In its place is a single-column layout that focuses each operator on their current task on this shipment.

### Backend extension first

ShipmentDetailSerializer gains four new fields:

my_task — the requester's active task on this shipment, or null. Computed by:
1. If the requesting user is a supervisor, return null. Supervisors aren't assigned to specific tasks; they oversee. They use the regular task list and kanbans for visibility.
2. Otherwise, query shipment.tasks filtered by assignee_role = request.user.role and state in (open, in_progress, blocked).
3. Order by deadline asc nulls last, then created_at asc. Return the first via TaskDetailSerializer.

This means at most one task is highlighted as "yours" on the page. If you have two open tasks on the same shipment (rare; would need two rules for the same role at the same status), you see the most urgent one in the hero, the other in other_tasks.

other_tasks — every task on the shipment except my_task. Includes done and cancelled — they render read-only on the page so the user can see history.

in_phase_seconds — how long this shipment has been in its current phase. Critical detail: it's phase-time, not status-time. A shipment that crossed from yola_chykdy to serhet_tm (both TRANSIT) has been "in transit" the whole time; the counter shouldn't reset when the status code changes within the phase. Logic:

1. Get the current phase via get_phase(shipment.status.code).
2. Walk shipment.status_log newest-first.
3. Find the oldest log entry in the contiguous run of phase-matching transitions ending with the current status. That's the moment the shipment entered the current phase.
4. Return (now - that_timestamp).total_seconds().

phase_avg_seconds — historical average time the shipment's CURRENT STATUS takes. We named it phase but in the implementation it's per-status; explicitly documented as a simplification. The full phase-aware version would aggregate per-status averages over the phase's status codes; deferred. The label on the frontend reflects the truth: "Avg for step", not "Avg for phase". Computed across closed shipments of the active season, cached 5 minutes per (status, season) so the detail endpoint stays fast.

The retrieve queryset gains prefetch_related on tasks (with their rule and assignee_user) and on status_log (with its status and changed_by). One detail page render fires a bounded number of queries regardless of task or log count.

StatusLogSerializer also gains status_code. This was a bug fix discovered in review: the right-rail timeline on the Detail page used to map step 0 of the timeline to log entry 0 of the API response, but the log is ordered newest-first and not every step has a log entry. Partial-completion shipments showed wrong timestamps. With status_code on each log entry, the frontend builds a Map<code, log> and looks up each step by code rather than position.

### Frontend layout

The page is a single column on mobile, single column + sticky right rail on ≥md. Six new components in frontend/src/components/shipment/:

ShipmentDetailHero — top of the page. Shows cargo code, status pill (reuses the existing StatusTag), a blue phase tag, the route (origin → destination), a Manifest button, and an "idle warning" red tag that appears when in_phase_seconds > 1.5 × phase_avg_seconds (gentle nudge that this shipment has been sitting longer than usual).

MyTaskCard — the hero-emphasis card. Renders only when my_task != null. Shows the assignee role label, task title, deadline badge with overdue colouring, a progress bar (count of filled targets / total targets), and a body that lists every target field as an inline editor.

The inline editor reuses the existing SheetCellEditor pattern: each field renders in its native input type (text, number, select, date), saves through the existing PATCH flow, and the page query invalidates on success.

When the user makes their first edit, the card calls POST /tasks/:id/start/ once per mount (guarded by a ref so multiple field edits don't re-fire it). The task's started_at populates and the state flips to in_progress.

If the task's completion rule is manual_done (e.g. give_documents, finalize_sale), a "Mark task done" button appears in the card footer. Clicking calls /complete/.

PhaseContextStrip — three small cells below the task card:
- "In phase" — formatted duration from in_phase_seconds.
- "Avg for step" — phase_avg_seconds, "—" if null.
- "Tasks open" — count of (my_task if active) + active other_tasks, displayed as "X/Y" where Y is total.

OtherTasksRow — a compact read-only list of every other task on the shipment. Each row shows a state icon, the task title, the assignee role label, the deadline (if any), and a status hint ("started 2h ago" / "done by Sirin" / "not started"). Done and cancelled tasks render in muted colours.

RouteTimelineRail — the right-rail 13-step timeline. Visually unchanged from the old Detail page's Changes tab — same green/blue/grey dots, same connector lines, same comment display under each step. Now lives in its own component and uses the status_code map fix described above.

The four old tabs collapse into the new layout:
- Overview content → distributed into MyTaskCard (when applicable) and read-only collapsibles below the strip.
- Document tab → "Quality inspection" task card during yuklenme; otherwise a read-only summary collapsible.
- Finance tab → "Finalize sale" task card during satyldy; otherwise summary collapsible.
- Changes tab content → moved to a new /shipments/:id/activity stub page with comments + status_log.

ShipmentEditDrawer was NOT deleted. The plan said delete it; turns out ShipmentList still uses it for inline edit from the list view. Keeping it for that consumer; the Detail page just stops importing it.

New hook — useTaskActions. Wraps the four task action mutations (start, block, unblock, complete). On success, invalidates three query keys: ["shipment", id] (the detail page), ["my-tasks"] (the Self Kanban), and ["shipments", "sheet"] (the Sheet has per-shipment task counts in its wrapped payload).

---

## Stream D2 — Self Kanban (`/me/board`)

A frontend-only stream — the backend /me/tasks/ and /me/kpi-today/ endpoints already exist from B-api.

The page. A new top-level menu group "My Work" in the sidebar, gated by no role (every authenticated user gets a board). The badge next to the menu label shows the count of OPEN tasks for the current user, refreshed on the same 30-second cycle as the board itself.

The board has 4 columns by default, plus a 5th history column when the user toggles "Show All":
- To do — OPEN tasks.
- In progress — IN_PROGRESS tasks.
- Blocked — BLOCKED tasks.
- Done today — DONE tasks where completed_at >= midnight Asia/Ashgabat. Critical detail: the midnight boundary is anchored to the operational TM timezone via dayjs.tz("Asia/Ashgabat"). Without this, a user on a Windows laptop joined to a KZ/RU domain (which typically reports UTC) would see their TM-day tasks shifted by 5 hours.
- History (Show All only) — DONE older than today, plus CANCELLED.

Card layout (~140 × 80 px). Cargo code + small phase tag, task title, deadline indicator. Border-left colour: red (overdue), blue (in progress), amber (blocked), grey (default). Click a card → navigate to that shipment's Detail page.

KPI strip at the top of the page. Pulls from /me/kpi-today/ every 60 seconds. Three figures: ✓ done count, ⏱ average task duration, on-time rate as a percentage. Renders "—" when empty.

Filters (top bar): phase dropdown (filters by task.phase), shipment-code search (substring match against task.shipment_cargo_code), and the "Show All" toggle.

Drag-and-drop is restricted to two transitions — the only two that an operator can legitimately perform from the kanban without doing field work:
- OPEN → BLOCKED: opens a modal asking for reason, then calls POST /tasks/:id/block/. Reason is required (form validation).
- BLOCKED → IN_PROGRESS: calls POST /tasks/:id/unblock/, which also clears blocked_reason server-side.

Every other drag combination shows a toast: "Cannot move from X to Y this way" — it's not a silent no-op, the user gets feedback. Same-column drops are no-ops without a toast.

Polling cadence. Tasks query refreshes every 30 seconds. KPI query refreshes every 60 seconds. Both are also invalidated immediately after any task action (via the useTaskActions hook from D1). So if the user starts a task in another tab, this tab catches up within 30 seconds; if they start it in this tab, the board updates instantly.

---

## Stream D3 — Shipment Kanban (`/export/shipments/board`)

The fleet-wide view. Every active-season shipment grouped into the 7 phase columns, with task aggregates shown per card.

### Backend: a single bounded query

The endpoint is GET /api/v1/export/shipments/board/. It returns {phases, columns, phase_avg_seconds} where columns maps each phase to a list of BoardItemSerializer rows.

The challenge was bounding the query. A naive implementation does N+1 — one task-count query per shipment. The actual implementation uses Count annotations with conditional filters to compute all five aggregates in one SQL pass:

- tasks_total — count of all tasks on this shipment.
- tasks_done — count where state = done.
- late_count — count where deadline < now AND state not in (done, cancelled).
- in_progress_count — count where state = in_progress.
- blocked_count — count where state = blocked.

select_related on status, country, customer and prefetch_related on tasks (so the serializer can pick the most-recent task's assignee_role for owner_role and walk status_log for time_in_phase_seconds without re-querying).

Result: 5 queries total at 100 shipments, regardless of result size. Asserted in a test.

After the queryset returns, the view groups shipments into phase buckets in Python. Within each bucket, sorts by: late_count desc (most overdue first), in_progress_count desc, time_in_phase_seconds desc (longest-sitting first). The result is that the most urgent shipments rise to the top of every column.

phase_avg_seconds is a separate 5-minute-cached map: per-phase average time-in-phase across closed shipments of the active season. Used by the column footers.

### Backend filters

All optional query params, applied before annotations:
- ?country=<id> — filter by country FK.
- ?customer=<id> — filter by customer FK.
- ?gapy_satys=true|false — direct-sale shipments only / non-direct only.
- ?owner_role=<role> — keep only shipments whose most-recent task assignee role matches.
- ?search=<text> — cargo code icontains.

### Frontend

The page is purely consumer of the endpoint. Cards are NOT draggable — the Shipment Kanban is a status overview, not an action surface. Status changes happen via transition_to() triggered from the Detail page or supervisor actions, never from a kanban drag.

Card layout (~110 × 60 px). Top-border colour: red (any late task), amber (any blocked), blue (any in_progress), grey (idle). Body: cargo code, owner role label, time-in-phase, a thin progress bar showing tasks done/total. Click → Detail page.

Filters at the top of the page — CountrySelect, CustomerSelect, a 3-state gapy_satys dropdown (any/yes/no), an owner-role dropdown (all 14 roles), and a search input. Each filter writes to local component state which feeds into the useShipmentBoard hook query key.

Column footers show "Avg in phase: <duration>" pulled from phase_avg_seconds.

The shared KanbanColumn component from D2 is reused. The Shipment Kanban passes no onDrop prop, which means the column never accepts drops.

Polling: refetch every 60 seconds.

---

## Stream E — KPI layer

The final stream. Two parts: a new Shipment.status_changed_at field that fixes a long-standing data gap, and a service module of seven KPI helpers exposed via four endpoints.

### Shipment.status_changed_at

The plan: every status change should leave a denormalized timestamp on the shipment row. Before E, only some statuses had AD-1 timestamps (loading_started_at, customs_entry_at, etc.) — five transit statuses had no timestamp at all, so KPIs that wanted "time in current status" had to walk ShipmentStatusLog.

The migration 0011_shipment_status_changed_at:
1. Adds a nullable DateTimeField with an index on the column.
2. Backfills it from max(ShipmentStatusLog.changed_at) per shipment, falling back to created_at if no log entry exists. Uses bulk_update(batch_size=500) per project rules.
3. transition_to() is updated to set this field alongside the AD-1 timestamps on every status change.

D3's time_in_phase_seconds calculation also got tightened to reuse the same _resolve_phase_entry helper from D1's detail serializer. Before E, the Shipment Kanban used a Max("status_log__changed_at") annotation that over-reset on intra-phase transitions (e.g. yola_chykdy → serhet_tm, both TRANSIT — the time-in-phase counter would zero out at the boundary). After E, it walks the log just like the Detail page does.

### The KPI helpers

All in apps/export/services/kpi.py. Each is a single function returning a small dict or scalar.

kpi_throughput(window_days=7) — {closed_count, created_count, window_days}. Closed count is shipments where status="tamamlandy" AND status_changed_at >= now - window_days. Created count is shipments where created_at >= now - window_days.

kpi_cycle_time(window_days=30) — {avg_seconds, count, window_days}. Average end-to-end duration (status_changed_at - created_at) for shipments closed in the window.

kpi_avg_phase_time(window_days=30) — {phase_code: avg_seconds_int, ...}. For each phase in PHASE_MAP, computes the average time spent in that phase across all shipments touched in the window. Walks consecutive log pairs in Python (one log per shipment query, then aggregates by phase). Cached 5 minutes.

kpi_on_time_rate(role=None, window_days=7) — fraction or None. (tasks where completed_at <= deadline) / (tasks done in window with deadline set). Returns None when the denominator is 0 (no tasks with deadlines, so the rate is undefined). Optional role filter for self-board KPIs.

kpi_avg_task_duration(role=None, window_days=7) — int seconds. Average completed_at - started_at for done tasks in the window. Returns 0 when no tasks.

kpi_stuck_shipments(threshold_days=8) — int count. Non-archived, non-terminal shipments where status_changed_at < now - threshold AND no task on this shipment has been started in the threshold window. The combined condition catches shipments that are sitting in a status with nobody working on any of their tasks.

kpi_blocked_age() — {count, avg_seconds, max_seconds, p95_seconds}. Stats on currently-blocked tasks based on how long they've been sitting blocked. Approximates "since blocked" using started_at (or created_at if not started); a per-state-change history would be more precise but isn't tracked — close enough for dashboard use.

### The endpoints

All under /api/v1/kpi/, all 60-second cached, all auth-required.

- GET /kpi/dashboard/ — full grid: throughput + cycle_time + avg_phase_time + on_time_rate (no role filter) + avg_task_duration + stuck_shipments + blocked_age.
- GET /kpi/by-role/?role=X — role-scoped: on_time_rate + avg_task_duration. Required role param.
- GET /kpi/by-phase/ — avg_phase_time only (delegates to the helper's 5-minute internal cache).
- GET /kpi/by-shipment/:id/ — per-shipment context (in_phase_seconds, phase_avg_seconds). Thin wrapper over the data already in the detail serializer.

### Boss Dashboard integration

The existing apps/export/services/boss_analytics.py has 12 aggregator functions powering the boss dashboard. Stream E adds a new "Task Throughput" section to the dashboard payload that calls kpi_throughput() and kpi_on_time_rate() and merges the result into the response. The existing aggregators are untouched.

---

## How the pieces talk to each other

A walkthrough of one operational moment to show how the layers cooperate.

Scenario: Soltanmyrat (warehouse_chief) opens the Detail page for a yuklenme shipment, edits weight_net, then hits Save.

1. The frontend ShipmentDetail page fires useShipmentDetail(id). The TanStack query returns the rich detail payload: shipment data + my_task (the warehouse_chief's tasks.fill_loading_data task) + other_tasks (e.g. greenhouse_manager's quality inspection task) + in_phase_seconds + phase_avg_seconds + phase.

2. ShipmentDetailHero renders cargo code, status pill, phase tag (LOAD), idle warning if applicable. MyTaskCard renders for warehouse_chief — if it didn't, a supervisor would see no card, just the strip and other_tasks.

3. Soltanmyrat edits weight_net = 18900 in the inline editor inside MyTaskCard. The frontend fires useShipmentPatch with {weight_net: 18900}.

4. The Detail PATCH viewset on the backend:
   a. Captures the changed-fields set: {"weight_net"}.
   b. Validates and calls serializer.save(), which calls Shipment.save().
   c. Shipment.save() runs super().save() (writes the column), then calls task_rules.resolve_for_shipment(self). The resolver looks at the warehouse_chief's task: completion rule is all_fields_filled, target fields are cargo_code, block_sources, variety, weight_net, weight_gross. It checks all five against current shipment state. weight_gross is still empty, so the task stays open. No state change.
   d. After save, the viewset calls mark_started_for_changed_fields(shipment, ["weight_net"]). The function finds open tasks targeting weight_net — finds the fill_loading_data task. State flips OPEN → IN_PROGRESS, started_at = now().

5. The viewset returns the updated shipment serialization. TanStack invalidates the query.

6. The page re-renders. MyTaskCard now shows progress as 2/5 with started_at populated. The Self Kanban in another tab notices its 30-second poll: the task moves from "To do" to "In progress" with a started timestamp.

7. Soltanmyrat continues filling fields. After the last one (weight_gross) saves, resolve_for_shipment finds the completion rule satisfied. State flips IN_PROGRESS → DONE, completed_at = now(). The task auto-resolves.

8. The Self Kanban's next poll moves the card from "In progress" to "Done today". The /me/kpi-today/ endpoint's done_count goes from N to N+1; the avg_duration metric updates. The Shipment Kanban's next 60-second poll sees the shipment's tasks_done count increase by 1 — the progress bar on its card fills in.

Nothing happens via signals. Every transition is an explicit call from a known site. Every cache key (["shipment", id], ["my-tasks"], ["shipments", "sheet"], ["shipments", "board"]) is invalidated by the corresponding mutation hook. The state machine in transition_to() and the AD-1 timestamps are unchanged from before the refactor.

---

## Known limits and follow-ups

These are documented in code comments and CHANGELOG notes. None are blockers; they're the frontier where the next iteration starts.

Reverse-FK target auto-resolve. A task whose target is firm_splits (a reverse FK from ShipmentFirmSplit) auto-resolves on the next Shipment.save(). Adding a ShipmentFirmSplit row does NOT call save() on the parent. Workaround in practice: any subsequent field edit triggers the resolve. A signal-free cleaner solution would be to call resolve_for_shipment from the Sheet's firm-split mutation endpoint.

Bulk operations bypass save(). QuerySet.update() and bulk_update() skip the Shipment.save() hook, so tasks don't auto-resolve from those paths. Acceptable today (no bulk shipment-write paths in the app); flagged in the model docstring.

Atomicity of transition_to() + task generation. If task generation fails after the status update commits, the transition isn't rolled back. The trade-off was documented in services/shipment.py — bundling them in a single transaction.atomic would cause confusing rollbacks of legitimate transitions because of generation bugs. We chose to let the transition succeed and log the generation failure.

phase_avg_seconds is per-status, not phase-wide. The "avg for step" cell in PhaseContextStrip reflects this honestly. The full phase-aware version would average across the phase's status codes and is a small follow-up.

condition_field/condition_value is one-condition-per-rule. Multi-condition cases are written as multiple rules. Acceptable for the current 13-rule seed; if a future rule needs (country=KZ AND is_gapy_satys=False) as one logical unit, the model would need a small TaskRuleCondition join table.

/me/kpi-today/ cache is per-user-role. Two users in the same role share the cached KPI value for 60 seconds. This is intentional — task assignee_role is the relevant axis, not user identity. If we ever assign a task to a specific assignee_user, the cache will need to key on user id too.

Shipment creation. The standard "Create Shipment" modal still creates at yuklenme (Loading), not draft. The backend supports is_draft=true — only the frontend modal doesn't pass it. Pre-existing behavior; not part of this refactor.

---

## Test surface

289 tests in the backend, all passing on MSSQL via --keepdb. By module:

| Module | Tests | Covers |
|---|---|---|
| tests_drop_legacy_fields | 6 | A1 migration data path |
| tests_customs_planned_day | 7 | A2 field round-trip and sheet config |
| tests_task_models | 33 | Task/TaskRule schema, helper properties, M2M |
| tests_task_engine | 63 | Deadline grammar, generation, auto-resolve, dotted paths, condition matching |
| tests_task_seed | 8 | Seed idempotency, backfill dry-run |
| tests_task_api | 46 | Every endpoint, every action, every permission edge |
| tests_phases | 29 | get_phase coverage + integration via list/detail/sheet |
| tests_shipment_detail_extras | 28 | my_task, other_tasks, in_phase_seconds, phase_avg_seconds |
| tests_shipment_board | 34 | Board endpoint shape, filters, sort, query budget |
| tests_kpi | 35 | All seven KPI helpers + endpoint smoke + cache |
| tests_status_changed_at_backfill | 4 | Migration's RunPython |
| tests_boss_analytics (added) | 11 | New task-throughput section |

Frontend has no Jest/Vitest coverage — the project doesn't have a strong frontend test pattern. TypeScript strict mode (tsc --noEmit clean) is the safety net.
