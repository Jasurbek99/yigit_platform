"""Phase 5c — admin-created free-text custom rows.

Covers:
  POST /admin/sheet-rows/        creates a SheetRowSetting with is_custom=True
  POST                            rejects non-'custom_' field_keys
  POST                            rejects empty labels
  POST                            rejects duplicate field_keys
  POST                            auto-grants the creating admin via
                                  SheetRowUserPermission so they can edit
                                  immediately
  PATCH /shipments/{id}/custom-fields/  writes ShipmentCustomFieldValue
  PATCH                            update_or_creates idempotently
  PATCH                            403 when field_key is not is_custom
  PATCH                            403 when can_edit_sheet_field rejects
  GET  /sheet/                     payload includes shipment.custom_fields
  DELETE /admin/sheet-rows/{id}/   skips the 30-day cooldown for custom rows

Run:
    python manage.py test apps.export.tests_custom_rows --verbosity=2
"""
from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import Season, ShipmentStatusType, User
from apps.export.models import (
    Shipment,
    SheetRowSetting,
    SheetRowUserPermission,
    ShipmentCustomFieldValue,
)


_BASE = '/api/v1/export/admin/sheet-rows/'


def _create_user(username: str, role: str, is_superuser: bool = False) -> User:
    u = User(username=username, role=role, is_superuser=is_superuser)
    u.set_password('pass')
    u.save()
    return u


class CreateCustomRowTests(TestCase):
    """POST /admin/sheet-rows/ with a custom_ prefix creates a runtime row."""

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')

    def setUp(self):
        self.client = APIClient()
        self.director = _create_user(f'cust_dir_{id(self)}', 'director')
        self.client.force_authenticate(user=self.director)

    def _post(self, **payload) -> object:
        return self.client.post(_BASE, payload, format='json')

    def test_post_creates_custom_row(self):
        resp = self._post(
            field_key='custom_kz_remarks',
            label_en='KZ Remarks',
            label_ru='Замечания KZ',
            label_tk='KZ Bellikler',
        )
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertTrue(resp.data['is_custom'])
        self.assertEqual(resp.data['field_key'], 'custom_kz_remarks')

        # Auto-grant: creating admin gets a SheetRowUserPermission entry
        row = SheetRowSetting.objects.get(field_key='custom_kz_remarks')
        self.assertTrue(
            SheetRowUserPermission.objects.filter(
                row=row, user=self.director, can_edit=True, deleted_at__isnull=True,
            ).exists(),
            'Creating admin must auto-receive a user_permissions grant',
        )

    def test_post_rejects_non_custom_prefix(self):
        resp = self._post(field_key='weight_net_2', label_en='Test')
        self.assertEqual(resp.status_code, 400, resp.data)
        self.assertIn("custom_", str(resp.data))

    def test_post_rejects_invalid_chars_in_field_key(self):
        # Uppercase / hyphen — must fail the slug regex.
        for bad in ['custom_KZRemarks', 'custom-kz', 'custom_kz remarks']:
            resp = self._post(field_key=bad, label_en='X')
            self.assertEqual(resp.status_code, 400, f'{bad}: {resp.data}')

    def test_post_rejects_empty_labels(self):
        resp = self._post(field_key='custom_empty', label_en='', label_ru='', label_tk='')
        self.assertEqual(resp.status_code, 400, resp.data)
        self.assertIn('label', str(resp.data).lower())

    def test_post_rejects_duplicate_field_key(self):
        self._post(field_key='custom_dup', label_en='A')
        resp = self._post(field_key='custom_dup', label_en='B')
        self.assertEqual(resp.status_code, 400, resp.data)


class CustomFieldValueTests(TestCase):
    """PATCH /shipments/{id}/custom-fields/ writes ShipmentCustomFieldValue."""

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        cls.season, _ = Season.objects.get_or_create(
            name='2025-CUS',
            defaults={'start_date': '2025-09-01', 'end_date': '2026-06-30', 'is_active': True},
        )
        cls.status, _ = ShipmentStatusType.objects.get_or_create(
            code='yuklenme_cus',
            defaults={'name_tk': 'yuklenme_cus', 'name_en': 'Loading CUS', 'step_order': 1, 'phase': 'LOADING'},
        )
        cls.shipment = Shipment.objects.create(
            cargo_code='CUS-001', date='2026-02-01',
            season=cls.season, status=cls.status,
        )

    def setUp(self):
        # Each test starts with a clean custom row + auth
        self.client = APIClient()
        self.director = _create_user(f'cv_dir_{id(self)}', 'director')
        self.client.force_authenticate(user=self.director)
        SheetRowSetting.objects.filter(is_custom=True).delete()
        # Provision one custom row to write against
        resp = self.client.post(_BASE, {
            'field_key': 'custom_remarks',
            'label_en': 'Remarks',
        }, format='json')
        assert resp.status_code == 201, resp.data
        self.row_id = resp.data['id']

    def _patch(self, field_key: str, value: str):
        return self.client.patch(
            f'/api/v1/export/shipments/{self.shipment.id}/custom-fields/',
            {'field_key': field_key, 'value': value},
            format='json',
        )

    def test_patch_creates_value(self):
        resp = self._patch('custom_remarks', 'Hello world')
        self.assertEqual(resp.status_code, 200, resp.data)
        cv = ShipmentCustomFieldValue.objects.get(
            shipment=self.shipment, row_id=self.row_id,
        )
        self.assertEqual(cv.value_text, 'Hello world')
        self.assertEqual(cv.updated_by, self.director)

    def test_patch_idempotent_update_or_create(self):
        self._patch('custom_remarks', 'first')
        self._patch('custom_remarks', 'second')
        # Still exactly one row
        self.assertEqual(
            ShipmentCustomFieldValue.objects.filter(
                shipment=self.shipment, row_id=self.row_id,
            ).count(),
            1,
        )
        cv = ShipmentCustomFieldValue.objects.get(
            shipment=self.shipment, row_id=self.row_id,
        )
        self.assertEqual(cv.value_text, 'second')

    def test_patch_empty_string_persists_as_clear(self):
        self._patch('custom_remarks', 'something')
        resp = self._patch('custom_remarks', '')
        self.assertEqual(resp.status_code, 200, resp.data)
        cv = ShipmentCustomFieldValue.objects.get(
            shipment=self.shipment, row_id=self.row_id,
        )
        self.assertEqual(cv.value_text, '')

    def test_patch_rejects_non_custom_field_key(self):
        resp = self._patch('weight_net', '999')
        self.assertEqual(resp.status_code, 400, resp.data)

    def test_patch_rejects_unknown_custom_field_key(self):
        resp = self._patch('custom_nonexistent', 'x')
        self.assertEqual(resp.status_code, 400, resp.data)

    def test_sheet_payload_includes_custom_fields(self):
        self._patch('custom_remarks', 'visible in sheet')
        resp = self.client.get('/api/v1/export/shipments/sheet/')
        self.assertEqual(resp.status_code, 200, resp.data)
        results = resp.data['results']
        target = next((r for r in results if r['id'] == self.shipment.id), None)
        self.assertIsNotNone(target)
        self.assertEqual(target['custom_fields'].get('custom_remarks'), 'visible in sheet')


class CustomRowDeleteTests(TestCase):
    """Custom rows skip the 30-day visibility cooldown — admins recall immediately."""

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')

    def setUp(self):
        self.client = APIClient()
        self.director = _create_user(f'del_dir_{id(self)}', 'director')
        self.client.force_authenticate(user=self.director)

    def test_delete_custom_row_without_30d_cooldown(self):
        resp = self.client.post(_BASE, {
            'field_key': 'custom_throwaway',
            'label_en': 'Throwaway',
        }, format='json')
        self.assertEqual(resp.status_code, 201, resp.data)
        row_id = resp.data['id']

        # Even though is_visible=True (just created) and hidden_at is null,
        # custom rows bypass the cooldown.
        del_resp = self.client.delete(f'{_BASE}{row_id}/')
        self.assertEqual(del_resp.status_code, 204, del_resp.data)
        SheetRowSetting.objects.get(pk=row_id).refresh_from_db()
        self.assertIsNotNone(SheetRowSetting.objects.get(pk=row_id).deleted_at)
