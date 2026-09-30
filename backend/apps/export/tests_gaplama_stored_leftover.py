"""Stored leftover (HarvestDayEntry.yesterday_rest_value) anchors Gaplama's carry-in.

Spec: docs/superpowers/specs/2026-09-30-gaplama-stored-leftover-design.md §4. The stored
value on day d's row is d's starting leftover AFTER expiry — the same figure the board
reports as carried_in_kg — so an untouched midnight snapshot never changes a number.
"""
from datetime import date, timedelta
from decimal import Decimal

from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import GreenhouseBlock, Season, User
from apps.export.services.gaplama import build_gaplama_board
from apps.greenhouse.models import HarvestDayEntry, WeeklyHarvestPlan

MON = date(2026, 6, 1)  # a Monday
TUE, WED, THU, FRI = (MON + timedelta(days=i) for i in range(1, 5))


class _StoredLeftoverBase(TestCase):
    @classmethod
    def setUpTestData(cls):
        Season.objects.update(is_active=False)
        cls.season = Season.objects.create(
            name='SL-season',
            start_date=MON - timedelta(days=200),
            end_date=MON + timedelta(days=200),
            is_active=True,
        )
        cls.block = GreenhouseBlock.objects.create(code='SL', carry_days=7, is_active=True)

    def _entry(self, block, day, **values):
        iso = day.isocalendar()
        plan, _ = WeeklyHarvestPlan.objects.get_or_create(
            season=self.season, block=block, week_number=iso.week, year=iso.year,
        )
        entry, _ = HarvestDayEntry.objects.get_or_create(
            weekly_plan=plan, entry_date=day,
            defaults={'season': self.season, 'block': block, 'weekday': day.weekday()},
        )
        for field, value in values.items():
            setattr(entry, field, value)
        entry.save()
        return entry

    def _row(self, day, block=None):
        board = build_gaplama_board(day, day, self.season)
        return next(r for r in board['days'] if r['block_id'] == (block or self.block).id)


class StoredLeftoverBoardTests(_StoredLeftoverBase):
    def test_no_stored_value_leaves_the_calculation_unchanged(self):
        self._entry(self.block, MON, plan_value=Decimal('10000'))
        row = self._row(TUE)
        self.assertEqual(row['carried_in_kg'], Decimal('10000'))
        self.assertIsNone(row['rest_stored_kg'])
        self.assertEqual(row['rest_calc_kg'], Decimal('10000'))

    def test_stored_lower_comes_off_the_oldest_bucket_first(self):
        self._entry(self.block, MON, plan_value=Decimal('4000'))
        self._entry(self.block, TUE, plan_value=Decimal('6000'))
        self._entry(self.block, WED, yesterday_rest_value=Decimal('7000'))
        row = self._row(WED)
        self.assertEqual(row['carried_in_kg'], Decimal('7000'))
        self.assertEqual(row['rest_stored_kg'], Decimal('7000'))
        self.assertEqual(row['rest_calc_kg'], Decimal('10000'))
        self.assertEqual(row['carry_in_breakdown'], [
            {'origin_date': MON, 'kg': Decimal('1000'), 'age_days': 2},
            {'origin_date': TUE, 'kg': Decimal('6000'), 'age_days': 1},
        ])
        self.assertEqual(row['available_kg'], Decimal('7000'))

    def test_stored_higher_merges_into_yesterdays_bucket(self):
        self._entry(self.block, MON, plan_value=Decimal('4000'))
        self._entry(self.block, TUE, plan_value=Decimal('2000'))
        self._entry(self.block, WED, yesterday_rest_value=Decimal('7000'))
        row = self._row(WED)
        self.assertEqual(row['carried_in_kg'], Decimal('7000'))
        self.assertEqual(row['carry_in_breakdown'], [
            {'origin_date': MON, 'kg': Decimal('4000'), 'age_days': 2},
            {'origin_date': TUE, 'kg': Decimal('3000'), 'age_days': 1},
        ])

    def test_stored_higher_adds_a_bucket_dated_yesterday(self):
        self._entry(self.block, MON, plan_value=Decimal('4000'))
        self._entry(self.block, WED, yesterday_rest_value=Decimal('5000'))
        row = self._row(WED)
        self.assertEqual(row['carry_in_breakdown'], [
            {'origin_date': MON, 'kg': Decimal('4000'), 'age_days': 2},
            {'origin_date': TUE, 'kg': Decimal('1000'), 'age_days': 1},
        ])

    def test_added_surplus_expires_on_the_blocks_carry_days(self):
        short = GreenhouseBlock.objects.create(code='SL2', carry_days=2, is_active=True)
        self._entry(short, WED, yesterday_rest_value=Decimal('5000'))
        # Bucket dated TUE: age 2 on THU (live), age 3 on FRI (expired).
        self.assertEqual(self._row(THU, short)['carried_in_kg'], Decimal('5000'))
        self.assertEqual(self._row(FRI, short)['carried_in_kg'], Decimal('0'))

    def test_nightly_snapshots_never_resurrect_expired_kg(self):
        short = GreenhouseBlock.objects.create(code='SL3', carry_days=2, is_active=True)
        self._entry(short, MON, plan_value=Decimal('10000'))
        for day in (TUE, WED, THU):  # what the midnight job does, day by day
            self._entry(short, day, yesterday_rest_value=self._row(day, short)['carried_in_kg'])
        stored = dict(
            HarvestDayEntry.objects.filter(block=short, entry_date__in=[TUE, WED, THU])
            .values_list('entry_date', 'yesterday_rest_value')
        )
        self.assertEqual(stored, {TUE: Decimal('10000'), WED: Decimal('10000'), THU: Decimal('0')})
        self.assertEqual(self._row(THU, short)['carried_in_kg'], Decimal('0'))
        self.assertEqual(self._row(FRI, short)['carried_in_kg'], Decimal('0'))

    def test_stored_value_wins_over_a_later_change_to_the_past(self):
        mon = self._entry(self.block, MON, plan_value=Decimal('10000'))
        self._entry(self.block, TUE, yesterday_rest_value=Decimal('10000'))
        mon.plan_value = Decimal('6000')
        mon.save()
        row = self._row(TUE)
        self.assertEqual(row['carried_in_kg'], Decimal('10000'))
        self.assertEqual(row['rest_calc_kg'], Decimal('6000'))

    def test_stored_zero_is_an_anchor_too(self):
        self._entry(self.block, MON, plan_value=Decimal('10000'))
        self._entry(self.block, TUE, yesterday_rest_value=Decimal('0'))
        tue = self._row(TUE)
        self.assertEqual(tue['carried_in_kg'], Decimal('0'))
        self.assertEqual(tue['available_kg'], Decimal('0'))
        self.assertEqual(tue['rest_calc_kg'], Decimal('10000'))
        self.assertEqual(self._row(WED)['carried_in_kg'], Decimal('0'))


class StoredLeftoverApiTests(_StoredLeftoverBase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.client.force_authenticate(
            User.objects.create_superuser(username='su_stored_leftover', password='p'),
        )

    def test_board_sends_both_rest_fields_as_strings(self):
        self._entry(self.block, MON, plan_value=Decimal('10000'))
        self._entry(self.block, TUE, yesterday_rest_value=Decimal('7000'))
        resp = self.client.get('/api/v1/export/gaplama/board/', {
            'from_date': MON.isoformat(), 'to_date': TUE.isoformat(),
        })
        self.assertEqual(resp.status_code, 200)
        by_date = {d['date']: d for d in resp.json()['days'] if d['block_id'] == self.block.id}
        self.assertIsNone(by_date[MON.isoformat()]['rest_stored_kg'])
        self.assertEqual(by_date[TUE.isoformat()]['rest_stored_kg'], '7000.00')
        self.assertEqual(by_date[TUE.isoformat()]['rest_calc_kg'], '10000.00')
        self.assertEqual(by_date[TUE.isoformat()]['carried_in_kg'], '7000.00')
