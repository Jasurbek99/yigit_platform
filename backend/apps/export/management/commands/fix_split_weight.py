"""One-off data correction: change a wrong firm-split weight to the right one,
and carry the draft quota usage along with it.

Some 2-firm trucks were entered with a placeholder split weight (e.g. 8888)
instead of the official 2-firm value (9000). This rewrites
ShipmentFirmSplit.weight_kg from --old-kg to --new-kg, then updates the matching
DRAFT QuotaUsageRecord.kg_used to the same value so usage keeps mirroring the
split.

Only shipments whose quota usage is ENTIRELY draft are touched. If any affected
shipment has an approved usage row, it is skipped and reported — approved quota
is owned by the document team and never rewritten here.

Usage:
    python manage.py fix_split_weight --old-kg 8888 --new-kg 9000 --dry-run
    python manage.py fix_split_weight --old-kg 8888 --new-kg 9000
"""
from __future__ import annotations

from decimal import Decimal, InvalidOperation

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.export.models import QuotaUsageRecord, ShipmentFirmSplit
from apps.export.services.quota_sync import invalidate_quota_caches


class Command(BaseCommand):
    help = "Rewrite a firm-split weight (and its draft quota usage) from one value to another."

    def add_arguments(self, parser):
        parser.add_argument('--old-kg', required=True, help='Current (wrong) weight, e.g. 8888.')
        parser.add_argument('--new-kg', required=True, help='Corrected weight, e.g. 9000.')
        parser.add_argument('--dry-run', action='store_true', help='Report only; write nothing.')

    def handle(self, *args, **options):
        old_kg = self._dec(options['old_kg'])
        new_kg = self._dec(options['new_kg'])
        dry_run = options['dry_run']

        splits = ShipmentFirmSplit.objects.filter(weight_kg=old_kg)
        ship_ids = sorted(set(splits.values_list('shipment_id', flat=True)))

        approved_ships = set(
            QuotaUsageRecord.objects.filter(
                shipment_id__in=ship_ids, status='approved'
            ).values_list('shipment_id', flat=True)
        )
        safe_ships = [s for s in ship_ids if s not in approved_ships]

        splits_to_fix = splits.filter(shipment_id__in=safe_ships)
        usage_to_fix = QuotaUsageRecord.objects.filter(
            shipment_id__in=safe_ships, status='draft', kg_used=old_kg,
        )

        n_splits = splits_to_fix.count()
        n_usage = usage_to_fix.count()

        self.stdout.write(
            f'{old_kg} -> {new_kg}: {len(ship_ids)} shipment(s) with an old-weight split; '
            f'{len(safe_ships)} safe (draft-only), {len(approved_ships)} skipped (have approved usage).'
        )
        self.stdout.write(f'  firm splits to update: {n_splits}')
        self.stdout.write(f'  draft usage rows to update: {n_usage}')

        if dry_run:
            self.stdout.write(self.style.WARNING('[DRY RUN] nothing written.'))
            if approved_ships:
                self.stdout.write(self.style.WARNING(
                    f'  skipped shipment ids (approved usage): {sorted(approved_ships)}'
                ))
            return

        with transaction.atomic():
            splits_to_fix.update(weight_kg=new_kg)
            usage_to_fix.update(kg_used=new_kg)
        invalidate_quota_caches()

        self.stdout.write(self.style.SUCCESS(
            f'Updated {n_splits} firm splits and {n_usage} draft usage rows to {new_kg}.'
        ))
        if approved_ships:
            self.stdout.write(self.style.WARNING(
                f'Skipped {len(approved_ships)} shipment(s) with approved usage: {sorted(approved_ships)}'
            ))

    def _dec(self, value):
        try:
            return Decimal(value)
        except (InvalidOperation, TypeError):
            raise CommandError(f'Invalid decimal: {value!r}')
