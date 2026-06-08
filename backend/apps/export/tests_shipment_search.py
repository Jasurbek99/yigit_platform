"""Shipment list search — `?search=` matches operator-entered identifiers.

The Shipments list (and ProTable search box) must find a truck not only by its
platform cargo_code but by the fields staff actually remember in the field:
the official export code, the driver's name, the driver's phone, and the truck
plate. This locks in `ShipmentViewSet.search_fields`.

Run:
    python manage.py test apps.export.tests_shipment_search --keepdb
"""
import datetime as dt

from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import Season, ShipmentStatusType, User
from apps.export.models import Shipment


def _make_season() -> Season:
    season, _ = Season.objects.get_or_create(
        name='2025',
        defaults={'start_date': '2025-01-01', 'end_date': '2025-12-31', 'is_active': True},
    )
    return season


def _make_status() -> ShipmentStatusType:
    obj, _ = ShipmentStatusType.objects.get_or_create(
        code='yuklenme',
        defaults={
            'name_tk': 'yuklenme', 'name_en': 'Loading', 'name_ru': 'Loading',
            'step_order': 1, 'phase': 'LOADING',
        },
    )
    return obj


class ShipmentSearchTests(TestCase):
    """`?search=` matches cargo_code + official_export_code + driver/truck fields."""

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        season = _make_season()
        status = _make_status()
        cls.user = User.objects.create_user(username='searcher', password='pw', role='admin')

        # The target row — every searchable field carries a unique token.
        cls.target = Shipment.objects.create(
            cargo_code='0101001/25',
            official_export_code='02|FB|777|FA|25|--',
            driver_name='Berdimyrat Annaýew',
            driver_phone='+99365123456',
            truck_plate='AG7788BX',
            date=dt.date(2025, 1, 1),
            season=season,
            status=status,
            created_by=cls.user,
        )
        # A decoy row that must NOT match any of the target's tokens.
        cls.decoy = Shipment.objects.create(
            cargo_code='0202002/25',
            official_export_code='03|GH|111|GB|25|--',
            driver_name='Myrat Geldiýew',
            driver_phone='+99362999000',
            truck_plate='MR0011CD',
            date=dt.date(2025, 1, 2),
            season=season,
            status=status,
            created_by=cls.user,
        )

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def _search_ids(self, term: str) -> set[int]:
        resp = self.client.get('/api/v1/export/shipments/', {'search': term})
        self.assertEqual(resp.status_code, 200, resp.data)
        return {row['id'] for row in resp.json()['results']}

    def test_search_by_official_export_code(self):
        ids = self._search_ids('777')
        self.assertIn(self.target.id, ids)
        self.assertNotIn(self.decoy.id, ids)

    def test_search_by_driver_name(self):
        ids = self._search_ids('Berdimyrat')
        self.assertIn(self.target.id, ids)
        self.assertNotIn(self.decoy.id, ids)

    def test_search_by_driver_phone(self):
        ids = self._search_ids('65123456')
        self.assertIn(self.target.id, ids)
        self.assertNotIn(self.decoy.id, ids)

    def test_search_by_truck_plate(self):
        ids = self._search_ids('AG7788BX')
        self.assertIn(self.target.id, ids)
        self.assertNotIn(self.decoy.id, ids)

    def test_search_by_cargo_code_still_works(self):
        ids = self._search_ids('0101001')
        self.assertIn(self.target.id, ids)
        self.assertNotIn(self.decoy.id, ids)
