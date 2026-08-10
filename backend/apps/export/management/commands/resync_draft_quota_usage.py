"""Backfill: correct kg_used on existing DRAFT QuotaUsageRecord rows.

Draft usage rows created before the "kg_used mirrors the firm split weight"
change carry the old flat TruckSplitDefault constant (e.g. 8888). This command
rewrites each draft row's kg_used to its shipment's matching
ShipmentFirmSplit.weight_kg — in place: same row id, status stays 'draft'
(waiting for approve), created_by / usage_date untouched.

Only DRAFT rows are touched. Approved rows are owned by the document team and
are never modified. Rows with no shipment (historical imports) or with no
matching firm split are reported and left as-is.

Usage:
    python manage.py resync_draft_quota_usage --dry-run
    python manage.py resync_draft_quota_usage --date-from 2026-06-01 --date-to 2026-06-30 --dry-run
    python manage.py resync_draft_quota_usage --date-from 2026-06-01 --date-to 2026-06-30
"""
from __future__ import annotations

from datetime import datetime

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.export.models import QuotaUsageRecord, ShipmentFirmSplit
from apps.export.services.quota_sync import invalidate_quota_caches


class Command(BaseCommand):
    help = "Correct kg_used on existing draft QuotaUsageRecord rows to match firm-split weights."

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true', help='Report only; write nothing.')
        parser.add_argument('--date-from', help='Inclusive usage_date lower bound (YYYY-MM-DD).')
        parser.add_argument('--date-to', help='Inclusive usage_date upper bound (YYYY-MM-DD).')

    def handle(self, *args, **options):
        dry_run = options['dry_run']
        date_from = self._parse_date(options.get('date_from'))
        date_to = self._parse_date(options.get('date_to'))

        # No `status='draft'` clause. The approval step was removed 2026-08-10 and
        # every shipment-linked row is now born 'approved', so filtering on draft
        # would match nothing and this repair tool would report success having done
        # nothing at all. Shipment-linked rows are machine-generated from the splits,
        # which is exactly what makes them re-syncable; the `shipment__isnull=False`
        # clause still protects manually-entered rows.
        drafts = QuotaUsageRecord.objects.filter(shipment__isnull=False)
        if date_from:
            drafts = drafts.filter(usage_date__gte=date_from)
        if date_to:
            drafts = drafts.filter(usage_date__lte=date_to)
        drafts = drafts.order_by('usage_date', 'shipment_id')

        # One query for every relevant split → (shipment_id, export_firm_id) -> weight_kg
        shipment_ids = list(drafts.values_list('shipment_id', flat=True).distinct())
        split_weight = {
            (s_id, f_id): w
            for s_id, f_id, w in ShipmentFirmSplit.objects.filter(
                shipment_id__in=shipment_ids
            ).values_list('shipment_id', 'export_firm_id', 'weight_kg')
        }

        to_update = []
        unchanged = 0
        no_split = []
        for rec in drafts:
            weight = split_weight.get((rec.shipment_id, rec.export_firm_id))
            if weight is None or weight <= 0:
                no_split.append(rec)
                continue
            if rec.kg_used == weight:
                unchanged += 1
                continue
            self.stdout.write(
                f'  shipment={rec.shipment_id} firm={rec.export_firm_id} '
                f'{rec.usage_date}: {rec.kg_used} -> {weight}'
            )
            rec.kg_used = weight
            to_update.append(rec)

        scanned = drafts.count()
        if dry_run:
            self.stdout.write(self.style.WARNING(
                f'[DRY RUN] scanned={scanned} would_update={len(to_update)} '
                f'unchanged={unchanged} no_matching_split={len(no_split)}'
            ))
            return

        with transaction.atomic():
            QuotaUsageRecord.objects.bulk_update(to_update, ['kg_used'], batch_size=500)
        invalidate_quota_caches()

        self.stdout.write(self.style.SUCCESS(
            f'Updated {len(to_update)} draft rows '
            f'(scanned={scanned}, unchanged={unchanged}, no_matching_split={len(no_split)}).'
        ))
        if no_split:
            self.stdout.write(self.style.WARNING(
                f'{len(no_split)} draft rows had no matching firm split — left unchanged.'
            ))

    def _parse_date(self, value):
        if not value:
            return None
        try:
            return datetime.strptime(value, '%Y-%m-%d').date()
        except ValueError:
            raise CommandError(f'Invalid date "{value}" — expected YYYY-MM-DD.')
