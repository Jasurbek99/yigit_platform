"""Tests for the main dashboard summary endpoint and service.

Coverage:
  1. Anonymous request → 401
  2. Authenticated non-boss user → 200 with expected top-level keys
  3. Data correctness:
     - Two in-season non-draft shipments → stats.total = 2
     - One out-of-season shipment excluded
     - One draft shipment excluded
  4. Cache hit: second request does not re-run DB queries (assertNumQueries == 0)
"""
from datetime import date, timedelta

from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import Season, ShipmentStatusType, User


# ---------------------------------------------------------------------------
# Shared fixtures
# ---------------------------------------------------------------------------

def _make_user(username: str, role: str = 'export_manager') -> User:
    user = User(username=username, role=role)
    user.set_password('pass')
    user.save()
    return user


def _make_season(
    name: str = 'ds25',
    start: str = '2025-09-01',
    end: str = '2026-06-30',
    is_active: bool = True,
) -> Season:
    s, _ = Season.objects.get_or_create(
        name=name,
        defaults={'start_date': start, 'end_date': end, 'is_active': is_active},
    )
    return s


def _make_status(code: str, step_order: int = 1, phase: str = 'LOAD') -> ShipmentStatusType:
    st, _ = ShipmentStatusType.objects.get_or_create(
        code=code,
        defaults={
            'name_tk': code,
            'name_en': code.capitalize(),
            'step_order': step_order,
            'phase': phase,
        },
    )
    return st


def _make_shipment(cargo_code: str, season: Season, status: ShipmentStatusType, shipment_date: str = '2026-01-10'):
    """Create a bare-minimum Shipment for test purposes."""
    from apps.export.models import Shipment
    return Shipment.objects.create(
        cargo_code=cargo_code,
        date=shipment_date,
        season=season,
        status=status,
    )


# ---------------------------------------------------------------------------
# Test: auth gate
# ---------------------------------------------------------------------------

class DashboardAuthGateTests(TestCase):

    def setUp(self):
        cache.clear()
        self.client = APIClient()

    def test_anonymous_gets_401(self):
        """Anonymous requests must be rejected with 401."""
        resp = self.client.get('/api/v1/export/dashboard/summary/')
        self.assertEqual(resp.status_code, 401)


# ---------------------------------------------------------------------------
# Test: authenticated returns 200 with expected keys
# ---------------------------------------------------------------------------

class DashboardResponseShapeTests(TestCase):

    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.user = _make_user('dash_user', role='document_team')

    def test_authenticated_gets_200(self):
        """Any authenticated user receives 200."""
        self.client.force_authenticate(user=self.user)
        _make_season()
        _make_status('draft', step_order=0, phase='PREP')
        resp = self.client.get('/api/v1/export/dashboard/summary/')
        self.assertEqual(resp.status_code, 200)

    def test_top_level_keys_present(self):
        """Response contains all five required top-level keys."""
        self.client.force_authenticate(user=self.user)
        _make_season()
        _make_status('draft', step_order=0, phase='PREP')
        resp = self.client.get('/api/v1/export/dashboard/summary/')
        data = resp.json()
        for key in ('season', 'stats', 'alerts', 'routes', 'active_shipments'):
            self.assertIn(key, data, f"Missing key: {key!r}")

    def test_stats_keys_present(self):
        """stats dict contains all six stat keys."""
        self.client.force_authenticate(user=self.user)
        _make_season()
        _make_status('draft', step_order=0, phase='PREP')
        resp = self.client.get('/api/v1/export/dashboard/summary/')
        stats = resp.json()['stats']
        for key in ('total', 'in_transit', 'selling', 'completed', 'no_report', 'quota_firms'):
            self.assertIn(key, stats, f"Missing stats key: {key!r}")

    def test_alerts_keys_present(self):
        """alerts dict contains all four alert keys."""
        self.client.force_authenticate(user=self.user)
        _make_season()
        _make_status('draft', step_order=0, phase='PREP')
        resp = self.client.get('/api/v1/export/dashboard/summary/')
        alerts = resp.json()['alerts']
        for key in ('no_report_count', 'quota_exceeded_count', 'docs_pending_count', 'weekly_plan'):
            self.assertIn(key, alerts, f"Missing alerts key: {key!r}")

    def test_non_boss_role_allowed(self):
        """A sales_rep (non-boss) must receive 200, not 403."""
        sales_user = _make_user('sales_dash', role='sales_rep')
        self.client.force_authenticate(user=sales_user)
        _make_season()
        _make_status('draft', step_order=0, phase='PREP')
        resp = self.client.get('/api/v1/export/dashboard/summary/')
        self.assertEqual(resp.status_code, 200)


# ---------------------------------------------------------------------------
# Test: data correctness
# ---------------------------------------------------------------------------

class DashboardDataCorrectnessTests(TestCase):

    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.user = _make_user('dash_data_user', role='export_manager')
        self.client.force_authenticate(user=self.user)

    def _season(self, **kwargs):
        return _make_season(**kwargs)

    def test_total_counts_only_non_draft_in_season(self):
        """stats.total.value counts non-draft shipments within the active season only.

        Setup:
          - Season: 2025-09-01 to 2026-06-30 (active)
          - 2 in-season, non-draft shipments           → must be counted
          - 1 in-season, draft shipment                → excluded
          - 1 out-of-season non-draft shipment         → excluded
        """
        season = self._season(name='ds25b', start='2025-09-01', end='2026-06-30')
        draft_status = _make_status('draft', step_order=0, phase='PREP')
        load_status = _make_status('yuklenme', step_order=1, phase='LOAD')

        # In-season, non-draft × 2
        _make_shipment('DS001', season, load_status, shipment_date='2026-01-10')
        _make_shipment('DS002', season, load_status, shipment_date='2026-02-15')

        # In-season, draft × 1 — must be EXCLUDED
        _make_shipment('DS003', season, draft_status, shipment_date='2026-01-20')

        # Out-of-season, non-draft × 1 — must be EXCLUDED
        past_season = _make_season(
            name='ds24', start='2024-09-01', end='2025-06-30', is_active=False,
        )
        # Even though is_active=False, base_qs filters on date range, not season FK
        _make_shipment('DS004', past_season, load_status, shipment_date='2024-12-01')

        resp = self.client.get('/api/v1/export/dashboard/summary/')
        self.assertEqual(resp.status_code, 200)
        total = resp.json()['stats']['total']['value']
        self.assertEqual(total, 2, f"Expected 2 but got {total}")

    def test_season_field_in_response(self):
        """season field must reflect the active season ID and name."""
        season = self._season(name='ds25c', start='2025-09-01', end='2026-06-30')
        _make_status('draft', step_order=0, phase='PREP')
        resp = self.client.get('/api/v1/export/dashboard/summary/')
        season_data = resp.json()['season']
        self.assertIsNotNone(season_data)
        self.assertEqual(season_data['id'], season.id)
        self.assertEqual(season_data['name'], 'ds25c')

    def test_no_active_season_returns_null_season(self):
        """When no season is active, season field is null and endpoint still returns 200."""
        # Ensure no active season exists by deactivating any that might be present
        Season.objects.filter(is_active=True).update(is_active=False)
        _make_status('draft', step_order=0, phase='PREP')
        cache.clear()
        resp = self.client.get('/api/v1/export/dashboard/summary/')
        self.assertEqual(resp.status_code, 200)
        self.assertIsNone(resp.json()['season'])

    def test_in_transit_is_live_not_season_scoped(self):
        """stats.in_transit counts LIVE transit-status shipments regardless of season."""
        past_season = _make_season(
            name='ds24t', start='2024-09-01', end='2025-06-30', is_active=False,
        )
        current_season = self._season(name='ds25t', start='2025-09-01', end='2026-06-30')
        transit_status = _make_status('yola_chykdy', step_order=4, phase='TRANSIT')

        # One in current season
        _make_shipment('TR001', current_season, transit_status, shipment_date='2026-01-10')
        # One in past season (out of date range for base_qs but LIVE right now)
        _make_shipment('TR002', past_season, transit_status, shipment_date='2025-01-10')

        resp = self.client.get('/api/v1/export/dashboard/summary/')
        in_transit = resp.json()['stats']['in_transit']['value']
        # Both should be counted (LIVE, not scoped)
        self.assertGreaterEqual(in_transit, 2)


# ---------------------------------------------------------------------------
# Test: cache
# ---------------------------------------------------------------------------

class DashboardCacheTests(TestCase):

    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.user = _make_user('dash_cache_user', role='finansist')
        self.client.force_authenticate(user=self.user)

    def test_second_request_is_cache_hit(self):
        """Second request within TTL must be served from cache with zero DB queries."""
        _make_season()
        _make_status('draft', step_order=0, phase='PREP')

        # Warm cache
        self.client.get('/api/v1/export/dashboard/summary/')

        # Second call: no DB queries
        with self.assertNumQueries(0):
            resp = self.client.get('/api/v1/export/dashboard/summary/')
        self.assertEqual(resp.status_code, 200)
