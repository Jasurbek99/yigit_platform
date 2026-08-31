"""Tests for per-cell Sheet colors.

Covers:
- POST /api/v1/export/shipments/{id}/set-cell-color/ — upsert, overwrite, clear
- Unknown field_key rejected (400)
- Open to every authenticated Sheet viewer (mirrors set-column-color): a role
  without shipment.can_edit may still paint a cell
- Deleted / archived shipments rejected (403)
- GET /shipments/sheet/ returns the `cell_colors` map
"""
from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import Country, Season, ShipmentStatusType, User
from apps.export.models import SheetCellColor, Shipment


def _create_user(username: str, role: str) -> User:
    user = User(username=username, role=role)
    user.set_password('pass')
    user.save()
    return user


class CellColorTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        cls.season, _ = Season.objects.get_or_create(
            name='2025-2026',
            defaults={'start_date': '2025-09-01', 'end_date': '2026-06-30', 'is_active': True},
        )
        cls.status, _ = ShipmentStatusType.objects.get_or_create(
            code='yuklenme',
            defaults={'name_tk': 'yuklenme', 'name_en': 'Loading', 'step_order': 1, 'phase': 'LOADING'},
        )
        cls.country, _ = Country.objects.get_or_create(
            name_en='Kazakhstan', defaults={'name_tk': 'Gazagystan'},
        )
        cls.shipment = Shipment.objects.create(
            shipment_code='CLR-001', date='2026-02-01', season=cls.season,
            status=cls.status, country=cls.country, weight_net='18000.00',
        )

    def setUp(self):
        self.client = APIClient()
        self.user = _create_user(f'mgr_clr_{id(self)}', 'export_manager')
        self.client.force_authenticate(user=self.user)
        self.url = f'/api/v1/export/shipments/{self.shipment.id}/set-cell-color/'

    def test_sets_a_cell_color(self):
        resp = self.client.post(self.url, {'field_key': 'country', 'color': '#ff00c8'}, format='json')
        self.assertEqual(resp.status_code, 200)
        row = SheetCellColor.objects.get(shipment=self.shipment, field_key='country')
        self.assertEqual(row.color, '#ff00c8')

    def test_overwrites_an_existing_color(self):
        SheetCellColor.objects.create(shipment=self.shipment, field_key='country', color='#ffffff')
        self.client.post(self.url, {'field_key': 'country', 'color': '#000000'}, format='json')
        self.assertEqual(SheetCellColor.objects.filter(shipment=self.shipment).count(), 1)
        self.assertEqual(
            SheetCellColor.objects.get(shipment=self.shipment, field_key='country').color,
            '#000000',
        )

    def test_null_color_clears_the_row(self):
        SheetCellColor.objects.create(shipment=self.shipment, field_key='country', color='#ffffff')
        resp = self.client.post(self.url, {'field_key': 'country', 'color': None}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(SheetCellColor.objects.filter(shipment=self.shipment).exists())

    def test_truncates_hex_with_alpha(self):
        self.client.post(self.url, {'field_key': 'country', 'color': '#ff00c8ff'}, format='json')
        self.assertEqual(
            SheetCellColor.objects.get(shipment=self.shipment, field_key='country').color,
            '#ff00c8',
        )

    def test_unknown_field_key_rejected(self):
        resp = self.client.post(self.url, {'field_key': 'nope_not_a_row', 'color': '#ffffff'}, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertFalse(SheetCellColor.objects.filter(shipment=self.shipment).exists())

    def test_open_to_a_role_without_shipment_edit(self):
        """Same rule as set-column-color — the color is decoration, not data."""
        viewer = _create_user(f'acct_clr_{id(self)}', 'accountant')
        client = APIClient()
        client.force_authenticate(user=viewer)
        resp = client.post(self.url, {'field_key': 'country', 'color': '#00ffae'}, format='json')
        self.assertEqual(resp.status_code, 200)

    def test_anonymous_blocked(self):
        resp = APIClient().post(self.url, {'field_key': 'country', 'color': '#ffffff'}, format='json')
        self.assertEqual(resp.status_code, 401)

    def test_deleted_shipment_rejected(self):
        from django.utils import timezone
        self.shipment.deleted_at = timezone.now()
        self.shipment.save(update_fields=['deleted_at'])
        resp = self.client.post(self.url, {'field_key': 'country', 'color': '#ffffff'}, format='json')
        self.assertEqual(resp.status_code, 403)
        self.shipment.deleted_at = None
        self.shipment.save(update_fields=['deleted_at'])

    def test_sheet_payload_carries_cell_colors(self):
        SheetCellColor.objects.create(shipment=self.shipment, field_key='country', color='#ff00c8')
        resp = self.client.get('/api/v1/export/shipments/sheet/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(
            resp.data['cell_colors'][self.shipment.id],
            {'country': '#ff00c8'},
        )

    def test_sheet_payload_cell_colors_empty_by_default(self):
        resp = self.client.get('/api/v1/export/shipments/sheet/')
        self.assertEqual(resp.data['cell_colors'], {})
