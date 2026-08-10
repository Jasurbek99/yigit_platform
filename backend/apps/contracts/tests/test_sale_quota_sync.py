"""Editing an invoice's NET moves the firm's split, and therefore its quota.

`ContractSale.quantity_kg` and `ShipmentFirmSplit.weight_kg` are documented as
the same number — the firm's official export weight (AD-016) — but were only
kept in step in one direction. Applying a PackingTemplate wrote the share net
down onto the split; editing `quantity_kg` on the sale itself did not, so the
invoice and the quota ledger silently disagreed. Two of the 18 linked sales on
the dev database had drifted this way (shipment 664: split 11,000/7,000 against
invoice 9,000/9,000 — identical truck total, different per-firm split, and quota
is counted per firm).

Direction is architectural: `export` may not import `contracts`, so quota cannot
read the sale. `contracts` reaching into `export` is the allowed direction.

Run: python manage.py test apps.contracts.tests.test_sale_quota_sync
"""
import datetime
from decimal import Decimal

from django.core.cache import cache
from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import ExportFirm, ImportFirm, Season, ShipmentStatusType, User
from apps.contracts.models import Contract, ContractSale
from apps.export.models import QuotaUsageRecord, Shipment, ShipmentFirmSplit

URL = '/api/v1/contracts/sales/'


def _season() -> Season:
    season, _ = Season.objects.get_or_create(
        name='qs2025',
        defaults={
            'start_date': datetime.date(2025, 1, 1),
            'end_date': datetime.date(2025, 12, 31),
            'is_active': True,
        },
    )
    return season


def _draft_status() -> ShipmentStatusType:
    status, _ = ShipmentStatusType.objects.get_or_create(
        code='draft',
        defaults={
            'name_tk': 'd', 'name_en': 'Draft', 'name_ru': 'd',
            'step_order': 0, 'phase': 'PREP',
        },
    )
    return status


class SaleQuotaSyncTests(TestCase):
    """One truck, two firms, 9,000 kg each — and an invoice that moves."""

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions', verbosity=0)
        cls.user = User(username='qs-gadam', role='export_manager')
        cls.user.set_password('pass')
        cls.user.save()

    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.client.force_authenticate(self.user)

        self.buyer = ImportFirm.objects.create(code='QSB', name_company='QS Buyer')
        self.ygt = ExportFirm.objects.create(code='QSY', name_tk='QS YGT')
        self.hj = ExportFirm.objects.create(code='QSH', name_tk='QS HJ')
        self.shipment = Shipment.objects.create(
            shipment_code='QS-001/25', date=datetime.date(2025, 9, 22),
            season=_season(), status=_draft_status(), import_firm=self.buyer,
        )
        ShipmentFirmSplit.objects.create(
            shipment=self.shipment, export_firm=self.ygt, weight_kg='9000', split_order=1,
        )
        ShipmentFirmSplit.objects.create(
            shipment=self.shipment, export_firm=self.hj, weight_kg='9000', split_order=2,
        )
        self.contract = Contract.objects.create(
            contract_number='9/25-QSY-EXP', seq=9, contract_year=2025,
            export_firm=self.ygt, import_firm=self.buyer, season=_season(),
        )
        self.sale = ContractSale.objects.create(
            contract=self.contract, shipment=self.shipment, export_firm=self.ygt,
            quantity_kg=Decimal('9000'), price_per_kg=Decimal('1.00'),
        )

    def _weights(self) -> dict:
        return dict(self.shipment.firm_splits.values_list('export_firm_id', 'weight_kg'))

    def _usage(self) -> dict:
        return dict(
            self.shipment.quota_usage_records.values_list('export_firm_id', 'kg_used')
        )

    def test_editing_the_invoice_net_moves_the_split(self):
        response = self.client.patch(
            f'{URL}{self.sale.pk}/', {'quantity_kg': '11000.00'}, format='json',
        )
        self.assertEqual(response.status_code, 200, response.content[:400])
        self.assertEqual(self._weights()[self.ygt.pk], Decimal('11000.00'))

    def test_editing_the_invoice_net_moves_the_quota(self):
        """The point of the whole change — the ledger follows the document."""
        self.client.patch(f'{URL}{self.sale.pk}/', {'quantity_kg': '11000.00'}, format='json')
        self.assertEqual(self._usage()[self.ygt.pk], Decimal('11000.00'))

    def test_the_other_firm_on_the_truck_keeps_its_weight(self):
        """Regression guard: `_set_firm_weights` replaces the whole split set."""
        self.client.patch(f'{URL}{self.sale.pk}/', {'quantity_kg': '11000.00'}, format='json')
        weights = self._weights()
        self.assertEqual(len(weights), 2)
        self.assertEqual(weights[self.hj.pk], Decimal('9000.00'))
        self.assertEqual(self._usage()[self.hj.pk], Decimal('9000.00'))

    def test_an_unrelated_field_edit_rewrites_nothing(self):
        before = set(self.shipment.firm_splits.values_list('id', flat=True))
        response = self.client.patch(
            f'{URL}{self.sale.pk}/', {'invoice_number': 42}, format='json',
        )
        self.assertEqual(response.status_code, 200, response.content[:400])
        self.assertEqual(set(self.shipment.firm_splits.values_list('id', flat=True)), before)

    def test_resaving_the_same_net_rewrites_nothing(self):
        """The `weights[firm] == quantity_kg` early return.

        `_set_firm_weights` DELETES and recreates every split on the truck, so
        without this guard an idempotent save would churn primary keys — and
        with them the quota rows, on every unrelated sale edit.
        """
        before = set(self.shipment.firm_splits.values_list('id', flat=True))
        response = self.client.patch(
            f'{URL}{self.sale.pk}/', {'quantity_kg': '9000.00'}, format='json',
        )
        self.assertEqual(response.status_code, 200, response.content[:400])
        self.assertEqual(set(self.shipment.firm_splits.values_list('id', flat=True)), before)

    def test_the_repair_command_writes_with_no_acting_user(self):
        """The command's write path, which no API test reaches.

        `sync_split_weights_from_sales` passes `user=None` — nobody is acting, and
        `QuotaUsageRecord.created_by` is nullable so that stays honest. This is
        the ONLY caller that does, so it needs its own cover: the API always has
        a request user.
        """
        # Drift the split behind the invoice, the way the pre-2026-08-11 rows did.
        self.shipment.firm_splits.filter(export_firm=self.ygt).update(weight_kg='7000')

        call_command('sync_split_weights_from_sales', verbosity=0)

        self.assertEqual(self._weights()[self.ygt.pk], Decimal('9000.00'))
        self.assertEqual(self._usage()[self.ygt.pk], Decimal('9000.00'))
        self.assertIsNone(
            self.shipment.quota_usage_records.get(export_firm=self.ygt).created_by_id,
        )

    def test_the_repair_command_leaves_aligned_rows_alone(self):
        before = set(self.shipment.firm_splits.values_list('id', flat=True))
        call_command('sync_split_weights_from_sales', verbosity=0)
        self.assertEqual(set(self.shipment.firm_splits.values_list('id', flat=True)), before)

    def test_a_firm_not_on_the_truck_is_skipped_not_added(self):
        """Putting a firm on a truck is a separate decision with its own quota gate."""
        outsider = ExportFirm.objects.create(code='QSO', name_tk='QS Outsider')
        sale = ContractSale.objects.create(
            contract=self.contract, shipment=self.shipment, export_firm=outsider,
            quantity_kg=Decimal('5000'), price_per_kg=Decimal('1.00'),
        )
        response = self.client.patch(
            f'{URL}{sale.pk}/', {'quantity_kg': '6000.00'}, format='json',
        )
        self.assertEqual(response.status_code, 200, response.content[:400])
        self.assertNotIn(outsider.pk, self._weights())
        self.assertEqual(self.shipment.firm_splits.count(), 2)

    def test_a_sale_with_no_shipment_is_left_alone(self):
        """Legacy 2-Sales rows carry no shipment (ADR-023) — nothing to sync."""
        orphan = ContractSale.objects.create(
            contract=self.contract, export_firm=self.ygt,
            quantity_kg=Decimal('4000'), price_per_kg=Decimal('1.00'),
        )
        response = self.client.patch(
            f'{URL}{orphan.pk}/', {'quantity_kg': '4500.00'}, format='json',
        )
        self.assertEqual(response.status_code, 200, response.content[:400])
        self.assertEqual(self._weights()[self.ygt.pk], Decimal('9000.00'))

    def test_usage_rows_stay_countable_after_the_rewrite(self):
        """`_set_firm_weights` deletes and recreates — the rows must come back counted."""
        self.client.patch(f'{URL}{self.sale.pk}/', {'quantity_kg': '11000.00'}, format='json')
        rows = QuotaUsageRecord.objects.filter(shipment=self.shipment)
        self.assertEqual(rows.count(), 2)
        self.assertTrue(all(r.status == 'approved' for r in rows))
        self.assertEqual(rows.counted().count(), 2)
