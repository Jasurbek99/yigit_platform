"""The firm breakdown's `expired_kg` shares ONE anchor with the rest of the row.

Until 2026-08-23 the "Expired unused" column was computed in the browser from a
separate `/quota-issuances/` fetch scoped to the **global** season switcher,
while sales / issued / used came from `/quota-dashboard/` scoped to the page's
own season dropdown. Move one selector and half the row described a different
season. `expired_kg` is now built by `build_quota_dashboard()` from the same
season-clamped date window as every other figure, so that mix is structurally
impossible.

Run with:
    python manage.py test apps.export.tests_quota_dashboard_expiry --verbosity=2
"""
from datetime import date
from decimal import Decimal
from unittest.mock import patch

from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import ExportFirm, Season, User
from apps.export import services_quota
from apps.export.models import (
    QuotaIssuance, QuotaIssuanceFirmAllocation, QuotaUsageRecord,
)
from apps.export.services_quota import build_quota_dashboard, quota_expiry_date


class QuotaExpiryDateTests(TestCase):
    """Port fidelity with `computeExpiry()` in QuotaIssuancesList.helpers.ts."""

    def test_this_month_expires_at_the_end_of_the_issue_month(self):
        self.assertEqual(
            quota_expiry_date(date(2026, 2, 3), 'this_month'), date(2026, 2, 28),
        )

    def test_next_month_and_this_and_next_share_an_expiry(self):
        """They differ in when the quota STARTS, not when it lapses."""
        self.assertEqual(
            quota_expiry_date(date(2026, 8, 22), 'next_month'), date(2026, 9, 30),
        )
        self.assertEqual(
            quota_expiry_date(date(2026, 8, 22), 'this_and_next'), date(2026, 9, 30),
        )

    def test_december_rolls_into_the_next_year(self):
        self.assertEqual(
            quota_expiry_date(date(2026, 12, 10), 'next_month'), date(2027, 1, 31),
        )


class ExpiryFixture(TestCase):
    """Two abutting seasons, one firm, one lapsed issuance in each window.

    Test-free on purpose — same shape as `QuotaSeasonFixture` in
    `tests_quota_season_d11.py`, so the service and endpoint suites below share
    the data without one re-running the other's assertions.
    """

    @classmethod
    def setUpTestData(cls):
        cls.older = Season.objects.create(
            name='2025/2026', start_date=date(2025, 9, 1), end_date=date(2026, 6, 30),
        )
        cls.newer = Season.objects.create(
            name='2026/2027', start_date=date(2026, 8, 1), end_date=date(2027, 7, 1),
            is_active=True,
        )
        cls.firm = ExportFirm.objects.create(code='EXPF', name_tk='Firma Expiry')

        # Lapsed long ago, inside the OLDER season's window.
        cls.old_lapsed = QuotaIssuance.objects.create(
            issue_date=date(2026, 2, 3), season=cls.older,
            product_type='tomato', validity='this_month',
        )
        QuotaIssuanceFirmAllocation.objects.create(
            issuance=cls.old_lapsed, export_firm=cls.firm, kg_quota=Decimal('1000'),
        )
        # Inside the NEWER season's window; lapsed 2026-08-31.
        cls.new_lapsed = QuotaIssuance.objects.create(
            issue_date=date(2026, 8, 22), season=cls.older,  # deliberately mis-stamped
            product_type='tomato', validity='this_month',
        )
        QuotaIssuanceFirmAllocation.objects.create(
            issuance=cls.new_lapsed, export_firm=cls.firm, kg_quota=Decimal('700'),
        )

    def _row(self, payload: dict) -> dict:
        rows = [r for r in payload['per_firm'] if r['export_firm'] == self.firm.pk]
        self.assertEqual(len(rows), 1, payload['per_firm'])
        return rows[0]


class FirmBreakdownExpiryScopingTests(ExpiryFixture):
    """`expired_kg` follows the requested window, like sales/issued/used."""

    def _dashboard(self, season: Season, today: date) -> dict:
        return build_quota_dashboard(
            season.start_date, season.end_date, 'tomato', today=today,
        )

    def test_prior_window_issuance_contributes_nothing(self):
        """The regression this module exists for: browsing 2026/2027 must not
        surface quota that lapsed inside 2025/2026."""
        row = self._row(self._dashboard(self.newer, today=date(2026, 9, 15)))
        self.assertEqual(row['expired_kg'], Decimal('700'))

    def test_later_window_issuance_contributes_nothing_to_the_prior_season(self):
        """The inverse leak — and the reason the anchor is the date window and
        not `QuotaIssuance.season`: `new_lapsed` carries the OLDER season's FK
        (mis-stamped while 2026/2027 was closed) yet belongs on the 2026/2027
        breakdown, where its issued_kg already appears."""
        row = self._row(self._dashboard(self.older, today=date(2026, 9, 15)))
        self.assertEqual(row['expired_kg'], Decimal('1000'))

    def test_quota_still_within_its_validity_is_not_expired(self):
        row = self._row(self._dashboard(self.newer, today=date(2026, 8, 23)))
        self.assertEqual(row['expired_kg'], Decimal('0'))

    def test_kpi_total_reconciles_with_the_rendered_rows(self):
        """The footer used to sum EVERY firm the browser had fetched while the
        column rendered only firms present in `per_firm`, so the total could not
        be reconciled against the table."""
        payload = self._dashboard(self.newer, today=date(2026, 9, 15))
        self.assertEqual(
            payload['kpis']['expired_kg'],
            sum(r['expired_kg'] for r in payload['per_firm']),
        )

    def test_expired_never_exceeds_issued_in_the_same_window(self):
        """Both read the same allocations through the same window; a mismatch
        means the two anchors have drifted apart again."""
        row = self._row(self._dashboard(self.newer, today=date(2026, 9, 15)))
        self.assertLessEqual(row['expired_kg'], row['issued_kg'])


class FirmBreakdownExpiryEndpointTests(ExpiryFixture):
    """The same invariant through `GET /quota-dashboard/`.

    The service tests above call `build_quota_dashboard()` directly, but the bug
    this module pins was a **view-layer wiring** bug — two selectors reaching two
    different scopes. These assert it at the layer where it broke, so re-adding a
    season predicate to the aggregates, or loosening `QuotaDashboardView`'s
    date clamp, goes red here.
    """

    URL = '/api/v1/export/quota-dashboard/'

    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        cls.admin = User.objects.create(
            username='expiry-admin', role='admin', is_superuser=True,
        )

    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.client.force_authenticate(user=self.admin)

    def _get(self, season: Season, today: date) -> dict:
        """`QuotaDashboardView` takes no `today` — pin the clock instead, or
        these assertions would change meaning as issuances lapse."""
        with patch.object(services_quota.timezone, 'localdate', return_value=today):
            response = self.client.get(self.URL, {'season': season.pk})
        self.assertEqual(response.status_code, 200, response.content[:400])
        return response.json()

    def test_prior_window_expiry_does_not_reach_the_newer_season(self):
        row = self._row(self._get(self.newer, today=date(2026, 9, 15)))
        self.assertEqual(Decimal(str(row['expired_kg'])), Decimal('700'))

    def test_newer_window_expiry_does_not_reach_the_prior_season(self):
        """1000, never 1700 — `new_lapsed` carries this season's FK but belongs
        to the later window, and the window is the only anchor."""
        row = self._row(self._get(self.older, today=date(2026, 9, 15)))
        self.assertEqual(Decimal(str(row['expired_kg'])), Decimal('1000'))

    def test_kpi_expired_reconciles_with_the_returned_rows(self):
        payload = self._get(self.newer, today=date(2026, 9, 15))
        self.assertEqual(
            Decimal(str(payload['kpis']['expired_kg'])),
            sum(Decimal(str(r['expired_kg'])) for r in payload['per_firm']),
        )

    def test_empty_gap_payload_keeps_the_expired_key(self):
        """D7 fail-closed still returns the full shape, or the page renders an
        error banner instead of its empty state."""
        Season.objects.filter(pk=self.newer.pk).update(is_active=False)
        response = self.client.get(self.URL)
        self.assertEqual(response.status_code, 200, response.content[:400])
        self.assertEqual(Decimal(str(response.json()['kpis']['expired_kg'])), Decimal('0'))
        self.assertEqual(response.json()['per_firm'], [])


class ExpiredRemainderTests(ExpiryFixture):
    """`expired_kg` is the UNUSED remainder of a lapsed allocation (2026-08-23).

    Before this, the column summed the whole allocation, so quota that had been
    spent before it lapsed still counted as waste — the opposite of what the
    "Expired unused" label promises. Which kg were spent is a FIFO question, so
    these tests pin the walk as well as the arithmetic.

    Every case runs in the NEWER window, where `new_lapsed` (700 kg, lapsed
    2026-08-31) is the only allocation, with the clock at 2026-09-15.
    """

    WINDOW_TODAY = date(2026, 9, 15)

    def _use(self, kg: str, *, usage_date=date(2026, 8, 25),
             product_type='tomato', status='approved'):
        return QuotaUsageRecord.objects.create(
            usage_date=usage_date, export_firm=self.firm, kg_used=Decimal(kg),
            product_type=product_type, status=status,
        )

    def _expired(self) -> Decimal:
        payload = build_quota_dashboard(
            self.newer.start_date, self.newer.end_date, 'tomato',
            today=self.WINDOW_TODAY,
        )
        return self._row(payload)['expired_kg']

    def test_partly_used_lapsed_quota_counts_only_the_remainder(self):
        self._use('300')
        self.assertEqual(self._expired(), Decimal('400'))

    def test_fully_used_lapsed_quota_counts_nothing(self):
        """The whole point: quota that did its job is not waste."""
        self._use('700')
        self.assertEqual(self._expired(), Decimal('0'))

    def test_over_consumed_quota_clamps_at_zero(self):
        """Usage can exceed the window's allocations (FIFO spills past them);
        the remainder must floor at 0, never go negative."""
        self._use('900')
        self.assertEqual(self._expired(), Decimal('0'))

    def test_fifo_consumes_the_oldest_allocation_first(self):
        """A live allocation issued AFTER the lapsed one must not absorb the
        usage — if it did, the lapsed 700 would still read as fully wasted."""
        live = QuotaIssuance.objects.create(
            issue_date=date(2026, 9, 10), season=self.newer,
            product_type='tomato', validity='this_month',
        )
        QuotaIssuanceFirmAllocation.objects.create(
            issuance=live, export_firm=self.firm, kg_quota=Decimal('500'),
        )
        self._use('300')
        self.assertEqual(self._expired(), Decimal('400'))

    def test_draft_usage_does_not_reduce_the_remainder(self):
        """Drafts are pending review — same rule as the `used_kg` KPI."""
        self._use('300', status='draft')
        self.assertEqual(self._expired(), Decimal('700'))

    def test_another_products_usage_does_not_eat_this_products_quota(self):
        """`aggregate_quota_used()` is product-agnostic by default (the KPI's
        historical definition); the expiry FIFO must pass product_type, or the
        16 pepper usage rows in production would draw down tomato allocations."""
        self._use('300', product_type='pepper')
        self.assertEqual(self._expired(), Decimal('700'))

    def test_usage_outside_the_window_does_not_reduce_the_remainder(self):
        """One anchor: usage is read through the same window as the
        allocations, so the prior season's exports stay in the prior season."""
        self._use('300', usage_date=date(2026, 6, 15))
        self.assertEqual(self._expired(), Decimal('700'))

    def test_kpi_still_reconciles_with_the_rows_after_partial_use(self):
        self._use('300')
        payload = build_quota_dashboard(
            self.newer.start_date, self.newer.end_date, 'tomato',
            today=self.WINDOW_TODAY,
        )
        self.assertEqual(
            payload['kpis']['expired_kg'],
            sum(r['expired_kg'] for r in payload['per_firm']),
        )
