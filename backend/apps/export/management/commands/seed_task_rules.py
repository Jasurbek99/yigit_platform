"""Management command: seed TaskRule rows.

Usage:
    python manage.py seed_task_rules          # idempotent upsert
    python manage.py seed_task_rules --reset  # delete all rules then re-seed

The seed set is the source of truth defined in TASK_RULES below. Rules are
keyed on (step, title_key, condition_field, condition_value). A re-run with
update_or_create picks up any edits to the seed set (e.g. a deadline_rule or
assignee_role change). Using condition in the key allows two rules to share
the same step + title_key but target different shipment variants (e.g. gapy
vs non-gapy assign_driver), without collision.

State machine v2: each step has at least one auto-resolving TaskRule whose
`target_fields` (or FIELD_EQUALS value) is the trigger for advancing to the
next status. When every non-MANUAL_DONE task on the current step is DONE,
Shipment.save() → auto_advance_if_ready() fires transition_to() for the
next step.

MANUAL_DONE rules are operational reminders only; they do NOT gate
auto-advance (per plan: "Steps with MANUAL_DONE tasks still need a human
click" was scoped to mean MANUAL_DONE tasks are exempt from the
completion check).
"""
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from apps.export.models import TaskCompletionRule, TaskRule

TASK_RULES: list[dict] = [
    # ── draft → gumruk_girish ──────────────────────────────────────────────────
    # The owner replaced this catalog 2026-09-30 (docs/Tasks.md items 5b–22,
    # spec docs/superpowers/specs/2026-09-30-prep-docs-tasks-design.md):
    # set_destination (5b) → pick_export_firms (7) + choose_truck / gapy
    # assign_driver (8) + join_supply (6, does not hold the step). The old
    # rows (set_border_point, give_documents*, start_documents_prep, transport
    # assign_driver, trigger_customs_exit) stay below with is_active=False for
    # history; in-flight shipments finish on the tasks they already have.
    # 'new_in_catalog' rows get effective_from=now() when first created, so a
    # shipment already inside that step at deploy is not given them.
    {
        'step': 'draft',
        'title_key': 'tasks.set_destination',
        'assignee_role': 'export_manager',
        'target_fields': 'country,customer,import_firm',
        'completion_rule': TaskCompletionRule.ALL_FIELDS_FILLED,
        'target_value': '',
        'deadline_rule': '24h_after_status',
        'condition_field': '',
        'condition_value': '',
    },
    {
        'step': 'draft',
        'title_key': 'tasks.pick_export_firms',
        'assignee_role': 'document_team',
        'target_fields': 'firm_splits',
        'completion_rule': TaskCompletionRule.ANY_FIELD_FILLED,
        'target_value': '',
        'deadline_rule': '24h_after_status',
        'condition_field': '',
        'condition_value': '',
        'depends_on': 'tasks.set_destination',
    },
    {
        # 6 «Ýükleme bölek birikdir» — the packing part is joined on the
        # Assignment board. Never holds the step: documents may start first.
        'step': 'draft',
        'title_key': 'tasks.join_supply',
        'assignee_role': 'export_manager',
        'target_fields': 'block_sources',
        'completion_rule': TaskCompletionRule.ANY_FIELD_FILLED,
        'target_value': '',
        'deadline_rule': '',
        'condition_field': '',
        'condition_value': '',
        'depends_on': 'tasks.set_destination',
        'gates_step': False,
        'new_in_catalog': True,
    },
    {
        # 8.1 «Maşyn saýla» — regular shipments: the export manager joins a
        # Planning trip on the Truck Board (spec 2026-09-29-transport-trips-design.md).
        # Joining writes Shipment.trip_id, which closes this task. After 5b
        # since 2026-09-30 (PREP chain).
        'step': 'draft',
        'title_key': 'tasks.choose_truck',
        'assignee_role': 'export_manager',
        'target_fields': 'trip_id',
        'completion_rule': TaskCompletionRule.ALL_FIELDS_FILLED,
        'target_value': '',
        'deadline_rule': '',
        'condition_field': 'is_gapy_satys',
        'condition_value': 'False',
        'depends_on': 'tasks.set_destination',
        'new_in_catalog': True,
    },
    {
        # Retired 2026-09-29: regular shipments get their truck from a Planning
        # trip (tasks.choose_truck above). Kept as an inactive row so the upsert
        # key still matches the existing DB row and deactivates it.
        # Was: transport team fills name + phone + plate (R23/R27/R28).
        'step': 'draft',
        'title_key': 'tasks.assign_driver',
        'assignee_role': 'transport',
        'target_fields': 'driver_name,driver_phone,truck_plate',
        'completion_rule': TaskCompletionRule.ALL_FIELDS_FILLED,
        'target_value': '',
        'deadline_rule': '24h_after_status',
        'condition_field': 'is_gapy_satys',
        'condition_value': 'False',
        'is_active': False,  # replaced 2026-09-30 (docs/Tasks.md 5b–22)
    },
    {
        # 8.2 Gapy shipments: document_team fills the transport details —
        # driver name, plate and phone (owner, 2026-09-30, docs/Tasks.md item 8;
        # was name + plate + passport). Transport is not involved in gapy
        # logistics and the driver is never a fleet driver — HARD RULE, see
        # Shipment.driver_passport_serial. Shares title_key with the old
        # transport variant; the upsert key includes condition so both rows
        # coexist without collision.
        'step': 'draft',
        'title_key': 'tasks.assign_driver',
        'assignee_role': 'document_team',
        'target_fields': 'driver_name,truck_plate,driver_phone',
        'completion_rule': TaskCompletionRule.ALL_FIELDS_FILLED,
        'target_value': '',
        'deadline_rule': '',
        'condition_field': 'is_gapy_satys',
        'condition_value': 'True',
        'depends_on': 'tasks.set_destination',
    },
    {
        # Serhet nokady — the border point the truck will cross at. Transport
        # owns the field (permission_registry TRANSPORT field list) and the
        # Sheet surfaces it at R29 as a dropdown, so there is a UI path both on
        # the Sheet and inline on the task card (TaskCardEditor.helpers.ts).
        # It is read by the TIR carnet / CMR overlay (_border_point_name() in
        # contracts/services/document_context.py), which is why it belongs on
        # `draft`, alongside document prep, rather than later in the lifecycle.
        #
        # condition is_gapy_satys=False is REQUIRED, not cosmetic: the R29 row
        # carries gapy_hidden=True, so a gapy shipment has no way to fill it and
        # an unconditional ALL_FIELDS_FILLED rule would put a permanently
        # unresolvable gating task on every gapy draft (the weight_gross lesson,
        # see tasks.fill_loading_data below). Gapy is a domestic sale — no
        # border is crossed at all.
        #
        # Gating: ALL_FIELDS_FILLED, so this joins the draft → gumruk_girish
        # gate. Per the 2026-09-23 decision this applies to NEW drafts only —
        # do NOT run `backfill_tasks` for this rule: the 69 non-gapy drafts that
        # were open when it shipped have no Task row for it and stay unblocked
        # (`is_step_trigger_satisfied` reads Task rows, not rules, and
        # `reconcile_tasks` is a mutator that never emits new tasks).
        'step': 'draft',
        'title_key': 'tasks.set_border_point',
        'assignee_role': 'transport',
        'target_fields': 'border_point',
        'completion_rule': TaskCompletionRule.ALL_FIELDS_FILLED,
        'target_value': '',
        'deadline_rule': '24h_after_status',
        'condition_field': 'is_gapy_satys',
        'condition_value': 'False',
        'is_active': False,  # replaced 2026-09-30 (docs/Tasks.md 5b–22)
    },
    {
        'step': 'draft',
        'title_key': 'tasks.give_documents',
        'assignee_role': 'transport',
        'target_fields': '',
        'completion_rule': TaskCompletionRule.MANUAL_DONE,
        'target_value': '',
        'deadline_rule': 'friday_eow',
        'condition_field': 'is_gapy_satys',
        'condition_value': 'False',
        'is_active': False,  # replaced 2026-09-30 (docs/Tasks.md 5b–22)
    },
    {
        # Gapy document handoff is owned by document_team, not export_manager.
        'step': 'draft',
        'title_key': 'tasks.give_documents_gapy',
        'assignee_role': 'document_team',
        'target_fields': '',
        'completion_rule': TaskCompletionRule.MANUAL_DONE,
        'target_value': '',
        'deadline_rule': 'friday_eow',
        'condition_field': 'is_gapy_satys',
        'condition_value': 'True',
        'is_active': False,  # replaced 2026-09-30 (docs/Tasks.md 5b–22)
    },
    {
        # V2 trigger: Customs Entry fires when Sirin marks documents_status
        # as "ready" (docs are complete and ready for customs). Previously
        # this targeted "in_progress", but operators naturally walk
        # pending → in_progress → ready, and once the value moved past
        # "in_progress" the FIELD_EQUALS check could never re-fire, leaving
        # drafts stuck even after every other draft task was DONE.
        # Replaces the v1 ALL_FIELDS_FILLED rule that also required
        # customs_clearance_planned_day.
        'step': 'draft',
        'title_key': 'tasks.start_documents_prep',
        'assignee_role': 'document_team',
        'target_fields': 'documents_status',
        'completion_rule': TaskCompletionRule.FIELD_EQUALS,
        'target_value': 'ready',
        'deadline_rule': '24h_after_status',
        'condition_field': '',
        'condition_value': '',
        'is_active': False,  # replaced 2026-09-30 (docs/Tasks.md 5b–22)
    },

    # ── gumruk_girish → gumruk_chykysh ─────────────────────────────────────────
    # DOCS chain 2026-09-30 (docs/Tasks.md 9–21b). The step advances when every
    # task here is closed; the last is docs_to_customs. The old trigger
    # (customs_exit_at, trigger_customs_exit) is inactive — customs exit now
    # closes docs_from_customs on the next step.
    {
        # 9 — closes when every firm has a contract whose agreement was downloaded (contracts registers the check), or by the button.
        'step': 'gumruk_girish',
        'title_key': 'tasks.prepare_contract',
        'assignee_role': 'document_team',
        'target_fields': '',
        'completion_rule': TaskCompletionRule.CONFIRM,
        'target_value': '',
        'deadline_rule': '',
        'condition_field': '',
        'condition_value': '',
        'depends_on': 'tasks.pick_export_firms',
        'new_in_catalog': True,
    },
    {
        # 10 — brut/net: a packing template is chosen.
        'step': 'gumruk_girish',
        'title_key': 'tasks.fill_gross_net',
        'assignee_role': 'document_team',
        'target_fields': 'packing_template',
        'completion_rule': TaskCompletionRule.ALL_FIELDS_FILLED,
        'target_value': '',
        'deadline_rule': '',
        'condition_field': '',
        'condition_value': '',
        'depends_on': 'tasks.pick_export_firms',
        'new_in_catalog': True,
    },
    {
        # 11 «Taýýarladym» — also sets R6 «Resminamalar 13:00» to in_progress (task_chain effect).
        'step': 'gumruk_girish',
        'title_key': 'tasks.prepare_transport_docs',
        'assignee_role': 'document_team',
        'target_fields': '',
        'completion_rule': TaskCompletionRule.CONFIRM,
        'target_value': '',
        'deadline_rule': '',
        'condition_field': '',
        'condition_value': '',
        'depends_on': 'tasks.choose_truck,tasks.assign_driver',
        'new_in_catalog': True,
    },
    {
        # 12–15, 17: print tasks close on download (ShipmentDocumentDownload) or by the button.
        'step': 'gumruk_girish',
        'title_key': 'tasks.print_cmr',
        'assignee_role': 'document_team',
        'target_fields': '',
        'completion_rule': TaskCompletionRule.CONFIRM,
        'target_value': '',
        'deadline_rule': '',
        'condition_field': '',
        'condition_value': '',
        'depends_on': 'tasks.prepare_contract,tasks.fill_gross_net,tasks.prepare_transport_docs',
        'new_in_catalog': True,
    },
    {
        'step': 'gumruk_girish',
        'title_key': 'tasks.print_tir',
        'assignee_role': 'document_team',
        'target_fields': '',
        'completion_rule': TaskCompletionRule.CONFIRM,
        'target_value': '',
        'deadline_rule': '',
        'condition_field': '',
        'condition_value': '',
        'depends_on': 'tasks.prepare_transport_docs',
        'new_in_catalog': True,
    },
    {
        'step': 'gumruk_girish',
        'title_key': 'tasks.print_ct1',
        'assignee_role': 'document_team',
        'target_fields': '',
        'completion_rule': TaskCompletionRule.CONFIRM,
        'target_value': '',
        'deadline_rule': '',
        'condition_field': '',
        'condition_value': '',
        'depends_on': 'tasks.print_cmr',
        'new_in_catalog': True,
    },
    {
        'step': 'gumruk_girish',
        'title_key': 'tasks.print_phyto',
        'assignee_role': 'document_team',
        'target_fields': '',
        'completion_rule': TaskCompletionRule.CONFIRM,
        'target_value': '',
        'deadline_rule': '',
        'condition_field': '',
        'condition_value': '',
        'depends_on': 'tasks.print_ct1',
        'new_in_catalog': True,
    },
    {
        'step': 'gumruk_girish',
        'title_key': 'tasks.ct1_phyto_sent',
        'assignee_role': 'document_team',
        'target_fields': '',
        'completion_rule': TaskCompletionRule.CONFIRM,
        'target_value': '',
        'deadline_rule': '',
        'condition_field': '',
        'condition_value': '',
        'depends_on': 'tasks.print_ct1,tasks.print_phyto',
        'new_in_catalog': True,
    },
    {
        'step': 'gumruk_girish',
        'title_key': 'tasks.print_customs_request',
        'assignee_role': 'document_team',
        'target_fields': '',
        'completion_rule': TaskCompletionRule.CONFIRM,
        'target_value': '',
        'deadline_rule': '',
        'condition_field': '',
        'condition_value': '',
        'depends_on': 'tasks.print_cmr',
        'new_in_catalog': True,
    },
    {
        'step': 'gumruk_girish',
        'title_key': 'tasks.docs_to_stamp',
        'assignee_role': 'document_team',
        'target_fields': '',
        'completion_rule': TaskCompletionRule.CONFIRM,
        'target_value': '',
        'deadline_rule': '',
        'condition_field': '',
        'condition_value': '',
        'depends_on': 'tasks.ct1_phyto_sent,tasks.print_customs_request',
        'new_in_catalog': True,
    },
    {
        'step': 'gumruk_girish',
        'title_key': 'tasks.docs_from_stamp',
        'assignee_role': 'document_team',
        'target_fields': '',
        'completion_rule': TaskCompletionRule.CONFIRM,
        'target_value': '',
        'deadline_rule': '',
        'condition_field': '',
        'condition_value': '',
        'depends_on': 'tasks.docs_to_stamp',
        'new_in_catalog': True,
    },
    {
        # 20 «Awans ber» — an advance is linked to the shipment.
        'step': 'gumruk_girish',
        'title_key': 'tasks.give_advance',
        'assignee_role': 'finansist',
        # A property: after a truck-change rollback only a NEW advance counts.
        'target_fields': 'has_current_advance',
        'completion_rule': TaskCompletionRule.ANY_FIELD_FILLED,
        'target_value': '',
        'deadline_rule': '',
        'condition_field': '',
        'condition_value': '',
        'depends_on': '',
        'new_in_catalog': True,
    },
    {
        'step': 'gumruk_girish',
        'title_key': 'tasks.prepare_declaration',
        'assignee_role': 'document_team',
        'target_fields': '',
        'completion_rule': TaskCompletionRule.CONFIRM,
        'target_value': '',
        'deadline_rule': '',
        'condition_field': '',
        'condition_value': '',
        'depends_on': 'tasks.docs_from_stamp',
        'new_in_catalog': True,
    },
    {
        # 21b «Gümrüge ugradyldy» — the last task of the step.
        'step': 'gumruk_girish',
        'title_key': 'tasks.docs_to_customs',
        'assignee_role': 'document_team',
        'target_fields': '',
        'completion_rule': TaskCompletionRule.CONFIRM,
        'target_value': '',
        'deadline_rule': '',
        'condition_field': '',
        'condition_value': '',
        'depends_on': 'tasks.give_advance,tasks.prepare_declaration',
        'new_in_catalog': True,
    },
    {
        'step': 'gumruk_girish',
        'title_key': 'tasks.trigger_customs_exit',
        'assignee_role': 'document_team',
        'target_fields': 'customs_exit_at',
        'completion_rule': TaskCompletionRule.ALL_FIELDS_FILLED,
        'target_value': '',
        'deadline_rule': '13:00_same_day',
        'condition_field': '',
        'condition_value': '',
        'is_active': False,  # replaced 2026-09-30 (docs/Tasks.md 5b–22)
    },

    # ── gumruk_chykysh → yuklenme ──────────────────────────────────────────────
    # Trigger: loading_started_at filled by Soltanmyrat (R19).
    {
        # 22 «Gümrükden geldi» — customs exit; sets R6 to the «Gümrükden geldi» option (task_chain effect).
        'step': 'gumruk_chykysh',
        'title_key': 'tasks.docs_from_customs',
        'assignee_role': 'document_team',
        'target_fields': 'customs_exit_at',
        'completion_rule': TaskCompletionRule.ALL_FIELDS_FILLED,
        'target_value': '',
        'deadline_rule': '',
        'condition_field': '',
        'condition_value': '',
        'depends_on': '',
        'new_in_catalog': True,
    },
    {
        'step': 'gumruk_chykysh',
        'title_key': 'tasks.trigger_loading_start',
        # Soltanmyrat holds loading_dept_head (not warehouse_chief) since the
        # May 2026 role change; his 5 deputies see this via task_roles_for().
        'assignee_role': 'loading_dept_head',
        'target_fields': 'loading_started_at',
        'completion_rule': TaskCompletionRule.ALL_FIELDS_FILLED,
        'target_value': '',
        'deadline_rule': '24h_after_status',
        'condition_field': '',
        'condition_value': '',
    },

    # ── yuklenme → yola_chykdy ─────────────────────────────────────────────────
    # Operational task: fill loading data + quality certs. Trigger task:
    # departed_at fills (Mergen, R21).
    {
        # weight_gross is intentionally NOT a trigger field: it is not surfaced
        # on the Sheet (no row in DEFAULT_SHEET_ROWS), so operators have no UI
        # path to fill it. weight_net is the operational ground truth for the
        # loading step.
        'step': 'yuklenme',
        'title_key': 'tasks.fill_loading_data',
        # The loading department owns this, not warehouse_chief — the latter is a
        # leftover of the May 2026 role change (confirmed 2026-07-16: no real user
        # holds it). Deputies see it via task_roles_for().
        'assignee_role': 'loading_dept_head',
        'target_fields': 'shipment_code,block_sources,variety,weight_net',
        'completion_rule': TaskCompletionRule.ALL_FIELDS_FILLED,
        'target_value': '',
        'deadline_rule': '4h_after_status',
        'condition_field': '',
        'condition_value': '',
    },
    {
        # 26 «Ýükleme gutardy» (owner, 2026-09-30, docs/Tasks.md LOAD): the
        # loading department writes when loading ended (R20). It holds the
        # step — a truck the garawul already let out (departed_at) waits in
        # yuklenme until this is filled, then auto-advances. Gapy too.
        'step': 'yuklenme',
        'title_key': 'tasks.loading_ended',
        'assignee_role': 'loading_dept_head',
        'target_fields': 'loading_ended_at',
        'completion_rule': TaskCompletionRule.ALL_FIELDS_FILLED,
        'target_value': '',
        'deadline_rule': '',
        'condition_field': '',
        'condition_value': '',
        'new_in_catalog': True,
    },
    {
        # Quality inspection, re-enabled 2026-09-22 for the new
        # `quality_inspector` role. This rule was soft-disabled on 2026-06-06
        # (commit 84f1a98) for two reasons, both addressed here:
        #
        #   1. It was ALL_FIELDS_FILLED, so the four quality flags GATED
        #      yuklenme -> yola_chykdy and froze real trucks. It is MANUAL_DONE
        #      now: is_step_trigger_satisfied() excludes MANUAL_DONE, so this
        #      can never block a departure. Same shape, and the same reason, as
        #      tasks.submit_sales_report on yola_chykdy.
        #   2. It was assigned to greenhouse_manager, who "tracks quality docs
        #      outside the Sheet" — no owner, no UI path. `quality_inspector`
        #      owns the quality_document resource and both Sheet readings.
        #
        # `is_active` is set EXPLICITLY: the seeder builds `defaults` from this
        # dict, and no other rule declares the key, so a rule left False in the
        # DB would silently stay disabled and never generate a task.
        #
        # Trigger: filling R19 "Ýükleme başlady" (loading_started_at) resolves
        # tasks.trigger_loading_start on gumruk_chykysh, which auto-advances the
        # shipment into yuklenme — where this rule generates the task.
        #
        # The four quality.* entries are dotted paths: the task card shows them
        # read-only (fieldKeyToConfig returns null for any dotted key) and the
        # certificates are UPLOADED in the ShipmentDetail quality section.
        # They still name the booleans rather than the certificate rows on
        # purpose — the booleans are derived from the scans, so they stay an
        # honest "is this done" display, and MANUAL_DONE means nothing resolves
        # off them. The three plain
        # shipment fields are editable inline on the card.
        'step': 'yuklenme',
        'title_key': 'tasks.quality_inspection',
        'assignee_role': 'quality_inspector',
        'target_fields': (
            'quality.azyk_maglumatnama,quality.suriji_gozukdiriji,'
            'quality.hil_sertifikaty,quality.kalibrowka_analiz,'
            'transit_days,transport_temp_c,shelf_life_days'
        ),
        'completion_rule': TaskCompletionRule.MANUAL_DONE,
        'target_value': '',
        # Deliberately blank. Transit days and temperature are not knowable at
        # loading time, so any deadline would render the card permanently
        # overdue. submit_sales_report leaves it blank for the same reason.
        'deadline_rule': '',
        'condition_field': '',
        'condition_value': '',
        'is_active': True,
    },
    {
        # 27 «Ýyladyşhanadan çykdy»: the garawul marks the departure on the gate
        # (services/gate.py), which fills departed_at. This rule is the step's
        # gate; owned by garawul since 2026-09-30 (owner) — My Tasks scopes a
        # guard to his location's gate tasks, so it shows on nobody's board.
        'step': 'yuklenme',
        'title_key': 'tasks.trigger_departure',
        'assignee_role': 'garawul',
        'target_fields': 'departed_at',
        'completion_rule': TaskCompletionRule.ALL_FIELDS_FILLED,
        'target_value': '',
        'deadline_rule': '24h_after_status',
        'condition_field': '',
        'condition_value': '',
    },

    # ── yola_chykdy → serhet_gechdi ────────────────────────────────────────────
    # Trigger: border_crossed_at filled by Haltac (R30).
    {
        'step': 'yola_chykdy',
        'title_key': 'tasks.trigger_border_crossing',
        'assignee_role': 'transport',
        'target_fields': 'border_crossed_at',
        'completion_rule': TaskCompletionRule.ALL_FIELDS_FILLED,
        'target_value': '',
        'deadline_rule': '24h_after_status',
        'condition_field': '',
        'condition_value': '',
    },
    {
        # Sales-report reminder for the rep. Appears the moment the truck
        # departs (step 4), because in practice the truck sells before the
        # system status catches up — the report is fillable from yola_chykdy
        # onward. MUST be MANUAL_DONE: a field-based (auto-resolving) task
        # here would gate auto-advance and freeze the truck at step 4 until
        # the report is filled (weeks later). MANUAL_DONE tasks are exempt
        # from is_step_trigger_satisfied, so this stays a non-gating reminder.
        # It is closed explicitly by close_sales_report_task() when the rep
        # saves the SalesReport (the engine never auto-resolves MANUAL_DONE).
        'step': 'yola_chykdy',
        'title_key': 'tasks.submit_sales_report',
        'assignee_role': 'sales_rep',
        # One card from departure to the saved report (owner, 2026-09-30,
        # docs/Tasks.md item 36): it closes on the report itself, not a
        # button, and never holds a step (gates_step=False) — a sale can take
        # weeks. It replaced tasks.trigger_report_received below.
        'target_fields': 'sales_report',
        'completion_rule': TaskCompletionRule.ANY_FIELD_FILLED,
        'target_value': '',
        'deadline_rule': '',
        'condition_field': '',
        'condition_value': '',
        'gates_step': False,
    },

    # ── serhet_gechdi → dest_entry ─────────────────────────────────────────────
    # Trigger: dest_entry_at filled by Arap (R31).
    {
        'step': 'serhet_gechdi',
        'title_key': 'tasks.trigger_dest_entry',
        'assignee_role': 'sales_rep',
        'target_fields': 'dest_entry_at',
        'completion_rule': TaskCompletionRule.ALL_FIELDS_FILLED,
        'target_value': '',
        'deadline_rule': '24h_after_status',
        'condition_field': '',
        'condition_value': '',
    },

    # ── dest_entry → barysh_gumrugi ────────────────────────────────────────────
    # Trigger: customs_entry_at filled by Arap (R32).
    {
        'step': 'dest_entry',
        'title_key': 'tasks.trigger_dest_customs',
        'assignee_role': 'sales_rep',
        'target_fields': 'customs_entry_at',
        'completion_rule': TaskCompletionRule.ALL_FIELDS_FILLED,
        'target_value': '',
        'deadline_rule': '24h_after_status',
        'condition_field': '',
        'condition_value': '',
    },

    # «Peregruz barmy?» (docs/Tasks.md item 31, 2026-09-29): the sales rep must
    # answer yes/no before the truck leaves dest_entry, so the barysh_gumrugi
    # fork below is always taken on a real answer. FIELD_SET, not
    # ALL_FIELDS_FILLED — an explicit «No» (False) is an answer.
    {
        'step': 'dest_entry',
        'title_key': 'tasks.ask_peregruz',
        'assignee_role': 'sales_rep',
        'target_fields': 'has_peregruz',
        'completion_rule': TaskCompletionRule.FIELD_SET,
        'target_value': '',
        'deadline_rule': '24h_after_status',
        'condition_field': '',
        'condition_value': '',
    },

    # ── barysh_gumrugi → transshipment | bardy (CONDITIONAL FORK) ──────────────
    # has_peregruz=True: only the peregruz_date task is generated.
    # has_peregruz=False: only the arrived_at task is generated.
    # The TRANSITIONS predicate at runtime picks the right target step.
    {
        'step': 'barysh_gumrugi',
        'title_key': 'tasks.trigger_transshipment',
        'assignee_role': 'sales_rep',
        'target_fields': 'peregruz_date',
        'completion_rule': TaskCompletionRule.ALL_FIELDS_FILLED,
        'target_value': '',
        'deadline_rule': '24h_after_status',
        'condition_field': 'has_peregruz',
        'condition_value': 'True',
    },
    {
        'step': 'barysh_gumrugi',
        'title_key': 'tasks.trigger_arrival_direct',
        'assignee_role': 'sales_rep',
        'target_fields': 'arrived_at',
        'completion_rule': TaskCompletionRule.ALL_FIELDS_FILLED,
        'target_value': '',
        'deadline_rule': '24h_after_status',
        'condition_field': 'has_peregruz',
        'condition_value': 'False',
    },

    # ── transshipment → bardy ──────────────────────────────────────────────────
    # Trigger: arrived_at fills after the peregruz handoff.
    {
        'step': 'transshipment',
        'title_key': 'tasks.trigger_arrival',
        'assignee_role': 'sales_rep',
        'target_fields': 'arrived_at',
        'completion_rule': TaskCompletionRule.ALL_FIELDS_FILLED,
        'target_value': '',
        'deadline_rule': '24h_after_status',
        'condition_field': '',
        'condition_value': '',
    },

    # ── bardy → satylyar ───────────────────────────────────────────────────────
    # Operational: confirm city (legacy). Trigger: sale_started_at fills.
    {
        'step': 'bardy',
        'title_key': 'tasks.confirm_destination',
        'assignee_role': 'sales_rep',
        'target_fields': 'city',
        'completion_rule': TaskCompletionRule.ALL_FIELDS_FILLED,
        'target_value': '',
        'deadline_rule': '24h_after_status',
        'condition_field': '',
        'condition_value': '',
    },
    {
        'step': 'bardy',
        'title_key': 'tasks.trigger_sale_start',
        'assignee_role': 'sales_rep',
        'target_fields': 'sale_started_at',
        'completion_rule': TaskCompletionRule.ALL_FIELDS_FILLED,
        'target_value': '',
        'deadline_rule': '48h_after_status',
        'condition_field': '',
        'condition_value': '',
    },

    # ── satylyar → satyldy ─────────────────────────────────────────────────────
    # Trigger: sale_ended_at fills (R42).
    {
        'step': 'satylyar',
        'title_key': 'tasks.trigger_sale_end',
        'assignee_role': 'sales_rep',
        'target_fields': 'sale_ended_at',
        'completion_rule': TaskCompletionRule.ALL_FIELDS_FILLED,
        'target_value': '',
        'deadline_rule': 'friday_eow',
        'condition_field': '',
        'condition_value': '',
    },

    # ── satyldy → tamamlandy ───────────────────────────────────────────────────
    # Trigger: a SalesReport row exists for the shipment. Retargeted from the
    # old `sales_report_date` date field to the `sales_report` OneToOne reverse
    # accessor so the lifecycle closes on the actual (rich) report, not a
    # separate date picker. `_resolve_value` returns the related SalesReport on
    # existence and None when absent, so ALL_FIELDS_FILLED resolves the instant
    # a report exists. Common early-fill path (report saved mid-transit) resolves
    # this on satyldy ENTRY; late-fill resolves when close_sales_report_task()
    # triggers resolution. Pairs with the step-4 tasks.submit_sales_report
    # reminder — in the common case the report already exists by satyldy, so this
    # task resolves on entry and is never seen as open.
    {
        'step': 'satyldy',
        'title_key': 'tasks.trigger_report_received',
        'assignee_role': 'sales_rep',
        'target_fields': 'sales_report',
        'completion_rule': TaskCompletionRule.ALL_FIELDS_FILLED,
        'target_value': '',
        'deadline_rule': 'friday_eow',
        'condition_field': '',
        'condition_value': '',
        # Retired 2026-09-30: a second card for the same report. The reminder
        # above covers it, and approve_sales_report needs the report anyway.
        'is_active': False,
    },
    # «Hasabaty gözden geçir we tassykla» (docs/Tasks.md item 37, 2026-09-29):
    # the shipment closes only after an export manager (either; admin / boss /
    # director too) approves the report — POST /shipments/{id}/sales-report/approve/.
    # Approve only, no reject path. Blocks auto-advance until approved_at is set.
    {
        'step': 'satyldy',
        'title_key': 'tasks.approve_sales_report',
        'assignee_role': 'export_manager',
        'target_fields': 'sales_report.approved_at',
        'completion_rule': TaskCompletionRule.ALL_FIELDS_FILLED,
        'target_value': '',
        'deadline_rule': '',
        'condition_field': '',
        'condition_value': '',
    },
    # ── Legacy rows that were never in this file (owner, 2026-09-30) ───────────
    # Created by hand / an old seed; seeding left them ACTIVE, so they kept
    # making Mark Done cards next to the PREP/DOCS chain: send_documents_to_customs
    # duplicates 21b «Gümrüge ugradyldy», docs_back_to_office duplicates 22
    # «Gümrükden geldi», finalize_sale is covered by 36/37. Listed here inactive
    # so every seed keeps them off; `cancel_retired_duplicate_tasks` cancels
    # their open cards once.
    {
        'step': 'gumruk_girish',
        'title_key': 'tasks.send_documents_to_customs',
        'assignee_role': 'document_team',
        'target_fields': '',
        'completion_rule': TaskCompletionRule.MANUAL_DONE,
        'target_value': '',
        'deadline_rule': '13:00_same_day',
        'condition_field': '',
        'condition_value': '',
        'is_active': False,
    },
    {
        'step': 'gumruk_chykysh',
        'title_key': 'tasks.docs_back_to_office',
        'assignee_role': 'document_team',
        'target_fields': '',
        'completion_rule': TaskCompletionRule.MANUAL_DONE,
        'target_value': '',
        'deadline_rule': '24h_after_status',
        'condition_field': '',
        'condition_value': '',
        'is_active': False,
    },
    {
        'step': 'satyldy',
        'title_key': 'tasks.finalize_sale',
        'assignee_role': 'sales_rep',
        'target_fields': '',
        'completion_rule': TaskCompletionRule.MANUAL_DONE,
        'target_value': '',
        'deadline_rule': '24h_after_status',
        'condition_field': '',
        'condition_value': '',
        'is_active': False,
    },
    {
        # `hasabat` was retired in state machine v2 (merged into tamamlandy).
        'step': 'hasabat',
        'title_key': 'tasks.submit_sales_report',
        'assignee_role': 'sales_rep',
        'target_fields': '',
        'completion_rule': TaskCompletionRule.MANUAL_DONE,
        'target_value': '',
        'deadline_rule': 'friday_eow',
        'condition_field': '',
        'condition_value': '',
        'is_active': False,
    },
]


class Command(BaseCommand):
    help = 'Seed TaskRule rows. Idempotent on (step, title_key, condition_field, condition_value). Use --reset to wipe and reload.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--reset',
            action='store_true',
            help='Delete all existing TaskRule rows before seeding.',
        )

    def handle(self, *args, **options):
        with transaction.atomic():
            if options['reset']:
                deleted_count, _ = TaskRule.objects.all().delete()
                self.stdout.write(
                    self.style.WARNING(f'Deleted {deleted_count} existing TaskRule rows.')
                )

            created_count = 0
            updated_count = 0

            for rule_data in TASK_RULES:
                rule_data = dict(rule_data)
                new_in_catalog = rule_data.pop('new_in_catalog', False)
                # Upsert key includes condition so two rules sharing the same
                # step + title_key but targeting different shipment variants
                # (e.g. gapy vs non-gapy assign_driver) coexist as separate
                # rows without collision.
                key = {
                    'step': rule_data['step'],
                    'title_key': rule_data['title_key'],
                    'condition_field': rule_data.get('condition_field', ''),
                    'condition_value': rule_data.get('condition_value', ''),
                }
                defaults = {k: v for k, v in rule_data.items() if k not in key}
                _rule, created = TaskRule.objects.update_or_create(
                    **key, defaults=defaults
                )
                if created and new_in_catalog:
                    # Set once: re-runs never move it (spec 2026-09-30).
                    TaskRule.objects.filter(pk=_rule.pk).update(effective_from=timezone.now())
                if created:
                    created_count += 1
                else:
                    updated_count += 1

        total = len(TASK_RULES)

        # Rule upserts committed above. Now reconcile any open Tasks that may
        # have stale snapshots from a previous rule definition. Running AFTER
        # the atomic block so the lock is not held across the full reconcile
        # scan (which touches all active tasks + re-resolves affected shipments).
        # If reconcile fails, the rule upserts are already committed — that is
        # intentional: stale tasks are a cosmetic issue; losing rule data is not.
        from apps.export.services.task_rules import reconcile_open_tasks_with_rules  # noqa: PLC0415
        reconcile_summary = reconcile_open_tasks_with_rules()
        self.stdout.write(
            self.style.SUCCESS(
                f'seed_task_rules complete: {total} rules total '
                f'({created_count} created, {updated_count} updated).'
            )
        )
        if reconcile_summary['tasks_synced'] > 0 or reconcile_summary['tasks_resolved'] > 0:
            self.stdout.write(
                self.style.SUCCESS(
                    f'reconcile: {reconcile_summary["tasks_synced"]} tasks synced, '
                    f'{reconcile_summary["shipments_reresolved"]} shipments re-resolved, '
                    f'{reconcile_summary["tasks_resolved"]} tasks auto-closed.'
                )
            )
        else:
            self.stdout.write('reconcile: no stale tasks found.')
