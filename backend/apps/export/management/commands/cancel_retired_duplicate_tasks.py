"""Management command: cancel the open cards of the retired duplicate rules.

Three legacy rules were never in seed_task_rules, so seeding left them active
and they kept making Mark Done cards next to the PREP/DOCS chain (owner,
2026-09-30): send_documents_to_customs (≈ 21b), docs_back_to_office (≈ 22),
finalize_sale (covered by 36/37). The seed now lists them inactive; this
cancels their OPEN / IN_PROGRESS / BLOCKED tasks once, reason
RULE_DEACTIVATED (never reopened). DONE tasks and closed seasons are untouched.
Only these three: other retired rules' open tasks are in-flight shipments'
gates and must stay.

Also the report card's old step-4 rule (owner, 2026-10-01): it moved from
yola_chykdy to satylyar, so a truck not selling yet drops its old card and gets
the new one when the sale starts. A truck already selling keeps its card.

Usage:
    python manage.py cancel_retired_duplicate_tasks --dry-run
    python manage.py cancel_retired_duplicate_tasks
"""
from django.core.management.base import BaseCommand

from django.db.models import Q

from apps.export.models import Task, TaskCancelReason, TaskState

RETIRED_DUPLICATES = ('tasks.send_documents_to_customs', 'tasks.docs_back_to_office', 'tasks.finalize_sale')
OLD_REPORT_CARD = Q(rule__step='yola_chykdy', rule__title_key='tasks.submit_sales_report')
BEFORE_SALE = ('yola_chykdy', 'serhet_gechdi', 'dest_entry', 'barysh_gumrugi', 'transshipment', 'bardy')


class Command(BaseCommand):
    help = 'Cancel the open tasks of the retired duplicate rules (send_documents_to_customs, docs_back_to_office, finalize_sale).'

    def add_arguments(self, parser) -> None:
        parser.add_argument('--dry-run', action='store_true', help='Report only, write nothing.')

    def handle(self, *args, **options) -> None:
        tasks = Task.objects.filter(
            Q(rule__title_key__in=RETIRED_DUPLICATES)
            | (OLD_REPORT_CARD & Q(shipment__status__code__in=BEFORE_SALE)),
            rule__is_active=False,
            state__in=[TaskState.OPEN, TaskState.IN_PROGRESS, TaskState.BLOCKED],
            shipment__season__closed_at__isnull=True,
        )
        count = tasks.count()
        if options['dry_run']:
            self.stdout.write(f'[dry run] would cancel {count} task(s)')
            return
        cancelled = tasks.update(state=TaskState.CANCELLED, cancelled_reason=TaskCancelReason.RULE_DEACTIVATED)
        self.stdout.write(f'cancelled {cancelled} task(s)')
