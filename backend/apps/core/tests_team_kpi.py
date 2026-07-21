"""Tests for the team-KPI aggregation service."""
from datetime import timedelta

from django.test import TestCase
from django.utils import timezone

from apps.core.models import User
from apps.core.services_team_kpi import parse_period, compute_team_kpi
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
