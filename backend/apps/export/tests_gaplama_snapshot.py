"""Midnight snapshot of Gaplama's starting leftover (spec 2026-09-30 §5)."""
from datetime import date, timedelta
from decimal import Decimal

from django.test import TestCase

from apps.core.models import GreenhouseBlock, Season
from apps.export.models import AuditLog
from apps.export.services.gaplama_snapshot import snapshot_gaplama_leftovers
from apps.greenhouse.models import HarvestDayEntry, WeeklyHarvestPlan

MON = date(2026, 6, 1)  # a Monday
TUE, WED, THU, FRI = (MON + timedelta(days=i) for i in range(1, 5))


class SnapshotGaplamaLeftoversTests(TestCase):
    def setUp(self):
        Season.objects.update(is_active=False)
        self.season = Season.objects.create(
            name='SNAP-S',
            start_date=MON - timedelta(days=200),
            end_date=MON + timedelta(days=200),
            is_active=True,
        )
        self.block = GreenhouseBlock.objects.create(code='SNAP', carry_days=7, is_active=True)
        self._entry(MON, plan_value=Decimal('10000'))

    def _entry(self, day, **values):
        iso = day.isocalendar()
        plan, _ = WeeklyHarvestPlan.objects.get_or_create(
            season=self.season, block=self.block, week_number=iso.week, year=iso.year,
        )
        entry, _ = HarvestDayEntry.objects.get_or_create(
            weekly_plan=plan, entry_date=day,
            defaults={'season': self.season, 'block': self.block, 'weekday': day.weekday()},
        )
        for field, value in values.items():
            setattr(entry, field, value)
        entry.save()
        return entry

    def _stored(self):
        return dict(
            HarvestDayEntry.objects.filter(block=self.block)
            .values_list('entry_date', 'yesterday_rest_value')
        )

    def test_fills_today_and_the_three_days_before(self):
        self.assertEqual(snapshot_gaplama_leftovers(FRI), 4)
        stored = self._stored()
        self.assertIsNone(stored[MON])
        for day in (TUE, WED, THU, FRI):
            self.assertEqual(stored[day], Decimal('10000'), day)

    def test_hand_typed_value_survives_and_anchors_later_days(self):
        self._entry(WED, yesterday_rest_value=Decimal('500'))
        self.assertEqual(snapshot_gaplama_leftovers(FRI), 3)
        stored = self._stored()
        self.assertEqual(stored[TUE], Decimal('10000'))
        self.assertEqual(stored[WED], Decimal('500'))
        self.assertEqual(stored[THU], Decimal('500'))  # computed after WED, oldest first
        self.assertEqual(stored[FRI], Decimal('500'))

    def test_second_run_writes_nothing(self):
        snapshot_gaplama_leftovers(FRI)
        self.assertEqual(snapshot_gaplama_leftovers(FRI), 0)

    def test_stamps_no_person_and_writes_no_audit(self):
        audit_before = AuditLog.objects.count()
        snapshot_gaplama_leftovers(FRI)
        entry = HarvestDayEntry.objects.get(block=self.block, entry_date=FRI)
        self.assertIsNone(entry.daily_entered_by_id)
        self.assertIsNone(entry.daily_entered_at)
        self.assertEqual(AuditLog.objects.count(), audit_before)

    def test_no_active_season_writes_nothing(self):
        Season.objects.update(is_active=False)
        self.assertEqual(snapshot_gaplama_leftovers(FRI), 0)
        self.assertFalse(
            HarvestDayEntry.objects.filter(yesterday_rest_value__isnull=False).exists()
        )

    def test_skips_days_before_the_season_starts(self):
        self.season.start_date = WED
        self.season.save()
        self.assertEqual(snapshot_gaplama_leftovers(FRI), 3)  # WED, THU, FRI
        self.assertFalse(HarvestDayEntry.objects.filter(block=self.block, entry_date=TUE).exists())

    def test_creates_missing_rows_with_no_author(self):
        next_mon = MON + timedelta(days=7)
        self.assertEqual(snapshot_gaplama_leftovers(next_mon), 4)  # FRI..next MON
        entry = HarvestDayEntry.objects.get(block=self.block, entry_date=next_mon)
        self.assertEqual(entry.yesterday_rest_value, Decimal('10000'))  # age 7, still live
        self.assertIsNone(entry.weekly_plan.entered_by_id)
