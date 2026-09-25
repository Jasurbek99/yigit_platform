"""Management command: reconcile open Task rows with their live TaskRule.

When a TaskRule is edited after Tasks have already been generated, existing
open Tasks retain the old snapshotted values (target_fields, completion_rule,
target_value, title_key). This command detects the drift and repairs it, then
re-runs the resolver so any newly-correct Tasks auto-close immediately.

Usage:
    python manage.py reconcile_tasks              # sync drift AND re-evaluate conditions
    python manage.py reconcile_tasks --create-missing  # also EMIT missing conditioned tasks
    python manage.py reconcile_tasks --dry-run    # report diffs, write nothing
    python manage.py reconcile_tasks --shipment 0201045/25  # scope to one shipment code

Idempotent: running twice on an already-reconciled dataset produces
``tasks_synced=0, tasks_resolved=0``.
"""
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction


class Command(BaseCommand):
    help = (
        'Reconcile open Task rows with their live TaskRule definition. '
        'Detects stale snapshots, updates in place, then re-runs auto-resolution.'
    )

    def add_arguments(self, parser) -> None:
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Report what would change without writing anything.',
        )
        parser.add_argument(
            '--create-missing',
            action='store_true',
            help=(
                'Also EMIT a task for every conditioned rule that matches a scanned '
                'shipment but has no task row. Off by default: a routine run must never '
                'retroactively gate a shipment (see the tasks.set_border_point decision '
                'in seed_task_rules.py).'
            ),
        )
        parser.add_argument(
            '--shipment',
            metavar='SHIPMENT_CODE',
            default=None,
            help='Scope reconciliation to a single shipment by shipment code.',
        )

    def _report_conditions(self, shipments, dry_run: bool, create_missing: bool) -> None:
        """Run and print the condition-re-evaluation pass.

        The second of the command's two passes. The first repairs tasks whose
        snapshot drifted from their rule; this one repairs tasks whose rule no
        longer applies to the shipment at all, because a condition field
        (is_gapy_satys, has_peregruz) was edited after step entry.

        All output is ASCII-only, matching the drift pass -- see the comment in
        handle() about cp1252 consoles.
        """
        from apps.export.services.task_rules import reconcile_conditions_for_shipments

        summary = reconcile_conditions_for_shipments(
            shipments=shipments, dry_run=dry_run, create_missing=create_missing,
        )
        changes = summary['changes']
        if not changes:
            self.stdout.write(self.style.SUCCESS(
                'Condition pass: no task matches a rule it should not, '
                'and none is missing.'
            ))
            return

        verb = 'would be' if dry_run else 'were'
        self.stdout.write(
            f'Condition pass ({summary["shipments_scanned"]} shipment(s) scanned) -- '
            f'{len(changes)} task(s) {verb} changed:'
        )
        for ch in changes:
            self.stdout.write(
                f'  {ch["shipment_code"]}: {ch["action"]} {ch["title_key"]}'
            )
        line = (
            f'Condition pass summary: created {summary["created"]}, '
            f'cancelled {summary["cancelled"]}, reopened {summary["reopened"]}.'
        )
        self.stdout.write(self.style.WARNING(line) if dry_run else self.style.SUCCESS(line))

    def handle(self, *args, **options) -> None:
        dry_run: bool = options['dry_run']
        shipment_code: str | None = options['shipment']
        create_missing: bool = options['create_missing']

        # Lazy imports inside handle() per task spec -- avoids any circular-import
        # risk and keeps the command fast at import time.
        from apps.export.models import Shipment
        from apps.export.services.task_rules import reconcile_open_tasks_with_rules

        shipments = None
        if shipment_code is not None:
            try:
                shipment = Shipment.objects.select_related('status').get(
                    shipment_code=shipment_code
                )
            except Shipment.DoesNotExist:
                raise CommandError(
                    f'No shipment found with shipment_code={shipment_code!r}. '
                    'Check the code and try again.'
                )
            shipments = [shipment]
            self.stdout.write(f'Scoped to shipment: {shipment_code}')

        if dry_run:
            self.stdout.write(self.style.WARNING('DRY RUN -- no Task rows will be written.'))

        if dry_run:
            summary = reconcile_open_tasks_with_rules(shipments=shipments, dry_run=True)
            # Before the drift report's early return below, so an empty drift
            # diff never hides the condition findings.
            self._report_conditions(shipments, dry_run=True, create_missing=create_missing)
        else:
            with transaction.atomic():
                summary = reconcile_open_tasks_with_rules(shipments=shipments, dry_run=False)
                self._report_conditions(shipments, dry_run=False, create_missing=create_missing)

                # Per-task detail printing is inside the atomic block so that
                # a UnicodeEncodeError during the detail dump (e.g. on a
                # cp1252 Windows console) rolls back the writes — preventing a
                # half-described, fully-applied state. Pre-flight messages and
                # the dry-run path do not need this protection. All strings
                # below are ASCII-only so the rollback path is never reached
                # in practice, but the guard is cheap to keep.
                changes = summary.get('changes', [])
                if not changes:
                    self.stdout.write(self.style.SUCCESS(
                        'No stale tasks found -- all open tasks already match their rules.'
                    ))
                    return

                changes_by_task: dict[int, list[dict]] = {}
                for change in changes:
                    changes_by_task.setdefault(change['task_id'], []).append(change)

                self.stdout.write(
                    f'Updated {summary["tasks_synced"]} task(s) across '
                    f'{summary["shipments_reresolved"]} shipment(s):'
                )
                for task_id, task_changes in changes_by_task.items():
                    first = task_changes[0]
                    self.stdout.write(
                        f'  Task {task_id} (shipment={first["shipment_code"]}, '
                        f'rule={first["rule_id"]}):'
                    )
                    for ch in task_changes:
                        self.stdout.write(
                            f'    {ch["field"]}: {ch["old"]!r} -> {ch["new"]!r}'
                        )
                self.stdout.write(self.style.SUCCESS(
                    f'\nreconcile_tasks complete: '
                    f'{summary["tasks_synced"]} tasks synced, '
                    f'{summary["shipments_reresolved"]} shipments re-resolved, '
                    f'{summary["tasks_resolved"]} tasks auto-closed.'
                ))
            return

        # Dry-run path: no DB writes, no transaction needed.
        changes = summary.get('changes', [])
        if not changes:
            self.stdout.write(self.style.SUCCESS(
                'No stale tasks found -- all open tasks already match their rules.'
            ))
            return

        # Group changes by task_id for readable per-task output.
        changes_by_task: dict[int, list[dict]] = {}
        for change in changes:
            changes_by_task.setdefault(change['task_id'], []).append(change)

        self.stdout.write(
            f'Found {len(changes_by_task)} stale task(s) across '
            f'{summary["shipments_reresolved"]} shipment(s):'
        )
        for task_id, task_changes in changes_by_task.items():
            first = task_changes[0]
            self.stdout.write(
                f'  Task {task_id} (shipment={first["shipment_code"]}, '
                f'rule={first["rule_id"]}):'
            )
            for ch in task_changes:
                self.stdout.write(
                    f'    {ch["field"]}: {ch["old"]!r} -> {ch["new"]!r}'
                )
        self.stdout.write(self.style.WARNING(
            f'\nDRY RUN summary: {len(changes_by_task)} tasks would be synced, '
            f'{summary["shipments_reresolved"]} shipments would be re-resolved.'
        ))
