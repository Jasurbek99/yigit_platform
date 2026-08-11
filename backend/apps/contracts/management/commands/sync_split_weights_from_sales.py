"""Realign firm split weights (and therefore quota) with their invoice NET.

`ContractSale.quantity_kg` and `ShipmentFirmSplit.weight_kg` are the same
number by design — the firm's official export weight (AD-016). Until
2026-08-10 they were only kept in step in one direction: applying a
PackingTemplate wrote the share net down onto the split, but editing
`quantity_kg` on the sale itself did not. `ContractSaleViewSet` now syncs on
every write; this command fixes the rows that drifted before it did.

Quota is counted PER FIRM, so a drift matters even when the truck total is
unchanged — two firms swapping 2,000 kg between them moves both balances.

    python manage.py sync_split_weights_from_sales --dry-run
    python manage.py sync_split_weights_from_sales
"""
from django.core.management.base import BaseCommand

from apps.contracts.models import ContractSale
from apps.contracts.views import sync_split_weight_from_sale


class Command(BaseCommand):
    help = "Rewrite firm split weights that disagree with their sale's quantity_kg."

    def add_arguments(self, parser) -> None:
        parser.add_argument(
            '--dry-run', action='store_true',
            help='Report the drift without writing.',
        )

    def handle(self, *args, **options) -> None:
        sales = (
            ContractSale.objects
            .filter(shipment__isnull=False, export_firm__isnull=False)
            .exclude(quantity_kg=None)
            .select_related('shipment', 'export_firm')
            .order_by('shipment_id', 'export_firm_id')
        )

        drifted = []
        for sale in sales:
            weights = dict(
                sale.shipment.firm_splits.values_list('export_firm_id', 'weight_kg')
            )
            current = weights.get(sale.export_firm_id)
            if current is None or current == sale.quantity_kg:
                continue
            drifted.append((sale, current))

        self.stdout.write(f'Sales checked: {sales.count()}')
        self.stdout.write(f'Drifted:       {len(drifted)}')
        for sale, current in drifted:
            self.stdout.write(
                f'  {sale.shipment.shipment_code} / {sale.export_firm.code}: '
                f'split {current} -> invoice {sale.quantity_kg}'
            )

        if not drifted:
            self.stdout.write(self.style.SUCCESS('Nothing to fix.'))
            return

        if options['dry_run']:
            self.stdout.write(self.style.WARNING('\n--dry-run: nothing written.'))
            return

        # `sync_split_weight_from_sale` rewrites the whole split set for the
        # shipment and re-runs quota, so re-reading per sale is deliberate: two
        # drifted firms on one truck must not race on a stale weight map.
        fixed = sum(1 for sale, _ in drifted if sync_split_weight_from_sale(sale, None))
        self.stdout.write(self.style.SUCCESS(f'\nRewrote {fixed} split weights.'))
