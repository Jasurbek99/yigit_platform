"""Normalize existing ShipmentBlockSource rows to parent-block grain.

The weekly plan (HarvestDayEntry) is keyed on top-level blocks, so sub-block
block_sources (OD/OG, F1/F2) silently miss `rollup_actuals_for_date`. This
command rewrites any shipment that has sub-block sources to parent grain,
merging duplicates (F1+F2 -> F, weights summed). Dry-run by default; pass
--apply to write.
"""
from django.core.management.base import BaseCommand

from apps.core.models import GreenhouseBlock
from apps.export.models import Shipment, ShipmentBlockSource
from apps.export.services.block_sources import (
    build_block_parent_map,
    merge_to_parent,
    write_block_sources,
)


class Command(BaseCommand):
    help = 'Normalize sub-block block_sources to parent grain (weekly-plan fix).'

    def add_arguments(self, parser):
        parser.add_argument(
            '--apply', action='store_true',
            help='Write changes. Without this flag the command only previews (dry-run).',
        )

    def handle(self, *args, **opts):
        apply = opts['apply']
        parent_map = build_block_parent_map()
        code_map = {b.id: b.code for b in GreenhouseBlock.objects.all()}

        sub_ids = [bid for bid, pid in parent_map.items() if pid != bid]
        if not sub_ids:
            self.stdout.write('No sub-blocks exist; nothing to normalize.')
            return

        shipment_ids = list(
            ShipmentBlockSource.objects.filter(block_id__in=sub_ids)
            .values_list('shipment_id', flat=True).distinct()
        )
        self.stdout.write(
            f'{len(shipment_ids)} shipment(s) have sub-block block_sources.'
        )

        changed = 0
        for sid in shipment_ids:
            shipment = Shipment.objects.get(id=sid)
            existing = list(shipment.block_sources.all())
            entries = [
                {'block': bs.block_id, 'weight_kg': bs.weight_kg, 'harvest_date': bs.harvest_date}
                for bs in existing
            ]
            before = ', '.join(
                f'{code_map.get(bs.block_id, bs.block_id)}={bs.weight_kg}' for bs in existing
            )
            merged = merge_to_parent(entries, parent_map)
            after = ', '.join(
                f'{code_map.get(top_id, top_id)}={data["weight_kg"]}'
                for top_id, data in merged.items()
            )
            self.stdout.write(f'  #{sid} {shipment.shipment_code}: [{before}] -> [{after}]')

            if apply:
                write_block_sources(shipment, entries, replace=True)
            changed += 1

        verb = self.style.SUCCESS(f'Applied: {changed} shipment(s) normalized.') if apply \
            else self.style.WARNING(f'DRY-RUN: {changed} shipment(s) would change. Re-run with --apply.')
        self.stdout.write(verb)
