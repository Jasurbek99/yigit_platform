"""I5: backfill_product_types fills NULL Shipment.product_type (dry-run by default)."""
import datetime
from decimal import Decimal
from io import StringIO

from django.core.cache import cache
from django.core.management import call_command
from django.test import TestCase

from apps.core.models import (
    ExportFirm, GreenhouseBlock, ProductType, Season, ShipmentStatusType, TomatoVariety, User,
)
from apps.export.models import (
    AuditLog, QuotaIssuance, QuotaIssuanceFirmAllocation, QuotaUsageRecord, Shipment,
    ShipmentBlockSource, ShipmentFirmSplit,
)
from apps.export.services.quota_sync import sync_draft_quota_usage_for_shipment


class BackfillProductTypesTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create(username='bf_user', role='admin')
        self.season, _ = Season.objects.get_or_create(
            name='bf-test',
            defaults={'start_date': '2026-08-01', 'end_date': '2027-07-01', 'is_active': True},
        )
        self.status, _ = ShipmentStatusType.objects.get_or_create(
            code='draft', defaults={'name_tk': 'd', 'name_en': 'd', 'step_order': 0, 'phase': 'DRAFT'},
        )
        tomato = ProductType.objects.get(code='tomato')
        self.tb = GreenhouseBlock.objects.create(
            code='BT', variety_main=TomatoVariety.objects.create(name='BF-Tom', product_type=tomato),
        )
        self.pb = GreenhouseBlock.objects.create(
            code='BP', variety_main=TomatoVariety.objects.get(name='Maranella'),
        )
        self.firm = ExportFirm.objects.create(code='BFF', name_tk='BFF', name_en='BFF')

        self.no_blocks = self._row('0110901/26')
        self.tomato_blocks = self._row('0110902/26', [self.tb])
        self.pepper_blocks = self._row('0110903/26', [self.pb])
        self.mixed = self._row('0110904/26', [self.tb, self.pb])
        # A pepper-block truck whose split firm has tomato quota only.
        self.pepper_no_quota = self._row('0110905/26', [self.pb])
        self.other_firm = ExportFirm.objects.create(code='BFN', name_tk='BFN', name_en='BFN')
        ShipmentFirmSplit.objects.create(
            shipment=self.pepper_no_quota, export_firm=self.other_firm,
            weight_kg=Decimal('9000'), split_order=1,
        )
        sync_draft_quota_usage_for_shipment(self.pepper_no_quota, self.user, product_type='tomato')
        # The pepper-block truck with a split whose firm holds pepper quota.
        ShipmentFirmSplit.objects.create(
            shipment=self.pepper_blocks, export_firm=self.firm,
            weight_kg=Decimal('9000'), split_order=1,
        )
        sync_draft_quota_usage_for_shipment(self.pepper_blocks, self.user, product_type='tomato')
        issuance = QuotaIssuance.objects.create(
            issue_date=datetime.date.today(), product_type='pepper',
            validity='this_month', season=self.season,
        )
        QuotaIssuanceFirmAllocation.objects.create(
            issuance=issuance, export_firm=self.firm, kg_quota=Decimal('50000'),
        )
        cache.clear()

    def _row(self, code, blocks=()):
        row = Shipment.objects.create(
            shipment_code=code, date=datetime.date(2026, 10, 1), season=self.season,
            status=self.status, created_by=self.user, product_type=None,
        )
        for block in blocks:
            ShipmentBlockSource.objects.create(shipment=row, block=block, weight_kg=Decimal('9000'))
        return row

    def _run(self, *args):
        out = StringIO()
        call_command('backfill_product_types', *args, stdout=out)
        return out.getvalue()

    def _code(self, row):
        product = Shipment.objects.get(pk=row.pk).product_type
        return product.code if product else None

    def test_dry_run_writes_nothing_and_reports(self):
        out = self._run()
        self.assertEqual(Shipment.objects.filter(product_type__isnull=True).count(), 5)
        self.assertFalse(AuditLog.objects.filter(field_name='product_type').exists())
        self.assertEqual(
            set(QuotaUsageRecord.objects.values_list('product_type', flat=True)), {'tomato'},
        )
        self.assertIn('DRY RUN', out)
        self.assertIn('-> tomato: 2', out)
        self.assertIn('-> pepper: 1', out)
        self.assertIn('skipped mixed: 1', out)
        self.assertIn('refused (no quota): 1', out)
        self.assertIn('0110904/26', out)
        self.assertIn('0110905/26', out)

    def test_apply_fills_products_and_moves_pepper_quota(self):
        out = self._run('--apply')
        self.assertIn('APPLIED', out)
        self.assertEqual(self._code(self.no_blocks), 'tomato')
        self.assertEqual(self._code(self.tomato_blocks), 'tomato')
        self.assertEqual(self._code(self.pepper_blocks), 'pepper')
        self.assertIsNone(self._code(self.mixed))
        self.assertIsNone(self._code(self.pepper_no_quota))
        self.assertEqual(
            list(QuotaUsageRecord.objects.filter(shipment=self.pepper_blocks)
                 .values_list('product_type', flat=True)),
            ['pepper'],
        )
        self.assertEqual(
            list(QuotaUsageRecord.objects.filter(shipment=self.pepper_no_quota)
                 .values_list('product_type', flat=True)),
            ['tomato'],
        )
        self.assertEqual(AuditLog.objects.filter(field_name='product_type').count(), 3)

    def test_apply_is_idempotent(self):
        self._run('--apply')
        out = self._run('--apply')
        self.assertIn('-> tomato: 0', out)
        self.assertIn('-> pepper: 0', out)
