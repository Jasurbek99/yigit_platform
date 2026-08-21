"""Tests for the Pomidor Dükany production analysis (service + endpoint).

Covers the arithmetic the office previously did by hand in
`Pomidor Dükany 2025-2026.xlsx`: planned vs achieved per block, variance,
achievement %, kg/m², and the domestic/export split.

Achieved is `ShipmentBlockSource + DomesticSale`, NOT `HarvestDayEntry.actual_value`
— see the service module docstring. `rollup_kg` / `rollup_days` are returned only
as a staleness diagnostic and are asserted as such here.

Usage:
    python manage.py test apps.export.tests_pomidor_dukany --verbosity=2
"""
import unittest
from datetime import date, timedelta
from decimal import Decimal

try:
    from django.test import TestCase
    from rest_framework.test import APIClient

    from apps.core.models import GreenhouseBlock, GreenhouseConfig, Season
    from apps.core.permission_registry import PAGE_REGISTRY
    from apps.core.models import ShipmentStatusType
    from apps.export.models import Shipment, ShipmentBlockSource
    from apps.export.services.pomidor_dukany import build_production_analysis
    from apps.greenhouse.models import HarvestDayEntry, WeeklyHarvestPlan

    DB_AVAILABLE = True
except Exception:  # pragma: no cover
    DB_AVAILABLE = False


def _make_domestic_sale(block, sale_date, weight_kg):
    """Create a DomesticSale, minting the DomesticBuyer it requires."""
    from apps.core.models import DomesticBuyer
    from apps.greenhouse.models import DomesticSale

    buyer, _ = DomesticBuyer.objects.get_or_create(
        name='PD Test Buyer', defaults={'is_active': True},
    )
    return DomesticSale.objects.create(
        date=sale_date, buyer=buyer, block=block, weight_kg=weight_kg,
    )


@unittest.skipUnless(DB_AVAILABLE, "Django test DB unavailable in this environment")
class TestProductionAnalysisService(TestCase):
    """The aggregation itself — one block with known numbers."""

    @classmethod
    def setUpTestData(cls):
        GreenhouseConfig.get_solo()
        cls.season, _ = Season.objects.get_or_create(
            name='2025-PD',
            defaults={
                'start_date': '2025-09-01',
                'end_date': '2026-08-31',
                'is_active': True,
            },
        )
        # 10,000 m² keeps kg/m² exact in decimal, so the assertions read plainly.
        cls.block, _ = GreenhouseBlock.objects.get_or_create(
            code='PD-A',
            defaults={'name': 'Pomidor Block A', 'is_active': True, 'area_m2': 10_000},
        )
        cls.other, _ = GreenhouseBlock.objects.get_or_create(
            code='PD-B',
            defaults={'name': 'Pomidor Block B', 'is_active': True, 'area_m2': 5_000},
        )
        cls.plan, _ = WeeklyHarvestPlan.objects.get_or_create(
            season=cls.season, block=cls.block, year=2026, week_number=10,
        )
        # W10/2026 Monday = 2026-03-02. Two days: plan 30,000 / actual 24,000.
        cls.monday = date.fromisocalendar(2026, 10, 1)
        for offset, (plan_kg, rollup_kg) in enumerate([('20000.00', '15000.00'),
                                                       ('10000.00', None)]):
            HarvestDayEntry.objects.update_or_create(
                weekly_plan=cls.plan,
                entry_date=cls.monday + timedelta(days=offset),
                defaults={
                    'season': cls.season,
                    'block': cls.block,
                    'weekday': offset,
                    'plan_value': Decimal(plan_kg),
                    # Day 2 left NULL on purpose: the rollup cron is not
                    # scheduled in this project, so a partially-filled column is
                    # the realistic case and the achieved figure must not
                    # depend on it.
                    'actual_value': Decimal(rollup_kg) if rollup_kg else None,
                },
            )

        # Real dispositions: 18,000 kg exported + 6,000 kg sold domestically.
        status, _ = ShipmentStatusType.objects.get_or_create(
            code='pd_test_status',
            defaults={'name_tk': 'PD Test', 'step_order': 1, 'is_active': True},
        )
        cls.shipment = Shipment.objects.create(
            shipment_code=cls.monday.strftime('%d%m') + '901/26',
            date=cls.monday,
            season=cls.season,
            status=status,
        )
        ShipmentBlockSource.objects.create(
            shipment=cls.shipment, block=cls.block, weight_kg=Decimal('18000.00'),
        )
        _make_domestic_sale(cls.block, cls.monday, Decimal('6000.00'))

    def _run(self, days=6, **kwargs):
        return build_production_analysis(
            self.monday, self.monday + timedelta(days=days), **kwargs
        )

    def _row(self, payload, code='PD-A'):
        return next(r for r in payload['rows'] if r['block_code'] == code)

    def test_sums_plan_over_the_range(self):
        row = self._row(self._run())
        self.assertEqual(row['plan_kg'], 30000.0)

    def test_achieved_is_export_plus_domestic_not_the_rollup(self):
        """The whole point: 18,000 exported + 6,000 domestic = 24,000 achieved.

        The rollup column holds 15,000 for one day and NULL for the other, so a
        regression back to `actual_value` would show 15,000 here and fail.
        """
        row = self._row(self._run())
        self.assertEqual(row['export_kg'], 18000.0)
        self.assertEqual(row['domestic_kg'], 6000.0)
        self.assertEqual(row['actual_kg'], 24000.0)

    def test_rollup_is_returned_as_a_diagnostic_only(self):
        row = self._row(self._run())
        self.assertEqual(row['rollup_kg'], 15000.0)
        # One of the two days carries a value — that is what flags staleness.
        self.assertEqual(row['rollup_days'], 1)
        self.assertNotEqual(row['rollup_kg'], row['actual_kg'])

    def test_exports_still_count_when_the_rollup_never_ran(self):
        """The exact failure this reframing exists to prevent."""
        HarvestDayEntry.objects.filter(weekly_plan=self.plan).update(actual_value=None)
        row = self._row(self._run())
        self.assertEqual(row['rollup_days'], 0)
        self.assertEqual(row['actual_kg'], 24000.0)
        self.assertEqual(row['achievement_pct'], 80.0)

    def test_variance_is_actual_minus_plan_and_signed(self):
        row = self._row(self._run())
        self.assertEqual(row['variance_kg'], -6000.0)

    def test_achievement_pct(self):
        row = self._row(self._run())
        self.assertEqual(row['achievement_pct'], 80.0)

    def test_kg_per_m2_uses_block_area(self):
        row = self._row(self._run())
        self.assertEqual(row['area_m2'], 10_000)
        self.assertEqual(row['plan_kg_per_m2'], 3.0)
        self.assertEqual(row['actual_kg_per_m2'], 2.4)

    def test_domestic_and_export_shares_add_up_to_100(self):
        row = self._row(self._run())
        self.assertEqual(row['export_pct'], 75.0)
        self.assertEqual(row['domestic_pct'], 25.0)

    def test_block_with_no_area_reports_zero_per_m2_not_a_crash(self):
        GreenhouseBlock.objects.filter(code='PD-B').update(area_m2=None)
        row = self._row(self._run(), code='PD-B')
        self.assertIsNone(row['area_m2'])
        self.assertEqual(row['plan_kg_per_m2'], 0.0)

    def test_block_with_no_entries_still_returned_as_zeros(self):
        """The row set must stay stable as the user pages between months."""
        row = self._row(self._run(), code='PD-B')
        self.assertEqual(row['plan_kg'], 0.0)
        self.assertEqual(row['achievement_pct'], 0.0)

    def test_range_outside_the_entries_yields_zero(self):
        payload = build_production_analysis(
            self.monday - timedelta(days=60), self.monday - timedelta(days=40),
        )
        self.assertEqual(self._row(payload)['plan_kg'], 0.0)

    def test_totals_aggregate_every_row(self):
        totals = self._run()['totals']
        self.assertEqual(totals['plan_kg'], 30000.0)
        self.assertEqual(totals['actual_kg'], 24000.0)
        self.assertEqual(totals['rollup_kg'], 15000.0)
        self.assertEqual(totals['achievement_pct'], 80.0)
        self.assertGreaterEqual(totals['block_count'], 2)

    def test_block_filter_restricts_rows(self):
        payload = self._run(block_ids=[self.block.id])
        self.assertEqual([r['block_code'] for r in payload['rows']], ['PD-A'])

    def test_sub_blocks_are_excluded_from_the_row_set(self):
        """O + OD + OG would triple-count one greenhouse's area and weight."""
        GreenhouseBlock.objects.get_or_create(
            code='PD-A1',
            defaults={
                'name': 'Sub of A', 'is_active': True,
                'area_m2': 5_000, 'parent': self.block,
            },
        )
        codes = [r['block_code'] for r in self._run()['rows']]
        self.assertNotIn('PD-A1', codes)

    def test_inverted_range_is_rejected(self):
        with self.assertRaises(ValueError):
            build_production_analysis(self.monday, self.monday - timedelta(days=1))


@unittest.skipUnless(DB_AVAILABLE, "Django test DB unavailable in this environment")
class TestProductionAnalysisEndpoint(TestCase):
    """HTTP contract: params, validation and the role gate."""

    URL = '/api/v1/export/production-analysis/'

    @classmethod
    def setUpTestData(cls):
        from django.contrib.auth import get_user_model
        User = get_user_model()

        GreenhouseConfig.get_solo()
        cls.boss = User.objects.create_user(username='pd_boss', password='p', role='boss')
        cls.manager = User.objects.create_user(
            username='pd_em', password='p', role='export_manager',
        )
        cls.outsider = User.objects.create_user(
            username='pd_transport', password='p', role='transport',
        )

    def setUp(self):
        self.client = APIClient()

    def test_boss_can_read_the_analysis(self):
        self.client.force_authenticate(user=self.boss)
        resp = self.client.get(self.URL, {'date_from': '2026-03-01', 'date_to': '2026-03-31'})
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertIn('rows', resp.data)
        self.assertIn('totals', resp.data)

    def test_export_manager_can_read_the_analysis(self):
        self.client.force_authenticate(user=self.manager)
        resp = self.client.get(self.URL, {'date_from': '2026-03-01', 'date_to': '2026-03-31'})
        self.assertEqual(resp.status_code, 200, resp.data)

    def test_unprivileged_role_is_denied(self):
        self.client.force_authenticate(user=self.outsider)
        resp = self.client.get(self.URL, {'date_from': '2026-03-01', 'date_to': '2026-03-31'})
        self.assertEqual(resp.status_code, 403)

    def test_missing_dates_return_400(self):
        self.client.force_authenticate(user=self.boss)
        resp = self.client.get(self.URL)
        self.assertEqual(resp.status_code, 400)
        self.assertIn('date_from', resp.data)
        self.assertIn('date_to', resp.data)

    def test_unparseable_date_returns_400(self):
        self.client.force_authenticate(user=self.boss)
        resp = self.client.get(self.URL, {'date_from': '01.03.2026', 'date_to': '2026-03-31'})
        self.assertEqual(resp.status_code, 400)
        self.assertIn('date_from', resp.data)

    def test_inverted_range_returns_400_not_500(self):
        self.client.force_authenticate(user=self.boss)
        resp = self.client.get(self.URL, {'date_from': '2026-03-31', 'date_to': '2026-03-01'})
        self.assertEqual(resp.status_code, 400)

    def test_over_long_range_returns_400(self):
        self.client.force_authenticate(user=self.boss)
        resp = self.client.get(self.URL, {'date_from': '2020-01-01', 'date_to': '2026-03-01'})
        self.assertEqual(resp.status_code, 400)

    def test_non_integer_block_id_returns_400(self):
        self.client.force_authenticate(user=self.boss)
        resp = self.client.get(self.URL, {
            'date_from': '2026-03-01', 'date_to': '2026-03-31', 'blocks': 'A,B',
        })
        self.assertEqual(resp.status_code, 400)
        self.assertIn('blocks', resp.data)

    def test_page_code_is_registered(self):
        """Without the registry entry the route guard has nothing to gate on."""
        self.assertIn('export.pomidor_dukany', PAGE_REGISTRY)
