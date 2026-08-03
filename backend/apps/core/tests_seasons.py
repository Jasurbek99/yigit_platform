"""Tests for the Season lifecycle (open / close / derived status).

Run with:
    python manage.py test apps.core.tests_seasons --verbosity=2
"""
import re
from datetime import date
from pathlib import Path
from types import SimpleNamespace

from django.db import IntegrityError, transaction
from django.test import TestCase
from django.utils import timezone
from rest_framework.exceptions import NotFound, PermissionDenied

from apps.core.models import RoleResourcePermission, Season, User
from apps.core.seasons import (
    SeasonClosedError,
    assert_season_open,
    can_view_closed,
    get_active_season,
    resolve_season,
)


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


def _request(user, **params):
    """Minimal stand-in for a DRF request — resolve_season only reads these two."""
    return SimpleNamespace(user=user, query_params=params)


class SeasonResolutionTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.active = Season.objects.create(
            name='2026/2027', start_date=date(2026, 9, 1), end_date=date(2027, 8, 31),
            is_active=True,
        )
        cls.closed = Season.objects.create(
            name='2025/2026', start_date=date(2025, 9, 1), end_date=date(2026, 8, 31),
            is_active=False, closed_at=timezone.now(),
        )
        cls.viewer = User.objects.create(username='viewer', role='export_manager')
        cls.operator = User.objects.create(username='operator', role='warehouse_chief')
        RoleResourcePermission.objects.create(
            role='export_manager', resource_code='closed_season', can_view=True,
        )

    def test_get_active_season_returns_the_active_row(self):
        self.assertEqual(get_active_season(), self.active)

    def test_get_active_season_returns_none_when_none_active(self):
        Season.objects.filter(pk=self.active.pk).update(is_active=False)
        self.assertIsNone(get_active_season())

    def test_resolve_defaults_to_active_when_no_param(self):
        self.assertEqual(resolve_season(_request(self.operator)), self.active)

    def test_resolve_honours_explicit_season_param(self):
        resolved = resolve_season(_request(self.viewer, season=str(self.active.pk)))
        self.assertEqual(resolved, self.active)

    def test_resolve_closed_season_allowed_with_permission(self):
        resolved = resolve_season(_request(self.viewer, season=str(self.closed.pk)))
        self.assertEqual(resolved, self.closed)

    def test_resolve_closed_season_denied_without_permission(self):
        with self.assertRaises(PermissionDenied):
            resolve_season(_request(self.operator, season=str(self.closed.pk)))

    def test_resolve_unknown_season_raises_not_found(self):
        with self.assertRaises(NotFound):
            resolve_season(_request(self.viewer, season='999999'))

    def test_resolve_non_ascii_digit_raises_not_found_not_500(self):
        """str.isdigit() is True for U+00B2 ('²') but int('²') raises ValueError —
        this must degrade to NotFound, not an unhandled 500."""
        with self.assertRaises(NotFound):
            resolve_season(_request(self.viewer, season='²'))

    def test_resolve_ignores_blank_param(self):
        self.assertEqual(resolve_season(_request(self.operator, season='')), self.active)

    def test_can_view_closed_true_for_granted_role(self):
        self.assertTrue(can_view_closed(self.viewer))

    def test_can_view_closed_false_for_ungranted_role(self):
        self.assertFalse(can_view_closed(self.operator))

    def test_can_view_closed_true_for_superuser(self):
        su = User.objects.create(username='su', role='warehouse_chief', is_superuser=True)
        self.assertTrue(can_view_closed(su))


class AssertSeasonOpenTests(TestCase):
    def test_open_season_passes(self):
        season = Season.objects.create(
            name='2026/2027', start_date=date(2026, 9, 1), end_date=date(2027, 8, 31),
            is_active=True,
        )
        assert_season_open(season)  # must not raise

    def test_none_passes(self):
        assert_season_open(None)  # must not raise

    def test_closed_season_raises(self):
        season = Season.objects.create(
            name='2025/2026', start_date=date(2025, 9, 1), end_date=date(2026, 8, 31),
            closed_at=timezone.now(),
        )
        with self.assertRaises(SeasonClosedError) as ctx:
            assert_season_open(season)
        self.assertEqual(ctx.exception.season, season)


class NoAdHocActiveSeasonLookupTests(TestCase):
    """Regression guard: the write-target lookup lives in one place.

    Nine call sites used `Season.objects.filter(is_active=True)` directly, with
    inconsistent tie-breaks. New ones must not reappear — a stray lookup silently
    reintroduces the read-scope/write-target conflation this feature untangles.
    """

    ALLOWED = {
        Path('apps/core/seasons.py'),           # the one legitimate home
        Path('apps/core/tests_seasons.py'),     # this file
    }

    # Matches both the write-target form (`Season.objects.filter(is_active=True)`,
    # possibly split across lines) and the read-scope form
    # (`filter(season__is_active=True)`) that Task 5 replaces. DOTALL so the
    # multi-line call style does not slip through.
    WRITE_TARGET = re.compile(r'Season\.objects[^\n]*?\.\s*filter\s*\(.*?is_active\s*=\s*True', re.DOTALL)
    READ_SCOPE = re.compile(r'season__is_active\s*=\s*True')

    # A READ_SCOPE hit is tolerated only when it carries this exact marker
    # within a few lines above it — Task 5 converts these to resolve_season()
    # and the marker (hence the tolerance) disappears with it. This is
    # per-line, not a whole-file exemption, so WRITE_TARGET stays fully
    # enforced on these files: a *new* ad-hoc lookup elsewhere in
    # export/views.py or contracts/views.py still fails the guard.
    DEFERRED_MARKER = '# TODO(season-scope): replaced by resolve_season() in Task 5'
    _MARKER_LOOKBACK = 5

    def _has_nearby_marker(self, lines: list[str], line_index: int) -> bool:
        window = lines[max(0, line_index - self._MARKER_LOOKBACK):line_index + 1]
        return any(self.DEFERRED_MARKER in line for line in window)

    def test_no_direct_is_active_lookups_outside_core_seasons(self):
        backend = Path(__file__).resolve().parents[2]
        offenders = []
        for path in backend.glob('apps/**/*.py'):
            rel = path.relative_to(backend)
            if rel in self.ALLOWED or 'migrations' in rel.parts:
                continue
            if rel.name.startswith('tests') or rel.parts[-2:-1] == ('tests',):
                continue
            text = path.read_text(encoding='utf-8')
            if self.WRITE_TARGET.search(text):
                offenders.append(str(rel))
                continue
            lines = text.splitlines()
            unmarked_read_scope = any(
                self.READ_SCOPE.search(line) and not self._has_nearby_marker(lines, i)
                for i, line in enumerate(lines)
            )
            if unmarked_read_scope:
                offenders.append(str(rel))
        self.assertEqual(
            offenders, [],
            'Use apps.core.seasons.get_active_season() (write target) or '
            'resolve_season(request) (read scope) instead — or mark a deferred '
            f'Task-5 read-scope site with {self.DEFERRED_MARKER!r}: {offenders}',
        )
