"""Tests for the Sunday-EOD plan edit cutoff and admin late-edit extension.

Covers:
- _plan_edit_window_closed() helper (pure logic, no DB)
- set_plan_value() time-gate for greenhouse_manager (DB required)
- grant-late-edit endpoint (admin-only, future datetime, non-empty reason)
- revoke-late-edit endpoint (clears all four fields)
- set_actual_value() is NOT affected by the cutoff (admin-only path unchanged)

NOTE: DB-touching tests are gated on DB_AVAILABLE; pure-function tests run
everywhere using a SimpleNamespace config stub and mocked DB calls.

Usage:
    python manage.py test apps.greenhouse.tests.test_late_edit_extension --verbosity=2
"""
import unittest
from datetime import datetime, timedelta, timezone as dt_timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

# ---------------------------------------------------------------------------
# Conditional imports — same pattern as test_actual_rollup.py
# ---------------------------------------------------------------------------
try:
    from django.test import TestCase
    from django.utils import timezone

    from apps.core.models import GreenhouseBlock, GreenhouseConfig, Season
    from apps.greenhouse.models import (
        BlockManagerAssignment,
        HarvestDayEntry,
        WeeklyHarvestPlan,
    )
    from apps.greenhouse.services.harvest_day_service import (
        _plan_edit_window_closed,
        set_actual_value,
        set_plan_value,
    )

    DB_AVAILABLE = True
except Exception:  # pragma: no cover
    DB_AVAILABLE = False

    # Minimal stubs so the pure-unit tests (which do NOT inherit TestCase) can
    # still import the helpers without a live Django setup.
    from apps.greenhouse.services.harvest_day_service import (  # noqa: F401 — best effort
        _plan_edit_window_closed,
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

ASHGABAT_TZ = dt_timezone(timedelta(hours=5), name='Asia/Ashgabat')


def _aware_dt(year, month, day, hour=0, minute=0, second=0, tz=None):
    """Build an aware datetime using the supplied tz (defaults to Ashgabat +05:00)."""
    tz = tz or ASHGABAT_TZ
    return datetime(year, month, day, hour, minute, second, tzinfo=tz)


def _make_plan_stub(year, week_number, granted_until=None):
    """Return a SimpleNamespace that mimics WeeklyHarvestPlan for the pure-logic tests."""
    return SimpleNamespace(
        year=year,
        week_number=week_number,
        late_edit_granted_until=granted_until,
    )


def _make_config_stub(timezone_name='Asia/Ashgabat'):
    """Return a SimpleNamespace mimicking GreenhouseConfig."""
    return SimpleNamespace(timezone_name=timezone_name)


# ---------------------------------------------------------------------------
# 1. Pure-unit tests for _plan_edit_window_closed()
#    These do NOT touch the DB and do NOT require Django TestCase.
# ---------------------------------------------------------------------------

class TestPlanEditWindowClosedHelper(unittest.TestCase):
    """Pure-function tests for _plan_edit_window_closed.

    Week under test: ISO 2026-W24 (Mon 2026-06-08 … Sat 2026-06-13).
    Cutoff: Sun 2026-06-07 23:59:59 Asia/Ashgabat = 2026-06-07 18:59:59 UTC.
    """

    # GreenhouseConfig is imported lazily inside _plan_edit_window_closed via
    # `from apps.core.models import GreenhouseConfig`. Patching the canonical
    # location (apps.core.models.GreenhouseConfig) ensures the mock is seen by
    # the lazy import regardless of when the import executes.
    _CONFIG_PATH = 'apps.core.models.GreenhouseConfig'

    def _call(self, plan_stub, now_utc):
        """Call helper with GreenhouseConfig.get_solo patched to return config stub."""
        config_stub = _make_config_stub()
        with patch(self._CONFIG_PATH) as mock_cls:
            mock_cls.get_solo.return_value = config_stub
            return _plan_edit_window_closed(plan_stub, now_utc=now_utc)

    def test_saturday_noon_before_cutoff_returns_false(self):
        """Sat noon of week W-1 is before the Sunday-EOD cutoff → window open."""
        # 2026-W24 Monday = 2026-06-08 → Sunday before = 2026-06-07
        # Sat noon = 2026-06-06 12:00 +05 = 2026-06-06 07:00 UTC
        plan = _make_plan_stub(year=2026, week_number=24)
        now = _aware_dt(2026, 6, 6, 12, 0, 0)  # Sat 12:00 Ashgabat
        self.assertFalse(self._call(plan, now.astimezone(dt_timezone.utc)))

    def test_sunday_23_59_59_returns_false(self):
        """Exactly at the cutoff boundary (23:59:59 local Sunday) → window still open."""
        plan = _make_plan_stub(year=2026, week_number=24)
        # Sun 2026-06-07 23:59:59 +05
        now = _aware_dt(2026, 6, 7, 23, 59, 59)
        self.assertFalse(self._call(plan, now.astimezone(dt_timezone.utc)))

    def test_monday_0001_after_cutoff_returns_true(self):
        """Mon 00:01 of week W — one minute after cutoff → window closed."""
        plan = _make_plan_stub(year=2026, week_number=24)
        # Mon 2026-06-08 00:01 +05
        now = _aware_dt(2026, 6, 8, 0, 1, 0)
        self.assertTrue(self._call(plan, now.astimezone(dt_timezone.utc)))

    def test_extension_active_reopens_window(self):
        """Late-edit extension set to Mon 12:00 → window open at Mon 09:00."""
        granted = _aware_dt(2026, 6, 8, 12, 0, 0)  # Mon 12:00 Ashgabat
        plan = _make_plan_stub(year=2026, week_number=24, granted_until=granted.astimezone(dt_timezone.utc))
        now = _aware_dt(2026, 6, 8, 9, 0, 0)
        self.assertFalse(self._call(plan, now.astimezone(dt_timezone.utc)))

    def test_extension_expired_window_stays_closed(self):
        """Late-edit extension expired (granted_until <= now) → window closed."""
        granted = _aware_dt(2026, 6, 8, 12, 0, 0)  # Mon 12:00 Ashgabat
        plan = _make_plan_stub(year=2026, week_number=24, granted_until=granted.astimezone(dt_timezone.utc))
        # One second after expiry
        now = _aware_dt(2026, 6, 8, 12, 0, 1)
        self.assertTrue(self._call(plan, now.astimezone(dt_timezone.utc)))


# ---------------------------------------------------------------------------
# 2. DB-backed integration tests
# ---------------------------------------------------------------------------

@unittest.skipUnless(DB_AVAILABLE, "Django test DB unavailable in this environment")
class TestPlanEditCutoffIntegration(TestCase):
    """DB-backed tests for set_plan_value() and the grant/revoke endpoints."""

    @classmethod
    def setUpTestData(cls):
        from django.contrib.auth import get_user_model
        User = get_user_model()

        GreenhouseConfig.get_solo()

        cls.season, _ = Season.objects.get_or_create(
            name='2025-LE',
            defaults={
                'start_date': '2025-09-01',
                'end_date': '2026-08-31',
                'is_active': True,
            },
        )
        cls.block, _ = GreenhouseBlock.objects.get_or_create(
            code='LE-A',
            defaults={'name': 'Late Edit Block A', 'is_active': True},
        )

        cls.admin_user = User.objects.create_user(
            username='le_admin', password='pass', role='admin',
        )
        cls.manager_user = User.objects.create_user(
            username='le_manager', password='pass', role='greenhouse_manager',
        )
        cls.director_user = User.objects.create_user(
            username='le_director', password='pass', role='director',
        )

        # Assign manager to block
        BlockManagerAssignment.objects.get_or_create(
            user=cls.manager_user,
            block=cls.block,
            defaults={'is_active': True},
        )

    def _make_plan_and_entry(self, iso_year, iso_week):
        """Create a WeeklyHarvestPlan + HarvestDayEntry for the given ISO week."""
        from datetime import date
        plan, _ = WeeklyHarvestPlan.objects.get_or_create(
            season=self.season,
            block=self.block,
            year=iso_year,
            week_number=iso_week,
        )
        monday = date.fromisocalendar(iso_year, iso_week, 1)
        entry, _ = HarvestDayEntry.objects.get_or_create(
            weekly_plan=plan,
            entry_date=monday,
            defaults={
                'season': self.season,
                'block': self.block,
                'weekday': 0,
            },
        )
        return plan, entry

    # --- set_plan_value() time-gate tests ---

    def test_greenhouse_manager_can_edit_before_sunday_cutoff(self):
        """Sat noon of week W-1 → manager edit succeeds."""
        # W24/2026 Monday = 2026-06-08; Sat before = 2026-06-06
        plan, entry = self._make_plan_and_entry(2026, 24)
        sat_noon_utc = _aware_dt(2026, 6, 6, 7, 0, 0, tz=dt_timezone.utc)  # ~12:00 Ashgabat

        with patch('apps.greenhouse.services.harvest_day_service.timezone') as mock_tz:
            mock_tz.now.return_value = sat_noon_utc
            mock_tz.utc = dt_timezone.utc
            # Should not raise
            set_plan_value(entry, Decimal('1500.00'), self.manager_user)

        entry.refresh_from_db()
        self.assertEqual(entry.plan_value, Decimal('1500.00'))

    def test_greenhouse_manager_blocked_after_sunday_cutoff(self):
        """Mon 00:01 of week W → manager edit blocked; error references cutoff datetime."""
        plan, entry = self._make_plan_and_entry(2026, 24)
        # Reset plan_value to avoid override-reason check
        entry.plan_value = None
        entry.save(update_fields=['plan_value'])

        mon_0001_utc = _aware_dt(2026, 6, 7, 19, 1, 0, tz=dt_timezone.utc)  # Mon 00:01 Ashgabat

        with patch('apps.greenhouse.services.harvest_day_service.timezone') as mock_tz:
            mock_tz.now.return_value = mon_0001_utc
            mock_tz.utc = dt_timezone.utc
            with self.assertRaises(PermissionError) as ctx:
                set_plan_value(entry, Decimal('1000.00'), self.manager_user)

        msg = str(ctx.exception)
        self.assertIn('closed at', msg)
        self.assertIn('2026-06-07', msg)  # Sunday before

    def test_greenhouse_manager_can_edit_when_extension_active(self):
        """Mon 09:00 with granted_until = Mon 12:00 → edit succeeds."""
        plan, entry = self._make_plan_and_entry(2026, 24)
        entry.plan_value = None
        entry.save(update_fields=['plan_value'])

        mon_12_utc = _aware_dt(2026, 6, 8, 7, 0, 0, tz=dt_timezone.utc)  # Mon 12:00 Ashgabat
        plan.late_edit_granted_until = mon_12_utc
        plan.save(update_fields=['late_edit_granted_until'])

        mon_09_utc = _aware_dt(2026, 6, 8, 4, 0, 0, tz=dt_timezone.utc)  # Mon 09:00 Ashgabat

        with patch('apps.greenhouse.services.harvest_day_service.timezone') as mock_tz:
            mock_tz.now.return_value = mon_09_utc
            mock_tz.utc = dt_timezone.utc
            # Should not raise
            set_plan_value(entry, Decimal('900.00'), self.manager_user)

        entry.refresh_from_db()
        self.assertEqual(entry.plan_value, Decimal('900.00'))

    def test_extension_passive_expiry_blocks_edit(self):
        """One second after granted_until → edit blocked (> not >=)."""
        plan, entry = self._make_plan_and_entry(2026, 24)
        entry.plan_value = None
        entry.save(update_fields=['plan_value'])

        mon_12_utc = _aware_dt(2026, 6, 8, 7, 0, 0, tz=dt_timezone.utc)  # Mon 12:00:00 Ashgabat
        plan.late_edit_granted_until = mon_12_utc
        plan.save(update_fields=['late_edit_granted_until'])

        # One second after expiry
        expired_utc = mon_12_utc + timedelta(seconds=1)

        with patch('apps.greenhouse.services.harvest_day_service.timezone') as mock_tz:
            mock_tz.now.return_value = expired_utc
            mock_tz.utc = dt_timezone.utc
            with self.assertRaises(PermissionError):
                set_plan_value(entry, Decimal('800.00'), self.manager_user)

    def test_admin_always_allowed_after_cutoff(self):
        """Admin can set plan_value on Mon 09:00 without any extension."""
        plan, entry = self._make_plan_and_entry(2026, 24)
        entry.plan_value = None
        entry.save(update_fields=['plan_value'])

        mon_09_utc = _aware_dt(2026, 6, 8, 4, 0, 0, tz=dt_timezone.utc)  # Mon 09:00 Ashgabat

        with patch('apps.greenhouse.services.harvest_day_service.timezone') as mock_tz:
            mock_tz.now.return_value = mon_09_utc
            mock_tz.utc = dt_timezone.utc
            # Admin requires a reason only when overriding an existing value.
            # entry.plan_value is None here, so no reason needed.
            set_plan_value(entry, Decimal('2000.00'), self.admin_user)

        entry.refresh_from_db()
        self.assertEqual(entry.plan_value, Decimal('2000.00'))

    def test_actual_value_not_blocked_by_plan_cutoff(self):
        """set_actual_value() (admin-only path) is unaffected by the plan cutoff.

        The spec mentions warehouse_chief/loading_dept_head, but set_actual_value
        is admin-only per the existing service contract. We verify the admin path
        is not blocked by the plan-window gate even when called past the cutoff.
        """
        plan, entry = self._make_plan_and_entry(2026, 24)
        entry.actual_value = None
        entry.save(update_fields=['actual_value'])

        mon_09_utc = _aware_dt(2026, 6, 8, 4, 0, 0, tz=dt_timezone.utc)  # past cutoff

        with patch('apps.greenhouse.services.harvest_day_service.timezone') as mock_tz:
            mock_tz.now.return_value = mon_09_utc
            mock_tz.utc = dt_timezone.utc
            # Should not raise — actual path has no time-gate
            set_actual_value(entry, Decimal('1800.00'), self.admin_user)

        entry.refresh_from_db()
        self.assertEqual(entry.actual_value, Decimal('1800.00'))

    # --- Endpoint tests ---

    def _api_client(self, user):
        from rest_framework.test import APIClient
        client = APIClient()
        client.force_authenticate(user=user)
        return client

    def _plan_url(self, plan_id, action_name):
        return f'/api/v1/greenhouse/harvest-plans/{plan_id}/{action_name}/'

    def test_grant_endpoint_admin_only(self):
        """Director receives 403; admin receives 200."""
        plan, _ = self._make_plan_and_entry(2026, 25)
        future = (timezone.now() + timedelta(days=1)).isoformat()
        payload = {'granted_until': future, 'reason': 'Needed for late submission'}

        director_client = self._api_client(self.director_user)
        response = director_client.post(self._plan_url(plan.id, 'grant-late-edit'), payload, format='json')
        self.assertEqual(response.status_code, 403)

        admin_client = self._api_client(self.admin_user)
        response = admin_client.post(self._plan_url(plan.id, 'grant-late-edit'), payload, format='json')
        self.assertEqual(response.status_code, 200)

    def test_grant_endpoint_rejects_past_datetime(self):
        """granted_until in the past → 400 with field error."""
        plan, _ = self._make_plan_and_entry(2026, 25)
        past = (timezone.now() - timedelta(hours=1)).isoformat()
        payload = {'granted_until': past, 'reason': 'Testing past datetime'}

        admin_client = self._api_client(self.admin_user)
        response = admin_client.post(self._plan_url(plan.id, 'grant-late-edit'), payload, format='json')
        self.assertEqual(response.status_code, 400)
        self.assertIn('granted_until', response.data)

    def test_grant_endpoint_accepts_empty_reason(self):
        """Empty or missing reason now returns 200; stored as empty string."""
        plan, _ = self._make_plan_and_entry(2026, 25)
        future = (timezone.now() + timedelta(days=1)).isoformat()

        admin_client = self._api_client(self.admin_user)

        # Whitespace-only reason
        response = admin_client.post(
            self._plan_url(plan.id, 'grant-late-edit'),
            {'granted_until': future, 'reason': '   '},
            format='json',
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['late_edit_granted_reason'], '')

        # No reason key at all — reset plan first
        plan.late_edit_granted_until = None
        plan.late_edit_granted_by = None
        plan.late_edit_granted_at = None
        plan.late_edit_granted_reason = ''
        plan.save(update_fields=[
            'late_edit_granted_until', 'late_edit_granted_by',
            'late_edit_granted_at', 'late_edit_granted_reason',
        ])

        response2 = admin_client.post(
            self._plan_url(plan.id, 'grant-late-edit'),
            {'granted_until': future},
            format='json',
        )
        self.assertEqual(response2.status_code, 200)
        self.assertEqual(response2.data['late_edit_granted_reason'], '')

    def test_grant_endpoint_persists_fields_and_returns_late_edit_active(self):
        """Successful grant: all four fields saved, late_edit_active=True in response."""
        plan, _ = self._make_plan_and_entry(2026, 26)
        granted_until = timezone.now() + timedelta(hours=6)
        payload = {
            'granted_until': granted_until.isoformat(),
            'reason': 'Manager needs more time',
        }

        admin_client = self._api_client(self.admin_user)
        response = admin_client.post(self._plan_url(plan.id, 'grant-late-edit'), payload, format='json')
        self.assertEqual(response.status_code, 200)

        data = response.data
        self.assertTrue(data['late_edit_active'])
        self.assertEqual(data['late_edit_granted_reason'], 'Manager needs more time')
        self.assertEqual(data['late_edit_granted_by'], self.admin_user.id)
        self.assertIsNotNone(data['late_edit_granted_at'])

        plan.refresh_from_db()
        self.assertIsNotNone(plan.late_edit_granted_until)
        self.assertEqual(plan.late_edit_granted_by, self.admin_user)

    def test_revoke_endpoint_clears_fields(self):
        """Admin revoke → all four late_edit_* fields back to null/empty."""
        plan, _ = self._make_plan_and_entry(2026, 27)
        # Set up an existing grant
        plan.late_edit_granted_until = timezone.now() + timedelta(hours=3)
        plan.late_edit_granted_by = self.admin_user
        plan.late_edit_granted_at = timezone.now()
        plan.late_edit_granted_reason = 'Some reason'
        plan.save(update_fields=[
            'late_edit_granted_until', 'late_edit_granted_by',
            'late_edit_granted_at', 'late_edit_granted_reason',
        ])

        admin_client = self._api_client(self.admin_user)
        response = admin_client.post(self._plan_url(plan.id, 'revoke-late-edit'))
        self.assertEqual(response.status_code, 200)

        data = response.data
        self.assertFalse(data['late_edit_active'])
        self.assertIsNone(data['late_edit_granted_until'])
        self.assertIsNone(data['late_edit_granted_by'])
        self.assertIsNone(data['late_edit_granted_at'])
        self.assertEqual(data['late_edit_granted_reason'], '')

        plan.refresh_from_db()
        self.assertIsNone(plan.late_edit_granted_until)
        self.assertIsNone(plan.late_edit_granted_by_id)
        self.assertIsNone(plan.late_edit_granted_at)
        self.assertEqual(plan.late_edit_granted_reason, '')

    # --- Bulk endpoint tests ---

    def _bulk_url(self, action_name):
        return f'/api/v1/greenhouse/harvest-plans/{action_name}/'

    def test_bulk_grant_admin_only(self):
        """Director → 403; admin → 200 with updated count."""
        plan, _ = self._make_plan_and_entry(2026, 30)
        future = (timezone.now() + timedelta(days=1)).isoformat()
        payload = {'plan_ids': [plan.id], 'granted_until': future}

        director_client = self._api_client(self.director_user)
        response = director_client.post(self._bulk_url('bulk-grant-late-edit'), payload, format='json')
        self.assertEqual(response.status_code, 403)

        admin_client = self._api_client(self.admin_user)
        response = admin_client.post(self._bulk_url('bulk-grant-late-edit'), payload, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['updated'], 1)

    def test_bulk_grant_applies_to_all_listed_plans(self):
        """3 plan IDs → all 3 rows have late_edit_granted_until set and granted_by = admin."""
        plan_a, _ = self._make_plan_and_entry(2026, 31)
        plan_b, _ = self._make_plan_and_entry(2026, 32)
        plan_c, _ = self._make_plan_and_entry(2026, 33)
        future = timezone.now() + timedelta(hours=8)
        payload = {
            'plan_ids': [plan_a.id, plan_b.id, plan_c.id],
            'granted_until': future.isoformat(),
            'reason': 'batch grant',
        }

        admin_client = self._api_client(self.admin_user)
        response = admin_client.post(self._bulk_url('bulk-grant-late-edit'), payload, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['updated'], 3)
        self.assertEqual(len(response.data['results']), 3)

        for plan in (plan_a, plan_b, plan_c):
            plan.refresh_from_db()
            self.assertIsNotNone(plan.late_edit_granted_until)
            self.assertEqual(plan.late_edit_granted_by_id, self.admin_user.id)
            self.assertEqual(plan.late_edit_granted_reason, 'batch grant')

    def test_bulk_grant_unknown_ids_silently_skipped(self):
        """2 real IDs + 1 fake ID → updated == 2, no 404."""
        plan_a, _ = self._make_plan_and_entry(2026, 34)
        plan_b, _ = self._make_plan_and_entry(2026, 35)
        fake_id = 999999
        future = (timezone.now() + timedelta(days=1)).isoformat()
        payload = {
            'plan_ids': [plan_a.id, plan_b.id, fake_id],
            'granted_until': future,
        }

        admin_client = self._api_client(self.admin_user)
        response = admin_client.post(self._bulk_url('bulk-grant-late-edit'), payload, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['updated'], 2)
        self.assertEqual(len(response.data['results']), 2)

    def test_bulk_grant_rejects_past_datetime(self):
        """granted_until in the past → 400 with granted_until field error."""
        plan, _ = self._make_plan_and_entry(2026, 36)
        past = (timezone.now() - timedelta(hours=1)).isoformat()
        payload = {'plan_ids': [plan.id], 'granted_until': past}

        admin_client = self._api_client(self.admin_user)
        response = admin_client.post(self._bulk_url('bulk-grant-late-edit'), payload, format='json')
        self.assertEqual(response.status_code, 400)
        self.assertIn('granted_until', response.data)

    def test_bulk_grant_rejects_empty_plan_ids(self):
        """Empty plan_ids list → 400 with plan_ids field error."""
        future = (timezone.now() + timedelta(days=1)).isoformat()
        payload = {'plan_ids': [], 'granted_until': future}

        admin_client = self._api_client(self.admin_user)
        response = admin_client.post(self._bulk_url('bulk-grant-late-edit'), payload, format='json')
        self.assertEqual(response.status_code, 400)
        self.assertIn('plan_ids', response.data)

    def test_bulk_grant_reason_optional(self):
        """Request without reason key → 200, stored as empty string."""
        plan, _ = self._make_plan_and_entry(2026, 37)
        future = (timezone.now() + timedelta(days=1)).isoformat()
        payload = {'plan_ids': [plan.id], 'granted_until': future}

        admin_client = self._api_client(self.admin_user)
        response = admin_client.post(self._bulk_url('bulk-grant-late-edit'), payload, format='json')
        self.assertEqual(response.status_code, 200)

        plan.refresh_from_db()
        self.assertEqual(plan.late_edit_granted_reason, '')

    def test_bulk_revoke_clears_all_fields(self):
        """Grant on 2 plans, then bulk revoke → all four fields back to null/empty on both."""
        plan_a, _ = self._make_plan_and_entry(2026, 38)
        plan_b, _ = self._make_plan_and_entry(2026, 39)

        # Set up grants directly
        for plan in (plan_a, plan_b):
            plan.late_edit_granted_until = timezone.now() + timedelta(hours=2)
            plan.late_edit_granted_by = self.admin_user
            plan.late_edit_granted_at = timezone.now()
            plan.late_edit_granted_reason = 'initial grant'
            plan.save(update_fields=[
                'late_edit_granted_until', 'late_edit_granted_by',
                'late_edit_granted_at', 'late_edit_granted_reason',
            ])

        admin_client = self._api_client(self.admin_user)
        response = admin_client.post(
            self._bulk_url('bulk-revoke-late-edit'),
            {'plan_ids': [plan_a.id, plan_b.id]},
            format='json',
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['updated'], 2)

        for plan in (plan_a, plan_b):
            plan.refresh_from_db()
            self.assertIsNone(plan.late_edit_granted_until)
            self.assertIsNone(plan.late_edit_granted_by_id)
            self.assertIsNone(plan.late_edit_granted_at)
            self.assertEqual(plan.late_edit_granted_reason, '')

    def test_bulk_revoke_admin_only(self):
        """Director → 403 on bulk-revoke; admin → 200."""
        plan, _ = self._make_plan_and_entry(2026, 40)
        payload = {'plan_ids': [plan.id]}

        director_client = self._api_client(self.director_user)
        response = director_client.post(self._bulk_url('bulk-revoke-late-edit'), payload, format='json')
        self.assertEqual(response.status_code, 403)

        admin_client = self._api_client(self.admin_user)
        response = admin_client.post(self._bulk_url('bulk-revoke-late-edit'), payload, format='json')
        self.assertEqual(response.status_code, 200)
