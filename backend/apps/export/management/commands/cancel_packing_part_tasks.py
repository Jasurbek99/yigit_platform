"""Management command: cancel the tasks packing parts got before 2026-09-29.

A draft with no destination (the packing part) carries no tasks since
2026-09-29 (task_rules._rule_applies). Drafts created before that got every
draft-step task at creation; this cancels the active ones, reason
RULE_MISMATCH, so they reopen if a destination is later set on the truck.
DONE tasks are untouched.

Usage:
    python manage.py cancel_packing_part_tasks --dry-run
    python manage.py cancel_packing_part_tasks
"""
from django.core.management.base import BaseCommand
from django.db import transaction

from apps.export.models import Shipment, Task, TaskState
from apps.export.services.task_rules import sync_draft_tasks_with_destination


class Command(BaseCommand):
    help = 'Cancel the active draft-step tasks on drafts that have no destination.'

    def add_arguments(self, parser) -> None:
        parser.add_argument('--dry-run', action='store_true', help='Report only, write nothing.')

    def handle(self, *args, **options) -> None:
        active_states = [TaskState.OPEN, TaskState.IN_PROGRESS, TaskState.BLOCKED]
        shipments = list(
            Shipment.objects.filter(
                status__code='draft',
                country__isnull=True,
                customer__isnull=True,
                season__closed_at__isnull=True,
                tasks__step='draft',
                tasks__state__in=active_states,
            ).distinct().select_related('status')
        )
        task_count = Task.objects.filter(
            shipment__in=shipments, step='draft', state__in=active_states,
        ).count()

        if options['dry_run']:
            self.stdout.write(
                f'[dry run] would cancel {task_count} task(s) on {len(shipments)} draft(s)'
            )
            return

        with transaction.atomic():
            cancelled = sum(
                len(sync_draft_tasks_with_destination(s)['cancelled']) for s in shipments
            )
        self.stdout.write(f'cancelled {cancelled} task(s) on {len(shipments)} draft(s)')
