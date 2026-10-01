"""Plan vs fact for a day — services/daily_progress.py.

Spec: docs/superpowers/specs/2026-10-01-daily-plan-progress-tasks-design.md.

Run:
    python manage.py test apps.export.tests_daily_progress --keepdb --noinput
"""
import datetime

from django.test import TestCase
from django.utils import timezone

from apps.core.models import (
    Country, Customer, GreenhouseBlock, GreenhouseConfig, Season, ShipmentStatusType,
    TruckDestination, User,
)
from apps.export.models import (
    Shipment, ShipmentBlockSource, TruckDestinationSplit, WeeklyTruckAllocation,
)
from apps.export.services.daily_progress import (
    DayProgress, ProgressRow, day_progress, export_done, loading_done, progress_payload,
    week_progress,
)

MONDAY = datetime.date(2026, 9, 28)     # ISO 2026-W40-1
TUESDAY = datetime.date(2026, 9, 29)
WEDNESDAY = datetime.date(2026, 9, 30)
SATURDAY = datetime.date(2026, 10, 3)


class DayProgressTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        GreenhouseConfig.get_solo()
        Season.objects.update(is_active=False)
        cls.season = Season.objects.create(
            name='dp', start_date='2026-08-01', end_date='2027-06-30', is_active=True,
        )
        for code, order, phase in [('draft', 0, 'DRAFT'), ('cancelled', 99, 'CANCELLED')]:
            ShipmentStatusType.objects.get_or_create(
                code=code,
                defaults={'name_tk': code, 'name_en': code, 'name_ru': code,
                          'step_order': order, 'phase': phase},
            )
        cls.user = User.objects.create_user(username='dp_em', password='pw', role='export_manager')
        cls.block = GreenhouseBlock.objects.create(code='DP-A', name='A', is_active=True)
        cls.ru = Country.objects.create(name_tk='Russiýa', name_en='Russia', code='XR')
        cls.kz = Country.objects.create(name_tk='Gazagystan', name_en='Kazakhstan', code='XK')
        cls.customer = Customer.objects.create(name='DP customer')
        cls.moskwa = TruckDestination.objects.create(name='Moskwa', country=cls.ru, sort_order=1)
        cls.piter = TruckDestination.objects.create(name='Piter', country=cls.ru, sort_order=2)
        cls.almaty = TruckDestination.objects.create(name='Almaty', country=cls.kz, sort_order=3)
        cls.gapy = TruckDestination.objects.create(name='Gapy Satys', country=None, sort_order=4)

    def setUp(self):
        self.n = 0

    def _plan(self, day, counts, season=None):
        year, week, dow = day.isocalendar()
        alloc = WeeklyTruckAllocation.objects.create(
            season=season or self.season, year=year, week_number=week, day_of_week=dow,
        )
        for dest, n in counts.items():
            TruckDestinationSplit.objects.create(truck_allocation=alloc, destination=dest, truck_count=n)

    def _ship(self, day, country=None, customer=None, packed=False, status='draft', season=None, **extra):
        self.n += 1
        s = Shipment.objects.create(
            shipment_code=f'DP-{self.n}', date=day, season=season or self.season,
            status=ShipmentStatusType.objects.get(code=status), country=country, customer=customer,
            created_by=self.user, updated_by=self.user, **extra,
        )
        if packed:
            ShipmentBlockSource.objects.create(shipment=s, block=self.block, weight_kg=1000)
        return s

    def _part(self, day, country, **extra):
        return self._ship(day, country=country, customer=self.customer, **extra)

    def _row(self, progress, key):
        return next(r for r in progress.rows if r.key == key)

    def test_two_destinations_of_one_country_sum_into_one_row(self):
        self._plan(MONDAY, {self.moskwa: 2, self.piter: 1})
        p = day_progress(MONDAY, self.season)
        row = self._row(p, f'country:{self.ru.id}')
        self.assertEqual((row.plan, row.label, row.is_gapy), (3, 'Moskwa + Piter', False))
        self.assertEqual(len(p.rows), 1)

    def test_gapy_row_counts_gapy_shipments_of_any_country(self):
        self._plan(MONDAY, {self.gapy: 1, self.almaty: 1})
        self._part(MONDAY, self.kz, is_gapy_satys=True)
        p = day_progress(MONDAY, self.season)
        self.assertEqual(self._row(p, 'gapy').fact, 1)
        self.assertEqual(self._row(p, f'country:{self.kz.id}').fact, 0)

    def test_country_outside_the_plan_gets_a_zero_plan_row(self):
        self._plan(MONDAY, {self.almaty: 1})
        self._part(MONDAY, self.ru)
        row = self._row(day_progress(MONDAY, self.season), f'country:{self.ru.id}')
        self.assertEqual((row.plan, row.fact, row.label), (0, 1, 'Russia'))

    def test_dead_incomplete_and_other_day_shipments_do_not_count(self):
        self._part(MONDAY, self.ru, deleted_at=timezone.now(), packed=True)
        self._part(MONDAY, self.ru, status='cancelled', packed=True)
        self._part(MONDAY, self.ru, is_archived=True, packed=True)
        self._part(TUESDAY, self.ru, packed=True)
        self._ship(MONDAY, country=self.ru)                     # no customer yet
        p = day_progress(MONDAY, self.season)
        self.assertEqual((p.export_parts, p.packed), (0, 0))

    def test_free_and_joined_packing_both_count_as_packed(self):
        self._ship(MONDAY, packed=True)                          # free packing
        self._part(MONDAY, self.ru, packed=True)                 # joined
        self._part(MONDAY, self.ru)                              # waits for packing
        p = day_progress(MONDAY, self.season)
        self.assertEqual((p.packed, p.export_parts, p.export_parts_packed), (2, 2, 1))

    def test_packing_joined_to_another_days_part_counts_on_that_day(self):
        self._part(TUESDAY, self.ru, packed=True)
        self.assertEqual(day_progress(MONDAY, self.season).packed, 0)
        self.assertEqual(day_progress(TUESDAY, self.season).packed, 1)

    def test_loading_target_is_the_larger_of_plan_and_export_parts(self):
        self._plan(MONDAY, {self.almaty: 3})
        self._part(MONDAY, self.kz)
        self.assertEqual(day_progress(MONDAY, self.season).loading_target, 3)
        self._plan(TUESDAY, {self.almaty: 1})
        self._part(TUESDAY, self.kz)
        self._part(TUESDAY, self.kz)
        self.assertEqual(day_progress(TUESDAY, self.season).loading_target, 2)

    def test_other_season_rows_do_not_count(self):
        old = Season.objects.create(name='dp-old', start_date='2025-08-01', end_date='2026-06-30')
        self._plan(MONDAY, {self.almaty: 2}, season=old)
        self._part(MONDAY, self.kz, season=old)
        p = day_progress(MONDAY, self.season)
        self.assertEqual((p.rows, p.export_parts), ([], 0))

    def test_no_season_is_an_empty_day(self):
        self._part(MONDAY, self.kz, packed=True)
        p = day_progress(MONDAY, None)
        self.assertEqual((p.rows, p.export_parts, p.packed, p.loading_target), ([], 0, 0, 0))

    def test_week_is_monday_to_saturday_of_the_iso_week(self):
        self._plan(TUESDAY, {self.almaty: 2})
        week = week_progress(WEDNESDAY, self.season)
        self.assertEqual(week[0].date, MONDAY)
        self.assertEqual(week[-1].date, SATURDAY)
        self.assertEqual(len(week), 6)
        self.assertEqual(week[1].plan_total, 2)
        self.assertEqual(week[0].plan_total, 0)

    def test_payload_is_plain_json_ints(self):
        self._plan(MONDAY, {self.almaty: 1})
        payload = progress_payload(day_progress(MONDAY, self.season))
        self.assertEqual(payload['date'], '2026-09-28')
        self.assertEqual(payload['day_of_week'], 1)
        self.assertEqual(payload['rows'][0], {
            'key': f'country:{self.kz.id}', 'label': 'Almaty', 'country_id': self.kz.id,
            'is_gapy': False, 'plan': 1, 'fact': 0,
        })


def _day(rows=(), export_parts=0, export_parts_packed=0, packed=0, loading_target=0):
    rows = list(rows)
    return DayProgress(
        date=MONDAY, rows=rows, plan_total=sum(r.plan for r in rows), export_parts=export_parts,
        export_parts_packed=export_parts_packed, packed=packed, loading_target=loading_target,
    )


def _r(plan, fact, key='country:1'):
    return ProgressRow(key=key, label=key, country_id=None, is_gapy=False, plan=plan, fact=fact)


class DoneRuleTests(TestCase):
    def test_export_needs_every_row_met_every_part_packed_and_one_part(self):
        self.assertFalse(export_done(_day()))
        self.assertFalse(export_done(_day([_r(2, 1)], export_parts=1, export_parts_packed=1)))
        self.assertFalse(export_done(_day([_r(1, 1)], export_parts=1, export_parts_packed=0)))
        self.assertTrue(export_done(_day([_r(1, 1), _r(0, 1, 'country:2')], export_parts=2, export_parts_packed=2)))

    def test_loading_needs_target_and_one_truck(self):
        self.assertFalse(loading_done(_day(packed=0, loading_target=0)))
        self.assertFalse(loading_done(_day(packed=2, loading_target=3)))
        self.assertTrue(loading_done(_day(packed=1, loading_target=0)))
        self.assertTrue(loading_done(_day(packed=3, loading_target=3)))
