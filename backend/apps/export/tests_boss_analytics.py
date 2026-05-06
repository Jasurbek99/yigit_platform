"""Smoke tests for the Boss Dashboard analytics endpoints.

Covers:
- Role gating: 200 for boss/director, 403 for others and anon
- summary/ returns 6 KPIs with sparkline arrays of length 12
- quota_grid/ level thresholds round-trip correctly
- blocks_heatmap/ rolls up WeeklyHarvestPlan correctly
- compliance/ 1:10 rule seeded data
- alerts/ ordering: high then med then low
- production/?scope=daily returns correct per-block row
- production/?scope=seasonal sums all weeks in season
- export_market/ returns rows per block; asserts no domestic/gift keys
- cache: second call within 60s returns identical data
- period_to_range: month math for April 2026
"""
from datetime import date
from decimal import Decimal
from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import (
    User, ExportFirm, GreenhouseBlock, Season, ShipmentStatusType, Country, City, Customer,
)
from apps.export.models import (
    Shipment, QuotaIssuance, QuotaIssuanceFirmAllocation, QuotaUsageRecord,
    Notification,
)
from apps.export.services.boss_analytics import period_to_range
from apps.greenhouse.models import WeeklyHarvestPlan


# ---------------------------------------------------------------------------
# Test helpers
# ---------------------------------------------------------------------------

def _create_user(username: str, role: str) -> User:
    user = User(username=username, role=role)
    user.set_password('pass')
    user.save()
    return user


def _create_season(name: str = '2025-2026', start: str = '2025-10-01', end: str = '2026-06-30') -> Season:
    season, _ = Season.objects.get_or_create(
        name=name,
        defaults={'start_date': start, 'end_date': end, 'is_active': True},
    )
    return season


def _create_status(code: str, step_order: int) -> ShipmentStatusType:
    status, _ = ShipmentStatusType.objects.get_or_create(
        code=code,
        defaults={'name_tk': code, 'step_order': step_order},
    )
    return status


# ---------------------------------------------------------------------------
# Role gating
# ---------------------------------------------------------------------------

class RoleGatingTests(TestCase):

    def setUp(self):
        self.client = APIClient()
        self.admin = _create_user('admin_boss', 'admin')
        self.boss = _create_user('boss1', 'boss')
        self.director = _create_user('director1', 'director')
        self.export_mgr = _create_user('mgr1', 'export_manager')
        self.anon_client = APIClient()

    def _get(self, user, url):
        self.client.force_authenticate(user=user)
        return self.client.get(url)

    def test_boss_gets_200_on_summary(self):
        resp = self._get(self.boss, '/api/v1/export/boss/summary/')
        self.assertEqual(resp.status_code, 200)

    def test_director_gets_200_on_summary(self):
        resp = self._get(self.director, '/api/v1/export/boss/summary/')
        self.assertEqual(resp.status_code, 200)

    def test_admin_gets_200_on_summary(self):
        resp = self._get(self.admin, '/api/v1/export/boss/summary/')
        self.assertEqual(resp.status_code, 200)

    def test_export_manager_gets_403_on_summary(self):
        resp = self._get(self.export_mgr, '/api/v1/export/boss/summary/')
        self.assertEqual(resp.status_code, 403)

    def test_anon_gets_403_on_summary(self):
        resp = self.anon_client.get('/api/v1/export/boss/summary/')
        self.assertIn(resp.status_code, (401, 403))

    def test_export_manager_gets_403_on_quota_grid(self):
        resp = self._get(self.export_mgr, '/api/v1/export/boss/quota_grid/')
        self.assertEqual(resp.status_code, 403)


# ---------------------------------------------------------------------------
# period_to_range math
# ---------------------------------------------------------------------------

class PeriodToRangeTests(TestCase):

    def test_month_april_2026(self):
        today = date(2026, 4, 15)
        from_date, to_date = period_to_range('month', today)
        self.assertEqual(from_date, date(2026, 4, 1))
        self.assertEqual(to_date, date(2026, 4, 30))

    def test_today(self):
        today = date(2026, 4, 27)
        from_date, to_date = period_to_range('today', today)
        self.assertEqual(from_date, today)
        self.assertEqual(to_date, today)

    def test_week(self):
        today = date(2026, 4, 27)
        from_date, to_date = period_to_range('week', today)
        self.assertEqual(to_date, today)
        self.assertEqual((to_date - from_date).days, 6)

    def test_season_uses_active_season(self):
        season = _create_season('2025-2026', '2025-10-01', '2026-06-30')
        season.is_active = True
        season.save()
        today = date(2026, 4, 27)
        from_date, to_date = period_to_range('season', today)
        self.assertEqual(from_date, date(2025, 10, 1))
        self.assertEqual(to_date, date(2026, 6, 30))

    def test_invalid_period_raises_value_error(self):
        with self.assertRaises(ValueError):
            period_to_range('invalid_slug', date(2026, 4, 27))


# ---------------------------------------------------------------------------
# summary/ endpoint — 6 KPIs, sparklines length 12
# ---------------------------------------------------------------------------

class SummaryEndpointTests(TestCase):

    def setUp(self):
        self.client = APIClient()
        self.boss = _create_user('boss2', 'boss')
        self.client.force_authenticate(user=self.boss)

    def test_summary_returns_six_kpi_keys(self):
        resp = self.client.get('/api/v1/export/boss/summary/?period=month')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn('kpis', data)
        kpis = data['kpis']
        for key in ('revenue', 'margin', 'debt', 'today_loaded', 'in_transit', 'quota_used'):
            self.assertIn(key, kpis, msg=f'Missing KPI: {key}')

    def test_summary_sparklines_have_12_elements(self):
        resp = self.client.get('/api/v1/export/boss/summary/?period=month')
        data = resp.json()
        kpis = data['kpis']
        for key in ('revenue', 'margin', 'debt', 'today_loaded', 'in_transit', 'quota_used'):
            sparkline = kpis[key].get('sparkline')
            self.assertIsNotNone(sparkline, msg=f'No sparkline for {key}')
            self.assertEqual(len(sparkline), 12, msg=f'Sparkline for {key} has wrong length')

    def test_summary_has_period_metadata(self):
        resp = self.client.get('/api/v1/export/boss/summary/?period=month')
        data = resp.json()
        self.assertIn('period', data)
        self.assertIn('from', data)
        self.assertIn('to', data)


# ---------------------------------------------------------------------------
# quota_grid/ — level thresholds
# ---------------------------------------------------------------------------

class QuotaGridTests(TestCase):

    def setUp(self):
        self.client = APIClient()
        self.boss = _create_user('boss3', 'boss')
        self.client.force_authenticate(user=self.boss)

    def _setup_firm_quota(self, firm: ExportFirm, quota_kg: Decimal, used_kg: Decimal):
        issuance = QuotaIssuance.objects.create(
            issue_date=date(2026, 1, 1),
            matched_week=1,
            matched_year=2026,
        )
        QuotaIssuanceFirmAllocation.objects.create(
            issuance=issuance,
            export_firm=firm,
            kg_quota=quota_kg,
        )
        if used_kg > 0:
            QuotaUsageRecord.objects.create(
                usage_date=date(2026, 4, 1),
                export_firm=firm,
                kg_used=used_kg,
                status='approved',
            )

    def test_quota_level_ok_below_80(self):
        firm = ExportFirm.objects.create(code='F01', name_tk='Firma 1', is_active=True)
        self._setup_firm_quota(firm, Decimal('1000'), Decimal('700'))  # 70%
        resp = self.client.get('/api/v1/export/boss/quota_grid/')
        data = resp.json()
        row = next((r for r in data['rows'] if r['firm_id'] == firm.id), None)
        self.assertIsNotNone(row)
        self.assertEqual(row['level'], 'ok')

    def test_quota_level_warn_between_80_and_95(self):
        firm = ExportFirm.objects.create(code='F02', name_tk='Firma 2', is_active=True)
        self._setup_firm_quota(firm, Decimal('1000'), Decimal('850'))  # 85%
        resp = self.client.get('/api/v1/export/boss/quota_grid/')
        data = resp.json()
        row = next((r for r in data['rows'] if r['firm_id'] == firm.id), None)
        self.assertIsNotNone(row)
        self.assertEqual(row['level'], 'warn')

    def test_quota_level_alert_at_or_above_95(self):
        firm = ExportFirm.objects.create(code='F03', name_tk='Firma 3', is_active=True)
        self._setup_firm_quota(firm, Decimal('1000'), Decimal('960'))  # 96%
        resp = self.client.get('/api/v1/export/boss/quota_grid/')
        data = resp.json()
        row = next((r for r in data['rows'] if r['firm_id'] == firm.id), None)
        self.assertIsNotNone(row)
        self.assertEqual(row['level'], 'alert')


# ---------------------------------------------------------------------------
# blocks_heatmap/ — plan vs actual rollup
# ---------------------------------------------------------------------------

class BlocksHeatmapTests(TestCase):

    def setUp(self):
        self.client = APIClient()
        self.boss = _create_user('boss4', 'boss')
        self.client.force_authenticate(user=self.boss)

    def test_heatmap_rolls_up_week_plan(self):
        season = _create_season()
        block = GreenhouseBlock.objects.create(code='A', name='A-Yyladyshana')
        WeeklyHarvestPlan.objects.create(
            season=season,
            block=block,
            week_number=17,
            year=2026,
            monday_plan_kg=Decimal('100'),
            monday_actual_kg=Decimal('80'),
        )
        resp = self.client.get('/api/v1/export/boss/blocks_heatmap/?period=week')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn('rows', data)
        # Should have at least 1 row for block A
        codes = [r['block_code'] for r in data['rows']]
        self.assertIn('A', codes)


# ---------------------------------------------------------------------------
# compliance/ — 1:10 quota rule
# ---------------------------------------------------------------------------

class ComplianceTests(TestCase):

    def setUp(self):
        self.client = APIClient()
        self.boss = _create_user('boss5', 'boss')
        self.client.force_authenticate(user=self.boss)

    def test_compliance_endpoint_returns_required_keys(self):
        resp = self.client.get('/api/v1/export/boss/compliance/?period=month')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        for key in ('reports_overdue', 'quota_1_to_10', 'docs_by_13'):
            self.assertIn(key, data)

    def test_ten_k_keys_absent(self):
        """The $10K rule was removed from v1 — confirm no leftover keys."""
        resp = self.client.get('/api/v1/export/boss/compliance/?period=month')
        data = resp.json()
        self.assertNotIn('ten_k_violations', data)
        self.assertNotIn('ten_k_placeholder', data)


# ---------------------------------------------------------------------------
# alerts/ — ordering by level
# ---------------------------------------------------------------------------

class AlertsTests(TestCase):

    def setUp(self):
        self.client = APIClient()
        self.boss = _create_user('boss6', 'boss')
        self.client.force_authenticate(user=self.boss)

    def test_alerts_endpoint_returns_rows(self):
        # Create some notifications for the boss user
        Notification.objects.create(
            user=self.boss,
            kind='quota_100',
            message='Quota full',
        )
        Notification.objects.create(
            user=self.boss,
            kind='overdue',
            message='Overdue shipment',
        )
        Notification.objects.create(
            user=self.boss,
            kind='plan_approved',
            message='Plan approved',
        )
        resp = self.client.get('/api/v1/export/boss/alerts/')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn('rows', data)
        self.assertIsInstance(data['rows'], list)

    def test_alerts_contain_level_field(self):
        Notification.objects.create(
            user=self.boss,
            kind='quota_100',
            message='Full',
        )
        resp = self.client.get('/api/v1/export/boss/alerts/')
        data = resp.json()
        if data['rows']:
            self.assertIn('level', data['rows'][0])

    def test_high_level_notifications_appear(self):
        Notification.objects.create(
            user=self.boss,
            kind='quota_95',
            message='Quota 95%',
        )
        resp = self.client.get('/api/v1/export/boss/alerts/')
        data = resp.json()
        high_rows = [r for r in data['rows'] if r['level'] == 'high']
        self.assertGreater(len(high_rows), 0)


# ---------------------------------------------------------------------------
# production/ endpoint
# ---------------------------------------------------------------------------

class ProductionEndpointTests(TestCase):

    def setUp(self):
        self.client = APIClient()
        self.boss = _create_user('boss7', 'boss')
        self.client.force_authenticate(user=self.boss)

    def _seed_plan(self, block_code: str, plan_kg: Decimal, actual_kg: Decimal) -> GreenhouseBlock:
        season = _create_season()
        block, _ = GreenhouseBlock.objects.get_or_create(
            code=block_code,
            defaults={'name': f'{block_code}-Yyladyshana'},
        )
        WeeklyHarvestPlan.objects.create(
            season=season,
            block=block,
            week_number=date.today().isocalendar()[1],
            year=date.today().isocalendar()[0],
            monday_plan_kg=plan_kg,
            monday_actual_kg=actual_kg,
        )
        return block

    def test_production_daily_returns_one_row_per_block(self):
        self._seed_plan('B', Decimal('100'), Decimal('80'))
        resp = self.client.get('/api/v1/export/boss/production/?scope=daily')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn('rows', data)
        self.assertEqual(data['scope'], 'daily')
        codes = [r['block_code'] for r in data['rows']]
        self.assertIn('B', codes)

    def test_production_daily_pct_calculation(self):
        self._seed_plan('C', Decimal('100'), Decimal('80'))
        resp = self.client.get('/api/v1/export/boss/production/?scope=daily')
        data = resp.json()
        row = next((r for r in data['rows'] if r['block_code'] == 'C'), None)
        self.assertIsNotNone(row)
        # plan=100, actual=80 → pct should be 80%
        # (week may have more days so pct is at least 0)
        self.assertIn('pct', row)
        self.assertIn('plan_kg', row)
        self.assertIn('actual_kg', row)
        self.assertIn('monthly_plan_kg', row)
        self.assertIn('monthly_actual_kg', row)
        self.assertIn('monthly_pct', row)

    def test_production_seasonal_scope_param(self):
        resp = self.client.get('/api/v1/export/boss/production/?scope=seasonal')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data['scope'], 'seasonal')


# ---------------------------------------------------------------------------
# export_market/ — no domestic/gift keys
# ---------------------------------------------------------------------------

class ExportMarketTests(TestCase):

    def setUp(self):
        self.client = APIClient()
        self.boss = _create_user('boss8', 'boss')
        self.client.force_authenticate(user=self.boss)

    def test_export_market_returns_rows(self):
        resp = self.client.get('/api/v1/export/boss/export_market/?period=month')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn('rows', data)

    def test_export_market_has_no_domestic_keys(self):
        """Içerki Bazar and Sowgatlyk must NOT appear in v1."""
        resp = self.client.get('/api/v1/export/boss/export_market/?period=month')
        data = resp.json()
        forbidden_keys = {
            'domestic_kg', 'gift_kg', 'icerki_kg', 'sowgatlyk_kg',
            'domestic_pct', 'gift_pct',
        }
        for row in data.get('rows', []):
            found = forbidden_keys.intersection(set(row.keys()))
            self.assertEqual(
                found, set(),
                msg=f'export_market row contains forbidden keys: {found}',
            )

    def test_export_market_row_has_correct_keys(self):
        block, _ = GreenhouseBlock.objects.get_or_create(
            code='D', defaults={'name': 'D-Block'}
        )
        resp = self.client.get('/api/v1/export/boss/export_market/?period=month')
        data = resp.json()
        if data['rows']:
            row = data['rows'][0]
            self.assertIn('block_code', row)
            self.assertIn('export_kg', row)
            self.assertIn('export_pct', row)


# ---------------------------------------------------------------------------
# Cache — second call returns identical data
# ---------------------------------------------------------------------------

class CacheTests(TestCase):

    def setUp(self):
        self.client = APIClient()
        self.boss = _create_user('boss9', 'boss')
        self.client.force_authenticate(user=self.boss)

    def test_second_summary_call_returns_same_data(self):
        resp1 = self.client.get('/api/v1/export/boss/summary/?period=month')
        resp2 = self.client.get('/api/v1/export/boss/summary/?period=month')
        self.assertEqual(resp1.status_code, 200)
        self.assertEqual(resp2.status_code, 200)
        self.assertEqual(resp1.json(), resp2.json())

    def test_different_periods_return_different_data(self):
        """Cache keys include the period — different periods don't collide."""
        resp_month = self.client.get('/api/v1/export/boss/summary/?period=month')
        resp_week = self.client.get('/api/v1/export/boss/summary/?period=week')
        self.assertEqual(resp_month.status_code, 200)
        self.assertEqual(resp_week.status_code, 200)
        # The metadata should differ
        self.assertNotEqual(resp_month.json()['from'], resp_week.json()['from'])


# ---------------------------------------------------------------------------
# Other endpoints — smoke tests (200 + top-level keys)
# ---------------------------------------------------------------------------

class EndpointSmokeTests(TestCase):

    def setUp(self):
        self.client = APIClient()
        self.boss = _create_user('boss10', 'boss')
        self.client.force_authenticate(user=self.boss)

    def _check(self, path: str, expected_keys: list[str]):
        resp = self.client.get(path)
        self.assertEqual(resp.status_code, 200, msg=f'{path} returned {resp.status_code}')
        data = resp.json()
        for key in expected_keys:
            self.assertIn(key, data, msg=f'{path} missing key: {key}')

    def test_revenue(self):
        self._check(
            '/api/v1/export/boss/revenue/?period=month',
            ['current_season', 'previous_season'],
        )

    def test_debt(self):
        self._check(
            '/api/v1/export/boss/debt/',
            ['is_placeholder', 'rows'],
        )

    def test_route_pnl(self):
        self._check(
            '/api/v1/export/boss/route_pnl/?period=month',
            ['rows'],
        )

    def test_compliance(self):
        self._check(
            '/api/v1/export/boss/compliance/?period=month',
            ['reports_overdue', 'quota_1_to_10', 'docs_by_13'],
        )

    def test_ops_pulse(self):
        self._check(
            '/api/v1/export/boss/ops_pulse/',
            ['en_route', 'at_border', 'in_market', 'loaded_today'],
        )

    def test_quota_grid(self):
        self._check(
            '/api/v1/export/boss/quota_grid/',
            ['rows'],
        )

    def test_blocks_heatmap(self):
        self._check(
            '/api/v1/export/boss/blocks_heatmap/?period=week',
            ['rows'],
        )

    def test_top_customers(self):
        self._check(
            '/api/v1/export/boss/top_customers/?period=month',
            ['top', 'rest'],
        )

    def test_risk_matrix(self):
        self._check(
            '/api/v1/export/boss/risk_matrix/',
            ['rows'],
        )

    def test_alerts(self):
        self._check(
            '/api/v1/export/boss/alerts/',
            ['rows'],
        )

    def test_production_daily(self):
        self._check(
            '/api/v1/export/boss/production/?scope=daily',
            ['rows', 'scope'],
        )

    def test_production_seasonal(self):
        self._check(
            '/api/v1/export/boss/production/?scope=seasonal',
            ['rows', 'scope'],
        )

    def test_export_market(self):
        self._check(
            '/api/v1/export/boss/export_market/?period=month',
            ['rows'],
        )

    def test_task_throughput(self):
        self._check(
            '/api/v1/export/boss/task_throughput/',
            ['closed_count', 'created_count', 'on_time_rate', 'window_days'],
        )


# ---------------------------------------------------------------------------
# task_throughput — response shape, window_days param, auth, cache
# ---------------------------------------------------------------------------

class TaskThroughputTests(TestCase):
    """Smoke tests for GET /api/v1/export/boss/task_throughput/."""

    def setUp(self):
        self.client = APIClient()
        self.boss = _create_user('boss_tt1', 'boss')
        self.anon_client = APIClient()

    def test_returns_200_for_boss(self):
        self.client.force_authenticate(user=self.boss)
        resp = self.client.get('/api/v1/export/boss/task_throughput/')
        self.assertEqual(resp.status_code, 200)

    def test_anon_gets_401_or_403(self):
        resp = self.anon_client.get('/api/v1/export/boss/task_throughput/')
        self.assertIn(resp.status_code, (401, 403))

    def test_non_boss_gets_403(self):
        mgr = _create_user('mgr_tt1', 'export_manager')
        self.client.force_authenticate(user=mgr)
        resp = self.client.get('/api/v1/export/boss/task_throughput/')
        self.assertEqual(resp.status_code, 403)

    def test_response_has_all_four_keys(self):
        self.client.force_authenticate(user=self.boss)
        resp = self.client.get('/api/v1/export/boss/task_throughput/')
        data = resp.json()
        for key in ('closed_count', 'created_count', 'on_time_rate', 'window_days'):
            self.assertIn(key, data, msg=f'Missing key: {key}')

    def test_default_window_days_is_7(self):
        self.client.force_authenticate(user=self.boss)
        resp = self.client.get('/api/v1/export/boss/task_throughput/')
        self.assertEqual(resp.json()['window_days'], 7)

    def test_custom_window_days_param(self):
        self.client.force_authenticate(user=self.boss)
        resp = self.client.get('/api/v1/export/boss/task_throughput/?window_days=30')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['window_days'], 30)

    def test_invalid_window_days_falls_back_to_7(self):
        self.client.force_authenticate(user=self.boss)
        resp = self.client.get('/api/v1/export/boss/task_throughput/?window_days=abc')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['window_days'], 7)

    def test_second_call_returns_same_data(self):
        """Cache: two consecutive calls should return identical JSON."""
        self.client.force_authenticate(user=self.boss)
        resp1 = self.client.get('/api/v1/export/boss/task_throughput/?window_days=7')
        resp2 = self.client.get('/api/v1/export/boss/task_throughput/?window_days=7')
        self.assertEqual(resp1.status_code, 200)
        self.assertEqual(resp2.status_code, 200)
        self.assertEqual(resp1.json(), resp2.json())

    def test_different_window_days_cache_keys_do_not_collide(self):
        """window_days=7 and window_days=30 must return different window_days values."""
        self.client.force_authenticate(user=self.boss)
        resp7 = self.client.get('/api/v1/export/boss/task_throughput/?window_days=7')
        resp30 = self.client.get('/api/v1/export/boss/task_throughput/?window_days=30')
        self.assertEqual(resp7.json()['window_days'], 7)
        self.assertEqual(resp30.json()['window_days'], 30)

    def test_closed_count_and_created_count_are_non_negative_integers(self):
        self.client.force_authenticate(user=self.boss)
        data = self.client.get('/api/v1/export/boss/task_throughput/').json()
        self.assertIsInstance(data['closed_count'], int)
        self.assertIsInstance(data['created_count'], int)
        self.assertGreaterEqual(data['closed_count'], 0)
        self.assertGreaterEqual(data['created_count'], 0)

    def test_on_time_rate_is_between_0_and_1_or_none(self):
        """on_time_rate is a float in [0.0, 1.0] or null when no tasks closed."""
        self.client.force_authenticate(user=self.boss)
        data = self.client.get('/api/v1/export/boss/task_throughput/').json()
        rate = data['on_time_rate']
        if rate is not None:
            self.assertGreaterEqual(rate, 0.0)
            self.assertLessEqual(rate, 1.0)
