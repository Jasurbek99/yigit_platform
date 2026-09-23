"""build_gaplama_board() — the FIFO carry-over calculation.

Covers the 9 scenarios from the Gaplama Screen plan's Task 2 brief plus a
query-count regression test. Season/ShipmentStatusType/GreenhouseBlock
fixtures follow the pattern already used in tests_draft_promote.py (direct
ORM creation, ShipmentStatusType seeded inline per test class since
DJANGO_TESTING=true skips the seeding migrations).

Run:
    python manage.py test apps.export.tests.test_gaplama_board --keepdb
"""
from datetime import date
from decimal import Decimal

from django.test import TestCase

from apps.core.models import (
    GreenhouseBlock,
    GreenhouseConfig,
    LoadingLocation,
    Season,
    ShipmentStatusType,
)
from apps.export.models import Shipment, ShipmentBlockSource
from apps.export.services.gaplama import build_gaplama_board
from apps.greenhouse.models import HarvestDayEntry, WeeklyHarvestPlan


def _make_status(code: str, step_order: int, name_en: str) -> ShipmentStatusType:
    obj, _ = ShipmentStatusType.objects.get_or_create(
        code=code,
        defaults={
            'name_tk': code, 'name_en': name_en, 'name_ru': name_en,
            'step_order': step_order, 'phase': 'PREP',
        },
    )
    return obj


class GaplamaBoardTest(TestCase):
    def setUp(self):
        self.season = Season.objects.create(
            name='2026/27', start_date=date(2026, 9, 1), end_date=date(2027, 8, 31),
            is_active=True,
        )
        self.location = LoadingLocation.objects.create(name='Dusak')
        self.block = GreenhouseBlock.objects.create(
            code='F', name='F-Ýyladyşhana', location=self.location, is_active=True,
        )
        self.draft_status = _make_status('draft', 0, 'Draft')
        _make_status('cancelled', 99, 'Cancelled')
        GreenhouseConfig.objects.all().delete()
        self.config = GreenhouseConfig.get_solo()
        self.config.gaplama_carry_days = 2
        self.config.save()

    def _plan(self, entry_date, kg):
        iso_year, iso_week, _ = entry_date.isocalendar()
        plan, _ = WeeklyHarvestPlan.objects.get_or_create(
            season=self.season, block=self.block, week_number=iso_week, year=iso_year,
        )
        HarvestDayEntry.objects.create(
            weekly_plan=plan, season=self.season, block=self.block,
            entry_date=entry_date, weekday=entry_date.weekday(),
            plan_value=Decimal(kg),
        )

    def _truck(self, ship_date, kg, status_code='draft'):
        status = ShipmentStatusType.objects.get(code=status_code)
        shipment = Shipment.objects.create(
            shipment_code=f'T{ship_date.strftime("%m%d")}-{Shipment.objects.count()}',
            date=ship_date, season=self.season, status=status,
        )
        ShipmentBlockSource.objects.create(
            shipment=shipment, block=self.block, weight_kg=Decimal(kg),
        )
        return shipment

    def test_available_is_plan_minus_loaded(self):
        self._plan(date(2026, 9, 21), 20000)
        self._truck(date(2026, 9, 21), 12000)
        board = build_gaplama_board(date(2026, 9, 21), date(2026, 9, 21), self.season)
        row = board['days'][0]
        self.assertEqual(row['available_kg'], Decimal(8000))
        self.assertEqual(row['over_kg'], Decimal(0))

    def test_positive_remainder_carries_forward(self):
        self._plan(date(2026, 9, 21), 20000)   # Monday: 8000 will remain
        self._truck(date(2026, 9, 21), 12000)
        self._plan(date(2026, 9, 22), 5000)     # Tuesday
        board = build_gaplama_board(date(2026, 9, 21), date(2026, 9, 22), self.season)
        tuesday = next(r for r in board['days'] if r['date'] == date(2026, 9, 22))
        self.assertEqual(tuesday['carried_in_kg'], Decimal(8000))
        self.assertEqual(tuesday['available_kg'], Decimal(13000))  # 5000 + 8000

    def test_remainder_expires_after_carry_days(self):
        self._plan(date(2026, 9, 21), 20000)   # Monday: 20000 remains, carry_days=2
        # No truck at all this test — nothing consumed.
        board = build_gaplama_board(date(2026, 9, 24), date(2026, 9, 24), self.season)
        # Monday + 2 days = Wed is still live; Thu (2026-09-24) is one day past expiry.
        thursday = board['days'][0]
        self.assertEqual(thursday['carried_in_kg'], Decimal(0))

    def test_negative_never_carries(self):
        self._plan(date(2026, 9, 21), 10000)
        self._truck(date(2026, 9, 21), 15000)   # over-loaded by 5000
        self._plan(date(2026, 9, 22), 5000)
        board = build_gaplama_board(date(2026, 9, 21), date(2026, 9, 22), self.season)
        monday = next(r for r in board['days'] if r['date'] == date(2026, 9, 21))
        tuesday = next(r for r in board['days'] if r['date'] == date(2026, 9, 22))
        self.assertEqual(monday['available_kg'], Decimal(0))
        self.assertEqual(monday['over_kg'], Decimal(5000))
        self.assertEqual(tuesday['carried_in_kg'], Decimal(0))
        self.assertEqual(tuesday['available_kg'], Decimal(5000))

    def test_fifo_consumes_oldest_bucket_first(self):
        self._plan(date(2026, 9, 21), 10000)   # Monday: 10000 remains
        self._plan(date(2026, 9, 22), 10000)   # Tuesday: 10000 remains, +10000 carry-in = 20000 avail
        self._truck(date(2026, 9, 23), 15000)  # Wednesday: consumes Monday's bucket first
        self._plan(date(2026, 9, 23), 0)
        board = build_gaplama_board(date(2026, 9, 21), date(2026, 9, 23), self.season)
        wednesday = next(r for r in board['days'] if r['date'] == date(2026, 9, 23))
        # Monday's 10000 (oldest) fully consumed, then 5000 from Tuesday's bucket.
        # Remaining carry-in reaching Wednesday's available: (10000 Mon + 10000 Tue) - 15000 = 5000.
        self.assertEqual(wednesday['available_kg'], Decimal(5000))

    def test_cancelled_shipments_excluded(self):
        self._plan(date(2026, 9, 21), 20000)
        self._truck(date(2026, 9, 21), 12000, status_code='cancelled')
        board = build_gaplama_board(date(2026, 9, 21), date(2026, 9, 21), self.season)
        row = board['days'][0]
        self.assertEqual(row['loaded_kg'], Decimal(0))
        self.assertEqual(row['available_kg'], Decimal(20000))

    def test_null_kg_supply_rows_excluded(self):
        shipment = Shipment.objects.create(
            shipment_code='TESTNULL', date=date(2026, 9, 21), season=self.season,
            status=self.draft_status,
        )
        ShipmentBlockSource.objects.create(shipment=shipment, block=self.block, weight_kg=None)
        self._plan(date(2026, 9, 21), 20000)
        board = build_gaplama_board(date(2026, 9, 21), date(2026, 9, 21), self.season)
        row = board['days'][0]
        self.assertEqual(row['loaded_kg'], Decimal(0))

    def test_lookback_boundary_starts_with_zero_carry_in(self):
        # gaplama_carry_days=2. Plant a huge remainder 3 days before the window start,
        # i.e. outside even the lookback — it must not leak in as carry-in.
        self._plan(date(2026, 9, 17), 50000)   # Thursday, no truck — remains 50000
        self._plan(date(2026, 9, 21), 1000)    # Monday (window start)
        board = build_gaplama_board(date(2026, 9, 21), date(2026, 9, 21), self.season)
        monday = board['days'][0]
        self.assertEqual(monday['carried_in_kg'], Decimal(0))

    def test_trucks_list_shape(self):
        self._plan(date(2026, 9, 21), 20000)
        shipment = self._truck(date(2026, 9, 21), 12000)
        board = build_gaplama_board(date(2026, 9, 21), date(2026, 9, 21), self.season)
        self.assertEqual(len(board['trucks']), 1)
        truck = board['trucks'][0]
        self.assertEqual(truck['id'], shipment.id)
        self.assertEqual(truck['block_sources'][0]['weight_kg'], Decimal(12000))
        self.assertIsNone(truck['country'])

    def test_query_count_flat_as_trucks_grow(self):
        # 1 config lookup (GreenhouseConfig.get_solo) + 1 active-block roster +
        # 1 plan aggregate + 1 loaded aggregate + 1 trucks list (flat values() JOIN,
        # not prefetch_related, so the per-shipment block_sources ride along in the
        # same query). The brief's comment said 3 (config + block roster uncounted);
        # adjusted to 5 to match reality — see task-2-report.md.
        self._plan(date(2026, 9, 21), 100000)
        with self.assertNumQueries(5):
            build_gaplama_board(date(2026, 9, 21), date(2026, 9, 27), self.season)
        for i in range(10):
            self._truck(date(2026, 9, 21), 1000)
        with self.assertNumQueries(5):
            build_gaplama_board(date(2026, 9, 21), date(2026, 9, 27), self.season)
