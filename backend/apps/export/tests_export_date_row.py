"""Shipment «Дата экспорта» (export_date): editable real export day, auto-filled.

Effective value = stored export_date > date parsed from export_code > Shipment.date.
Shipment.date (plan day) is never touched.
"""
import datetime as dt

from django.core.management import call_command
from django.test import SimpleTestCase, TestCase
from rest_framework.test import APIClient

from apps.core.models import Season, ShipmentStatusType, User
from apps.core.permission_registry import RESOURCE_FIELDS
from apps.export.models import Shipment
from apps.export.serializers import _ALL_PATCHABLE_FIELDS
from apps.export.services.comments import SHEET_FIELD_KEYS
from apps.export.services.export_code import effective_export_date
from apps.export.sheet_rows import DEFAULT_SHEET_ROWS


class ExportDateRowConfigTests(SimpleTestCase):

    def test_row_sits_right_after_export_code(self):
        keys = [r['field_key'] for r in DEFAULT_SHEET_ROWS]
        self.assertEqual(keys.index('export_date'), keys.index('export_code') + 1)

    def test_row_shape(self):
        row = next(r for r in DEFAULT_SHEET_ROWS if r['field_key'] == 'export_date')
        self.assertEqual(row['row_number'], 50)
        self.assertEqual(row['input_type'], 'date')
        self.assertEqual(row['label_key'], 'sheet.row.export_date')
        self.assertFalse(row.get('gapy_hidden', False))

    def test_registered_everywhere(self):
        self.assertIn('export_date', _ALL_PATCHABLE_FIELDS)
        self.assertIn('export_date', RESOURCE_FIELDS['shipment'])
        self.assertIn('export_date', SHEET_FIELD_KEYS)


class EffectiveExportDateTests(SimpleTestCase):

    class _S:
        def __init__(self, **kw):
            self.__dict__.update(kw)

    def test_stored_beats_code_beats_date(self):
        S = self._S
        plan = dt.date(2026, 6, 1)
        self.assertEqual(
            effective_export_date(S(export_date=dt.date(2026, 6, 20), export_code='12JN121/26', date=plan)),
            dt.date(2026, 6, 20))
        self.assertEqual(
            effective_export_date(S(export_date=None, export_code='12JN121/26', date=plan)),
            dt.date(2026, 6, 12))
        self.assertEqual(
            effective_export_date(S(export_date=None, export_code='junk', date=plan)), plan)

    def test_mock_without_new_attributes(self):
        self.assertEqual(effective_export_date(self._S(date=dt.date(2026, 3, 16))), dt.date(2026, 3, 16))


class ExportDateApiTests(TestCase):

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions', verbosity=0)
        cls.editor = User.objects.create_user(username='ed_wc', password='pw', role='warehouse_chief')
        cls.outsider = User.objects.create_user(username='ed_sales', password='pw', role='sales_rep')
        season, _ = Season.objects.get_or_create(
            name='2026', defaults={'start_date': '2026-01-01', 'end_date': '2026-12-31', 'is_active': True},
        )
        status, _ = ShipmentStatusType.objects.get_or_create(
            code='yuklenme', defaults={
                'name_tk': 'yuklenme', 'name_en': 'Yuklenme', 'name_ru': 'Yuklenme',
                'step_order': 1, 'phase': 'LOADING',
            },
        )
        cls.season, cls.status = season, status

    def setUp(self):
        self.shipment = Shipment.objects.create(
            shipment_code='0601001/26', date=dt.date(2026, 6, 1), season=self.season,
            status=self.status, created_by=self.editor,
        )
        self.url = f'/api/v1/export/shipments/{self.shipment.pk}/'

    def _client(self, user):
        c = APIClient()
        c.force_authenticate(user=user)
        return c

    def test_defaults_to_shipment_date(self):
        resp = self._client(self.editor).get(self.url)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['export_date'], '2026-06-01')

    def test_export_code_date_beats_plan_date(self):
        self.shipment.export_code = '12JN121/26'
        self.shipment.save()
        resp = self._client(self.editor).get(self.url)
        self.assertEqual(resp.data['export_date'], '2026-06-12')

    def test_patch_stores_and_returns_effective_value(self):
        self.shipment.export_code = '12JN121/26'
        self.shipment.save()
        resp = self._client(self.editor).patch(self.url, {'export_date': '2026-06-20'}, format='json')
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.data['export_date'], '2026-06-20')
        self.shipment.refresh_from_db()
        self.assertEqual(self.shipment.export_date, dt.date(2026, 6, 20))
        self.assertEqual(self.shipment.date, dt.date(2026, 6, 1))  # plan day untouched

    def test_patch_null_clears_back_to_auto(self):
        self.shipment.export_date = dt.date(2026, 6, 20)
        self.shipment.save()
        resp = self._client(self.editor).patch(self.url, {'export_date': None}, format='json')
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.data['export_date'], '2026-06-01')
        self.shipment.refresh_from_db()
        self.assertIsNone(self.shipment.export_date)

    def test_non_editor_role_gets_403(self):
        resp = self._client(self.outsider).patch(self.url, {'export_date': '2026-06-20'}, format='json')
        self.assertEqual(resp.status_code, 403)
        self.shipment.refresh_from_db()
        self.assertIsNone(self.shipment.export_date)

    def test_sheet_payload_carries_effective_value(self):
        self.shipment.export_code = '12JN121/26'
        self.shipment.save()
        resp = self._client(self.editor).get('/api/v1/export/shipments/sheet/')
        self.assertEqual(resp.status_code, 200)
        body = resp.data['results'] if isinstance(resp.data, dict) else resp.data
        row = next(r for r in body if r['id'] == self.shipment.pk)
        self.assertEqual(row['export_date'], '2026-06-12')
