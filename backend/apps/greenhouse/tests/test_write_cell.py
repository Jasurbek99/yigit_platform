"""Tests for the create-on-write day-entry endpoint (`write-cell`).

`write_cell` upserts one HarvestDayEntry keyed by (block, entry_date) instead
of id: the container (WeeklyHarvestPlan + HarvestDayEntry) is created on first
write if missing, then the value write is dispatched to the exact same
set_plan_value/set_forecast_value/set_actual_value services `partial_update`
uses — so every gate behaves identically to a PATCH on an existing row.

Covers:
- Creating a container + cell that did not exist yet.
- Writing into a week that already has rows (no duplicate container/cell).
- A user WITHOUT permission refused exactly as on the existing PATCH path.
- A fully refused request leaving no rows behind, while rows that already
  existed survive a refusal.
- The admin-override-without-reason case (second write only — a fresh cell
  has no existing value to override).
- A closed season being refused (409) without leaving a cross-season row.
- No active season at all being refused (400).

Usage:
    python manage.py test apps.greenhouse.tests.test_write_cell --verbosity=2
"""
import unittest
from datetime import date, timedelta
from decimal import Decimal

try:
    from django.contrib.auth import get_user_model
    from django.test import TestCase
    from django.utils import timezone
    from rest_framework.test import APIClient

    from apps.core.models import GreenhouseBlock, GreenhouseConfig, Season
    from apps.greenhouse.models import BlockManagerAssignment, HarvestDayEntry, WeeklyHarvestPlan

    DB_AVAILABLE = True
except Exception:  # pragma: no cover
    DB_AVAILABLE = False


@unittest.skipUnless(DB_AVAILABLE, "Django test DB unavailable in this environment")
class TestWriteCell(TestCase):
    """DB-backed tests for POST /api/v1/greenhouse/day-entries/write-cell/."""

    URL = '/api/v1/greenhouse/day-entries/write-cell/'

    @classmethod
    def setUpTestData(cls):
        User = get_user_model()
        GreenhouseConfig.get_solo()

        # Wide date range around "today" so the plan-week cutoff never fires
        # on its own and every test targets a date safely inside the season,
        # regardless of when the suite actually runs.
        today = timezone.localdate()
        cls.monday = today - timedelta(days=today.weekday())
        cls.sunday = cls.monday + timedelta(days=6)
        # Next week — NOT yet started, so a greenhouse_manager's plan write lands
        # directly instead of becoming a PlanChangeRequest (ADR-024). The plan
        # tests below use these; `monday`/`sunday` stay for the in-week case.
        cls.next_monday = cls.monday + timedelta(days=7)
        cls.next_sunday = cls.next_monday + timedelta(days=6)

        Season.objects.update(is_active=False)
        cls.season = Season.objects.create(
            name='2026-WC', start_date=cls.monday - timedelta(days=400),
            end_date=cls.monday + timedelta(days=400), is_active=True,
        )
        cls.block = GreenhouseBlock.objects.create(
            code='WC-A', name='Write Cell Block A', is_active=True,
        )

        cls.admin = User.objects.create_user(username='wc_admin', password='x', role='admin')
        cls.manager = User.objects.create_user(username='wc_manager', password='x', role='greenhouse_manager')
        cls.other_manager = User.objects.create_user(
            username='wc_other_manager', password='x', role='greenhouse_manager',
        )
        BlockManagerAssignment.objects.create(user=cls.manager, block=cls.block, is_active=True)
        # cls.other_manager is deliberately NOT assigned to cls.block.

    def _client(self, user) -> APIClient:
        client = APIClient()
        client.force_authenticate(user=user)
        return client

    # --- 1. Creates a container + cell that did not exist ---------------

    def test_creates_container_and_cell_for_new_block_date(self):
        self.assertFalse(HarvestDayEntry.objects.filter(block=self.block).exists())

        response = self._client(self.manager).post(
            self.URL,
            {'block': self.block.id, 'entry_date': self.next_sunday.isoformat(), 'plan_value': '1234.50'},
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.content[:400])

        entry = HarvestDayEntry.objects.get(block=self.block, entry_date=self.next_sunday)
        self.assertEqual(entry.plan_value, Decimal('1234.50'))
        self.assertEqual(entry.plan_submitted_by_id, self.manager.id)
        # isocalendar(): Sunday is iso-weekday 7 -> model weekday 6.
        self.assertEqual(entry.weekday, 6)
        self.assertEqual(entry.season_id, self.season.id)

        plan = entry.weekly_plan
        self.assertEqual(plan.season_id, self.season.id)
        self.assertEqual(plan.block_id, self.block.id)
        # System-created container — indistinguishable from a cron row.
        self.assertIsNone(plan.entered_by_id)

        self.assertEqual(response.data['id'], entry.id)
        self.assertEqual(response.data['plan_value'], '1234.50')

    # --- 2. Writing into a week that already has rows: no duplicate -----

    def test_second_write_reuses_existing_container_no_duplicate(self):
        first = self._client(self.manager).post(
            self.URL,
            {'block': self.block.id, 'entry_date': self.next_monday.isoformat(), 'plan_value': '100.00'},
            format='json',
        )
        self.assertEqual(first.status_code, 200, first.content[:400])
        first_entry_id = first.data['id']

        second = self._client(self.admin).post(
            self.URL,
            {
                'block': self.block.id, 'entry_date': self.next_monday.isoformat(),
                'plan_value': '200.00', 'reason': 'correction',
            },
            format='json',
        )
        self.assertEqual(second.status_code, 200, second.content[:400])
        self.assertEqual(second.data['id'], first_entry_id)

        self.assertEqual(
            WeeklyHarvestPlan.objects.filter(
                season=self.season, block=self.block,
                week_number=self.next_monday.isocalendar().week,
                year=self.next_monday.isocalendar().year,
            ).count(),
            1,
        )
        self.assertEqual(
            HarvestDayEntry.objects.filter(block=self.block, entry_date=self.next_monday).count(), 1,
        )

        entry = HarvestDayEntry.objects.get(pk=first_entry_id)
        self.assertEqual(entry.plan_value, Decimal('200.00'))

    # --- 3. Unauthorized user refused exactly as on PATCH ----------------

    def test_user_without_permission_refused_same_as_patch(self):
        # other_manager is not assigned to cls.block — same gate PATCH uses
        # (BlockManagerAssignment ownership), via write-cell instead.
        response = self._client(self.other_manager).post(
            self.URL,
            {'block': self.block.id, 'entry_date': self.sunday.isoformat(), 'plan_value': '50.00'},
            format='json',
        )
        self.assertEqual(response.status_code, 400, response.content[:400])
        self.assertIn('plan_value', response.data)
        write_cell_message = response.data['plan_value']

        # A refused request leaves nothing behind — not even the empty rows.
        # (This test used to assert the opposite; see
        # test_refused_write_creates_no_rows for why that was a gap.)
        self.assertFalse(
            HarvestDayEntry.objects.filter(block=self.block, entry_date=self.sunday).exists()
        )

        # Same refusal via the existing PATCH path. That needs a row to address
        # by id, so make one the way an authorised writer would.
        self._client(self.manager).post(
            self.URL,
            {'block': self.block.id, 'entry_date': self.sunday.isoformat(), 'plan_value': '10.00'},
            format='json',
        )
        entry = HarvestDayEntry.objects.get(block=self.block, entry_date=self.sunday)
        patch_response = self._client(self.other_manager).patch(
            f'/api/v1/greenhouse/day-entries/{entry.id}/',
            {'plan_value': '50.00'},
            format='json',
        )
        self.assertEqual(patch_response.status_code, 400, patch_response.content[:400])
        self.assertEqual(patch_response.data['plan_value'], write_cell_message)

    def test_refused_write_creates_no_rows(self):
        """A role with no plan rights must not be able to create rows either.

        The viewset admits any authenticated user and the role checks live in
        the set_* services, so if write-cell committed the new container before
        the check ran, a seller or transport user could scaffold empty weeks for
        any block and date in the active season — one refused request at a
        time. The whole request is one transaction and rolls back when nothing
        the caller asked for was allowed.
        """
        outsider = get_user_model().objects.create_user(
            username='wc_transport', password='x', role='transport',
        )
        far_future = self.monday + timedelta(weeks=20)

        response = self._client(outsider).post(
            self.URL,
            {'block': self.block.id, 'entry_date': far_future.isoformat(), 'plan_value': '1.00'},
            format='json',
        )

        self.assertEqual(response.status_code, 400, response.content[:400])
        self.assertIn('plan_value', response.data)
        self.assertFalse(
            HarvestDayEntry.objects.filter(block=self.block, entry_date=far_future).exists()
        )
        self.assertFalse(
            WeeklyHarvestPlan.objects.filter(
                block=self.block, week_number=far_future.isocalendar()[1],
            ).exists()
        )

    def test_refused_write_keeps_rows_that_already_existed(self):
        """The rollback undoes only what this request made.

        A refusal on a row somebody else already created must not take that
        row with it — the rollback is scoped to the transaction, and the row
        predates it.
        """
        self._client(self.manager).post(
            self.URL,
            {'block': self.block.id, 'entry_date': self.next_sunday.isoformat(), 'plan_value': '10.00'},
            format='json',
        )

        response = self._client(self.other_manager).post(
            self.URL,
            {'block': self.block.id, 'entry_date': self.next_sunday.isoformat(), 'plan_value': '99.00'},
            format='json',
        )

        self.assertEqual(response.status_code, 400, response.content[:400])
        entry = HarvestDayEntry.objects.get(block=self.block, entry_date=self.next_sunday)
        self.assertEqual(entry.plan_value, Decimal('10.00'))

    def test_forecast_outside_window_refused_same_as_patch(self):
        """forecast_value carries a WINDOW gate, not just block ownership — the
        exact case create-on-write exists for (a far-out week with no row yet)
        collides with "forecast is a day-before/day-of thing". A date 30 days
        out is never inside the manager's primary window regardless of when
        this test runs.
        """
        far_date = self.monday + timedelta(days=30)

        # A refused request leaves no rows, so give the cell a row the way an
        # allowed write would — PATCH needs an id to address below.
        self._client(self.manager).post(
            self.URL,
            {'block': self.block.id, 'entry_date': far_date.isoformat(), 'plan_value': '10.00'},
            format='json',
        )

        response = self._client(self.manager).post(
            self.URL,
            {'block': self.block.id, 'entry_date': far_date.isoformat(), 'forecast_value': '50.00'},
            format='json',
        )
        self.assertEqual(response.status_code, 400, response.content[:400])
        self.assertIn('forecast_value', response.data)
        write_cell_message = response.data['forecast_value']

        entry = HarvestDayEntry.objects.get(block=self.block, entry_date=far_date)
        self.assertIsNone(entry.forecast_value)

        patch_response = self._client(self.manager).patch(
            f'/api/v1/greenhouse/day-entries/{entry.id}/',
            {'forecast_value': '50.00'},
            format='json',
        )
        self.assertEqual(patch_response.status_code, 400, patch_response.content[:400])
        self.assertEqual(patch_response.data['forecast_value'], write_cell_message)

    # --- 4. Admin override without reason — second write only ------------

    def test_admin_override_without_reason_refused_on_second_write(self):
        first = self._client(self.manager).post(
            self.URL,
            {'block': self.block.id, 'entry_date': self.next_sunday.isoformat(), 'plan_value': '10.00'},
            format='json',
        )
        self.assertEqual(first.status_code, 200, first.content[:400])

        # Second write to the SAME already-valued cell, admin, no reason.
        second = self._client(self.admin).post(
            self.URL,
            {'block': self.block.id, 'entry_date': self.next_sunday.isoformat(), 'plan_value': '99.00'},
            format='json',
        )
        self.assertEqual(second.status_code, 400, second.content[:400])
        self.assertIn('Admin override requires a non-empty reason', second.data['plan_value'])

        entry = HarvestDayEntry.objects.get(block=self.block, entry_date=self.next_sunday)
        self.assertEqual(entry.plan_value, Decimal('10.00'))  # unchanged

    # --- 4b. In-week create-on-write routes to approval (ADR-024) --------

    def test_in_week_create_routes_to_plan_change_request(self):
        """Create-on-write does not bypass the in-week approval gate.

        `write_cell` creates the row and then calls the same `set_plan_value`
        PATCH uses, so once the plan week has started a greenhouse_manager's
        write becomes a pending PlanChangeRequest rather than a plan_value —
        even on a cell that did not exist a moment ago. The container is still
        created (the request has to hang off a row), but the cell stays empty
        until an export_manager approves. 202, same body shape as PATCH.
        """
        response = self._client(self.manager).post(
            self.URL,
            {'block': self.block.id, 'entry_date': self.sunday.isoformat(), 'plan_value': '1234.50'},
            format='json',
        )

        self.assertEqual(response.status_code, 202, response.content[:400])
        self.assertIsNone(response.data['plan_value'])
        self.assertEqual(response.data['pending_change']['requested_value'], '1234.50')
        # An empty cell has no week-start baseline, so the ±pct bound does not
        # apply and the request carries no change_pct (ADR-024 rule 3).
        self.assertIsNone(response.data['plan_baseline_value'])
        self.assertIsNone(response.data['pending_change']['change_pct'])

        entry = HarvestDayEntry.objects.get(block=self.block, entry_date=self.sunday)
        self.assertIsNone(entry.plan_value)

    # --- 5. Closed season refused (409), no cross-season row -------------

    def test_closed_season_refused(self):
        closed_start = self.monday - timedelta(days=800)
        closed_end = self.monday - timedelta(days=420)
        closed_season = Season.objects.create(
            name='WC-CLOSED', start_date=closed_start, end_date=closed_end,
            closed_at=timezone.now(),
        )
        closed_date = closed_start + timedelta(days=10)

        response = self._client(self.admin).post(
            self.URL,
            {'block': self.block.id, 'entry_date': closed_date.isoformat(), 'plan_value': '77.00'},
            format='json',
        )
        self.assertEqual(response.status_code, 409, response.content[:400])
        body = response.json()
        self.assertEqual(body['error'], 'season_closed')
        self.assertEqual(body['season'], closed_season.name)
        self.assertIsNotNone(body['closed_at'])

        self.assertFalse(HarvestDayEntry.objects.filter(block=self.block, entry_date=closed_date).exists())
        self.assertFalse(
            WeeklyHarvestPlan.objects.filter(
                block=self.block,
                week_number=closed_date.isocalendar().week, year=closed_date.isocalendar().year,
            ).exists()
        )

    # --- 6. No active season at all — distinct refusal from #5 -----------

    def test_no_active_season_refused(self):
        Season.objects.update(is_active=False)

        response = self._client(self.admin).post(
            self.URL,
            {'block': self.block.id, 'entry_date': self.sunday.isoformat(), 'plan_value': '1.00'},
            format='json',
        )
        self.assertEqual(response.status_code, 400, response.content[:400])
        self.assertEqual(response.data['error'], 'No active season configured.')

    # --- Validation edge cases -------------------------------------------

    def test_missing_block_returns_400(self):
        response = self._client(self.admin).post(
            self.URL, {'entry_date': self.sunday.isoformat(), 'plan_value': '1.00'}, format='json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('block', response.data['error'])

    def test_missing_entry_date_returns_400(self):
        response = self._client(self.admin).post(
            self.URL, {'block': self.block.id, 'plan_value': '1.00'}, format='json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('entry_date', response.data['error'])

    def test_no_value_field_raises_validation_error(self):
        response = self._client(self.admin).post(
            self.URL, {'block': self.block.id, 'entry_date': self.sunday.isoformat()}, format='json',
        )
        self.assertEqual(response.status_code, 400)

    def test_collection_post_still_disabled(self):
        """POST to the plain collection URL stays a 405 — only write-cell creates rows."""
        response = self._client(self.admin).post(
            '/api/v1/greenhouse/day-entries/',
            {'block': self.block.id, 'entry_date': self.sunday.isoformat()},
            format='json',
        )
        self.assertEqual(response.status_code, 405)
