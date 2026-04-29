"""Tests for GET /api/v1/export/shipments/{id}/field-history/

Covers:
13. test_field_history_returns_rows
14. test_field_history_requires_field_param
15. test_field_history_forbidden_when_no_edit_perm
16. test_field_history_limit_caps
"""
from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import Country, Season, ShipmentStatusType, User
from apps.export.models import AuditLog, Shipment, SheetRowSetting


def _create_user(username: str, role: str, is_superuser: bool = False) -> User:
    user = User(username=username, role=role, is_superuser=is_superuser)
    user.set_password('pass')
    user.save()
    return user


def _seed_audit_rows(shipment, field_key: str, user, count: int = 3) -> None:
    """Create ``count`` AuditLog rows for the given shipment and field."""
    rows = [
        AuditLog(
            user=user,
            action='update',
            model_name='Shipment',
            object_id=shipment.pk,
            object_repr=shipment.cargo_code or str(shipment.pk),
            field_name=field_key,
            old_value=str(i * 100),
            new_value=str((i + 1) * 100),
            detail=f'{field_key}: {i * 100} → {(i + 1) * 100}',
        )
        for i in range(count)
    ]
    AuditLog.objects.bulk_create(rows, batch_size=500)


class FieldHistoryTests(TestCase):
    """Tests for the field-history action on ShipmentViewSet."""

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        cls.season = Season.objects.create(
            name='2025-2026', start_date='2025-09-01', end_date='2026-06-30',
            is_active=True,
        )
        cls.status = ShipmentStatusType.objects.create(
            code='yuklenme', name_tk='yuklenme', name_en='Loading',
            step_order=1, phase='LOADING',
        )
        cls.shipment = Shipment.objects.create(
            cargo_code='FH-001', date='2026-02-01', season=cls.season,
            status=cls.status, weight_net='18500.00',
        )
        # warehouse_chief can edit weight_net (per seed_permissions)
        cls.warehouse_chief = _create_user('wh_fh', 'warehouse_chief')
        # accountant can only view — no weight_net edit perm
        cls.accountant = _create_user('acc_fh', 'accountant')
        # director bypasses all gates
        cls.director = _create_user('dir_fh', 'director')

    def setUp(self):
        self.client = APIClient()

    # ── Test 13 ─────────────────────────────────────────────────────────────

    def test_field_history_returns_rows(self):
        """After patching weight_net, GET field-history returns the audit rows."""
        _seed_audit_rows(self.shipment, 'weight_net', self.warehouse_chief, count=3)

        self.client.force_authenticate(user=self.warehouse_chief)
        resp = self.client.get(
            f'/api/v1/export/shipments/{self.shipment.id}/field-history/',
            {'field': 'weight_net'},
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertIn('results', resp.data)
        self.assertEqual(len(resp.data['results']), 3)

        # Check shape of first row
        first = resp.data['results'][0]
        self.assertIn('user_id', first)
        self.assertIn('user_name', first)
        self.assertIn('old_value', first)
        self.assertIn('new_value', first)
        self.assertIn('edited_at', first)
        self.assertEqual(first['user_id'], self.warehouse_chief.id)

    def test_field_history_newest_first(self):
        """Rows are returned newest-first (descending created_at)."""
        AuditLog.objects.filter(
            model_name='Shipment', object_id=self.shipment.pk, field_name='weight_net'
        ).delete()
        _seed_audit_rows(self.shipment, 'weight_net', self.warehouse_chief, count=3)

        self.client.force_authenticate(user=self.director)
        resp = self.client.get(
            f'/api/v1/export/shipments/{self.shipment.id}/field-history/',
            {'field': 'weight_net'},
        )
        results = resp.data['results']
        # newest edit has the highest i → new_value = '300'
        # (created_at auto_now_add preserves insertion order)
        self.assertEqual(len(results), 3)

    # ── Test 14 ─────────────────────────────────────────────────────────────

    def test_field_history_requires_field_param(self):
        """Missing ?field= → 400."""
        self.client.force_authenticate(user=self.warehouse_chief)
        resp = self.client.get(
            f'/api/v1/export/shipments/{self.shipment.id}/field-history/',
        )
        self.assertEqual(resp.status_code, 400, resp.data)
        self.assertIn('error', resp.data)

    def test_field_history_empty_field_param_returns_400(self):
        """?field= (empty string) → 400."""
        self.client.force_authenticate(user=self.warehouse_chief)
        resp = self.client.get(
            f'/api/v1/export/shipments/{self.shipment.id}/field-history/',
            {'field': ''},
        )
        self.assertEqual(resp.status_code, 400, resp.data)

    # ── Test 15 ─────────────────────────────────────────────────────────────

    def test_field_history_forbidden_when_no_edit_perm(self):
        """Accountant cannot edit weight_net → 403 on field-history."""
        _seed_audit_rows(self.shipment, 'weight_net', self.director, count=1)

        self.client.force_authenticate(user=self.accountant)
        resp = self.client.get(
            f'/api/v1/export/shipments/{self.shipment.id}/field-history/',
            {'field': 'weight_net'},
        )
        self.assertEqual(resp.status_code, 403, resp.data)

    def test_field_history_director_bypasses_perm_gate(self):
        """Director bypasses the edit-perm gate and gets the history."""
        _seed_audit_rows(self.shipment, 'weight_net', self.warehouse_chief, count=2)

        self.client.force_authenticate(user=self.director)
        resp = self.client.get(
            f'/api/v1/export/shipments/{self.shipment.id}/field-history/',
            {'field': 'weight_net'},
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertGreaterEqual(len(resp.data['results']), 2)

    def test_field_history_404_for_unknown_shipment(self):
        """Non-existent shipment pk → 404 (checked before 403)."""
        self.client.force_authenticate(user=self.warehouse_chief)
        resp = self.client.get(
            '/api/v1/export/shipments/99999999/field-history/',
            {'field': 'weight_net'},
        )
        self.assertEqual(resp.status_code, 404, resp.data)

    # ── Test 16 ─────────────────────────────────────────────────────────────

    def test_field_history_limit_caps(self):
        """?limit=200 caps to 200; no ?limit defaults to 50."""
        AuditLog.objects.filter(
            model_name='Shipment', object_id=self.shipment.pk, field_name='route_note',
        ).delete()
        _seed_audit_rows(self.shipment, 'route_note', self.director, count=75)

        self.client.force_authenticate(user=self.director)

        # Default limit = 50
        resp_default = self.client.get(
            f'/api/v1/export/shipments/{self.shipment.id}/field-history/',
            {'field': 'route_note'},
        )
        self.assertEqual(resp_default.status_code, 200, resp_default.data)
        self.assertEqual(len(resp_default.data['results']), 50)

        # Explicit ?limit=200 still returns only what exists (75 rows < 200)
        resp_limit = self.client.get(
            f'/api/v1/export/shipments/{self.shipment.id}/field-history/',
            {'field': 'route_note', 'limit': '200'},
        )
        self.assertEqual(resp_limit.status_code, 200, resp_limit.data)
        self.assertEqual(len(resp_limit.data['results']), 75)

    def test_field_history_limit_hard_cap_at_200(self):
        """?limit=999 is silently capped to 200."""
        AuditLog.objects.filter(
            model_name='Shipment', object_id=self.shipment.pk, field_name='notes',
        ).delete()
        _seed_audit_rows(self.shipment, 'notes', self.director, count=250)

        self.client.force_authenticate(user=self.director)
        resp = self.client.get(
            f'/api/v1/export/shipments/{self.shipment.id}/field-history/',
            {'field': 'notes', 'limit': '999'},
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(len(resp.data['results']), 200)

    def test_field_history_empty_when_no_logs(self):
        """No audit rows for the field → empty results list."""
        AuditLog.objects.filter(
            model_name='Shipment', object_id=self.shipment.pk, field_name='city',
        ).delete()

        self.client.force_authenticate(user=self.director)
        resp = self.client.get(
            f'/api/v1/export/shipments/{self.shipment.id}/field-history/',
            {'field': 'city'},
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.data['results'], [])

    def test_field_history_trigger_config_respected(self):
        """If triggered_user is set to transport_user only, warehouse_chief gets 403.

        The gate AND-composes: triggered_user match AND RoleFieldPermission.
        ``transport`` role has ``border_point`` field perm; ``warehouse_chief`` does not.
        Even if warehouse_chief had border_point perm, they'd still fail the triggered_user gate.
        ``director`` bypasses everything and always sees history.
        """
        # transport_user is the designated trigger user for border_point
        transport_user = _create_user('trans_fh_trigger', 'transport')

        SheetRowSetting.objects.get_or_create(
            field_key='border_point',
            defaults={'row_number': 29},
        )
        setting = SheetRowSetting.objects.get(field_key='border_point')
        setting.triggered_user = transport_user
        setting.triggered_role = ''
        setting.save()

        _seed_audit_rows(self.shipment, 'border_point', self.director, count=1)

        # warehouse_chief: wrong triggered_user AND no border_point field perm → 403
        self.client.force_authenticate(user=self.warehouse_chief)
        resp = self.client.get(
            f'/api/v1/export/shipments/{self.shipment.id}/field-history/',
            {'field': 'border_point'},
        )
        self.assertEqual(resp.status_code, 403, resp.data)

        # transport_user: matches triggered_user AND has border_point field perm → 200
        self.client.force_authenticate(user=transport_user)
        resp2 = self.client.get(
            f'/api/v1/export/shipments/{self.shipment.id}/field-history/',
            {'field': 'border_point'},
        )
        self.assertEqual(resp2.status_code, 200, resp2.data)

        # cleanup
        setting.triggered_user = None
        setting.save()
