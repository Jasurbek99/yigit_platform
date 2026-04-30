"""Tests for SheetRowSettingViewSet — /api/v1/export/admin/sheet-rows/ endpoint.

Sheet Control v2 test suite. Covers:
1.  GET list auto-provisions missing rows, returns display_order-sorted list.
2.  GET list idempotent — calling twice does not create duplicates.
3.  PATCH updates fields; version is bumped.
4.  PATCH with wrong version returns 409 Conflict.
5.  PATCH triggered_roles replaces role_triggers atomically.
6.  PATCH triggered_user sets FK correctly.
7.  PATCH writes AuditLog per changed field.
8.  DELETE requires is_visible=False and updated_at ≥ 30 days ago.
9.  DELETE soft-deletes the row (deleted_at set, still retrievable via include_deleted=1).
10. POST /restore/ re-activates a soft-deleted row.
11. POST /reorder/ assigns sparse display_order values.
12. POST /permissions/bulk/ grants and revokes user exceptions.
13. POST /permissions/bulk/ is idempotent (grant twice, revoke soft-deletes).
14. export_manager can PATCH (D5 parity).
15. Viewer-only role cannot PATCH.
16. POST create is disabled (405).

Run with:
    python manage.py test apps.export.tests_sheet_settings_admin --verbosity=2
"""
from datetime import timedelta

from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core.models import User
from apps.export.models import (
    AuditLog, SheetRowSetting, SheetRowRoleTrigger, SheetRowUserPermission,
)
from apps.export.sheet_rows import DEFAULT_SHEET_ROWS

_BASE = '/api/v1/export/admin/sheet-rows/'


def _create_user(username: str, role: str, is_superuser: bool = False) -> User:
    user = User(username=username, role=role, is_superuser=is_superuser)
    user.set_password('pass')
    user.save()
    return user


def _provision(client, user) -> list[dict]:
    """Force-authenticate as user, call GET list to auto-provision, return response data."""
    client.force_authenticate(user=user)
    resp = client.get(_BASE)
    assert resp.status_code == 200, resp.data
    return resp.data


def _by_key(data: list[dict], field_key: str) -> dict | None:
    for row in data:
        if row['field_key'] == field_key:
            return row
    return None


class SheetRowSettingAdminTests(TestCase):
    """Core CRUD + permission tests for admin/sheet-rows/."""

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        cls.director = _create_user('director_srs', 'director')
        cls.export_manager = _create_user('mgr_srs', 'export_manager')
        cls.viewer = _create_user('viewer_srs', 'viewer')
        cls.transport_user = _create_user('trans_srs', 'transport')

    def setUp(self):
        self.client = APIClient()
        SheetRowSetting.objects.all().delete()

    # ── Test 1: auto-provision ────────────────────────────────────────────────

    def test_get_lists_all_rows_creates_missing(self):
        """GET as director on empty table auto-provisions all DEFAULT_SHEET_ROWS."""
        data = _provision(self.client, self.director)
        self.assertEqual(len(data), len(DEFAULT_SHEET_ROWS))
        self.assertEqual(SheetRowSetting.objects.count(), len(DEFAULT_SHEET_ROWS))
        expected_keys = {row['field_key'] for row in DEFAULT_SHEET_ROWS}
        returned_keys = {r['field_key'] for r in data}
        self.assertEqual(returned_keys, expected_keys)

    # ── Test 2: idempotent ───────────────────────────────────────────────────

    def test_get_idempotent_second_call(self):
        """Calling GET twice must not create duplicate rows."""
        self.client.force_authenticate(user=self.director)
        self.client.get(_BASE)
        self.client.get(_BASE)
        self.assertEqual(SheetRowSetting.objects.count(), len(DEFAULT_SHEET_ROWS))

    # ── Test 3: PATCH bumps version ──────────────────────────────────────────

    def test_patch_bumps_version(self):
        """PATCH any field increments version by 1."""
        data = _provision(self.client, self.director)
        row = _by_key(data, 'weight_net')
        original_version = row['version']
        row_id = row['id']

        resp = self.client.patch(
            f'{_BASE}{row_id}/',
            {'is_visible': False, 'version': original_version},
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.data['version'], original_version + 1)

    # ── Test 4: version conflict → 409 ──────────────────────────────────────

    def test_patch_wrong_version_returns_409(self):
        """Supplying an outdated version in PATCH returns 409 with current_version."""
        data = _provision(self.client, self.director)
        row = _by_key(data, 'weight_net')
        row_id = row['id']
        stale_version = row['version'] - 1 if row['version'] > 1 else 999

        resp = self.client.patch(
            f'{_BASE}{row_id}/',
            {'is_visible': False, 'version': stale_version},
            format='json',
        )
        self.assertEqual(resp.status_code, 409, resp.data)
        self.assertIn('current_version', resp.data)
        self.assertEqual(resp.data['current_version'], row['version'])

    # ── Test 5: triggered_roles replaces role_triggers ───────────────────────

    def test_patch_triggered_roles_replaces_role_triggers(self):
        """PATCH triggered_roles_write replaces all SheetRowRoleTrigger rows."""
        data = _provision(self.client, self.director)
        row = _by_key(data, 'weight_net')
        row_id = row['id']
        current_version = row['version']

        # Set initial roles
        resp = self.client.patch(
            f'{_BASE}{row_id}/',
            {'triggered_roles_write': ['transport', 'warehouse_chief'], 'version': current_version},
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertIn('transport', resp.data['triggered_roles'])
        self.assertIn('warehouse_chief', resp.data['triggered_roles'])

        # Replace with a different set (version was bumped by first PATCH)
        resp2 = self.client.patch(
            f'{_BASE}{row_id}/',
            {'triggered_roles_write': ['sales_rep'], 'version': resp.data['version']},
            format='json',
        )
        self.assertEqual(resp2.status_code, 200, resp2.data)
        self.assertEqual(resp2.data['triggered_roles'], ['sales_rep'])

        # DB-level check
        db_roles = list(
            SheetRowRoleTrigger.objects.filter(row_id=row_id).values_list('role', flat=True)
        )
        self.assertEqual(db_roles, ['sales_rep'])

    def test_patch_triggered_roles_invalid_code_returns_400(self):
        """triggered_roles_write with an unknown role code returns 400."""
        data = _provision(self.client, self.director)
        row = _by_key(data, 'weight_net')
        resp = self.client.patch(
            f'{_BASE}{row["id"]}/',
            {'triggered_roles_write': ['nonexistent_role']},
            format='json',
        )
        self.assertEqual(resp.status_code, 400, resp.data)

    def test_patch_triggered_roles_empty_clears_all(self):
        """triggered_roles_write=[] removes all SheetRowRoleTrigger rows."""
        data = _provision(self.client, self.director)
        row = _by_key(data, 'weight_net')
        row_id = row['id']
        current_version = row['version']
        # Seed a trigger
        seed_resp = self.client.patch(
            f'{_BASE}{row_id}/',
            {'triggered_roles_write': ['transport'], 'version': current_version},
            format='json',
        )
        self.assertEqual(seed_resp.status_code, 200, seed_resp.data)
        resp = self.client.patch(
            f'{_BASE}{row_id}/',
            {'triggered_roles_write': [], 'version': seed_resp.data['version']},
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.data['triggered_roles'], [])

    # ── Test 6: triggered_user FK ─────────────────────────────────────────────

    def test_patch_triggered_user_sets_fk(self):
        """PATCH triggered_user sets the FK and serializer returns user info."""
        data = _provision(self.client, self.director)
        row = _by_key(data, 'weight_net')
        row_id = row['id']

        resp = self.client.patch(
            f'{_BASE}{row_id}/',
            {'triggered_user': self.transport_user.id, 'version': row['version']},
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.data['triggered_user'], self.transport_user.id)
        self.assertIsNotNone(resp.data['triggered_user_name'])
        self.assertTrue(resp.data['triggered_user_active'])

    def test_triggered_user_active_null_when_no_user(self):
        """triggered_user_active is None when no triggered_user is set."""
        data = _provision(self.client, self.director)
        row = _by_key(data, 'weight_net')
        wn = row
        self.assertIsNone(wn['triggered_user'])
        self.assertIsNone(wn['triggered_user_active'])
        self.assertIsNone(wn['triggered_user_name'])

    # ── Test 7: AuditLog written on field change ──────────────────────────────

    def test_patch_writes_auditlog(self):
        """PATCH triggered_roles writes AuditLog row for triggered_roles field."""
        data = _provision(self.client, self.director)
        row = _by_key(data, 'weight_net')
        row_id = row['id']

        before_count = AuditLog.objects.filter(model_name='SheetRowSetting').count()

        resp = self.client.patch(
            f'{_BASE}{row_id}/',
            {'triggered_roles_write': ['transport'], 'version': row['version']},
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)

        logs = AuditLog.objects.filter(
            model_name='SheetRowSetting',
            field_name='triggered_roles',
        ).order_by('-created_at')

        self.assertGreater(logs.count(), before_count)
        log = logs.first()
        self.assertIn('transport', log.new_value)
        self.assertEqual(log.user_id, self.director.id)

    def test_patch_writes_auditlog_for_is_visible_change(self):
        """PATCH is_visible from True to False writes AuditLog row."""
        data = _provision(self.client, self.director)
        row = _by_key(data, 'weight_net')
        row_id = row['id']

        before = AuditLog.objects.filter(
            model_name='SheetRowSetting', field_name='is_visible',
        ).count()

        resp = self.client.patch(
            f'{_BASE}{row_id}/',
            {'is_visible': False, 'version': row['version']},
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        after = AuditLog.objects.filter(
            model_name='SheetRowSetting', field_name='is_visible',
        ).count()
        self.assertEqual(after, before + 1)

    # ── Test 8: DELETE pre-conditions ─────────────────────────────────────────

    def test_delete_fails_if_row_still_visible(self):
        """DELETE must return 400 if is_visible=True."""
        data = _provision(self.client, self.director)
        row = _by_key(data, 'weight_net')
        resp = self.client.delete(f'{_BASE}{row["id"]}/')
        self.assertEqual(resp.status_code, 400, resp.data)
        self.assertIn('row_must_be_hidden_30_days', str(resp.data))

    def test_delete_fails_if_hidden_less_than_30_days(self):
        """DELETE must return 400 if row was hidden less than 30 days ago."""
        data = _provision(self.client, self.director)
        row = _by_key(data, 'weight_net')
        row_id = row['id']
        # Hide the row NOW (version required by optimistic lock)
        self.client.patch(f'{_BASE}{row_id}/', {'is_visible': False, 'version': row['version']}, format='json')
        resp = self.client.delete(f'{_BASE}{row_id}/')
        self.assertEqual(resp.status_code, 400, resp.data)

    # ── Test 9: soft-delete ───────────────────────────────────────────────────

    def test_delete_soft_deletes_row(self):
        """DELETE sets deleted_at; row excluded from active() but present with include_deleted=1."""
        data = _provision(self.client, self.director)
        row = _by_key(data, 'weight_net')
        row_id = row['id']

        # Force the condition: hide the row and backdate updated_at to >30 days ago
        setting = SheetRowSetting.objects.get(pk=row_id)
        setting.is_visible = False
        setting.save()
        # Force updated_at back 31 days via QuerySet to skip auto_now
        SheetRowSetting.objects.filter(pk=row_id).update(
            updated_at=timezone.now() - timedelta(days=31)
        )

        resp = self.client.delete(f'{_BASE}{row_id}/')
        self.assertEqual(resp.status_code, 204, resp.data)

        setting.refresh_from_db()
        self.assertIsNotNone(setting.deleted_at)

        # Not visible in normal list
        list_resp = self.client.get(_BASE)
        ids_in_list = [r['id'] for r in list_resp.data]
        self.assertNotIn(row_id, ids_in_list)

        # Visible with include_deleted=1
        del_resp = self.client.get(f'{_BASE}?include_deleted=1')
        ids_with_deleted = [r['id'] for r in del_resp.data]
        self.assertIn(row_id, ids_with_deleted)

    # ── Test 10: restore ─────────────────────────────────────────────────────

    def test_restore_reactivates_soft_deleted_row(self):
        """POST /restore/ clears deleted_at and deleted_by."""
        data = _provision(self.client, self.director)
        row = _by_key(data, 'weight_net')
        row_id = row['id']

        # Soft-delete manually
        setting = SheetRowSetting.objects.get(pk=row_id)
        setting.deleted_at = timezone.now()
        setting.deleted_by = self.director
        setting.is_visible = False
        setting.save()

        resp = self.client.post(f'{_BASE}{row_id}/restore/')
        self.assertEqual(resp.status_code, 200, resp.data)

        setting.refresh_from_db()
        self.assertIsNone(setting.deleted_at)
        self.assertIsNone(setting.deleted_by_id)

    def test_restore_already_active_returns_400(self):
        """POST /restore/ on a non-deleted row returns 400."""
        data = _provision(self.client, self.director)
        row = _by_key(data, 'weight_net')
        resp = self.client.post(f'{_BASE}{row["id"]}/restore/')
        self.assertEqual(resp.status_code, 400, resp.data)

    # ── Test 11: reorder ─────────────────────────────────────────────────────

    def test_reorder_assigns_sparse_display_order(self):
        """POST /reorder/ assigns (idx+1)*1024 to each id in order."""
        data = _provision(self.client, self.director)
        ids = [r['id'] for r in data[:3]]  # first 3 rows

        resp = self.client.post(
            f'{_BASE}reorder/',
            {'order': ids},
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.data['reordered'], 3)

        rows = SheetRowSetting.objects.filter(id__in=ids).order_by('display_order')
        orders = [r.display_order for r in rows]
        self.assertEqual(orders, [1024, 2048, 3072])

    def test_reorder_writes_auditlog(self):
        """POST /reorder/ creates one AuditLog row for the reorder event."""
        data = _provision(self.client, self.director)
        ids = [r['id'] for r in data[:2]]

        before = AuditLog.objects.filter(
            model_name='SheetRowSetting', field_name='display_order',
        ).count()

        resp = self.client.post(f'{_BASE}reorder/', {'order': ids}, format='json')
        self.assertEqual(resp.status_code, 200, resp.data)

        after = AuditLog.objects.filter(
            model_name='SheetRowSetting', field_name='display_order',
        ).count()
        self.assertEqual(after, before + 1)

    def test_reorder_empty_order_returns_400(self):
        """POST /reorder/ with empty list returns 400."""
        self.client.force_authenticate(user=self.director)
        resp = self.client.post(f'{_BASE}reorder/', {'order': []}, format='json')
        self.assertEqual(resp.status_code, 400, resp.data)

    # ── Test 12: permissions/bulk ─────────────────────────────────────────────

    def test_permissions_bulk_grant(self):
        """POST /permissions/bulk/ creates SheetRowUserPermission for granted users."""
        data = _provision(self.client, self.director)
        row_id = data[0]['id']

        resp = self.client.post(
            f'{_BASE}permissions/bulk/',
            {'row_id': row_id, 'grants': [self.transport_user.id], 'revokes': []},
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.data['granted'], 1)

        self.assertTrue(
            SheetRowUserPermission.objects.filter(
                row_id=row_id, user=self.transport_user, deleted_at__isnull=True,
            ).exists()
        )

    def test_permissions_bulk_revoke(self):
        """POST /permissions/bulk/ soft-deletes existing grant for revoked users."""
        data = _provision(self.client, self.director)
        row_id = data[0]['id']
        setting = SheetRowSetting.objects.get(pk=row_id)

        # Grant first
        SheetRowUserPermission.objects.create(
            row=setting, user=self.transport_user, can_edit=True,
        )

        resp = self.client.post(
            f'{_BASE}permissions/bulk/',
            {'row_id': row_id, 'grants': [], 'revokes': [self.transport_user.id]},
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.data['revoked'], 1)

        perm = SheetRowUserPermission.objects.get(row_id=row_id, user=self.transport_user)
        self.assertIsNotNone(perm.deleted_at)

    # ── Test 13: idempotent grant ─────────────────────────────────────────────

    def test_permissions_bulk_idempotent_grant(self):
        """Granting the same user twice should not create duplicate active rows."""
        data = _provision(self.client, self.director)
        row_id = data[0]['id']

        for _ in range(2):
            self.client.post(
                f'{_BASE}permissions/bulk/',
                {'row_id': row_id, 'grants': [self.transport_user.id], 'revokes': []},
                format='json',
            )

        active_count = SheetRowUserPermission.objects.filter(
            row_id=row_id, user=self.transport_user, deleted_at__isnull=True,
        ).count()
        self.assertEqual(active_count, 1)

    # ── Test 14: export_manager can PATCH ────────────────────────────────────

    def test_export_manager_can_edit(self):
        """export_manager has shipment.edit → PATCH must succeed (D5 parity)."""
        _provision(self.client, self.director)  # provision as director

        self.client.force_authenticate(user=self.export_manager)
        data = self.client.get(_BASE).data
        row = _by_key(data, 'weight_net')
        row_id = row['id']

        resp = self.client.patch(
            f'{_BASE}{row_id}/',
            {'triggered_roles_write': ['warehouse_chief'], 'version': row['version']},
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)

    # ── Test 15: viewer cannot PATCH ─────────────────────────────────────────

    def test_viewer_cannot_edit(self):
        """Viewer role has shipment.view only → PATCH must return 403."""
        # Provision as director first, capture a row id
        data = _provision(self.client, self.director)
        row_id = data[0]['id']

        # Switch to viewer and attempt PATCH
        self.client.force_authenticate(user=self.viewer)
        resp = self.client.patch(
            f'{_BASE}{row_id}/',
            {'triggered_roles_write': ['transport']},
            format='json',
        )
        self.assertEqual(resp.status_code, 403, resp.data)

    # ── Test 16: POST create disabled ────────────────────────────────────────

    def test_post_disabled(self):
        """POST to the list URL must return 405 Method Not Allowed."""
        self.client.force_authenticate(user=self.director)
        resp = self.client.post(
            _BASE,
            {'field_key': 'new_field', 'row_number': 99},
            format='json',
        )
        self.assertEqual(resp.status_code, 405, resp.data)

    # ── Extra: serializer fields ──────────────────────────────────────────────

    def test_serializer_exposes_triggered_user_info(self):
        """GET includes triggered_user_active and triggered_user_name when user is set."""
        data = _provision(self.client, self.director)
        row_id = _by_key(data, 'weight_net')['id']

        setting = SheetRowSetting.objects.get(pk=row_id)
        setting.triggered_user = self.transport_user
        setting.save()

        resp = self.client.get(_BASE)
        wn = _by_key(resp.data, 'weight_net')
        self.assertTrue(wn['triggered_user_active'])
        self.assertIsNotNone(wn['triggered_user_name'])

    def test_patch_unknown_id_returns_404(self):
        """PATCH on a non-existent id must return 404."""
        self.client.force_authenticate(user=self.director)
        resp = self.client.patch(
            f'{_BASE}99999999/',
            {'triggered_roles_write': ['transport']},
            format='json',
        )
        self.assertEqual(resp.status_code, 404, resp.data)
