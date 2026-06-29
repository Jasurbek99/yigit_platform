"""Admin-only hard-delete of a draft shipment from the detail page.

Covers POST /api/v1/export/shipments/{id}/hard-delete/:
  - admin permanently deletes a draft (row + cascade rows gone)
  - non-admin role is rejected with 403
  - a non-draft shipment is rejected with 400 (cancel/soft-delete instead)

Run:
    python manage.py test apps.export.tests_hard_delete_draft --keepdb
"""
import datetime as dt

from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import Season, ShipmentStatusType, User
from apps.export.models import Shipment, ShipmentComment


def _make_user(username: str, role: str) -> User:
    return User.objects.create_user(username=username, password='pw', role=role)


def _make_status(code: str, step_order: int, name_en: str) -> ShipmentStatusType:
    obj, _ = ShipmentStatusType.objects.get_or_create(
        code=code,
        defaults={
            'name_tk': code, 'name_en': name_en, 'name_ru': name_en,
            'step_order': step_order, 'phase': 'PREP',
        },
    )
    return obj


class HardDeleteDraftTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        _make_status('draft', 0, 'Draft')
        _make_status('yuklenme', 1, 'Loading')
        cls.admin = _make_user('admin_hd', 'admin')
        cls.manager = _make_user('manager_hd', 'export_manager')
        cls.season, _ = Season.objects.get_or_create(
            name='2025',
            defaults={'start_date': '2025-01-01', 'end_date': '2025-12-31', 'is_active': True},
        )

    def setUp(self):
        self.client = APIClient()

    def _make_draft(self, code: str, status_code: str = 'draft') -> Shipment:
        return Shipment.objects.create(
            shipment_code=code,
            date=dt.date(2025, 1, 1),
            season=self.season,
            status=ShipmentStatusType.objects.get(code=status_code),
            created_by=self.admin,
        )

    def test_admin_hard_deletes_draft_and_cascade(self):
        ship = self._make_draft('0101001/25')
        ShipmentComment.objects.create(shipment=ship, user=self.admin, content='note')
        self.client.force_authenticate(user=self.admin)

        resp = self.client.post(f'/api/v1/export/shipments/{ship.pk}/hard-delete/')

        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.data['deleted'], 1)
        self.assertFalse(Shipment.objects.filter(pk=ship.pk).exists())
        self.assertFalse(ShipmentComment.objects.filter(shipment_id=ship.pk).exists())

    def test_non_admin_rejected_403(self):
        ship = self._make_draft('0101002/25')
        self.client.force_authenticate(user=self.manager)

        resp = self.client.post(f'/api/v1/export/shipments/{ship.pk}/hard-delete/')

        self.assertEqual(resp.status_code, 403, resp.data)
        self.assertTrue(Shipment.objects.filter(pk=ship.pk).exists())

    def test_non_draft_rejected_400(self):
        ship = self._make_draft('0101003/25', status_code='yuklenme')
        self.client.force_authenticate(user=self.admin)

        resp = self.client.post(f'/api/v1/export/shipments/{ship.pk}/hard-delete/')

        self.assertEqual(resp.status_code, 400, resp.data)
        self.assertTrue(Shipment.objects.filter(pk=ship.pk).exists())
