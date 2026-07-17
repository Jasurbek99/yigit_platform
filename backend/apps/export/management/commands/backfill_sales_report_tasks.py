"""Management command: backfill the step-4 sales-report reminder task.

Two jobs, both idempotent and both previewable with --dry-run:

  1. Reminder backfill — the `tasks.submit_sales_report` rule lives on step
     `yola_chykdy` (step 4). The task engine only generates tasks on transition
     INTO a step, so shipments that already departed (step 4+) before this rule
     existed never got one. This creates the reminder for every non-terminal,
     non-deleted shipment at step 4+ that still lacks a SalesReport and does not
     already have the reminder task.

  2. Satyldy advance — the `satyldy → tamamlandy` trigger was retargeted from
     the `sales_report_date` date field to the `sales_report` OneToOne (report
     existence). `seed_task_rules` reconcile marks the retargeted satyldy tasks
     DONE for shipments that already have a report, but reconcile does NOT
     auto-advance. This advances those satyldy shipments to `tamamlandy` so they
     are not left resolved-but-stuck.

Run seed_task_rules FIRST (it loads the new rule and retargets satyldy), then:

    python manage.py backfill_sales_report_tasks --dry-run   # preview
    python manage.py backfill_sales_report_tasks             # apply
    python manage.py backfill_sales_report_tasks --limit 20  # small batch
    python manage.py backfill_sales_report_tasks --skip-advance  # reminders only
"""
from django.core.management.base import BaseCommand
from django.db import transaction

from apps.core.models import User
from apps.export.models import Shipment, Task, TaskRule, TaskState

REMINDER_TITLE_KEY = 'tasks.submit_sales_report'
REMINDER_STEP = 'yola_chykdy'
TERMINAL_CODES = ('tamamlandy', 'cancelled')


class Command(BaseCommand):
    help = (
        'Backfill the step-4 sales-report reminder task for departed shipments '
        'and advance satyldy shipments that already have a report. Idempotent. '
        'Run seed_task_rules first.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Report counts without creating tasks or advancing shipments.',
        )
        parser.add_argument(
            '--limit',
            type=int,
            default=None,
            help='Process at most N shipments per phase (testing on a small batch).',
        )
        parser.add_argument(
            '--skip-advance',
            action='store_true',
            help='Only create reminder tasks; do not advance satyldy shipments.',
        )

    def handle(self, *args, **options):
        dry_run: bool = options['dry_run']
        limit: int | None = options['limit']
        skip_advance: bool = options['skip_advance']

        if dry_run:
            self.stdout.write(self.style.WARNING('DRY RUN — no changes will be written.'))

        self._backfill_reminders(dry_run, limit)
        if not skip_advance:
            self._advance_satyldy(dry_run, limit)

    # ── Phase 1: create step-4 reminder tasks ──────────────────────────────────
    def _backfill_reminders(self, dry_run: bool, limit: int | None) -> None:
        rule = TaskRule.objects.filter(
            step=REMINDER_STEP, title_key=REMINDER_TITLE_KEY, is_active=True,
        ).first()
        if rule is None:
            self.stdout.write(self.style.ERROR(
                f'No active TaskRule {REMINDER_TITLE_KEY!r} on step {REMINDER_STEP!r}. '
                'Run `python manage.py seed_task_rules` first.'
            ))
            return

        qs = (
            Shipment.objects
            .select_related('status')
            .filter(deleted_at__isnull=True, is_archived=False, status__step_order__gte=4)
            .exclude(status__code__in=TERMINAL_CODES)
            .filter(sales_report__isnull=True)
            .exclude(tasks__title_key=REMINDER_TITLE_KEY)
            .order_by('id')
        )
        if limit is not None:
            qs = qs[:limit]

        shipments = list(qs)
        if dry_run:
            self.stdout.write(self.style.SUCCESS(
                f'Reminders: would create {len(shipments)} task(s).'
            ))
            return

        created = 0
        for shipment in shipments:
            with transaction.atomic():
                Task.objects.create(
                    shipment=shipment,
                    step=REMINDER_STEP,
                    rule=rule,
                    title_key=rule.title_key,
                    assignee_role=rule.assignee_role,
                    target_fields=rule.target_fields,
                    completion_rule=rule.completion_rule,
                    target_value=rule.target_value,
                    deadline=None,
                    deadline_rule=rule.deadline_rule,
                    state=TaskState.OPEN,
                )
            created += 1

        self.stdout.write(self.style.SUCCESS(
            f'Reminders: created {created} task(s).'
        ))

    # ── Phase 2: advance satyldy shipments that already have a report ──────────
    def _advance_satyldy(self, dry_run: bool, limit: int | None) -> None:
        qs = (
            Shipment.objects
            .select_related('status')
            .filter(
                deleted_at__isnull=True, is_archived=False,
                status__code='satyldy', sales_report__isnull=False,
            )
            .order_by('id')
        )
        if limit is not None:
            qs = qs[:limit]

        shipments = list(qs)
        if dry_run:
            self.stdout.write(self.style.SUCCESS(
                f'Advance: would advance {len(shipments)} satyldy shipment(s) to tamamlandy.'
            ))
            return

        actor = User.objects.filter(is_superuser=True).order_by('id').first()
        if actor is None:
            self.stdout.write(self.style.ERROR(
                'Advance: no superuser found to credit the transition — skipped.'
            ))
            return

        from apps.export.services.shipment import transition_to

        advanced = 0
        for shipment in shipments:
            try:
                with transaction.atomic():
                    transition_to(
                        shipment, 'tamamlandy', user=actor,
                        comment='Backfill: sales report exists',
                        is_auto=True, notify=False,
                    )
                advanced += 1
            except ValueError as exc:
                self.stdout.write(self.style.WARNING(
                    f'  {shipment.shipment_code}: skipped ({exc})'
                ))

        self.stdout.write(self.style.SUCCESS(
            f'Advance: advanced {advanced} shipment(s) to tamamlandy.'
        ))
