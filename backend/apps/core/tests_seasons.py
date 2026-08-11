"""Tests for the Season lifecycle (open / close / derived status).

Run with:
    python manage.py test apps.core.tests_seasons --verbosity=2
"""
import re
from datetime import date
from pathlib import Path
from types import SimpleNamespace

from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.management import call_command
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.test import TestCase
from django.utils import timezone
from rest_framework.exceptions import NotFound, PermissionDenied

from apps.core.models import RoleResourcePermission, Season, User
from apps.core.permission_registry import RESOURCE_REGISTRY
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


class SeasonActivationGuardTests(TestCase):
    """Task 16b: `is_active=True` on a closed season must never persist,
    regardless of caller (ORM, admin, management command)."""

    def test_activating_closed_season_via_save_raises(self):
        season = Season.objects.create(
            name='2024/2025', start_date=date(2024, 9, 1), end_date=date(2025, 8, 31),
            closed_at=timezone.now(),
        )
        season.is_active = True
        with self.assertRaises(DjangoValidationError):
            season.save()

    def test_activating_open_season_is_unaffected(self):
        """Sanity check the guard is scoped to closed seasons only."""
        season = Season.objects.create(
            name='2027/2028', start_date=date(2027, 9, 1), end_date=date(2028, 8, 31),
        )
        season.is_active = True
        season.save()
        season.refresh_from_db()
        self.assertTrue(season.is_active)


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

    `apps/core/services/season.py` (Task 10's close/open) writes `is_active`
    via instance `.save(update_fields=[...])`, not a queryset `.filter(...)`,
    so it needs no exemption here — it never matches this guard's pattern in
    the first place, and a genuine future ad-hoc lookup added to that file
    would still be caught.
    """

    ALLOWED = {
        Path('apps/core/seasons.py'),           # the one legitimate home
        Path('apps/core/tests_seasons.py'),     # this file
    }

    # Matches both the write-target form (`Season.objects.filter(is_active=True)`,
    # possibly split across lines) and the read-scope form
    # (`filter(season__is_active=True)`), now fully replaced by resolve_season().
    # DOTALL so the multi-line call style does not slip through.
    #
    # Task 5 removed the marker-comment tolerance that briefly exempted three
    # deferred sites: it was a bare text match, so pasting the comment beside a
    # brand-new ad-hoc lookup would have silenced the guard.
    WRITE_TARGET = re.compile(r'Season\.objects[^\n]*?\.\s*filter\s*\(.*?is_active\s*=\s*True', re.DOTALL)
    READ_SCOPE = re.compile(r'season__is_active\s*=\s*True')

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
            if self.WRITE_TARGET.search(text) or self.READ_SCOPE.search(text):
                offenders.append(str(rel))
        self.assertEqual(
            offenders, [],
            'Use apps.core.seasons.get_active_season() (write target) or '
            f'resolve_season(request) (read scope) instead: {offenders}',
        )


class ClosedSeasonResourceTests(TestCase):
    """`closed_season` is a RESOURCE_REGISTRY entry, not a custom action (D3).

    Note: per spec §9.1 (D8), `closed_season.can_view` no longer implies
    archive-level read — the label must not claim otherwise. See
    docs/superpowers/specs/2026-08-03-season-lifecycle-design.md §9.1.
    """

    def test_resource_is_registered(self):
        self.assertIn('closed_season', RESOURCE_REGISTRY)

    def test_seed_grants_management_roles(self):
        call_command('seed_permissions')
        granted = set(
            RoleResourcePermission.objects.filter(
                resource_code='closed_season', can_view=True,
            ).values_list('role', flat=True)
        )
        self.assertEqual(
            granted, {'admin', 'director', 'boss', 'export_manager', 'finansist'},
        )

    def test_seed_grants_no_write_actions(self):
        """Closed seasons are read-only (D1) — write flags are meaningless here."""
        call_command('seed_permissions')
        writes = RoleResourcePermission.objects.filter(
            resource_code='closed_season',
        ).filter(Q(can_create=True) | Q(can_edit=True) | Q(can_delete=True))
        self.assertFalse(writes.exists())


class AuthMeSeasonFieldsTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        cls.season = Season.objects.create(
            name='2026/2027', start_date=date(2026, 9, 1), end_date=date(2027, 8, 31),
            is_active=True,
        )
        cls.manager = User.objects.create(username='mgr', role='export_manager')
        cls.operator = User.objects.create(username='op', role='warehouse_chief')

    def _get_me(self, user):
        from rest_framework.test import APIClient
        client = APIClient()
        client.force_authenticate(user=user)
        return client.get('/api/v1/auth/me/')

    def test_me_returns_active_season(self):
        payload = self._get_me(self.manager).json()
        self.assertEqual(payload['active_season']['name'], '2026/2027')
        self.assertEqual(payload['active_season']['status'], 'ACTIVE')

    def test_me_returns_null_active_season_when_none_open(self):
        Season.objects.filter(pk=self.season.pk).update(is_active=False)
        payload = self._get_me(self.manager).json()
        self.assertIsNone(payload['active_season'])

    def test_me_reports_closed_season_permission(self):
        self.assertTrue(self._get_me(self.manager).json()['can_view_closed_seasons'])
        self.assertFalse(self._get_me(self.operator).json()['can_view_closed_seasons'])
