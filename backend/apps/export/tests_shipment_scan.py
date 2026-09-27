"""Tests for GET/POST /export/shipments/{id}/scan/ — pallet QR scan."""
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import Season, ShipmentStatusType, User
from apps.export.management.commands.seed_task_rules import (
    Command as SeedTaskRulesCommand,
)
from apps.export.models import AuditLog, Shipment
from apps.export.services.task_rules import generate_tasks_for_status

STATUSES = [
    'yuklenme', 'yola_chykdy', 'serhet_gechdi', 'dest_entry', 'barysh_gumrugi',
    'transshipment', 'bardy', 'satylyar', 'satyldy', 'tamamlandy',
]


class ShipmentScanTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        for order, code in enumerate(STATUSES):
            ShipmentStatusType.objects.create(
                code=code, name_tk=code, name_en=code, step_order=order, phase='TRANSIT',
            )
        SeedTaskRulesCommand().handle(reset=False)
        cls.season = Season.objects.create(
            name='scan', start_date='2025-09-01', end_date='2026-06-30', is_active=True,
        )
        cls.admin = User.objects.create_user(
            username='scan_admin', password='pw', role='admin', is_superuser=True,
        )

    def _shipment(self, status_code: str, **extra) -> Shipment:
        shipment = Shipment.objects.create(
            shipment_code='0000002/26', date='2026-01-15', season=self.season,
            status=ShipmentStatusType.objects.get(code=status_code),
            export_code='12JN121/26', **extra,
        )
        generate_tasks_for_status(shipment, status_code)
        return shipment

    def _client(self, user) -> APIClient:
        client = APIClient()
        client.force_authenticate(user)
        return client

    def _url(self, shipment) -> str:
        return f'/api/v1/export/shipments/{shipment.pk}/scan/'

    def test_get_shows_next_trigger_field(self):
        shipment = self._shipment('yola_chykdy')
        resp = self._client(self.admin).get(self._url(shipment))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['status'], 'yola_chykdy')
        self.assertEqual(resp.data['field'], 'border_crossed_at')
        self.assertEqual(resp.data['export_code'], '12JN121/26')

    def test_post_fills_field_and_advances_status(self):
        shipment = self._shipment('yola_chykdy')
        resp = self._client(self.admin).post(
            self._url(shipment), {'field': 'border_crossed_at'}, format='json',
        )
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.data['recorded'])
        self.assertEqual(resp.data['status'], 'serhet_gechdi')
        self.assertEqual(resp.data['field'], 'dest_entry_at')
        shipment.refresh_from_db()
        self.assertIsNotNone(shipment.border_crossed_at)
        self.assertTrue(AuditLog.objects.filter(field_name='border_crossed_at').exists())

    def test_repeat_scan_is_noop(self):
        shipment = self._shipment('yola_chykdy')
        client = self._client(self.admin)
        client.post(self._url(shipment), {'field': 'border_crossed_at'}, format='json')
        first = Shipment.objects.get(pk=shipment.pk).border_crossed_at

        resp = client.post(self._url(shipment), {'field': 'border_crossed_at'}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(resp.data['recorded'])
        self.assertEqual(resp.data['status'], 'serhet_gechdi')
        self.assertEqual(Shipment.objects.get(pk=shipment.pk).border_crossed_at, first)

    def test_explicit_occurred_at_is_used(self):
        shipment = self._shipment('yola_chykdy')
        self._client(self.admin).post(
            self._url(shipment),
            {'field': 'border_crossed_at', 'occurred_at': '2026-01-20T08:30:00Z'},
            format='json',
        )
        shipment.refresh_from_db()
        self.assertEqual(shipment.border_crossed_at.isoformat(), '2026-01-20T08:30:00+00:00')

    def test_field_of_other_step_is_400(self):
        shipment = self._shipment('yola_chykdy')
        resp = self._client(self.admin).post(
            self._url(shipment), {'field': 'arrived_at'}, format='json',
        )
        self.assertEqual(resp.status_code, 400)

    def test_before_departure_nothing_to_scan(self):
        shipment = self._shipment('yuklenme')
        resp = self._client(self.admin).get(self._url(shipment))
        self.assertIsNone(resp.data['field'])

    def test_peregruz_fork_asks_for_peregruz_date(self):
        shipment = self._shipment('barysh_gumrugi', has_peregruz=True)
        resp = self._client(self.admin).get(self._url(shipment))
        self.assertEqual(resp.data['field'], 'peregruz_date')

    def test_bardy_skips_city_and_asks_for_sale_start(self):
        shipment = self._shipment('bardy')
        resp = self._client(self.admin).get(self._url(shipment))
        self.assertEqual(resp.data['field'], 'sale_started_at')

    def test_role_without_field_grant_is_403(self):
        shipment = self._shipment('yola_chykdy')
        user = User.objects.create_user(username='scan_fin', password='pw', role='finansist')
        resp = self._client(user).post(
            self._url(shipment), {'field': 'border_crossed_at'}, format='json',
        )
        self.assertEqual(resp.status_code, 403)
        self.assertIn('cannot record this step', resp.data['error'])
        shipment.refresh_from_db()
        self.assertIsNone(shipment.border_crossed_at)
