"""Tests for the harvest forecast dispatcher and service computation helpers.

NOTE ON MSSQL TEST RUNNER:
These tests are written to avoid MSSQL-specific issues where possible. Pure-function
tests (compute_plan_state, compute_forecast_window, evaluate_triggers) use mocks and
do not require a test database. DB-touching tests (test_fire_idempotent,
test_dispatcher_skips_holiday) require a live test database and will be skipped
automatically if MSSQL test DB creation fails (which requires a separate test runner
setup — see docs/operations/cron.md).

Usage:
    python manage.py test apps.greenhouse.tests.test_dispatcher --verbosity=2
"""
import unittest
from datetime import date, datetime, time as dtime
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from apps.greenhouse.dispatcher import (
    TriggerEvent,
    _is_operating_day,
    _is_plan_deadline_day,
    _is_plan_late_day,
    _next_plan_week_start,
    _within_5min,
    evaluate_triggers,
    fire,
)
from apps.greenhouse.services.harvest_day_service import (
    compute_forecast_window,
    compute_plan_state,
)


# ---------------------------------------------------------------------------
# Config stub used across multiple tests
# ---------------------------------------------------------------------------

def _make_config(**overrides):
    """Return a SimpleNamespace mimicking GreenhouseConfig with sensible defaults."""
    defaults = dict(
        plan_deadline_weekday=4,          # Friday
        plan_late_until_weekday=6,        # Sunday
        plan_critical_late_at_weekday=0,  # Monday
        plan_critical_late_at_time=dtime(0, 0),
        forecast_primary_open=dtime(17, 0),
        forecast_primary_close=dtime(18, 0),
        forecast_fallback_close=dtime(9, 0),
        forecast_same_day_close=dtime(23, 59),
        notification_lead_minutes=60,
        operating_days_bitmask=0b0111111,  # Mon–Sat
        timezone_name='Asia/Ashgabat',
    )
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


# ---------------------------------------------------------------------------
# 1. compute_plan_state tests
# ---------------------------------------------------------------------------

class TestComputePlanState(unittest.TestCase):
    """Tests for compute_plan_state() pure function."""

    def setUp(self):
        self.config = _make_config()
        # Plan week: W20/2025 starts Monday 2025-05-12
        self.plan_week_start = date(2025, 5, 12)  # Monday

    def test_compute_plan_state_on_time(self):
        """Submitted Wednesday 2025-05-07 (before Friday EOD) → on_time."""
        submitted_at = datetime(2025, 5, 7, 15, 0, 0)  # Wednesday 15:00
        result = compute_plan_state(submitted_at, self.plan_week_start, self.config)
        self.assertEqual(result, 'on_time')

    def test_compute_plan_state_late(self):
        """Submitted Saturday 2025-05-10 → late."""
        submitted_at = datetime(2025, 5, 10, 10, 0, 0)  # Saturday 10:00
        result = compute_plan_state(submitted_at, self.plan_week_start, self.config)
        self.assertEqual(result, 'late')

    def test_compute_plan_state_critical_late(self):
        """Submitted Monday 2025-05-12 00:00 (plan week start) → critical_late."""
        submitted_at = datetime(2025, 5, 12, 0, 0, 0)  # Monday 00:00
        result = compute_plan_state(submitted_at, self.plan_week_start, self.config)
        self.assertEqual(result, 'critical_late')

    def test_submitted_friday_eod_is_on_time(self):
        """Submitted Friday 23:59:59 (deadline day EOD) → on_time."""
        submitted_at = datetime(2025, 5, 9, 23, 59, 59)  # Friday EOD
        result = compute_plan_state(submitted_at, self.plan_week_start, self.config)
        self.assertEqual(result, 'on_time')

    def test_submitted_sunday_eod_is_late(self):
        """Submitted Sunday 23:59:59 (one day before plan week) → late."""
        submitted_at = datetime(2025, 5, 11, 23, 59, 59)  # Sunday EOD
        result = compute_plan_state(submitted_at, self.plan_week_start, self.config)
        self.assertEqual(result, 'late')


# ---------------------------------------------------------------------------
# 2. compute_forecast_window tests
# ---------------------------------------------------------------------------

class TestComputeForecastWindow(unittest.TestCase):
    """Tests for compute_forecast_window() pure function."""

    def setUp(self):
        self.config = _make_config()
        self.entry_date = date(2025, 5, 12)  # Monday — the date the forecast is FOR

    def test_compute_forecast_window_primary(self):
        """Submitted day-before between 17:00 and 18:00 → primary."""
        submitted_at = datetime(2025, 5, 11, 17, 30, 0)  # Sunday 17:30
        result = compute_forecast_window(submitted_at, self.entry_date, self.config)
        self.assertEqual(result, 'primary')

    def test_compute_forecast_window_fallback(self):
        """Submitted between 18:00 day-before and 09:00 day-of → fallback."""
        submitted_at = datetime(2025, 5, 11, 18, 30, 0)  # Sunday 18:30
        result = compute_forecast_window(submitted_at, self.entry_date, self.config)
        self.assertEqual(result, 'fallback')

    def test_compute_forecast_window_same_day_red_flag(self):
        """Submitted between 09:00 and 23:59 day-of → same_day_red_flag."""
        submitted_at = datetime(2025, 5, 12, 10, 0, 0)  # Monday 10:00
        result = compute_forecast_window(submitted_at, self.entry_date, self.config)
        self.assertEqual(result, 'same_day_red_flag')

    def test_compute_forecast_window_locked(self):
        """Submitted day-after → None (locked)."""
        submitted_at = datetime(2025, 5, 13, 8, 0, 0)  # Tuesday 08:00
        result = compute_forecast_window(submitted_at, self.entry_date, self.config)
        self.assertIsNone(result)

    def test_compute_forecast_window_exactly_at_primary_open(self):
        """Submitted exactly at 17:00 day-before → primary (boundary inclusive)."""
        submitted_at = datetime(2025, 5, 11, 17, 0, 0)
        result = compute_forecast_window(submitted_at, self.entry_date, self.config)
        self.assertEqual(result, 'primary')

    def test_compute_forecast_window_exactly_at_primary_close(self):
        """Submitted exactly at 18:00 day-before → fallback (primary close is exclusive)."""
        submitted_at = datetime(2025, 5, 11, 18, 0, 0)
        result = compute_forecast_window(submitted_at, self.entry_date, self.config)
        self.assertEqual(result, 'fallback')


# ---------------------------------------------------------------------------
# 3. _within_5min helper
# ---------------------------------------------------------------------------

class TestWithin5Min(unittest.TestCase):

    def test_exactly_at_target(self):
        target = datetime(2025, 5, 12, 17, 0, 0)
        self.assertTrue(_within_5min(target, target))

    def test_5min_before_target(self):
        target = datetime(2025, 5, 12, 17, 0, 0)
        now = datetime(2025, 5, 12, 16, 55, 0)
        self.assertTrue(_within_5min(now, target))

    def test_6min_before_target(self):
        target = datetime(2025, 5, 12, 17, 0, 0)
        now = datetime(2025, 5, 12, 16, 54, 0)
        self.assertFalse(_within_5min(now, target))

    def test_after_target(self):
        target = datetime(2025, 5, 12, 17, 0, 0)
        now = datetime(2025, 5, 12, 17, 1, 0)
        self.assertFalse(_within_5min(now, target))


# ---------------------------------------------------------------------------
# 4. evaluate_triggers — T1 with mocked DB queries
# ---------------------------------------------------------------------------

class TestEvaluateTriggersT1(unittest.TestCase):
    """Test T1 event generation with mocked ORM calls."""

    def _make_assignment(self, user_id: int, block_code: str):
        """Build a fake BlockManagerAssignment-like object."""
        asn = MagicMock()
        asn.user_id = user_id
        asn.block.code = block_code
        asn.has_forecast = False
        return asn

    @patch('apps.greenhouse.dispatcher._is_operating_day', return_value=True)
    @patch('apps.greenhouse.dispatcher._compute_t2', return_value=[])
    @patch('apps.greenhouse.dispatcher._compute_t3', return_value=[])
    @patch('apps.greenhouse.dispatcher._compute_t1')
    def test_evaluate_triggers_t1_fires_when_managers_have_missing_forecasts(
        self, mock_t1, mock_t3, mock_t2, mock_operating
    ):
        """evaluate_triggers calls _compute_t1 when now aligns with T1 window."""
        config = _make_config()
        # Now = 16:00 (T1 fires at 17:00 - 60min = 16:00)
        now_local = datetime(2025, 5, 11, 16, 0, 0)  # Sunday 16:00

        fake_event = TriggerEvent(
            kind='t1_forecast_nudge',
            target_user_id=5,
            scope_date=date(2025, 5, 12),
            notification_kind='forecast_nudge',
            message='Submit forecast for blocks A',
            link='/greenhouse/plan?date=2025-05-12',
        )
        mock_t1.return_value = [fake_event]

        events = evaluate_triggers(now_local, config)

        mock_t1.assert_called_once()
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].kind, 't1_forecast_nudge')
        self.assertEqual(events[0].target_user_id, 5)


# ---------------------------------------------------------------------------
# 5. evaluate_triggers — no triggers outside windows
# ---------------------------------------------------------------------------

class TestEvaluateTriggersNoOp(unittest.TestCase):

    @patch('apps.greenhouse.dispatcher._is_operating_day', return_value=True)
    def test_no_events_at_noon(self, mock_operating):
        """No triggers fire at noon (not aligned to any boundary)."""
        config = _make_config()
        # Tuesday 12:00 — no trigger boundaries here
        now_local = datetime(2025, 5, 13, 12, 0, 0)  # Tuesday
        events = evaluate_triggers(now_local, config)
        self.assertEqual(events, [])


# ---------------------------------------------------------------------------
# 5b. evaluate_triggers — P3 fires on Monday at plan_critical_late_at_time
# ---------------------------------------------------------------------------

class TestEvaluateTriggersP3(unittest.TestCase):
    """Test P3 event generation with mocked ORM calls."""

    @patch('apps.greenhouse.dispatcher._is_operating_day', return_value=True)
    @patch('apps.greenhouse.dispatcher._compute_t1', return_value=[])
    @patch('apps.greenhouse.dispatcher._compute_t2', return_value=[])
    @patch('apps.greenhouse.dispatcher._compute_t3', return_value=[])
    @patch('apps.greenhouse.dispatcher._compute_p1', return_value=[])
    @patch('apps.greenhouse.dispatcher._compute_p2', return_value=[])
    @patch('apps.greenhouse.dispatcher._compute_p3')
    def test_p3_fires_on_monday_at_midnight(
        self, mock_p3, mock_p2, mock_p1, mock_t3, mock_t2, mock_t1, mock_operating
    ):
        """P3 fires on Monday at plan_critical_late_at_time (default 00:00).

        today IS the plan week start on Monday — evaluate_triggers passes today
        directly to _compute_p3, not _next_plan_week_start(today) which would
        return next Monday.
        """
        config = _make_config()
        # Monday 2025-05-12 00:00 — exactly at plan_critical_late_at_time (00:00)
        now_local = datetime(2025, 5, 12, 0, 0, 0)
        today = date(2025, 5, 12)  # Monday

        fake_event = TriggerEvent(
            kind='p3_plan_critical_late',
            target_user_id=7,
            scope_date=today,
            notification_kind='plan_critical_late',
            message='CRITICAL: plan still missing — W20/2025 blocks A, B',
            link='/greenhouse/plan?week=20&year=2025',
        )
        mock_p3.return_value = [fake_event]

        events = evaluate_triggers(now_local, config)

        # P3 must be called with today (Monday) as plan_week_start, not next Monday
        mock_p3.assert_called_once_with(today, config)
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].kind, 'p3_plan_critical_late')

    @patch('apps.greenhouse.dispatcher._is_operating_day', return_value=True)
    @patch('apps.greenhouse.dispatcher._compute_p3')
    def test_p3_does_not_fire_on_tuesday(self, mock_p3, mock_operating):
        """P3 does NOT fire on Tuesday — weekday check prevents it."""
        config = _make_config()
        # Tuesday 2025-05-13 00:00 — same time but wrong weekday
        now_local = datetime(2025, 5, 13, 0, 0, 0)

        evaluate_triggers(now_local, config)

        mock_p3.assert_not_called()

    @patch('apps.greenhouse.dispatcher._is_operating_day', return_value=True)
    @patch('apps.greenhouse.dispatcher._compute_p3')
    def test_p3_does_not_fire_at_wrong_time_on_monday(self, mock_p3, mock_operating):
        """P3 does NOT fire on Monday at 12:00 — outside the 5-minute window around 00:00."""
        config = _make_config()
        # Monday 12:00 — P3 window is 00:00 ± 5min
        now_local = datetime(2025, 5, 12, 12, 0, 0)

        evaluate_triggers(now_local, config)

        mock_p3.assert_not_called()


# ---------------------------------------------------------------------------
# 6. fire() idempotency — uses Django TestCase for DB
# ---------------------------------------------------------------------------

try:
    from django.test import TestCase as DjangoTestCase

    class TestFireIdempotent(DjangoTestCase):
        """Verify that firing the same TriggerEvent twice only creates one row each."""

        @classmethod
        def setUpTestData(cls):
            from apps.core.models import User
            cls.user = User.objects.create_user(
                username='test_dispatcher_user',
                password='testpass',
                role='greenhouse_manager',
            )

        def test_fire_idempotent(self):
            """Second fire() call returns False; only one log + notification row exist."""
            from apps.export.models import Notification
            from apps.greenhouse.models import HarvestDispatchLog

            ev = TriggerEvent(
                kind='t1_forecast_nudge',
                target_user_id=self.user.id,
                scope_date=date(2025, 5, 12),
                notification_kind='forecast_nudge',
                message='test message',
                link='/test',
            )

            result1 = fire(ev)
            result2 = fire(ev)

            self.assertTrue(result1, "First fire() should return True")
            self.assertFalse(result2, "Second fire() should return False (already fired)")

            log_count = HarvestDispatchLog.objects.filter(
                trigger_kind=ev.kind,
                target_user_id=ev.target_user_id,
                scope_date=ev.scope_date,
            ).count()
            notif_count = Notification.objects.filter(
                user_id=ev.target_user_id,
                kind=ev.notification_kind,
            ).count()

            self.assertEqual(log_count, 1, "Exactly one HarvestDispatchLog row expected")
            self.assertEqual(notif_count, 1, "Exactly one Notification row expected")

except Exception:
    # MSSQL test DB creation may fail in some environments. Skip gracefully.
    class TestFireIdempotent(unittest.TestCase):  # type: ignore[no-redef]
        def test_fire_idempotent(self):
            self.skipTest("Django TestCase not available (MSSQL test DB issue)")


# ---------------------------------------------------------------------------
# 7. dispatcher skips holiday — uses Django TestCase for DB
# ---------------------------------------------------------------------------

try:
    from django.test import TestCase as DjangoTestCase

    class TestDispatcherSkipsHoliday(DjangoTestCase):
        """Verify that T1/T2/T3 triggers are skipped on holiday exceptions."""

        @classmethod
        def setUpTestData(cls):
            from apps.core.models import OperatingDayException
            cls.holiday_date = date(2025, 5, 12)  # Monday — normally operating
            OperatingDayException.objects.create(date=cls.holiday_date, is_holiday=True)

        @patch('apps.greenhouse.dispatcher._compute_t1')
        @patch('apps.greenhouse.dispatcher._compute_t2')
        @patch('apps.greenhouse.dispatcher._compute_t3')
        def test_dispatcher_skips_holiday(self, mock_t3, mock_t2, mock_t1):
            """No forecast triggers (T1/T2/T3) fire when today is a holiday."""
            config = _make_config()
            # Monday 16:00 — T1 would normally fire here (17:00 - 60min lead)
            # But today is a holiday, so T1 should not be called
            now_local = datetime(2025, 5, 12, 16, 0, 0)

            events = evaluate_triggers(now_local, config)

            mock_t1.assert_not_called()
            mock_t2.assert_not_called()
            mock_t3.assert_not_called()
            # P-triggers are calendar-based (not operating-day gated), so not checked here
            self.assertIsInstance(events, list)

except Exception:
    class TestDispatcherSkipsHoliday(unittest.TestCase):  # type: ignore[no-redef]
        def test_dispatcher_skips_holiday(self):
            self.skipTest("Django TestCase not available (MSSQL test DB issue)")


# ---------------------------------------------------------------------------
# 8. _next_plan_week_start correctness
# ---------------------------------------------------------------------------

class TestNextPlanWeekStart(unittest.TestCase):
    """_next_plan_week_start always returns the next upcoming Monday.

    P1 (Friday) and P2 (Saturday) use this to identify which week's plan is due.
    P3 fires on Monday itself, so it does NOT call this function — it passes
    `today` directly to _compute_p3(). See evaluate_triggers() for details.
    """

    def test_from_monday(self):
        """From Monday, returns NEXT Monday (today + 7).

        This is correct for _next_plan_week_start — P3 does not use this function;
        it uses today directly because today IS the plan week start.
        """
        today = date(2025, 5, 12)  # Monday
        result = _next_plan_week_start(today)
        self.assertEqual(result, date(2025, 5, 19))  # next Monday (+7)

    def test_from_friday(self):
        """From Friday (deadline day), plan week starts next Monday."""
        today = date(2025, 5, 9)   # Friday
        result = _next_plan_week_start(today)
        self.assertEqual(result, date(2025, 5, 12))  # Monday

    def test_from_saturday(self):
        """From Saturday (late day), plan week starts next Monday."""
        today = date(2025, 5, 10)  # Saturday
        result = _next_plan_week_start(today)
        self.assertEqual(result, date(2025, 5, 12))  # Monday

    def test_from_sunday(self):
        """From Sunday, next plan week starts next Monday."""
        today = date(2025, 5, 11)  # Sunday
        result = _next_plan_week_start(today)
        self.assertEqual(result, date(2025, 5, 12))  # Monday


# ---------------------------------------------------------------------------
# 9. _is_operating_day — bitmask logic (mocked OperatingDayException query)
# ---------------------------------------------------------------------------

class TestIsOperatingDay(unittest.TestCase):
    # OperatingDayException is imported inside the function body in dispatcher.py,
    # so we must patch it at the source module, not at the dispatcher module.

    @patch('apps.core.models.OperatingDayException')
    def test_monday_is_operating_default(self, mock_ode):
        """Monday (bit 0 = 1 in default 0b0111111) → operating."""
        mock_ode.objects.filter.return_value.exists.return_value = False
        config = _make_config()
        monday = date(2025, 5, 12)  # weekday() = 0
        self.assertTrue(_is_operating_day(monday, config))

    @patch('apps.core.models.OperatingDayException')
    def test_sunday_not_operating_default(self, mock_ode):
        """Sunday (bit 6 = 0 in default 0b0111111) → not operating."""
        mock_ode.objects.filter.return_value.exists.return_value = False
        config = _make_config()
        sunday = date(2025, 5, 11)  # weekday() = 6
        self.assertFalse(_is_operating_day(sunday, config))

    @patch('apps.core.models.OperatingDayException')
    def test_monday_holiday_not_operating(self, mock_ode):
        """Monday that is a holiday → not operating."""
        mock_ode.objects.filter.return_value.exists.return_value = True
        config = _make_config()
        monday = date(2025, 5, 12)
        self.assertFalse(_is_operating_day(monday, config))
