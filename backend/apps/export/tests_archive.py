"""Tests for Phase 3 Operational/Archive split (ADR-0005).

Covers:
  - Shipment.is_archived defaults to False on create.
  - GET /shipments/ default view excludes is_archived=True.
  - GET /shipments/?archived=true returns is_archived=True (role-gated).
  - GET /shipments/?archived=true returns 0 results for non-management roles.
  - archive_shipments command flips terminal-phase, stale rows.
  - archive_shipments leaves non-terminal rows alone (no matter how stale).
  - archive_shipments leaves recently-touched terminal rows alone.
  - archive_shipments is idempotent — re-running picks up nothing.
  - archive_shipments --dry-run does not write.

Run with:
    python manage.py test apps.export.tests_archive --verbosity=2
"""
from datetime import timedelta
from io import StringIO

from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core.models import Season, ShipmentStatusType, User
from apps.export.models import Shipment


def _create_user(username: str, role: str, is_superuser: bool = False) -> User:
    u = User(username=username, role=role, is_superuser=is_superuser)
    u.set_password('pass')
    u.save()
    return u


def _seed_permissions() -> None:
    call_command('seed_permissions')


def _make_status(code: str, phase: str, step: int) -> ShipmentStatusType:
    obj, _ = ShipmentStatusType.objects.get_or_create(
        code=code,
        defaults={
            'name_tk': code, 'name_en': code, 'step_order': step, 'phase': phase,
        },
    )
    return obj


def _make_shipment(cargo_code: str, season: Season, status: ShipmentStatusType,
                   updated_days_ago: int = 0) -> Shipment:
    s = Shipment.objects.create(
        cargo_code=cargo_code,
        date='2026-02-01',
        season=season,
        status=status,
    )
    if updated_days_ago > 0:
        # Force updated_at backwards by direct UPDATE (skips auto_now)
        Shipment.objects.filter(pk=s.pk).update(
            updated_at=timezone.now() - timedelta(days=updated_days_ago),
        )
        s.refresh_from_db()
    return s


# ─── Endpoint filtering ────────────────────────────────────────────────────

class ArchiveFilterEndpointTests(TestCase):
    """GET /shipments/ default vs ?archived=true."""

    @classmethod
    def setUpTestData(cls):
        _seed_permissions()
        cls.season, _ = Season.objects.get_or_create(
            name='2025-ARC',
            defaults={'start_date': '2025-09-01', 'end_date': '2026-06-30', 'is_active': True},
        )
        cls.status_loading = _make_status('yuklenme_arc', 'LOADING', 1)
        cls.status_done = _make_status('tamamlandy_arc', 'COMPLETE', 13)

        cls.active = _make_shipment('ARC-ACT-1', cls.season, cls.status_loading)
        cls.archived = _make_shipment('ARC-OLD-1', cls.season, cls.status_done)
        # Manually flip the second one to archived (cron-equivalent).
        Shipment.objects.filter(pk=cls.archived.pk).update(
            is_archived=True, archived_at=timezone.now(),
        )

    def setUp(self):
        self.client = APIClient()

    def _login(self, role: str) -> User:
        u = _create_user(f'arc_{role}_{id(self)}', role)
        self.client.force_authenticate(user=u)
        return u

    def test_default_view_excludes_archived(self):
        self._login('export_manager')
        resp = self.client.get('/api/v1/export/shipments/')
        self.assertEqual(resp.status_code, 200, resp.data)
        codes = [r['cargo_code'] for r in resp.data['results']]
        self.assertIn('ARC-ACT-1', codes)
        self.assertNotIn('ARC-OLD-1', codes)

    def test_archived_view_returns_archived_only(self):
        self._login('export_manager')
        resp = self.client.get('/api/v1/export/shipments/?archived=true')
        self.assertEqual(resp.status_code, 200, resp.data)
        codes = [r['cargo_code'] for r in resp.data['results']]
        self.assertNotIn('ARC-ACT-1', codes)
        self.assertIn('ARC-OLD-1', codes)

    def test_archived_view_admin_allowed(self):
        self._login('admin')
        resp = self.client.get('/api/v1/export/shipments/?archived=true')
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertGreaterEqual(len(resp.data['results']), 1)

    def test_archived_view_director_allowed(self):
        self._login('director')
        resp = self.client.get('/api/v1/export/shipments/?archived=true')
        self.assertEqual(resp.status_code, 200, resp.data)

    def test_archived_view_finansist_allowed(self):
        self._login('finansist')
        resp = self.client.get('/api/v1/export/shipments/?archived=true')
        self.assertEqual(resp.status_code, 200, resp.data)

    def test_archived_view_warehouse_chief_returns_empty(self):
        """Non-management roles silently see 0 results in archive view."""
        self._login('warehouse_chief')
        resp = self.client.get('/api/v1/export/shipments/?archived=true')
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(len(resp.data['results']), 0)

    def test_archived_view_sales_rep_returns_empty(self):
        self._login('sales_rep')
        resp = self.client.get('/api/v1/export/shipments/?archived=true')
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(len(resp.data['results']), 0)


# ─── archive_shipments mgmt command ────────────────────────────────────────

class ArchiveCommandTests(TestCase):
    """The cron command: terminal-phase + stale → is_archived=True."""

    @classmethod
    def setUpTestData(cls):
        cls.season, _ = Season.objects.get_or_create(
            name='2025-CRON',
            defaults={'start_date': '2025-09-01', 'end_date': '2026-06-30', 'is_active': True},
        )
        cls.status_open = _make_status('yuklenme_cron', 'LOADING', 1)
        cls.status_done = _make_status('tamamlandy_cron', 'COMPLETE', 13)

    def _run(self, **kwargs) -> str:
        out = StringIO()
        call_command('archive_shipments', stdout=out, **kwargs)
        return out.getvalue()

    def test_archives_terminal_stale_shipment(self):
        s = _make_shipment('CRON-OLD', self.season, self.status_done, updated_days_ago=30)
        self._run()
        s.refresh_from_db()
        self.assertTrue(s.is_archived)
        self.assertIsNotNone(s.archived_at)

    def test_skips_terminal_recent_shipment(self):
        """Touched within the cooldown — stays operational."""
        s = _make_shipment('CRON-NEW', self.season, self.status_done, updated_days_ago=10)
        self._run()
        s.refresh_from_db()
        self.assertFalse(s.is_archived)

    def test_skips_open_stale_shipment(self):
        """Stuck-open is the stuck dashboard's problem, NOT auto-archived."""
        s = _make_shipment('CRON-STUCK', self.season, self.status_open, updated_days_ago=90)
        self._run()
        s.refresh_from_db()
        self.assertFalse(s.is_archived)
        self.assertIsNone(s.archived_at)

    def test_idempotent_second_run_picks_up_nothing(self):
        s = _make_shipment('CRON-IDEM', self.season, self.status_done, updated_days_ago=30)
        self._run()
        s.refresh_from_db()
        first_ts = s.archived_at
        self.assertIsNotNone(first_ts)

        # Second run finds nothing new (the row is already is_archived=True)
        out = self._run()
        self.assertIn('No shipments to archive', out)
        s.refresh_from_db()
        self.assertEqual(s.archived_at, first_ts, 'archived_at must not be re-bumped')

    def test_dry_run_does_not_write(self):
        s = _make_shipment('CRON-DRY', self.season, self.status_done, updated_days_ago=30)
        out = self._run(dry_run=True)
        self.assertIn('DRY RUN', out)
        self.assertIn('CRON-DRY', out)
        s.refresh_from_db()
        self.assertFalse(s.is_archived)

    def test_older_than_arg_tightens_window(self):
        """--older-than 7 catches a 10-day-old terminal shipment."""
        s = _make_shipment('CRON-7D', self.season, self.status_done, updated_days_ago=10)
        # Default 21 days — should NOT pick it up
        self._run()
        s.refresh_from_db()
        self.assertFalse(s.is_archived)

        # --older-than 7 — picks it up
        self._run(older_than=7)
        s.refresh_from_db()
        self.assertTrue(s.is_archived)
