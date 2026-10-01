"""Daily planning tasks — docs/Tasks.md items 4 («Ýük planla») and 5a («Eksport planla»).

Spec: docs/superpowers/specs/2026-09-29-planning-tasks-design.md §2.
"""
import datetime
from unittest import mock

from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import (
    Country, Customer, GreenhouseBlock, GreenhouseConfig, Season, ShipmentStatusType,
    TruckDestination, User,
)
from apps.export.models import (
    Shipment, ShipmentBlockSource, Task, TaskCancelReason, TaskKind, TaskState,
    TruckDestinationSplit, WeeklyTruckAllocation,
)
from apps.export.services import daily_progress as daily_progress_module
from apps.export.services.daily_plan_tasks import (
    cancel_missed_daily_tasks, generate_daily_plan_tasks, resolve_daily_plan_tasks,
    run_daily_plan_tasks,
)
from apps.export.services.plan_task_common import end_of_local_day

MONDAY = datetime.date(2026, 9, 28)
TUESDAY = datetime.date(2026, 9, 29)
SATURDAY = datetime.date(2026, 10, 3)
SUNDAY = datetime.date(2026, 10, 4)


class DailyPlanTaskTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        GreenhouseConfig.get_solo()
        Season.objects.update(is_active=False)
        cls.season = Season.objects.create(
            name='dpt', start_date='2026-08-01', end_date='2027-06-30', is_active=True,
        )
        for code, order, phase in [('draft', 0, 'DRAFT'), ('cancelled', 99, 'CANCELLED')]:
            ShipmentStatusType.objects.get_or_create(
                code=code,
                defaults={'name_tk': code, 'name_en': code, 'name_ru': code,
                          'step_order': order, 'phase': phase},
            )
        cls.user = User.objects.create_user(username='dpt_em', password='pw', role='export_manager')
        cls.deputy = User.objects.create_user(
            username='dpt_dep', password='pw', role='loading_dept_head_deputy',
        )
        cls.block = GreenhouseBlock.objects.create(code='DPT-A', name='A', is_active=True)
        cls.country = Country.objects.create(name_tk='DPT land', code='DP')
        cls.customer = Customer.objects.create(name='DPT customer')
        cls.dest = TruckDestination.objects.create(name='DPT dest', country=cls.country, sort_order=1)

    def setUp(self):
        self.n = 0

    def _shipment(self, day, status='draft', **extra) -> Shipment:
        self.n += 1
        return Shipment.objects.create(
            shipment_code=f'DPT-{self.n}', date=day, season=self.season,
            status=ShipmentStatusType.objects.get(code=status),
            created_by=self.user, updated_by=self.user, **extra,
        )

    def _truck(self, day, **extra) -> Shipment:
        s = self._shipment(day, **extra)
        ShipmentBlockSource.objects.create(shipment=s, block=self.block, weight_kg=1000)
        return s

    def _task(self, kind, day):
        return Task.objects.get(kind=kind, scope_date=day)

    def _plan(self, day, trucks):
        year, week, dow = day.isocalendar()
        alloc = WeeklyTruckAllocation.objects.create(
            season=self.season, year=year, week_number=week, day_of_week=dow,
        )
        TruckDestinationSplit.objects.create(truck_allocation=alloc, destination=self.dest, truck_count=trucks)

    def test_generates_two_tasks_monday_to_saturday_not_sunday(self):
        created = generate_daily_plan_tasks(MONDAY)
        self.assertEqual({t.kind for t in created}, {TaskKind.DAILY_LOADING, TaskKind.DAILY_EXPORT})
        loading = self._task(TaskKind.DAILY_LOADING, MONDAY)
        self.assertEqual(loading.assignee_role, 'loading_dept_head')
        self.assertEqual(loading.link, '/export/gaplama')
        self.assertEqual(loading.title_key, 'tasks.daily_loading_plan')
        self.assertEqual(loading.deadline, end_of_local_day(MONDAY))
        export = self._task(TaskKind.DAILY_EXPORT, MONDAY)
        self.assertEqual((export.assignee_role, export.link), ('export_manager', '/export/assign'))
        self.assertEqual(len(generate_daily_plan_tasks(SATURDAY)), 2)
        self.assertEqual(generate_daily_plan_tasks(SUNDAY), [])

    def test_rerun_does_not_duplicate(self):
        generate_daily_plan_tasks(MONDAY)
        self.assertEqual(generate_daily_plan_tasks(MONDAY), [])
        self.assertEqual(Task.objects.filter(scope_date=MONDAY).count(), 2)

    def test_no_active_season_no_tasks(self):
        Season.objects.update(is_active=False)
        self.assertEqual(generate_daily_plan_tasks(MONDAY), [])

    def test_loading_done_by_a_truck_dated_today_even_if_opened_yesterday(self):
        self._truck(MONDAY)                               # opened earlier, dated Monday
        generate_daily_plan_tasks(MONDAY)
        resolve_daily_plan_tasks()
        self.assertEqual(self._task(TaskKind.DAILY_LOADING, MONDAY).state, TaskState.DONE)
        self.assertEqual(self._task(TaskKind.DAILY_EXPORT, MONDAY).state, TaskState.OPEN)

    def test_export_done_needs_country_customer_and_packing(self):
        generate_daily_plan_tasks(MONDAY)
        self._shipment(MONDAY, country=self.country)      # no customer yet
        resolve_daily_plan_tasks()
        self.assertEqual(self._task(TaskKind.DAILY_EXPORT, MONDAY).state, TaskState.OPEN)
        part = self._shipment(MONDAY, country=self.country, customer=self.customer)
        resolve_daily_plan_tasks()
        self.assertEqual(self._task(TaskKind.DAILY_EXPORT, MONDAY).state, TaskState.OPEN)
        ShipmentBlockSource.objects.create(shipment=part, block=self.block, weight_kg=1000)
        resolve_daily_plan_tasks()
        self.assertEqual(self._task(TaskKind.DAILY_EXPORT, MONDAY).state, TaskState.DONE)

    def test_export_waits_until_every_planned_truck_is_opened(self):
        self._plan(MONDAY, 2)
        generate_daily_plan_tasks(MONDAY)
        self._truck(MONDAY, country=self.country, customer=self.customer)
        resolve_daily_plan_tasks()
        self.assertEqual(self._task(TaskKind.DAILY_EXPORT, MONDAY).state, TaskState.OPEN)
        self._truck(MONDAY, country=self.country, customer=self.customer)
        resolve_daily_plan_tasks()
        self.assertEqual(self._task(TaskKind.DAILY_EXPORT, MONDAY).state, TaskState.DONE)

    def test_loading_waits_for_the_plan_even_when_packing_comes_first(self):
        self._plan(MONDAY, 2)
        generate_daily_plan_tasks(MONDAY)
        self._truck(MONDAY)                                # free packing, no export part yet
        resolve_daily_plan_tasks()
        self.assertEqual(self._task(TaskKind.DAILY_LOADING, MONDAY).state, TaskState.OPEN)
        self._truck(MONDAY)
        resolve_daily_plan_tasks()
        self.assertEqual(self._task(TaskKind.DAILY_LOADING, MONDAY).state, TaskState.DONE)

    def test_loading_target_grows_with_export_parts_above_plan(self):
        self._plan(MONDAY, 1)
        generate_daily_plan_tasks(MONDAY)
        self._shipment(MONDAY, country=self.country, customer=self.customer)
        self._shipment(MONDAY, country=self.country, customer=self.customer)
        self._truck(MONDAY)
        resolve_daily_plan_tasks()
        self.assertEqual(self._task(TaskKind.DAILY_LOADING, MONDAY).state, TaskState.OPEN)

    def test_resolver_computes_each_day_once_and_hands_it_back(self):
        generate_daily_plan_tasks(MONDAY)                 # two open tasks, same day
        cache = {}
        with mock.patch(
            'apps.export.services.daily_plan_tasks.day_progress',
            wraps=daily_progress_module.day_progress,
        ) as spy:
            resolve_daily_plan_tasks(cache)
        self.assertEqual(spy.call_count, 1)
        self.assertEqual(list(cache), [MONDAY])

    def test_deleted_cancelled_archived_or_other_day_do_not_count(self):
        generate_daily_plan_tasks(MONDAY)
        self._truck(MONDAY, deleted_at=end_of_local_day(MONDAY))
        self._truck(MONDAY, status='cancelled')
        self._truck(MONDAY, is_archived=True)
        self._truck(TUESDAY)
        resolve_daily_plan_tasks()
        self.assertEqual(self._task(TaskKind.DAILY_LOADING, MONDAY).state, TaskState.OPEN)

    def test_next_morning_leftover_is_missed(self):
        run_daily_plan_tasks(MONDAY)
        run_daily_plan_tasks(TUESDAY)
        monday = self._task(TaskKind.DAILY_EXPORT, MONDAY)
        self.assertEqual(monday.state, TaskState.CANCELLED)
        self.assertEqual(monday.cancelled_reason, TaskCancelReason.MISSED)
        self.assertEqual(self._task(TaskKind.DAILY_EXPORT, TUESDAY).state, TaskState.OPEN)
        self.assertEqual(cancel_missed_daily_tasks(TUESDAY), 0)

    def test_late_record_rescues_yesterday_before_missed(self):
        generate_daily_plan_tasks(MONDAY)
        self._truck(MONDAY)                               # added late Monday night
        run_daily_plan_tasks(TUESDAY)
        self.assertEqual(self._task(TaskKind.DAILY_LOADING, MONDAY).state, TaskState.DONE)

    def test_saturday_leftover_is_missed_on_sunday(self):
        run_daily_plan_tasks(SATURDAY)
        run_daily_plan_tasks(SUNDAY)
        self.assertEqual(self._task(TaskKind.DAILY_LOADING, SATURDAY).state, TaskState.CANCELLED)
        self.assertFalse(Task.objects.filter(scope_date=SUNDAY).exists())

    def test_deputy_sees_the_loading_task_and_me_tasks_resolves_it(self):
        generate_daily_plan_tasks(MONDAY)
        self._truck(MONDAY)
        client = APIClient()
        client.force_authenticate(self.deputy)
        resp = client.get('/api/v1/me/tasks/')
        self.assertEqual(resp.status_code, 200, resp.content)
        rows = resp.data['results'] if isinstance(resp.data, dict) else resp.data
        loading = self._task(TaskKind.DAILY_LOADING, MONDAY)
        self.assertEqual(loading.state, TaskState.DONE)
        self.assertIn(loading.id, [r['id'] for r in rows])

    def test_beat_entry_names_a_registered_task(self):
        from django.conf import settings

        from config.celery import app

        app.loader.import_default_modules()
        self.assertIn(settings.CELERY_BEAT_SCHEDULE['daily-plan-tasks']['task'], app.tasks)
