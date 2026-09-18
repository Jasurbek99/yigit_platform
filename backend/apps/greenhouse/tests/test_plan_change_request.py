"""Request path of in-week plan revisions (ADR-024).

Usage:
    python manage.py test apps.greenhouse.tests.test_plan_change_request --verbosity=2
"""
from datetime import timedelta
from decimal import Decimal

from django.test import TestCase

from apps.core.models import GreenhouseConfig
from apps.export.models import Notification
from apps.greenhouse.models import PlanChangeRequest
from apps.greenhouse.services.harvest_day_service import set_plan_value
from apps.greenhouse.services.plan_change_service import request_plan_change
from apps.greenhouse.tests.plan_change_fixtures import (
    AFTER_WEEK_UTC, BEFORE_WEEK_UTC, IN_WEEK_UTC, build_world, frozen_now, make_entry,
)


class TestRouting(TestCase):
    """set_plan_value decides direct write vs. request by the week-start moment."""

    @classmethod
    def setUpTestData(cls):
        cls.w = build_world('PCR')

    def setUp(self):
        self.gm = self.w.users['greenhouse_manager']

    def test_before_week_start_a_manager_edit_writes_directly(self):
        entry = make_entry(self.w, plan_value=None)
        with frozen_now(BEFORE_WEEK_UTC):
            result = set_plan_value(entry, Decimal('10000'), self.gm)
        entry.refresh_from_db()
        self.assertIsNone(result)
        self.assertEqual(entry.plan_value, Decimal('10000'))
        self.assertFalse(entry.change_requests.exists())

    def test_in_week_a_manager_edit_becomes_a_pending_request(self):
        entry = make_entry(self.w, weekday=2, plan_value=Decimal('10000'))
        with frozen_now(IN_WEEK_UTC):
            change = set_plan_value(entry, Decimal('11000'), self.gm, 'cold snap')
        entry.refresh_from_db()
        self.assertEqual(entry.plan_value, Decimal('10000'))          # old value stays live
        self.assertEqual(entry.plan_baseline_value, Decimal('10000'))  # baseline frozen
        self.assertEqual(change.status, PlanChangeRequest.STATUS_PENDING)
        self.assertEqual(change.requested_value, Decimal('11000'))
        self.assertEqual(change.current_value, Decimal('10000'))
        self.assertEqual(change.change_pct, Decimal('10.00'))
        self.assertEqual(change.reason, 'cold snap')
        self.assertEqual(change.requested_by, self.gm)

    def test_a_past_day_of_the_current_week_is_still_revisable(self):
        """Regression for the June 2026 fix — Monday already passed on Wednesday."""
        entry = make_entry(self.w, weekday=0, plan_value=Decimal('10000'))
        with frozen_now(IN_WEEK_UTC):
            change = set_plan_value(entry, Decimal('9000'), self.gm)
        self.assertEqual(change.change_pct, Decimal('-10.00'))

    def test_a_fully_past_week_is_still_locked(self):
        entry = make_entry(self.w, plan_value=Decimal('10000'))
        with frozen_now(AFTER_WEEK_UTC), self.assertRaises(PermissionError):
            set_plan_value(entry, Decimal('10500'), self.gm)

    def test_a_late_edit_grant_goes_through_the_request_path(self):
        self.w.plan.late_edit_granted_until = AFTER_WEEK_UTC + timedelta(days=1)
        self.w.plan.save(update_fields=['late_edit_granted_until'])
        entry = make_entry(self.w, plan_value=Decimal('10000'))
        with frozen_now(AFTER_WEEK_UTC):
            change = set_plan_value(entry, Decimal('10500'), self.gm)
        self.assertEqual(change.status, PlanChangeRequest.STATUS_PENDING)


class TestBound(TestCase):
    """±plan_change_max_pct against the week-start baseline."""

    @classmethod
    def setUpTestData(cls):
        cls.w = build_world('PCB')

    def setUp(self):
        self.gm = self.w.users['greenhouse_manager']

    def test_exactly_plus_15_percent_is_allowed(self):
        entry = make_entry(self.w, plan_value=Decimal('10000'))
        self.assertEqual(request_plan_change(entry, Decimal('11500'), self.gm).change_pct, Decimal('15.00'))

    def test_exactly_minus_15_percent_is_allowed(self):
        entry = make_entry(self.w, plan_value=Decimal('10000'))
        self.assertEqual(request_plan_change(entry, Decimal('8500'), self.gm).change_pct, Decimal('-15.00'))

    def test_over_the_cap_is_refused_and_names_the_range(self):
        entry = make_entry(self.w, plan_value=Decimal('10000'))
        with self.assertRaises(ValueError) as ctx:
            request_plan_change(entry, Decimal('11501'), self.gm)
        self.assertIn('8,500–11,500', str(ctx.exception))
        self.assertFalse(entry.change_requests.exists())
        entry.refresh_from_db()
        self.assertIsNone(entry.plan_baseline_value)  # refused request freezes nothing

    def test_the_bound_is_cumulative_against_the_baseline(self):
        entry = make_entry(self.w, plan_value=Decimal('11500'), baseline=Decimal('10000'))
        with self.assertRaises(ValueError):
            request_plan_change(entry, Decimal('12000'), self.gm)

    def test_an_empty_cell_has_no_bound(self):
        entry = make_entry(self.w, plan_value=None)
        change = request_plan_change(entry, Decimal('50000'), self.gm)
        self.assertIsNone(change.change_pct)
        self.assertIsNone(change.baseline_value)

    def test_a_zero_baseline_has_no_bound_and_is_not_frozen(self):
        entry = make_entry(self.w, plan_value=Decimal('0'))
        change = request_plan_change(entry, Decimal('8000'), self.gm)
        self.assertIsNone(change.change_pct)
        entry.refresh_from_db()
        self.assertIsNone(entry.plan_baseline_value)  # re-derives from the approved value next time

    def test_the_configured_cap_is_used(self):
        config = GreenhouseConfig.get_solo()
        config.plan_change_max_pct = Decimal('10.00')
        config.save()
        entry = make_entry(self.w, plan_value=Decimal('10000'))
        with self.assertRaises(ValueError):
            request_plan_change(entry, Decimal('11100'), self.gm)


class TestLifecycle(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.w = build_world('PCL')

    def setUp(self):
        self.gm = self.w.users['greenhouse_manager']

    def test_a_second_request_supersedes_the_first(self):
        entry = make_entry(self.w, plan_value=Decimal('10000'))
        first = request_plan_change(entry, Decimal('10500'), self.gm)
        second = request_plan_change(entry, Decimal('11000'), self.gm)
        first.refresh_from_db()
        self.assertEqual(first.status, PlanChangeRequest.STATUS_SUPERSEDED)
        self.assertEqual(first.decided_by, self.gm)
        self.assertEqual(second.status, PlanChangeRequest.STATUS_PENDING)

    def test_setting_back_to_the_approved_value_withdraws(self):
        entry = make_entry(self.w, plan_value=Decimal('10000'))
        first = request_plan_change(entry, Decimal('10500'), self.gm)
        self.assertIsNone(request_plan_change(entry, Decimal('10000'), self.gm))
        first.refresh_from_db()
        self.assertEqual(first.status, PlanChangeRequest.STATUS_SUPERSEDED)
        self.assertEqual(entry.change_requests.count(), 1)

    def test_clearing_a_cell_in_week_is_refused(self):
        entry = make_entry(self.w, plan_value=Decimal('10000'))
        with self.assertRaises(ValueError):
            request_plan_change(entry, None, self.gm)

    def test_a_request_notifies_export_managers_only(self):
        entry = make_entry(self.w, plan_value=Decimal('10000'))
        request_plan_change(entry, Decimal('11000'), self.gm)
        note = Notification.objects.get(user=self.w.users['export_manager'], kind='plan_change_requested')
        self.assertIn('+10.00%', note.message)
        self.assertIn('changes=1', note.link)
        self.assertFalse(
            Notification.objects.filter(user=self.w.users['document_team'], kind='plan_change_requested').exists()
        )
