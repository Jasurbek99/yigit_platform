"""Tests for the backfill_season_fks command.

Run with:
    python manage.py test apps.export.tests_season_backfill --verbosity=2
"""
from datetime import date
from io import StringIO

from django.core.management import call_command
from django.test import TestCase

from apps.core.models import ExportFirm, ImportFirm, Season
from apps.export.models import QuotaIssuance, WeeklyLocalSellPlan


class BackfillSeasonFksTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.s2025 = Season.objects.create(
            name='2025/2026', start_date=date(2025, 9, 1), end_date=date(2026, 8, 31),
        )
        cls.s2026 = Season.objects.create(
            name='2026/2027', start_date=date(2026, 9, 1), end_date=date(2027, 8, 31),
            is_active=True,
        )
        cls.firm = ExportFirm.objects.create(code='TST', name_tk='Test Firm')
        cls.import_firm = ImportFirm.objects.create(name_company='Test Buyer')

    def test_assigns_season_by_date(self):
        plan = WeeklyLocalSellPlan.objects.create(
            export_firm=self.firm, season=None, year=2026, week_number=5,
        )
        call_command('backfill_season_fks', stdout=StringIO())
        plan.refresh_from_db()
        self.assertEqual(plan.season, self.s2025)

    def test_dry_run_writes_nothing(self):
        plan = WeeklyLocalSellPlan.objects.create(
            export_firm=self.firm, season=None, year=2026, week_number=5,
        )
        call_command('backfill_season_fks', '--dry-run', stdout=StringIO())
        plan.refresh_from_db()
        self.assertIsNone(plan.season)

    def test_unmatched_rows_are_reported_not_dropped(self):
        plan = WeeklyLocalSellPlan.objects.create(
            export_firm=self.firm, season=None, year=2019, week_number=5,
        )
        out = StringIO()
        call_command('backfill_season_fks', stdout=out)
        plan.refresh_from_db()
        self.assertIsNone(plan.season)
        self.assertIn('unmatched', out.getvalue().lower())
        self.assertIn(str(plan.pk), out.getvalue())

    def test_assigns_contract_season_by_start_date(self):
        from apps.contracts.models import Contract

        contract = Contract.objects.create(
            contract_number='TEST-CONTRACT-1',
            export_firm=self.firm,
            import_firm=self.import_firm,
            season=None,
            start_date=date(2026, 1, 26),
        )
        call_command('backfill_season_fks', stdout=StringIO())
        contract.refresh_from_db()
        self.assertEqual(contract.season, self.s2025)

    def test_is_idempotent(self):
        WeeklyLocalSellPlan.objects.create(
            export_firm=self.firm, season=None, year=2026, week_number=5,
        )
        call_command('backfill_season_fks', stdout=StringIO())
        out = StringIO()
        call_command('backfill_season_fks', stdout=out)
        self.assertIn('0 updated', out.getvalue())

    def test_assigns_quota_issuance_season_by_issue_date(self):
        issuance = QuotaIssuance.objects.create(
            issue_date=date(2026, 1, 15), season=None, product_type='tomato',
        )
        call_command('backfill_season_fks', stdout=StringIO())
        issuance.refresh_from_db()
        self.assertEqual(issuance.season, self.s2025)

    def test_quota_issuance_dry_run_writes_nothing(self):
        issuance = QuotaIssuance.objects.create(
            issue_date=date(2026, 1, 15), season=None, product_type='tomato',
        )
        call_command('backfill_season_fks', '--dry-run', stdout=StringIO())
        issuance.refresh_from_db()
        self.assertIsNone(issuance.season)

    def test_quota_issuance_unmatched_rows_are_reported_not_dropped(self):
        issuance = QuotaIssuance.objects.create(
            issue_date=date(2019, 1, 15), season=None, product_type='tomato',
        )
        out = StringIO()
        call_command('backfill_season_fks', stdout=out)
        issuance.refresh_from_db()
        self.assertIsNone(issuance.season)
        self.assertIn('unmatched', out.getvalue().lower())
        self.assertIn(str(issuance.pk), out.getvalue())
