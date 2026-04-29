"""Tests for SheetRowSettingViewSet — admin/sheet-rows/ endpoint.

Covers:
1. test_get_lists_all_rows_creates_missing
2. test_patch_role_clears_user
3. test_patch_writes_auditlog
4. test_export_manager_can_edit
5. test_accountant_cannot_edit
6. test_post_disabled
7. test_delete_disabled
"""
from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import User
from apps.export.models import AuditLog, SheetRowSetting
from apps.export.sheet_rows import DEFAULT_SHEET_ROWS


def _create_user(username: str, role: str, is_superuser: bool = False) -> User:
    user = User(username=username, role=role, is_superuser=is_superuser)
    user.set_password('pass')
    user.save()
    return user


class SheetRowSettingAdminTests(TestCase):
    """Tests for GET /api/v1/export/admin/sheet-rows/ and PATCH ./{field_key}/."""

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        cls.director = _create_user('director_srs', 'director')
        cls.export_manager = _create_user('mgr_srs', 'export_manager')
        cls.accountant = _create_user('acc_srs', 'accountant')
        cls.transport_user = _create_user('trans_srs', 'transport')

    def setUp(self):
        self.client = APIClient()
        # Clean SheetRowSetting between tests so auto-provision is clean
        SheetRowSetting.objects.all().delete()

    # ── Test 1 ──────────────────────────────────────────────────────────────

    def test_get_lists_all_rows_creates_missing(self):
        """GET as director on empty table auto-provisions all DEFAULT_SHEET_ROWS."""
        self.client.force_authenticate(user=self.director)

        resp = self.client.get('/api/v1/export/admin/sheet-rows/')

        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(len(resp.data), len(DEFAULT_SHEET_ROWS))

        # DB must now have exactly the same count
        self.assertEqual(SheetRowSetting.objects.count(), len(DEFAULT_SHEET_ROWS))

        # Every field_key from DEFAULT_SHEET_ROWS must appear in the response
        expected_keys = {row['field_key'] for row in DEFAULT_SHEET_ROWS}
        returned_keys = {r['field_key'] for r in resp.data}
        self.assertEqual(returned_keys, expected_keys)

    def test_get_idempotent_second_call(self):
        """Calling GET twice must not create duplicate rows."""
        self.client.force_authenticate(user=self.director)
        self.client.get('/api/v1/export/admin/sheet-rows/')
        self.client.get('/api/v1/export/admin/sheet-rows/')
        self.assertEqual(SheetRowSetting.objects.count(), len(DEFAULT_SHEET_ROWS))

    # ── Test 2 ──────────────────────────────────────────────────────────────

    def test_patch_role_clears_user(self):
        """PATCH with triggered_role auto-clears triggered_user (XOR auto-clear)."""
        self.client.force_authenticate(user=self.director)

        # Provision rows first
        self.client.get('/api/v1/export/admin/sheet-rows/')

        # Pick the weight_net row and set a user on it directly
        setting = SheetRowSetting.objects.get(field_key='weight_net')
        setting.triggered_user = self.transport_user
        setting.triggered_role = ''
        setting.save()

        # PATCH with only triggered_role — user should be cleared
        resp = self.client.patch(
            f'/api/v1/export/admin/sheet-rows/weight_net/',
            {'triggered_role': 'transport'},
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)

        setting.refresh_from_db()
        self.assertEqual(setting.triggered_role, 'transport')
        self.assertIsNone(setting.triggered_user_id)

        # Response shape confirms auto-clear
        self.assertIsNone(resp.data['triggered_user'])
        self.assertEqual(resp.data['triggered_role'], 'transport')

    def test_patch_user_clears_role(self):
        """PATCH with triggered_user auto-clears triggered_role (XOR auto-clear)."""
        self.client.force_authenticate(user=self.director)
        self.client.get('/api/v1/export/admin/sheet-rows/')

        setting = SheetRowSetting.objects.get(field_key='weight_net')
        setting.triggered_role = 'transport'
        setting.triggered_user = None
        setting.save()

        resp = self.client.patch(
            '/api/v1/export/admin/sheet-rows/weight_net/',
            {'triggered_user': self.transport_user.id},
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)

        setting.refresh_from_db()
        self.assertEqual(setting.triggered_role, '')
        self.assertEqual(setting.triggered_user_id, self.transport_user.id)

    def test_patch_both_non_empty_returns_400(self):
        """Sending both triggered_role and triggered_user non-empty → 400."""
        self.client.force_authenticate(user=self.director)
        self.client.get('/api/v1/export/admin/sheet-rows/')

        resp = self.client.patch(
            '/api/v1/export/admin/sheet-rows/weight_net/',
            {'triggered_role': 'transport', 'triggered_user': self.transport_user.id},
            format='json',
        )
        self.assertEqual(resp.status_code, 400, resp.data)

    # ── Test 3 ──────────────────────────────────────────────────────────────

    def test_patch_writes_auditlog(self):
        """PATCH triggered_role from '' to 'transport' writes AuditLog row."""
        self.client.force_authenticate(user=self.director)
        self.client.get('/api/v1/export/admin/sheet-rows/')

        setting = SheetRowSetting.objects.get(field_key='weight_net')
        setting.triggered_role = ''
        setting.triggered_user = None
        setting.save()

        before_count = AuditLog.objects.filter(model_name='SheetRowSetting').count()

        resp = self.client.patch(
            '/api/v1/export/admin/sheet-rows/weight_net/',
            {'triggered_role': 'transport'},
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)

        logs = AuditLog.objects.filter(
            model_name='SheetRowSetting',
            field_name='triggered_role',
        ).order_by('-created_at')

        self.assertEqual(logs.count(), before_count + 1)

        log = logs.first()
        self.assertEqual(log.old_value, '')
        self.assertEqual(log.new_value, 'transport')
        self.assertEqual(log.user_id, self.director.id)

    def test_patch_writes_auditlog_for_user_change(self):
        """PATCH triggered_user from None to transport user writes AuditLog row."""
        self.client.force_authenticate(user=self.director)
        self.client.get('/api/v1/export/admin/sheet-rows/')

        resp = self.client.patch(
            '/api/v1/export/admin/sheet-rows/route_note/',
            {'triggered_user': self.transport_user.id},
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)

        log = AuditLog.objects.filter(
            model_name='SheetRowSetting',
            field_name='triggered_user',
        ).order_by('-created_at').first()

        self.assertIsNotNone(log)
        self.assertEqual(log.old_value, 'None')
        # new_value is str(transport_user)
        self.assertIn(self.transport_user.username, log.new_value)

    # ── Test 4 ──────────────────────────────────────────────────────────────

    def test_export_manager_can_edit(self):
        """Export_manager has shipment.edit → PATCH must succeed (D5 parity)."""
        self.client.force_authenticate(user=self.export_manager)
        self.client.force_authenticate(user=self.director)
        self.client.get('/api/v1/export/admin/sheet-rows/')  # provision as director

        self.client.force_authenticate(user=self.export_manager)
        resp = self.client.patch(
            '/api/v1/export/admin/sheet-rows/weight_net/',
            {'triggered_role': 'warehouse_chief'},
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)

    # ── Test 5 ──────────────────────────────────────────────────────────────

    def test_accountant_cannot_edit(self):
        """Accountant has shipment.view only → PATCH must return 403."""
        self.client.force_authenticate(user=self.director)
        self.client.get('/api/v1/export/admin/sheet-rows/')

        self.client.force_authenticate(user=self.accountant)
        resp = self.client.patch(
            '/api/v1/export/admin/sheet-rows/weight_net/',
            {'triggered_role': 'transport'},
            format='json',
        )
        self.assertEqual(resp.status_code, 403, resp.data)

    # ── Test 6 ──────────────────────────────────────────────────────────────

    def test_post_disabled(self):
        """POST to the list URL must return 405 Method Not Allowed."""
        self.client.force_authenticate(user=self.director)
        resp = self.client.post(
            '/api/v1/export/admin/sheet-rows/',
            {'field_key': 'new_field', 'row_number': 99},
            format='json',
        )
        self.assertEqual(resp.status_code, 405, resp.data)

    # ── Test 7 ──────────────────────────────────────────────────────────────

    def test_delete_disabled(self):
        """DELETE to a detail URL must return 405 Method Not Allowed."""
        self.client.force_authenticate(user=self.director)
        self.client.get('/api/v1/export/admin/sheet-rows/')

        resp = self.client.delete('/api/v1/export/admin/sheet-rows/weight_net/')
        self.assertEqual(resp.status_code, 405, resp.data)

    # ── Extra edge cases ─────────────────────────────────────────────────────

    def test_patch_unknown_field_key_returns_404(self):
        """PATCH on a field_key not in the DB must return 404."""
        self.client.force_authenticate(user=self.director)
        resp = self.client.patch(
            '/api/v1/export/admin/sheet-rows/nonexistent_field/',
            {'triggered_role': 'transport'},
            format='json',
        )
        self.assertEqual(resp.status_code, 404, resp.data)

    def test_serializer_exposes_triggered_user_active(self):
        """GET includes triggered_user_active = True when user is active."""
        self.client.force_authenticate(user=self.director)
        self.client.get('/api/v1/export/admin/sheet-rows/')

        setting = SheetRowSetting.objects.get(field_key='weight_net')
        setting.triggered_user = self.transport_user
        setting.triggered_role = ''
        setting.save()

        resp = self.client.get('/api/v1/export/admin/sheet-rows/')
        rows_by_key = {r['field_key']: r for r in resp.data}
        wn = rows_by_key['weight_net']
        self.assertTrue(wn['triggered_user_active'])
        self.assertIsNotNone(wn['triggered_user_name'])

    def test_serializer_triggered_user_active_null_when_no_user(self):
        """triggered_user_active is None when no user is set."""
        self.client.force_authenticate(user=self.director)
        self.client.get('/api/v1/export/admin/sheet-rows/')

        resp = self.client.get('/api/v1/export/admin/sheet-rows/')
        rows_by_key = {r['field_key']: r for r in resp.data}
        wn = rows_by_key['weight_net']
        self.assertIsNone(wn['triggered_user'])
        self.assertIsNone(wn['triggered_user_active'])
        self.assertIsNone(wn['triggered_user_name'])
