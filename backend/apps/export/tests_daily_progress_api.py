"""GET /truck-allocations/daily-progress/, /me/tasks/ progress, gapy on create.

Spec: docs/superpowers/specs/2026-10-01-daily-plan-progress-tasks-design.md.

Run:
    python manage.py test apps.export.tests_daily_progress_api --keepdb --noinput
"""
import datetime as dt
from unittest import mock

from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core.models import (
    Country, Customer, GreenhouseConfig, Season, ShipmentStatusType, TruckDestination, User,
)
from apps.export.models import (
    Shipment, Task, TaskKind, TaskState, TruckDestinationSplit, WeeklyTruckAllocation,
)
from apps.export.services.daily_plan_tasks import generate_daily_plan_tasks

URL = '/api/v1/export/truck-allocations/daily-progress/'
MONDAY = dt.date(2026, 9, 28)
SUNDAY = dt.date(2026, 10, 4)
# 00:10 on Thu 1 Oct in Ashgabat (UTC+5) is still Wed 30 Sep in UTC.
AFTER_LOCAL_MIDNIGHT = dt.datetime(2026, 9, 30, 19, 10, tzinfo=dt.timezone.utc)


class DailyProgressApiTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        GreenhouseConfig.get_solo()
        Season.objects.update(is_active=False)
        cls.season = Season.objects.create(
            name='dpa', start_date='2026-08-01', end_date='2027-06-30', is_active=True,
        )
        ShipmentStatusType.objects.get_or_create(
            code='draft',
            defaults={'name_tk': 'draft', 'name_en': 'Draft', 'name_ru': 'Draft', 'step_order': 0, 'phase': 'DRAFT'},
        )
        cls.em = User.objects.create_user(username='dpa_em', password='pw', role='export_manager')
        cls.loading = User.objects.create_user(username='dpa_ld', password='pw', role='loading_dept_head')
        cls.rep = User.objects.create_user(username='dpa_rep', password='pw', role='sales_rep')
        cls.kz = Country.objects.create(name_tk='Gazagystan', name_en='Kazakhstan', code='XQ')
        cls.customer = Customer.objects.create(name='DPA customer')
        cls.almaty = TruckDestination.objects.create(name='Almaty', country=cls.kz, sort_order=1)
        alloc = WeeklyTruckAllocation.objects.create(season=cls.season, year=2026, week_number=40, day_of_week=1)
        TruckDestinationSplit.objects.create(truck_allocation=alloc, destination=cls.almaty, truck_count=2)

    def _client(self, user):
        client = APIClient()
        client.force_authenticate(user=user)
        return client

    def _part(self, day=MONDAY, **extra):
        n = Shipment.objects.count() + 1
        return Shipment.objects.create(
            shipment_code=f'DPA-{n}', date=day, season=self.season,
            status=ShipmentStatusType.objects.get(code='draft'),
            created_by=self.em, updated_by=self.em, **extra,
        )

    def test_week_of_six_days_with_plan_and_fact(self):
        self._part(country=self.kz, customer=self.customer)
        resp = self._client(self.loading).get(URL, {'date': '2026-09-30'})
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.data['date'], '2026-09-30')
        self.assertEqual(resp.data['days'][0]['date'], '2026-09-28')
        self.assertEqual(len(resp.data['days']), 6)
        monday = resp.data['days'][0]
        self.assertEqual(monday['rows'][0]['plan'], 2)
        self.assertEqual(monday['rows'][0]['fact'], 1)
        self.assertEqual(monday['loading_target'], 2)

    def test_no_date_means_the_servers_local_today(self):
        with mock.patch('django.utils.timezone.now', return_value=AFTER_LOCAL_MIDNIGHT):
            resp = self._client(self.em).get(URL)
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.data['date'], '2026-10-01')

    def test_sunday_returns_that_weeks_monday_to_saturday(self):
        resp = self._client(self.em).get(URL, {'date': SUNDAY.isoformat()})
        self.assertEqual(resp.data['days'][-1]['date'], '2026-10-03')
        self.assertNotIn(SUNDAY.isoformat(), [d['date'] for d in resp.data['days']])

    def test_malformed_date_is_400(self):
        resp = self._client(self.em).get(URL, {'date': '01.10.2026'})
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.data, {'error': 'date must be YYYY-MM-DD.'})

    def test_role_without_truck_allocation_view_is_403(self):
        self.assertEqual(self._client(self.rep).get(URL).status_code, 403)

    def test_closed_season_without_permission_is_403(self):
        closed = Season.objects.create(
            name='dpa-old', start_date='2025-08-01', end_date='2026-06-30', closed_at=timezone.now(),
        )
        resp = self._client(self.loading).get(URL, {'date': '2026-01-05', 'season': closed.id})
        self.assertEqual(resp.status_code, 403)

    def test_season_gap_is_an_empty_week(self):
        Season.objects.update(is_active=False)
        resp = self._client(self.em).get(URL, {'date': '2026-09-28'})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['days'], [])

    def test_gapy_part_without_country_is_not_an_export_part(self):
        self._part(is_gapy_satys=True)
        resp = self._client(self.em).get(URL, {'date': '2026-09-28'})
        self.assertEqual(resp.data['days'][0]['export_parts'], 0)

    def test_me_tasks_carries_progress_on_open_daily_tasks_only(self):
        generate_daily_plan_tasks(MONDAY)
        Task.objects.filter(kind=TaskKind.DAILY_LOADING).update(state=TaskState.DONE)
        resp = self._client(self.em).get('/api/v1/me/tasks/')
        self.assertEqual(resp.status_code, 200, resp.content)
        rows = resp.data['results'] if isinstance(resp.data, dict) else resp.data
        by_kind = {r['kind']: r for r in rows if r['kind'] in ('daily_export', 'daily_loading')}
        self.assertEqual(by_kind['daily_export']['progress']['rows'][0]['plan'], 2)
        self.assertIsNone(by_kind['daily_loading']['progress'])

    def test_create_accepts_the_gapy_flag(self):
        resp = self._client(self.em).post(
            '/api/v1/export/shipments/', {'is_draft': True, 'is_gapy_satys': True}, format='json',
        )
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertTrue(Shipment.objects.get(pk=resp.data['id']).is_gapy_satys)
