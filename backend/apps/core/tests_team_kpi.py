"""Tests for the team-KPI aggregation service."""
from datetime import date, timedelta

from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core.models import RoleResourcePermission, Season, User
from apps.core.services_team_kpi import parse_period, compute_team_kpi, period_window
from apps.export.models import Task, TaskState, TaskCompletionRule


class ParsePeriodTest(TestCase):
    def test_defaults_to_week(self):
        self.assertEqual(parse_period(None), 'week')
        self.assertEqual(parse_period(''), 'week')

    def test_valid_values(self):
        for p in ('today', 'week', 'month', 'season'):
            self.assertEqual(parse_period(p), p)

    def test_unknown_raises(self):
        with self.assertRaises(ValueError):
            parse_period('year')


class ComputeTeamKpiTest(TestCase):
    def setUp(self):
        self.alice = User.objects.create(username='alice', role='loading_dept_head', is_active=True)
        self.bob = User.objects.create(username='bob', role='document_team', is_active=True)

    def _done_task(self, user, *, deadline=None, completed_at=None, on_time=True):
        now = completed_at or timezone.now()
        dl = deadline
        if deadline is None and on_time is not None:
            dl = now + (timedelta(hours=1) if on_time else timedelta(hours=-1))
        return Task.objects.create(
            title_key='t', assignee_role=user.role,
            completion_rule=TaskCompletionRule.MANUAL_DONE,
            state=TaskState.DONE, completed_at=now, completed_by=user, deadline=dl,
        )

    def test_counts_completed_per_user_this_week(self):
        self._done_task(self.alice)
        self._done_task(self.alice)
        self._done_task(self.bob)
        rows = {r['user_id']: r for r in compute_team_kpi('week')}
        self.assertEqual(rows[self.alice.id]['completed'], 2)
        self.assertEqual(rows[self.bob.id]['completed'], 1)

    def test_on_time_rate(self):
        self._done_task(self.alice, on_time=True)
        self._done_task(self.alice, on_time=False)
        rows = {r['user_id']: r for r in compute_team_kpi('week')}
        self.assertEqual(rows[self.alice.id]['on_time_rate'], 0.5)

    def test_on_time_rate_null_when_no_deadline(self):
        Task.objects.create(
            title_key='t', assignee_role=self.alice.role,
            completion_rule=TaskCompletionRule.MANUAL_DONE,
            state=TaskState.DONE, completed_at=timezone.now(),
            completed_by=self.alice, deadline=None,
        )
        rows = {r['user_id']: r for r in compute_team_kpi('week')}
        self.assertIsNone(rows[self.alice.id]['on_time_rate'])

    def test_overdue_now_is_role_based_and_window_independent(self):
        # An open, past-deadline task (never completed -> no completed_by).
        Task.objects.create(
            title_key='t', assignee_role='loading_dept_head',
            completion_rule=TaskCompletionRule.MANUAL_DONE,
            state=TaskState.OPEN, deadline=timezone.now() - timedelta(hours=2),
        )
        rows = {r['user_id']: r for r in compute_team_kpi('today')}
        self.assertEqual(rows[self.alice.id]['overdue_now'], 1)
        self.assertEqual(rows[self.bob.id]['overdue_now'], 0)

    def test_overdue_only_counts_live_shipment_tasks(self):
        # Overdue-now counts a task on a live shipment, but NOT tasks on draft
        # (parked, no destination yet) or soft-deleted shipments. All three
        # tasks are identical except for their shipment's state, so this proves
        # the two exclusions are what drops them — not some other filter.
        from apps.core.models import ShipmentStatusType
        from apps.export.tests_task_attribution_helpers import make_basic_shipment

        live_status, _ = ShipmentStatusType.objects.get_or_create(
            code='yola_chykdy',
            defaults={'name_tk': 'x', 'name_en': 'x', 'name_ru': 'x',
                      'step_order': 5, 'phase': 'TRANSIT'},
        )
        past = timezone.now() - timedelta(hours=2)

        def overdue_task_on(shipment):
            Task.objects.create(
                shipment=shipment, title_key='t', assignee_role='loading_dept_head',
                completion_rule=TaskCompletionRule.MANUAL_DONE,
                state=TaskState.OPEN, deadline=past,
            )

        live = make_basic_shipment(created_by=self.alice)
        live.status = live_status
        live.save(update_fields=['status'])
        overdue_task_on(live)                        # counts

        draft = make_basic_shipment(created_by=self.alice)  # helper => code='draft'
        overdue_task_on(draft)                       # excluded (draft)

        deleted = make_basic_shipment(created_by=self.alice)
        deleted.status = live_status
        deleted.deleted_at = timezone.now()
        deleted.save(update_fields=['status', 'deleted_at'])
        overdue_task_on(deleted)                     # excluded (soft-deleted)

        rows = {r['user_id']: r for r in compute_team_kpi('today')}
        self.assertEqual(rows[self.alice.id]['overdue_now'], 1)

    def test_zero_completion_users_present_and_sorted_last(self):
        self._done_task(self.alice)
        rows = compute_team_kpi('week')
        ids = [r['user_id'] for r in rows]
        self.assertIn(self.bob.id, ids)                 # zero user still present
        self.assertEqual(rows[0]['user_id'], self.alice.id)   # most completed first
        self.assertEqual(rows[-1]['completed'], 0)            # zeros at the bottom

    def test_old_completion_excluded_from_today(self):
        old = timezone.now() - timedelta(days=3)
        self._done_task(self.alice, completed_at=old)
        rows = {r['user_id']: r for r in compute_team_kpi('today')}
        self.assertEqual(rows[self.alice.id]['completed'], 0)

    def test_trend_is_14_day_series(self):
        # 2 tasks completed today, 1 completed 3 days ago.
        now = timezone.now()
        self._done_task(self.alice, completed_at=now)
        self._done_task(self.alice, completed_at=now)
        self._done_task(self.alice, completed_at=now - timedelta(days=3))
        rows = {r['user_id']: r for r in compute_team_kpi('week')}
        trend = rows[self.alice.id]['trend']
        self.assertEqual(len(trend), 14)
        self.assertEqual(trend[-1], 2)      # today = last element
        self.assertEqual(trend[-4], 1)      # 3 days ago
        self.assertEqual(sum(trend), 3)
        # A user with no completions gets an all-zero 14-length series.
        self.assertEqual(rows[self.bob.id]['trend'], [0] * 14)


class TeamKpiApiTest(TestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create(username='viewer', role='document_team', is_active=True)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_returns_period_and_results(self):
        resp = self.client.get('/api/v1/core/team-kpi/?period=week')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['period'], 'week')
        self.assertIsInstance(resp.data['results'], list)
        row = next(r for r in resp.data['results'] if r['user_id'] == self.user.id)
        self.assertEqual(
            set(row.keys()),
            {'user_id', 'user_name', 'role', 'completed', 'on_time_rate',
             'overdue_now', 'active_seconds', 'trend'},
        )

    def test_default_period_is_week(self):
        resp = self.client.get('/api/v1/core/team-kpi/')
        self.assertEqual(resp.data['period'], 'week')

    def test_unknown_period_400(self):
        resp = self.client.get('/api/v1/core/team-kpi/?period=decade')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('error', resp.data)

    def test_requires_auth(self):
        anon = APIClient()
        resp = anon.get('/api/v1/core/team-kpi/?period=week')
        self.assertIn(resp.status_code, (401, 403))


# ---------------------------------------------------------------------------
# ?season= parameterises period=season's window (spec §4.3)
# ---------------------------------------------------------------------------

class PeriodWindowSeasonParamTest(TestCase):
    """`period_window('season', season)` — the resolved season parameterises
    the window; it is never used to filter a queryset by season= FK, so
    there's no SeasonScopedMixin fail-closed behaviour to worry about here.
    """

    def test_season_none_returns_no_lower_bound(self):
        self.assertEqual(period_window('season', season=None), (None, None))

    def test_season_start_date_drives_since_dt(self):
        season = Season.objects.create(
            name='pw1', start_date=date(2025, 9, 1), end_date=date(2026, 6, 30),
        )
        since_dt, since_date = period_window('season', season=season)
        self.assertEqual(since_date, date(2025, 9, 1))
        self.assertEqual(since_dt.date(), date(2025, 9, 1))


class TeamKpiSeasonParamApiTest(TestCase):
    """`period=season` is a window-since-date, not a bounded range — selecting
    an OLDER season moves `since_dt` earlier and so includes MORE completions
    (no upper bound), not exclusively that season's own data. These tests
    assert on that basis: default (active season) counts fewer completions
    than explicitly selecting the older season, which is the observable proof
    the window actually moved.
    """

    def setUp(self):
        cache.clear()
        self.alice = User.objects.create(username='tk_alice', role='loading_dept_head', is_active=True)
        self.older = Season.objects.create(
            name='tks_old', start_date=date(2024, 9, 1), end_date=date(2025, 8, 31),
            closed_at=timezone.now(),
        )
        self.newer = Season.objects.create(
            name='tks_new', start_date=date(2025, 9, 1), end_date=date(2026, 6, 30),
            is_active=True,
        )
        # One completion before the newer season starts, one after — the
        # newer-season window (default) should see only the second; the
        # older-season window (explicit ?season=) should see both.
        Task.objects.create(
            title_key='t', assignee_role=self.alice.role,
            completion_rule=TaskCompletionRule.MANUAL_DONE,
            state=TaskState.DONE, completed_by=self.alice,
            completed_at=timezone.make_aware(timezone.datetime(2024, 10, 1, 12, 0)),
        )
        Task.objects.create(
            title_key='t', assignee_role=self.alice.role,
            completion_rule=TaskCompletionRule.MANUAL_DONE,
            state=TaskState.DONE, completed_by=self.alice,
            completed_at=timezone.make_aware(timezone.datetime(2025, 10, 1, 12, 0)),
        )

    def _alice_completed(self, resp) -> int:
        row = next(r for r in resp.data['results'] if r['user_id'] == self.alice.id)
        return row['completed']

    def test_closed_season_param_moves_the_window(self):
        RoleResourcePermission.objects.update_or_create(
            role='loading_dept_head', resource_code='closed_season',
            defaults={'can_view': True},
        )
        client = APIClient()
        client.force_authenticate(user=self.alice)

        default_resp = client.get('/api/v1/core/team-kpi/?period=season')
        self.assertEqual(default_resp.status_code, 200)
        self.assertEqual(self._alice_completed(default_resp), 1)

        closed_resp = client.get(
            f'/api/v1/core/team-kpi/?period=season&season={self.older.pk}'
        )
        self.assertEqual(closed_resp.status_code, 200)
        self.assertEqual(self._alice_completed(closed_resp), 2)

    def test_unpermitted_user_closed_season_gets_403(self):
        # No closed_season.can_view grant for this role.
        client = APIClient()
        client.force_authenticate(user=self.alice)

        resp = client.get(
            f'/api/v1/core/team-kpi/?period=season&season={self.older.pk}'
        )
        self.assertEqual(resp.status_code, 403)

    def test_non_season_period_ignores_season_param(self):
        """?season= is only consulted when period=season — a stray ?season=
        on period=week must not raise even if it names a closed season the
        user can't view, since it's never resolved for that branch."""
        client = APIClient()
        client.force_authenticate(user=self.alice)

        resp = client.get(f'/api/v1/core/team-kpi/?period=week&season={self.older.pk}')
        self.assertEqual(resp.status_code, 200)


class TeamKpiNoActiveSeasonFailsClosedTest(TestCase):
    """D7 — `period=season` with no season resolved returns NOTHING.

    `period_window('season', None)` returns `(None, None)`, i.e. no lower
    bound, which silently turned the leaderboard into an ALL-TIME window
    during the close→open gap — every closed season's completions blended
    into one row for every authenticated user. `period_window` keeps that
    return (its `(None, None)` legitimately means "unbounded"); the D7 gate
    lives in `compute_team_kpi`, the only caller that can distinguish the
    gap from a deliberate unbounded window.
    """

    def setUp(self):
        cache.clear()
        self.alice = User.objects.create(
            username='tkgap_alice', role='loading_dept_head', is_active=True,
        )
        self.closed = Season.objects.create(
            name='tkgapC', start_date=date(2024, 9, 1),
            end_date=date(2025, 8, 31), closed_at=timezone.now(),
        )
        Task.objects.create(
            title_key='t', assignee_role=self.alice.role,
            completion_rule=TaskCompletionRule.MANUAL_DONE,
            state=TaskState.DONE, completed_by=self.alice,
            completed_at=timezone.make_aware(timezone.datetime(2024, 10, 1, 12, 0)),
        )

    def test_service_returns_empty_when_no_season_resolves(self):
        self.assertEqual(compute_team_kpi('season', season=None), [])

    def test_api_returns_empty_results_during_the_gap(self):
        client = APIClient()
        client.force_authenticate(user=self.alice)
        resp = client.get('/api/v1/core/team-kpi/?period=season')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['results'], [])

    def test_other_periods_are_unaffected_by_the_gap(self):
        """Only `period=season` consults a season — week/month/today must
        keep returning the full roster during the gap."""
        client = APIClient()
        client.force_authenticate(user=self.alice)
        resp = client.get('/api/v1/core/team-kpi/?period=week')
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.data['results'])

    def test_explicit_closed_season_still_resolves_for_a_permitted_user(self):
        """Failing closed on the GAP must not break the switcher."""
        RoleResourcePermission.objects.update_or_create(
            role='loading_dept_head', resource_code='closed_season',
            defaults={'can_view': True},
        )
        client = APIClient()
        client.force_authenticate(user=self.alice)
        resp = client.get(
            f'/api/v1/core/team-kpi/?period=season&season={self.closed.pk}'
        )
        self.assertEqual(resp.status_code, 200)
        row = next(r for r in resp.data['results'] if r['user_id'] == self.alice.id)
        self.assertEqual(row['completed'], 1)
