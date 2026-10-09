"""The lot's first sale fills the shipment's lifecycle fields so auto-advance reaches «satylyar» (spec §5)."""
from io import StringIO
from unittest import mock

from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.export.models import AuditLog, ExpenseCategory, Shipment
from apps.export.services.task_rules import generate_tasks_for_status
from apps.market.models import Lot, Sale
from apps.market.services.status import drive_first_sale
from apps.market.tests.factories import make_shipment, make_world

ON_THE_ROAD = 'Машина ещё в пути — продавать можно после таможни назначения.'
SALE = {'unit': 'box', 'qty': 10, 'gross_kg': '104.50', 'price_kg': '45', 'paid_on_spot': True}


class FirstSaleDrivesStatusTests(TestCase):

    @classmethod
    def setUpTestData(cls):
        cls.w = make_world()
        call_command('seed_task_rules', stdout=StringIO())

    def _lot_at(self, code: str, status_code: str, seller=None, **extra) -> Lot:
        """A shipment at `status_code` with its step tasks, and a received lot on it."""
        shipment = make_shipment(self.w, code, status_code, **extra)
        generate_tasks_for_status(shipment, status_code)
        return Lot.objects.create(shipment=shipment, seller=seller or self.w.seller, boxes_received=100,
                                  boxes_per_pallet=50, tare_g=450, currency='KZT', opened_by=self.w.agent)

    def _sell(self, lot: Lot, seller=None):
        client = APIClient()
        client.force_authenticate(user=seller or self.w.seller)
        with self.captureOnCommitCallbacks(execute=True):
            resp = client.post(f'/api/v1/market/lots/{lot.pk}/sales/', SALE, format='json')
        self.assertEqual(resp.status_code, 201, resp.content)
        return resp

    def _shipment(self, lot: Lot) -> Shipment:
        return Shipment.objects.select_related('status').get(pk=lot.shipment_id)

    def test_bardy_with_city_moves_to_satylyar(self):
        lot = self._lot_at('ST-1', 'bardy', city=self.w.city)
        self._sell(lot)
        shipment = self._shipment(lot)
        self.assertEqual(shipment.status.code, 'satylyar')
        self.assertIsNotNone(shipment.sale_started_at)

    def test_city_filled_from_the_sellers_bazaar(self):
        lot = self._lot_at('ST-2', 'bardy')
        self._sell(lot)
        shipment = self._shipment(lot)
        self.assertEqual(shipment.city_id, self.w.city.pk)
        self.assertEqual(shipment.status.code, 'satylyar')

    def test_no_city_anywhere_stays_bardy(self):
        lot = self._lot_at('ST-3', 'bardy', seller=self.w.seller2)
        self._sell(lot, seller=self.w.seller2)
        shipment = self._shipment(lot)
        self.assertEqual(shipment.status.code, 'bardy')
        self.assertIsNone(shipment.city_id)
        self.assertIsNotNone(shipment.sale_started_at)

    def test_barysh_gumrugi_gets_arrival(self):
        lot = self._lot_at('ST-4', 'barysh_gumrugi', has_peregruz=False)
        self._sell(lot)
        shipment = self._shipment(lot)
        self.assertIsNotNone(shipment.arrived_at)
        # The cascade walks on: bardy's sale-start and city tasks are already met → satylyar.
        self.assertEqual(shipment.status.code, 'satylyar')

    def test_second_sale_changes_nothing(self):
        lot = self._lot_at('ST-5', 'bardy', city=self.w.city)
        self._sell(lot)
        first = self._shipment(lot)
        audit_count = AuditLog.objects.filter(model_name='Shipment', object_id=first.pk).count()
        self._sell(lot)
        second = self._shipment(lot)
        self.assertEqual(second.sale_started_at, first.sale_started_at)
        self.assertEqual(second.status.code, first.status.code)
        self.assertEqual(AuditLog.objects.filter(model_name='Shipment', object_id=first.pk).count(), audit_count)

    def test_rerun_after_all_sales_deleted_changes_nothing(self):
        """create_sale schedules it again when the lot's sales were all deleted — nothing is left to fill."""
        lot = self._lot_at('ST-9', 'bardy', city=self.w.city)
        self._sell(lot)
        first = self._shipment(lot)
        audit_count = AuditLog.objects.filter(model_name='Shipment', object_id=first.pk).count()
        self.assertFalse(drive_first_sale(lot.pk, self.w.seller))
        again = self._shipment(lot)
        self.assertEqual(again.sale_started_at, first.sale_started_at)
        self.assertEqual(AuditLog.objects.filter(model_name='Shipment', object_id=first.pk).count(), audit_count)

    def test_on_the_road_refuses_sales_and_spoilage_but_takes_expenses(self):
        lot = self._lot_at('ST-10', 'dest_entry')
        client = APIClient()
        client.force_authenticate(user=self.w.seller)
        base = f'/api/v1/market/lots/{lot.pk}'
        sale = client.post(f'{base}/sales/', SALE, format='json')
        self.assertEqual(sale.status_code, 400, sale.content)
        self.assertEqual(sale.json()['error'], ON_THE_ROAD)
        spoil = client.post(f'{base}/spoilage/', {'boxes': 1}, format='json')
        self.assertEqual(spoil.status_code, 400, spoil.content)
        self.assertEqual(spoil.json()['error'], ON_THE_ROAD)
        expense = client.post(f'{base}/expenses/', {'rows': [
            {'category_id': ExpenseCategory.objects.get(code='KARA').pk, 'amount': '500'}]}, format='json')
        self.assertEqual(expense.status_code, 201, expense.content)

    def test_closed_season_leaves_the_shipment_alone(self):
        lot = self._lot_at('ST-6', 'bardy')
        season = self.w.season
        season.closed_at = timezone.now()
        season.is_active = False
        season.save()
        self._sell(lot)
        shipment = self._shipment(lot)
        self.assertEqual(shipment.status.code, 'bardy')
        self.assertIsNone(shipment.sale_started_at)
        self.assertIsNone(shipment.city_id)
        self.assertEqual(Sale.objects.filter(lot=lot).count(), 1)

    def test_a_failing_save_keeps_the_sale(self):
        lot = self._lot_at('ST-7', 'bardy', city=self.w.city)
        with mock.patch.object(Shipment, 'save', side_effect=RuntimeError('boom')), \
                self.assertLogs('apps.market.services.status', level='ERROR'):
            self._sell(lot)
        self.assertEqual(Sale.objects.filter(lot=lot).count(), 1)
        shipment = self._shipment(lot)
        self.assertEqual(shipment.status.code, 'bardy')
        self.assertIsNone(shipment.sale_started_at)

    def test_filled_fields_are_audited(self):
        lot = self._lot_at('ST-8', 'bardy')
        self._sell(lot)
        fields = set(AuditLog.objects.filter(model_name='Shipment', object_id=lot.shipment_id, user=self.w.seller)
                     .values_list('field_name', flat=True))
        self.assertTrue({'sale_started_at', 'city'} <= fields, fields)
