"""Seed the gross-net packing catalog (PackingPreset) with standard configs.

Source: Export_contracts_2025-2026.xlsx — "gross net" sheet. That sheet is a
pick-list the document team selects from before loading; this seeds the *standard*
configurations (single-firm, half-split, the labelled uneven splits, Bulgar,
a pepper placeholder) — NOT the ~115 near-duplicate rows.

Net caps reuse `get_default_truck_weight()` (TruckSplitDefault) so the official
kg-per-firm stays single-sourced. Gross / boxes / pallets / pallet-weight are
representative values pulled from real sheet rows; admins refine in the UI.

Usage:
    python manage.py seed_packing_presets            # create/update
    python manage.py seed_packing_presets --dry-run  # show what would change
"""
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction

from apps.export.models import PackingPreset, get_default_truck_weight

# Official net caps (single-sourced from TruckSplitDefault via get_default_truck_weight).
NET_FULL = get_default_truck_weight(1)          # 1 firm = whole truck (18 100)
NET_HALF = get_default_truck_weight(2)           # 2-firm share (9 000)
NET_TRUCK_2FIRM = NET_HALF * 2                    # whole truck carrying two firms (18 000)

# WHOLE-TRUCK configs only. Per-firm packing is DERIVED from these by weight share
# (see services/packing_split.py), so the catalog never holds "firm share" rows —
# that would let someone pick a half-truck as a whole truck (poka-yoke).
# name, product_type, net, gross, boxes, pallets, pallet_wt, sort
_PRESETS = [
    ('Tomato · full truck (18100)', 'tomato', NET_FULL, Decimal('20400'), 3100, Decimal('33'), Decimal('380'), 10),
    ('Tomato · truck, 2-firm split (18000)', 'tomato', NET_TRUCK_2FIRM, Decimal('20400'), 3040, Decimal('33'), Decimal('380'), 11),
    # Pepper ("Bulgar" = bell pepper, Turkmen).
    ('Pepper · full truck (16800)', 'pepper', Decimal('16800'), Decimal('19080'), 3064, Decimal('33'), Decimal('346'), 20),
]


class Command(BaseCommand):
    help = 'Seed the PackingPreset catalog with standard gross-net configs.'

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true', help='Show changes without writing.')

    def handle(self, *args, **options):
        dry_run = options['dry_run']
        created = updated = 0

        with transaction.atomic():
            for name, product, net, gross, boxes, pallets, pw, sort in _PRESETS:
                defaults = {
                    'product_type': product,
                    'net_kg': net,
                    'gross_kg': gross,
                    'box_count': boxes,
                    'pallet_count': pallets,
                    'pallet_weight_kg': pw,
                    'sort_order': sort,
                    'is_active': True,
                }
                if dry_run:
                    exists = PackingPreset.objects.filter(name=name).exists()
                    self.stdout.write(f'{"UPDATE" if exists else "CREATE"}  {name}')
                    continue
                _, was_created = PackingPreset.objects.update_or_create(
                    name=name, defaults=defaults,
                )
                created += was_created
                updated += not was_created

            if dry_run:
                transaction.set_rollback(True)
                self.stdout.write(self.style.WARNING('Dry run — nothing written.'))
                return

        self.stdout.write(self.style.SUCCESS(
            f'PackingPreset seed complete: {created} created, {updated} updated.'
        ))
