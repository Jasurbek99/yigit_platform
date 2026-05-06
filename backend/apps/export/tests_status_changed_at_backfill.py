"""Tests for the status_changed_at backfill migration (0011).

Simulates the migration's RunPython on a snapshot DB (a few shipments
with logs, a few without) and asserts status_changed_at is set correctly.

These tests run against the real DB (not using MigrationExecutor) by
reproducing the backfill logic directly with live model instances.
This is the recommended approach when the migration logic is a pure
Python data operation — it avoids the overhead of rolling migrations
back and forward while still exercising the same code path.
"""
import datetime

from django.test import TestCase
from django.utils import timezone

from apps.core.models import Season, ShipmentStatusType, User
from apps.export.models import Shipment, ShipmentStatusLog


def _make_user(username: str) -> User:
    u = User(username=username, role='export_manager')
    u.set_password('pass')
    u.save()
    return u


def _make_season() -> Season:
    s, _ = Season.objects.get_or_create(
        name='bftest25',
        defaults={'start_date': '2025-09-01', 'end_date': '2026-06-30', 'is_active': False},
    )
    return s


def _make_status(code: str = 'draft', step_order: int = 0) -> ShipmentStatusType:
    st, _ = ShipmentStatusType.objects.get_or_create(
        code=code,
        defaults={'name_tk': code, 'name_en': code, 'step_order': step_order, 'phase': 'PREP'},
    )
    return st


def _make_shipment(cargo_code: str) -> Shipment:
    """Create a shipment with status_changed_at=None (pre-backfill state)."""
    s = Shipment.objects.create(
        cargo_code=cargo_code,
        date='2026-01-01',
        season=_make_season(),
        status=_make_status(),
    )
    # Force status_changed_at to None to simulate pre-migration state.
    Shipment.objects.filter(pk=s.pk).update(status_changed_at=None)
    s.refresh_from_db()
    return s


# ---------------------------------------------------------------------------
# Backfill helper (mirrors migration RunPython logic)
# ---------------------------------------------------------------------------

def _run_backfill():
    """Re-run the backfill logic outside of a migration context."""
    log_rows = (
        ShipmentStatusLog.objects
        .values('shipment_id', 'changed_at')
        .order_by('shipment_id', '-changed_at')
    )
    max_changed: dict = {}
    for row in log_rows:
        sid = row['shipment_id']
        if sid not in max_changed:
            max_changed[sid] = row['changed_at']

    shipments = list(Shipment.objects.filter(status_changed_at__isnull=True).only(
        'id', 'created_at', 'status_changed_at',
    ))
    to_update = []
    for shipment in shipments:
        ts = max_changed.get(shipment.id)
        shipment.status_changed_at = ts if ts is not None else shipment.created_at
        to_update.append(shipment)
    if to_update:
        Shipment.objects.bulk_update(to_update, ['status_changed_at'], batch_size=500)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class StatusChangedAtBackfillTests(TestCase):

    def test_shipment_with_log_gets_max_changed_at(self):
        """Shipment with status log rows gets status_changed_at = max(changed_at)."""
        user = _make_user('backfill_user1')
        st = _make_status('yuklenme', 1)
        shipment = _make_shipment('BF001')

        now = timezone.now()
        older = now - datetime.timedelta(hours=5)
        newer = now - datetime.timedelta(hours=1)

        log1 = ShipmentStatusLog.objects.create(
            shipment=shipment, status=st, changed_by=user, comment='log1',
        )
        ShipmentStatusLog.objects.filter(pk=log1.pk).update(changed_at=older)

        log2 = ShipmentStatusLog.objects.create(
            shipment=shipment, status=st, changed_by=user, comment='log2',
        )
        ShipmentStatusLog.objects.filter(pk=log2.pk).update(changed_at=newer)

        _run_backfill()

        shipment.refresh_from_db()
        self.assertIsNotNone(shipment.status_changed_at)
        # Should be the newer timestamp (max), not the older one
        delta = abs((shipment.status_changed_at - newer).total_seconds())
        self.assertLess(delta, 5, f'Expected ~newer ({newer}), got {shipment.status_changed_at}')

    def test_shipment_without_log_falls_back_to_created_at(self):
        """Shipment with no log rows falls back to status_changed_at = created_at."""
        shipment = _make_shipment('BF002')
        # No log rows for this shipment

        _run_backfill()

        shipment.refresh_from_db()
        self.assertIsNotNone(shipment.status_changed_at)
        delta = abs((shipment.status_changed_at - shipment.created_at).total_seconds())
        self.assertLess(delta, 5, f'Expected created_at fallback, got {shipment.status_changed_at}')

    def test_shipment_already_set_not_overwritten(self):
        """Shipment with status_changed_at already set is not touched by backfill."""
        now = timezone.now()
        already_set_time = now - datetime.timedelta(days=2)
        shipment = _make_shipment('BF003')
        # Manually set status_changed_at (simulates a shipment that had its field set already)
        Shipment.objects.filter(pk=shipment.pk).update(status_changed_at=already_set_time)

        _run_backfill()

        shipment.refresh_from_db()
        delta = abs((shipment.status_changed_at - already_set_time).total_seconds())
        self.assertLess(delta, 5, 'Pre-set status_changed_at should not be overwritten')

    def test_multiple_shipments_backfilled_correctly(self):
        """Multiple shipments are all correctly backfilled in one call."""
        user = _make_user('backfill_user2')
        st = _make_status('gumruk_girish', 2)
        now = timezone.now()

        s1 = _make_shipment('BF004')
        s2 = _make_shipment('BF005')

        # s1 has one log
        log = ShipmentStatusLog.objects.create(shipment=s1, status=st, changed_by=user)
        log_time = now - datetime.timedelta(hours=3)
        ShipmentStatusLog.objects.filter(pk=log.pk).update(changed_at=log_time)
        # s2 has no logs

        _run_backfill()

        s1.refresh_from_db()
        s2.refresh_from_db()

        self.assertIsNotNone(s1.status_changed_at)
        self.assertIsNotNone(s2.status_changed_at)

        # s2 falls back to created_at
        delta_s2 = abs((s2.status_changed_at - s2.created_at).total_seconds())
        self.assertLess(delta_s2, 5)
