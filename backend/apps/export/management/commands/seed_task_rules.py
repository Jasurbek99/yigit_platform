"""Management command: seed TaskRule rows.

Usage:
    python manage.py seed_task_rules          # idempotent upsert
    python manage.py seed_task_rules --reset  # delete all rules then re-seed

The seed set is the source of truth defined in TASK_RULES below. Rules are
keyed on (step, title_key). A re-run with update_or_create picks up any
edits to the seed set (e.g. a deadline_rule change).
"""
from django.core.management.base import BaseCommand
from django.db import transaction

from apps.export.models import TaskCompletionRule, TaskRule

# Source of truth for the initial TaskRule set (plan §B7).
# Each dict maps directly to TaskRule fields. Empty string for condition
# means unconditional (always match).
TASK_RULES: list[dict] = [
    # ── draft (step 0: shipment created, no status yet / pre-loading) ────────
    {
        'step': 'draft',
        'title_key': 'tasks.set_destination',
        'assignee_role': 'export_manager',
        'target_fields': 'country,customer,import_firm',
        'completion_rule': TaskCompletionRule.ALL_FIELDS_FILLED,
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
        'deadline_rule': '24h_after_status',
        'condition_field': '',
        'condition_value': '',
    },
    {
        'step': 'draft',
        'title_key': 'tasks.assign_driver',
        'assignee_role': 'transport',
        'target_fields': 'driver_id',
        'completion_rule': TaskCompletionRule.ALL_FIELDS_FILLED,
        'deadline_rule': '24h_after_status',
        'condition_field': 'is_gapy_satys',
        'condition_value': 'False',
    },
    {
        'step': 'draft',
        'title_key': 'tasks.give_documents',
        'assignee_role': 'transport',
        'target_fields': '',
        'completion_rule': TaskCompletionRule.MANUAL_DONE,
        'deadline_rule': 'friday_eow',
        'condition_field': 'is_gapy_satys',
        'condition_value': 'False',
    },
    {
        'step': 'draft',
        'title_key': 'tasks.give_documents_gapy',
        'assignee_role': 'export_manager',
        'target_fields': '',
        'completion_rule': TaskCompletionRule.MANUAL_DONE,
        'deadline_rule': 'friday_eow',
        'condition_field': 'is_gapy_satys',
        'condition_value': 'True',
    },
    {
        'step': 'draft',
        'title_key': 'tasks.start_documents_prep',
        'assignee_role': 'document_team',
        'target_fields': 'documents_status,customs_clearance_planned_day',
        'completion_rule': TaskCompletionRule.ALL_FIELDS_FILLED,
        'deadline_rule': '24h_after_status',
        'condition_field': '',
        'condition_value': '',
    },
    # ── yuklenme (loading) ────────────────────────────────────────────────────
    {
        'step': 'yuklenme',
        'title_key': 'tasks.fill_loading_data',
        'assignee_role': 'warehouse_chief',
        'target_fields': 'cargo_code,block_sources,variety,weight_net,weight_gross',
        'completion_rule': TaskCompletionRule.ALL_FIELDS_FILLED,
        'deadline_rule': '4h_after_status',
        'condition_field': '',
        'condition_value': '',
    },
    {
        'step': 'yuklenme',
        'title_key': 'tasks.quality_inspection',
        'assignee_role': 'greenhouse_manager',
        'target_fields': (
            'quality.azyk_maglumatnama,'
            'quality.suriji_gozukdiriji,'
            'quality.hil_sertifikaty,'
            'quality.kalibrowka_analiz'
        ),
        'completion_rule': TaskCompletionRule.ALL_FIELDS_FILLED,
        'deadline_rule': '4h_after_status',
        'condition_field': '',
        'condition_value': '',
    },
    # ── gumruk_girish (customs entry) ─────────────────────────────────────────
    {
        'step': 'gumruk_girish',
        'title_key': 'tasks.send_documents_to_customs',
        'assignee_role': 'document_team',
        'target_fields': '',
        'completion_rule': TaskCompletionRule.MANUAL_DONE,
        'deadline_rule': '13:00_same_day',
        'condition_field': '',
        'condition_value': '',
    },
    # ── gumruk_chykysh (customs exit) ─────────────────────────────────────────
    {
        'step': 'gumruk_chykysh',
        'title_key': 'tasks.docs_back_to_office',
        'assignee_role': 'document_team',
        'target_fields': '',
        'completion_rule': TaskCompletionRule.MANUAL_DONE,
        'deadline_rule': '24h_after_status',
        'condition_field': '',
        'condition_value': '',
    },
    # ── bardy (arrived at destination) ────────────────────────────────────────
    {
        'step': 'bardy',
        'title_key': 'tasks.confirm_destination',
        'assignee_role': 'sales_rep',
        'target_fields': 'city',
        'completion_rule': TaskCompletionRule.ALL_FIELDS_FILLED,
        'deadline_rule': '24h_after_status',
        'condition_field': '',
        'condition_value': '',
    },
    # ── satyldy (sold) ────────────────────────────────────────────────────────
    {
        'step': 'satyldy',
        'title_key': 'tasks.finalize_sale',
        'assignee_role': 'sales_rep',
        'target_fields': '',
        'completion_rule': TaskCompletionRule.MANUAL_DONE,
        'deadline_rule': '24h_after_status',
        'condition_field': '',
        'condition_value': '',
    },
    # ── hasabat (report) ──────────────────────────────────────────────────────
    {
        'step': 'hasabat',
        'title_key': 'tasks.submit_sales_report',
        'assignee_role': 'sales_rep',
        'target_fields': '',
        'completion_rule': TaskCompletionRule.MANUAL_DONE,
        'deadline_rule': 'friday_eow',
        'condition_field': '',
        'condition_value': '',
    },
]


class Command(BaseCommand):
    help = 'Seed TaskRule rows. Idempotent on (step, title_key). Use --reset to wipe and reload.'

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
                key = {
                    'step': rule_data['step'],
                    'title_key': rule_data['title_key'],
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
        self.stdout.write(
            self.style.SUCCESS(
                f'seed_task_rules complete: {total} rules total '
                f'({created_count} created, {updated_count} updated).'
            )
        )
