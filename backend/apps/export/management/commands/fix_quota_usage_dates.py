"""Backfill: set draft QuotaUsageRecord.usage_date from the shipment's export code.

Draft usage rows created before the "usage_date from export code" change carry
``shipment.date`` (the creation/import day, often a single bulk date like
2026-06-09). The real date is encoded in the export code (e.g. 04JN038/26 →
4 Jun 2026). This rewrites each DRAFT auto-record's usage_date to the parsed
export-code date.

Only DRAFT rows with a shipment are touched. Approved rows are left alone.
Records whose shipment has no export code, or whose code can't be parsed, are
left on their current date and reported.

Usage:
    python manage.py fix_quota_usage_dates --dry-run
    python manage.py fix_quota_usage_dates
"""
from __future__ import annotations

from django.core.management.base import BaseCommand
from django.db import transaction

from apps.export.models import QuotaUsageRecord
from apps.export.services.export_code import parse_export_code_date
from apps.export.services.quota_sync import invalidate_quota_caches


class Command(BaseCommand):
    help = "Set draft quota usage dates from the shipment's export code."

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true', help='Report only; write nothing.')

    def handle(self, *args, **options):
        dry_run = options['dry_run']

        recs = (
            QuotaUsageRecord.objects
            # `status='draft'` dropped 2026-08-10: with the approval step gone every
            # shipment-linked row is 'approved', and this date-repair tool would
            # silently match nothing. See resync_draft_quota_usage for the same note.
            .filter(shipment__isnull=False)
            .select_related('shipment')
            .order_by('usage_date', 'shipment_id')
        )

        to_update = []
        unchanged = 0
        unparseable = 0
        for rec in recs:
            new_date = parse_export_code_date(rec.shipment.export_code)
            if new_date is None:
                unparseable += 1
                continue
            if rec.usage_date == new_date:
                unchanged += 1
                continue
            self.stdout.write(
                f'  shipment={rec.shipment_id} ({rec.shipment.export_code}): '
                f'{rec.usage_date} -> {new_date}'
            )
            rec.usage_date = new_date
            to_update.append(rec)

        scanned = recs.count()
        if dry_run:
            self.stdout.write(self.style.WARNING(
                f'[DRY RUN] scanned={scanned} would_update={len(to_update)} '
                f'unchanged={unchanged} no_parseable_code={unparseable}'
            ))
            return

        with transaction.atomic():
            QuotaUsageRecord.objects.bulk_update(to_update, ['usage_date'], batch_size=500)
        invalidate_quota_caches()

        self.stdout.write(self.style.SUCCESS(
            f'Updated {len(to_update)} draft rows '
            f'(scanned={scanned}, unchanged={unchanged}, no_parseable_code={unparseable}).'
        ))
