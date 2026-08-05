"""Endpoints that must NOT be season-scoped (spec §4.5).

Each test asserts results are identical before and after closing a season.
A failure here means the mixin was applied somewhere it must not be.

`BossComparisonSurvivesCloseTests` below calls the service functions
(`weekly_revenue_comparison`/`_previous_season`) directly — cheap, but it
never touches `BossAnalyticsViewSet`, which is where a `SeasonScopedMixin`
regression would actually be introduced. `BossRevenueEndpointSurvivesCloseTests`
exercises the real HTTP endpoint for that reason — see its docstring.

Run with:
    python manage.py test apps.export.tests_season_optout --verbosity=2
"""
from datetime import date
from decimal import Decimal

from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core.models import (
    Country, ExportFirm, RoleResourcePermission, Season, ShipmentStatusType, User,
)
from apps.export.models import (
    QuotaIssuance, QuotaIssuanceFirmAllocation, QuotaUsageRecord, Shipment,
)
from apps.export.services.boss_analytics import _previous_season, weekly_revenue_comparison
from apps.export.services_quota import compute_fifo_usage


def _make_draft_status() -> ShipmentStatusType:
    """get_or_create the 'draft' status row.

    core.migrations.0006/0010 also seed code='draft' whenever
    DJANGO_TESTING != 'true' (see tests_season_scoping._make_status(), same
    pattern) — an unconditional .create() collides with that seeded row
    unless the documented DJANGO_TESTING=true test invocation is used.
    get_or_create keyed on `code` is required so the fixture works either way.
    """
    status, _ = ShipmentStatusType.objects.get_or_create(
        code='draft',
        defaults={
            'name_tk': 'Garalama', 'name_en': 'Draft', 'name_ru': 'Черновик',
            'phase': 'DRAFT', 'step_order': 0, 'required_role': 'warehouse_chief',
        },
    )
    return status


class BossComparisonSurvivesCloseTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.older = Season.objects.create(
            name='2024/2025', start_date=date(2024, 9, 1), end_date=date(2025, 8, 31),
        )
        cls.newer = Season.objects.create(
            name='2025/2026', start_date=date(2025, 9, 1), end_date=date(2026, 8, 31),
            is_active=True,
        )

    def test_previous_season_resolves_to_the_preceding_season(self):
        result = weekly_revenue_comparison(self.newer)
        self.assertIn('current_season', result)
        self.assertIn('previous_season', result)
        # Key presence alone doesn't prove correctness — 'previous_season' is
        # present in every branch of weekly_revenue_comparison, including the
        # empty-list one. Assert identity too (see
        # test_previous_season_identity_ignores_closed_at_even_when_both_closed
        # below for the discriminating-test rationale this mirrors).
        self.assertEqual(_previous_season(self.newer), self.older)

    def test_previous_season_still_resolves_when_both_are_closed(self):
        """Selecting a closed season as 'current' must still yield a comparison."""
        Season.objects.filter(pk=self.older.pk).update(closed_at=timezone.now())
        Season.objects.filter(pk=self.newer.pk).update(
            closed_at=timezone.now(), is_active=False,
        )
        self.newer.refresh_from_db()
        result = weekly_revenue_comparison(self.newer)
        self.assertIn('previous_season', result)

    def test_oldest_season_yields_empty_previous_not_an_error(self):
        result = weekly_revenue_comparison(self.older)
        self.assertEqual(result['previous_season'], [])

    def test_previous_season_identity_ignores_closed_at_even_when_both_closed(self):
        """Discriminating regression test for `_previous_season`.

        `test_previous_season_still_resolves_when_both_are_closed` above only
        checks that the `previous_season` KEY is present — that key is always
        present by construction (see `weekly_revenue_comparison`'s empty-list
        branch), so it would still pass even if `_previous_season` silently
        started excluding closed seasons. This test checks season IDENTITY
        instead, which does catch that regression.
        """
        Season.objects.filter(pk=self.older.pk).update(closed_at=timezone.now())
        Season.objects.filter(pk=self.newer.pk).update(
            closed_at=timezone.now(), is_active=False,
        )
        self.newer.refresh_from_db()
        self.assertEqual(_previous_season(self.newer), self.older)


class BossRevenueEndpointSurvivesCloseTests(TestCase):
    """API-level guard, at the layer where the regression would actually land.

    All four tests in `BossComparisonSurvivesCloseTests` above call
    `weekly_revenue_comparison()`/`_previous_season()` as plain functions —
    if someone added `SeasonScopedMixin` to `BossAnalyticsViewSet` tomorrow (or
    more realistically, scoped the `Shipment` queryset inside `_weekly_revenue`
    by `season=` instead of by date range — precisely what the module docstring
    on boss_analytics.py warns against), none of those four would notice, since
    the mixin operates at the queryset/view layer and none of them go through
    `BossAnalyticsViewSet` or issue an HTTP request. This class does.
    """

    @classmethod
    def setUpTestData(cls):
        cls.status = _make_draft_status()
        cls.country = Country.objects.create(name_en='Kazakhstan', name_tk='Gazagystan')
        cls.older = Season.objects.create(
            name='2024/2025', start_date=date(2024, 9, 1), end_date=date(2025, 8, 31),
        )
        cls.newer = Season.objects.create(
            name='2025/2026', start_date=date(2025, 9, 1), end_date=date(2026, 8, 31),
            is_active=True,
        )
        # Revenue in the OLDER season only, so previous_season is non-empty and
        # current_season is empty — makes it unambiguous which bucket the data
        # landed in.
        Shipment.objects.create(
            shipment_code='OLD-001', date=cls.older.start_date, season=cls.older,
            status=cls.status, country=cls.country, total_amount_usd=Decimal('1000.00'),
        )
        cls.boss = User.objects.create(username='boss_revenue_optout', role='boss')
        # closed_season.can_view is opt-in per role (nothing seeds it by default —
        # confirmed via grep, no migration/seed_permissions call grants it to any
        # role). `resolve_season()` 403s a closed ?season= without it, so this is
        # required to reach the actual season-optout comparison this class tests,
        # not a workaround for anything specific to boss/revenue.
        RoleResourcePermission.objects.update_or_create(
            role='boss', resource_code='closed_season', defaults={'can_view': True},
        )

    def setUp(self):
        cache.clear()  # the action is cached 60s per (period, from, to, season) key

    def _get_revenue(self, season_id: int):
        client = APIClient()
        client.force_authenticate(user=self.boss)
        return client.get(f'/api/v1/export/boss/revenue/?season={season_id}')

    def test_closed_season_revenue_returns_200_with_non_empty_previous(self):
        """The endpoint's whole purpose: close the 'current' season and confirm
        the comparison still resolves through a real request — not just the
        service function directly.
        """
        before = self._get_revenue(self.newer.pk)
        self.assertEqual(before.status_code, 200)
        self.assertNotEqual(before.json()['previous_season'], [])

        Season.objects.filter(pk=self.newer.pk).update(
            closed_at=timezone.now(), is_active=False,
        )
        cache.clear()

        after = self._get_revenue(self.newer.pk)
        self.assertEqual(after.status_code, 200)
        self.assertEqual(after.json(), before.json())


class QuotaIssuanceOptOutTests(TestCase):
    """quota-issuances stays unscoped even though `QuotaIssuance` gained a
    `season` FK for the write freeze (D10) — spec §4.5. Issuances are consumed
    FIFO across seasons, so both the list endpoint and the FIFO balance must
    keep seeing every season's rows regardless of what is open or closed.
    """

    @classmethod
    def setUpTestData(cls):
        cls.older = Season.objects.create(
            name='2024/2025', start_date=date(2024, 9, 1), end_date=date(2025, 8, 31),
        )
        cls.newer = Season.objects.create(
            name='2025/2026', start_date=date(2025, 9, 1), end_date=date(2026, 8, 31),
            is_active=True,
        )
        cls.firm = ExportFirm.objects.create(code='OPT1', name_tk='Firma OPT1')
        cls.old_issuance = QuotaIssuance.objects.create(
            issue_date=cls.older.start_date, season=cls.older, product_type='tomato',
        )
        cls.old_alloc = QuotaIssuanceFirmAllocation.objects.create(
            issuance=cls.old_issuance, export_firm=cls.firm, kg_quota=Decimal('1000'),
        )
        cls.admin = User.objects.create(
            username='optout-quota-adm', role='admin', is_superuser=True,
        )

    def _list(self) -> list[int]:
        client = APIClient()
        client.force_authenticate(user=self.admin)
        response = client.get('/api/v1/export/quota-issuances/')
        self.assertEqual(response.status_code, 200, response.content[:400])
        body = response.json()
        rows = body['results'] if isinstance(body, dict) and 'results' in body else body
        return [row['id'] for row in rows]

    def test_prior_season_issuance_is_listed_with_no_season_param(self):
        """No `?season=` given — resolves to the active season, which is NOT
        the issuance's own season. A scoped viewset would drop it; opting out
        must not."""
        self.assertIn(self.old_issuance.pk, self._list())

    def test_closing_the_active_season_does_not_hide_the_prior_issuance(self):
        before = self._list()
        Season.objects.filter(pk=self.newer.pk).update(
            closed_at=timezone.now(), is_active=False,
        )
        after = self._list()
        self.assertEqual(before, after)
        self.assertIn(self.old_issuance.pk, after)

    def test_fifo_usage_still_consumes_a_prior_seasons_allocation(self):
        """The system the D10 ruling exists to protect: a shipment in the
        current season legitimately draws down an issuance made in a prior
        one. If FIFO were season-filtered, this allocation would be invisible
        and the firm would read as having unlimited balance instead."""
        QuotaUsageRecord.objects.create(
            usage_date=self.newer.start_date, export_firm=self.firm,
            kg_used=Decimal('400'), product_type='tomato', status='approved',
        )
        cache.clear()
        result = compute_fifo_usage('tomato')
        self.assertEqual(result[self.old_alloc.pk], Decimal('400'))
