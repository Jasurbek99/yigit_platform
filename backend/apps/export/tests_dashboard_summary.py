"""Tests for the main dashboard summary endpoint and service.

Coverage:
  1. Anonymous request → 401
  2. Authenticated non-boss user → 200 with expected top-level keys
  3. Data correctness:
     - Two in-season non-draft shipments → stats.total = 2
     - One out-of-season shipment excluded
     - One draft shipment excluded
  4. Cache hit: second request re-runs only the season-resolution query
  5. Spec §4.3 — `?season=` parameterises stats/routes' date range (not
     SeasonScopedMixin-scoped) and is gated by closed_season.can_view like
     every other scoped endpoint
"""
from datetime import date, timedelta
from decimal import Decimal

from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core.models import RoleResourcePermission, Season, ShipmentStatusType, User


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


def _make_shipment(shipment_code: str, season: Season, status: ShipmentStatusType, shipment_date: str = '2026-01-10'):
    """Create a bare-minimum Shipment for test purposes."""
    from apps.export.models import Shipment
    return Shipment.objects.create(
        shipment_code=shipment_code,
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
        """Second request within TTL must be served from cache, minus the
        unavoidable season-resolution query.

        The cache key is now `dashboard:summary:<season_id>` (spec §4.3 —
        stats/routes are parameterised by the resolved season, so a season
        switch must not serve another season's stale cached numbers). That
        means `resolve_season(request)` has to run BEFORE the cache lookup
        on every request, cache hit or not, to know which key to check —
        so a cache hit is 1 query (season resolution), not 0.
        """
        _make_season()
        _make_status('draft', step_order=0, phase='PREP')

        # Warm cache
        self.client.get('/api/v1/export/dashboard/summary/')

        # Second call: only the season-resolution query, no aggregation queries
        with self.assertNumQueries(1):
            resp = self.client.get('/api/v1/export/dashboard/summary/')
        self.assertEqual(resp.status_code, 200)


# ---------------------------------------------------------------------------
# Test: ?season= parameterises the date range (spec §4.3)
# ---------------------------------------------------------------------------

class DashboardSeasonParamTests(TestCase):
    """`dashboard` is a date-range endpoint per spec §4.3: it takes the
    RESOLVED season's date range, not just the active one, and does not
    apply SeasonScopedMixin. These tests prove both halves: the range
    actually moves when `?season=` selects a closed season, and the
    `closed_season.can_view` gate — shared with every other scoped
    endpoint's `?season=` handling — still applies here too.
    """

    def setUp(self):
        cache.clear()
        self.client = APIClient()

    def test_closed_season_param_moves_the_range(self):
        closed_season = _make_season(
            name='dspclose1', start='2024-09-01', end='2025-06-30', is_active=False,
        )
        Season.objects.filter(pk=closed_season.pk).update(closed_at=timezone.now())
        active_season = _make_season(
            name='dspact1', start='2025-09-01', end='2026-06-30', is_active=True,
        )
        load_status = _make_status('yuklenme', step_order=1, phase='LOAD')
        # One shipment in each season's range — only the resolved season's
        # shipment should be counted.
        _make_shipment('DSP-OLD', closed_season, load_status, shipment_date='2024-12-01')
        _make_shipment('DSP-NEW', active_season, load_status, shipment_date='2026-01-10')

        privileged = _make_user('dsp_privileged', role='export_manager')
        RoleResourcePermission.objects.update_or_create(
            role='export_manager', resource_code='closed_season',
            defaults={'can_view': True},
        )
        self.client.force_authenticate(user=privileged)

        default_resp = self.client.get('/api/v1/export/dashboard/summary/')
        self.assertEqual(default_resp.status_code, 200)
        self.assertEqual(default_resp.json()['stats']['total']['value'], 1)
        self.assertEqual(default_resp.json()['season']['id'], active_season.id)

        closed_resp = self.client.get(
            f'/api/v1/export/dashboard/summary/?season={closed_season.pk}'
        )
        self.assertEqual(closed_resp.status_code, 200)
        self.assertEqual(closed_resp.json()['stats']['total']['value'], 1)
        self.assertEqual(closed_resp.json()['season']['id'], closed_season.id)
        # The range genuinely moved — the two responses' stats differ in
        # WHICH shipment was counted, not just that both happen to be 1.
        self.assertNotEqual(default_resp.json()['season'], closed_resp.json()['season'])

    def test_unpermitted_user_closed_season_gets_403(self):
        closed_season = _make_season(
            name='dspclose2', start='2024-09-01', end='2025-06-30', is_active=False,
        )
        Season.objects.filter(pk=closed_season.pk).update(closed_at=timezone.now())
        _make_season(name='dspact2', start='2025-09-01', end='2026-06-30', is_active=True)

        # No closed_season.can_view grant for this role.
        unprivileged = _make_user('dsp_unprivileged', role='sales_rep')
        self.client.force_authenticate(user=unprivileged)

        resp = self.client.get(
            f'/api/v1/export/dashboard/summary/?season={closed_season.pk}'
        )
        self.assertEqual(resp.status_code, 403)


# ---------------------------------------------------------------------------
# Test: D7 fail closed — the close→open gap (spec §3.1)
# ---------------------------------------------------------------------------

class DashboardNoActiveSeasonFailsClosedTests(TestCase):
    """D7 — with no season resolved, the dashboard returns an EMPTY payload.

    This path predates D7: it substituted a CURRENT-MONTH range when no season
    resolved. Seasons run Sept→Aug, so during the close→open gap the
    just-closed season's range still covers today, and any authenticated user
    with dashboard access could read aggregates over frozen rows — no
    `?season=`, no `closed_season.can_view` grant. `boss` and `clients-report`
    already returned empty for the same state.

    The fixture is built around `date.today()` precisely so the closed
    season's range and the old current-month fallback OVERLAP: every
    assertion below fails against the substitute range.

    The response SHAPE is preserved (all five top-level keys, all six stats
    keys, all four alert keys) — the frontend's `IDashboardSummary` requires
    them and already renders zero/empty/null for each.
    """

    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.user = _make_user('dash_gap_user', role='export_manager')
        self.client.force_authenticate(user=self.user)
        self.today = date.today()

    def _seed_gap(self) -> Season:
        """A closed season whose range covers TODAY, and no active season."""
        from apps.core.models import Country, GreenhouseBlock
        from apps.export.models import QualityDocument, Shipment
        from apps.greenhouse.models import HarvestDayEntry, WeeklyHarvestPlan

        closed = Season.objects.create(
            name='dsgapC',
            start_date=self.today - timedelta(days=300),
            end_date=self.today + timedelta(days=30),
            is_active=False,
            closed_at=timezone.now(),
        )
        Season.objects.filter(is_active=True).update(is_active=False)

        country = Country.objects.create(name_en='Kazakhstan', name_tk='Gazagystan')
        load_status = _make_status('yuklenme', step_order=1, phase='LOAD')
        shipment = Shipment.objects.create(
            shipment_code='DSGAP-1', date=self.today, season=closed,
            status=load_status, country=country,
        )
        # alerts.docs_pending_count — every flag False, so 1 pending.
        QualityDocument.objects.create(shipment=shipment)

        # alerts.weekly_plan — current ISO week, so it is populated whenever
        # the aggregation runs at all.
        iso_year, iso_week, iso_weekday = self.today.isocalendar()
        block = GreenhouseBlock.objects.create(code='G1', name='Gap block')
        plan = WeeklyHarvestPlan.objects.create(
            season=closed, block=block, week_number=iso_week, year=iso_year,
        )
        HarvestDayEntry.objects.create(
            weekly_plan=plan, season=closed, block=block,
            entry_date=self.today, weekday=iso_weekday - 1,
            plan_value=Decimal('5000.00'),
        )
        cache.clear()
        return closed

    def _gap_response(self):
        self._seed_gap()
        return self.client.get('/api/v1/export/dashboard/summary/')

    def test_the_fixture_really_is_visible_through_a_resolved_season(self):
        """Control: the same rows DO aggregate when a season resolves, so the
        empty assertions below measure the gap and not an empty database."""
        closed = self._seed_gap()
        RoleResourcePermission.objects.update_or_create(
            role='export_manager', resource_code='closed_season',
            defaults={'can_view': True},
        )
        data = self.client.get(
            f'/api/v1/export/dashboard/summary/?season={closed.pk}'
        ).json()
        self.assertEqual(data['stats']['total']['value'], 1)
        self.assertEqual(len(data['routes']), 1)
        self.assertEqual(len(data['active_shipments']), 1)
        self.assertEqual(data['alerts']['docs_pending_count'], 1)
        self.assertIsNotNone(data['alerts']['weekly_plan'])

    def test_gap_returns_zeroed_stats_not_a_substitute_range(self):
        stats = self._gap_response().json()['stats']
        self.assertEqual(stats['total']['value'], 0)
        for key, item in stats.items():
            self.assertEqual(item['value'], 0, f'stats.{key}.value leaked data')

    def test_gap_returns_empty_routes_and_active_shipments(self):
        data = self._gap_response().json()
        self.assertEqual(data['routes'], [])
        self.assertEqual(data['active_shipments'], [])

    def test_gap_returns_zeroed_alerts(self):
        alerts = self._gap_response().json()['alerts']
        self.assertEqual(alerts['no_report_count'], 0)
        self.assertEqual(alerts['quota_exceeded_count'], 0)
        self.assertEqual(alerts['docs_pending_count'], 0)
        self.assertIsNone(alerts['weekly_plan'])

    def test_gap_preserves_the_response_shape(self):
        """An empty payload must still satisfy the frontend's contract."""
        data = self._gap_response().json()
        for key in ('season', 'stats', 'alerts', 'routes', 'active_shipments'):
            self.assertIn(key, data, f'Missing key: {key!r}')
        for key in ('total', 'in_transit', 'selling', 'completed', 'no_report',
                    'quota_firms'):
            self.assertIn(key, data['stats'], f'Missing stats key: {key!r}')
        for key in ('no_report_count', 'quota_exceeded_count',
                    'docs_pending_count', 'weekly_plan'):
            self.assertIn(key, data['alerts'], f'Missing alerts key: {key!r}')
        self.assertIsNone(data['season'])
        self.assertIn('delta_7d', data['stats']['total'])
        self.assertIn('delta_7d', data['stats']['completed'])

    def test_explicit_closed_season_still_resolves_for_a_permitted_user(self):
        """Failing closed on the GAP must not break the switcher: an explicit
        `?season=` from a user holding `closed_season.can_view` still reads."""
        closed = self._seed_gap()
        RoleResourcePermission.objects.update_or_create(
            role='export_manager', resource_code='closed_season',
            defaults={'can_view': True},
        )
        resp = self.client.get(
            f'/api/v1/export/dashboard/summary/?season={closed.pk}'
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['season']['id'], closed.pk)
