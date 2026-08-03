"""Tests for the Season lifecycle (open / close / derived status).

Run with:
    python manage.py test apps.core.tests_seasons --verbosity=2
"""
from datetime import date

from django.db import IntegrityError, transaction
from django.test import TestCase
from django.utils import timezone

from apps.core.models import Season


class SeasonStatusTests(TestCase):
    def test_upcoming_when_not_active_and_not_closed(self):
        season = Season.objects.create(
            name='2027/2028', start_date=date(2027, 9, 1), end_date=date(2028, 8, 31),
            is_active=False,
        )
        self.assertEqual(season.status, 'UPCOMING')

    def test_active_when_is_active(self):
        season = Season.objects.create(
            name='2026/2027', start_date=date(2026, 9, 1), end_date=date(2027, 8, 31),
            is_active=True,
        )
        self.assertEqual(season.status, 'ACTIVE')

    def test_closed_wins_over_active_flag(self):
        """closed_at is authoritative — a row can never read as ACTIVE once closed."""
        season = Season.objects.create(
            name='2025/2026', start_date=date(2025, 9, 1), end_date=date(2026, 8, 31),
            is_active=False, closed_at=timezone.now(),
        )
        self.assertEqual(season.status, 'CLOSED')


class SingleActiveSeasonTests(TestCase):
    def test_second_active_season_is_rejected(self):
        Season.objects.create(
            name='2026/2027', start_date=date(2026, 9, 1), end_date=date(2027, 8, 31),
            is_active=True,
        )
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                Season.objects.create(
                    name='2027/2028', start_date=date(2027, 9, 1), end_date=date(2028, 8, 31),
                    is_active=True,
                )

    def test_many_inactive_seasons_are_allowed(self):
        Season.objects.create(
            name='2024/2025', start_date=date(2024, 9, 1), end_date=date(2025, 8, 31),
            is_active=False,
        )
        Season.objects.create(
            name='2025/2026', start_date=date(2025, 9, 1), end_date=date(2026, 8, 31),
            is_active=False,
        )
        self.assertEqual(Season.objects.filter(is_active=False).count(), 2)
