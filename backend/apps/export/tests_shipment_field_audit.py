"""Tests for cell-level field audit on shipment PATCH (Step 4).

Every PATCH to /api/v1/export/shipments/{id}/ that changes a field must produce
an AuditLog row with the correct field_name, old_value, new_value, and user_id.

Run with:
    python manage.py test apps.export.tests_shipment_field_audit --verbosity=2

(Tests run against MSSQL test_YIGIT_PLATFROM via YigitTestUser since the
schema-collapse refactor in commit 932d950 — the legacy USE_SQLITE=true
SQLite test runner was dropped because the project is MSSQL-only.)

Fixture setup mirrors tests_shipment_sheet.py: explicit ShipmentStatusType +
Shipment creation, seed_permissions() for role-based field gates, APIClient
with force_authenticate.
"""
import time
from datetime import date
from decimal import Decimal
from unittest.mock import patch

from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import Country, Season, ShipmentStatusType, User
from apps.export.models import AuditLog, Shipment


# ── Shared helpers ────────────────────────────────────────────────────────────

def _seed_permissions() -> None:
    """Populate RolePagePermission, RoleResourcePermission, RoleFieldPermission.

    Required because PATCH uses can_edit_field() which reads from
    RoleFieldPermission. seed_permissions is idempotent without --reset.
    """
    call_command('seed_permissions')


def _create_user(username: str, role: str) -> User:
    user = User(username=username, role=role)
    user.set_password('pass')
    user.save()
    return user


def _make_status() -> ShipmentStatusType:
    """Create a minimal loading status (step 1) for test shipments."""
    # Use get_or_create so multiple TestCase classes sharing setUpTestData
    # don't collide when using separate per-method DB transactions.
    status, _ = ShipmentStatusType.objects.get_or_create(
        code='yuklenme',
        defaults={
            'name_tk': 'Ýüklenme',
            'name_en': 'Loading',
            'step_order': 1,
            'phase': 'LOADING',
        },
    )
    return status


def _make_season() -> Season:
    season, _ = Season.objects.get_or_create(
        name='2025-2026',
        defaults={'start_date': '2025-09-01', 'end_date': '2026-06-30', 'is_active': True},
    )
    return season


def _make_shipment(cargo_code: str, season, status) -> Shipment:
    return Shipment.objects.create(
        cargo_code=cargo_code,
        date=date(2026, 2, 1),
        season=season,
        status=status,
        weight_net=Decimal('18400.00'),
        weight_gross=Decimal('19100.00'),
    )


# ── Test classes ──────────────────────────────────────────────────────────────

class AuditRowCountTests(TestCase):
    """One AuditLog row per changed field; zero rows for unchanged fields."""

    @classmethod
    def setUpTestData(cls):
        _seed_permissions()
        cls.status = _make_status()
        cls.season = _make_season()
        cls.user = _create_user('wh_user', 'warehouse_chief')

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        # Fresh shipment per test so row counts are isolated.
        self.shipment = _make_shipment(
            cargo_code=f'AU{self.id()[-4:]}001/26',
            season=self.season,
            status=self.status,
        )

    def _patch(self, payload: dict):
        return self.client.patch(
            f'/api/v1/export/shipments/{self.shipment.id}/',
            payload,
            format='json',
        )

    def test_patch_writes_one_audit_row_per_changed_field(self):
        """Two fields change → exactly two AuditLog rows."""
        before_count = AuditLog.objects.count()
        resp = self._patch({'weight_net': '18500.00', 'weight_gross': '19200.00'})
        self.assertEqual(resp.status_code, 200, resp.data)

        new_rows = AuditLog.objects.filter(
            model_name='Shipment',
            object_id=self.shipment.id,
            action='update',
        ).order_by('field_name')
        self.assertEqual(new_rows.count(), 2)

        by_field = {r.field_name: r for r in new_rows}
        self.assertIn('weight_net', by_field)
        self.assertIn('weight_gross', by_field)

        weight_net_row = by_field['weight_net']
        self.assertEqual(weight_net_row.old_value, '18400.00')
        self.assertEqual(weight_net_row.new_value, '18500.00')
        self.assertEqual(weight_net_row.user_id, self.user.id)

        weight_gross_row = by_field['weight_gross']
        self.assertEqual(weight_gross_row.old_value, '19100.00')
        self.assertEqual(weight_gross_row.new_value, '19200.00')
        self.assertEqual(weight_gross_row.user_id, self.user.id)

    def test_unchanged_field_writes_zero_rows(self):
        """Resubmitting current values produces zero new audit rows."""
        # First ensure DB has the values we think it does.
        self.shipment.refresh_from_db()
        current_net = str(self.shipment.weight_net)

        before_count = AuditLog.objects.filter(
            model_name='Shipment', object_id=self.shipment.id,
        ).count()

        resp = self._patch({'weight_net': current_net})
        self.assertEqual(resp.status_code, 200, resp.data)

        after_count = AuditLog.objects.filter(
            model_name='Shipment', object_id=self.shipment.id,
        ).count()
        self.assertEqual(after_count, before_count,
                         'Resubmitting unchanged value must not create audit rows')


class AuditFKRenderingTests(TestCase):
    """FK fields render via __str__, not raw PK integers."""

    @classmethod
    def setUpTestData(cls):
        _seed_permissions()
        cls.status = _make_status()
        cls.season = _make_season()
        # Two countries so we can change from one to the other.
        cls.country_kz = Country.objects.create(name_tk='Gazagystan', name_en='Kazakhstan')
        cls.country_ru = Country.objects.create(name_tk='Russiýa', name_en='Russia')
        cls.user = _create_user('mgr_fk', 'export_manager')

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.shipment = Shipment.objects.create(
            cargo_code=f'FK{self.id()[-4:]}001/26',
            date=date(2026, 2, 1),
            season=self.season,
            status=self.status,
            country=self.country_kz,
        )

    def test_fk_renders_via_str_not_id(self):
        """Changing country FK → old/new_value are __str__ outputs, not raw IDs."""
        resp = self.client.patch(
            f'/api/v1/export/shipments/{self.shipment.id}/',
            {'country': self.country_ru.id},
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)

        row = AuditLog.objects.filter(
            model_name='Shipment',
            object_id=self.shipment.id,
            field_name='country',
        ).first()
        self.assertIsNotNone(row, 'Expected an audit row for the country change')

        # Values must be __str__ of the Country instance, not numeric IDs.
        self.assertNotEqual(row.old_value, str(self.country_kz.id),
                            'old_value must not be the raw PK integer')
        self.assertNotEqual(row.new_value, str(self.country_ru.id),
                            'new_value must not be the raw PK integer')

        # The Country model's __str__ is typically the English name; assert it
        # contains a recognisable string fragment rather than being numeric.
        self.assertFalse(row.old_value.isdigit(), f'old_value is numeric: {row.old_value!r}')
        self.assertFalse(row.new_value.isdigit(), f'new_value is numeric: {row.new_value!r}')

        # Sanity: old must differ from new
        self.assertNotEqual(row.old_value, row.new_value)


class AuditAtomicRollbackTests(TestCase):
    """Failed save() rolls back audit rows — no orphaned AuditLog rows."""

    @classmethod
    def setUpTestData(cls):
        _seed_permissions()
        cls.status = _make_status()
        cls.season = _make_season()
        cls.user = _create_user('mgr_atom', 'export_manager')

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.shipment = Shipment.objects.create(
            cargo_code=f'AT{self.id()[-4:]}001/26',
            date=date(2026, 2, 1),
            season=self.season,
            status=self.status,
            weight_net=Decimal('18400.00'),
        )

    def test_atomic_rollback_on_save_failure(self):
        """When serializer.save() raises, no AuditLog rows are persisted.

        Note: Shipment.save() does not validate cargo_code format at the model
        level (validation happens in ShipmentCreateSerializer, not on save()).
        We therefore mock Shipment.save to raise IntegrityError — simulating any
        DB-level save failure — to verify that the surrounding transaction.atomic()
        block rolls back both the shipment update and the audit rows.

        Django's test client re-raises server exceptions by default. We set
        ``raise_request_exception=False`` so the test can inspect the DB state
        after a 500 response without the exception propagating to the test runner.
        """
        from django.db import IntegrityError

        before_count = AuditLog.objects.filter(
            model_name='Shipment', object_id=self.shipment.id,
        ).count()

        self.client.raise_request_exception = False
        with patch.object(Shipment, 'save', side_effect=IntegrityError('mocked save failure')):
            resp = self.client.patch(
                f'/api/v1/export/shipments/{self.shipment.id}/',
                {'weight_net': '17000.00'},
                format='json',
            )
        self.client.raise_request_exception = True  # restore default

        # The view returns 500 when an unexpected exception escapes.
        # The important assertion is that no audit rows were written.
        self.assertEqual(resp.status_code, 500, f'Expected 500 from mocked save failure, got {resp.status_code}')

        after_count = AuditLog.objects.filter(
            model_name='Shipment', object_id=self.shipment.id,
        ).count()
        self.assertEqual(after_count, before_count,
                         'AuditLog rows must be rolled back when save() fails')

        # Shipment weight_net must be unchanged.
        self.shipment.refresh_from_db()
        self.assertEqual(self.shipment.weight_net, Decimal('18400.00'))


class AuditUserAssignmentTests(TestCase):
    """Audit rows are linked to the correct requesting user."""

    @classmethod
    def setUpTestData(cls):
        _seed_permissions()
        cls.status = _make_status()
        cls.season = _make_season()
        cls.user_a = _create_user('user_a', 'warehouse_chief')
        cls.user_b = _create_user('user_b', 'warehouse_chief')

    def setUp(self):
        self.shipment = Shipment.objects.create(
            cargo_code=f'UA{self.id()[-4:]}001/26',
            date=date(2026, 2, 1),
            season=self.season,
            status=self.status,
            weight_net=Decimal('18000.00'),
        )

    def test_audit_user_is_request_user(self):
        """User A and user B patch the same shipment; rows are linked to their own IDs.

        Audit rows are ordered by created_at — user A's row appears first since
        it is written first.
        """
        client_a = APIClient()
        client_a.force_authenticate(user=self.user_a)
        resp_a = client_a.patch(
            f'/api/v1/export/shipments/{self.shipment.id}/',
            {'weight_net': '18100.00'},
            format='json',
        )
        self.assertEqual(resp_a.status_code, 200, resp_a.data)

        client_b = APIClient()
        client_b.force_authenticate(user=self.user_b)
        resp_b = client_b.patch(
            f'/api/v1/export/shipments/{self.shipment.id}/',
            {'weight_net': '18200.00'},
            format='json',
        )
        self.assertEqual(resp_b.status_code, 200, resp_b.data)

        rows = AuditLog.objects.filter(
            model_name='Shipment',
            object_id=self.shipment.id,
            field_name='weight_net',
            action='update',
        ).order_by('created_at')
        self.assertGreaterEqual(rows.count(), 2,
                                'Expected at least two audit rows for the sequential PATCHes')

        # Collect user IDs in creation order.
        user_ids = [r.user_id for r in rows]
        self.assertIn(self.user_a.id, user_ids)
        self.assertIn(self.user_b.id, user_ids)

        # User A's row must precede user B's row (wrote first).
        idx_a = user_ids.index(self.user_a.id)
        idx_b = user_ids.index(self.user_b.id)
        self.assertLess(idx_a, idx_b, 'User A patched first; their row must be ordered first')


class AuditDecimalFormattingTests(TestCase):
    """Decimal fields render without scientific notation."""

    @classmethod
    def setUpTestData(cls):
        _seed_permissions()
        cls.status = _make_status()
        cls.season = _make_season()
        cls.user = _create_user('mgr_dec', 'export_manager')

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.shipment = Shipment.objects.create(
            cargo_code=f'DC{self.id()[-4:]}001/26',
            date=date(2026, 2, 1),
            season=self.season,
            status=self.status,
            weight_net=Decimal('999999.00'),
        )

    def test_decimal_no_scientific_notation(self):
        """A large Decimal value must be stored in fixed-point, not exponential, notation.

        total_amount_usd is a DecimalField(max_digits=12, decimal_places=2).
        Python's ``str()`` on Decimal('1000000.50') gives '1000000.50' (fine),
        but some repr paths yield '1.0000005E+6'. The ``render_field_value``
        helper uses ``format(value, 'f')`` to guarantee fixed-point notation.
        """
        resp = self.client.patch(
            f'/api/v1/export/shipments/{self.shipment.id}/',
            {'total_amount_usd': '1000000.50'},
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)

        row = AuditLog.objects.filter(
            model_name='Shipment',
            object_id=self.shipment.id,
            field_name='total_amount_usd',
            action='update',
        ).first()
        self.assertIsNotNone(row, 'Expected an audit row for total_amount_usd')
        self.assertEqual(row.new_value, '1000000.50',
                         f'Expected fixed-point notation, got: {row.new_value!r}')
        self.assertNotIn('E+', row.new_value, 'new_value must not use scientific notation')
        self.assertNotIn('e+', row.new_value, 'new_value must not use scientific notation')


class AuditChoicesFieldTests(TestCase):
    """Plain CharField(choices=...) fields render raw choice values, not labels.

    vehicle_condition is defined as:
        CharField(max_length=20, choices=VEHICLE_CONDITION_CHOICES, null=True, blank=True)

    where VEHICLE_CONDITION_CHOICES = [('OK','OK'), ('ISSUE','Issue'), ...].
    These are NOT TextChoices enum members — getattr(instance, 'vehicle_condition')
    returns a plain str like 'BREAKDOWN', not an enum member with a .label attribute.

    Therefore render_field_value() hits the ``str(value)`` fallback, and the stored
    value is 'BREAKDOWN' (raw), not 'Breakdown' (label). The .label branch in
    render_field_value() only fires for actual TextChoices.SOMETHING enum members,
    of which the Shipment model has none today.

    If TextChoices are introduced in the future, update both the model and these tests.
    """

    @classmethod
    def setUpTestData(cls):
        _seed_permissions()
        cls.status = _make_status()
        cls.season = _make_season()
        cls.user = _create_user('trans_choices', 'transport')

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.shipment = Shipment.objects.create(
            cargo_code=f'CH{self.id()[-4:]}001/26',
            date=date(2026, 2, 1),
            season=self.season,
            status=self.status,
            vehicle_condition='OK',
        )

    def test_choices_render_raw_value_not_label(self):
        """vehicle_condition 'OK' → 'BREAKDOWN' renders as raw strings, not display labels.

        This is expected behaviour: plain CharField(choices=...) values are raw
        strings. The 'label' rendering path is for TextChoices enum members only.
        """
        resp = self.client.patch(
            f'/api/v1/export/shipments/{self.shipment.id}/',
            {'vehicle_condition': 'BREAKDOWN'},
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)

        row = AuditLog.objects.filter(
            model_name='Shipment',
            object_id=self.shipment.id,
            field_name='vehicle_condition',
            action='update',
        ).first()
        self.assertIsNotNone(row, 'Expected an audit row for vehicle_condition change')
        # Raw string 'OK' — NOT the display label 'OK' (they happen to be the same here,
        # so we assert old_value is exactly 'OK' and new_value is exactly 'BREAKDOWN').
        self.assertEqual(row.old_value, 'OK',
                         'old_value for plain choices field must be the raw string, not a display label')
        self.assertEqual(row.new_value, 'BREAKDOWN',
                         'new_value for plain choices field must be the raw string, not the label "Breakdown"')

        # Confirm the display label 'Breakdown' is NOT stored (would indicate an
        # unintended TextChoices code path).
        self.assertNotEqual(row.new_value, 'Breakdown',
                            '"Breakdown" (label) must not be stored for plain CharField choices')


class ForbiddenFieldPathTests(TestCase):
    """Existing 403 / 400 paths in partial_update are preserved after the audit hook."""

    @classmethod
    def setUpTestData(cls):
        _seed_permissions()
        cls.status = _make_status()
        cls.season = _make_season()

    def setUp(self):
        self.shipment = Shipment.objects.create(
            cargo_code=f'FB{self.id()[-4:]}001/26',
            date=date(2026, 2, 1),
            season=self.season,
            status=self.status,
        )

    def test_forbidden_field_returns_403_no_audit_row(self):
        """warehouse_chief cannot edit price_per_kg → 403, zero audit rows."""
        user = _create_user('wh_403', 'warehouse_chief')
        client = APIClient()
        client.force_authenticate(user=user)

        before_count = AuditLog.objects.filter(
            model_name='Shipment', object_id=self.shipment.id,
        ).count()

        resp = client.patch(
            f'/api/v1/export/shipments/{self.shipment.id}/',
            {'price_per_kg': '0.95'},
            format='json',
        )
        self.assertEqual(resp.status_code, 403, resp.data)
        self.assertIn('price_per_kg', resp.data['error'])

        after_count = AuditLog.objects.filter(
            model_name='Shipment', object_id=self.shipment.id,
        ).count()
        self.assertEqual(after_count, before_count,
                         'No audit rows must be written when the request returns 403')
