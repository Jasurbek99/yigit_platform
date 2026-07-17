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

from apps.export.models import TaskCompletionRule, TaskRule

TASK_RULES: list[dict] = [
    # ── draft → gumruk_girish ──────────────────────────────────────────────────
    # Operational draft tasks (destination, firm split, driver, document
    # prep) all gate advance to gumruk_girish. The Customs Entry trigger
    # is documents_status == 'in_progress' (value-match, per user spec).
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
    },
    {
        # Non-gapy shipments: transport team fills name + phone + plate.
        # All three must be present for the task to auto-resolve (ALL_FIELDS_FILLED).
        # The Sheet writes these at R23 (truck_plate), R27 (driver_name), R28 (driver_phone).
        'step': 'draft',
        'title_key': 'tasks.assign_driver',
        'assignee_role': 'transport',
        'target_fields': 'driver_name,driver_phone,truck_plate',
        'completion_rule': TaskCompletionRule.ALL_FIELDS_FILLED,
        'target_value': '',
        'deadline_rule': '24h_after_status',
        'condition_field': 'is_gapy_satys',
        'condition_value': 'False',
    },
    {
        # Gapy shipments: document_team fills name + phone + plate (transport
        # team is not involved in gapy logistics). Shares title_key with the
        # transport variant; the upsert key includes condition so both rows
        # coexist without collision.
        'step': 'draft',
        'title_key': 'tasks.assign_driver',
        'assignee_role': 'document_team',
        'target_fields': 'driver_name,driver_phone,truck_plate',
        'completion_rule': TaskCompletionRule.ALL_FIELDS_FILLED,
        'target_value': '',
        'deadline_rule': '24h_after_status',
        'condition_field': 'is_gapy_satys',
        'condition_value': 'True',
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
    },

    # ── gumruk_girish → gumruk_chykysh ─────────────────────────────────────────
    # Trigger: customs_exit_at filled by Sirin (R25).
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
    },

    # ── gumruk_chykysh → yuklenme ──────────────────────────────────────────────
    # Trigger: loading_started_at filled by Soltanmyrat (R19).
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
        'step': 'yuklenme',
        'title_key': 'tasks.trigger_departure',
        'assignee_role': 'document_team',
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
        'target_fields': '',
        'completion_rule': TaskCompletionRule.MANUAL_DONE,
        'target_value': '',
        'deadline_rule': '',
        'condition_field': '',
        'condition_value': '',
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
