"""Helpers shared by the planning tasks (spec 2026-09-29-planning-tasks-design)."""
from datetime import date, datetime, time
from zoneinfo import ZoneInfo

from django.test import TestCase

from apps.core.models import GreenhouseConfig
from apps.export.services.plan_task_common import (
    decode_counts, encode_counts, end_of_local_day, iso_monday, next_iso_week,
)
from apps.export.services.weekly_plan_tasks import plan_deadline

TZ = ZoneInfo('Asia/Ashgabat')


class PlanTaskCommonTests(TestCase):
    def setUp(self):
        GreenhouseConfig.get_solo()

    def test_end_of_local_day_is_2359_local(self):
        self.assertEqual(
            end_of_local_day(date(2026, 9, 25)),
            datetime.combine(date(2026, 9, 25), time(23, 59, 59), tzinfo=TZ),
        )

    def test_next_iso_week_crosses_the_year(self):
        self.assertEqual(next_iso_week(date(2026, 9, 25)), (2026, 40))
        self.assertEqual(next_iso_week(date(2026, 12, 31)), (2027, 1))

    def test_iso_monday(self):
        self.assertEqual(iso_monday(2026, 40), date(2026, 9, 28))

    def test_counts_round_trip_and_canonical(self):
        counts = {(3, 7): 1, (1, 5): 2, (2, 5): 0}
        text = encode_counts(counts)
        self.assertEqual(text, '1:5:2;3:7:1')          # zeros dropped, keys sorted
        self.assertEqual(decode_counts(text), {(1, 5): 2, (3, 7): 1})
        self.assertEqual(decode_counts(''), {})
        self.assertEqual(encode_counts({(2,): 3, (1,): 1}), '1:1;2:3')

    def test_plan_deadline_is_friday_before_the_week(self):
        # Week 2026-W40 starts Mon 2026-09-28 → deadline Fri 2026-09-25 23:59:59.
        self.assertEqual(plan_deadline(2026, 40), end_of_local_day(date(2026, 9, 25)))
        # Year boundary: 2027-W1 starts Mon 2027-01-04 → Fri 2027-01-01.
        self.assertEqual(plan_deadline(2027, 1), end_of_local_day(date(2027, 1, 1)))
