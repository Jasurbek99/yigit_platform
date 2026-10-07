"""Pepper spec 2026-10-05: every quota call for a shipment uses the shipment's product."""
import datetime
from decimal import Decimal

from django.core.cache import cache
from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import (
    Country, Customer, ExportFirm, GreenhouseBlock, ProductType, Season,
    ShipmentStatusType, TomatoVariety, User,
)
from apps.export.models import (
    QuotaIssuance, QuotaIssuanceFirmAllocation, QuotaUsageRecord, Shipment,
    ShipmentBlockSource,
)
from apps.export.services_quota import compute_firm_quota_balances


def _user(username, role):
    user = User(username=username, role=role)
    user.set_password('pass')
    user.save()
    return user


class PepperQuotaTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')

    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.em = _user('pq_em', 'export_manager')
        self.season, _ = Season.objects.get_or_create(
            name='pq-test',
            defaults={'start_date': '2026-08-01', 'end_date': '2027-07-01', 'is_active': True},
        )
        self.draft, _ = ShipmentStatusType.objects.get_or_create(
            code='draft',
            defaults={'name_tk': 'd', 'name_en': 'd', 'step_order': 0, 'phase': 'DRAFT'},
        )
        self.tomato = ProductType.objects.get(code='tomato')
        self.pepper = ProductType.objects.get(code='pepper')
        self.pb = GreenhouseBlock.objects.create(
            code='QP', variety_main=TomatoVariety.objects.get(name='Maranella'),
        )
        self.country, _ = Country.objects.get_or_create(
            code='PQ', defaults={'name_tk': 'P', 'name_en': 'P', 'name_ru': 'P'},
        )
        self.customer, _ = Customer.objects.get_or_create(name='PQCustomer')
        self.firm = ExportFirm.objects.create(code='PQF', name_tk='PQF', name_en='PQF')
        self._allocate('tomato', '50000')
        self.pepper_row = self._row(self.pepper)

    def _allocate(self, product_type, kg):
        issuance = QuotaIssuance.objects.create(
            issue_date=datetime.date.today(), product_type=product_type,
            validity='this_month', season=self.season,
        )
        QuotaIssuanceFirmAllocation.objects.create(
            issuance=issuance, export_firm=self.firm, kg_quota=Decimal(kg),
        )
        cache.clear()

    def _row(self, product):
        row = Shipment.objects.create(
            shipment_code='0610801/26', date=datetime.date(2026, 10, 6),
            season=self.season, status=self.draft, product_type=product,
            country=self.country, customer=self.customer, created_by=self.em,
        )
        ShipmentBlockSource.objects.create(
            shipment=row, block=self.pb, weight_kg=Decimal('9000'),
        )
        return row

    def _split(self, row):
        self.client.force_authenticate(self.em)
        return self.client.post(
            f'/api/v1/export/shipments/{row.id}/firm-splits/',
            {'firms': [{'export_firm_id': self.firm.id}]}, format='json',
        )

    def test_pepper_split_refused_without_pepper_quota(self):
        resp = self._split(self.pepper_row)
        self.assertEqual(resp.status_code, 400, resp.content[:300])
        self.assertIn('no remaining quota', resp.data['error'])
        self.assertFalse(QuotaUsageRecord.objects.filter(shipment=self.pepper_row).exists())

    def test_pepper_split_with_pepper_quota_writes_pepper_usage(self):
        self._allocate('pepper', '50000')
        resp = self._split(self.pepper_row)
        self.assertEqual(resp.status_code, 200, resp.content[:300])
        rows = QuotaUsageRecord.objects.filter(shipment=self.pepper_row)
        self.assertEqual(rows.count(), 1)
        self.assertEqual(rows.first().product_type, 'pepper')

    def test_tomato_split_still_writes_tomato_usage(self):
        resp = self._split(self._row_tomato())
        self.assertEqual(resp.status_code, 200, resp.content[:300])
        self.assertEqual(
            QuotaUsageRecord.objects.get(shipment__shipment_code='0610802/26').product_type,
            'tomato',
        )

    def _row_tomato(self):
        row = Shipment.objects.create(
            shipment_code='0610802/26', date=datetime.date(2026, 10, 6),
            season=self.season, status=self.draft, product_type=self.tomato,
            country=self.country, customer=self.customer, created_by=self.em,
        )
        return row

    def test_tomato_balance_untouched_by_pepper_truck(self):
        self._allocate('pepper', '50000')
        before = compute_firm_quota_balances('tomato', self.season)[self.firm.id]['remaining_kg']
        self.assertEqual(self._split(self.pepper_row).status_code, 200)
        cache.clear()
        after = compute_firm_quota_balances('tomato', self.season)[self.firm.id]['remaining_kg']
        self.assertEqual(before, after)

    def test_create_draft_with_pepper_firm_split_checks_pepper_quota(self):
        self.client.force_authenticate(self.em)
        payload = {
            'is_draft': True, 'skip_forecast_check': True,
            'block_sources': [{'block_id': self.pb.id, 'weight_kg': '16800'}],
            'firm_splits': [{'export_firm': self.firm.id, 'weight_kg': '9000'}],
        }
        resp = self.client.post('/api/v1/export/shipments/', payload, format='json')
        self.assertGreaterEqual(resp.status_code, 400, resp.content[:300])
        self.assertIn('no remaining quota', str(resp.data))

        self._allocate('pepper', '50000')
        resp = self.client.post('/api/v1/export/shipments/', payload, format='json')
        self.assertEqual(resp.status_code, 201, resp.content[:300])
        usage = QuotaUsageRecord.objects.filter(shipment__shipment_code=resp.data['shipment_code'])
        self.assertEqual([u.product_type for u in usage], ['pepper'])
