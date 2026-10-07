"""Pepper spec 2026-10-05 §2: block writes, Join, packaging and PATCH respect the product."""
import datetime
from decimal import Decimal

from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import (
    Country, Customer, ExportFirm, GreenhouseBlock, ProductType, Season,
    ShipmentStatusType, TomatoVariety, User,
)
from apps.export.models import (
    QuotaUsageRecord, Shipment, ShipmentBlockSource, ShipmentFirmSplit,
)


def _user(username, role):
    user = User(username=username, role=role)
    user.set_password('pass')
    user.save()
    return user


class ProductGuardTests(TestCase):
    _seq = 0

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')

    def setUp(self):
        self.client = APIClient()
        self.em = _user('pg_em', 'export_manager')
        self.season, _ = Season.objects.get_or_create(
            name='pg-test',
            defaults={'start_date': '2026-08-01', 'end_date': '2027-07-01', 'is_active': True},
        )
        self.draft, _ = ShipmentStatusType.objects.get_or_create(
            code='draft',
            defaults={'name_tk': 'd', 'name_en': 'd', 'step_order': 0, 'phase': 'DRAFT'},
        )
        self.tomato = ProductType.objects.get(code='tomato')
        self.pepper = ProductType.objects.get(code='pepper')
        tv = TomatoVariety.objects.create(name='PG-Tom', product_type=self.tomato)
        self.pb = GreenhouseBlock.objects.create(
            code='QP', variety_main=TomatoVariety.objects.get(name='Maranella'),
        )
        self.tb = GreenhouseBlock.objects.create(code='QT', variety_main=tv)
        self.country, _ = Country.objects.get_or_create(
            code='PZ', defaults={'name_tk': 'P', 'name_en': 'P', 'name_ru': 'P'},
        )
        self.customer, _ = Customer.objects.get_or_create(name='PGCustomer')
        self.firm = ExportFirm.objects.create(code='PGF', name_tk='PGF', name_en='PGF')

        self.dest = self._row(destination=True)
        self.supply_p = self._row(product=self.pepper, blocks=[self.pb])

    def _row(self, *, destination=False, product=None, blocks=(), date=datetime.date(2026, 9, 29)):
        ProductGuardTests._seq += 1
        row = Shipment.objects.create(
            shipment_code=f'{date:%d%m}{800 + ProductGuardTests._seq}/{date:%y}',
            date=date, season=self.season, status=self.draft,
            country=self.country if destination else None,
            customer=self.customer if destination else None,
            product_type=product or self.tomato,
            created_by=self.em,
        )
        for block in blocks:
            ShipmentBlockSource.objects.create(
                shipment=row, block=block, weight_kg=Decimal('9000'),
            )
        return row

    def _post_blocks(self, row, block):
        self.client.force_authenticate(self.em)
        return self.client.post(
            f'/api/v1/export/shipments/{row.id}/block-sources/',
            {'blocks': [{'block_id': block.id, 'weight_kg': 16800}]}, format='json',
        )

    def _split(self, row):
        ShipmentFirmSplit.objects.create(
            shipment=row, export_firm=self.firm, weight_kg=Decimal('9000'), split_order=1,
        )

    # --- block-sources endpoint -------------------------------------------------

    def test_block_edit_on_supply_row_switches_product(self):
        row = self._row(product=self.tomato, blocks=[self.tb])
        self._split(row)
        from apps.export.services.quota_sync import sync_draft_quota_usage_for_shipment
        sync_draft_quota_usage_for_shipment(row, self.em, product_type='tomato')
        resp = self._post_blocks(row, self.pb)
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(Shipment.objects.get(pk=row.pk).product_type.code, 'pepper')
        self.assertEqual(
            list(row.block_sources.values_list('block_id', flat=True)), [self.pb.id],
        )
        usage = QuotaUsageRecord.objects.filter(shipment=row)
        self.assertEqual(usage.count(), 1)
        self.assertEqual(usage.first().product_type, 'pepper')

    def test_block_edit_same_product_keeps_product(self):
        row = self._row(product=self.pepper, blocks=[self.pb])
        resp = self._post_blocks(row, self.pb)
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(Shipment.objects.get(pk=row.pk).product_type.code, 'pepper')

    def test_block_edit_on_destination_row_refused(self):
        resp = self._post_blocks(self.dest, self.pb)
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.data['error'], 'product_mismatch')
        self.assertFalse(self.dest.block_sources.exists())
        self.assertEqual(Shipment.objects.get(pk=self.dest.pk).product_type.code, 'tomato')

    def test_block_edit_destination_refusal_keeps_existing_blocks(self):
        row = self._row(destination=True, product=self.tomato, blocks=[self.tb])
        resp = self._post_blocks(row, self.pb)
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.data['error'], 'product_mismatch')
        self.assertEqual(
            list(row.block_sources.values_list('block_id', flat=True)), [self.tb.id],
        )

    def test_block_edit_mixed_products_refused(self):
        row = self._row(product=self.tomato, blocks=[self.tb])
        self.client.force_authenticate(self.em)
        resp = self.client.post(
            f'/api/v1/export/shipments/{row.id}/block-sources/',
            {'blocks': [{'block_id': self.pb.id, 'weight_kg': 8000},
                        {'block_id': self.tb.id, 'weight_kg': 8000}]},
            format='json',
        )
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.data['error'], 'mixed_product')
        self.assertEqual(
            list(row.block_sources.values_list('block_id', flat=True)), [self.tb.id],
        )
        self.assertEqual(Shipment.objects.get(pk=row.pk).product_type.code, 'tomato')

    # --- Join -------------------------------------------------------------------

    def test_join_pepper_supply_into_tomato_destination_refused(self):
        self.client.force_authenticate(self.em)
        resp = self.client.post(
            f'/api/v1/export/shipments/{self.dest.id}/join/',
            {'source_id': self.supply_p.id}, format='json',
        )
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.data['error'], 'product_mismatch')
        self.assertTrue(Shipment.objects.filter(pk=self.supply_p.pk).exists())
        self.assertFalse(self.dest.block_sources.exists())

    def test_join_same_product_succeeds(self):
        supply_t = self._row(product=self.tomato, blocks=[self.tb])
        self.client.force_authenticate(self.em)
        resp = self.client.post(
            f'/api/v1/export/shipments/{self.dest.id}/join/',
            {'source_id': supply_t.id}, format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertFalse(Shipment.objects.filter(pk=supply_t.pk).exists())
        self.assertTrue(self.dest.block_sources.exists())

    def test_join_pepper_supply_into_pepper_destination_succeeds(self):
        dest_p = self._row(destination=True, product=self.pepper)
        self.client.force_authenticate(self.em)
        resp = self.client.post(
            f'/api/v1/export/shipments/{dest_p.id}/join/',
            {'source_id': self.supply_p.id}, format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertFalse(Shipment.objects.filter(pk=self.supply_p.pk).exists())

    # --- PATCH product_type -----------------------------------------------------

    def _patch_product(self, row, product):
        self.client.force_authenticate(self.em)
        return self.client.patch(
            f'/api/v1/export/shipments/{row.id}/', {'product_type': product.id}, format='json',
        )

    def test_patch_product_with_blocks_of_other_product_refused(self):
        row = self._row(destination=True, product=self.tomato, blocks=[self.tb])
        resp = self._patch_product(row, self.pepper)
        self.assertEqual(resp.status_code, 400, resp.data)
        self.assertEqual(resp.data['product_type'], ['product_mismatch'])
        self.assertEqual(Shipment.objects.get(pk=row.pk).product_type.code, 'tomato')

    def test_patch_product_matching_blocks_is_accepted(self):
        row = self._row(destination=True, product=self.tomato, blocks=[self.tb])
        resp = self._patch_product(row, self.tomato)
        self.assertEqual(resp.status_code, 200, resp.data)

    def test_patch_product_without_blocks_moves_quota(self):
        from apps.export.services.quota_sync import sync_draft_quota_usage_for_shipment
        self._split(self.dest)
        sync_draft_quota_usage_for_shipment(self.dest, self.em, product_type='tomato')
        self.assertEqual(
            list(QuotaUsageRecord.objects.filter(shipment=self.dest).values_list('product_type', flat=True)),
            ['tomato'],
        )
        resp = self._patch_product(self.dest, self.pepper)
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(Shipment.objects.get(pk=self.dest.pk).product_type.code, 'pepper')
        self.assertEqual(
            list(QuotaUsageRecord.objects.filter(shipment=self.dest).values_list('product_type', flat=True)),
            ['pepper'],
        )

    def test_patch_unrelated_field_does_not_touch_quota(self):
        from apps.export.services.quota_sync import sync_draft_quota_usage_for_shipment
        self._split(self.dest)
        sync_draft_quota_usage_for_shipment(self.dest, self.em, product_type='tomato')
        before = list(QuotaUsageRecord.objects.filter(shipment=self.dest).values_list('pk', flat=True))
        self.client.force_authenticate(self.em)
        resp = self.client.patch(
            f'/api/v1/export/shipments/{self.dest.id}/', {'notes': 'x'}, format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        after = list(QuotaUsageRecord.objects.filter(shipment=self.dest).values_list('pk', flat=True))
        self.assertEqual(before, after)

    # --- Packaging: swap / unjoin -----------------------------------------------

    def test_swap_between_products_refused(self):
        from apps.export.services.packaging import swap_packing
        tomato_row = self._row(destination=True, product=self.tomato, blocks=[self.tb])
        with self.assertRaisesMessage(ValueError, 'product_mismatch'):
            swap_packing(tomato_row, self.supply_p, self.em)
        self.assertEqual(
            list(tomato_row.block_sources.values_list('block_id', flat=True)), [self.tb.id],
        )
        self.assertEqual(
            list(self.supply_p.block_sources.values_list('block_id', flat=True)), [self.pb.id],
        )

    def test_swap_between_products_refused_over_http(self):
        tomato_row = self._row(destination=True, product=self.tomato, blocks=[self.tb])
        self.client.force_authenticate(self.em)
        resp = self.client.post(
            f'/api/v1/export/shipments/{tomato_row.id}/swap-packaging/',
            {'other_id': self.supply_p.id}, format='json',
        )
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.data['error'], 'product_mismatch')

    def test_swap_same_product_succeeds(self):
        from apps.export.services.packaging import swap_packing
        other_p = self._row(destination=True, product=self.pepper, blocks=[self.pb])
        swap_packing(other_p, self.supply_p, self.em)
        self.assertEqual(other_p.block_sources.count(), 1)

    def test_unjoin_copies_product(self):
        from apps.export.services.packaging import unjoin_packing
        dest_p = self._row(destination=True, product=self.pepper, blocks=[self.pb])
        new = unjoin_packing(dest_p, self.em)
        self.assertEqual(new.product_type.code, 'pepper')
        self.assertEqual(Shipment.objects.get(pk=new.pk).product_type.code, 'pepper')
        self.assertEqual(Shipment.objects.get(pk=dest_p.pk).product_type.code, 'pepper')
