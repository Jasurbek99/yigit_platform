"""Tests for GreenhouseConfig and OperatingDayException REST endpoints.

Covers:
    1. GET greenhouse-config as admin → 200 + full payload
    2. GET greenhouse-config as non-admin → 200 (reads are open to all authenticated users)
    3. PATCH greenhouse-config as admin → updates truck_capacity_kg, confirmed by GET
    4. PATCH greenhouse-config as non-admin → 403
    5. PATCH greenhouse-config with invalid timezone → 400
    6. PATCH greenhouse-config with invalid weekday → 400
    7. POST operating-day-exception as admin → 201, row created
    8. POST operating-day-exception as non-admin → 403
    9. GET operating-day-exceptions with date_from/date_to filters
    10. DELETE operating-day-exception as admin → 204

Usage:
    python manage.py test apps.core.tests.test_config_api --keepdb --verbosity=2
"""
import datetime

from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import GreenhouseConfig, OperatingDayException, User

# ── Helpers ──────────────────────────────────────────────────────────────────

CONFIG_URL = '/api/v1/core/greenhouse-config/'
EXCEPTIONS_URL = '/api/v1/core/operating-day-exceptions/'


def _make_user(username: str, role: str) -> User:
    """Create and return a User with the given role."""
    user = User(username=username, role=role)
    user.set_password('testpass123')
    user.save()
    return user


def _make_client(user: User) -> APIClient:
    """Return an APIClient authenticated as user."""
    client = APIClient()
    client.force_authenticate(user=user)
    return client


# ── GreenhouseConfig tests ────────────────────────────────────────────────────

class GreenhouseConfigGetTests(TestCase):
    """GET /api/v1/core/greenhouse-config/ — reads open to all authenticated users."""

    def setUp(self):
        self.admin = _make_user('cfg_admin', 'admin')
        self.greenhouse_manager = _make_user('cfg_gm', 'greenhouse_manager')
        # Ensure the singleton exists.
        GreenhouseConfig.get_solo()

    def test_get_config_as_admin_returns_200(self):
        """Admin receives full config payload."""
        client = _make_client(self.admin)
        resp = client.get(CONFIG_URL)

        self.assertEqual(resp.status_code, 200, resp.data)
        data = resp.data
        # Required keys present
        self.assertIn('id', data)
        self.assertIn('plan_deadline_weekday', data)
        self.assertIn('truck_capacity_kg', data)
        self.assertIn('operating_days_bitmask', data)
        self.assertIn('timezone_name', data)
        self.assertIn('updated_by_name', data)
        # Singleton always id=1
        self.assertEqual(data['id'], 1)
        # Defaults match model
        self.assertEqual(data['plan_deadline_weekday'], 4)
        self.assertEqual(data['timezone_name'], 'Asia/Ashgabat')

    def test_get_config_as_non_admin_returns_200(self):
        """Non-admin authenticated users can also read the config (GET is open)."""
        client = _make_client(self.greenhouse_manager)
        resp = client.get(CONFIG_URL)

        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.data['id'], 1)

    def test_get_config_unauthenticated_returns_401(self):
        """Unauthenticated request must be rejected."""
        client = APIClient()
        resp = client.get(CONFIG_URL)
        self.assertIn(resp.status_code, (401, 403))


class GreenhouseConfigPatchTests(TestCase):
    """PATCH /api/v1/core/greenhouse-config/ — writes are admin-only."""

    def setUp(self):
        self.admin = _make_user('pcfg_admin', 'admin')
        self.warehouse_chief = _make_user('pcfg_wc', 'warehouse_chief')
        GreenhouseConfig.get_solo()

    def test_patch_config_as_admin_updates_truck_capacity(self):
        """Admin can PATCH truck_capacity_kg; GET confirms the new value."""
        client = _make_client(self.admin)

        resp = client.patch(CONFIG_URL, {'truck_capacity_kg': '19000.00'}, format='json')
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(str(resp.data['truck_capacity_kg']), '19000.00')

        # Confirm persistence via GET
        get_resp = client.get(CONFIG_URL)
        self.assertEqual(str(get_resp.data['truck_capacity_kg']), '19000.00')

    def test_patch_config_as_admin_sets_updated_by(self):
        """PATCH sets updated_by to the requesting admin user."""
        client = _make_client(self.admin)
        resp = client.patch(CONFIG_URL, {'notification_lead_minutes': 30}, format='json')
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.data['updated_by'], self.admin.id)

    def test_patch_config_as_non_admin_returns_403(self):
        """Non-admin users cannot write to the singleton config."""
        client = _make_client(self.warehouse_chief)
        resp = client.patch(CONFIG_URL, {'truck_capacity_kg': '20000.00'}, format='json')
        self.assertEqual(resp.status_code, 403, resp.data)

    def test_patch_config_invalid_timezone_returns_400(self):
        """An unrecognised IANA timezone name must return 400."""
        client = _make_client(self.admin)
        resp = client.patch(CONFIG_URL, {'timezone_name': 'Mars/OlympusMons'}, format='json')
        self.assertEqual(resp.status_code, 400, resp.data)
        self.assertIn('timezone_name', resp.data)

    def test_patch_config_empty_timezone_returns_400(self):
        """An empty timezone_name string must return 400."""
        client = _make_client(self.admin)
        resp = client.patch(CONFIG_URL, {'timezone_name': ''}, format='json')
        self.assertEqual(resp.status_code, 400, resp.data)
        self.assertIn('timezone_name', resp.data)

    def test_patch_config_invalid_weekday_too_large_returns_400(self):
        """plan_deadline_weekday > 6 must return 400."""
        client = _make_client(self.admin)
        resp = client.patch(CONFIG_URL, {'plan_deadline_weekday': 7}, format='json')
        self.assertEqual(resp.status_code, 400, resp.data)
        self.assertIn('plan_deadline_weekday', resp.data)

    def test_patch_config_invalid_weekday_negative_returns_400(self):
        """PositiveSmallIntegerField rejects negative values."""
        client = _make_client(self.admin)
        resp = client.patch(CONFIG_URL, {'plan_deadline_weekday': -1}, format='json')
        self.assertEqual(resp.status_code, 400, resp.data)

    def test_patch_config_zero_truck_capacity_returns_400(self):
        """truck_capacity_kg = 0 must return 400 (must be > 0)."""
        client = _make_client(self.admin)
        resp = client.patch(CONFIG_URL, {'truck_capacity_kg': '0'}, format='json')
        self.assertEqual(resp.status_code, 400, resp.data)
        self.assertIn('truck_capacity_kg', resp.data)

    def test_patch_config_bitmask_out_of_range_returns_400(self):
        """operating_days_bitmask = 128 must return 400 (max is 127)."""
        client = _make_client(self.admin)
        resp = client.patch(CONFIG_URL, {'operating_days_bitmask': 128}, format='json')
        self.assertEqual(resp.status_code, 400, resp.data)
        self.assertIn('operating_days_bitmask', resp.data)

    def test_put_not_allowed(self):
        """PUT is disabled for the singleton — only PATCH is supported."""
        client = _make_client(self.admin)
        resp = client.put(CONFIG_URL, {'truck_capacity_kg': '18500'}, format='json')
        self.assertEqual(resp.status_code, 405)


# ── OperatingDayException tests ───────────────────────────────────────────────

class OperatingDayExceptionCreateTests(TestCase):
    """POST /api/v1/core/operating-day-exceptions/ — admin only."""

    def setUp(self):
        self.admin = _make_user('exc_admin', 'admin')
        self.greenhouse_manager = _make_user('exc_gm', 'greenhouse_manager')

    def test_create_exception_as_admin_returns_201(self):
        """Admin can create an operating-day exception row."""
        client = _make_client(self.admin)
        payload = {
            'date': '2026-05-09',
            'is_holiday': True,
            'note': 'Public holiday — Victory Day',
        }
        resp = client.post(EXCEPTIONS_URL, payload, format='json')

        self.assertEqual(resp.status_code, 201, resp.data)
        data = resp.data
        self.assertEqual(data['date'], '2026-05-09')
        self.assertTrue(data['is_holiday'])
        self.assertEqual(data['note'], 'Public holiday — Victory Day')
        self.assertEqual(data['created_by'], self.admin.id)
        self.assertIsNotNone(data['created_at'])

    def test_create_exception_sets_created_by(self):
        """created_by must be set to the admin performing the POST."""
        client = _make_client(self.admin)
        resp = client.post(
            EXCEPTIONS_URL,
            {'date': '2026-06-01', 'is_holiday': False},
            format='json',
        )
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(resp.data['created_by'], self.admin.id)

    def test_create_exception_as_non_admin_returns_403(self):
        """Non-admin users may not create exceptions."""
        client = _make_client(self.greenhouse_manager)
        resp = client.post(
            EXCEPTIONS_URL,
            {'date': '2026-05-10', 'is_holiday': True},
            format='json',
        )
        self.assertEqual(resp.status_code, 403, resp.data)


class OperatingDayExceptionListFilterTests(TestCase):
    """GET /api/v1/core/operating-day-exceptions/ — list with date range filters."""

    @classmethod
    def setUpTestData(cls):
        cls.admin = _make_user('flt_admin', 'admin')
        # Create a set of test exceptions spanning a range.
        dates = [
            datetime.date(2026, 1, 1),
            datetime.date(2026, 3, 15),
            datetime.date(2026, 5, 9),
            datetime.date(2026, 7, 4),
            datetime.date(2026, 12, 31),
        ]
        for i, d in enumerate(dates):
            OperatingDayException.objects.create(
                date=d,
                is_holiday=(i % 2 == 0),
                created_by=cls.admin,
            )

    def test_list_no_filter_returns_all(self):
        client = _make_client(self.admin)
        resp = client.get(EXCEPTIONS_URL)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['count'], 5)

    def test_filter_date_from(self):
        """date_from=2026-03-15 should return 4 rows (March, May, July, December)."""
        client = _make_client(self.admin)
        resp = client.get(EXCEPTIONS_URL, {'date_from': '2026-03-15'})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['count'], 4)

    def test_filter_date_to(self):
        """date_to=2026-05-09 should return 3 rows (Jan, March, May)."""
        client = _make_client(self.admin)
        resp = client.get(EXCEPTIONS_URL, {'date_to': '2026-05-09'})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['count'], 3)

    def test_filter_date_range(self):
        """date_from=2026-03-01 & date_to=2026-07-04 should return 3 rows."""
        client = _make_client(self.admin)
        resp = client.get(EXCEPTIONS_URL, {
            'date_from': '2026-03-01',
            'date_to': '2026-07-04',
        })
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['count'], 3)

    def test_filter_is_holiday_true(self):
        """is_holiday=true should return only holiday rows (indices 0, 2, 4 = Jan, May, Dec)."""
        client = _make_client(self.admin)
        resp = client.get(EXCEPTIONS_URL, {'is_holiday': 'true'})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['count'], 3)

    def test_filter_is_holiday_false(self):
        """is_holiday=false should return only non-holiday rows (indices 1, 3 = March, July)."""
        client = _make_client(self.admin)
        resp = client.get(EXCEPTIONS_URL, {'is_holiday': 'false'})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['count'], 2)

    def test_default_ordering_is_descending_date(self):
        """Default ordering must be -date (newest first)."""
        client = _make_client(self.admin)
        resp = client.get(EXCEPTIONS_URL)
        self.assertEqual(resp.status_code, 200)
        dates_returned = [r['date'] for r in resp.data['results']]
        self.assertEqual(dates_returned, sorted(dates_returned, reverse=True))

    def test_non_admin_can_list(self):
        """All authenticated users can GET the list."""
        user = _make_user('flt_gm', 'greenhouse_manager')
        client = _make_client(user)
        resp = client.get(EXCEPTIONS_URL)
        self.assertEqual(resp.status_code, 200)


class OperatingDayExceptionDeleteTests(TestCase):
    """DELETE /api/v1/core/operating-day-exceptions/{id}/ — admin only."""

    def setUp(self):
        self.admin = _make_user('del_admin', 'admin')
        self.greenhouse_manager = _make_user('del_gm', 'greenhouse_manager')
        self.exc = OperatingDayException.objects.create(
            date=datetime.date(2026, 8, 1),
            is_holiday=True,
            created_by=self.admin,
        )

    def test_delete_exception_as_admin_returns_204(self):
        """Admin can delete an existing exception."""
        client = _make_client(self.admin)
        url = f'{EXCEPTIONS_URL}{self.exc.id}/'
        resp = client.delete(url)
        self.assertEqual(resp.status_code, 204)
        self.assertFalse(OperatingDayException.objects.filter(pk=self.exc.id).exists())

    def test_delete_exception_as_non_admin_returns_403(self):
        """Non-admin users may not delete exceptions."""
        client = _make_client(self.greenhouse_manager)
        url = f'{EXCEPTIONS_URL}{self.exc.id}/'
        resp = client.delete(url)
        self.assertEqual(resp.status_code, 403)
        # Row must still exist.
        self.assertTrue(OperatingDayException.objects.filter(pk=self.exc.id).exists())
