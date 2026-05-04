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
from apps.export.models import Notification, Shipment


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

    # ── ?stuck=true Phase 4a dashboard filter ─────────────────────────────

    def test_stuck_returns_open_shipments_past_threshold(self):
        """?stuck=true: open + is_archived=False + updated_at ≤ now-4d."""
        # Create a stuck shipment (5d old, LOADING phase)
        stuck = _make_shipment('STUCK-1', self.season, self.status_loading, updated_days_ago=5)
        # Recent shipment — under threshold
        _make_shipment('STUCK-RECENT', self.season, self.status_loading, updated_days_ago=1)
        # Closed-and-stale — terminal phase, excluded
        _make_shipment('STUCK-DONE', self.season, self.status_done, updated_days_ago=30)

        self._login('director')
        resp = self.client.get('/api/v1/export/shipments/?stuck=true')
        self.assertEqual(resp.status_code, 200, resp.data)
        codes = [r['cargo_code'] for r in resp.data['results']]
        self.assertIn('STUCK-1', codes)
        self.assertNotIn('STUCK-RECENT', codes)
        self.assertNotIn('STUCK-DONE', codes)
        # Refresh from DB so we don't compare against the unsaved local copy
        stuck.refresh_from_db()

    def test_stuck_orders_oldest_first(self):
        """Oldest stuck rows surface at the top so the worst case is visible."""
        _make_shipment('STUCK-OLD', self.season, self.status_loading, updated_days_ago=15)
        _make_shipment('STUCK-MID', self.season, self.status_loading, updated_days_ago=8)
        _make_shipment('STUCK-NEW', self.season, self.status_loading, updated_days_ago=5)

        self._login('director')
        resp = self.client.get('/api/v1/export/shipments/?stuck=true')
        codes = [r['cargo_code'] for r in resp.data['results']]
        self.assertEqual(codes[:3], ['STUCK-OLD', 'STUCK-MID', 'STUCK-NEW'])

    def test_stuck_excludes_archived(self):
        """Archived rows must not show in stuck (they're CLOSED operational)."""
        s = _make_shipment('STUCK-ARC', self.season, self.status_loading, updated_days_ago=30)
        Shipment.objects.filter(pk=s.pk).update(is_archived=True)

        self._login('director')
        resp = self.client.get('/api/v1/export/shipments/?stuck=true')
        codes = [r['cargo_code'] for r in resp.data['results']]
        self.assertNotIn('STUCK-ARC', codes)

    def test_stuck_admin_allowed(self):
        _make_shipment('STUCK-ADM', self.season, self.status_loading, updated_days_ago=10)
        self._login('admin')
        resp = self.client.get('/api/v1/export/shipments/?stuck=true')
        self.assertEqual(resp.status_code, 200, resp.data)

    def test_stuck_warehouse_chief_returns_empty(self):
        """Non-management roles silently see 0 results."""
        _make_shipment('STUCK-FORBIDDEN', self.season, self.status_loading, updated_days_ago=10)
        self._login('warehouse_chief')
        resp = self.client.get('/api/v1/export/shipments/?stuck=true')
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(len(resp.data['results']), 0)

    def test_stuck_export_manager_returns_empty(self):
        """export_manager has shipment.view but stuck is tighter — director-level."""
        _make_shipment('STUCK-EM', self.season, self.status_loading, updated_days_ago=10)
        self._login('export_manager')
        resp = self.client.get('/api/v1/export/shipments/?stuck=true')
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(len(resp.data['results']), 0)

    def test_patch_archived_shipment_returns_403(self):
        """Defense in depth: even with ?archived=true, PATCHing returns 403.

        Without this guard a crafted ?archived=true on the detail URL would
        let get_object() find the row and the serializer would happily save.
        """
        self._login('admin')
        resp = self.client.patch(
            f'/api/v1/export/shipments/{self.archived.id}/?archived=true',
            {'notes': 'should not save'},
            format='json',
        )
        self.assertEqual(resp.status_code, 403, resp.data)
        self.assertIn('read-only', resp.data.get('error', '').lower())
        # Confirm the value did not persist
        self.archived.refresh_from_db()
        self.assertNotEqual(self.archived.notes, 'should not save')

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

    def test_skips_open_shipment_within_archive_window(self):
        """Phase guard at the same staleness as the positive case.

        Pins the cron's filter to phase=COMPLETE: a LOADING-phase row that
        meets the age threshold (30d ≥ default 21d) must NOT archive,
        proving the guard isn't accidentally tied to age alone.
        """
        s = _make_shipment('CRON-OPEN-30', self.season, self.status_open, updated_days_ago=30)
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


# ─── notify_stuck_shipments mgmt command (Phase 4b) ────────────────────────

class NotifyStuckShipmentsTests(TestCase):
    """Per-shipment escalation notifications at 8/15/30-day thresholds."""

    @classmethod
    def setUpTestData(cls):
        cls.season, _ = Season.objects.get_or_create(
            name='2025-NTF',
            defaults={'start_date': '2025-09-01', 'end_date': '2026-06-30', 'is_active': True},
        )
        cls.status_open = _make_status('yuklenme_n', 'LOADING', 1)
        cls.status_done = _make_status('tamamlandy_n', 'COMPLETE', 13)
        cls.director = _create_user('notify_director', 'director')
        cls.admin = _create_user('notify_admin', 'admin')
        cls.warehouse = _create_user('notify_warehouse', 'warehouse_chief')

    def setUp(self):
        # Each test starts with a clean Notification slate to avoid cross-test
        # interference from setUpTestData persistence.
        Notification.objects.filter(kind__startswith='stuck_').delete()

    def _run(self, **kwargs) -> str:
        out = StringIO()
        call_command('notify_stuck_shipments', stdout=out, **kwargs)
        return out.getvalue()

    def test_creates_8d_notification_for_each_recipient(self):
        s = _make_shipment('NOTIFY-8D', self.season, self.status_open, updated_days_ago=10)
        self._run()
        # One notification per recipient (admin + director, NOT warehouse_chief)
        notifs = Notification.objects.filter(kind='stuck_8d', link=f'/shipments/{s.id}')
        self.assertEqual(notifs.count(), 2)
        self.assertSetEqual(
            set(notifs.values_list('user__role', flat=True)),
            {'admin', 'director'},
        )

    def test_skips_warehouse_chief_recipient(self):
        _make_shipment('NOTIFY-NO-WH', self.season, self.status_open, updated_days_ago=10)
        self._run()
        wh_notifs = Notification.objects.filter(user=self.warehouse, kind__startswith='stuck_')
        self.assertEqual(wh_notifs.count(), 0)

    def test_skips_under_threshold(self):
        """Shipments fresher than 8d don't trigger any notification."""
        _make_shipment('NOTIFY-FRESH', self.season, self.status_open, updated_days_ago=5)
        self._run()
        self.assertEqual(Notification.objects.filter(kind__startswith='stuck_').count(), 0)

    def test_creates_8d_and_15d_at_18_days(self):
        """A shipment 18d stuck has crossed both 8d AND 15d thresholds."""
        s = _make_shipment('NOTIFY-18D', self.season, self.status_open, updated_days_ago=18)
        self._run()
        kinds_for_admin = set(
            Notification.objects.filter(
                user=self.admin, link=f'/shipments/{s.id}',
            ).values_list('kind', flat=True)
        )
        self.assertSetEqual(kinds_for_admin, {'stuck_8d', 'stuck_15d'})

    def test_creates_all_three_at_35_days(self):
        s = _make_shipment('NOTIFY-35D', self.season, self.status_open, updated_days_ago=35)
        self._run()
        kinds_for_admin = set(
            Notification.objects.filter(
                user=self.admin, link=f'/shipments/{s.id}',
            ).values_list('kind', flat=True)
        )
        self.assertSetEqual(kinds_for_admin, {'stuck_8d', 'stuck_15d', 'stuck_30d'})

    def test_idempotent_second_run_creates_nothing(self):
        s = _make_shipment('NOTIFY-IDEM', self.season, self.status_open, updated_days_ago=10)
        self._run()
        before = Notification.objects.filter(kind='stuck_8d', link=f'/shipments/{s.id}').count()
        self.assertEqual(before, 2)  # admin + director
        self._run()
        after = Notification.objects.filter(kind='stuck_8d', link=f'/shipments/{s.id}').count()
        self.assertEqual(after, 2, 'Second run must not duplicate notifications')

    def test_skips_archived_shipment(self):
        s = _make_shipment('NOTIFY-ARC', self.season, self.status_open, updated_days_ago=20)
        Shipment.objects.filter(pk=s.pk).update(is_archived=True)
        self._run()
        self.assertEqual(
            Notification.objects.filter(link=f'/shipments/{s.id}').count(),
            0,
        )

    def test_skips_terminal_phase_shipment(self):
        """Closed shipments don't get stuck notifications regardless of age."""
        s = _make_shipment('NOTIFY-DONE', self.season, self.status_done, updated_days_ago=40)
        self._run()
        self.assertEqual(
            Notification.objects.filter(link=f'/shipments/{s.id}').count(),
            0,
        )

    def test_dry_run_does_not_write(self):
        _make_shipment('NOTIFY-DRY', self.season, self.status_open, updated_days_ago=10)
        out = self._run(dry_run=True)
        self.assertIn('DRY RUN', out)
        self.assertEqual(Notification.objects.filter(kind__startswith='stuck_').count(), 0)
