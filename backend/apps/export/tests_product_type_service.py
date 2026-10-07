import datetime

from django.test import TestCase

from apps.core.models import Country, Customer, GreenhouseBlock, ProductType, Season, ShipmentStatusType, TomatoVariety, User
from apps.export.models import QuotaUsageRecord, Shipment, ShipmentBlockSource, ShipmentFirmSplit
from apps.export.services.product_type import (
    ProductMismatchError, check_blocks_fit, resolve_product_type, set_shipment_product, shipment_product_code,
)


class ProductServiceTests(TestCase):
    def setUp(self):
        self.tomato = ProductType.objects.get(code='tomato')
        self.pepper = ProductType.objects.get(code='pepper')
        t = TomatoVariety.objects.create(name='S-Tom', product_type=self.tomato)
        p = TomatoVariety.objects.get(name='Maranella')
        self.tb = GreenhouseBlock.objects.create(code='ST', variety_main=t)
        self.pb = GreenhouseBlock.objects.create(code='SP', variety_main=p)
        self.nb = GreenhouseBlock.objects.create(code='SN')
        season, _ = Season.objects.get_or_create(name='ps-test', defaults={'start_date': '2026-08-01', 'end_date': '2027-07-01', 'is_active': True})
        status, _ = ShipmentStatusType.objects.get_or_create(code='draft', defaults={'name_tk': 'd', 'name_en': 'd', 'step_order': 0, 'phase': 'DRAFT'})
        self.user = User.objects.create(username='ps', role='admin')
        self.ship = Shipment.objects.create(shipment_code='0110001/26', date=datetime.date(2026, 10, 1), season=season, status=status, created_by=self.user, product_type=self.tomato)

    def test_resolve_ignores_blocks_without_product(self):
        self.assertEqual(resolve_product_type([self.pb.id, self.nb.id]), self.pepper)
        self.assertIsNone(resolve_product_type([self.nb.id]))

    def test_resolve_mixed_raises(self):
        with self.assertRaisesMessage(ProductMismatchError, 'mixed_product'):
            resolve_product_type([self.tb.id, self.pb.id])

    def test_supply_row_adopts_new_product(self):
        ShipmentBlockSource.objects.create(shipment=self.ship, block=self.tb)
        self.assertEqual(check_blocks_fit(self.ship, [self.pb.id]), self.pepper)

    def test_destination_row_refuses_other_product(self):
        self.ship.country = Country.objects.create(code='PZ', name_en='P', name_ru='P', name_tk='P')
        self.ship.customer = Customer.objects.create(name='PC')
        self.ship.save(update_fields=['country', 'customer'])
        with self.assertRaisesMessage(ProductMismatchError, 'product_mismatch'):
            check_blocks_fit(self.ship, [self.pb.id])

    def test_same_product_is_no_change(self):
        self.assertIsNone(check_blocks_fit(self.ship, [self.tb.id]))

    def test_null_product_reads_tomato(self):
        Shipment.objects.filter(pk=self.ship.pk).update(product_type=None)
        self.ship.refresh_from_db()
        self.assertEqual(shipment_product_code(self.ship), 'tomato')
        self.assertIsNone(check_blocks_fit(self.ship, [self.tb.id]))

    def _split_firm(self, quota_product=None):
        from decimal import Decimal

        from django.core.cache import cache

        from apps.core.models import ExportFirm
        from apps.export.models import QuotaIssuance, QuotaIssuanceFirmAllocation
        firm = ExportFirm.objects.create(code='PF', name_tk='PF', name_en='PF')
        ShipmentFirmSplit.objects.create(shipment=self.ship, export_firm=firm, weight_kg=18000, split_order=1)
        if quota_product:
            issuance = QuotaIssuance.objects.create(
                issue_date=datetime.date.today(), product_type=quota_product,
                validity='this_month', season=self.ship.season,
            )
            QuotaIssuanceFirmAllocation.objects.create(
                issuance=issuance, export_firm=firm, kg_quota=Decimal('50000'),
            )
        cache.clear()
        return firm

    def test_set_product_moves_quota_rows(self):
        self._split_firm(quota_product='pepper')
        self.assertTrue(set_shipment_product(self.ship, self.pepper, self.user))
        self.assertEqual(set(self.ship.quota_usage_records.values_list('product_type', flat=True)), {'pepper'})

    def test_set_product_refused_without_quota_for_new_product(self):
        from apps.export.services.product_type import ProductQuotaError
        self._split_firm(quota_product='tomato')
        with self.assertRaisesMessage(ProductQuotaError, 'PF has no remaining pepper quota'):
            set_shipment_product(self.ship, self.pepper, self.user)
        self.assertEqual(Shipment.objects.get(pk=self.ship.pk).product_type.code, 'tomato')

    def test_null_to_tomato_is_not_a_quota_move(self):
        """NULL reads as tomato: filling it in needs no quota and resyncs nothing."""
        self._split_firm(quota_product=None)
        Shipment.objects.filter(pk=self.ship.pk).update(product_type=None)
        self.ship.refresh_from_db()
        self.assertTrue(set_shipment_product(self.ship, self.tomato, self.user))
        self.assertEqual(Shipment.objects.get(pk=self.ship.pk).product_type.code, 'tomato')
        self.assertFalse(self.ship.quota_usage_records.exists())
