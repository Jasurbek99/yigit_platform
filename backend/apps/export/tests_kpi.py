"""Tests for Stream E KPI helpers and endpoints.

Coverage:
  - kpi_throughput: closed in window, outside window, created count, cache hit
  - kpi_cycle_time: avg_seconds computed correctly, 0 when no data
  - kpi_avg_phase_time: empty window → {}; sample data → avg per phase
  - kpi_on_time_rate: all on-time, all late, mix, no tasks, role filter
  - kpi_avg_task_duration: 0 when no tasks, correct average
  - kpi_stuck_shipments: archived excluded, terminal excluded, old status counted
  - kpi_blocked_age: empty → zeros, with tasks → stats
  - API endpoints: dashboard returns full grid, by-role respects param,
    by-phase returns map, by-shipment/:id returns per-shipment fields
  - Auth required: anonymous → 401
  - Cache hit test: kpi_throughput assertNumQueries == 0 on second call
"""
import datetime

from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core.models import Season, ShipmentStatusType, User
from apps.export.models import (
    Shipment,
    ShipmentStatusLog,
    Task,
    TaskCompletionRule,
    TaskState,
)


# ---------------------------------------------------------------------------
# Shared fixtures
# ---------------------------------------------------------------------------

def _make_user(username: str, role: str = 'export_manager') -> User:
    user = User(username=username, role=role)
    user.set_password('pass')
    user.save()
    return user


def _make_season() -> Season:
    s, _ = Season.objects.get_or_create(
        name='kpi25',
        defaults={'start_date': '2025-09-01', 'end_date': '2026-06-30', 'is_active': True},
    )
    return s


def _make_status(code: str = 'draft', step_order: int = 0) -> ShipmentStatusType:
    st, _ = ShipmentStatusType.objects.get_or_create(
        code=code,
        defaults={
            'name_tk': code,
            'name_en': code,
            'step_order': step_order,
            'phase': 'PREP',
        },
    )
    return st


def _make_done_status() -> ShipmentStatusType:
    st, _ = ShipmentStatusType.objects.get_or_create(
        code='tamamlandy',
        defaults={
            'name_tk': 'Tamamlandy',
            'name_en': 'Completed',
            'step_order': 13,
            'phase': 'CLOSE',
        },
    )
    return st


def _make_shipment(
    cargo_code: str,
    status=None,
    status_changed_at=None,
    is_archived: bool = False,
) -> Shipment:
    if status is None:
        status = _make_status()
    shipment = Shipment.objects.create(
        cargo_code=cargo_code,
        date='2026-01-15',
        season=_make_season(),
        status=status,
        status_changed_at=status_changed_at,
        is_archived=is_archived,
    )
    return shipment


def _make_task(
    shipment: Shipment,
    assignee_role: str = 'sales_rep',
    state: str = TaskState.OPEN,
    deadline=None,
    started_at=None,
    completed_at=None,
) -> Task:
    return Task.objects.create(
        shipment=shipment,
        step='draft',
        title_key='tasks.test',
        assignee_role=assignee_role,
        completion_rule=TaskCompletionRule.MANUAL_DONE,
        state=state,
        deadline=deadline,
        started_at=started_at,
        completed_at=completed_at,
    )


# ---------------------------------------------------------------------------
# kpi_throughput
# ---------------------------------------------------------------------------

class KpiThroughputTests(TestCase):

    def setUp(self):
        cache.clear()

    def test_closed_in_window_counted(self):
        """Shipments closed (tamamlandy) within the window are counted."""
        from apps.export.services.kpi import kpi_throughput
        done_status = _make_done_status()
        now = timezone.now()
        _make_shipment('TP001', status=done_status, status_changed_at=now - datetime.timedelta(days=3))
        result = kpi_throughput(window_days=7)
        self.assertEqual(result['closed_count'], 1)

    def test_closed_outside_window_not_counted(self):
        """Shipments closed outside the window are excluded from closed_count."""
        from apps.export.services.kpi import kpi_throughput
        done_status = _make_done_status()
        now = timezone.now()
        _make_shipment('TP002', status=done_status, status_changed_at=now - datetime.timedelta(days=30))
        result = kpi_throughput(window_days=7)
        self.assertEqual(result['closed_count'], 0)

    def test_created_count(self):
        """All shipments created within the window are counted."""
        from apps.export.services.kpi import kpi_throughput
        _make_shipment('TP003')
        _make_shipment('TP004')
        result = kpi_throughput(window_days=7)
        self.assertGreaterEqual(result['created_count'], 2)

    def test_cache_hit_no_queries(self):
        """Second call to kpi_throughput hits cache with zero DB queries."""
        from apps.export.services.kpi import kpi_throughput
        # Warm the cache
        kpi_throughput(window_days=7)
        # Second call must not hit the DB
        with self.assertNumQueries(0):
            kpi_throughput(window_days=7)

    def test_returns_window_days_in_result(self):
        """window_days is echoed back in the result."""
        from apps.export.services.kpi import kpi_throughput
        result = kpi_throughput(window_days=14)
        self.assertEqual(result['window_days'], 14)


# ---------------------------------------------------------------------------
# kpi_cycle_time
# ---------------------------------------------------------------------------

class KpiCycleTimeTests(TestCase):

    def setUp(self):
        cache.clear()

    def test_avg_seconds_computed_correctly(self):
        """Average cycle time is computed from created_at to status_changed_at."""
        from apps.export.services.kpi import kpi_cycle_time
        done_status = _make_done_status()
        now = timezone.now()
        # One shipment closed 2 days after creation (approx)
        shipment = _make_shipment(
            'CT001',
            status=done_status,
            status_changed_at=now - datetime.timedelta(days=1),
        )
        # Manually set created_at to 3 days ago (auto_now_add prevents direct assignment)
        Shipment.objects.filter(pk=shipment.pk).update(
            created_at=now - datetime.timedelta(days=3)
        )
        result = kpi_cycle_time(window_days=30)
        self.assertGreater(result['avg_seconds'], 0)
        self.assertGreaterEqual(result['count'], 1)

    def test_no_closed_shipments_returns_zero(self):
        """Returns avg_seconds=0 and count=0 when no closed shipments exist."""
        from apps.export.services.kpi import kpi_cycle_time
        result = kpi_cycle_time(window_days=30)
        self.assertEqual(result['avg_seconds'], 0)
        self.assertEqual(result['count'], 0)


# ---------------------------------------------------------------------------
# kpi_avg_phase_time
# ---------------------------------------------------------------------------

class KpiAvgPhaseTimeTests(TestCase):

    def setUp(self):
        cache.clear()

    def test_empty_window_returns_empty_dict(self):
        """No logs in the window → empty dict."""
        from apps.export.services.kpi import kpi_avg_phase_time
        result = kpi_avg_phase_time(window_days=1)
        self.assertIsInstance(result, dict)
        # No shipments or logs → empty
        self.assertEqual(len(result), 0)

    def test_sample_data_returns_avg_per_phase(self):
        """With two consecutive log entries, returns avg for the log entry's phase."""
        from apps.export.services.kpi import kpi_avg_phase_time
        user = _make_user('kpi_phase_user')
        draft_status = _make_status('draft', step_order=0)
        load_status = _make_status('yuklenme', step_order=1)
        shipment = _make_shipment('PHT001')
        now = timezone.now()
        # Two log entries: draft → yuklenme (30 minutes apart)
        log1 = ShipmentStatusLog.objects.create(
            shipment=shipment,
            status=draft_status,
            changed_by=user,
            comment='step1',
        )
        ShipmentStatusLog.objects.filter(pk=log1.pk).update(
            changed_at=now - datetime.timedelta(minutes=30)
        )
        log2 = ShipmentStatusLog.objects.create(
            shipment=shipment,
            status=load_status,
            changed_by=user,
            comment='step2',
        )
        ShipmentStatusLog.objects.filter(pk=log2.pk).update(
            changed_at=now - datetime.timedelta(minutes=0)
        )
        result = kpi_avg_phase_time(window_days=7)
        # draft → PREP phase; should have ~1800 seconds average
        self.assertIn('PREP', result)
        self.assertGreater(result['PREP'], 0)


# ---------------------------------------------------------------------------
# kpi_on_time_rate
# ---------------------------------------------------------------------------

class KpiOnTimeRateTests(TestCase):

    def setUp(self):
        cache.clear()

    def _shipment(self, code: str) -> Shipment:
        return _make_shipment(code)

    def test_all_on_time_returns_1(self):
        """All tasks completed before deadline → 1.0."""
        from apps.export.services.kpi import kpi_on_time_rate
        now = timezone.now()
        s = self._shipment('OT001')
        _make_task(
            s,
            state=TaskState.DONE,
            deadline=now + datetime.timedelta(hours=1),
            completed_at=now - datetime.timedelta(minutes=10),
        )
        result = kpi_on_time_rate(window_days=7)
        self.assertEqual(result, 1.0)

    def test_all_late_returns_0(self):
        """All tasks completed after deadline → 0.0."""
        from apps.export.services.kpi import kpi_on_time_rate
        now = timezone.now()
        s = self._shipment('OT002')
        _make_task(
            s,
            state=TaskState.DONE,
            deadline=now - datetime.timedelta(hours=2),
            completed_at=now - datetime.timedelta(minutes=10),
        )
        result = kpi_on_time_rate(window_days=7)
        self.assertEqual(result, 0.0)

    def test_mix_returns_fraction(self):
        """2 on-time, 2 late → 0.5."""
        from apps.export.services.kpi import kpi_on_time_rate
        now = timezone.now()
        s = self._shipment('OT003')
        for i in range(2):
            _make_task(
                s,
                state=TaskState.DONE,
                deadline=now + datetime.timedelta(hours=1),
                completed_at=now - datetime.timedelta(minutes=5),
            )
        for i in range(2):
            _make_task(
                s,
                state=TaskState.DONE,
                deadline=now - datetime.timedelta(hours=2),
                completed_at=now - datetime.timedelta(minutes=5),
            )
        result = kpi_on_time_rate(window_days=7)
        self.assertEqual(result, 0.5)

    def test_no_tasks_with_deadlines_returns_none(self):
        """No tasks with deadlines → None."""
        from apps.export.services.kpi import kpi_on_time_rate
        s = self._shipment('OT004')
        _make_task(s, state=TaskState.DONE)  # no deadline
        result = kpi_on_time_rate(window_days=7)
        self.assertIsNone(result)

    def test_role_filter_works(self):
        """Role filter scopes results to that role only."""
        from apps.export.services.kpi import kpi_on_time_rate
        now = timezone.now()
        s = self._shipment('OT005')
        # on-time for sales_rep
        _make_task(
            s,
            assignee_role='sales_rep',
            state=TaskState.DONE,
            deadline=now + datetime.timedelta(hours=1),
            completed_at=now - datetime.timedelta(minutes=5),
        )
        # late for document_team
        _make_task(
            s,
            assignee_role='document_team',
            state=TaskState.DONE,
            deadline=now - datetime.timedelta(hours=2),
            completed_at=now - datetime.timedelta(minutes=5),
        )
        # sales_rep → 1.0
        self.assertEqual(kpi_on_time_rate(role='sales_rep', window_days=7), 1.0)
        # document_team → 0.0
        self.assertEqual(kpi_on_time_rate(role='document_team', window_days=7), 0.0)


# ---------------------------------------------------------------------------
# kpi_avg_task_duration
# ---------------------------------------------------------------------------

class KpiAvgTaskDurationTests(TestCase):

    def setUp(self):
        cache.clear()

    def test_returns_zero_when_no_tasks(self):
        """Returns 0 when no tasks match."""
        from apps.export.services.kpi import kpi_avg_task_duration
        result = kpi_avg_task_duration(window_days=7)
        self.assertEqual(result, 0)

    def test_computes_average_correctly(self):
        """Computes average of started_at → completed_at correctly."""
        from apps.export.services.kpi import kpi_avg_task_duration
        now = timezone.now()
        s = _make_shipment('ATD001')
        # 2 hours task
        _make_task(
            s,
            state=TaskState.DONE,
            started_at=now - datetime.timedelta(hours=2),
            completed_at=now - datetime.timedelta(hours=0),
        )
        # 4 hours task
        _make_task(
            s,
            state=TaskState.DONE,
            started_at=now - datetime.timedelta(hours=4),
            completed_at=now - datetime.timedelta(hours=0),
        )
        result = kpi_avg_task_duration(window_days=7)
        # avg of 7200s and 14400s = 10800s
        self.assertEqual(result, 10800)


# ---------------------------------------------------------------------------
# kpi_stuck_shipments
# ---------------------------------------------------------------------------

class KpiStuckShipmentsTests(TestCase):

    def setUp(self):
        cache.clear()

    def test_stuck_shipment_counted(self):
        """A non-terminal shipment with old status_changed_at and no recent tasks is counted."""
        from apps.export.services.kpi import kpi_stuck_shipments
        old_time = timezone.now() - datetime.timedelta(days=10)
        s = _make_shipment('STUCK001', status_changed_at=old_time)
        result = kpi_stuck_shipments(threshold_days=8)
        self.assertGreaterEqual(result, 1)

    def test_archived_excluded(self):
        """Archived shipments are excluded."""
        from apps.export.services.kpi import kpi_stuck_shipments
        old_time = timezone.now() - datetime.timedelta(days=10)
        _make_shipment('STUCK002', status_changed_at=old_time, is_archived=True)
        result = kpi_stuck_shipments(threshold_days=8)
        self.assertEqual(result, 0)

    def test_terminal_excluded(self):
        """Terminal (tamamlandy) shipments are excluded."""
        from apps.export.services.kpi import kpi_stuck_shipments
        done_status = _make_done_status()
        old_time = timezone.now() - datetime.timedelta(days=10)
        _make_shipment('STUCK003', status=done_status, status_changed_at=old_time)
        result = kpi_stuck_shipments(threshold_days=8)
        self.assertEqual(result, 0)

    def test_recent_status_change_not_stuck(self):
        """Shipment with recent status_changed_at is NOT stuck."""
        from apps.export.services.kpi import kpi_stuck_shipments
        recent_time = timezone.now() - datetime.timedelta(days=2)
        _make_shipment('STUCK004', status_changed_at=recent_time)
        result = kpi_stuck_shipments(threshold_days=8)
        self.assertEqual(result, 0)


# ---------------------------------------------------------------------------
# kpi_blocked_age
# ---------------------------------------------------------------------------

class KpiBlockedAgeTests(TestCase):

    def setUp(self):
        cache.clear()

    def test_empty_returns_all_zeros(self):
        """No blocked tasks → all zeros."""
        from apps.export.services.kpi import kpi_blocked_age
        result = kpi_blocked_age()
        self.assertEqual(result, {'count': 0, 'avg_seconds': 0, 'max_seconds': 0, 'p95_seconds': 0})

    def test_with_blocked_tasks_returns_stats(self):
        """With blocked tasks, returns non-zero count and reasonable stats."""
        from apps.export.services.kpi import kpi_blocked_age
        s = _make_shipment('BA001')
        t1 = _make_task(s, state=TaskState.BLOCKED)
        t2 = _make_task(s, state=TaskState.BLOCKED)
        # Backdate created_at so age is well above 0 (bypasses auto_now_add via update)
        old_time = timezone.now() - datetime.timedelta(hours=2)
        Task.objects.filter(pk__in=[t1.pk, t2.pk]).update(created_at=old_time)
        result = kpi_blocked_age()
        self.assertEqual(result['count'], 2)
        self.assertGreater(result['avg_seconds'], 0)
        self.assertGreaterEqual(result['max_seconds'], result['avg_seconds'])
        self.assertGreaterEqual(result['p95_seconds'], 0)


# ---------------------------------------------------------------------------
# API endpoint tests
# ---------------------------------------------------------------------------

class KpiApiTests(TestCase):

    def setUp(self):
        cache.clear()
        self.user = _make_user('kpi_api_user')
        self.client = APIClient()

    def test_dashboard_requires_auth(self):
        """Anonymous request to /kpi/dashboard/ → 401."""
        resp = self.client.get('/api/v1/export/kpi/dashboard/')
        self.assertEqual(resp.status_code, 401)

    def test_dashboard_returns_full_grid(self):
        """Authenticated request returns all 7 top-level KPI keys."""
        self.client.force_authenticate(user=self.user)
        resp = self.client.get('/api/v1/export/kpi/dashboard/')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        expected_keys = {
            'throughput', 'cycle_time', 'avg_phase_time',
            'on_time_rate', 'avg_task_duration', 'stuck_shipments', 'blocked_age',
        }
        self.assertEqual(set(data.keys()), expected_keys)

    def test_by_role_requires_role_param(self):
        """Missing role param → 400."""
        self.client.force_authenticate(user=self.user)
        resp = self.client.get('/api/v1/export/kpi/by-role/')
        self.assertEqual(resp.status_code, 400)

    def test_by_role_returns_role_scoped_data(self):
        """by-role with role param returns on_time_rate and avg_task_duration."""
        self.client.force_authenticate(user=self.user)
        resp = self.client.get('/api/v1/export/kpi/by-role/?role=sales_rep')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn('on_time_rate', data)
        self.assertIn('avg_task_duration', data)
        self.assertEqual(data['role'], 'sales_rep')

    def test_by_phase_returns_phase_map(self):
        """by-phase returns avg_phase_time dict."""
        self.client.force_authenticate(user=self.user)
        resp = self.client.get('/api/v1/export/kpi/by-phase/')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn('avg_phase_time', data)
        self.assertIsInstance(data['avg_phase_time'], dict)

    def test_by_shipment_returns_per_shipment_fields(self):
        """by-shipment/:id returns shipment KPI context."""
        self.client.force_authenticate(user=self.user)
        shipment = _make_shipment('BSH001')
        resp = self.client.get(f'/api/v1/export/kpi/by-shipment/{shipment.pk}/')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn('in_phase_seconds', data)
        self.assertIn('phase', data)
        self.assertIn('cargo_code', data)

    def test_by_shipment_404_for_missing(self):
        """Non-existent shipment ID → 404."""
        self.client.force_authenticate(user=self.user)
        resp = self.client.get('/api/v1/export/kpi/by-shipment/999999/')
        self.assertEqual(resp.status_code, 404)

    def test_by_role_requires_auth(self):
        """Anonymous → 401 on by-role."""
        resp = self.client.get('/api/v1/export/kpi/by-role/?role=sales_rep')
        self.assertEqual(resp.status_code, 401)

    def test_dashboard_cached_second_call_no_queries(self):
        """Second call to /kpi/dashboard/ is served from cache (zero DB queries)."""
        self.client.force_authenticate(user=self.user)
        # Warm the endpoint cache
        self.client.get('/api/v1/export/kpi/dashboard/')
        # Second request: the endpoint-level cache returns immediately
        with self.assertNumQueries(0):
            resp = self.client.get('/api/v1/export/kpi/dashboard/')
        self.assertEqual(resp.status_code, 200)
