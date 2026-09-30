"""alloc_review + transport_plan acknowledgement tasks (docs/Tasks.md items 2b, 3).

Spec: docs/superpowers/specs/2026-09-29-planning-tasks-design.md §3.
"""
import datetime
from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import GreenhouseBlock, GreenhouseConfig, Season, TruckDestination, User
from apps.export.models import Task, TaskKind, TaskState, TruckDestinationSplit, WeeklyTruckAllocation
from apps.export.services.plan_ack_tasks import (
    acknowledge, can_acknowledge, on_allocation_saved, review_changes, sync_alloc_review, sync_plan_ack_tasks,
)
from apps.export.services.truck_allocation_tasks import generate_truck_allocation_task
from apps.greenhouse.models import HarvestDayEntry, WeeklyHarvestPlan

YEAR, WEEK = 2026, 40                       # Mon 2026-09-28 .. Sat 2026-10-03
MONDAY = datetime.date(2026, 9, 28)
SAT_BEFORE = datetime.date(2026, 9, 26)     # allocation day
IN_WEEK = datetime.date(2026, 9, 30)
AFTER_WEEK = datetime.date(2026, 10, 4)     # Sunday after — reviews stop


def _user(username, role):
    u = User(username=username, role=role)
    u.set_password('pw')
    u.save()
    return u


class _Fixture(TestCase):
    @classmethod
    def setUpTestData(cls):
        GreenhouseConfig.get_solo()
        Season.objects.update(is_active=False)
        cls.season = Season.objects.create(
            name='pat', start_date='2026-08-01', end_date='2027-06-30', is_active=True,
        )
        cls.block = GreenhouseBlock.objects.create(code='PAT-A', name='A', is_active=True)
        cls.dest = TruckDestination.objects.create(name='PAT Russia', sort_order=1)
        cls.em = _user('pat_em', 'export_manager')
        cls.tr = _user('pat_tr', 'transport')
        cls.rep = _user('pat_rep', 'sales_rep')

    def setUp(self):
        # Role permission lookups are cached per role (60 s); a row written by an
        # earlier test in the same process must not leak in.
        from django.core.cache import cache

        from apps.core.models import RoleResourcePermission

        cache.clear()
        RoleResourcePermission.objects.update_or_create(
            role='export_manager', resource_code='truck_allocation',
            defaults={'can_view': True, 'can_create': True, 'can_edit': True, 'can_delete': False},
        )

    def _plan(self, offset, kg):
        plan, _ = WeeklyHarvestPlan.objects.get_or_create(
            season=self.season, block=self.block, week_number=WEEK, year=YEAR,
        )
        d = MONDAY + datetime.timedelta(days=offset)
        HarvestDayEntry.objects.update_or_create(
            weekly_plan=plan, entry_date=d,
            defaults={'season': self.season, 'block': self.block,
                      'weekday': d.weekday(), 'plan_value': Decimal(kg)},
        )

    def _split(self, dow, count):
        alloc, _ = WeeklyTruckAllocation.objects.get_or_create(
            season=self.season, week_number=WEEK, year=YEAR, day_of_week=dow,
        )
        TruckDestinationSplit.objects.update_or_create(
            truck_allocation=alloc, destination=self.dest, defaults={'truck_count': count},
        )

    def _allocated_week(self):
        """Mon plan 20 t (1 truck), allocation task generated + 1 truck on Mon → DONE.
        The clock is pinned to SAT_BEFORE so the suite does not rot after the week."""
        self._plan(0, '20000')
        generate_truck_allocation_task(YEAR, WEEK)
        self._split(1, 1)
        on_allocation_saved(YEAR, WEEK, today=SAT_BEFORE)
        alloc = Task.objects.get(kind=TaskKind.TRUCK_ALLOCATION)
        self.assertEqual(alloc.state, TaskState.DONE)
        return alloc

    def _reviews(self):
        return Task.objects.filter(kind=TaskKind.ALLOC_REVIEW, scope_year=YEAR, scope_week=WEEK)


class AllocReviewTests(_Fixture):
    def test_no_review_while_truck_count_unchanged(self):
        self._allocated_week()
        self._plan(0, '21000')                    # still 1 truck
        self.assertIsNone(sync_alloc_review(YEAR, WEEK, IN_WEEK))

    def test_review_when_a_day_needs_more_trucks(self):
        self._allocated_week()
        self._plan(0, '40000')                    # 1 → 2 trucks
        task = sync_alloc_review(YEAR, WEEK, IN_WEEK)
        self.assertEqual(task.assignee_role, 'export_manager')
        self.assertEqual(task.title_key, 'tasks.review_truck_allocation')
        self.assertEqual(task.link, f'/export/plan?week={WEEK}&year={YEAR}')
        self.assertEqual(review_changes(YEAR, WEEK), [{'day_of_week': 1, 'was': 1, 'now': 2}])
        # Second sync: still one open review.
        self.assertIsNone(sync_alloc_review(YEAR, WEEK, IN_WEEK))
        self.assertEqual(self._reviews().count(), 1)

    def test_decrease_to_zero_also_raises_a_review(self):
        self._allocated_week()
        self._plan(0, '0')
        self.assertIsNotNone(sync_alloc_review(YEAR, WEEK, IN_WEEK))

    def test_no_review_before_allocation_done_or_after_the_week(self):
        self._plan(0, '20000')
        generate_truck_allocation_task(YEAR, WEEK)            # OPEN
        self._plan(0, '40000')
        self.assertIsNone(sync_alloc_review(YEAR, WEEK, IN_WEEK))
        self._split(1, 2)
        on_allocation_saved(YEAR, WEEK, today=SAT_BEFORE)     # DONE, baseline = 2
        self._plan(0, '60000')
        self.assertIsNone(sync_alloc_review(YEAR, WEEK, AFTER_WEEK))

    def test_set_splits_refreshes_the_baseline(self):
        self._allocated_week()
        self._plan(0, '40000')
        self._split(1, 2)
        on_allocation_saved(YEAR, WEEK, today=IN_WEEK)   # manager saw the new plan while saving
        self.assertIsNone(sync_alloc_review(YEAR, WEEK, IN_WEEK))

    def test_empty_legacy_baseline_is_adopted_not_reviewed(self):
        alloc = self._allocated_week()
        Task.objects.filter(pk=alloc.pk).update(ack_snapshot='')
        self._plan(0, '40000')
        self.assertIsNone(sync_alloc_review(YEAR, WEEK, IN_WEEK))
        self.assertEqual(Task.objects.get(pk=alloc.pk).ack_snapshot, '1:2')

    def test_acknowledge_closes_and_moves_the_baseline(self):
        self._allocated_week()
        self._plan(0, '40000')
        task = sync_alloc_review(YEAR, WEEK, IN_WEEK)
        acknowledge(task, self.em)
        task.refresh_from_db()
        self.assertEqual(task.state, TaskState.DONE)
        self.assertEqual(task.completed_by, self.em)
        self.assertEqual(task.ack_snapshot, '1:2')
        self.assertEqual(Task.objects.get(kind=TaskKind.TRUCK_ALLOCATION).ack_snapshot, '1:2')
        self.assertIsNone(sync_alloc_review(YEAR, WEEK, IN_WEEK))

    def test_lost_race_does_not_duplicate(self):
        from apps.export.services.plan_ack_tasks import _create_ack_task

        self._allocated_week()
        _create_ack_task(TaskKind.ALLOC_REVIEW, YEAR, WEEK, 'export_manager', 't', '/x', None)
        self.assertIsNone(
            _create_ack_task(TaskKind.ALLOC_REVIEW, YEAR, WEEK, 'export_manager', 't', '/x', None),
        )
        self.assertEqual(self._reviews().count(), 1)

    def test_beat_entry_names_a_registered_task(self):
        from django.conf import settings

        from config.celery import app

        app.loader.import_default_modules()
        self.assertIn(settings.CELERY_BEAT_SCHEDULE['plan-ack-sync']['task'], app.tasks)


class AcknowledgeApiTests(_Fixture):
    def _review(self):
        self._allocated_week()
        self._plan(0, '40000')
        return sync_alloc_review(YEAR, WEEK, IN_WEEK)

    def _post(self, user, task_id, snapshot='1:2'):
        client = APIClient()
        client.force_authenticate(user)
        return client.post(
            f'/api/v1/export/tasks/{task_id}/acknowledge/', {'snapshot': snapshot}, format='json',
        )

    def test_export_manager_acknowledges_and_double_click_is_harmless(self):
        task = self._review()
        first = self._post(self.em, task.id)
        self.assertEqual(first.status_code, 200, first.content)
        self.assertEqual(first.data['state'], 'done')
        second = self._post(self.em, task.id)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(Task.objects.get(pk=task.pk).completed_by, self.em)

    def test_wrong_role_is_forbidden(self):
        task = self._review()
        self.assertEqual(self._post(self.rep, task.id).status_code, 403)

    def test_other_kinds_are_refused_and_complete_refuses_ack_kinds(self):
        alloc = self._allocated_week()
        self.assertEqual(self._post(self.em, alloc.id).status_code, 400)
        self._plan(0, '40000')
        review = sync_alloc_review(YEAR, WEEK, IN_WEEK)
        client = APIClient()
        client.force_authenticate(self.em)
        resp = client.post(f'/api/v1/export/tasks/{review.id}/complete/')
        self.assertEqual(resp.status_code, 400)

    def test_review_endpoint(self):
        task = self._review()
        client = APIClient()
        client.force_authenticate(self.em)
        resp = client.get(f'/api/v1/export/truck-allocations/review/?year={YEAR}&week={WEEK}')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.data, {
            'year': YEAR, 'week': WEEK, 'open_task_id': task.id,
            'changes': [{'day_of_week': 1, 'was': 1, 'now': 2}],
            'snapshot': '1:2', 'can_acknowledge': True,
        })
        bad = client.get('/api/v1/export/truck-allocations/review/?year=2026')
        self.assertEqual(bad.status_code, 400)


class TransportPlanTests(_Fixture):
    def _transport(self):
        return Task.objects.filter(kind=TaskKind.TRANSPORT_PLAN, scope_year=YEAR, scope_week=WEEK)

    def test_first_task_opens_when_allocation_is_done(self):
        from apps.export.services.plan_ack_tasks import sync_transport_plan
        from apps.export.services.plan_task_common import end_of_local_day

        self._plan(0, '20000')
        generate_truck_allocation_task(YEAR, WEEK)
        self.assertIsNone(sync_transport_plan(YEAR, WEEK, SAT_BEFORE))       # not done yet
        self._split(1, 1)
        on_allocation_saved(YEAR, WEEK, today=SAT_BEFORE)                    # set_splits path
        task = self._transport().get()
        self.assertEqual(task.assignee_role, 'transport')
        self.assertEqual(task.title_key, 'tasks.transport_plan')
        self.assertEqual(task.link, f'/transport/plan?week={WEEK}&year={YEAR}')
        self.assertEqual(task.deadline, end_of_local_day(SAT_BEFORE))

    def test_no_new_task_after_the_week_ends(self):
        from apps.export.services.plan_ack_tasks import sync_transport_plan

        self._allocated_week()
        acknowledge(self._transport().get(), self.tr)
        self._split(2, 3)
        self.assertIsNone(sync_transport_plan(YEAR, WEEK, AFTER_WEEK))

    def test_change_after_acknowledge_opens_a_changed_task(self):
        from apps.export.services.plan_ack_tasks import sync_transport_plan

        self._allocated_week()
        first = self._transport().get()
        acknowledge(first, self.tr)
        self.assertIsNone(sync_transport_plan(YEAR, WEEK, IN_WEEK))          # nothing changed
        self._split(2, 3)
        second = sync_transport_plan(YEAR, WEEK, IN_WEEK)
        self.assertEqual(second.title_key, 'tasks.transport_plan_changed')
        self.assertIsNone(sync_transport_plan(YEAR, WEEK, IN_WEEK))          # one open at a time

    def test_cancelled_first_task_is_not_recreated(self):
        from apps.export.services.plan_ack_tasks import sync_transport_plan

        self._allocated_week()
        self._transport().update(state=TaskState.CANCELLED)
        self.assertIsNone(sync_transport_plan(YEAR, WEEK, IN_WEEK))

    def test_beat_sweep_covers_current_and_next_week(self):
        self._plan(0, '20000')
        generate_truck_allocation_task(YEAR, WEEK)
        self._split(1, 1)                       # allocated, but set_splits hook not run
        created = sync_plan_ack_tasks(SAT_BEFORE)
        self.assertEqual([t.kind for t in created], [TaskKind.TRANSPORT_PLAN])

    def test_endpoint_shows_changes_since_acknowledge(self):
        from apps.core.models import RoleResourcePermission

        RoleResourcePermission.objects.update_or_create(
            role='transport', resource_code='truck_allocation',
            defaults={'can_view': True, 'can_create': False, 'can_edit': False, 'can_delete': False},
        )
        self._allocated_week()
        acknowledge(self._transport().get(), self.tr)
        self._split(1, 2)
        client = APIClient()
        client.force_authenticate(self.tr)
        resp = client.get(f'/api/v1/export/truck-allocations/transport-plan/?year={YEAR}&week={WEEK}')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(len(resp.data['days']), 6)
        self.assertEqual(resp.data['days'][0], {'day_of_week': 1, 'date': '2026-09-28'})
        self.assertEqual(resp.data['destinations'], [{'id': self.dest.id, 'name': 'PAT Russia'}])
        self.assertEqual(resp.data['cells'], [
            {'day_of_week': 1, 'destination_id': self.dest.id, 'truck_count': 2, 'acknowledged_count': 1},
        ])
        self.assertIsNone(resp.data['open_task_id'])       # the sweep has not run yet
        self.assertTrue(resp.data['acknowledged_at'].endswith('+05:00'))
        self.assertEqual(resp.data['snapshot'], f'1:{self.dest.id}:2')
        self.assertTrue(resp.data['can_acknowledge'])

    def test_transport_acknowledges_through_the_api(self):
        self._allocated_week()
        task = self._transport().get()
        client = APIClient()
        client.force_authenticate(self.tr)
        resp = client.post(
            f'/api/v1/export/tasks/{task.id}/acknowledge/', {'snapshot': f'1:{self.dest.id}:1'}, format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(Task.objects.get(pk=task.pk).ack_snapshot, f'1:{self.dest.id}:1')


class ReviewFixTests(_Fixture):
    """Final-review findings #1-#3 (2026-09-29)."""

    def _ack_api(self, user, task, snapshot):
        client = APIClient()
        client.force_authenticate(user)
        return client.post(f'/api/v1/export/tasks/{task.id}/acknowledge/', {'snapshot': snapshot}, format='json')

    def _review_payload(self, user):
        client = APIClient()
        client.force_authenticate(user)
        return client.get(f'/api/v1/export/truck-allocations/review/?year={YEAR}&week={WEEK}').data

    def test_ack_to_zero_then_increase_raises_a_review(self):
        # #1: a recorded-but-empty baseline must not read as "legacy, adopt silently".
        self._allocated_week()
        self._plan(0, '0')
        acknowledge(sync_alloc_review(YEAR, WEEK, IN_WEEK), self.em)
        self._plan(0, '40000')
        self.assertIsNotNone(sync_alloc_review(YEAR, WEEK, IN_WEEK))

    def test_allocation_created_on_an_empty_plan_still_reviews_a_later_plan(self):
        # #1: task generated Saturday before any plan cell was filled.
        generate_truck_allocation_task(YEAR, WEEK)
        Task.objects.filter(kind=TaskKind.TRUCK_ALLOCATION).update(state=TaskState.DONE)
        self._plan(0, '40000')
        self.assertIsNotNone(sync_alloc_review(YEAR, WEEK, IN_WEEK))

    def test_only_the_assignee_role_can_acknowledge(self):
        # #2: the export manager making the changes must not close transport's task.
        from apps.core.models import RoleResourcePermission

        RoleResourcePermission.objects.update_or_create(
            role='transport', resource_code='truck_allocation',
            defaults={'can_view': True, 'can_create': False, 'can_edit': False, 'can_delete': False},
        )
        self._allocated_week()
        task = Task.objects.get(kind=TaskKind.TRANSPORT_PLAN)
        client = APIClient()
        client.force_authenticate(self.em)
        plan = client.get(f'/api/v1/export/truck-allocations/transport-plan/?year={YEAR}&week={WEEK}').data
        self.assertFalse(plan['can_acknowledge'])
        self.assertEqual(self._ack_api(self.em, task, plan['snapshot']).status_code, 403)
        client.force_authenticate(self.tr)
        plan = client.get(f'/api/v1/export/truck-allocations/transport-plan/?year={YEAR}&week={WEEK}').data
        self.assertTrue(plan['can_acknowledge'])
        self.assertEqual(self._ack_api(self.tr, task, plan['snapshot']).status_code, 200)

    def test_stale_snapshot_is_refused(self):
        # #3: «Tanyşdym» must record what the user saw, not what the DB holds at click time.
        self._allocated_week()
        self._plan(0, '40000')
        task = sync_alloc_review(YEAR, WEEK, IN_WEEK)
        seen = self._review_payload(self.em)
        self.assertTrue(seen['can_acknowledge'])
        self._plan(0, '60000')                              # changes after the page loaded
        resp = self._ack_api(self.em, task, seen['snapshot'])
        self.assertEqual(resp.status_code, 409, resp.content)
        self.assertEqual(Task.objects.get(pk=task.pk).state, TaskState.OPEN)
        fresh = self._review_payload(self.em)
        self.assertEqual(self._ack_api(self.em, task, fresh['snapshot']).status_code, 200)

    def test_snapshot_is_required(self):
        self._allocated_week()
        self._plan(0, '40000')
        task = sync_alloc_review(YEAR, WEEK, IN_WEEK)
        client = APIClient()
        client.force_authenticate(self.em)
        self.assertEqual(client.post(f'/api/v1/export/tasks/{task.id}/acknowledge/').status_code, 400)


class AckOverrideRolesTests(_Fixture):
    """Owner, 2026-09-29: boss / director / admin may also press «Tanyşdym»; the
    export manager still may not acknowledge transport's task."""

    def test_boss_director_admin_can_acknowledge_transport_task(self):
        for username, role in (('pat_boss', 'boss'), ('pat_dir', 'director'), ('pat_adm', 'admin')):
            with self.subTest(role=role):
                user = _user(username, role)
                self.assertTrue(can_acknowledge(user, 'transport'))
                self.assertTrue(can_acknowledge(user, 'export_manager'))

    def test_export_manager_and_other_roles_still_cannot(self):
        self.assertFalse(can_acknowledge(self.em, 'transport'))
        self.assertFalse(can_acknowledge(self.rep, 'export_manager'))
        self.assertTrue(can_acknowledge(self.tr, 'transport'))

    def test_boss_acknowledges_through_the_api(self):
        from apps.core.models import RoleResourcePermission

        RoleResourcePermission.objects.update_or_create(
            role='boss', resource_code='truck_allocation',
            defaults={'can_view': True, 'can_create': True, 'can_edit': True, 'can_delete': True},
        )
        boss = _user('pat_boss2', 'boss')
        self._allocated_week()
        task = Task.objects.get(kind=TaskKind.TRANSPORT_PLAN)
        client = APIClient()
        client.force_authenticate(boss)
        plan = client.get(f'/api/v1/export/truck-allocations/transport-plan/?year={YEAR}&week={WEEK}').data
        self.assertTrue(plan['can_acknowledge'])
        resp = client.post(
            f'/api/v1/export/tasks/{task.id}/acknowledge/', {'snapshot': plan['snapshot']}, format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(Task.objects.get(pk=task.pk).completed_by, boss)
