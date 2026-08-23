"""Tests for the backfill_season_fks command.

Run with:
    python manage.py test apps.export.tests_season_backfill --verbosity=2
"""
from datetime import date
from io import StringIO

from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone

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


class FixLocalSellPlanSeasonsTests(TestCase):
    """`fix_local_sell_plan_seasons` — repairs rows pointing at the WRONG season.

    Distinct from `backfill_season_fks` above, which only fills `season IS NULL`
    and will never re-point a row that already points somewhere. Written after
    the 2026-08-23 seller-panel report, where every W34/2026 row still carried
    the previous season and the season-scoped grid showed nothing.
    """

    @classmethod
    def setUpTestData(cls):
        # Contiguous, so any week outside BOTH is a genuine calendar gap.
        cls.s2025 = Season.objects.create(
            name='2025/2026', start_date=date(2025, 9, 1), end_date=date(2026, 8, 31),
        )
        cls.s2026 = Season.objects.create(
            name='2026/2027', start_date=date(2026, 9, 1), end_date=date(2027, 8, 31),
            is_active=True,
        )
        cls.firm = ExportFirm.objects.create(code='FLS', name_tk='Fix Season Firm')

    def _plan(self, year, week, season):
        return WeeklyLocalSellPlan.objects.create(
            export_firm=self.firm, year=year, week_number=week, season=season,
        )

    def test_repoints_a_row_whose_season_contradicts_its_week(self):
        # Mon of W40/2026 is 2026-09-28 — inside s2026, not s2025.
        plan = self._plan(2026, 40, self.s2025)
        call_command('fix_local_sell_plan_seasons', stdout=StringIO())
        plan.refresh_from_db()
        self.assertEqual(plan.season_id, self.s2026.id)

    def test_leaves_a_correctly_stamped_row_alone_and_is_idempotent(self):
        plan = self._plan(2026, 40, self.s2026)
        out = StringIO()
        call_command('fix_local_sell_plan_seasons', stdout=out)
        self.assertIn('Nothing to re-stamp', out.getvalue())
        plan.refresh_from_db()
        self.assertEqual(plan.season_id, self.s2026.id)

    def test_dry_run_writes_nothing(self):
        plan = self._plan(2026, 40, self.s2025)
        out = StringIO()
        call_command('fix_local_sell_plan_seasons', '--dry-run', stdout=out)
        self.assertIn('DRY RUN', out.getvalue())
        plan.refresh_from_db()
        self.assertEqual(plan.season_id, self.s2025.id)

    def test_skips_and_reports_a_week_no_season_covers(self):
        """The branch S1 would copy: never guess a season for a calendar gap.

        Season 2025-2026 ends 2026-06-30 and 2026-2027 starts 2026-08-01 on the
        live DB, so July 2026 belongs to nothing (FINDINGS_BACKLOG S2). Rows
        there must be left untouched and named in the output, not swept into
        whichever season happens to be nearest.
        """
        plan = self._plan(2024, 10, self.s2025)  # long before either season
        out = StringIO()
        call_command('fix_local_sell_plan_seasons', stdout=out)
        self.assertIn('SKIPPED W10/2024', out.getvalue())
        plan.refresh_from_db()
        self.assertEqual(plan.season_id, self.s2025.id)


class FixQuotaIssuanceSeasonsTests(TestCase):
    """`fix_quota_issuance_seasons` — the QuotaIssuance half of S1.

    An issuance is stamped with the season ACTIVE when it was recorded, and the
    new season is usually opened after the first quota for it arrives — so the
    stamp drifts from the row's own date. On 2026-08-23 that left the active
    season with zero issuances and the Sheet's firm-split gate refusing every
    firm, while 1,234,000 kg sat in a season whose quota had all expired.
    """

    @classmethod
    def setUpTestData(cls):
        cls.s2025 = Season.objects.create(
            name='2025/2026', start_date=date(2025, 9, 1), end_date=date(2026, 6, 30),
        )
        cls.s2026 = Season.objects.create(
            name='2026/2027', start_date=date(2026, 8, 1), end_date=date(2027, 7, 1),
            is_active=True,
        )

    def _issuance(self, issue_date, season):
        return QuotaIssuance.objects.create(
            issue_date=issue_date, product_type='tomato', season=season,
        )

    def test_repoints_an_issuance_whose_season_contradicts_its_date(self):
        # #35's shape: dated inside 2026-2027, stamped 2025-2026.
        issuance = self._issuance(date(2026, 8, 22), self.s2025)
        call_command('fix_quota_issuance_seasons', stdout=StringIO())
        issuance.refresh_from_db()
        self.assertEqual(issuance.season_id, self.s2026.id)

    def test_fills_a_null_season_when_a_season_covers_the_date(self):
        issuance = self._issuance(date(2026, 8, 22), None)
        call_command('fix_quota_issuance_seasons', stdout=StringIO())
        issuance.refresh_from_db()
        self.assertEqual(issuance.season_id, self.s2026.id)

    def test_leaves_a_correctly_stamped_row_alone_and_is_idempotent(self):
        issuance = self._issuance(date(2026, 8, 22), self.s2026)
        out = StringIO()
        call_command('fix_quota_issuance_seasons', stdout=out)
        self.assertIn('Nothing to re-stamp', out.getvalue())
        issuance.refresh_from_db()
        self.assertEqual(issuance.season_id, self.s2026.id)

    def test_dry_run_writes_nothing(self):
        issuance = self._issuance(date(2026, 8, 22), self.s2025)
        out = StringIO()
        call_command('fix_quota_issuance_seasons', '--dry-run', stdout=out)
        self.assertIn('DRY RUN', out.getvalue())
        issuance.refresh_from_db()
        self.assertEqual(issuance.season_id, self.s2025.id)

    def test_skips_and_reports_a_date_no_season_covers(self):
        """July 2026 falls between these two seasons — FINDINGS_BACKLOG S2.

        `QuotaIssuance#34` on the live DB is exactly this row. Guessing a season
        for it would corrupt a balance, so it is named and left alone.
        """
        issuance = self._issuance(date(2026, 7, 15), self.s2025)
        out = StringIO()
        call_command('fix_quota_issuance_seasons', stdout=out)
        self.assertIn('SKIPPED #', out.getvalue())
        self.assertIn('no season covers that date', out.getvalue())
        issuance.refresh_from_db()
        self.assertEqual(issuance.season_id, self.s2025.id)

    def test_never_writes_across_a_closed_season(self):
        """D10: a closed season's numbers are frozen, in both directions."""
        self.s2025.closed_at = timezone.now()
        self.s2025.save(update_fields=['closed_at'])
        issuance = self._issuance(date(2026, 8, 22), self.s2025)
        out = StringIO()
        call_command('fix_quota_issuance_seasons', stdout=out)
        self.assertIn('crosses a CLOSED season', out.getvalue())
        issuance.refresh_from_db()
        self.assertEqual(issuance.season_id, self.s2025.id)
