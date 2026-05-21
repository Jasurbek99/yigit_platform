"""Tests for the Cancel Shipment feature.

Coverage:
  1. Privileged cancel from each non-terminal status succeeds (12 statuses)
  2. Non-privileged user (sales_rep) gets 403; status unchanged
  3. Empty / whitespace-only reason returns 400; status unchanged
  4. Cancel from tamamlandy returns 400 (no edge in TRANSITIONS)
  5. OPEN + IN_PROGRESS + BLOCKED tasks auto-cancelled; DONE task untouched
  6. Auto-advance does NOT fire after cancel (cancelled has no outgoing edges)
  7. Detail serializer allowed_transitions for bardy shipment is ['satylyar'] only
  8. Cancelled shipment has empty allowed_transitions
  9. Regression: allowed_transitions for barysh_gumrugi does not raise (3-tuple bug fix)
 10. QuotaUsageRecord cleanup: 2 draft deleted, 1 approved preserved; response fields correct

Run:
    python backend/manage.py test apps.export.tests_cancel --verbosity=2
"""
import datetime

from rest_framework.test import APIClient

from django.test import TestCase
from django.utils import timezone

from apps.core.models import Season, ShipmentStatusType, User
from apps.export.models import (
    QuotaUsageRecord,
    Shipment,
    ShipmentStatusLog,
    Task,
    TaskCompletionRule,
    TaskState,
)
from apps.export.serializers import ShipmentDetailSerializer
from apps.export.services.shipment import _cancel_open_tasks, transition_to

# ---------------------------------------------------------------------------
# Test status set: 12 active statuses + tamamlandy + cancelled
# ---------------------------------------------------------------------------

#: (code, step_order, phase)
ALL_TEST_STATUSES = [
    ('draft',          0,  'DRAFT'),
    ('gumruk_girish',  1,  'CUSTOMS'),
    ('gumruk_chykysh', 2,  'CUSTOMS'),
    ('yuklenme',       3,  'LOADING'),
    ('yola_chykdy',    4,  'TRANSIT'),
    ('serhet_gechdi',  5,  'BORDER'),
    ('dest_entry',     6,  'BORDER'),
    ('barysh_gumrugi', 7,  'BORDER'),
    ('transshipment',  8,  'SALES'),
    ('bardy',          9,  'SALES'),
    ('satylyar',      10,  'SALES'),
    ('satyldy',       11,  'SALES'),
    ('tamamlandy',    12,  'COMPLETE'),
    ('cancelled',     99,  'CANCELLED'),
]

#: Status codes that are non-terminal and accept a cancel edge
CANCELLABLE_CODES = [
    'draft', 'gumruk_girish', 'gumruk_chykysh', 'yuklenme', 'yola_chykdy',
    'serhet_gechdi', 'dest_entry', 'barysh_gumrugi', 'transshipment',
    'bardy', 'satylyar', 'satyldy',
]


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def _ensure_statuses() -> None:
    """Idempotently seed all required status rows in the test DB.

    Migration 0010 and 0011 are skipped when DJANGO_TESTING=true, so we seed
    them directly here — same pattern used by tests_auto_advance.py.
    """
    for code, order, phase in ALL_TEST_STATUSES:
        ShipmentStatusType.objects.get_or_create(
            code=code,
            defaults={
                'name_tk': code,
                'name_en': code,
                'name_ru': code,
                'step_order': order,
                'phase': phase,
                'is_active': True,
            },
        )


def _make_user(username: str, role: str) -> User:
    return User.objects.create_user(username=username, password='pw', role=role)


def _make_season() -> Season:
    season, _ = Season.objects.get_or_create(
        name='2025-2026',
        defaults={'start_date': '2025-09-01', 'end_date': '2026-06-30', 'is_active': True},
    )
    return season


def _make_shipment_at(code: str, season: Season, user: User, cargo_suffix: str = '') -> Shipment:
    """Create a shipment in the given status."""
    status_obj = ShipmentStatusType.objects.get(code=code)
    return Shipment.objects.create(
        cargo_code=f'TEST{cargo_suffix or code[:4].upper()}001/26',
        date='2026-01-01',
        season=season,
        status=status_obj,
        created_by=user,
        updated_by=user,
    )


def _auth(client: APIClient, user: User) -> None:
    client.force_authenticate(user=user)


# ---------------------------------------------------------------------------
# Test 1 — Privileged cancel from each non-terminal status
# ---------------------------------------------------------------------------

class PrivilegedCancelSuccessTests(TestCase):
    """export_manager can cancel a shipment from each of the 12 active statuses."""

    @classmethod
    def setUpTestData(cls):
        _ensure_statuses()
        cls.manager = _make_user('cancel_mgr', 'export_manager')
        cls.season = _make_season()

    def setUp(self) -> None:
        self.client = APIClient()
        _auth(self.client, self.manager)

    def _cancel_from_status(self, status_code: str) -> None:
        """Helper: create a shipment at status_code, cancel it, assert result."""
        status_obj = ShipmentStatusType.objects.get(code=status_code)
        unique_code = f'CC{status_code[:4].upper()}{status_obj.pk:03d}/26'
        shipment = Shipment.objects.create(
            cargo_code=unique_code,
            date='2026-01-01',
            season=self.season,
            status=status_obj,
            created_by=self.manager,
            updated_by=self.manager,
        )
        before_count = ShipmentStatusLog.objects.filter(shipment=shipment).count()

        resp = self.client.post(
            f'/api/v1/export/shipments/{shipment.pk}/cancel/',
            data={'reason': 'Test cancellation reason'},
            format='json',
        )
        self.assertEqual(
            resp.status_code, 200,
            f'Cancel from {status_code!r} returned {resp.status_code}: {resp.data}',
        )

        shipment.refresh_from_db()
        self.assertEqual(
            shipment.status.code, 'cancelled',
            f'Expected status=cancelled after cancel from {status_code!r}, got {shipment.status.code}',
        )

        # A ShipmentStatusLog row must exist with the reason as comment
        log_qs = ShipmentStatusLog.objects.filter(shipment=shipment, status__code='cancelled')
        self.assertTrue(
            log_qs.exists(),
            f'No ShipmentStatusLog row for cancelled status after cancel from {status_code!r}',
        )
        log = log_qs.first()
        self.assertEqual(log.comment, 'Test cancellation reason')

        # status_changed_at must be updated (set by transition_to)
        self.assertIsNotNone(shipment.status_changed_at)

        # Exactly one new log row was added
        after_count = ShipmentStatusLog.objects.filter(shipment=shipment).count()
        self.assertEqual(after_count, before_count + 1)

    def test_cancel_from_draft(self):
        self._cancel_from_status('draft')

    def test_cancel_from_gumruk_girish(self):
        self._cancel_from_status('gumruk_girish')

    def test_cancel_from_gumruk_chykysh(self):
        self._cancel_from_status('gumruk_chykysh')

    def test_cancel_from_yuklenme(self):
        self._cancel_from_status('yuklenme')

    def test_cancel_from_yola_chykdy(self):
        self._cancel_from_status('yola_chykdy')

    def test_cancel_from_serhet_gechdi(self):
        self._cancel_from_status('serhet_gechdi')

    def test_cancel_from_dest_entry(self):
        self._cancel_from_status('dest_entry')

    def test_cancel_from_barysh_gumrugi(self):
        self._cancel_from_status('barysh_gumrugi')

    def test_cancel_from_transshipment(self):
        self._cancel_from_status('transshipment')

    def test_cancel_from_bardy(self):
        self._cancel_from_status('bardy')

    def test_cancel_from_satylyar(self):
        self._cancel_from_status('satylyar')

    def test_cancel_from_satyldy(self):
        self._cancel_from_status('satyldy')


# ---------------------------------------------------------------------------
# Test 2 — Non-privileged user gets 403
# ---------------------------------------------------------------------------

class NonPrivilegedCancelForbiddenTests(TestCase):
    """Non-privileged user (sales_rep) cannot cancel a shipment."""

    @classmethod
    def setUpTestData(cls):
        _ensure_statuses()
        cls.sales_rep = _make_user('sales_cancel', 'sales_rep')
        cls.season = _make_season()

    def setUp(self) -> None:
        self.client = APIClient()
        _auth(self.client, self.sales_rep)

    def test_sales_rep_cancel_returns_403(self) -> None:
        status_obj = ShipmentStatusType.objects.get(code='bardy')
        shipment = Shipment.objects.create(
            cargo_code='FORB001/26',
            date='2026-01-01',
            season=self.season,
            status=status_obj,
            created_by=self.sales_rep,
            updated_by=self.sales_rep,
        )

        resp = self.client.post(
            f'/api/v1/export/shipments/{shipment.pk}/cancel/',
            data={'reason': 'Trying to cancel'},
            format='json',
        )
        self.assertEqual(resp.status_code, 403)

        shipment.refresh_from_db()
        self.assertEqual(
            shipment.status.code, 'bardy',
            'Status must be unchanged after 403 rejection',
        )


# ---------------------------------------------------------------------------
# Test 3 — Empty reason returns 400
# ---------------------------------------------------------------------------

class EmptyReasonCancelTests(TestCase):
    """Privileged user with empty reason gets 400; status unchanged."""

    @classmethod
    def setUpTestData(cls):
        _ensure_statuses()
        cls.manager = _make_user('empty_reason_mgr', 'export_manager')
        cls.season = _make_season()
        cls.status_obj = ShipmentStatusType.objects.get(code='bardy')

    def setUp(self) -> None:
        self.client = APIClient()
        _auth(self.client, self.manager)

    def _make_bardy_shipment(self, code: str) -> Shipment:
        return Shipment.objects.create(
            cargo_code=code,
            date='2026-01-01',
            season=self.season,
            status=self.status_obj,
            created_by=self.manager,
            updated_by=self.manager,
        )

    def test_empty_string_reason_returns_400(self) -> None:
        shipment = self._make_bardy_shipment('EMPT001/26')
        resp = self.client.post(
            f'/api/v1/export/shipments/{shipment.pk}/cancel/',
            data={'reason': ''},
            format='json',
        )
        self.assertEqual(resp.status_code, 400)
        shipment.refresh_from_db()
        self.assertEqual(shipment.status.code, 'bardy')

    def test_whitespace_only_reason_returns_400(self) -> None:
        shipment = self._make_bardy_shipment('EMPT002/26')
        resp = self.client.post(
            f'/api/v1/export/shipments/{shipment.pk}/cancel/',
            data={'reason': '   '},
            format='json',
        )
        self.assertEqual(resp.status_code, 400)
        shipment.refresh_from_db()
        self.assertEqual(shipment.status.code, 'bardy')

    def test_missing_reason_key_returns_400(self) -> None:
        shipment = self._make_bardy_shipment('EMPT003/26')
        resp = self.client.post(
            f'/api/v1/export/shipments/{shipment.pk}/cancel/',
            data={},
            format='json',
        )
        self.assertEqual(resp.status_code, 400)
        shipment.refresh_from_db()
        self.assertEqual(shipment.status.code, 'bardy')


# ---------------------------------------------------------------------------
# Test 4 — Cancel from tamamlandy returns 400 (no edge)
# ---------------------------------------------------------------------------

class CancelFromTerminalTests(TestCase):
    """Cancel from tamamlandy returns 400 — no cancel edge defined."""

    @classmethod
    def setUpTestData(cls):
        _ensure_statuses()
        cls.manager = _make_user('terminal_mgr', 'export_manager')
        cls.season = _make_season()

    def setUp(self) -> None:
        self.client = APIClient()
        _auth(self.client, self.manager)

    def test_cancel_from_tamamlandy_returns_400(self) -> None:
        status_obj = ShipmentStatusType.objects.get(code='tamamlandy')
        shipment = Shipment.objects.create(
            cargo_code='TERM001/26',
            date='2026-01-01',
            season=self.season,
            status=status_obj,
            created_by=self.manager,
            updated_by=self.manager,
        )

        resp = self.client.post(
            f'/api/v1/export/shipments/{shipment.pk}/cancel/',
            data={'reason': 'Trying to cancel a completed shipment'},
            format='json',
        )
        self.assertEqual(resp.status_code, 400)

        shipment.refresh_from_db()
        self.assertEqual(shipment.status.code, 'tamamlandy')


# ---------------------------------------------------------------------------
# Test 5 — Task state auto-cancellation
# ---------------------------------------------------------------------------

class TaskCancellationTests(TestCase):
    """OPEN/IN_PROGRESS/BLOCKED tasks become CANCELLED; DONE task untouched."""

    @classmethod
    def setUpTestData(cls):
        _ensure_statuses()
        cls.manager = _make_user('task_cancel_mgr', 'export_manager')
        cls.season = _make_season()

    def setUp(self) -> None:
        self.client = APIClient()
        _auth(self.client, self.manager)

    def test_open_tasks_cancelled_done_preserved(self) -> None:
        status_obj = ShipmentStatusType.objects.get(code='bardy')
        shipment = Shipment.objects.create(
            cargo_code='TASK001/26',
            date='2026-01-01',
            season=self.season,
            status=status_obj,
            created_by=self.manager,
            updated_by=self.manager,
        )

        task_open = Task.objects.create(
            shipment=shipment, step='bardy',
            title_key='tasks.test_open', assignee_role='sales_rep',
            completion_rule=TaskCompletionRule.MANUAL_DONE,
            state=TaskState.OPEN,
        )
        task_in_progress = Task.objects.create(
            shipment=shipment, step='bardy',
            title_key='tasks.test_ip', assignee_role='sales_rep',
            completion_rule=TaskCompletionRule.MANUAL_DONE,
            state=TaskState.IN_PROGRESS,
        )
        task_blocked = Task.objects.create(
            shipment=shipment, step='bardy',
            title_key='tasks.test_blocked', assignee_role='sales_rep',
            completion_rule=TaskCompletionRule.MANUAL_DONE,
            state=TaskState.BLOCKED,
        )
        task_done = Task.objects.create(
            shipment=shipment, step='bardy',
            title_key='tasks.test_done', assignee_role='sales_rep',
            completion_rule=TaskCompletionRule.MANUAL_DONE,
            state=TaskState.DONE,
        )

        resp = self.client.post(
            f'/api/v1/export/shipments/{shipment.pk}/cancel/',
            data={'reason': 'Truck broken'},
            format='json',
        )
        self.assertEqual(resp.status_code, 200)

        task_open.refresh_from_db()
        task_in_progress.refresh_from_db()
        task_blocked.refresh_from_db()
        task_done.refresh_from_db()

        self.assertEqual(task_open.state, TaskState.CANCELLED)
        self.assertEqual(task_in_progress.state, TaskState.CANCELLED)
        self.assertEqual(task_blocked.state, TaskState.CANCELLED)
        self.assertEqual(task_done.state, TaskState.DONE, 'DONE task must remain DONE')


# ---------------------------------------------------------------------------
# Test 6 — Auto-advance does NOT fire on cancel
# ---------------------------------------------------------------------------

class NoAutoAdvanceOnCancelTests(TestCase):
    """Cancelling a shipment does not trigger auto-advance to a second status."""

    @classmethod
    def setUpTestData(cls):
        _ensure_statuses()
        cls.manager = _make_user('noadvance_mgr', 'export_manager')
        cls.season = _make_season()

    def setUp(self) -> None:
        self.client = APIClient()
        _auth(self.client, self.manager)

    def test_cancel_produces_exactly_one_status_log_row(self) -> None:
        """After cancel, exactly one new ShipmentStatusLog row (the cancelled row).

        The cancelled status has no outgoing edges in TRANSITIONS so
        auto_advance_if_ready returns False — no second transition fires.
        """
        status_obj = ShipmentStatusType.objects.get(code='bardy')
        shipment = Shipment.objects.create(
            cargo_code='NOADV01/26',
            date='2026-01-01',
            season=self.season,
            status=status_obj,
            created_by=self.manager,
            updated_by=self.manager,
        )
        before_count = ShipmentStatusLog.objects.filter(shipment=shipment).count()

        resp = self.client.post(
            f'/api/v1/export/shipments/{shipment.pk}/cancel/',
            data={'reason': 'No advance test'},
            format='json',
        )
        self.assertEqual(resp.status_code, 200)

        after_count = ShipmentStatusLog.objects.filter(shipment=shipment).count()
        self.assertEqual(
            after_count, before_count + 1,
            f'Expected exactly 1 new log row (cancelled), got {after_count - before_count}',
        )

        shipment.refresh_from_db()
        self.assertEqual(shipment.status.code, 'cancelled')


# ---------------------------------------------------------------------------
# Test 7 — Detail serializer allowed_transitions for bardy excludes cancelled
# ---------------------------------------------------------------------------

class AllowedTransitionsBardy(TestCase):
    """Serializer returns ['satylyar'] for bardy shipment — no 'cancelled'."""

    @classmethod
    def setUpTestData(cls):
        _ensure_statuses()
        cls.manager = _make_user('trans_mgr', 'export_manager')
        cls.season = _make_season()

    def test_bardy_allowed_transitions_excludes_cancelled(self) -> None:
        status_obj = ShipmentStatusType.objects.get(code='bardy')
        shipment = Shipment.objects.create(
            cargo_code='TRAN001/26',
            date=datetime.date(2026, 1, 1),
            season=self.season,
            status=status_obj,
            created_by=self.manager,
            updated_by=self.manager,
        )
        serializer = ShipmentDetailSerializer(shipment)
        transitions = serializer.data['allowed_transitions']
        self.assertEqual(transitions, ['satylyar'])
        self.assertNotIn('cancelled', transitions)


# ---------------------------------------------------------------------------
# Test 8 — Cancelled shipment has empty allowed_transitions
# ---------------------------------------------------------------------------

class CancelledShipmentNoTransitions(TestCase):
    """Once cancelled, allowed_transitions is empty."""

    @classmethod
    def setUpTestData(cls):
        _ensure_statuses()
        cls.manager = _make_user('notr_mgr', 'export_manager')
        cls.season = _make_season()

    def test_cancelled_shipment_has_empty_transitions(self) -> None:
        cancelled_status = ShipmentStatusType.objects.get(code='cancelled')
        shipment = Shipment.objects.create(
            cargo_code='NOTR001/26',
            date=datetime.date(2026, 1, 1),
            season=self.season,
            status=cancelled_status,
            created_by=self.manager,
            updated_by=self.manager,
        )
        serializer = ShipmentDetailSerializer(shipment)
        transitions = serializer.data['allowed_transitions']
        self.assertEqual(transitions, [])


# ---------------------------------------------------------------------------
# Test 9 — Regression: barysh_gumrugi does not raise in allowed_transitions
# ---------------------------------------------------------------------------

class BaryshGumrugiAllowedTransitionsRegressionTest(TestCase):
    """Serializer does not raise on barysh_gumrugi (has 3-tuple edges).

    Without the _edge_to() fix, `for to_code, _roles in ...` would raise
    ValueError: too many values to unpack for the 3-tuple conditional edges.
    """

    @classmethod
    def setUpTestData(cls):
        _ensure_statuses()
        cls.manager = _make_user('bg_regr_mgr', 'export_manager')
        cls.season = _make_season()

    def test_barysh_gumrugi_allowed_transitions_does_not_raise(self) -> None:
        status_obj = ShipmentStatusType.objects.get(code='barysh_gumrugi')
        shipment = Shipment.objects.create(
            cargo_code='BGRE001/26',
            date=datetime.date(2026, 1, 1),
            season=self.season,
            status=status_obj,
            created_by=self.manager,
            updated_by=self.manager,
        )
        # Should not raise; prior to fix this would crash with "too many values to unpack"
        serializer = ShipmentDetailSerializer(shipment)
        transitions = serializer.data['allowed_transitions']
        # barysh_gumrugi has conditional edges to transshipment / bardy; neither should include cancelled
        self.assertIsInstance(transitions, list)
        self.assertNotIn('cancelled', transitions)
        # At least one forward transition should be available
        self.assertTrue(
            len(transitions) >= 1,
            f'Expected ≥1 forward transition from barysh_gumrugi, got {transitions}',
        )


# ---------------------------------------------------------------------------
# Test 10 — QuotaUsageRecord cleanup
# ---------------------------------------------------------------------------

class QuotaUsageCleanupTests(TestCase):
    """Cancel deletes draft quota records; preserves approved; surfaces IDs in response."""

    @classmethod
    def setUpTestData(cls):
        _ensure_statuses()
        cls.manager = _make_user('quota_mgr', 'export_manager')
        cls.season = _make_season()

    def setUp(self) -> None:
        self.client = APIClient()
        _auth(self.client, self.manager)

    def test_draft_deleted_approved_preserved(self) -> None:
        from apps.core.models import ExportFirm

        status_obj = ShipmentStatusType.objects.get(code='bardy')
        shipment = Shipment.objects.create(
            cargo_code='QUOT001/26',
            date='2026-01-01',
            season=self.season,
            status=status_obj,
            created_by=self.manager,
            updated_by=self.manager,
        )

        export_firm = ExportFirm.objects.create(code='QF', name_tk='Test Firm', name_en='Test Firm')

        draft1 = QuotaUsageRecord.objects.create(
            shipment=shipment,
            export_firm=export_firm,
            usage_date='2026-01-01',
            kg_used=5000,
            status='draft',
        )
        draft2 = QuotaUsageRecord.objects.create(
            shipment=shipment,
            export_firm=export_firm,
            usage_date='2026-01-01',
            kg_used=3000,
            status='draft',
        )
        approved = QuotaUsageRecord.objects.create(
            shipment=shipment,
            export_firm=export_firm,
            usage_date='2026-01-01',
            kg_used=8000,
            status='approved',
        )

        resp = self.client.post(
            f'/api/v1/export/shipments/{shipment.pk}/cancel/',
            data={'reason': 'Customer cancelled order'},
            format='json',
        )
        self.assertEqual(resp.status_code, 200)

        # Draft records must be deleted
        self.assertFalse(
            QuotaUsageRecord.objects.filter(pk__in=[draft1.pk, draft2.pk]).exists(),
            'Draft QuotaUsageRecords must be deleted on cancel',
        )

        # Approved record must still exist, with shipment FK still set
        approved.refresh_from_db()
        self.assertEqual(
            approved.shipment_id, shipment.pk,
            'Approved QuotaUsageRecord must still be linked to the shipment',
        )

        # Response payload
        data = resp.data
        self.assertEqual(data['draft_quota_deleted'], 2)
        self.assertIn(approved.pk, data['approved_quota_to_reconcile'])
        self.assertEqual(len(data['approved_quota_to_reconcile']), 1)


# ---------------------------------------------------------------------------
# Test 11 — Cancelled shipments hidden from the operational list by default
# ---------------------------------------------------------------------------

class ListExcludesCancelledTests(TestCase):
    """GET /shipments/ hides cancelled rows unless ?show_cancelled=true or
    ?status_code=cancelled is set. Detail (retrieve) stays reachable."""

    @classmethod
    def setUpTestData(cls):
        _ensure_statuses()
        cls.manager = _make_user('list_excl_mgr', 'export_manager')
        cls.season = _make_season()
        cls.active = _make_shipment_at('bardy', cls.season, cls.manager, cargo_suffix='ACTIVE')
        cls.cancelled = _make_shipment_at('cancelled', cls.season, cls.manager, cargo_suffix='CANCEL')

    def setUp(self) -> None:
        self.client = APIClient()
        _auth(self.client, self.manager)

    def _list_ids(self, query: str = '') -> set[int]:
        resp = self.client.get(f'/api/v1/export/shipments/{query}')
        self.assertEqual(resp.status_code, 200, resp.data)
        results = resp.data['results'] if isinstance(resp.data, dict) else resp.data
        return {row['id'] for row in results}

    def test_default_list_hides_cancelled(self) -> None:
        ids = self._list_ids()
        self.assertIn(self.active.pk, ids)
        self.assertNotIn(self.cancelled.pk, ids)

    def test_show_cancelled_reveals_them(self) -> None:
        ids = self._list_ids('?show_cancelled=true')
        self.assertIn(self.active.pk, ids)
        self.assertIn(self.cancelled.pk, ids)

    def test_explicit_status_filter_shows_cancelled(self) -> None:
        ids = self._list_ids('?status_code=cancelled')
        self.assertIn(self.cancelled.pk, ids)
        self.assertNotIn(self.active.pk, ids)

    def test_cancelled_detail_still_reachable(self) -> None:
        resp = self.client.get(f'/api/v1/export/shipments/{self.cancelled.pk}/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['status_code'], 'cancelled')
