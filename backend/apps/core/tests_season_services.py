"""Tests for close_season / open_season / close_preview.

Run with:
    python manage.py test apps.core.tests_season_services --verbosity=2
"""
from datetime import date
from decimal import Decimal

from django.test import TestCase
from django.utils import timezone

from apps.core.models import Country, GreenhouseBlock, Season, ShipmentStatusType, User
from apps.core.services.season import close_preview, close_season, open_season


def _status(code: str, phase: str, step_order: int = 1) -> ShipmentStatusType:
    return ShipmentStatusType.objects.create(
        code=code, name_tk=code, phase=phase, step_order=step_order,
    )


class CloseSeasonTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = User.objects.create(username='adm', role='admin')

    def setUp(self):
        self.season = Season.objects.create(
            name='2025/2026', start_date=date(2025, 9, 1), end_date=date(2026, 8, 31),
            is_active=True,
        )

    def test_close_sets_closed_at_and_by(self):
        close_season(self.season, self.user)
        self.season.refresh_from_db()
        self.assertIsNotNone(self.season.closed_at)
        self.assertEqual(self.season.closed_by, self.user)
        self.assertEqual(self.season.status, 'CLOSED')

    def test_close_clears_is_active(self):
        close_season(self.season, self.user)
        self.season.refresh_from_db()
        self.assertFalse(self.season.is_active)

    def test_close_twice_raises(self):
        close_season(self.season, self.user)
        with self.assertRaises(ValueError):
            close_season(self.season, self.user)

    def test_close_does_not_touch_shipment_rows(self):
        """D2: unfinished rows are left as-is and hidden, never mutated."""
        from apps.export.models import Shipment

        status = _status('draft', 'DRAFT')
        country = Country.objects.create(name_en='KZ', name_tk='KZ')
        shipment = Shipment.objects.create(
            shipment_code='X-1', date=date(2025, 10, 1), season=self.season,
            status=status, country=country,
        )
        # Full-row snapshot, not a couple of named columns: `.update()` (as
        # opposed to `.save()`) never touches `auto_now` fields like
        # `updated_at`, so a bulk `.update()` mutation on this shipment would
        # NOT be caught by an `updated_at`-only comparison. Every column must
        # be covered for this to actually discriminate.
        before = Shipment.objects.values().get(pk=shipment.pk)
        close_season(self.season, self.user)
        after = Shipment.objects.values().get(pk=shipment.pk)
        self.assertEqual(before, after)


class OpenSeasonTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = User.objects.create(username='adm', role='admin')

    def test_open_deactivates_the_incumbent(self):
        incumbent = Season.objects.create(
            name='2025/2026', start_date=date(2025, 9, 1), end_date=date(2026, 8, 31),
            is_active=True,
        )
        successor = Season.objects.create(
            name='2026/2027', start_date=date(2026, 9, 1), end_date=date(2027, 8, 31),
        )
        open_season(successor, self.user)
        incumbent.refresh_from_db()
        successor.refresh_from_db()
        self.assertFalse(incumbent.is_active)
        self.assertTrue(successor.is_active)

    def test_open_a_closed_season_is_refused(self):
        closed = Season.objects.create(
            name='2024/2025', start_date=date(2024, 9, 1), end_date=date(2025, 8, 31),
            closed_at=timezone.now(),
        )
        with self.assertRaises(ValueError):
            open_season(closed, self.user)

    def test_open_with_no_incumbent_works(self):
        season = Season.objects.create(
            name='2026/2027', start_date=date(2026, 9, 1), end_date=date(2027, 8, 31),
        )
        open_season(season, self.user)
        season.refresh_from_db()
        self.assertTrue(season.is_active)

    def test_close_then_open_successor_round_trip(self):
        """Task 16b: the activation guard must not trip either service — close
        always writes is_active=False, and open refuses a closed target before
        ever writing is_active=True on it."""
        incumbent = Season.objects.create(
            name='2025/2026', start_date=date(2025, 9, 1), end_date=date(2026, 8, 31),
            is_active=True,
        )
        successor = Season.objects.create(
            name='2026/2027', start_date=date(2026, 9, 1), end_date=date(2027, 8, 31),
        )
        close_season(incumbent, self.user)
        open_season(successor, self.user)
        incumbent.refresh_from_db()
        successor.refresh_from_db()
        self.assertEqual(incumbent.status, 'CLOSED')
        self.assertEqual(successor.status, 'ACTIVE')


class ClosePreviewTests(TestCase):
    def setUp(self):
        self.season = Season.objects.create(
            name='2025/2026', start_date=date(2025, 9, 1), end_date=date(2026, 8, 31),
            is_active=True,
        )

    def _shipment(self, code: str, status: ShipmentStatusType):
        from apps.export.models import Shipment

        return Shipment.objects.create(
            shipment_code=code, date=date(2025, 10, 1), season=self.season, status=status,
        )

    def test_preview_returns_all_four_counters(self):
        preview = close_preview(self.season)
        self.assertEqual(
            set(preview), {'drafts', 'in_transit', 'open_tasks', 'unfinished_plans'},
        )
        self.assertTrue(all(isinstance(v, int) for v in preview.values()))

    def test_drafts_counts_only_draft_status_shipments(self):
        draft = _status('draft', 'DRAFT')
        self._shipment('D-1', draft)
        preview = close_preview(self.season)
        self.assertEqual(preview['drafts'], 1)
        self.assertEqual(preview['in_transit'], 0)

    def test_in_transit_excludes_draft_complete_and_cancelled(self):
        draft = _status('draft', 'DRAFT', 0)
        transit = _status('yola_chykdy', 'TRANSIT', 4)
        complete = _status('tamamlandy', 'COMPLETE', 12)
        cancelled = _status('cancelled', 'CANCELLED', 99)
        self._shipment('D-1', draft)
        self._shipment('T-1', transit)
        self._shipment('C-1', complete)
        self._shipment('X-1', cancelled)
        preview = close_preview(self.season)
        self.assertEqual(preview['in_transit'], 1)

    def test_open_tasks_counts_open_in_progress_and_blocked(self):
        from apps.export.models import Task

        status = _status('draft', 'DRAFT')
        shipment = self._shipment('D-2', status)
        Task.objects.create(
            shipment=shipment, step='draft', title_key='t1', assignee_role='r', state='open',
        )
        Task.objects.create(
            shipment=shipment, step='draft', title_key='t2', assignee_role='r', state='blocked',
        )
        Task.objects.create(
            shipment=shipment, step='draft', title_key='t3', assignee_role='r', state='done',
            completed_at=timezone.now(),
        )
        preview = close_preview(self.season)
        self.assertEqual(preview['open_tasks'], 2)

    def test_open_tasks_excludes_cancelled_tasks_without_completed_at(self):
        """Cancelling a shipment sets Task.state=cancelled but never completed_at
        (`_cancel_open_tasks`) — a naive `completed_at__isnull=True` filter would
        wrongly count these as open work."""
        from apps.export.models import Task

        status = _status('draft', 'DRAFT')
        shipment = self._shipment('D-3', status)
        Task.objects.create(
            shipment=shipment, step='draft', title_key='t1', assignee_role='r', state='cancelled',
        )
        preview = close_preview(self.season)
        self.assertEqual(preview['open_tasks'], 0)

    def test_unfinished_plans_counts_plans_with_unreconciled_days(self):
        from apps.greenhouse.models import HarvestDayEntry, WeeklyHarvestPlan

        block = GreenhouseBlock.objects.create(code='A')
        plan = WeeklyHarvestPlan.objects.create(
            season=self.season, block=block, week_number=1, year=2025,
        )
        HarvestDayEntry.objects.create(
            weekly_plan=plan, season=self.season, block=block,
            entry_date=date(2025, 9, 1), weekday=0,
            plan_value=Decimal('100.00'), actual_value=None,
        )
        preview = close_preview(self.season)
        self.assertEqual(preview['unfinished_plans'], 1)

    def test_unfinished_plans_excludes_reconciled_plans(self):
        from apps.greenhouse.models import HarvestDayEntry, WeeklyHarvestPlan

        block = GreenhouseBlock.objects.create(code='B')
        plan = WeeklyHarvestPlan.objects.create(
            season=self.season, block=block, week_number=1, year=2025,
        )
        HarvestDayEntry.objects.create(
            weekly_plan=plan, season=self.season, block=block,
            entry_date=date(2025, 9, 1), weekday=0,
            plan_value=Decimal('100.00'), actual_value=Decimal('95.00'),
        )
        preview = close_preview(self.season)
        self.assertEqual(preview['unfinished_plans'], 0)


class SeasonEndpointTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        from django.core.management import call_command
        call_command('seed_permissions')
        cls.admin = User.objects.create(
            username='adm', role='admin', is_superuser=True,
        )
        cls.transport = User.objects.create(username='trn', role='transport')
        cls.finansist = User.objects.create(username='fin', role='finansist')
        cls.season = Season.objects.create(
            name='2025/2026', start_date=date(2025, 9, 1), end_date=date(2026, 8, 31),
            is_active=True,
        )

    def _client(self, user=None):
        from rest_framework.test import APIClient
        client = APIClient()
        client.force_authenticate(user=user or self.admin)
        return client

    def test_close_preview_returns_counters(self):
        response = self._client().get(
            f'/api/v1/export/admin/seasons/{self.season.pk}/close-preview/'
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn('in_transit', response.json())

    def test_close_endpoint_closes(self):
        response = self._client().post(
            f'/api/v1/export/admin/seasons/{self.season.pk}/close/'
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['status'], 'CLOSED')

    def test_close_twice_returns_409(self):
        client = self._client()
        client.post(f'/api/v1/export/admin/seasons/{self.season.pk}/close/')
        response = client.post(f'/api/v1/export/admin/seasons/{self.season.pk}/close/')
        self.assertEqual(response.status_code, 409)

    def test_open_endpoint_activates(self):
        successor = Season.objects.create(
            name='2026/2027', start_date=date(2026, 9, 1), end_date=date(2027, 8, 31),
        )
        response = self._client().post(
            f'/api/v1/export/admin/seasons/{successor.pk}/open/'
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['status'], 'ACTIVE')
        self.season.refresh_from_db()
        self.assertFalse(self.season.is_active)

    def test_close_denied_for_role_without_season_edit(self):
        response = self._client(self.transport).post(
            f'/api/v1/export/admin/seasons/{self.season.pk}/close/'
        )
        self.assertEqual(response.status_code, 403)

    def test_close_preview_denied_for_role_without_season_edit(self):
        """Design spec §7: close-preview is gated on can_edit, not can_view —
        it is advisory data for someone about to decide whether to close."""
        response = self._client(self.transport).get(
            f'/api/v1/export/admin/seasons/{self.season.pk}/close-preview/'
        )
        self.assertEqual(response.status_code, 403)

    def test_finansist_can_list_seasons(self):
        """Task 15b: finansist holds closed_season.can_view (may browse a closed
        season's data) but was missing season.can_view (may list seasons to
        populate the switcher). Without the seeded grant, this 403s."""
        response = self._client(self.finansist).get('/api/v1/export/admin/seasons/')
        self.assertEqual(response.status_code, 200)

    def test_patch_is_active_true_on_closed_season_returns_400(self):
        """Task 16b: PATCH is_active=true must not reopen a closed season —
        that bypasses open_season()'s atomic incumbent-swap + audit log.

        Deactivates the class-level incumbent (`self.season`) first: with an
        incumbent present, DRF's auto-generated conditional-UniqueConstraint
        validator on `is_active` already 400s the request for an unrelated
        reason (two rows can't both be active) and the test would pass
        without ever exercising the closed-season guard. The real hole is in
        exactly the close->open gap this reproduces: no incumbent, so nothing
        but the guard stands between the request and `uq_season_single_active`
        never even being touched.
        """
        Season.objects.filter(pk=self.season.pk).update(is_active=False)
        closed = Season.objects.create(
            name='2024/2025', start_date=date(2024, 9, 1), end_date=date(2025, 8, 31),
            closed_at=timezone.now(),
        )
        response = self._client().patch(
            f'/api/v1/export/admin/seasons/{closed.pk}/',
            {'is_active': True},
        )
        self.assertEqual(response.status_code, 400)
        closed.refresh_from_db()
        self.assertFalse(closed.is_active)

    def test_finansist_still_cannot_create_edit_or_delete_seasons(self):
        """The fix must grant view only — create/edit/delete stay denied."""
        client = self._client(self.finansist)
        create_resp = client.post('/api/v1/export/admin/seasons/', {
            'name': '2027/2028', 'start_date': '2027-09-01', 'end_date': '2028-08-31',
        })
        self.assertEqual(create_resp.status_code, 403)

        edit_resp = client.patch(
            f'/api/v1/export/admin/seasons/{self.season.pk}/',
            {'name': 'renamed'},
        )
        self.assertEqual(edit_resp.status_code, 403)

        close_resp = client.post(
            f'/api/v1/export/admin/seasons/{self.season.pk}/close/'
        )
        self.assertEqual(close_resp.status_code, 403)
