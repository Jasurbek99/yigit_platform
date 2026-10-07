"""Fill Shipment.product_type where it is NULL (pepper spec 2026-10-05).

NULL already reads as tomato everywhere; this makes it explicit. The product
comes from the truck's blocks (resolve_product_type), else tomato. A truck whose
blocks span two products is skipped and listed. A truck whose blocks are pepper
and whose split firm has no pepper quota is refused and listed (same hard block
as a product change in the UI). Each write goes through set_shipment_product in
its own transaction: audit row, and a quota resync when the code moves.

Dry-run by default (read-only); pass --apply to write.
Contracts: see contracts' backfill_contract_products.
"""
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.core.models import ProductType
from apps.export.models import Shipment
from apps.export.services.product_type import (
    ProductMismatchError, ProductQuotaError, check_product_quota, resolve_product_type,
    set_shipment_product,
)


class Command(BaseCommand):
    help = 'Set NULL shipment products from their blocks, else tomato (dry-run unless --apply).'

    def add_arguments(self, parser):
        parser.add_argument(
            '--apply', action='store_true',
            help='Write changes. Without this flag the command only previews (dry-run).',
        )

    def handle(self, *args, **options):
        apply = options['apply']
        tomato = ProductType.tomato()
        if tomato is None:
            raise CommandError('No ProductType with code "tomato" — run migrations first.')

        counts = {'tomato': 0, 'pepper': 0}
        resync, mixed, uncoded, refused = [], [], [], []
        rows = list(Shipment.objects.filter(product_type__isnull=True).order_by('pk'))
        for shipment in rows:
            block_ids = list(shipment.block_sources.values_list('block_id', flat=True))
            try:
                product = resolve_product_type(block_ids) or tomato
            except ProductMismatchError:
                mixed.append(shipment.shipment_code)
                continue
            if product.code not in (ProductType.CODE_TOMATO, ProductType.CODE_PEPPER):
                uncoded.append(shipment.shipment_code)  # block variety on a code-less product
                continue
            try:
                if apply:
                    with transaction.atomic():
                        set_shipment_product(shipment, product, user=None)
                else:
                    check_product_quota(shipment, product)
            except ProductQuotaError as exc:
                refused.append(f'{shipment.shipment_code} ({exc})')
                continue
            counts[product.code] += 1
            if product.code != ProductType.CODE_TOMATO and shipment.firm_splits.exists():
                resync.append(shipment.shipment_code)

        self.stdout.write('APPLIED' if apply else 'DRY RUN (pass --apply to write)')
        self.stdout.write(f'NULL-product shipments: {len(rows)}')
        for code, n in counts.items():
            self.stdout.write(f'  -> {code}: {n}')
        self.stdout.write(f'  quota resync (code moves, has splits): {len(resync)}')
        self.stdout.write(f'  skipped mixed: {len(mixed)} {mixed}')
        self.stdout.write(f'  skipped code-less product: {len(uncoded)} {uncoded}')
        self.stdout.write(f'  refused (no quota): {len(refused)} {refused}')
