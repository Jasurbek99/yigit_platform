"""Set NULL Contract.product_type to tomato (pepper spec 2026-10-05 §4.3).

NULL already reads as tomato everywhere; this makes it explicit. Dry-run by
default (read-only); pass --apply to write. Shipments: see export's
backfill_product_types.
"""
from django.core.management.base import BaseCommand, CommandError

from apps.contracts.models import Contract
from apps.core.models import ProductType


class Command(BaseCommand):
    help = 'Set NULL contract products to tomato (dry-run unless --apply).'

    def add_arguments(self, parser):
        parser.add_argument(
            '--apply', action='store_true',
            help='Write changes. Without this flag the command only previews (dry-run).',
        )

    def handle(self, *args, **options):
        tomato = ProductType.tomato()
        if tomato is None:
            raise CommandError('No ProductType with code "tomato" — run migrations first.')
        rows = Contract.objects.filter(product_type__isnull=True)
        count = rows.count()
        if options['apply']:
            rows.update(product_type=tomato)  # no rollup fields change
        self.stdout.write('APPLIED' if options['apply'] else 'DRY RUN (pass --apply to write)')
        self.stdout.write(f'  contracts NULL -> tomato: {count}')
