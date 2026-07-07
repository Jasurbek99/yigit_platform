"""Seed the PackingTemplate catalog — full gross-net rows (whole truck + shares).

Each template mirrors one Excel `gross net` row: the whole-truck packing plus each
firm's share. Idempotent by name.

Usage:
    python manage.py seed_packing_templates
    python manage.py seed_packing_templates --dry-run
"""
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction

from apps.export.models import PackingTemplate, PackingTemplateShare

# (net, gross, boxes, pallets, pallet_wt)
_F = lambda *a: dict(zip(('net_kg', 'gross_kg', 'box_count', 'pallet_count', 'pallet_weight_kg'),
                         (Decimal(str(a[0])), Decimal(str(a[1])), a[2],
                          Decimal(str(a[3])), Decimal(str(a[4])))))

# name, product, whole-truck, [shares], sort
_TEMPLATES = [
    ('Tomato · full truck (18100)', 'tomato',
     _F(18100, 20400, 3100, 33, 380),
     [_F(18100, 20400, 3100, 33, 380)], 10),
    ('Tomato · 18000 (9000 / 9000)', 'tomato',
     _F(18000, 20400, 3040, 33, 380),
     [_F(9000, 10200, 1520, 16.5, 190), _F(9000, 10200, 1520, 16.5, 190)], 20),
    ('Tomato · 18000 (10000 / 8000)', 'tomato',
     _F(18000, 20472, 2912, 33, 412),
     [_F(10000, 11373, 1618, 18, 229), _F(8000, 9099, 1294, 15, 183)], 30),
    ('Tomato · 17000 (14000 / 3000)', 'tomato',
     _F(17000, 19028, 2936, 33, 439),
     [_F(14000, 15670, 2418, 27, 362), _F(3000, 3358, 518, 6, 77)], 40),
    ('Pepper · full truck (16800)', 'pepper',
     _F(16800, 19080, 3064, 33, 346),
     [_F(16800, 19080, 3064, 33, 346)], 50),
]


class Command(BaseCommand):
    help = 'Seed PackingTemplate catalog with standard gross-net rows.'

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true')

    def handle(self, *args, **options):
        dry_run = options['dry_run']
        created = updated = 0
        with transaction.atomic():
            for name, product, whole, shares, sort in _TEMPLATES:
                if dry_run:
                    exists = PackingTemplate.objects.filter(name=name).exists()
                    self.stdout.write(f'{"UPDATE" if exists else "CREATE"}  {name} ({len(shares)} shares)')
                    continue
                tpl, was_created = PackingTemplate.objects.update_or_create(
                    name=name,
                    defaults={'product_type': product, 'is_active': True, 'sort_order': sort, **whole},
                )
                tpl.shares.all().delete()
                PackingTemplateShare.objects.bulk_create([
                    PackingTemplateShare(template=tpl, share_order=i + 1, **s)
                    for i, s in enumerate(shares)
                ], batch_size=500)
                created += was_created
                updated += not was_created
            if dry_run:
                transaction.set_rollback(True)
                self.stdout.write(self.style.WARNING('Dry run — nothing written.'))
                return
        self.stdout.write(self.style.SUCCESS(
            f'PackingTemplate seed complete: {created} created, {updated} updated.'
        ))
