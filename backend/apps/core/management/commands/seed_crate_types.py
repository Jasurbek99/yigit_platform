"""Seed CrateType reference data.

Idempotent — safe to run multiple times. The migration (core 0011) also seeds
these rows via RunPython; this command is for manual re-seeding or local dev setup.

Usage:
    python manage.py seed_crate_types
"""
from django.core.management.base import BaseCommand

from apps.core.models import CrateType


class Command(BaseCommand):
    help = 'Seed CrateType reference data (LEBIZ PLAST 18, AGAÇ, PLASMAS)'

    def handle(self, *args, **options):
        # Real data verified from 10AP116_CEKIM_GAPAN.xlsx:
        #   LEBIZ PLAST 18 = 0.543 kg (confirmed by Artykow Maksat)
        #   AGAÇ and PLASMAS weights are placeholders — ask Soltanmyrat for correct values.
        seed = [
            ('LEBIZ PLAST 18', '0.543', True),
            ('AGAÇ',           '2.000', False),  # is_active=False until weight confirmed
            ('PLASMAS',        '0.700', False),  # is_active=False until weight confirmed
        ]
        for name, weight_kg, is_active in seed:
            obj, created = CrateType.objects.update_or_create(
                name=name,
                defaults={'weight_kg': weight_kg, 'is_active': is_active},
            )
            verb = 'Created' if created else 'Updated'
            self.stdout.write(f'{verb}: {obj}')

        self.stdout.write(self.style.SUCCESS('CrateType seed complete.'))
