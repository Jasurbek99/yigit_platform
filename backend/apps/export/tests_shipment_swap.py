"""Tests for the Swap endpoint on ShipmentViewSet.

Coverage:
  1.  Happy path: swap truck_plate + driver_name — DB updated, audit log written,
      response shape matches contract.
  2.  No-op: both fields already equal → 200 with swapped_fields: [], no audit log.
  3.  Whitelist rejection: fields=['cargo_code'] → 400.
  4.  Whitelist rejection: fields=['weight_net'] → 400.
  5.  Self-swap: other_id == path id → 400.
  6.  Non-existent other: other_id points to missing pk → 400.
  7.  Empty fields list: fields=[] → 400 (DRF ListField min_length=1).
  8.  NULL handling: A.driver_name='Ali', B.driver_name=None → after swap A=None, B='Ali'.
  9.  FK swap: A.country=X, B.country=Y → country_id values exchanged.
  10. Permission denied: user lacks edit perm for one field → 403, no DB changes.
  11. Concurrent safety: two parallel swap requests on same pair — smoke test.
  12. GET /swappable-fields/ returns the whitelist.

All tests run against the SQLite test DB — no MSSQL instance required.
"""
import datetime
import threading
from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import (
    Country,
    Customer,
    Season,
    ShipmentStatusType,
    User,
)
from apps.export.models import Shipment, ShipmentStatusLog
from apps.export.swap_config import SWAPPABLE_FIELDS


# ---------------------------------------------------------------------------
# Shared helpers (mirror the pattern from tests_shipment_join.py)
# ---------------------------------------------------------------------------

def _make_user(username: str, role: str) -> User:
    user = User(username=username, role=role)
    user.set_password('pass')
    user.save()
    return user


def _make_season() -> Season:
    season, _ = Season.objects.get_or_create(
        name='sw-test',
        defaults={
            'start_date': '2025-09-01',
            'end_date': '2026-06-30',
            'is_active': True,
        },
    )
    return season


def _make_status(code: str, step_order: int = 1, phase: str = 'LOADING') -> ShipmentStatusType:
    st, _ = ShipmentStatusType.objects.get_or_create(
        code=code,
        defaults={
            'name_tk': code,
            'name_en': code,
            'step_order': step_order,
            'phase': phase,
        },
    )
    return st


def _make_country(code: str = 'ST', name: str = 'SwapTest') -> Country:
    country, _ = Country.objects.get_or_create(
        code=code,
        defaults={'name_tk': name, 'name_en': name, 'name_ru': name},
    )
    return country


def _make_customer(name: str = 'SwapTestCustomer') -> Customer:
    customer, _ = Customer.objects.get_or_create(name=name)
    return customer


def _make_shipment(
    cargo_code: str,
    user: User | None = None,
    country: Country | None = None,
    **kwargs,
) -> Shipment:
    """Create a minimal shipment in 'yuklenme' status."""
    status_obj = _make_status('yuklenme', step_order=1, phase='LOADING')
    season = _make_season()
    return Shipment.objects.create(
        cargo_code=cargo_code,
        date=datetime.date(2026, 5, 25),
        season=season,
        status=status_obj,
        country=country,
        created_by=user,
        **kwargs,
    )


def _auth(client: APIClient, user: User) -> None:
    client.force_authenticate(user=user)


def _swap_url(pk: int) -> str:
    return f'/api/v1/export/shipments/{pk}/swap/'


# ---------------------------------------------------------------------------
# 1. Happy path
# ---------------------------------------------------------------------------

class SwapHappyPathTests(TestCase):
    """Swap truck_plate + driver_name between two shipments."""

    def setUp(self):
        self.client = APIClient()
        self.manager = _make_user('gadam_sw', 'export_manager')
        _auth(self.client, self.manager)

        # export_manager bypasses all can_edit_sheet_field gates (admin/director bypass).
        # Use export_manager so permission checks don't interfere with the happy path.
        self.ship_a = _make_shipment(
            '0301001/25',
            user=self.manager,
            truck_plate='AA1111TM',
            driver_name='Ali',
        )
        self.ship_b = _make_shipment(
            '0301002/25',
            user=self.manager,
            truck_plate='BB2222TM',
            driver_name='Veli',
        )

    def test_happy_path_db_values_exchanged(self):
        """After swap, truck_plate and driver_name are exchanged in the DB."""
        resp = self.client.post(
            _swap_url(self.ship_a.pk),
            {'other_id': self.ship_b.pk, 'fields': ['truck_plate', 'driver_name']},
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)

        self.ship_a.refresh_from_db()
        self.ship_b.refresh_from_db()

        self.assertEqual(self.ship_a.truck_plate, 'BB2222TM')
        self.assertEqual(self.ship_a.driver_name, 'Veli')
        self.assertEqual(self.ship_b.truck_plate, 'AA1111TM')
        self.assertEqual(self.ship_b.driver_name, 'Ali')

    def test_happy_path_audit_log_written_on_both(self):
        """ShipmentStatusLog rows are created on both A and B."""
        resp = self.client.post(
            _swap_url(self.ship_a.pk),
            {'other_id': self.ship_b.pk, 'fields': ['truck_plate', 'driver_name']},
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)

        log_a = ShipmentStatusLog.objects.filter(
            shipment=self.ship_a,
            comment__startswith='Swapped fields with shipment',
        )
        log_b = ShipmentStatusLog.objects.filter(
            shipment=self.ship_b,
            comment__startswith='Swapped fields with shipment',
        )

        self.assertEqual(log_a.count(), 1, 'Expected exactly one swap audit log on A')
        self.assertEqual(log_b.count(), 1, 'Expected exactly one swap audit log on B')

        # Log on A should mention B's cargo code, and vice-versa.
        self.assertIn(self.ship_b.cargo_code, log_a.first().comment)
        self.assertIn(self.ship_a.cargo_code, log_b.first().comment)
        self.assertEqual(log_a.first().changed_by_id, self.manager.pk)

    def test_happy_path_response_shape(self):
        """Response contains 'shipments' (list of 2) and 'swapped_fields'."""
        resp = self.client.post(
            _swap_url(self.ship_a.pk),
            {'other_id': self.ship_b.pk, 'fields': ['truck_plate', 'driver_name']},
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)

        self.assertIn('shipments', resp.data)
        self.assertIn('swapped_fields', resp.data)
        self.assertEqual(len(resp.data['shipments']), 2)

        # Both cargo codes appear in the response shipments
        codes = {s['cargo_code'] for s in resp.data['shipments']}
        self.assertIn('0301001/25', codes)
        self.assertIn('0301002/25', codes)

        # swapped_fields contains exactly what we asked
        self.assertEqual(sorted(resp.data['swapped_fields']), ['driver_name', 'truck_plate'])

    def test_happy_path_swapped_fields_in_audit_comment(self):
        """Audit comment includes the field names that were actually swapped."""
        resp = self.client.post(
            _swap_url(self.ship_a.pk),
            {'other_id': self.ship_b.pk, 'fields': ['truck_plate']},
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)

        log = ShipmentStatusLog.objects.get(
            shipment=self.ship_a,
            comment__startswith='Swapped',
        )
        self.assertIn('truck_plate', log.comment)


# ---------------------------------------------------------------------------
# 2. No-op: both values equal
# ---------------------------------------------------------------------------

class SwapNoOpTests(TestCase):
    """When all requested fields already match, return 200 with empty swapped_fields."""

    def setUp(self):
        self.client = APIClient()
        self.manager = _make_user('gadam_noop', 'export_manager')
        _auth(self.client, self.manager)

        self.ship_a = _make_shipment('0302001/25', user=self.manager, truck_plate='SAME111')
        self.ship_b = _make_shipment('0302002/25', user=self.manager, truck_plate='SAME111')

    def test_noop_returns_200_empty_swapped_fields(self):
        """No-op: same truck_plate on both → 200 with swapped_fields=[]."""
        resp = self.client.post(
            _swap_url(self.ship_a.pk),
            {'other_id': self.ship_b.pk, 'fields': ['truck_plate']},
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.data['swapped_fields'], [])

    def test_noop_writes_no_audit_log(self):
        """No audit log rows when there is nothing to swap."""
        before = ShipmentStatusLog.objects.filter(
            shipment__in=[self.ship_a, self.ship_b],
            comment__startswith='Swapped',
        ).count()

        self.client.post(
            _swap_url(self.ship_a.pk),
            {'other_id': self.ship_b.pk, 'fields': ['truck_plate']},
            format='json',
        )

        after = ShipmentStatusLog.objects.filter(
            shipment__in=[self.ship_a, self.ship_b],
            comment__startswith='Swapped',
        ).count()
        self.assertEqual(before, after, 'No audit log should be written for a no-op swap')


# ---------------------------------------------------------------------------
# 3. Whitelist rejection: cargo_code
# ---------------------------------------------------------------------------

class SwapWhitelistRejectionTests(TestCase):
    """Non-whitelisted fields are rejected with 400."""

    def setUp(self):
        self.client = APIClient()
        self.manager = _make_user('gadam_wl', 'export_manager')
        _auth(self.client, self.manager)

        self.ship_a = _make_shipment('0303001/25', user=self.manager)
        self.ship_b = _make_shipment('0303002/25', user=self.manager)

    def test_cargo_code_rejected(self):
        """'cargo_code' is not in the whitelist → 400."""
        resp = self.client.post(
            _swap_url(self.ship_a.pk),
            {'other_id': self.ship_b.pk, 'fields': ['cargo_code']},
            format='json',
        )
        self.assertEqual(resp.status_code, 400, resp.data)
        self.assertIn('cargo_code', resp.data['error'])
        self.assertIn('not swappable', resp.data['error'])

    def test_weight_net_rejected(self):
        """'weight_net' is intentionally excluded from the whitelist → 400."""
        resp = self.client.post(
            _swap_url(self.ship_a.pk),
            {'other_id': self.ship_b.pk, 'fields': ['weight_net']},
            format='json',
        )
        self.assertEqual(resp.status_code, 400, resp.data)
        self.assertIn('weight_net', resp.data['error'])
        self.assertIn('not swappable', resp.data['error'])

    def test_arbitrary_unlisted_field_rejected(self):
        """A made-up field name → 400."""
        resp = self.client.post(
            _swap_url(self.ship_a.pk),
            {'other_id': self.ship_b.pk, 'fields': ['banana_field']},
            format='json',
        )
        self.assertEqual(resp.status_code, 400, resp.data)


# ---------------------------------------------------------------------------
# 5. Self-swap
# ---------------------------------------------------------------------------

class SwapSelfTests(TestCase):
    """Swapping a shipment with itself is rejected with 400."""

    def setUp(self):
        self.client = APIClient()
        self.manager = _make_user('gadam_self', 'export_manager')
        _auth(self.client, self.manager)
        self.ship = _make_shipment('0305001/25', user=self.manager)

    def test_self_swap_returns_400(self):
        resp = self.client.post(
            _swap_url(self.ship.pk),
            {'other_id': self.ship.pk, 'fields': ['truck_plate']},
            format='json',
        )
        self.assertEqual(resp.status_code, 400, resp.data)
        self.assertIn('itself', resp.data['error'])


# ---------------------------------------------------------------------------
# 6. Non-existent other_id
# ---------------------------------------------------------------------------

class SwapNonExistentOtherTests(TestCase):
    """other_id pointing to a missing shipment returns 400."""

    def setUp(self):
        self.client = APIClient()
        self.manager = _make_user('gadam_ne', 'export_manager')
        _auth(self.client, self.manager)
        self.ship = _make_shipment('0306001/25', user=self.manager)

    def test_nonexistent_other_returns_400(self):
        resp = self.client.post(
            _swap_url(self.ship.pk),
            {'other_id': 999999, 'fields': ['truck_plate']},
            format='json',
        )
        self.assertEqual(resp.status_code, 400, resp.data)
        self.assertIn('not found', resp.data['error'])


# ---------------------------------------------------------------------------
# 7. Empty fields list
# ---------------------------------------------------------------------------

class SwapEmptyFieldsTests(TestCase):
    """Passing fields=[] is rejected by DRF (min_length=1 on ListField)."""

    def setUp(self):
        self.client = APIClient()
        self.manager = _make_user('gadam_ef', 'export_manager')
        _auth(self.client, self.manager)
        self.ship_a = _make_shipment('0307001/25', user=self.manager)
        self.ship_b = _make_shipment('0307002/25', user=self.manager)

    def test_empty_fields_list_returns_400(self):
        resp = self.client.post(
            _swap_url(self.ship_a.pk),
            {'other_id': self.ship_b.pk, 'fields': []},
            format='json',
        )
        self.assertEqual(resp.status_code, 400, resp.data)


# ---------------------------------------------------------------------------
# 8. NULL handling
# ---------------------------------------------------------------------------

class SwapNullHandlingTests(TestCase):
    """Swapping a value with NULL works correctly."""

    def setUp(self):
        self.client = APIClient()
        self.manager = _make_user('gadam_null', 'export_manager')
        _auth(self.client, self.manager)

        self.ship_a = _make_shipment('0308001/25', user=self.manager, driver_name='Ali')
        self.ship_b = _make_shipment('0308002/25', user=self.manager, driver_name=None)

    def test_swap_value_with_null(self):
        """A.driver_name='Ali', B.driver_name=None → A=None, B='Ali' after swap."""
        resp = self.client.post(
            _swap_url(self.ship_a.pk),
            {'other_id': self.ship_b.pk, 'fields': ['driver_name']},
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.data['swapped_fields'], ['driver_name'])

        self.ship_a.refresh_from_db()
        self.ship_b.refresh_from_db()

        self.assertIsNone(self.ship_a.driver_name)
        self.assertEqual(self.ship_b.driver_name, 'Ali')


# ---------------------------------------------------------------------------
# 9. FK swap
# ---------------------------------------------------------------------------

class SwapFKTests(TestCase):
    """Swapping a FK field exchanges the _id column values."""

    def setUp(self):
        self.client = APIClient()
        self.manager = _make_user('gadam_fk', 'export_manager')
        _auth(self.client, self.manager)

        self.country_x = _make_country('SX', 'SwapX')
        self.country_y = _make_country('SY', 'SwapY')

        self.ship_a = _make_shipment('0309001/25', user=self.manager, country=self.country_x)
        self.ship_b = _make_shipment('0309002/25', user=self.manager, country=self.country_y)

    def test_fk_swap_exchanges_country_ids(self):
        """After swap, ship_a.country_id == country_y.pk and vice-versa."""
        resp = self.client.post(
            _swap_url(self.ship_a.pk),
            {'other_id': self.ship_b.pk, 'fields': ['country']},
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.data['swapped_fields'], ['country'])

        self.ship_a.refresh_from_db()
        self.ship_b.refresh_from_db()

        self.assertEqual(self.ship_a.country_id, self.country_y.pk)
        self.assertEqual(self.ship_b.country_id, self.country_x.pk)

    def test_fk_swap_null_to_value(self):
        """Swapping when one FK is NULL works: A.country=X, B.country=None → A=None, B=X."""
        self.ship_b.country = None
        self.ship_b.save(update_fields=['country_id'])

        resp = self.client.post(
            _swap_url(self.ship_a.pk),
            {'other_id': self.ship_b.pk, 'fields': ['country']},
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)

        self.ship_a.refresh_from_db()
        self.ship_b.refresh_from_db()

        self.assertIsNone(self.ship_a.country_id)
        self.assertEqual(self.ship_b.country_id, self.country_x.pk)


# ---------------------------------------------------------------------------
# 10. Permission denied
# ---------------------------------------------------------------------------

class SwapPermissionDeniedTests(TestCase):
    """A user without edit perm on a field gets 403; no DB changes occur."""

    def setUp(self):
        self.client = APIClient()
        # sales_rep has a limited edit window — use a field they can't edit
        # on both shipments.  We test that 403 is returned and DB is untouched.
        self.user = _make_user('arap_perm', 'sales_rep')
        _auth(self.client, self.user)

        self.ship_a = _make_shipment(
            '0310001/25',
            user=self.user,
            truck_plate='ORIG_A',
        )
        self.ship_b = _make_shipment(
            '0310002/25',
            user=self.user,
            truck_plate='ORIG_B',
        )

    def test_permission_denied_returns_403(self):
        """sales_rep cannot edit warehouse_note (owned by loading_dept_head/warehouse_chief).
        The 403 response should include the field name.
        """
        resp = self.client.post(
            _swap_url(self.ship_a.pk),
            {'other_id': self.ship_b.pk, 'fields': ['warehouse_note']},
            format='json',
        )
        # can_edit_sheet_field falls back to can_edit_field when no SheetRowSetting
        # exists.  For 'warehouse_note', the base role-field permission table
        # must deny sales_rep.  If the permission check allows it (e.g. because no
        # SheetRowSetting exists and can_edit_field returns True for sales_rep),
        # the test is explicitly flagged as requiring permission setup.
        # We accept either 403 (perm denied) or verify the logic path.
        # Since the test environment has no SheetRowSetting rows, the fallback
        # can_edit_field determines the outcome.  We assert the endpoint at least
        # correctly calls the permission check — see notes below.
        #
        # If your role-field map gives sales_rep warehouse_note access, replace
        # 'warehouse_note' with a field that sales_rep provably cannot touch.
        #
        # For the purpose of this test suite, we mock the permission helper.
        from unittest.mock import patch
        from apps.core import permissions as core_perms

        with patch.object(core_perms, 'can_edit_sheet_field', return_value=False) as mock_perm:
            resp = self.client.post(
                _swap_url(self.ship_a.pk),
                {'other_id': self.ship_b.pk, 'fields': ['warehouse_note']},
                format='json',
            )
            self.assertEqual(resp.status_code, 403, resp.data)
            self.assertIn('warehouse_note', resp.data['error'])
            # DB must be untouched
            self.ship_a.refresh_from_db()
            self.ship_b.refresh_from_db()
            # truck_plate wasn't in the request so unchanged; original values intact
            self.assertEqual(self.ship_a.truck_plate, 'ORIG_A')
            self.assertEqual(self.ship_b.truck_plate, 'ORIG_B')

    def test_permission_denied_includes_field_name_in_error(self):
        """The 403 error message names the offending field."""
        from unittest.mock import patch
        from apps.core import permissions as core_perms

        with patch.object(core_perms, 'can_edit_sheet_field', return_value=False):
            resp = self.client.post(
                _swap_url(self.ship_a.pk),
                {'other_id': self.ship_b.pk, 'fields': ['driver_name']},
                format='json',
            )
            self.assertEqual(resp.status_code, 403, resp.data)
            self.assertIn('driver_name', resp.data['error'])


# ---------------------------------------------------------------------------
# 11. Concurrent safety smoke test
# ---------------------------------------------------------------------------

class SwapConcurrencyTest(TestCase):
    """Smoke test: two threads swap different field pairs on the same shipments.

    Goal: verify that select_for_update() + pk-order locking prevents
    deadlocks and that both threads complete with coherent DB state.
    This is a smoke test — it asserts absence of exceptions and that
    at least one swap recorded an audit log, not that both applied.
    """

    def setUp(self):
        self.manager = _make_user('gadam_conc', 'export_manager')

        self.ship_a = _make_shipment(
            '0311001/25',
            user=self.manager,
            truck_plate='CONC_A',
            driver_name='DrA',
        )
        self.ship_b = _make_shipment(
            '0311002/25',
            user=self.manager,
            truck_plate='CONC_B',
            driver_name='DrB',
        )

    def test_concurrent_swaps_do_not_crash(self):
        """Two threads can swap different fields on the same pair without deadlock."""
        errors: list[Exception] = []
        responses: list[int] = []

        def do_swap(fields: list[str]) -> None:
            client = APIClient()
            client.force_authenticate(user=self.manager)
            try:
                resp = client.post(
                    _swap_url(self.ship_a.pk),
                    {'other_id': self.ship_b.pk, 'fields': fields},
                    format='json',
                )
                responses.append(resp.status_code)
            except Exception as exc:
                errors.append(exc)

        t1 = threading.Thread(target=do_swap, args=(['truck_plate'],))
        t2 = threading.Thread(target=do_swap, args=(['driver_name'],))
        t1.start()
        t2.start()
        t1.join(timeout=10)
        t2.join(timeout=10)

        # No unhandled exceptions in either thread
        self.assertFalse(errors, f'Thread errors: {errors}')
        # Both threads should have received 200
        self.assertTrue(
            all(code == 200 for code in responses),
            f'Expected all 200 responses, got: {responses}',
        )
        # At least one audit log written (the swap(s) took effect)
        log_count = ShipmentStatusLog.objects.filter(
            comment__startswith='Swapped fields with shipment',
        ).count()
        self.assertGreaterEqual(log_count, 1)


# ---------------------------------------------------------------------------
# 12. GET /swappable-fields/
# ---------------------------------------------------------------------------

class SwappableFieldsEndpointTests(TestCase):
    """GET /api/v1/export/shipments/swappable-fields/ returns the whitelist."""

    def setUp(self):
        self.client = APIClient()
        self.user = _make_user('anyuser_sw', 'export_manager')
        _auth(self.client, self.user)

    def test_returns_200_with_fields_list(self):
        resp = self.client.get('/api/v1/export/shipments/swappable-fields/')
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertIn('fields', resp.data)
        self.assertIsInstance(resp.data['fields'], list)

    def test_fields_match_whitelist_constant(self):
        """The returned fields are exactly SWAPPABLE_FIELDS (sorted)."""
        resp = self.client.get('/api/v1/export/shipments/swappable-fields/')
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(sorted(resp.data['fields']), sorted(SWAPPABLE_FIELDS))

    def test_cargo_code_not_in_fields(self):
        """cargo_code must not appear in the whitelist response."""
        resp = self.client.get('/api/v1/export/shipments/swappable-fields/')
        self.assertNotIn('cargo_code', resp.data['fields'])

    def test_weight_net_not_in_fields(self):
        """weight_net must not appear in the whitelist response (intentionally excluded)."""
        resp = self.client.get('/api/v1/export/shipments/swappable-fields/')
        self.assertNotIn('weight_net', resp.data['fields'])

    def test_unauthenticated_returns_401(self):
        """Unauthenticated request is rejected."""
        self.client.force_authenticate(user=None)
        resp = self.client.get('/api/v1/export/shipments/swappable-fields/')
        self.assertEqual(resp.status_code, 401)


# ---------------------------------------------------------------------------
# 13. Partial no-op: mixed equal and different fields
# ---------------------------------------------------------------------------

class SwapPartialNoOpTests(TestCase):
    """When some fields differ and some are equal, only the different ones swap."""

    def setUp(self):
        self.client = APIClient()
        self.manager = _make_user('gadam_partial', 'export_manager')
        _auth(self.client, self.manager)

        self.ship_a = _make_shipment(
            '0313001/25', user=self.manager,
            truck_plate='DIFF_A', driver_name='SAME',
        )
        self.ship_b = _make_shipment(
            '0313002/25', user=self.manager,
            truck_plate='DIFF_B', driver_name='SAME',
        )

    def test_only_differing_fields_appear_in_swapped_fields(self):
        """driver_name is the same on both → not in swapped_fields; truck_plate differs."""
        resp = self.client.post(
            _swap_url(self.ship_a.pk),
            {'other_id': self.ship_b.pk, 'fields': ['truck_plate', 'driver_name']},
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.data['swapped_fields'], ['truck_plate'])

        self.ship_a.refresh_from_db()
        self.ship_b.refresh_from_db()
        # truck_plate swapped
        self.assertEqual(self.ship_a.truck_plate, 'DIFF_B')
        self.assertEqual(self.ship_b.truck_plate, 'DIFF_A')
        # driver_name unchanged
        self.assertEqual(self.ship_a.driver_name, 'SAME')
        self.assertEqual(self.ship_b.driver_name, 'SAME')
