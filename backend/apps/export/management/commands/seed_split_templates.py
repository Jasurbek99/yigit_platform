"""Seed the firm-split catalog (SplitTemplate) with the Excel section splits.

Source: Export_contracts_2025-2026.xlsx — "gross net" sheet section labels
(10000/8000, 14000/3000, 11300/6700, 4100/9700/4200, …). Idempotent by name.

Usage:
    python manage.py seed_split_templates
    python manage.py seed_split_templates --dry-run
"""
from django.core.management.base import BaseCommand
from django.db import transaction

from apps.export.models import SplitTemplate

# name, weights (comma-separated kg, in order), sort
_SPLITS = [
    ('9000 / 9000', '9000,9000', 10),
    ('10000 / 8000', '10000,8000', 20),
    ('9500 / 9500', '9500,9500', 30),
    ('9750 / 9750', '9750,9750', 40),
    ('11300 / 6700', '11300,6700', 50),
    ('11000 / 7000', '11000,7000', 60),
    ('14000 / 3000', '14000,3000', 70),
    ('4100 / 9700 / 4200', '4100,9700,4200', 80),
    ('6000 / 6000 / 6000', '6000,6000,6000', 90),
]


class Command(BaseCommand):
    help = 'Seed the SplitTemplate catalog with standard firm-split divisions.'

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true')

    def handle(self, *args, **options):
        dry_run = options['dry_run']
        created = updated = 0
        with transaction.atomic():
            for name, weights, sort in _SPLITS:
                if dry_run:
                    exists = SplitTemplate.objects.filter(name=name).exists()
                    self.stdout.write(f'{"UPDATE" if exists else "CREATE"}  {name}')
                    continue
                _, was_created = SplitTemplate.objects.update_or_create(
                    name=name,
                    defaults={'weights': weights, 'sort_order': sort, 'is_active': True},
                )
                created += was_created
                updated += not was_created
            if dry_run:
                transaction.set_rollback(True)
                self.stdout.write(self.style.WARNING('Dry run — nothing written.'))
                return
        self.stdout.write(self.style.SUCCESS(
            f'SplitTemplate seed complete: {created} created, {updated} updated.'
        ))
