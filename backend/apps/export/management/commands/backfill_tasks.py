"""Management command: backfill Tasks for existing Shipments.

For each shipment, calls generate_tasks_for_status(shipment, shipment.status.code).
The engine is idempotent — it skips (shipment, rule) pairs that already have a Task.
Re-running this command is safe.

Usage:
    python manage.py backfill_tasks                  # process all shipments
    python manage.py backfill_tasks --dry-run        # list rules without writing
    python manage.py backfill_tasks --limit 10       # process at most 10 shipments
"""
from django.core.management.base import BaseCommand
from django.db import transaction

from apps.export.models import Shipment, TaskRule
from apps.export.services.task_rules import generate_tasks_for_status


class Command(BaseCommand):
    help = (
        'Backfill Tasks for existing Shipments based on their current status. '
        'Idempotent: skips rules that already have a Task on a shipment.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='List candidate rules per shipment without creating any Task rows.',
        )
        parser.add_argument(
            '--limit',
            type=int,
            default=None,
            help='Process at most N shipments (useful for testing on a small batch).',
        )

    def handle(self, *args, **options):
        dry_run: bool = options['dry_run']
        limit: int | None = options['limit']

        qs = (
            Shipment.objects
            .select_related('status')
            .filter(status__isnull=False)
            .order_by('id')
        )
        if limit is not None:
            qs = qs[:limit]

        shipments = list(qs)
        total_shipments = len(shipments)
        total_tasks_created = 0
        total_tasks_skipped = 0

        # Pre-fetch all active rules grouped by step so we don't issue one
        # TaskRule query per shipment (potential N+1 across thousands of rows).
        rules_by_step: dict[str, list[TaskRule]] = {}
        for rule in TaskRule.objects.filter(is_active=True):
            rules_by_step.setdefault(rule.step, []).append(rule)

        if dry_run:
            self.stdout.write(
                self.style.WARNING('DRY RUN — no Task rows will be written.')
            )

        for shipment in shipments:
            status_code = shipment.status.code
            rules = rules_by_step.get(status_code, [])
            rule_count = len(rules)

            if dry_run:
                self.stdout.write(
                    f'  {shipment.cargo_code} [{status_code}]: '
                    f'{rule_count} candidate rules'
                )
                for rule in rules:
                    self.stdout.write(
                        f'    rule {rule.id}: {rule.title_key} -> {rule.assignee_role}'
                    )
                continue

            # Real run: generate_tasks_for_status is idempotent.
            # Pass the pre-fetched rules to skip the per-shipment query.
            with transaction.atomic():
                created = generate_tasks_for_status(shipment, status_code, rules=rules)

            skipped = rule_count - len(created)
            total_tasks_created += len(created)
            total_tasks_skipped += skipped

            if created:
                self.stdout.write(
                    f'  {shipment.cargo_code}: created {len(created)} tasks'
                    + (f', skipped {skipped}' if skipped else '')
                )

        if dry_run:
            self.stdout.write(
                self.style.SUCCESS(
                    f'backfill_tasks DRY RUN: {total_shipments} shipments examined.'
                )
            )
        else:
            self.stdout.write(
                self.style.SUCCESS(
                    f'backfill_tasks complete: {total_shipments} shipments processed, '
                    f'{total_tasks_created} tasks created, '
                    f'{total_tasks_skipped} already existed (skipped).'
                )
            )
