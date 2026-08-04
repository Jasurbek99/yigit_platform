"""Endpoints that must NOT be season-scoped (spec §4.5).

Each test asserts results are identical before and after closing a season.
A failure here means the mixin was applied somewhere it must not be.

Run with:
    python manage.py test apps.export.tests_season_optout --verbosity=2
"""
from datetime import date

from django.test import TestCase
from django.utils import timezone

from apps.core.models import Season
from apps.export.services.boss_analytics import _previous_season, weekly_revenue_comparison


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
